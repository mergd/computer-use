/**
 * MCP Server for macOS desktop automation.
 *
 * Unlike the browser MCP server, this doesn't need Chrome or WebSocket —
 * it directly controls the desktop via native macOS tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerDesktopTools, checkPermissions, setNotificationsEnabled, cleanupOldGifs, type PermissionStatus } from "./desktop-tools.js";

export interface DesktopServerOptions {
  notify?: boolean;
  anthropicApiKey?: string;
}

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function logPermissions(log: (msg: string) => void, perms: PermissionStatus): boolean {
  log(`Terminal: ${BOLD}${perms.terminal}${RESET}`);
  log("");

  const check = (ok: boolean, name: string, required: string) => {
    if (ok) {
      log(`  ${GREEN}✓${RESET} ${name}`);
    } else {
      log(`  ${RED}✗${RESET} ${name} ${DIM}— grant in System Settings → Privacy & Security → ${required}${RESET}`);
    }
  };

  check(perms.accessibility, "Accessibility", "Accessibility");
  check(perms.screenRecording, "Screen Recording", "Screen Recording");
  check(perms.automation, "Automation", "Automation → System Events");

  const allGranted = perms.accessibility && perms.screenRecording && perms.automation;

  if (!allGranted) {
    log("");
    log(`${YELLOW}⚠${RESET}  Some permissions missing for ${BOLD}${perms.terminal}${RESET}`);
    log(`${DIM}   Run: computer-control mac setup${RESET}`);
  }

  return allGranted;
}

export async function startDesktopServer(options: DesktopServerOptions = {}): Promise<void> {
  const log = (msg: string) => process.stderr.write(`[computer-control] ${msg}\n`);

  // Notifications on by default, can be disabled with --no-notify
  const notifyEnabled = options.notify !== false;
  setNotificationsEnabled(notifyEnabled);
  if (!notifyEnabled) {
    log(`${DIM}Notifications disabled${RESET}`);
  }

  // Cleanup old GIF files on startup
  cleanupOldGifs();

  // Check permissions first
  log("");
  log(`${BOLD}Checking permissions...${RESET}`);
  const perms = checkPermissions();
  logPermissions(log, perms);
  log("");

  const server = new McpServer({
    name: "computer-control",
    version: "0.1.0",
  });

  registerDesktopTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("MCP server started on stdio");
  log("Desktop automation ready — controlling macOS");
  log("");
  log("Tools available:");
  log("  Mouse:    mouse_click, mouse_move, mouse_scroll, mouse_drag");
  log("  Keyboard: type_text, key_press");
  log("  Screen:   screenshot, get_screen_size, get_cursor_position");
  log("  Windows:  get_active_window, list_windows, focus_app");
  log("  A11y/OCR: get_accessibility_tree, ocr_screen, find_text");
  log("  Script:   run_applescript");
  log("  GIF:      gif_start, gif_stop, gif_export");
}
