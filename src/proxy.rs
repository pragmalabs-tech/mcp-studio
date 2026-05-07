//! MCP JSON-RPC proxy.
//!
//! Studio runs in the browser, so cross-origin MCP servers may not expose the
//! `mcp-session-id` response header via CORS. This handler forwards the
//! request server-side and rewrites response headers so the browser can read
//! everything it needs.
//!
//! Route: POST /api/mcp-proxy?url=<upstream>

use std::sync::OnceLock;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::Query;
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use reqwest::Client;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub url: String,
}

fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("failed to build reqwest client")
    })
}

pub async fn handler(Query(q): Query<ProxyQuery>, headers: HeaderMap, body: Bytes) -> Response {
    if !q.url.starts_with("http://") && !q.url.starts_with("https://") {
        return json_error(StatusCode::BAD_REQUEST, "url must be http:// or https://");
    }

    let client = http_client();
    let mut req = client.post(&q.url).body(body.to_vec());

    for name in [
        axum::http::header::CONTENT_TYPE,
        axum::http::header::ACCEPT,
        axum::http::header::AUTHORIZATION,
    ] {
        if let Some(v) = headers.get(&name)
            && let Ok(s) = v.to_str()
        {
            req = req.header(name.as_str(), s);
        }
    }
    if let Some(v) = headers.get("mcp-session-id")
        && let Ok(s) = v.to_str()
    {
        req = req.header("mcp-session-id", s);
    }

    let upstream = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("upstream request failed: {e}"),
            );
        }
    };

    let status = upstream.status();
    let session_id = header_string(upstream.headers(), "mcp-session-id");
    let www_auth = header_string(upstream.headers(), "www-authenticate");
    let content_type = header_string(upstream.headers(), "content-type")
        .unwrap_or_else(|| "application/json".to_string());

    let upstream_body = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("failed to read upstream body: {e}"),
            );
        }
    };

    let mut out = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&content_type) {
        out.insert(axum::http::header::CONTENT_TYPE, v);
    }
    if let Some(sid) = session_id
        && let Ok(v) = HeaderValue::from_str(&sid)
    {
        out.insert(HeaderName::from_static("mcp-session-id"), v);
        out.insert(
            axum::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static("mcp-session-id"),
        );
    }
    if let Some(auth) = www_auth
        && let Ok(v) = HeaderValue::from_str(&auth)
    {
        out.insert(axum::http::header::WWW_AUTHENTICATE, v);
    }

    (status, out, upstream_body).into_response()
}

fn header_string(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(String::from)
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
