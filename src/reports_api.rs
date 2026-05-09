//! HTTP handlers for replay run reports: `~/.mcp-studio/reports/<slug>.json`.
//!
//! Reports are append-only in v1 — no DELETE endpoint, so users keep a run
//! history per test. List + get + put covers the UX (browse past runs,
//! re-open, save fresh report from the result modal).

use axum::Json;
use axum::extract::Path;
use serde::Serialize;
use serde_json::Value;

use crate::server::AppError;
use crate::storage;

#[derive(Serialize)]
pub struct ReportSummary {
    pub name: String,
    pub size: u64,
    pub modified_ms: u128,
    pub test_name: Option<String>,
    pub run_id: Option<String>,
    pub passed: Option<u64>,
    pub failed: Option<u64>,
    pub total: Option<u64>,
    pub started_at: Option<String>,
}

fn lift_summary(name: &str, file: storage::JsonFile, value: &Value) -> ReportSummary {
    let test_name = value
        .pointer("/test/name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let run_id = value
        .get("runId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let started_at = value
        .get("startedAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let passed = value.pointer("/summary/passed").and_then(|v| v.as_u64());
    let failed = value.pointer("/summary/failed").and_then(|v| v.as_u64());
    let total = value.pointer("/summary/total").and_then(|v| v.as_u64());
    ReportSummary {
        name: name.to_string(),
        size: file.size,
        modified_ms: file.modified_ms,
        test_name,
        run_id,
        passed,
        failed,
        total,
        started_at,
    }
}

pub async fn list_reports() -> Result<Json<Vec<ReportSummary>>, AppError> {
    let dir =
        storage::reports_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?;
    let files = storage::list_json(&dir).map_err(|e| AppError::Internal(e.to_string()))?;
    let mut out = Vec::with_capacity(files.len());
    for file in files {
        let path = dir.join(format!("{}.json", file.name));
        let name = file.name.clone();
        let value = storage::read_json(&path).unwrap_or(Value::Null);
        out.push(lift_summary(&name, file, &value));
    }
    Ok(Json(out))
}

fn resolve_path(name: &str) -> Result<std::path::PathBuf, AppError> {
    let slug = storage::safe_filename(name);
    if slug != name {
        return Err(AppError::BadRequest(format!(
            "invalid report name `{name}` (must match safe slug, got `{slug}`)"
        )));
    }
    let dir =
        storage::reports_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?;
    Ok(dir.join(format!("{slug}.json")))
}

pub async fn get_report(Path(name): Path<String>) -> Result<Json<Value>, AppError> {
    let path = resolve_path(&name)?;
    if !path.exists() {
        return Err(AppError::NotFound(format!("report `{name}` not found")));
    }
    let value = storage::read_json(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(value))
}

pub async fn put_report(
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<ReportSummary>, AppError> {
    if body.get("runId").is_none() {
        return Err(AppError::BadRequest("missing `runId` field".into()));
    }
    if body.get("steps").is_none() {
        return Err(AppError::BadRequest("missing `steps` field".into()));
    }
    let path = resolve_path(&name)?;
    storage::write_json(&path, &body).map_err(|e| AppError::Internal(e.to_string()))?;
    let metadata = std::fs::metadata(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(Json(lift_summary(
        &name,
        storage::JsonFile {
            name: name.clone(),
            size: metadata.len(),
            modified_ms,
        },
        &body,
    )))
}
