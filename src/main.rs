mod action_log;
mod assets;
mod cloud;
mod config;
mod forwarding;
mod proxy;
mod server;
mod tunnel;

use std::sync::Arc;

use clap::{Parser, Subcommand};
use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

const BIND_ADDR: &str = "127.0.0.1:7777";
const PUBLIC_URL: &str = "http://localhost:7777";

#[derive(Parser)]
#[command(
    name = "mcp-studio",
    version,
    about = "A local studio to debug MCP Servers and MCP Applications"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Start Studio and open it in your browser.
    Open {
        /// MCP server URL to preselect (optional).
        url: Option<String>,
    },
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Open { url } => run_open(url).await,
    }
}

async fn run_open(preselect: Option<String>) {
    let listener = match tokio::net::TcpListener::bind(BIND_ADDR).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("error: failed to bind on {BIND_ADDR}: {e}");
            std::process::exit(1);
        }
    };

    let target = match preselect {
        Some(u) if !u.is_empty() => format!("{PUBLIC_URL}/?proxy={}", urlencoding::encode(&u)),
        _ => format!("{PUBLIC_URL}/"),
    };

    let state = server::AppState {
        config: Arc::new(RwLock::new(config::load())),
        tunnel: Arc::new(tunnel::TunnelState::new()),
        action_log: action_log::channel(),
    };

    println!("Studio listening on {PUBLIC_URL}");
    println!("Opening {target}");
    if let Err(e) = open::that(&target) {
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
