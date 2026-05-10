//! Persistent config at `~/.mcp-studio/config.json` (file mode 0600 on unix).
//!
//! Holds the cloud auth JWT and the user's last-used tunnel subdomain so
//! the publish modal can pre-fill it on next launch.

use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Config {
    pub auth: Option<AuthConfig>,
    pub tunnel: Option<TunnelConfig>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthConfig {
    pub jwt: String,
    pub email: String,
    pub cloud_url: String,
    /// Project-scoped token for the tunnel relay. Lazily fetched on first
    /// publish and cached so subsequent publishes are instant.
    #[serde(default)]
    pub tunnel_token: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct TunnelConfig {
    pub last_subdomain: Option<String>,
}

pub fn config_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".mcp-studio"))
}

pub fn config_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("config.json"))
}

pub fn load() -> Config {
    let Some(path) = config_path() else {
        return Config::default();
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Config::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn save(cfg: &Config) -> io::Result<()> {
    let dir = config_dir().ok_or_else(|| io::Error::other("no home directory"))?;
    let path = dir.join("config.json");
    let bytes = serde_json::to_vec_pretty(cfg).map_err(io::Error::other)?;
    crate::storage::write_secure(&path, &bytes)
}
