use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::Json;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::server::{AppError, AppState};

/// Actions the server can push to the active frontend client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum FrontendAction {
    // Triggered by the frontend to run a test (replay).
    RunTest { test_id: String },
}

/// Tracks the latest frontend WebSocket connection.
/// `(conn_id, sender)` — conn_id lets us avoid clearing a newer connection
/// when an older one disconnects.
pub type WsSender = Arc<Mutex<Option<(u64, tokio::sync::mpsc::Sender<FrontendAction>)>>>;
pub type WsConnCounter = Arc<AtomicU64>;

pub fn new_ws_state() -> (WsSender, WsConnCounter) {
    (Arc::new(Mutex::new(None)), Arc::new(AtomicU64::new(0)))
}

pub async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws(socket, s))
}

async fn handle_ws(mut socket: WebSocket, s: AppState) {
    let conn_id = s.ws_conn_counter.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = tokio::sync::mpsc::channel::<FrontendAction>(32);

    // Latest connection wins — replace any stale sender.
    *s.ws_sender.lock().await = Some((conn_id, tx));
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

    // Only clear if we're still the active connection.
    let mut guard = s.ws_sender.lock().await;
    if matches!(guard.as_ref(), Some((id, _)) if *id == conn_id) {
        *guard = None;
    }
    tracing::info!(conn_id, "frontend control socket disconnected");
}

#[derive(Deserialize)]
pub struct TriggerTestReq {
    pub test_id: String,
}

pub async fn trigger_test(
    State(s): State<AppState>,
    Json(body): Json<TriggerTestReq>,
) -> Result<Json<serde_json::Value>, AppError> {
    let guard = s.ws_sender.lock().await;
    let Some((_, tx)) = guard.as_ref() else {
        return Err(AppError::BadRequest("no frontend connected".into()));
    };
    tx.send(FrontendAction::RunTest {
        test_id: body.test_id,
    })
    .await
    .map_err(|_| AppError::BadRequest("frontend disconnected".into()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
