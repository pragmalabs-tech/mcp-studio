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

use clap::Parser;
use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

const BIND_ADDR: &str = "127.0.0.1:7777";
pub const PUBLIC_URL: &str = "http://localhost:7777";

#[derive(Parser)]
#[command(
    version,
    about = "A local studio to debug MCP servers and applications"
)]
struct Args {
    /// Directory containing test definitions
    #[arg(long)]
    tests_dir: Option<std::path::PathBuf>,

    /// Run tests headlessly and exit
    #[arg(long)]
    headless: bool,

    /// Test IDs to run in headless mode (repeatable)
    #[arg(long = "test-id")]
    test_ids: Vec<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    run(args).await;
}

async fn run(args: Args) {
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
        tests_dir: args.tests_dir,
    };

    println!("Studio listening on {PUBLIC_URL}");

    if args.headless {
        tokio::task::spawn(async move {
            if let Err(e) = axum::serve(listener, server::router(state)).await {
                eprintln!("server error: {e}");
            }
        });
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let rt = tokio::runtime::Handle::current();
        let handle =
            std::thread::spawn(move || rt.block_on(headless::run_headless_tests(args.test_ids)));
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
