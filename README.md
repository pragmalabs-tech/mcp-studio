# mcp-studio

A local studio to debug MCP servers and MCP applications.

## Demo

[![MCP Studio demo](https://img.youtube.com/vi/vCbNQKFpN78/maxresdefault.jpg)](https://www.youtube.com/watch?v=vCbNQKFpN78)

## Install

```sh
npx @pragmalabs/mcp-studio open http://localhost:3000
```

Other install options (curl, Homebrew, build from source): [studio.pragmalabs.tech/docs](https://studio.pragmalabs.tech/docs)

---

## Use cases

### Call MCP tools

Connect to any MCP server and call its tools with custom arguments. Responses appear instantly in the log.

![Call MCP tools](https://raw.githubusercontent.com/pragmalabs-tech/mcp-studio/main/website/public/screenshots/mcp-studio-execute-tool.gif)

---

### Read MCP resources

Browse and read resources from your MCP server. Inject test data to preview how widgets respond.

![Read MCP resources](https://raw.githubusercontent.com/pragmalabs-tech/mcp-studio/main/website/public/screenshots/mcp-studio-resource-ui-read.gif)

---

### Preview and interact with widgets

See your MCP app widget render live in the browser. Switch between ChatGPT, Claude, desktop, and mobile viewports.

![Widget preview](https://raw.githubusercontent.com/pragmalabs-tech/mcp-studio/main/website/public/screenshots/mcp-studio-interactive-with-widget.gif)

---

### Record and replay E2E tests

Hit Record, use your app normally, then stop. The session becomes a named, reproducible test. Run it after every change.

![Replay test](https://raw.githubusercontent.com/pragmalabs-tech/mcp-studio/main/website/public/screenshots/mcp-studio-replay-test.gif)

---

### Debug OAuth 2.1

MCP Studio runs the full OAuth 2.1 + PKCE flow automatically and shows a live log of every step: discovery, registration, authorization, and token exchange.

![OAuth debug](https://raw.githubusercontent.com/pragmalabs-tech/mcp-studio/main/website/public/screenshots/mcp-studio-auth.gif)

---

## License

[MIT](./LICENSE)
