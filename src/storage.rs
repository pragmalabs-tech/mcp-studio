//! On-disk JSON file storage for studio artifacts (tests, reports).
//!
//! Files live alongside `config.json` under `~/.mcp-studio/`. Each artifact is
//! a single JSON file named by a sanitized slug. Designed for git-friendliness
//! and direct user inspection — no database, no migrations.

use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::config;

const MAX_FILENAME_LEN: usize = 64;

pub fn tests_dir() -> Option<PathBuf> {
    config::config_dir().map(|d| d.join("tests"))
}

pub fn reports_dir() -> Option<PathBuf> {
    config::config_dir().map(|d| d.join("reports"))
}

/// Sanitize a user-supplied name into a safe `[a-z0-9_-]+` filename slug.
///
/// Rejects path traversal and absolute paths. Empty / all-stripped input
/// returns `"untitled"` so a slug always exists. Length-capped at
/// `MAX_FILENAME_LEN`. Caller appends `.json`.
pub fn safe_filename(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_dash = false;
    for ch in input.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if (c == '-' || c == '_') && !prev_dash && !out.is_empty() {
            out.push(c);
            prev_dash = true;
        } else if c.is_ascii_whitespace() && !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
        // everything else (slashes, dots, control chars) is stripped
    }
    while out.ends_with('-') || out.ends_with('_') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("untitled");
    }
    if out.len() > MAX_FILENAME_LEN {
        out.truncate(MAX_FILENAME_LEN);
        while out.ends_with('-') || out.ends_with('_') {
            out.pop();
        }
    }
    out
}

#[derive(Serialize)]
pub struct JsonFile {
    pub name: String,
    pub size: u64,
    pub modified_ms: u128,
}

pub fn list_json(dir: &Path) -> io::Result<Vec<JsonFile>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let metadata = entry.metadata()?;
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        out.push(JsonFile {
            name: stem.to_string(),
            size: metadata.len(),
            modified_ms,
        });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

pub fn read_json(path: &Path) -> io::Result<serde_json::Value> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(io::Error::other)
}

pub fn write_json(path: &Path, value: &serde_json::Value) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    std::fs::write(path, bytes)
}

pub fn delete_file(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugifies_basic_input() {
        assert_eq!(safe_filename("Search Flow"), "search-flow");
        assert_eq!(safe_filename("My Test #1"), "my-test-1");
        assert_eq!(safe_filename("hello_world"), "hello_world");
    }

    #[test]
    fn rejects_traversal() {
        assert_eq!(safe_filename("../etc/passwd"), "etcpasswd");
        assert_eq!(safe_filename("/absolute"), "absolute");
        assert_eq!(safe_filename("..\\windows"), "windows");
    }

    #[test]
    fn collapses_separators() {
        assert_eq!(safe_filename("a   b---c"), "a-b-c");
        assert_eq!(safe_filename("---trim---"), "trim");
    }

    #[test]
    fn empty_falls_back_to_untitled() {
        assert_eq!(safe_filename(""), "untitled");
        assert_eq!(safe_filename("///"), "untitled");
        assert_eq!(safe_filename("   "), "untitled");
    }

    #[test]
    fn enforces_length_cap() {
        let long = "a".repeat(200);
        let slug = safe_filename(&long);
        assert!(slug.len() <= MAX_FILENAME_LEN);
    }

    #[test]
    fn lowercases_input() {
        assert_eq!(safe_filename("CamelCaseName"), "camelcasename");
    }
}
