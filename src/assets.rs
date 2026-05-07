//! Static asset serving for the embedded React frontend.
//!
//! The Vite build output (`frontend/dist/`) is embedded into the binary at
//! compile time via `rust_embed`. Unknown paths fall back to `index.html`
//! for SPA routing (so `/oauth/callback` works without an explicit route).

use axum::body::Body;
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "frontend/dist/"]
struct Assets;

pub async fn handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    serve(path).unwrap_or_else(|| serve("index.html").unwrap_or_else(not_found))
}

fn serve(path: &str) -> Option<Response> {
    let file = Assets::get(path)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    Some(
        Response::builder()
            .header(header::CONTENT_TYPE, mime.as_ref())
            .body(Body::from(file.data.into_owned()))
            .unwrap(),
    )
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "not found").into_response()
}
