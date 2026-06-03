#!/usr/bin/env sh
# Installer for mcp-studio. Detects OS/arch, downloads the matching tarball
# from dl.pragmalabs.tech, verifies sha256, extracts to ~/.local/bin.
#
# Usage:
#   curl -fsSL https://dl.pragmalabs.tech/mcp-studio/install.sh | sh
#
# Environment overrides:
#   MCP_STUDIO_VERSION=0.1.3        pin a specific version
#   MCP_STUDIO_INSTALL_DIR=/usr/local/bin
set -eu

BASE="https://dl.pragmalabs.tech/mcp-studio"
INSTALL_DIR="${MCP_STUDIO_INSTALL_DIR:-$HOME/.local/bin}"

uname_s=$(uname -s)
uname_m=$(uname -m)
case "$uname_s-$uname_m" in
  Darwin-arm64)   target="aarch64-apple-darwin" ;;
  Darwin-x86_64)  target="x86_64-apple-darwin" ;;
  Linux-x86_64)   target="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64)  target="aarch64-unknown-linux-gnu" ;;
  *)
    echo "error: unsupported platform $uname_s-$uname_m" >&2
    exit 1
    ;;
esac

version="${MCP_STUDIO_VERSION:-$(curl -fsSL "$BASE/latest")}"
if [ -z "$version" ]; then
  echo "error: could not determine latest version" >&2
  exit 1
fi

archive="mcp-studio-${target}.tar.gz"
url="$BASE/v${version}/${archive}"
sha_url="$url.sha256"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading mcp-studio v${version} for ${target}"
curl -fsSL "$url"     -o "$tmp/$archive"
curl -fsSL "$sha_url" -o "$tmp/$archive.sha256"

cd "$tmp"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c "$archive.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c "$archive.sha256"
else
  echo "error: no sha256sum or shasum found" >&2
  exit 1
fi

tar -xzf "$archive"
mkdir -p "$INSTALL_DIR"
mv mcp-studio "$INSTALL_DIR/mcp-studio"
chmod +x "$INSTALL_DIR/mcp-studio"

echo
echo "Installed mcp-studio v${version} to $INSTALL_DIR/mcp-studio"
case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo "Run:  mcp-studio"
    ;;
  *)
    echo
    echo "$INSTALL_DIR is not in your PATH. Add this to your shell rc file:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
