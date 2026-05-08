//! Broadcast channel for tunnel-captured request/response events.
//!
//! The ephemeral tunnel forwarder publishes one event per incoming request
//! and one per outgoing response. SSE subscribers (the frontend) receive
//! the stream live. No persistence; channel buffer is bounded.

use serde::Serialize;

const CHANNEL_CAPACITY: usize = 256;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    TunnelRequest {
        id: String,
        ts: i64,
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body_preview: String,
    },
    TunnelResponse {
        id: String,
        ts: i64,
        status: u16,
        headers: Vec<(String, String)>,
        body_preview: String,
    },
}

pub type Sender = tokio::sync::broadcast::Sender<Event>;

pub fn channel() -> Sender {
    let (tx, _rx) = tokio::sync::broadcast::channel(CHANNEL_CAPACITY);
    tx
}
