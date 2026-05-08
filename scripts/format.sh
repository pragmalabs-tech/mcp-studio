#!/usr/bin/env bash
# Format and lint the entire repo.
#   ./scripts/format.sh           write changes
#   ./scripts/format.sh --check   verify only, exit 1 on diff
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mode="${1:-write}"

case "$mode" in
  write)
    echo "▶ frontend: prettier --write"
    (cd frontend && pnpm format)
    echo "▶ backend: cargo fmt"
    cargo fmt
    echo "▶ backend: cargo clippy -- -D warnings"
    cargo clippy --all-targets -- -D warnings
    ;;
  --check|check)
    echo "▶ frontend: prettier --check"
    (cd frontend && pnpm format:check)
    echo "▶ backend: cargo fmt --check"
    cargo fmt -- --check
    echo "▶ backend: cargo clippy -- -D warnings"
    cargo clippy --all-targets -- -D warnings
    ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 2
    ;;
esac

echo "✓ done"
