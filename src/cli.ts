#!/usr/bin/env node
/**
 * browser-mcp CLI
 *
 * Commands:
 *   install   Interactive setup wizard
 *   status    Show installation status
 *   path      Print extension directory
 *   serve     Start MCP server (stdio)
 */

import { Command } from "commander";
import readline from "node:readline";
import { extensionDir, install, manifestPath, readExtensionId, stateDir, uninstall } from "./install.js";

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
// Commands
// ---------------------------------------------------------------------------

const program = new Command()
  .name("browser-mcp")
  .description("Browser automation MCP server — accessibility tree, element interaction, and CDP relay.")
  .version("0.1.0");

// ---- install --------------------------------------------------------------

program
  .command("install")
  .description("Interactive setup wizard")
  .option("--extension-id <id>", "Skip ID prompt (32 lowercase letters)")
  .action(async (opts) => {
    out(`
${BOLD}${MAGENTA}browser-mcp setup${RESET}
${DIM}Accessibility tree + browser automation for AI agents${RESET}`);

    const existingId = readExtensionId();
    if (existingId) {
      out(`\n${YELLOW}Existing install detected${RESET} ${DIM}(extension ${existingId})${RESET}`);
      const ans = await ask("Reinstall? [y/N] ");
      if (!ans.toLowerCase().startsWith("y")) { out("Aborted."); return; }
    }

    const total = 3;

    // Step 1 — load extension
    step(1, total, "Load the extension in Chrome");
    out(`
  1. Open ${CYAN}chrome://extensions${RESET}
  2. Enable ${BOLD}Developer mode${RESET} (top-right toggle)
  3. Click ${BOLD}Load unpacked${RESET}
  4. Select this folder:

     ${YELLOW}${extensionDir()}${RESET}
`);
    await ask(`${DIM}Press Enter when done…${RESET} `);

    // Step 2 — extension ID
    let extensionId: string = opts.extensionId ?? "";
    if (!extensionId) {
      step(2, total, "Enter the extension ID");
      out(`
  Chrome shows the extension with an ${BOLD}ID${RESET} — 32 lowercase letters.
  ${DIM}Example: abcdefghijklmnopqrstuvwxyzabcdef${RESET}
`);
      while (!/^[a-z]{32}$/.test(extensionId)) {
        extensionId = await ask(`${CYAN}Extension ID:${RESET} `);
        if (!/^[a-z]{32}$/.test(extensionId)) out(`${RED}Invalid.${RESET} Must be 32 lowercase letters.`);
      }
    } else {
      step(2, total, `Using provided ID: ${extensionId}`);
    }

    // Step 3 — register native host
    step(3, total, "Registering native messaging host");
    const result = install(extensionId);
    out(`${GREEN}✓${RESET} Host binary:  ${result.hostPath}`);
    out(`${GREEN}✓${RESET} Manifest:     ${result.manifestPath}`);

    // Done
    out(`
${GREEN}${BOLD}Done!${RESET}

${BOLD}Next:${RESET}
  1. ${BOLD}Restart Chrome${RESET} (quit fully, then reopen)
  2. Click the extension icon on any tab — badge shows ${GREEN}ON${RESET}
  3. Run ${CYAN}browser-mcp serve${RESET} to start the MCP server

${BOLD}Cursor / Claude Code:${RESET}
  Add to your MCP config:
  ${DIM}{
    "mcpServers": {
      "browser": {
        "command": "browser-mcp",
        "args": ["serve"]
      }
    }
  }${RESET}
`);
  });

// ---- status ---------------------------------------------------------------

program
  .command("status")
  .description("Check installation status")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    const mp = manifestPath();
    const id = readExtensionId();
    const extDir = extensionDir();

    if (opts.json) {
      out(JSON.stringify({ extensionDir: extDir, manifestPath: mp, extensionId: id }, null, 2));
      return;
    }

    out(`${BOLD}browser-mcp status${RESET}\n`);

    const fs = await import("node:fs");
    if (fs.existsSync(mp)) {
      out(`${GREEN}✓${RESET} Native host registered`);
      out(`  ${DIM}${mp}${RESET}`);
    } else {
      out(`${RED}✗${RESET} Native host not registered`);
    }

    if (id) {
      out(`${GREEN}✓${RESET} Extension ID: ${id}`);
    } else {
      out(`${YELLOW}?${RESET} Extension ID unknown`);
    }

    out(`\n${DIM}Extension source: ${extDir}${RESET}`);

    if (!fs.existsSync(mp)) {
      out(`\nRun: ${CYAN}browser-mcp install${RESET}`);
    }
  });

// ---- path -----------------------------------------------------------------

program
  .command("path")
  .description("Print extension directory (for Load unpacked)")
  .action(() => out(extensionDir()));

// ---- serve ----------------------------------------------------------------

program
  .command("serve")
  .description("Start MCP server (stdio) — connects to Chrome extension via native messaging")
  .option("--skip-permissions", "Bypass extension permission prompts for all domains")
  .action(async (opts) => {
    const { BrowserHost } = await import("./host.js");
    const log = (msg: string) => process.stderr.write(`[browser-mcp] ${msg}\n`);

    const host = new BrowserHost(process.stdin, process.stdout, log, {
      skipPermissions: !!opts.skipPermissions,
    });

    if (opts.skipPermissions) {
      log("Permission bypass enabled — all domains auto-approved");
    }

    host.on("connected", () => {
      log("Extension connected — MCP server ready");
    });

    host.on("disconnected", () => {
      log("Extension disconnected");
      process.exit(0);
    });

    host.start();
    log("Waiting for Chrome extension connection…");
  });

// ---- uninstall ------------------------------------------------------------

program
  .command("uninstall")
  .description("Remove native messaging host registration")
  .action(() => {
    if (uninstall()) {
      out(`${GREEN}✓${RESET} Native host unregistered.`);
    } else {
      out(`${DIM}Nothing to uninstall.${RESET}`);
    }
  });

program.parse();
