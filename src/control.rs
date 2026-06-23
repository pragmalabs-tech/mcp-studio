use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::Json;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::server::{AppError, AppState};

// ── WS action types ───────────────────────────────────────────────────────────

/// Actions the server can push to the active frontend client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum FrontendAction {
    RunTest { test_id: String, job_id: String },
}

// ── WebSocket connection tracking ─────────────────────────────────────────────

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

    let mut guard = s.ws_sender.lock().await;
    if matches!(guard.as_ref(), Some((id, _)) if *id == conn_id) {
        *guard = None;
    }
    tracing::info!(conn_id, "frontend control socket disconnected");
}

// ── Job store ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum JobStatus {
    Running,
}

pub type JobStore = Arc<Mutex<HashMap<String, JobStatus>>>;

pub fn new_job_store() -> JobStore {
    Arc::new(Mutex::new(HashMap::new()))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

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
    let job_id = Uuid::new_v4().to_string();
    s.job_store
        .lock()
        .await
        .insert(job_id.clone(), JobStatus::Running);
    tx.send(FrontendAction::RunTest {
        test_id: body.test_id,
        job_id: job_id.clone(),
    })
    .await
    .map_err(|_| AppError::BadRequest("frontend disconnected".into()))?;
    Ok(Json(serde_json::json!({
        "job_id": job_id,
        "job_result_url": format!("http://localhost:7777/api/studio/control/jobs/{job_id}"),
    })))
}

pub async fn get_job(
    State(s): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Check the persistent index first — if the replay was saved, we're done.
    if let Some(replay_id) = lookup_job_result(&job_id) {
        let mut resp = serde_json::json!({
            "status": "done",
            "replay_id": replay_id,
        });
        // Lift key fields from the replay file so callers don't need a second request.
        if let Some(replay) = load_replay(&replay_id) {
            let test_status = replay
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            resp["test_status"] = serde_json::Value::String(test_status.to_string());
            resp["test_result"] = serde_json::json!({
                "testName":   replay.get("testName"),
                "status":     replay.get("status"),
                "durationMs": replay.get("durationMs"),
                "actions":    replay.get("actions").and_then(|a| a.as_array()).map(|a| a.len()),
            });
        }
        return Ok(Json(resp));
    }
    // Fall back to the in-memory store (job is still running).
    s.job_store
        .lock()
        .await
        .get(&job_id)
        .map(|s| Json(serde_json::json!({ "status": s })))
        .ok_or_else(|| AppError::NotFound(format!("job {job_id}")))
}

fn load_replay(replay_id: &str) -> Option<serde_json::Value> {
    let dir = crate::storage::run_results_dir()?;
    let path = dir.join(format!("{replay_id}.json"));
    crate::storage::read_json(&path).ok()
}

fn lookup_job_result(job_id: &str) -> Option<String> {
    let path = crate::storage::job_results_path()?;
    let value = crate::storage::read_json(&path).ok()?;
    value.get(job_id)?.as_str().map(|s| s.to_string())
}
