# browser-mcp TODO

## Architecture

Forked Chrome extension (from Claude's "Claude in Chrome") that provides accessibility tree parsing, element interaction, screenshots, and browser automation. Connected via Chrome native messaging to a local CLI that exposes these tools as an MCP server for any client (Cursor, Claude Code, etc.).

```
┌─────────────┐  MCP (stdio)  ┌──────────────┐  Native Msg  ┌──────────────────┐
│  Cursor /   │◀────────────▶│ browser-mcp  │◀───────────▶│ Chrome Extension │
│  any client │              │ serve        │    stdio     │ (a11y tree,      │
└─────────────┘              └──────────────┘              │  screenshots,    │
                                                           │  element interact)│
                                                           └──────────────────┘
```

## Done

- [x] Fork Claude Chrome extension, rebrand to browser-mcp
- [x] Patch native messaging host name to `com.browsermcp.native_host`
- [x] Native messaging codec (`src/native-messaging.ts`)
- [x] Native host bridge (`src/host.ts`) — speaks Chrome native messaging protocol
- [x] Install/uninstall helpers (`src/install.ts`)
- [x] CLI with interactive setup wizard (`src/cli.ts`)
  - `browser-mcp install` — guided onboarding (load extension, enter ID, register host)
  - `browser-mcp status` — check installation
  - `browser-mcp path` — print extension dir for Load unpacked
  - `browser-mcp uninstall` — remove native host registration

## Next up

### MCP serve command

`browser-mcp serve` starts an MCP stdio server wrapping `BrowserHost`, exposing browser tools to any MCP client. This is the main deliverable.

**Tool inventory** — match Claude's `mcp__claude-in-chrome__*` interface:

Core tools (must have):
- [ ] `read_page` — accessibility tree (filter: all/interactive, depth, ref_id)
- [ ] `find` — natural language element search (query + tabId)
- [ ] `computer` — mouse/keyboard/screenshot (left_click, type, screenshot, scroll, key, hover, zoom, scroll_to, drag, etc.)
- [ ] `navigate` — go to URL or forward/back
- [ ] `javascript_tool` — eval JS in page context
- [ ] `form_input` — set form values by ref_id (string/boolean/number)
- [ ] `get_page_text` — extract article text from page
- [ ] `tabs_context_mcp` — get tab group info, list available tabs
- [ ] `tabs_create_mcp` — create new tab in group

Important tools:
- [ ] `read_console_messages` — browser console (pattern filter, limit, onlyErrors)
- [ ] `read_network_requests` — XHR/fetch log (urlPattern filter, limit)
- [ ] `resize_window` — set viewport dimensions
- [ ] `upload_image` — upload screenshot/image to file input or drag target

Nice to have:
- [ ] `gif_creator` — start/stop recording, export GIF with overlays

Skip (Claude-specific):
- ~~`update_plan`~~ — Claude permission approval UI
- ~~`shortcuts_list`~~ — Claude shortcuts/workflows
- ~~`shortcuts_execute`~~ — Claude shortcut runner

**Implementation:**
- [ ] MCP JSON-RPC codec (stdio, `jsonrpc: "2.0"`, `tools/list`, `tools/call`)
- [ ] Tool schema definitions (JSON Schema for each tool's input)
- [ ] Wire `tools/call` → `host.exec(toolName, args)` → extension
- [ ] Handle MCP `initialize` handshake

### Permission bypass ✅

Patched the minified extension JS to support a runtime `self.__skipPermissions` flag:
- [x] `mcp-tools.js`: `permissionManager` checks `self.__skipPermissions` before denying
- [x] `mcp-tools.js`: `onPermissionRequired` auto-approves when flag is set
- [x] `service-worker.js`: handles `set_skip_permissions` message from native host
- [x] `host.ts`: sends `set_skip_permissions` on connection when `skipPermissions` option is set
- [x] `cli.ts`: `browser-mcp serve --skip-permissions` flag
- [x] `native-host-entry.ts`: supports `--skip-permissions` arg and `BROWSER_MCP_SKIP_PERMISSIONS=1` env var

### Strip Claude-specific UI

- [ ] Remove sidepanel Claude.ai login flow
- [ ] Remove claude.ai content script
- [ ] Simplify options page (just show connection status + settings)

## Future

- [ ] **Cursor integration docs** — document adding `browser-mcp serve` as MCP server in Cursor config
- [ ] **npm publish** — `npm i -g browser-mcp`
- [ ] **Test harness** — unit tests for native messaging codec and host protocol
- [ ] **Extension cleanup** — rebuild from source (deminify/rewrite) for full control
- [ ] **Multi-tab support** — track multiple connected tabs, route tool calls by tab ID
- [ ] **WebSocket mode** — extension connects to local WS server (like clawdbot's CDP relay) as alternative to native messaging, letting any process connect without host registration
- [ ] **Headless mode** — launch headless Chrome with the extension pre-loaded for CI/scripts
