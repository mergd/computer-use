# Computer Control - Browser Extension

Chrome extension for browser automation via MCP (Model Context Protocol).

## Installation

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this `extension/` folder

## Usage

Start the MCP server:
```bash
computer-control browser serve
```

The extension connects automatically when Chrome is running. Use with Claude Code or any MCP client.

## Architecture

```
MCP Client ──stdio──> MCP Server ──WebSocket──> Native Host ──native msg──> Extension
```

- **MCP Server**: Long-running process (`computer-control browser serve`)
- **Native Host**: Spawned by Chrome, bridges WebSocket to extension
- **Extension**: Executes browser automation commands

## Available Tools

### Tab Management
| Tool | Description |
|------|-------------|
| `tabs_context` | Get current tab group info |
| `tabs_create` | Create new tab in MCP group |

### Navigation & Page Interaction
| Tool | Description |
|------|-------------|
| `navigate` | Navigate to URL or go back/forward |
| `read_page` | Get accessibility tree of page elements |
| `find` | Find elements by natural language query |
| `computer` | Mouse/keyboard actions and screenshots |
| `form_input` | Set form input values |
| `javascript_tool` | Execute JavaScript in page context |
| `get_page_text` | Extract text content from page |
| `resize_window` | Resize browser window |

### Debugging & Monitoring
| Tool | Description |
|------|-------------|
| `read_console_messages` | Read browser console output (with filtering) |
| `read_network_requests` | Monitor network traffic (with URL filtering) |

### Cookies & History
| Tool | Description |
|------|-------------|
| `get_cookies` | Get cookies for a URL |
| `set_cookie` | Set a cookie with options (domain, path, secure, httpOnly, expiration) |
| `delete_cookie` | Delete a cookie by URL and name |
| `search_history` | Search browsing history with time range filtering |

### Clipboard
| Tool | Description |
|------|-------------|
| `clipboard_read` | Read text from clipboard |
| `clipboard_write` | Write text to clipboard |

### Media & Files
| Tool | Description |
|------|-------------|
| `upload_image` | Upload images to file inputs |
| `gif_creator` | Record and export browser actions as GIF |

### Shortcuts
| Tool | Description |
|------|-------------|
| `shortcuts_list` | List available shortcuts/workflows |
| `shortcuts_execute` | Execute a shortcut/workflow |

## Permissions

This extension requires broad permissions for full browser automation:

- **tabs, activeTab, tabGroups** - Tab management
- **scripting, debugger** - Script execution and DevTools access
- **cookies** - Cookie read/write for auth flows
- **clipboardRead/Write** - Copy/paste automation
- **history** - Access browsing history
- **webRequest, webNavigation** - Network monitoring
- **downloads** - File downloads
- **pageCapture** - Save pages as MHTML
- **nativeMessaging** - Communication with MCP server

## Files

```
extension/
├── manifest.json          # Extension manifest
├── service-worker-loader.js # Service worker entry
├── assets/
│   ├── service-worker.js  # Main service worker
│   ├── mcp-tools.js       # Browser automation tools
│   ├── accessibility-tree.js # DOM traversal
│   └── ...
├── options.html           # Options page
├── blocked.html           # Blocked site page
└── gif.js, gif.worker.js  # GIF recording
```
