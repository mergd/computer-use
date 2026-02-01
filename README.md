# Computer Control

Browser automation and macOS desktop control for AI agents via the Model Context Protocol (MCP).

## Features

**Browser Mode** (Chrome Extension)
- Take screenshots of web pages
- Click, type, scroll, and navigate
- Read page content and accessibility trees
- Execute JavaScript in page context
- Record and export GIF recordings
- Manage tabs and windows

**Mac Mode** (Native macOS)
- Control mouse and keyboard
- Take screenshots and OCR
- Read accessibility trees
- Execute AppleScript
- Record GIF screen captures

## Quick Start

### Option 1: Install from Chrome Web Store (Recommended)

1. **Install the extension** from the [Chrome Web Store](https://chrome.google.com/webstore/detail/computer-control/kenhnnhgbbgkdbedfmijnllgpcognghl)

2. **Install the CLI**
   ```bash
   npm install -g computer-control
   # or
   bun install -g computer-control
   ```

3. **Run the setup wizard**
   ```bash
   computer-control browser install
   ```
   When prompted for the extension ID, enter: `kenhnnhgbbgkdbedfmijnllgpcognghl`

4. **Add to your MCP config** (Claude Code, Cursor, etc.)
   ```json
   {
     "mcpServers": {
       "computer-control-browser": {
         "command": "computer-control",
         "args": ["browser", "serve", "--skip-permissions"]
       }
     }
   }
   ```

5. **Restart your AI assistant** and start automating!

### Option 2: Load Extension from Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/mergd/computer-use.git
   cd computer-use
   bun install
   bun run build
   ```

2. **Build the extension**
   ```bash
   cd extension && ./build.sh
   ```

3. **Load in Chrome**
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist` folder
   - Copy the extension ID (32 lowercase letters)

4. **Run the setup wizard**
   ```bash
   computer-control browser install --extension-id YOUR_EXTENSION_ID
   ```

5. **Add to MCP config** (same as above)

## Mac Mode Setup

For native macOS control (no browser needed):

```bash
# Run the setup wizard
computer-control mac setup

# Check status
computer-control mac status
```

**Requirements:**
- `cliclick` for mouse/keyboard: `brew install cliclick`
- `gifsicle` for GIF recording: `brew install gifsicle`

**macOS Permissions** (grant to your terminal app):
- Accessibility (System Settings → Privacy & Security → Accessibility)
- Screen Recording (System Settings → Privacy & Security → Screen Recording)

**MCP Config:**
```json
{
  "mcpServers": {
    "computer-control-mac": {
      "command": "computer-control",
      "args": ["mac", "serve"]
    }
  }
}
```

## CLI Commands

```
computer-control browser
├── install       Interactive setup wizard
├── status        Check installation status
├── serve         Start MCP server
├── path          Print extension directory
└── uninstall     Remove native host

computer-control mac
├── setup         Interactive setup wizard
├── status        Check dependencies & permissions
└── serve         Start MCP server
```

## Available Tools

### Browser Mode

| Tool | Description |
|------|-------------|
| `read_page` | Get accessibility tree of page elements |
| `find` | Find elements by natural language query |
| `computer` | Mouse/keyboard actions and screenshots |
| `navigate` | Navigate to URL or go back/forward |
| `form_input` | Set form input values |
| `javascript_tool` | Execute JavaScript in page context |
| `get_page_text` | Extract raw text content from page |
| `tabs_context` | Get tab group context info |
| `tabs_create` | Create new tab in MCP group |
| `resize_window` | Resize browser window |
| `gif_creator` | Record and export GIF of browser actions |
| `upload_image` | Upload image to file input or drag target |

### Mac Mode

| Tool | Description |
|------|-------------|
| `screenshot` | Capture screen or region |
| `mouse_click` | Click at coordinates |
| `mouse_move` | Move cursor |
| `mouse_scroll` | Scroll in direction |
| `mouse_drag` | Drag from one point to another |
| `type_text` | Type text at cursor |
| `key_press` | Press key with modifiers |
| `run_applescript` | Execute AppleScript |
| `get_active_window` | Get focused window info |
| `list_windows` | List open windows |
| `focus_app` | Bring app to foreground |
| `get_accessibility_tree` | Get UI element hierarchy |
| `ocr_screen` | Extract text via OCR |
| `find` | Find elements by natural language |
| `gif_start/stop/export` | Record screen as GIF |

## Troubleshooting

### Extension not connecting

1. Check the extension is enabled in `chrome://extensions`
2. Verify the native host is registered:
   ```bash
   computer-control browser status
   ```
3. Make sure Chrome is running
4. Try restarting Chrome

### Permission errors on Mac

Grant permissions to your terminal app in System Settings:
- Privacy & Security → Accessibility
- Privacy & Security → Screen Recording

Then restart your terminal.

### MCP server not starting

Check if the port is already in use:
```bash
lsof -i :62222  # Browser mode WebSocket port
lsof -i :62220  # Browser mode HTTP port
```

## Development

```bash
# Install dependencies
bun install

# Build everything
bun run build

# Build extension only
cd extension && ./build.sh

# Run from source
bun src/cli.ts browser serve --skip-permissions
bun src/cli.ts mac serve
```

## Privacy

See [PRIVACY.md](PRIVACY.md) for our privacy policy.

## License

MIT
