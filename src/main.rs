mod action_log;
mod assets;
mod cloud;
mod config;
mod control;
mod forwarding;
mod headless;
mod jobs;
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
pub const PUBLIC_URL: &str = "http://localhost:7777";

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    run().await;
}

fn parse_tests_dir() -> Option<std::path::PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    let pos = args.iter().position(|a| a == "--tests-dir")?;
    args.get(pos + 1).map(std::path::PathBuf::from)
}

fn parse_headless() -> bool {
    std::env::args().any(|a| a == "--headless")
}

fn parse_test_ids() -> Vec<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut ids = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if let Some(val) = args[i].strip_prefix("--test-id=") {
            ids.push(val.to_string());
        } else if args[i] == "--test-id"
            && let Some(val) = args.get(i + 1)
        {
            ids.push(val.clone());
            i += 1;
        }
        i += 1;
    }
    ids
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
        tests_dir: parse_tests_dir(),
    };

    println!("Studio listening on {PUBLIC_URL}");

    if parse_headless() {
        tokio::task::spawn(async move {
            if let Err(e) = axum::serve(listener, server::router(state)).await {
                eprintln!("server error: {e}");
            }
        });
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let test_ids = parse_test_ids();
        let rt = tokio::runtime::Handle::current();
        let handle =
            std::thread::spawn(move || rt.block_on(headless::run_headless_tests(test_ids)));
        match handle.join() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                eprintln!("headless error: {e}");
                std::process::exit(1);
            }
            Err(_) => {
                eprintln!("headless thread panicked");
                std::process::exit(1);
            }
        }
        return;
    }

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
