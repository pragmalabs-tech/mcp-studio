use std::path::Path;
use std::process::Command;

fn main() {
    // Re-run when frontend source files change. cargo skips this script
    // entirely when only Rust files changed.
    println!("cargo:rerun-if-changed=frontend/src");
    println!("cargo:rerun-if-changed=frontend/index.html");
    println!("cargo:rerun-if-changed=frontend/package.json");
    println!("cargo:rerun-if-changed=frontend/pnpm-lock.yaml");
    println!("cargo:rerun-if-changed=frontend/vite.config.ts");
    println!("cargo:rerun-if-changed=frontend/tsconfig.json");
    println!("cargo:rerun-if-changed=frontend/tsconfig.app.json");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=MCP_STUDIO_SKIP_FRONTEND_BUILD");

    let dist_index = Path::new("frontend/dist/index.html");

    // CI / release pipeline can pre-build the frontend separately and skip
    // this step. Set MCP_STUDIO_SKIP_FRONTEND_BUILD=1 to opt out.
    if std::env::var("MCP_STUDIO_SKIP_FRONTEND_BUILD").is_ok() {
        if !dist_index.exists() {
            panic!(
                "MCP_STUDIO_SKIP_FRONTEND_BUILD set but frontend/dist/index.html does not exist."
            );
        }
        return;
    }

    // Local dev: invoke pnpm. If pnpm isn't installed, fall back to whatever
    // is already in dist/ (with a warning) instead of failing.
    eprintln!("cargo:warning=building frontend (pnpm build)...");
    let result = Command::new("pnpm")
        .args(["build"])
        .current_dir("frontend")
        .status();

    match result {
        Ok(status) if status.success() => {}
        Ok(status) => panic!("pnpm build failed (exit code {:?})", status.code()),
        Err(e) => {
            if dist_index.exists() {
                eprintln!("cargo:warning=pnpm not available ({e}); using existing frontend/dist.");
            } else {
                panic!(
                    "pnpm not available ({e}) and frontend/dist/index.html does not exist. \
                     Install pnpm, or run `pnpm install && pnpm build` in frontend/ first."
                );
            }
        }
    }
}
