//! HTTP handlers for the Cue catalog at `~/.mcp-studio/tests/<slug>.json`.
//!
//! Files on disk are Cue JSON (`docs/cue-spec.md`). The frontend translates
//! a Cue into Engine IR before running. Backend validation is structural
//! only; the frontend does deep validation against the spec.

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
    /// Best-effort fields lifted out of the Cue JSON for catalog UX.
    pub display_name: Option<String>,
    pub description: Option<String>,
    /// Cue files don't currently track createdAt; left for future use.
    pub created_at: Option<String>,
    /// Number of `steps[]` declared in the Cue.
    pub total_actions: Option<usize>,
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
    let total_actions = value
        .get("steps")
        .and_then(|t| t.as_array())
        .map(|a| a.len());
    TestSummary {
        name: name.to_string(),
        size: file.size,
        modified_ms: file.modified_ms,
        display_name,
        description,
        created_at,
        total_actions,
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
    // Minimal structural check; deep validation lives in the frontend
    // (`lib/cue/validate.ts`). The backend only ensures the body looks
    // like a Cue at all so we don't accept arbitrary JSON.
    let name_ok = body.get("name").and_then(|v| v.as_str()).is_some();
    let steps_ok = body
        .get("steps")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    if !name_ok || !steps_ok {
        return Err(AppError::BadRequest(
            "expected Cue file with `name` (string) and non-empty `steps` (array)".into(),
        ));
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

pub async fn delete_test(Path(name): Path<String>) -> Result<StatusCode, AppError> {
    let path = resolve_path(&name)?;
    storage::delete_file(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
