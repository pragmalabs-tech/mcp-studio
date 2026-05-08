# mcp-studio

A local studio to debug MCP Servers and MCP Applications.

A single binary that serves a browser UI on `localhost:7777`, proxies MCP
JSON-RPC server-side (so cross-origin servers work without CORS gymnastics),
and runs on your machine (so localhost MCP servers work).

## Install

```
curl -fsSL https://dl.pragmalabs.tech/mcp-studio/install.sh | sh
```

Installs `mcp-studio` to `~/.local/bin`. Override with `MCP_STUDIO_INSTALL_DIR=/usr/local/bin`. Pin a version with `MCP_STUDIO_VERSION=0.1.3`.

Supported platforms: macOS (Apple Silicon, Intel), Linux (x86_64, aarch64).

## Quickstart

```
mcp-studio open http://localhost:3000
```

Starts the local server, opens your browser, and preselects the given MCP URL.

```
mcp-studio open                                # no URL: paste one in the UI
mcp-studio open https://example.tunnel.mcpr.app
```

## Build from source

```
cd frontend && pnpm install && pnpm build
cd .. && cargo build --release
./target/release/mcp-studio open
```

## Features

- Tools and resources explorer
- Apps SDK widget preview with CSP sandbox enforcement
- OAuth 2.1 + PKCE debugger
- Action log capturing every MCP call and widget event
- Mock data editor for widget development

## License

Released into the public domain via the [Unlicense](./UNLICENSE).
