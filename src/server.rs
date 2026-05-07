use axum::Router;
use axum::routing::post;
use tower_http::trace::TraceLayer;

pub fn router() -> Router {
    Router::new()
        .route("/api/mcp-proxy", post(crate::proxy::handler))
        .fallback(crate::assets::handler)
        .layer(TraceLayer::new_for_http())
}
