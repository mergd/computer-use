#!/usr/bin/env node
/**
 * Entry point launched by Chrome native messaging.
 *
 * Two modes:
 * 1. WebSocket Proxy Mode (default): If ~/.browser-mcp/ipc-port exists, connect
 *    to that WebSocket and relay all Chrome native messages bidirectionally.
 *
 * 2. Direct Mode (fallback): If no port file, use BrowserHost directly for
 *    backward compatibility.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import WebSocket from "ws";

import { BrowserHost } from "./host.js";
import { decodeNativeMessage, encodeNativeMessage } from "./native-messaging.js";

const log = (msg: string) => process.stderr.write(`[native-host] ${msg}\n`);

// ---------------------------------------------------------------------------
// Port File Discovery
// ---------------------------------------------------------------------------

function readIpcPort(): number | null {
  const portFile = path.join(os.homedir(), ".browser-mcp", "ipc-port");
  try {
    if (fs.existsSync(portFile)) {
      const content = fs.readFileSync(portFile, "utf-8").trim();
      const port = parseInt(content, 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        return port;
      }
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// WebSocket Proxy Mode
// ---------------------------------------------------------------------------

function startWebSocketProxy(port: number): void {
  log(`Connecting to MCP server at ws://127.0.0.1:${port}`);

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  let buffer = Buffer.alloc(0);

  ws.on("open", () => {
    log("Connected to MCP server WebSocket");
  });

  ws.on("error", (err) => {
    log(`WebSocket error: ${err.message}`);
    // Fall back to direct mode
    startDirectMode();
  });

  ws.on("close", () => {
    log("WebSocket closed, exiting");
    process.exit(0);
  });

  // Chrome → WebSocket: read native messages from stdin, forward to WS
  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    let parsed: ReturnType<typeof decodeNativeMessage>;
    while ((parsed = decodeNativeMessage(buffer)) !== null) {
      buffer = Buffer.from(parsed.remaining);
      // Forward to WebSocket as JSON
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(parsed.message));
      }
    }
  });

  process.stdin.on("end", () => {
    log("stdin closed, closing WebSocket");
    ws.close();
  });

  // WebSocket → Chrome: receive JSON from WS, send as native message to stdout
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      process.stdout.write(encodeNativeMessage(msg));
    } catch (err) {
      log(`Failed to forward message to Chrome: ${err}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Direct Mode (Fallback)
// ---------------------------------------------------------------------------

function startDirectMode(): void {
  log("Starting in direct mode (no MCP server)");

  const skipPermissions = process.argv.includes("--skip-permissions")
    || process.env.BROWSER_MCP_SKIP_PERMISSIONS === "1";

  const host = new BrowserHost(process.stdin, process.stdout, undefined, { skipPermissions });
  host.start();
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

const port = readIpcPort();
if (port) {
  startWebSocketProxy(port);
} else {
  startDirectMode();
}
