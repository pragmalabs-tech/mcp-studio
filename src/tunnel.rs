//! Tunnel runtime.
//!
//! When `start()` is called, this module:
//!   1. Binds a local axum listener on an OS-assigned port
//!   2. That listener forwards every request to the user's configured MCP
//!      server URL, capturing each request/response into the action log
//!   3. Hands the local port to `mcp_tunnel_client::start_tunnel_client`,
//!      which exposes that port to the public internet via tunnel.mcpr.app
//!
//! Body forwarding is fully streamed: response headers go out as soon as
//! upstream produces them, and body chunks flow through unbuffered. SSE and
//! long-running responses work end-to-end.
//!
//! v1 has no `stop()` — `start_tunnel_client` detaches its work task and
//! exposes no handle to abort. The tunnel runs until the Studio process
//! exits.

use std::sync::Arc;
use std::sync::OnceLock;

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::action_log;
use crate::forwarding;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TunnelInfo {
    pub url: String,
    pub subdomain: Option<String>,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Default)]
pub struct TunnelState {
    inner: RwLock<Option<TunnelInfo>>,
}

impl TunnelState {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(None),
        }
    }

    pub async fn current(&self) -> Option<TunnelInfo> {
        self.inner.read().await.clone()
    }

    /// Start the tunnel. Returns the public URL.
    pub async fn start(
        self: &Arc<Self>,
        token: &str,
        relay_url: &str,
        subdomain: Option<&str>,
        mcp_url: String,
        action_log_tx: action_log::Sender,
    ) -> Result<TunnelInfo, String> {
        if self.current().await.is_some() {
            return Err("tunnel already active".into());
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("failed to bind ephemeral forwarder: {e}"))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("failed to read local addr: {e}"))?
            .port();

        let app_state = ForwarderState {
            mcp_url: Arc::new(mcp_url),
            action_log: action_log_tx,
        };
        let app = axum::Router::new().fallback(forward).with_state(app_state);

        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                tracing::error!("ephemeral forwarder exited: {e}");
            }
        });

        let cb = TunnelStatusCb;
        let public_url =
            mcp_tunnel_client::start_tunnel_client(local_port, relay_url, token, subdomain, cb)
                .await
                .map_err(|e| format!("tunnel client failed: {e}"))?;

        let info = TunnelInfo {
            url: public_url,
            subdomain: subdomain.map(str::to_string),
            started_at: Utc::now(),
        };
        *self.inner.write().await = Some(info.clone());
        Ok(info)
    }
}

struct TunnelStatusCb;

impl mcp_tunnel_client::TunnelStatusCallback for TunnelStatusCb {
    fn on_connected(&self, url: &str) {
        tracing::info!(%url, "tunnel connected");
    }
    fn on_disconnected(&self) {
        tracing::warn!("tunnel disconnected");
    }
    fn on_evicted(&self) {
        tracing::warn!("tunnel evicted by relay");
    }
}

#[derive(Clone)]
struct ForwarderState {
    mcp_url: Arc<String>,
    action_log: action_log::Sender,
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // Headers timeout only — body streams as long as upstream wants.
            // Matches mcp-tunnel-client's behavior.
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .build()
            .expect("failed to build forwarder http client")
    })
}

