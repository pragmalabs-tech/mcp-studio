use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::{MatchedPath, Request, State};
use axum::http::StatusCode;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing::Span;

use crate::action_log;
use crate::cloud::{self, CloudClient};
use crate::config::{self, AuthConfig, Config, TunnelConfig};
use crate::tunnel::{TunnelInfo, TunnelState};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<RwLock<Config>>,
    pub tunnel: Arc<TunnelState>,
    pub action_log: action_log::Sender,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/mcp-proxy", post(crate::proxy::handler))
        .route("/api/auth/status", get(auth_status))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/verify", post(auth_verify))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/tunnel/status", get(tunnel_status))
        .route("/api/tunnel/start", post(tunnel_start))
        .route("/api/tunnel/events", get(tunnel_events))
        .route("/api/tunnel/endpoints", get(tunnel_endpoints))
        .with_state(state)
        .fallback(crate::assets::handler)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|req: &Request| {
                    let path = req
                        .extensions()
                        .get::<MatchedPath>()
                        .map(|m| m.as_str())
                        .unwrap_or_else(|| req.uri().path());
                    tracing::info_span!(
                        "http",
                        method = %req.method(),
                        path,
                        uri = %req.uri(),
                    )
                })
                .on_response(
                    |res: &Response, latency: std::time::Duration, _span: &Span| {
                        let status = res.status();
                        if status.is_server_error() {
                            tracing::error!(status = %status, latency_ms = latency.as_millis() as u64, "5xx response");
                        } else if status.is_client_error() {
                            tracing::warn!(status = %status, latency_ms = latency.as_millis() as u64, "4xx response");
                        }
                    },
                ),
        )
}

// ── auth routes ───────────────────────────────────────────────────────────

#[derive(Serialize)]
struct AuthStatus {
    email: Option<String>,
}

async fn auth_status(State(s): State<AppState>) -> Json<AuthStatus> {
    let cfg = s.config.read().await;
    Json(AuthStatus {
        email: cfg.auth.as_ref().map(|a| a.email.clone()),
    })
}

#[derive(Deserialize)]
struct LoginReq {
    email: String,
}

async fn auth_login(Json(req): Json<LoginReq>) -> Result<Json<cloud::LoginAck>, AppError> {
    let cloud = CloudClient::new(&cloud::default_base());
    let ack = cloud.login(&req.email).await.map_err(AppError::from)?;
    Ok(Json(ack))
}

#[derive(Deserialize)]
struct VerifyReq {
    request_id: String,
    code: String,
}

#[derive(Serialize)]
struct VerifyResp {
    email: String,
}

async fn auth_verify(
    State(s): State<AppState>,
    Json(req): Json<VerifyReq>,
) -> Result<Json<VerifyResp>, AppError> {
    let cloud_url = cloud::default_base();
    let cloud = CloudClient::new(&cloud_url);
    let ack = cloud.verify(&req.request_id, &req.code).await?;

    let mut cfg = s.config.write().await;
    cfg.auth = Some(AuthConfig {
        jwt: ack.token,
        email: ack.user.email.clone(),
        cloud_url,
        tunnel_token: None,
    });
    config::save(&cfg).map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(VerifyResp {
        email: ack.user.email,
    }))
}

async fn auth_logout(State(s): State<AppState>) -> StatusCode {
    let mut cfg = s.config.write().await;
    cfg.auth = None;
    let _ = config::save(&cfg);
    StatusCode::NO_CONTENT
}

// ── tunnel routes ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct TunnelStatusResp {
    active: bool,
    info: Option<TunnelInfo>,
}

async fn tunnel_status(State(s): State<AppState>) -> Json<TunnelStatusResp> {
    let info = s.tunnel.current().await;
    Json(TunnelStatusResp {
        active: info.is_some(),
        info,
    })
}

