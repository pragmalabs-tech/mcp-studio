//! Calls to api.mcpr.app for cloud sign-in (email + 6-digit code).

use serde::{Deserialize, Serialize};

const DEFAULT_BASE: &str = "https://api.mcpr.app";

pub fn default_base() -> String {
    std::env::var("MCP_STUDIO_CLOUD_URL").unwrap_or_else(|_| DEFAULT_BASE.to_string())
}

pub struct CloudClient {
    http: reqwest::Client,
    base: String,
}

#[derive(Serialize)]
struct LoginReq<'a> {
    email: &'a str,
}

#[derive(Deserialize, Serialize)]
pub struct LoginAck {
    pub request_id: String,
}

#[derive(Serialize)]
struct VerifyReq<'a> {
    request_id: &'a str,
    code: &'a str,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct VerifyAck {
    pub token: String,
    pub user: User,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub slug: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct TunnelToken {
    pub id: String,
    pub token: String,
    pub name: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Endpoint {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
struct CreateTokenReq<'a> {
    name: Option<&'a str>,
}

#[derive(thiserror::Error, Debug)]
pub enum CloudError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("HTTP {status}: {message}")]
    Http { status: u16, message: String },
}

impl CloudClient {
    pub fn new(base: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("failed to build cloud http client"),
            base: base.trim_end_matches('/').to_string(),
        }
    }

    pub async fn login(&self, email: &str) -> Result<LoginAck, CloudError> {
        let resp = self
            .http
            .post(format!("{}/api/auth/cli/login", self.base))
            .json(&LoginReq { email })
            .send()
            .await?;
        check_ok(resp)
            .await?
            .json::<LoginAck>()
            .await
            .map_err(Into::into)
    }

    pub async fn verify(&self, request_id: &str, code: &str) -> Result<VerifyAck, CloudError> {
        let resp = self
            .http
            .post(format!("{}/api/auth/cli/verify", self.base))
            .json(&VerifyReq { request_id, code })
            .send()
            .await?;
        check_ok(resp)
            .await?
            .json::<VerifyAck>()
            .await
            .map_err(Into::into)
    }

    #[allow(dead_code)] // reserved for future JWT validation on startup
    pub async fn me(&self, jwt: &str) -> Result<User, CloudError> {
        let resp = self
            .http
            .get(format!("{}/api/auth/me", self.base))
            .bearer_auth(jwt)
            .send()
            .await?;
        check_ok(resp)
            .await?
            .json::<User>()
            .await
            .map_err(Into::into)
    }

    pub async fn list_projects(&self, jwt: &str) -> Result<Vec<Project>, CloudError> {
        let resp = self
            .http
            .get(format!("{}/api/projects", self.base))
            .bearer_auth(jwt)
            .send()
            .await?;
        check_ok(resp)
            .await?
            .json::<Vec<Project>>()
            .await
            .map_err(Into::into)
    }

    pub async fn list_endpoints(&self, jwt: &str) -> Result<Vec<Endpoint>, CloudError> {
        let resp = self
            .http
            .get(format!("{}/api/endpoints", self.base))
            .bearer_auth(jwt)
            .send()
            .await?;
        check_ok(resp)
            .await?
            .json::<Vec<Endpoint>>()
            .await
            .map_err(Into::into)
    }

    pub async fn create_project_token(
        &self,
        jwt: &str,
        project_id: &str,
        name: Option<&str>,
    ) -> Result<TunnelToken, CloudError> {
        let resp = self
            .http
            .post(format!("{}/api/projects/{project_id}/tokens", self.base))
            .bearer_auth(jwt)
            .json(&CreateTokenReq { name })
            .send()
            .await?;
        check_ok(resp)
            .await?
            .json::<TunnelToken>()
            .await
            .map_err(Into::into)
    }
}

async fn check_ok(resp: reqwest::Response) -> Result<reqwest::Response, CloudError> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let message = resp.text().await.unwrap_or_default();
    Err(CloudError::Http {
        status: status.as_u16(),
        message,
    })
}
