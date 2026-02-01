# Browser Automation

Chrome browser automation via extension + MCP server.

## Quick Start

```bash
# Install Chrome extension
computer-control browser install

# Check status
computer-control browser status

# Start MCP server
computer-control browser serve
```

## Tools

### Tab Management

| Tool | Description |
|------|-------------|
| `tabs_context` | Get current tab group info (call first!) |
| `tabs_create` | Create new tab in MCP group |

**Important:** Always call `tabs_context` at session start to get valid tab IDs.

### Navigation

| Tool | Description |
|------|-------------|
| `navigate` | Go to URL, or "back"/"forward" |
| `resize_window` | Resize browser window |

### Reading Page Content

| Tool | Description |
|------|-------------|
| `read_page` | Get accessibility tree (elements with ref_ids) |
| `get_page_text` | Extract raw text content (good for articles) |
| `find` | Natural language element search |

**`read_page` options:**
- `depth`: Max tree depth (default: 15)
- `filter`: "interactive" for buttons/links/inputs only, "all" for everything
- `ref_id`: Focus on specific element subtree

### Interactions

| Tool | Description |
|------|-------------|
| `computer` | Mouse/keyboard actions and screenshots |
| `form_input` | Set form values by ref_id |

**`computer` actions:**
- `left_click`, `right_click`, `double_click`, `triple_click`
- `type` — Type text
- `key` — Press key (supports modifiers like "cmd+a")
- `screenshot` — Capture viewport
- `scroll` — Scroll in direction
- `scroll_to` — Scroll element into view by ref
- `hover` — Move cursor without clicking
- `left_click_drag` — Drag from point to point
- `zoom` — Capture specific region at higher detail
- `wait` — Pause for N seconds

**Click options:**
- `coordinate`: [x, y] pixel position
- `ref`: Element reference ID (alternative to coordinates)
- `modifiers`: "ctrl", "shift", "alt", "cmd"

### JavaScript Execution

| Tool | Description |
|------|-------------|
| `javascript_tool` | Execute JS in page context |

```javascript
// Example: Get page title
javascript_tool(tabId, "javascript_exec", "document.title")
```

### Debugging

| Tool | Description |
|------|-------------|
| `read_console_messages` | Read console.log/error output |
| `read_network_requests` | Monitor XHR/Fetch requests |

**Tips:**
- Use `pattern` to filter console messages (regex)
- Use `urlPattern` to filter network requests
- Set `clear: true` to avoid duplicates on repeated calls

### GIF Recording

| Tool | Description |
|------|-------------|
| `gif_creator` | Record browser actions as GIF |

**Actions:**
- `start_recording` — Begin capture
- `stop_recording` — Stop capture
- `export` — Generate GIF (set `download: true`)
- `clear` — Discard frames

**Export options:**
- `showClickIndicators` — Orange circles at click locations
- `showActionLabels` — Text labels for actions
- `showProgressBar` — Progress indicator
- `showWatermark` — Claude logo

### File Upload

| Tool | Description |
|------|-------------|
| `upload_image` | Upload screenshot to file input or drag target |

Use `ref` for file inputs, `coordinate` for drag & drop targets.

### Clipboard

| Tool | Description |
|------|-------------|
| `clipboard_read` | Read clipboard text |
| `clipboard_write` | Write text to clipboard |

### Cookies

| Tool | Description |
|------|-------------|
| `get_cookies` | Get cookies for URL |
| `set_cookie` | Set a cookie |
| `delete_cookie` | Delete a cookie |

### Browser History

| Tool | Description |
|------|-------------|
| `search_history` | Search browsing history |

### Shortcuts/Workflows

| Tool | Description |
|------|-------------|
| `shortcuts_list` | List available shortcuts |
| `shortcuts_execute` | Run a shortcut/workflow |

## Patterns

### Session Start

```
1. tabs_context createIfEmpty: true    # Get/create tab group
2. tabs_create                         # Create fresh tab
3. navigate url: "https://..."         # Go to page
```

### Read Page & Find Element

```
1. read_page tabId, filter: "interactive"   # Get clickable elements
2. find tabId, query: "submit button"       # Or use natural language
```

### Fill Form

```
1. read_page tabId                     # Get ref_ids
2. form_input tabId, ref: "ref_5", value: "hello"
3. computer tabId, action: "left_click", ref: "ref_8"  # Submit
```

### Screenshot & Click

```
1. computer tabId, action: "screenshot"
2. computer tabId, action: "left_click", coordinate: [x, y]
```

### Type & Submit

```
1. computer tabId, action: "left_click", ref: "ref_3"   # Focus input
2. computer tabId, action: "type", text: "search query"
3. computer tabId, action: "key", text: "Return"
```

### Debug API Calls

```
1. navigate tabId, url: "https://api.example.com"
2. read_network_requests tabId, urlPattern: "/api/"
```

### Record Demo GIF

```
1. gif_creator tabId, action: "start_recording"
2. computer tabId, action: "screenshot"    # First frame
3. ... perform actions ...
4. computer tabId, action: "screenshot"    # Last frame
5. gif_creator tabId, action: "stop_recording"
6. gif_creator tabId, action: "export", download: true
```

## Tips

- **Use `ref` over coordinates** when possible — more reliable
- **Filter to interactive** to reduce noise in accessibility tree
- **Take screenshots** before clicking to verify page state
- **Use `wait`** after navigation for dynamic content to load
- **Check console** for errors if interactions fail
