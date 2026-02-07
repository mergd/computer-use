#!/usr/bin/env node
/**
 * computer-control CLI
 *
 * Browser Mode (requires Chrome extension):
 *   computer-control browser install   Setup Chrome extension
 *   computer-control browser status    Show installation status
 *   computer-control browser serve     Start browser MCP server
 *
 * Mac Mode (native macOS control):
 *   computer-control mac setup         Setup macOS automation
 *   computer-control mac serve         Start macOS MCP server
 */

import { Command } from "commander";
import readline from "node:readline";
import { WEBSTORE_EXTENSION_ID, install, ensureInstalled, manifestPath, readExtensionId, uninstall } from "./install.js";
import { checkForUpdate } from "./update-check.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

function out(msg: string) { process.stdout.write(msg + "\n"); }

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a.trim()); }));
}

function step(n: number, total: number, msg: string) {
  out(`\n${CYAN}[${n}/${total}]${RESET} ${BOLD}${msg}${RESET}`);
}

// ---------------------------------------------------------------------------
// Main Program
// ---------------------------------------------------------------------------

const VERSION = "0.1.1";

const program = new Command()
  .name("computer-control")
  .description("Computer control MCP server — browser automation + macOS desktop control")
  .version(VERSION);

// ===========================================================================
// BROWSER MODE
// ===========================================================================

const browser = program
  .command("browser")
  .description("Browser automation via Chrome extension");

// ---- browser install ------------------------------------------------------

browser
  .command("install")
  .description("Register native messaging host for Chrome extension")
  .option("--extension-id <id>", "Custom extension ID (defaults to Chrome Web Store ID)")
  .action(async (opts) => {
    const extensionId = opts.extensionId ?? WEBSTORE_EXTENSION_ID;

    if (opts.extensionId && !/^[a-z]{32}$/.test(extensionId)) {
      out(`${RED}Invalid extension ID.${RESET} Must be 32 lowercase letters.`);
      process.exit(1);
    }

    const existingId = readExtensionId();
    if (existingId) {
      out(`${DIM}Updating existing registration (${existingId})${RESET}`);
    }

    const result = install(extensionId);

    out(`${GREEN}✓${RESET} Native host registered`);
    out(`  ${DIM}${result.manifestPath}${RESET}`);

    if (!existingId) {
      out(`
${BOLD}Next steps:${RESET}
  1. Install the extension from the ${CYAN}Chrome Web Store${RESET}
     https://chromewebstore.google.com/detail/computer-control/${WEBSTORE_EXTENSION_ID}
  2. Restart Chrome
  3. Run ${CYAN}computer-control browser serve${RESET}
  4. Add the MCP endpoint to your AI client:

  ${DIM}{
    "mcpServers": {
      "browser": { "url": "http://127.0.0.1:62220/mcp" }
    }
  }${RESET}
`);
    }
  });

// ---- browser status -------------------------------------------------------

browser
  .command("status")
  .description("Check Chrome extension installation status")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    const mp = manifestPath();
    const id = readExtensionId();

    if (opts.json) {
      out(JSON.stringify({ manifestPath: mp, extensionId: id }, null, 2));
      return;
    }

    out(`${BOLD}computer-control browser status${RESET}\n`);

    const fs = await import("node:fs");
    if (fs.existsSync(mp)) {
      out(`${GREEN}✓${RESET} Native host registered`);
      out(`  ${DIM}${mp}${RESET}`);
    } else {
      out(`${RED}✗${RESET} Native host not registered`);
      out(`\nRun: ${CYAN}computer-control browser install${RESET}`);
      return;
    }

    if (id) {
      out(`${GREEN}✓${RESET} Extension ID: ${id}`);
    } else {
      out(`${YELLOW}?${RESET} Extension ID unknown`);
    }
  });

// ---- browser serve --------------------------------------------------------

browser
  .command("serve")
  .description("Start browser MCP server (connects to Chrome extension)")
  .option("--skip-permissions", "Bypass extension permission prompts for all domains")
  .option("--api-key <key>", "Anthropic API key for find tool (or set ANTHROPIC_API_KEY)")
  .action(async (opts) => {
    checkForUpdate(VERSION);
    ensureInstalled();
    const { startMcpServer } = await import("./mcp-server.js");
    await startMcpServer({
      skipPermissions: !!opts.skipPermissions,
      anthropicApiKey: opts.apiKey,
    });
  });

