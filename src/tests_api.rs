//! HTTP handlers for the studio's test catalog at
//! `~/.mcp-studio/tests/<slug>.json`.
//!
//! Files on disk are opaque JSON — the frontend owns the schema (today
//! that's `SavedTest` from `lib/tests/storage.ts`). Backend validation
//! is intentionally absent so the storage layer doesn't have to evolve
//! every time the frontend tweaks its shape.

use axum::Json;
use axum::extract::Path;
use axum::http::StatusCode;
use serde::Serialize;
use serde_json::Value;

use crate::server::AppError;
use crate::storage;

#[derive(Serialize)]
pub struct TestSummary {
    pub name: String,
    pub size: u64,
    pub modified_ms: u128,
    /// Best-effort fields lifted out of the body for catalog UX. The
    /// backend doesn't enforce any of these — they're just convenience
    /// projections that save the catalog UI a follow-up GET.
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub created_at: Option<String>,
}

fn lift_summary(name: &str, file: storage::JsonFile, value: &Value) -> TestSummary {
    let display_name = value
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let description = value
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let created_at = value
        .get("createdAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    TestSummary {
        name: name.to_string(),
        size: file.size,
        modified_ms: file.modified_ms,
        display_name,
        description,
        created_at,
    }
}

pub async fn list_tests() -> Result<Json<Vec<TestSummary>>, AppError> {
    let dir = storage::tests_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?;
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
            "invalid test name `{name}` (must match safe slug, got `{slug}`)"
        )));
    }
    let dir = storage::tests_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?;
    Ok(dir.join(format!("{slug}.json")))
}

pub async fn get_test(Path(name): Path<String>) -> Result<Json<Value>, AppError> {
    let path = resolve_path(&name)?;
    if !path.exists() {
        return Err(AppError::NotFound(format!("test `{name}` not found")));
    }
    let value = storage::read_json(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(value))
}

pub async fn put_test(
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<TestSummary>, AppError> {
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

pub async fn delete_test(Path(name): Path<String>) -> Result<StatusCode, AppError> {
    let path = resolve_path(&name)?;
    storage::delete_file(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
