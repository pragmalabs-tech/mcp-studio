use std::sync::atomic::{AtomicU64, Ordering};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::server::AppState;

// ── WS action types ───────────────────────────────────────────────────────────

/// Actions the server can push to the active frontend client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum FrontendAction {
    RunTest { test_id: String, job_id: String },
}

// ── Global active WebSocket sender ────────────────────────────────────────────

static WS_CONN_COUNTER: AtomicU64 = AtomicU64::new(0);
static ACTIVE_WS: Mutex<Option<(u64, tokio::sync::mpsc::Sender<FrontendAction>)>> =
    Mutex::const_new(None);

/// Send an action to the connected frontend. Logs a warning and returns if no
/// client is connected; never errors on a missing connection.
pub async fn send_frontend_action(action: FrontendAction) {
    let guard = ACTIVE_WS.lock().await;
    let Some((_, tx)) = guard.as_ref() else {
        tracing::warn!("send_frontend_action: no frontend connected, skipping");
        return;
    };
    if let Err(e) = tx.send(action).await {
        tracing::warn!("send_frontend_action: frontend disconnected: {e}");
    }
}

pub async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws(socket, s))
}

async fn handle_ws(mut socket: WebSocket, _s: AppState) {
    let conn_id = WS_CONN_COUNTER.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = tokio::sync::mpsc::channel::<FrontendAction>(32);

    *ACTIVE_WS.lock().await = Some((conn_id, tx));
    tracing::info!(conn_id, "frontend control socket connected");

    loop {
        tokio::select! {
            action = rx.recv() => {
                let Some(action) = action else { break };
                let msg = match serde_json::to_string(&action) {
                    Ok(s) => s,
                    Err(e) => { tracing::error!("serialize error: {e}"); continue; }
                };
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    let mut guard = ACTIVE_WS.lock().await;
    if matches!(guard.as_ref(), Some((id, _)) if *id == conn_id) {
        *guard = None;
    }
    tracing::info!(conn_id, "frontend control socket disconnected");
}
