//! Shared HTTP forwarding primitives used by both the tunnel forwarder and
//! the `/api/mcp-proxy` endpoint.
//!
//! Three pieces:
//!   - `is_hop_by_hop` / `sanitize_*_headers` — RFC 7230 + `host` filtering
//!   - `body_with_preview` — wraps a reqwest bytes_stream into an axum Body
//!     while taping the first 4 KiB into a preview buffer. Returns a oneshot
//!     receiver that fires with the preview when the stream ends.
//!   - `preview_text` / `fmt_headers` — formatting helpers shared by handlers

use std::pin::Pin;
use std::task::{Context, Poll};

use axum::body::Body;
use axum::http::{HeaderMap, HeaderName, HeaderValue};
use bytes::Bytes;
use futures::Stream;
use tokio::sync::oneshot;

pub const PREVIEW_BYTES: usize = 4096;

/// Returns true if the Content-Type indicates a streaming response that
/// must NOT be buffered (server-sent events). Anything else is buffered
/// so we can set a Content-Length on the response, which fixes hop-by-hop
/// length mismatches when the response is forwarded through chained proxies
/// (e.g., the tunnel relay).
pub fn is_streaming_content_type(headers: &reqwest::header::HeaderMap) -> bool {
    headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| {
            ct.split(';')
                .next()
                .unwrap_or(ct)
                .trim()
                .eq_ignore_ascii_case("text/event-stream")
        })
        .unwrap_or(false)
}

/// Truncate bytes to a UTF-8-safe preview string.
pub fn preview_text(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    let cut = bytes.len().min(PREVIEW_BYTES);
    match std::str::from_utf8(&bytes[..cut]) {
        Ok(s) => s.to_string(),
        Err(_) => format!("<{} non-utf8 bytes>", bytes.len()),
    }
}

/// Format header pairs as `["k=v", ...]` for tracing.
pub fn fmt_headers(headers: &[(String, String)]) -> Vec<String> {
    headers.iter().map(|(k, v)| format!("{k}={v}")).collect()
}

/// RFC 7230 hop-by-hop headers + `content-length`. These describe a single
/// connection hop and must not be forwarded across a proxy. Mirrors
/// `mcp-tunnel/crates/mcp-tunnel-client/src/protocol.rs::is_hop_by_hop`.
pub fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "content-length"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

/// Filter request headers for upstream. Drops hop-by-hop and `host` (reqwest
/// derives Host from the upstream URL).
pub fn sanitize_request_headers(src: &HeaderMap) -> Vec<(String, String)> {
    src.iter()
        .filter(|(k, _)| {
            let n = k.as_str();
            !is_hop_by_hop(n) && !n.eq_ignore_ascii_case("host")
        })
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_string(), v.to_string()))
        })
        .collect()
}

/// Filter upstream response headers for the caller. Drops hop-by-hop only.
pub fn sanitize_response_headers(src: &reqwest::header::HeaderMap) -> HeaderMap {
    let mut out = HeaderMap::new();
    for (k, v) in src.iter() {
        if is_hop_by_hop(k.as_str()) {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_str().as_bytes()),
            HeaderValue::from_bytes(v.as_bytes()),
        ) {
            out.insert(name, value);
        }
    }
    out
}

/// Result of the body preview tap. Fires once the upstream stream ends
/// (gracefully, with error, or via Drop if the caller went away).
pub struct PreviewResult {
    pub bytes_seen: usize,
    pub preview: String,
    /// How the tap was triggered. Useful for distinguishing "upstream
    /// fully drained" from "axum dropped the body before draining."
    pub end_reason: EndReason,
}

#[derive(Debug, Clone, Copy)]
pub enum EndReason {
    /// Upstream stream returned Poll::Ready(None) — clean end.
    StreamEnded,
    /// Upstream stream errored.
    StreamErrored,
    /// TappedStream was dropped before stream ended (caller went away).
    Dropped,
}

/// Wrap a reqwest `bytes_stream` into an axum `Body` and return a oneshot
/// receiver that delivers a preview of the body once the stream ends.
///
/// The tap runs inline in the streaming pipeline — it doesn't add a copy
/// for non-preview bytes. Only the first `PREVIEW_BYTES` are accumulated.
/// Per-chunk polls log at DEBUG (set `RUST_LOG=mcp_studio=debug` to see
/// them); end-of-stream and Drop fire INFO/WARN at the default level.
pub fn body_with_preview<S>(
    request_id: String,
    upstream: S,
) -> (Body, oneshot::Receiver<PreviewResult>)
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + Unpin + 'static,
{
    let (tx, rx) = oneshot::channel();
    let stream = TappedStream {
        inner: upstream,
        buf: Vec::with_capacity(PREVIEW_BYTES),
        bytes_seen: 0,
        request_id,
        tx: Some(tx),
    };
    (Body::from_stream(stream), rx)
}

struct TappedStream<S> {
    inner: S,
    buf: Vec<u8>,
    bytes_seen: usize,
    request_id: String,
    tx: Option<oneshot::Sender<PreviewResult>>,
}

impl<S> TappedStream<S> {
    fn fire(&mut self, end_reason: EndReason) {
        if let Some(tx) = self.tx.take() {
            let preview = match std::str::from_utf8(&self.buf) {
                Ok(s) => s.to_string(),
                Err(_) => format!("<{} non-utf8 bytes>", self.bytes_seen),
            };
            let _ = tx.send(PreviewResult {
                bytes_seen: self.bytes_seen,
                preview,
                end_reason,
            });
        }
    }
}

impl<S> Stream for TappedStream<S>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(None) => {
                tracing::info!(
                    id = %self.request_id,
                    total_bytes = self.bytes_seen,
                    "body: stream end-of-stream"
                );
                self.fire(EndReason::StreamEnded);
                Poll::Ready(None)
            }
            Poll::Ready(Some(Ok(bytes))) => {
                self.bytes_seen += bytes.len();
                let remaining = PREVIEW_BYTES.saturating_sub(self.buf.len());
                if remaining > 0 {
                    let take = remaining.min(bytes.len());
                    self.buf.extend_from_slice(&bytes[..take]);
                }
                tracing::debug!(
                    id = %self.request_id,
                    chunk_bytes = bytes.len(),
                    total_so_far = self.bytes_seen,
                    "body: stream chunk"
                );
                Poll::Ready(Some(Ok(bytes)))
            }
            Poll::Ready(Some(Err(e))) => {
                tracing::warn!(
                    id = %self.request_id,
                    error = %e,
                    "body: stream errored"
                );
                self.fire(EndReason::StreamErrored);
                Poll::Ready(Some(Err(std::io::Error::other(e))))
            }
        }
    }
}

impl<S> Drop for TappedStream<S> {
    fn drop(&mut self) {
        if self.tx.is_some() {
            tracing::warn!(
                id = %self.request_id,
                bytes_so_far = self.bytes_seen,
                "body: stream dropped before completion"
            );
        }
        self.fire(EndReason::Dropped);
    }
}
