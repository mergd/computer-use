# computer-control

Computer control MCP server — browser automation via Chrome extension + macOS desktop control via native tools.

## Package Manager

**Use `bun`** — not npm or yarn.

```bash
bun install        # Install deps
bun run build      # Build TypeScript
bun src/cli.ts     # Run from source
```

## CLI Structure

```
computer-control
├── browser                    # Chrome extension mode
│   ├── install                # Setup wizard
│   ├── status                 # Check installation
│   ├── path                   # Print extension dir
│   ├── serve [--skip-permissions]  # Start MCP server
│   └── uninstall              # Remove native host
│
└── mac                        # Native macOS mode
    ├── setup                  # Setup wizard
    ├── status                 # Check dependencies
    └── serve                  # Start MCP server
```

## Key Files

- `src/cli.ts` — CLI entry point
- `src/mcp-server.ts` — Browser MCP server (WebSocket bridge to Chrome extension)
- `src/desktop-server.ts` — macOS MCP server
- `src/desktop-tools.ts` — macOS automation tools (16 tools)
- `src/tool-schemas.ts` — Browser tool schemas
- `src/native-host-entry.ts` — Chrome native messaging host
- `extension/` — Chrome extension source

## Mac Mode Dependencies

- `cliclick` — Mouse/keyboard control (`brew install cliclick`)
- `gifsicle` — GIF creation (`brew install gifsicle`, ~400KB)
- macOS Vision framework — OCR (built-in)
- macOS System Events — Accessibility tree (built-in)

## Mac Mode Permissions

Required per-terminal (Ghostty, iTerm, Terminal, etc.):
- **Accessibility** — Mouse/keyboard control
- **Screen Recording** — Screenshots, OCR
- **Automation** — AppleScript/System Events

Check with: `computer-control mac status`

## Notifications

macOS notifications are **enabled by default** (throttled to 1 per 5 seconds).
Useful when terminal is hidden during automation.

Disable with: `computer-control mac serve --no-notify`

## Testing

```bash
# Test mac tools
bun src/cli.ts mac status

# Start mac server
bun src/cli.ts mac serve

# Start browser server
bun src/cli.ts browser serve --skip-permissions
```

## MCP Config (Claude Code / Cursor)

Browser mode uses HTTP transport — run `computer-control browser serve` separately, then point clients at the URL.
Mac mode uses stdio — clients spawn the process directly.

```json
{
  "mcpServers": {
    "browser": {
      "url": "http://127.0.0.1:62220/mcp"
    },
    "mac": {
      "command": "computer-control",
      "args": ["mac", "serve"]
    }
  }
}
```
