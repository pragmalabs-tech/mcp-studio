#!/usr/bin/env bash
set -eu

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/bump-version.sh <version>"
  echo "Example: ./scripts/bump-version.sh 0.3.41"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Bumping to v${VERSION}..."

# Cargo.toml
sed -i.bak "s/^version = \".*\"/version = \"${VERSION}\"/" "$ROOT/Cargo.toml"
rm -f "$ROOT/Cargo.toml.bak"
echo "  Cargo.toml"

# frontend/package.json
node -e "
  const fs = require('fs');
  const f = '$ROOT/frontend/package.json';
  const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
"
echo "  frontend/package.json"

# npm packages
for PKG in mcp-studio mcp-studio-darwin-arm64 mcp-studio-darwin-x64 mcp-studio-linux-x64 mcp-studio-linux-arm64; do
  npm version "$VERSION" --no-git-tag-version --allow-same-version --prefix "$ROOT/npm/$PKG" > /dev/null
  echo "  npm/$PKG/package.json"
done

# update optionalDependencies in main npm package
node -e "
  const fs = require('fs');
  const f = '$ROOT/npm/mcp-studio/package.json';
  const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const k of Object.keys(pkg.optionalDependencies)) {
    pkg.optionalDependencies[k] = '$VERSION';
  }
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
"
echo "  npm/mcp-studio optionalDependencies"

echo ""
echo "Done. All files bumped to v${VERSION}."
echo ""
echo "Next steps:"
echo "  cargo update -p mcp-studio"
echo "  git add Cargo.toml Cargo.lock frontend/package.json npm/"
echo "  git commit -m \"release: v${VERSION}\""
echo "  git tag v${VERSION} && git push && git push --tags"