// ---- browser uninstall ----------------------------------------------------

browser
  .command("uninstall")
  .description("Remove native messaging host registration")
  .action(() => {
    if (uninstall()) {
      out(`${GREEN}✓${RESET} Native host unregistered.`);
    } else {
      out(`${DIM}Nothing to uninstall.${RESET}`);
    }
  });

// ===========================================================================
// MAC MODE
// ===========================================================================

const mac = program
  .command("mac")
  .description("macOS desktop automation (no Chrome needed)");

// ---- mac setup ------------------------------------------------------------

mac
  .command("setup")
  .description("Interactive setup wizard for macOS desktop automation")
  .action(async () => {
    const { execSync } = await import("node:child_process");

    out(`
${BOLD}${MAGENTA}computer-control mac setup${RESET}
${DIM}macOS desktop automation for AI agents${RESET}
`);

    const total = 4;

    // Step 1 — Check/install cliclick
    step(1, total, "Checking cliclick (mouse/keyboard control)");
    let hasCliclick = false;
    try {
      execSync("which cliclick", { stdio: "ignore" });
      hasCliclick = true;
      out(`  ${GREEN}✓${RESET} cliclick is installed`);
    } catch {
      out(`  ${YELLOW}!${RESET} cliclick not found`);
      const ans = await ask(`  Install via Homebrew? [Y/n] `);
      if (!ans.toLowerCase().startsWith("n")) {
        out(`  ${DIM}Running: brew install cliclick${RESET}`);
        try {
          execSync("brew install cliclick", { stdio: "inherit" });
          hasCliclick = true;
          out(`  ${GREEN}✓${RESET} cliclick installed`);
        } catch {
          out(`  ${RED}✗${RESET} Failed to install. Run manually: brew install cliclick`);
        }
      }
    }

    // Step 2 — Check/install gifsicle (for GIF recording - lightweight ~1MB)
    step(2, total, "Checking gifsicle (GIF recording)");
    let hasGifsicle = false;
    try {
      execSync("which gifsicle", { stdio: "ignore" });
      hasGifsicle = true;
      out(`  ${GREEN}✓${RESET} gifsicle is installed`);
    } catch {
      out(`  ${YELLOW}!${RESET} gifsicle not found (optional, for GIF recording, ~1MB)`);
      const ans = await ask(`  Install via Homebrew? [Y/n] `);
      if (!ans.toLowerCase().startsWith("n")) {
        out(`  ${DIM}Running: brew install gifsicle${RESET}`);
        try {
          execSync("brew install gifsicle", { stdio: "inherit" });
          hasGifsicle = true;
          out(`  ${GREEN}✓${RESET} gifsicle installed`);
        } catch {
          out(`  ${RED}✗${RESET} Failed to install. Run manually: brew install gifsicle`);
        }
      }
    }

    // Step 3 — macOS permissions
    step(3, total, "macOS permissions");
    out(`
  For full desktop control, grant these permissions in:
  ${CYAN}System Settings → Privacy & Security${RESET}

  ${BOLD}Accessibility${RESET} (required for mouse/keyboard):
    Add your terminal app (Terminal, iTerm, Warp, etc.)

  ${BOLD}Screen Recording${RESET} (required for screenshots):
    Add your terminal app
`);
    out(`  ${DIM}Open System Settings now?${RESET}`);
    const openSettings = await ask(`  [Y/n] `);
    if (!openSettings.toLowerCase().startsWith("n")) {
      execSync("open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'");
      await ask(`  ${DIM}Press Enter when you've added your terminal to Accessibility…${RESET} `);
      execSync("open 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'");
      await ask(`  ${DIM}Press Enter when you've added your terminal to Screen Recording…${RESET} `);
    }

    // Step 4 — Test
    step(4, total, "Testing desktop control");
    if (hasCliclick) {
      try {
        const result = execSync("cliclick p:.", { encoding: "utf-8" }).trim();
        out(`  ${GREEN}✓${RESET} Mouse position: ${result}`);
      } catch {
        out(`  ${YELLOW}!${RESET} Could not get mouse position — check Accessibility permissions`);
      }
    }

    try {
      execSync("screencapture -x /tmp/test-screenshot.png", { stdio: "ignore" });
      const fs = await import("node:fs");
      if (fs.existsSync("/tmp/test-screenshot.png")) {
        fs.unlinkSync("/tmp/test-screenshot.png");
        out(`  ${GREEN}✓${RESET} Screenshot capture works`);
      }
    } catch {
      out(`  ${YELLOW}!${RESET} Screenshot failed — check Screen Recording permissions`);
    }

    // Done
    out(`
${GREEN}${BOLD}Setup complete!${RESET}

${BOLD}To start the MCP server:${RESET}
  ${CYAN}computer-control mac serve${RESET}

${BOLD}Claude Code / Cursor MCP config:${RESET}
  ${DIM}{
    "mcpServers": {
      "mac": {
        "command": "computer-control",
        "args": ["mac", "serve"]
      }
    }
  }${RESET}

${BOLD}Available tools:${RESET}
  ${DIM}screenshot, mouse_click, mouse_move, mouse_scroll, mouse_drag
  type_text, key_press, get_cursor_position, get_screen_size
  run_applescript, get_active_window, list_windows, focus_app
  get_accessibility_tree, ocr_screen, find_text${RESET}
  ${hasGifsicle ? `${DIM}gif_start, gif_stop, gif_export${RESET}` : `${YELLOW}(GIF tools need: brew install gifsicle)${RESET}`}
`);
  });

