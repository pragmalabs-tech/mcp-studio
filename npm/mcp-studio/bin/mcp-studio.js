#!/usr/bin/env node
"use strict";

const { spawnSync, execSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const VERSION = require("../package.json").version;
const BASE_URL = `https://dl.pragmalabs.tech/mcp-studio/v${VERSION}`;

const PLATFORM_MAP = {
  "darwin-arm64": { pkg: "@pragmalabs/mcp-studio-darwin-arm64", target: "aarch64-apple-darwin" },
  "darwin-x64":   { pkg: "@pragmalabs/mcp-studio-darwin-x64",   target: "x86_64-apple-darwin" },
  "linux-x64":    { pkg: "@pragmalabs/mcp-studio-linux-x64",    target: "x86_64-unknown-linux-gnu" },
  "linux-arm64":  { pkg: "@pragmalabs/mcp-studio-linux-arm64",  target: "aarch64-unknown-linux-gnu" },
};

function getBinaryPath() {
  const key = `${os.platform()}-${os.arch()}`;
  const entry = PLATFORM_MAP[key];
  if (!entry) {
    throw new Error(`mcp-studio: unsupported platform ${key}`);
  }

  // Fast path: optional dep installed alongside the package
  try {
    return require(entry.pkg);
  } catch {}

  // Fallback: download binary to ~/.mcp-studio/bin and cache by version
  const cacheDir = path.join(os.homedir(), ".mcp-studio", "bin");
  const binaryPath = path.join(cacheDir, `mcp-studio-${VERSION}`);

  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  const url = `${BASE_URL}/mcp-studio-${entry.target}.tar.gz`;
  process.stderr.write(`Downloading mcp-studio v${VERSION} for ${key}...\n`);
  fs.mkdirSync(cacheDir, { recursive: true });

  execSync(
    `curl -fsSL "${url}" | tar -xz -C "${cacheDir}" mcp-studio && mv "${path.join(cacheDir, "mcp-studio")}" "${binaryPath}"`,
    { stdio: "inherit" }
  );
  fs.chmodSync(binaryPath, 0o755);

  return binaryPath;
}

const result = spawnSync(getBinaryPath(), process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
