use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=frontend/dist");
    if !Path::new("frontend/dist/index.html").exists() {
        panic!(
            "frontend/dist not found. Run `pnpm install && pnpm build` in frontend/ before `cargo build`."
        );
    }
}
