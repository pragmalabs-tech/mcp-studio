mod action_log;
mod assets;
mod cloud;
mod config;
mod forwarding;
mod profiles;
mod proxy;
mod reports_api;
mod run_results_api;
mod server;
mod storage;
mod tests_api;
mod tunnel;

use std::sync::Arc;

use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

const BIND_ADDR: &str = "127.0.0.1:7777";
const PUBLIC_URL: &str = "http://localhost:7777";

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    run().await;
}

async fn run() {
    let listener = match tokio::net::TcpListener::bind(BIND_ADDR).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("error: failed to bind on {BIND_ADDR}: {e}");
            std::process::exit(1);
        }
    };

    let state = server::AppState {
        config: Arc::new(RwLock::new(config::load())),
        tunnel: Arc::new(tunnel::TunnelState::new()),
        action_log: action_log::channel(),
    };

    println!("Studio listening on {PUBLIC_URL}");
    if let Err(e) = open::that(PUBLIC_URL) {
        eprintln!("warning: could not open browser: {e}");
    }

    if let Err(e) = axum::serve(listener, server::router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        eprintln!("server error: {e}");
        std::process::exit(1);
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
