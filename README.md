# Computer Control

MCP server for browser automation and macOS desktop control. Give your AI agent eyes and hands.

## Getting Started

### Browser Mode

Install the CLI and the [Chrome extension](https://chrome.google.com/webstore/detail/computer-control/kenhnnhgbbgkdbedfmijnllgpcognghl), then wire up the native messaging bridge:

```bash
npm i -g computer-control
computer-control browser install
```

The setup wizard walks you through connecting the extension. Once done, add it to your MCP config (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "browser": {
      "command": "computer-control",
      "args": ["browser", "serve", "--skip-permissions"]
    }
  }
}
```

### Mac Mode

Native macOS control — no browser needed. Install deps, run the wizard, and you're set:

```bash
brew install cliclick gifsicle
npm i -g computer-control
computer-control mac setup
```

Grant **Accessibility** and **Screen Recording** permissions to your terminal app when prompted.

```json
{
  "mcpServers": {
    "mac": {
      "command": "computer-control",
      "args": ["mac", "serve"]
    }
  }
}
```

## Tools

### Browser

| Tool | Description |
|------|-------------|
| `computer` | Mouse, keyboard, and screenshots |
| `read_page` | Accessibility tree of page elements |
| `find` | Find elements by natural language |
| `navigate` | Go to URL, back, forward |
| `form_input` | Set form input values |
| `javascript_tool` | Execute JS in page context |
| `get_page_text` | Extract raw text content |
| `tabs_context` | Tab group context |
| `tabs_create` | Open new tab |
| `resize_window` | Resize browser window |
| `gif_creator` | Record browser actions as GIF |
| `upload_image` | Upload image to file input |

### Mac

| Tool | Description |
|------|-------------|
| `screenshot` | Capture screen or region |
| `mouse_click` | Click at coordinates |
| `mouse_move` | Move cursor |
| `mouse_scroll` | Scroll in direction |
| `mouse_drag` | Drag between points |
| `type_text` | Type text at cursor |
| `key_press` | Press key with modifiers |
| `run_applescript` | Execute AppleScript |
| `get_active_window` | Focused window info |
| `list_windows` | List open windows |
| `focus_app` | Bring app to foreground |
| `get_accessibility_tree` | UI element hierarchy |
| `ocr_screen` | Extract text via OCR |
| `find` | Find elements by natural language |
| `gif_start` / `gif_stop` / `gif_export` | Record screen as GIF |

## CLI Reference

```
computer-control browser
  install        Setup wizard (extension + native host)
  status         Check installation
  serve          Start MCP server
  uninstall      Remove native host

computer-control mac
  setup          Setup wizard (deps + permissions)
  status         Check deps & permissions
  serve          Start MCP server
```

## Troubleshooting

**Extension not connecting?**
Run `computer-control browser status` to check the native host registration. Make sure Chrome is running and the extension is enabled. Restart Chrome if needed.

**Permission errors on Mac?**
Add your terminal app to Accessibility and Screen Recording in System Settings → Privacy & Security. Restart the terminal after.

**Port conflict?**
```bash
lsof -i :62222  # WebSocket port
lsof -i :62220  # HTTP port
```

## Development

```bash
git clone https://github.com/mergd/computer-use.git
cd computer-use
bun install
bun run build

# Run from source
bun src/cli.ts browser serve --skip-permissions
bun src/cli.ts mac serve

# Build extension from source
cd extension && ./build.sh
```

## Privacy

See [PRIVACY.md](PRIVACY.md).

## License

MIT
