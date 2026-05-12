//! HTTP handlers for batch test-run results at `~/.mcp-studio/run-results/<id>.json`.
//!
//! Each file stores one completed batch run: filter, environment, summary
//! counts, and per-test entries (recorded + replayed trace + verdict). The
//! frontend is the source of truth for the schema; the backend only validates
//! structural fields needed for the catalog listing.

use axum::Json;
use axum::extract::Path;
use axum::http::StatusCode;
use serde::Serialize;
use serde_json::Value;

use crate::server::AppError;
use crate::storage;

#[derive(Serialize)]
pub struct RunResultSummary {
    pub id: String,
    pub size: u64,
    pub modified_ms: u128,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub run_type: Option<String>,
    pub filter: Option<Value>,
    pub env: Option<Value>,
    pub summary: Option<Value>,
}

fn lift_summary(id: &str, file: storage::JsonFile, value: &Value) -> RunResultSummary {
    let started_at = value.get("startedAt").and_then(|v| v.as_u64());
    let finished_at = value.get("finishedAt").and_then(|v| v.as_u64());
    let run_type = value
        .get("runType")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let filter = value.get("filter").cloned();
    let env = value.get("env").cloned();
    let summary = value.get("summary").cloned();
    RunResultSummary {
        id: id.to_string(),
        size: file.size,
        modified_ms: file.modified_ms,
        started_at,
        finished_at,
        run_type,
        filter,
        env,
        summary,
    }
}

pub async fn list_run_results() -> Result<Json<Vec<RunResultSummary>>, AppError> {
    let dir =
        storage::run_results_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?;
    let files = storage::list_json(&dir).map_err(|e| AppError::Internal(e.to_string()))?;
    let mut out = Vec::with_capacity(files.len());
    for file in files {
        let path = dir.join(format!("{}.json", file.name));
        let id = file.name.clone();
        let value = storage::read_json(&path).unwrap_or(Value::Null);
        out.push(lift_summary(&id, file, &value));
    }
    Ok(Json(out))
}

fn resolve_path(id: &str) -> Result<std::path::PathBuf, AppError> {
    let slug = storage::safe_filename(id);
    if slug != id {
        return Err(AppError::BadRequest(format!(
            "invalid run id `{id}` (must match safe slug, got `{slug}`)"
        )));
    }
    let dir =
        storage::run_results_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?;
    Ok(dir.join(format!("{slug}.json")))
}

pub async fn get_run_result(Path(id): Path<String>) -> Result<Json<Value>, AppError> {
    let path = resolve_path(&id)?;
    if !path.exists() {
        return Err(AppError::NotFound(format!("run-result `{id}` not found")));
    }
    let value = storage::read_json(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(value))
}

pub async fn put_run_result(
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<RunResultSummary>, AppError> {
    if body.get("startedAt").is_none() || body.get("summary").is_none() {
        return Err(AppError::BadRequest(
            "expected run-result with `startedAt` and `summary` fields".into(),
        ));
    }
    let path = resolve_path(&id)?;
    storage::write_json(&path, &body).map_err(|e| AppError::Internal(e.to_string()))?;
    let metadata = std::fs::metadata(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(Json(lift_summary(
        &id,
        storage::JsonFile {
            name: id.clone(),
            size: metadata.len(),
            modified_ms,
        },
        &body,
    )))
}

pub async fn delete_run_result(Path(id): Path<String>) -> Result<StatusCode, AppError> {
    let path = resolve_path(&id)?;
    storage::delete_file(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