async fn tunnel_endpoints(
    State(s): State<AppState>,
) -> Result<Json<Vec<cloud::Endpoint>>, AppError> {
    let (jwt, cloud_url) = {
        let cfg = s.config.read().await;
        let auth = cfg.auth.as_ref().ok_or(AppError::Unauthorized)?;
        (auth.jwt.clone(), auth.cloud_url.clone())
    };
    let cloud = CloudClient::new(&cloud_url);
    Ok(Json(cloud.list_endpoints(&jwt).await?))
}

#[derive(Deserialize)]
struct StartReq {
    /// Subdomain to claim. None = random subdomain assigned by relay.
    subdomain: Option<String>,
    /// MCP server URL the tunnel should forward to.
    mcp_url: String,
}

const RELAY_URL: &str = "https://tunnel.mcpr.app";

async fn tunnel_start(
    State(s): State<AppState>,
    Json(req): Json<StartReq>,
) -> Result<Json<TunnelInfo>, AppError> {
    if !req.mcp_url.starts_with("http://") && !req.mcp_url.starts_with("https://") {
        return Err(AppError::Internal(format!(
            "MCP server URL must start with http:// or https:// (got `{}`)",
            req.mcp_url
        )));
    }

    let tunnel_token = ensure_tunnel_token(&s).await?;

    let info = s
        .tunnel
        .start(
            &tunnel_token,
            RELAY_URL,
            req.subdomain.as_deref(),
            req.mcp_url,
            s.action_log.clone(),
        )
        .await
        .map_err(AppError::Internal)?;

    let mut cfg = s.config.write().await;
    cfg.tunnel = Some(TunnelConfig {
        last_subdomain: req.subdomain,
    });
    let _ = config::save(&cfg);

    Ok(Json(info))
}

/// Returns a project-scoped tunnel token for the signed-in user. Reuses the
/// cached token when present; otherwise fetches the user's projects, picks
/// the first one, creates a token, and caches it.
async fn ensure_tunnel_token(s: &AppState) -> Result<String, AppError> {
    {
        let cfg = s.config.read().await;
        let auth = cfg.auth.as_ref().ok_or(AppError::Unauthorized)?;
        if let Some(token) = auth.tunnel_token.as_deref()
            && !token.is_empty()
        {
            return Ok(token.to_string());
        }
    }

    let (jwt, cloud_url) = {
        let cfg = s.config.read().await;
        let auth = cfg.auth.as_ref().ok_or(AppError::Unauthorized)?;
        (auth.jwt.clone(), auth.cloud_url.clone())
    };

    let cloud = CloudClient::new(&cloud_url);
    let projects = cloud.list_projects(&jwt).await?;
    let project = projects.first().ok_or_else(|| {
        AppError::Internal(
            "No project found on your cloud account. Create one at cloud.mcpr.app first.".into(),
        )
    })?;

    let token = cloud
        .create_project_token(&jwt, &project.id, Some("mcp-studio"))
        .await?;

    let mut cfg = s.config.write().await;
    if let Some(auth) = cfg.auth.as_mut() {
        auth.tunnel_token = Some(token.token.clone());
    }
    config::save(&cfg).map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(token.token)
}

async fn tunnel_events(
    State(s): State<AppState>,
) -> Sse<impl futures::Stream<Item = Result<SseEvent, std::convert::Infallible>>> {
    let mut rx = s.action_log.subscribe();
    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    if let Ok(ev) = SseEvent::default().json_data(&ev) {
                        yield Ok(ev);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ── error type ─────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug)]
enum AppError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("cloud: {0}")]
    Cloud(#[from] cloud::CloudError),
    #[error("internal: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "sign in required".to_string()),
            AppError::Cloud(cloud::CloudError::Http { status, message }) => (
                StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY),
                message.clone(),
            ),
            AppError::Cloud(e) => (StatusCode::BAD_GATEWAY, e.to_string()),
            AppError::Internal(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.clone()),
        };
        if status.is_server_error() {
            tracing::error!(error = %self, "request handler failed");
        }
        let body = serde_json::json!({ "error": message });
        (status, Json(body)).into_response()
    }
}
