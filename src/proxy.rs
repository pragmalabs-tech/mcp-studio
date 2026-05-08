//! MCP JSON-RPC proxy.
//!
//! Studio runs in the browser, so cross-origin MCP servers may not expose the
//! `mcp-session-id` response header via CORS. This handler forwards the
//! request server-side and rewrites response headers so the browser can read
//! everything it needs.
//!
//! Bodies are streamed end-to-end via `bytes_stream` so SSE responses work
//! without buffering.
//!
//! Route: POST /api/mcp-proxy?url=<upstream>

use std::sync::OnceLock;

use axum::body::Bytes;
use axum::extract::Query;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use reqwest::Client;
use serde::Deserialize;
use uuid::Uuid;

use crate::forwarding;

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub url: String,
}

fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .build()
            .expect("failed to build reqwest client")
    })
}

pub async fn handler(Query(q): Query<ProxyQuery>, headers: HeaderMap, body: Bytes) -> Response {
    let id = Uuid::new_v4().to_string();
    tracing::info!(
        id = %id,
        url = %q.url,
        body_bytes = body.len(),
        "proxy: received request"
    );

    if !q.url.starts_with("http://") && !q.url.starts_with("https://") {
        tracing::warn!(id = %id, url = %q.url, "proxy: invalid URL");
        return json_error(StatusCode::BAD_REQUEST, "url must be http:// or https://");
    }

    let req_headers = forwarding::sanitize_request_headers(&headers);
    tracing::debug!(
        id = %id,
        headers = ?forwarding::fmt_headers(&req_headers),
        "proxy: forwarding"
    );

    let mut builder = http_client().post(&q.url).body(body.to_vec());
    for (k, v) in &req_headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    let resp = match builder.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(id = %id, error = %e, "proxy: upstream connection failed");
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("upstream request failed: {e}"),
            );
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut out_headers = forwarding::sanitize_response_headers(resp.headers());

    // Preserve the historical CORS-expose-headers behavior: if mcp-session-id
    // is present in upstream, advertise it via Access-Control-Expose-Headers
    // so the browser fetch() API can read it cross-origin.
    if out_headers.contains_key("mcp-session-id") {
        out_headers.insert(
            axum::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static("mcp-session-id"),
        );
    }

    let resp_headers_log: Vec<(String, String)> = out_headers
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
        "proxy: upstream headers received"
    );

    let status_code = status.as_u16();

    if is_streaming {
        let (body, preview_rx) = forwarding::body_with_preview(id.clone(), resp.bytes_stream());
        let id_for_tap = id.clone();
        tokio::spawn(async move {
            match preview_rx.await {
                Ok(preview) => {
                    tracing::info!(
                        id = %id_for_tap,
                        status = status_code,
                        bytes = preview.bytes_seen,
                        end_reason = ?preview.end_reason,
                        body_preview = %preview.preview,
                        "proxy: response stream ended"
                    );
                }
                Err(_) => {
                    tracing::warn!(id = %id_for_tap, "proxy: response stream cancelled before completion");
                }
            }
        });

        let mut builder = Response::builder().status(status);
        for (k, v) in out_headers.iter() {
            builder = builder.header(k, v);
        }
        builder.body(body).unwrap_or_else(|e| {
            tracing::error!(id = %id, error = %e, "proxy: failed to build response");
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("build response: {e}"),
            )
        })
    } else {
        let body_bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(id = %id, error = %e, "proxy: failed to read upstream body");
                return json_error(StatusCode::BAD_GATEWAY, &format!("read upstream body: {e}"));
            }
        };
        tracing::info!(
            id = %id,
            status = status_code,
            bytes = body_bytes.len(),
            body_preview = %forwarding::preview_text(&body_bytes),
            "proxy: upstream body received (buffered)"
        );

        let mut builder = Response::builder().status(status);
        for (k, v) in out_headers.iter() {
            builder = builder.header(k, v);
        }
        builder
            .body(axum::body::Body::from(body_bytes))
            .unwrap_or_else(|e| {
                tracing::error!(id = %id, error = %e, "proxy: failed to build response");
                json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("build response: {e}"),
                )
            })
    }
}

fn json_error(status: StatusCode, msg: &str) -> Response {
    let escaped = msg.replace('\\', "\\\\").replace('"', "\\\"");
    let body = format!(r#"{{"error":"{escaped}"}}"#);
    (
        status,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response()
}