async fn forward(State(state): State<ForwarderState>, req: Request) -> Response {
    let id = Uuid::new_v4().to_string();
    let method = req.method().clone();
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());

    tracing::info!(
        id = %id,
        method = %method,
        path = %path_and_query,
        "tunnel: received request"
    );

    let (parts, body) = req.into_parts();
    let body_bytes = match axum::body::to_bytes(body, 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(id = %id, error = %e, "tunnel: failed to read request body");
            return error_response(StatusCode::BAD_REQUEST, format!("read body: {e}"));
        }
    };

    let req_headers = forwarding::sanitize_request_headers(&parts.headers);
    let req_preview = forwarding::preview_text(&body_bytes);

    tracing::debug!(
        id = %id,
        bytes = body_bytes.len(),
        headers = ?forwarding::fmt_headers(&req_headers),
        body_preview = %req_preview,
        "tunnel: request body + headers"
    );

    let _ = state.action_log.send(action_log::Event::TunnelRequest {
        id: id.clone(),
        ts: Utc::now().timestamp_millis(),
        method: method.to_string(),
        path: path_and_query.clone(),
        headers: req_headers.clone(),
        body_preview: req_preview,
    });

    // Path joining: incoming `/` maps to mcp_url verbatim (no trailing slash).
    // Anything else appends to mcp_url (with trailing slash stripped first).
    let upstream_url = if path_and_query == "/" {
        state.mcp_url.trim_end_matches('/').to_string()
    } else {
        format!("{}{}", state.mcp_url.trim_end_matches('/'), path_and_query)
    };

    tracing::info!(id = %id, upstream = %upstream_url, "tunnel: forwarding to upstream");

    let mut builder = http_client()
        .request(method.clone(), &upstream_url)
        .body(body_bytes.to_vec());
    for (k, v) in &req_headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    let resp = match builder.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(id = %id, upstream = %upstream_url, error = %e, "tunnel: upstream connection failed");
            let _ = state.action_log.send(action_log::Event::TunnelResponse {
                id: id.clone(),
                ts: Utc::now().timestamp_millis(),
                status: 502,
                headers: Vec::new(),
                body_preview: format!("upstream connection failed: {e}"),
            });
            return error_response(StatusCode::BAD_GATEWAY, format!("upstream failed: {e}"));
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let resp_headers_map = forwarding::sanitize_response_headers(resp.headers());
    let resp_headers_log: Vec<(String, String)> = resp_headers_map
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_string(), v.to_string()))
        })
        .collect();
    let is_streaming = forwarding::is_streaming_content_type(resp.headers());

    tracing::info!(
        id = %id,
        status = %status,
        streaming = is_streaming,
        headers = ?forwarding::fmt_headers(&resp_headers_log),
        "tunnel: upstream headers received"
    );

    let action_log = state.action_log.clone();
    let id_for_log = id.clone();
    let resp_headers_for_event = resp_headers_log.clone();
    let status_code = status.as_u16();

    if is_streaming {
        // SSE / chunked: must not buffer. Stream chunks through axum's
        // chunked transfer encoding.
        let (body, preview_rx) = forwarding::body_with_preview(id.clone(), resp.bytes_stream());
        tokio::spawn(async move {
            match preview_rx.await {
                Ok(preview) => {
                    tracing::info!(
                        id = %id_for_log,
                        status = status_code,
                        bytes = preview.bytes_seen,
                        end_reason = ?preview.end_reason,
                        body_preview = %preview.preview,
                        "tunnel: upstream stream ended"
                    );
                    let _ = action_log.send(action_log::Event::TunnelResponse {
                        id: id_for_log,
                        ts: Utc::now().timestamp_millis(),
                        status: status_code,
                        headers: resp_headers_for_event,
                        body_preview: preview.preview,
                    });
                }
                Err(_) => {
                    tracing::warn!(id = %id_for_log, "tunnel: response stream cancelled before completion");
                }
            }
        });

        let mut builder = Response::builder().status(status);
        for (k, v) in resp_headers_map.iter() {
            builder = builder.header(k, v);
        }
        builder.body(body).unwrap_or_else(|e| {
            tracing::error!(id = %id, error = %e, "tunnel: failed to build response");
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("build response: {e}"),
            )
        })
    } else {
        // One-shot response: buffer fully so axum sends a clean
        // Content-Length. This is critical for chained proxies — the
        // tunnel relay strips Transfer-Encoding before forwarding to
        // the public client, so we must give it a known-length body.
        let body_bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(id = %id, error = %e, "tunnel: failed to read upstream body");
                let _ = action_log.send(action_log::Event::TunnelResponse {
                    id: id_for_log,
                    ts: Utc::now().timestamp_millis(),
                    status: 502,
                    headers: resp_headers_for_event,
                    body_preview: format!("read upstream body: {e}"),
                });
                return error_response(StatusCode::BAD_GATEWAY, format!("read upstream body: {e}"));
            }
        };
        let preview = forwarding::preview_text(&body_bytes);
        tracing::info!(
            id = %id,
            status = status_code,
            bytes = body_bytes.len(),
            body_preview = %preview,
            "tunnel: upstream body received (buffered)"
        );
        let _ = action_log.send(action_log::Event::TunnelResponse {
            id: id_for_log,
            ts: Utc::now().timestamp_millis(),
            status: status_code,
            headers: resp_headers_for_event,
            body_preview: preview,
        });

        let mut builder = Response::builder().status(status);
        for (k, v) in resp_headers_map.iter() {
            builder = builder.header(k, v);
        }
        builder
            .body(axum::body::Body::from(body_bytes))
            .unwrap_or_else(|e| {
                tracing::error!(id = %id, error = %e, "tunnel: failed to build response");
                error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("build response: {e}"),
                )
            })
    }
}

fn error_response(status: StatusCode, msg: String) -> Response {
    (status, msg).into_response()
}
