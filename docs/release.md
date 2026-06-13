# Release Process

## Before tagging a release

Before pushing a version tag, make sure the npm package versions match the new version. Skipping this causes the CI to publish npm packages with a version mismatch or stale shim.

### 1. Bump Cargo version

Update `version` in `Cargo.toml`:

```toml
[package]
version = "0.3.X"
```

### 2. Bump npm package versions

Update all five `package.json` files to the same version:

```sh
VERSION="0.3.X"

for PKG in mcp-studio mcp-studio-darwin-arm64 mcp-studio-darwin-x64 mcp-studio-linux-x64 mcp-studio-linux-arm64; do
  npm version "$VERSION" --no-git-tag-version --prefix npm/$PKG
done
```

Also make sure `optionalDependencies` in `npm/mcp-studio/package.json` match the new version:

```json
"optionalDependencies": {
  "@pragmalabs/mcp-studio-darwin-arm64": "0.3.X",
  "@pragmalabs/mcp-studio-darwin-x64": "0.3.X",
  "@pragmalabs/mcp-studio-linux-x64": "0.3.X",
  "@pragmalabs/mcp-studio-linux-arm64": "0.3.X"
}
```

### 3. Commit everything

```sh
git add Cargo.toml Cargo.lock npm/
git commit -m "release: v0.3.X"
```

### 4. Tag and push

```sh
git tag v0.3.X
git push && git push --tags
```

CI will then build the binaries, publish to R2, update the Homebrew formula, and publish all npm packages automatically.

---

## What CI does on tag push

1. **build** — compiles binaries for all 4 targets
2. **publish** — uploads tarballs + checksums to R2, updates `latest` pointer and `install.sh`
3. **update-homebrew** — fetches new SHA256s and commits updated formula to `homebrew-mcp-studio`
4. **publish-npm** — downloads binaries from R2, injects them into platform packages, publishes all 5 npm packages

---

## What went wrong in 0.3.39

The npm shim fix (npx fallback download) was written after the `v0.3.39` tag was pushed. CI published 0.3.39 with the old broken shim. The fix had to be manually unpublished and republished.

**Rule: always commit npm changes before tagging.**
