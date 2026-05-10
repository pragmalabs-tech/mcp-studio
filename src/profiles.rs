//! Persistent profile catalog at `~/.mcp-studio/profiles.json`.
//!
//! A profile is a named MCP server target the user can return to across runs,
//! with the auth credentials needed to talk to that server. Storing auth here
//! enables multiple identities for the same origin (e.g. prod-admin vs
//! prod-readonly). OAuth tokens stay origin-scoped in browser localStorage
//! because the redirect flow has no profile context after callback; the
//! `Oauth` variant is a marker that tells the auth panel which UI to show.

use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Deserializer, Serialize};

use crate::config;
use crate::server::{AppError, AppState};
use crate::storage;

/// Auth variants a profile can carry. Tagged enum keeps invalid combinations
/// (e.g. method=bearer with a custom_headers payload) unrepresentable.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "method", rename_all = "lowercase")]
pub enum ProfileAuth {
    None,
    Bearer { token: String },
    Custom { headers: BTreeMap<String, String> },
    Oauth,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub server_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<ProfileAuth>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct ProfilesFile {
    #[serde(default)]
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub active_id: Option<String>,
}

fn profiles_path() -> Option<PathBuf> {
    config::config_dir().map(|d| d.join("profiles.json"))
}

fn random_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("p_{:x}", nanos)
}

pub fn load() -> ProfilesFile {
    let Some(path) = profiles_path() else {
        return ProfilesFile::default();
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return ProfilesFile::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save(file: &ProfilesFile) -> io::Result<()> {
    let dir = config::config_dir().ok_or_else(|| io::Error::other("no home directory"))?;
    let path = dir.join("profiles.json");
    let bytes = serde_json::to_vec_pretty(file).map_err(io::Error::other)?;
    storage::write_secure(&path, &bytes)
}

/// Ensure at least one profile exists. Returns the file with a `default`
/// profile inserted (and marked active) if the catalog was empty.
fn ensure_default(mut file: ProfilesFile) -> ProfilesFile {
    if file.profiles.is_empty() {
        let default = Profile {
            id: random_id(),
            name: "default".into(),
            server_url: String::new(),
            auth: None,
        };
        file.active_id = Some(default.id.clone());
        file.profiles.push(default);
    } else if file.active_id.is_none() {
        file.active_id = file.profiles.first().map(|p| p.id.clone());
    }
    file
}

#[derive(Serialize)]
pub struct ProfilesResponse {
    pub profiles: Vec<Profile>,
    pub active_id: Option<String>,
}

pub async fn list_profiles(State(_): State<AppState>) -> Result<Json<ProfilesResponse>, AppError> {
    let file = ensure_default(load());
    save(&file).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(ProfilesResponse {
        profiles: file.profiles,
        active_id: file.active_id,
    }))
}

#[derive(Deserialize)]
pub struct CreateProfileReq {
    pub name: String,
    #[serde(default)]
    pub server_url: String,
    #[serde(default)]
    pub auth: Option<ProfileAuth>,
}

pub async fn create_profile(
    State(_): State<AppState>,
    Json(req): Json<CreateProfileReq>,
) -> Result<Json<Profile>, AppError> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    let mut file = ensure_default(load());
    let profile = Profile {
        id: random_id(),
        name,
        server_url: req.server_url.trim().to_string(),
        auth: req.auth,
    };
    file.profiles.push(profile.clone());
    save(&file).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(profile))
}

/// `auth: None` means "leave alone"; `auth: Some(None)` means "clear it".
/// `deserialize_some` lets us distinguish a missing field from explicit null.
fn deserialize_some<'de, T, D>(deserializer: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
pub struct UpdateProfileReq {
    pub name: Option<String>,
    pub server_url: Option<String>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub auth: Option<Option<ProfileAuth>>,
}

pub async fn update_profile(
    State(_): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateProfileReq>,
) -> Result<Json<Profile>, AppError> {
    let mut file = ensure_default(load());
    let profile = file
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("profile `{id}` not found")))?;
    if let Some(name) = req.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
        profile.name = trimmed.to_string();
    }
    if let Some(url) = req.server_url {
        profile.server_url = url.trim().to_string();
    }
    if let Some(auth) = req.auth {
        profile.auth = auth;
    }
    let updated = profile.clone();
    save(&file).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(updated))
}

pub async fn delete_profile(
    State(_): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut file = ensure_default(load());
    if file.profiles.len() <= 1 {
        return Err(AppError::BadRequest(
            "cannot delete the last profile".into(),
        ));
    }
    let before = file.profiles.len();
    file.profiles.retain(|p| p.id != id);
    if file.profiles.len() == before {
        return Err(AppError::NotFound(format!("profile `{id}` not found")));
    }
    if file.active_id.as_deref() == Some(id.as_str()) {
        file.active_id = file.profiles.first().map(|p| p.id.clone());
    }
    save(&file).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn activate_profile(
    State(_): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ProfilesResponse>, AppError> {
    let mut file = ensure_default(load());
    if !file.profiles.iter().any(|p| p.id == id) {
        return Err(AppError::NotFound(format!("profile `{id}` not found")));
    }
    file.active_id = Some(id);
    save(&file).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(ProfilesResponse {
        profiles: file.profiles,
        active_id: file.active_id,
    }))
}
