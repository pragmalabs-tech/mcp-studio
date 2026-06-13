#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const os = require("os");

const PLATFORM_MAP = {
  "darwin-arm64": "@pragmalabs/mcp-studio-darwin-arm64",
  "darwin-x64":   "@pragmalabs/mcp-studio-darwin-x64",
  "linux-x64":    "@pragmalabs/mcp-studio-linux-x64",
  "linux-arm64":  "@pragmalabs/mcp-studio-linux-arm64",
};

function getBinaryPath() {
  const key = `${os.platform()}-${os.arch()}`;
  const pkg = PLATFORM_MAP[key];
  if (!pkg) {
    throw new Error(`mcp-studio: unsupported platform ${key}`);
  }
  try {
    return require(pkg);
  } catch {
    throw new Error(`mcp-studio: platform package "${pkg}" not installed. Try reinstalling mcp-studio.`);
  }
}

const result = spawnSync(getBinaryPath(), process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