// ---- mac serve ------------------------------------------------------------

mac
  .command("serve")
  .description("Start macOS desktop MCP server")
  .option("--no-notify", "Disable macOS notifications (enabled by default)")
  .option("--api-key <key>", "Anthropic API key for find tool (or set ANTHROPIC_API_KEY)")
  .action(async (opts) => {
    checkForUpdate(VERSION);
    const { startDesktopServer } = await import("./desktop-server.js");
    await startDesktopServer({
      notify: opts.notify !== false,
      anthropicApiKey: opts.apiKey,
    });
  });

// ---- mac status -----------------------------------------------------------

mac
  .command("status")
  .description("Check macOS automation dependencies and permissions")
  .action(async () => {
    const { execSync } = await import("node:child_process");
    const { checkPermissions, detectTerminal } = await import("./desktop-tools.js");

    out(`${BOLD}computer-control mac status${RESET}\n`);

    // Show terminal
    const terminal = detectTerminal();
    out(`${BOLD}Terminal:${RESET} ${terminal}\n`);

    // Check dependencies
    out(`${BOLD}Dependencies:${RESET}`);
    try {
      execSync("which cliclick", { stdio: "ignore" });
      out(`  ${GREEN}✓${RESET} cliclick`);
    } catch {
      out(`  ${RED}✗${RESET} cliclick ${DIM}(brew install cliclick)${RESET}`);
    }

    try {
      execSync("which gifsicle", { stdio: "ignore" });
      out(`  ${GREEN}✓${RESET} gifsicle`);
    } catch {
      out(`  ${YELLOW}?${RESET} gifsicle ${DIM}(optional: brew install gifsicle)${RESET}`);
    }

    // Check permissions
    out(`\n${BOLD}Permissions for ${terminal}:${RESET}`);
    const perms = checkPermissions();

    if (perms.accessibility) {
      out(`  ${GREEN}✓${RESET} Accessibility`);
    } else {
      out(`  ${RED}✗${RESET} Accessibility ${DIM}→ System Settings → Privacy & Security → Accessibility${RESET}`);
    }

    if (perms.screenRecording) {
      out(`  ${GREEN}✓${RESET} Screen Recording`);
    } else {
      out(`  ${RED}✗${RESET} Screen Recording ${DIM}→ System Settings → Privacy & Security → Screen Recording${RESET}`);
    }

    if (perms.automation) {
      out(`  ${GREEN}✓${RESET} Automation (System Events)`);
    } else {
      out(`  ${RED}✗${RESET} Automation ${DIM}→ System Settings → Privacy & Security → Automation${RESET}`);
    }

    const allOk = perms.accessibility && perms.screenRecording && perms.automation;
    if (!allOk) {
      out(`\n${YELLOW}⚠${RESET}  Add ${BOLD}${terminal}${RESET} to the permissions above`);
      out(`${DIM}Run 'computer-control mac setup' for guided setup${RESET}`);
    } else {
      out(`\n${GREEN}✓${RESET} All permissions granted for ${BOLD}${terminal}${RESET}`);
    }
  });

program.parse();
