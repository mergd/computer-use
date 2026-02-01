# Mac Computer Use

Native macOS automation via accessibility APIs, screenshots, and input simulation.

## Quick Start

```bash
# Check status & permissions
computer-control mac status

# Start MCP server
computer-control mac serve
```

## Required Permissions (per terminal app)

- **Accessibility** — Mouse/keyboard control
- **Screen Recording** — Screenshots, OCR
- **Automation** — System Events access

## Tools

### Navigation

| Tool | Description |
|------|-------------|
| `focus_app` | Switch to app (uses `open -a`, reliable) |
| `get_active_window` | Get frontmost app/window |
| `list_windows` | List open windows |

**Tip:** Use Spotlight/Raycast for app switching: `key_press` space+cmd, `type_text` "AppName", `key_press` return

### Screenshots & Vision

| Tool | Description |
|------|-------------|
| `screenshot` | Capture screen or region (auto-scaled to 1568px max) |
| `ocr_screen` | Extract text with coordinates via Vision framework |
| `find` | Natural language element search (uses Haiku + screenshot + a11y tree) |

### Mouse

| Tool | Description |
|------|-------------|
| `mouse_click` | Click at coordinates (3px down adjustment for LLM overshoot) |
| `mouse_move` | Move cursor |
| `mouse_scroll` | Scroll up/down/left/right |
| `mouse_drag` | Drag from point to point |
| `get_cursor_position` | Get current cursor location |

### Keyboard

| Tool | Description |
|------|-------------|
| `type_text` | Type text string |
| `key_press` | Press key with modifiers (cliclick - limited keys) |
| `press_key_cg` | CGEvent key press (all keys, all modifiers, can target background apps) |

**`press_key_cg` advantages:**
- Supports all keys (letters, F-keys, arrows, etc.)
- All modifiers: cmd, ctrl, alt, shift, fn
- `appTarget`: Send to background app by name
- `keyDown`/`keyUp`: Hold keys separately

### Accessibility (Swift-based)

| Tool | Description | Timeout |
|------|-------------|---------|
| `get_accessibility_tree` | Get UI element hierarchy with ref_ids | 15s |
| `click_element` | Click element by ref_id (more reliable than coordinates) | 10s |
| `set_value` | Set text field value by ref_id | 10s |
| `get_element_info` | Get element state (enabled, focused, value, actions) | 10s |
| `select_menu` | Navigate menus by path, e.g., `["File", "Save"]` | 10s |

**Depth guidelines for `get_accessibility_tree`:**
- Depth 3 (default): ~50 elements, ~1s — good for most apps
- Depth 4: ~300 elements, ~1.1s — good for complex apps
- Depth 5-6: ~2000 elements, ~1.5s — use sparingly
- Depth 7+: Slow, avoid unless necessary

### GIF Recording

| Tool | Description |
|------|-------------|
| `gif_start` | Start recording (default 10 FPS) |
| `gif_stop` | Stop recording |
| `gif_export` | Export to GIF (requires gifsicle or ffmpeg) |

### Utilities

| Tool | Description |
|------|-------------|
| `get_screen_size` | Get display dimensions |
| `run_applescript` | Execute AppleScript |
| `run_swift` | Execute arbitrary Swift (Cocoa, ApplicationServices, Foundation) |

## Patterns

### Reliable App Switching

```
1. focus_app "Mail"           # Uses open -a
2. screenshot                 # Verify it's in front
```

### Click on UI Element

```
1. get_accessibility_tree     # Get ref_ids
2. click_element ref_5        # Click by ref (reliable)
```

Or with coordinates:
```
1. screenshot                 # See the UI
2. mouse_click x, y           # 3px down adjustment applied
```

### Fill Form Field

```
1. get_accessibility_tree
2. click_element ref_12       # Focus the field
3. set_value ref_12 "text"    # Set value directly
```

### Menu Navigation

```
select_menu path: ["File", "Export", "PDF"]
```

### Key Combo to Background App

```
press_key_cg key: "s", modifiers: ["cmd"], appTarget: "TextEdit"
```

## Debugging

All Swift tools log timing to stderr:
```
[get_accessibility_tree] total=1234ms DEBUG: app=Mail maxDepth=4 elements=279 traverseMs=67
[click_element] completed in 1100ms
```

If operations are slow, reduce `maxDepth` or check the element count in logs.
