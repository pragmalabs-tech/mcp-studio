use std::collections::HashMap;
use std::sync::LazyLock;

use axum::Json;
use axum::extract::Path;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::control::{FrontendAction, send_frontend_action};
use crate::server::AppError;

// ── Job store ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum JobStatus {
    Running,
}

static JOB_STORE: LazyLock<Mutex<HashMap<String, JobStatus>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// ── Handlers ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct TriggerTestReq {
    pub test_id: String,
}

#[derive(Serialize)]
pub struct TriggerTestRes {
    pub job_id: String,
    pub job_result_url: String,
}

pub async fn trigger_test(test_id: String) -> Result<TriggerTestRes, AppError> {
    let job_id = Uuid::new_v4().to_string();

    JOB_STORE
        .lock()
        .await
        .insert(job_id.clone(), JobStatus::Running);
    send_frontend_action(FrontendAction::RunTest {
        test_id,
        job_id: job_id.clone(),
    })
    .await;
    Ok(TriggerTestRes {
        job_result_url: format!("{}/api/studio/control/jobs/{job_id}", crate::PUBLIC_URL),
        job_id,
    })
}

pub async fn trigger_test_by_api(
    Json(body): Json<TriggerTestReq>,
) -> Result<Json<TriggerTestRes>, AppError> {
    let result = trigger_test(body.test_id).await?;
    Ok(Json(result))
}

pub async fn get_job(Path(job_id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    if let Some(replay_id) = lookup_job_result(&job_id) {
        let mut resp = serde_json::json!({
            "status": "done",
            "replay_id": replay_id,
        });
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
    JOB_STORE
        .lock()
        .await
        .get(&job_id)
        .map(|s| Json(serde_json::json!({ "status": s })))
        .ok_or_else(|| AppError::NotFound(format!("job {job_id}")))
}

pub async fn get_job_result(job_id: &str) -> Option<serde_json::Value> {
    if let Some(replay_id) = lookup_job_result(job_id) {
        return load_replay(&replay_id).map(|replay| {
            serde_json::json!({
                "status": "done",
                "testName":   replay.get("testName"),
                "test_status": replay.get("status").and_then(|v| v.as_str()).unwrap_or("unknown"),
                "durationMs": replay.get("durationMs"),
                "actions":    replay.get("actions").and_then(|a| a.as_array()).map(|a| a.len()),
            })
        });
    }
    let guard = JOB_STORE.lock().await;
    guard
        .get(job_id)
        .map(|s| serde_json::json!({ "status": s }))
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
