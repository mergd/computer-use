/**
 * MCP Server + WebSocket bridge for browser automation.
 *
 * Architecture:
 *   MCP Client ──stdio──> mcp-server ──WebSocket──> native-host-entry ──native msg──> Extension
 *
 * The native-host-entry connects via WebSocket and transparently relays messages
 * to/from the Chrome extension using native messaging.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerBrowserTools, type ExecToolFn } from "./tool-schemas.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface IncomingMessage {
  type: string;
  result?: { content: unknown };
  error?: { content: unknown };
  [key: string]: unknown;
}

export interface McpServerOptions {
  skipPermissions?: boolean;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const log = (msg: string) => process.stderr.write(`[browser-mcp] ${msg}\n`);

  // State
  let extensionSocket: WebSocket | null = null;
  let connected = false;
  const pending = new Map<string, PendingRequest>();

  // IPC port file location
  const stateDir = path.join(os.homedir(), ".browser-mcp");
  const portFile = path.join(stateDir, "ipc-port");

  // Cleanup port file on exit
  const cleanup = () => {
    try {
      if (fs.existsSync(portFile)) {
        fs.unlinkSync(portFile);
      }
    } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });

  // ---------------------------------------------------------------------------
  // WebSocket Server
  // ---------------------------------------------------------------------------

  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  await new Promise<void>((resolve) => {
    wss.on("listening", () => {
      const addr = wss.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(portFile, String(port));
        log(`WebSocket server listening on 127.0.0.1:${port}`);
      }
      resolve();
    });
  });

  wss.on("connection", (ws) => {
    log("Native host connected via WebSocket");
    extensionSocket = ws;

    ws.on("message", (data) => {
      try {
        const msg: IncomingMessage = JSON.parse(data.toString());
        handleMessage(msg);
      } catch (err) {
        log(`Failed to parse message: ${err}`);
      }
    });

    ws.on("close", () => {
      log("Native host disconnected");
      extensionSocket = null;
      connected = false;
      // Reject all pending requests
      for (const [id, req] of pending) {
        clearTimeout(req.timer);
        req.reject(new Error("Extension disconnected"));
      }
      pending.clear();
    });

    ws.on("error", (err) => {
      log(`WebSocket error: ${err.message}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------

  function send(msg: unknown): void {
    if (extensionSocket?.readyState === WebSocket.OPEN) {
      extensionSocket.send(JSON.stringify(msg));
    }
  }

  function handleMessage(msg: IncomingMessage): void {
    switch (msg.type) {
      case "ping":
        send({ type: "pong" });
        break;

      case "get_status":
        send({ type: "status_response", nativeHostInstalled: true, mcpConnected: true });
        if (!connected) {
          connected = true;
          if (options.skipPermissions) {
            send({ type: "set_skip_permissions", value: true });
          }
          send({ type: "mcp_connected" });
          log("Extension connected — MCP server ready");
        }
        break;

      case "tool_response": {
        // Resolve the most recent pending request (FIFO)
        const [id, req] = [...pending.entries()].at(-1) ?? [];
        if (id && req) {
          clearTimeout(req.timer);
          pending.delete(id);
          if (msg.error) {
            const errContent = typeof msg.error.content === "string"
              ? msg.error.content
              : JSON.stringify(msg.error.content);
            req.reject(new Error(errContent));
          } else {
            req.resolve(msg.result ?? { content: "" });
          }
        }
        break;
      }

      default:
        log(`Unknown message type: ${msg.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Tool Execution
  // ---------------------------------------------------------------------------

  const execTool: ExecToolFn = async (name, args) => {
    if (!connected) {
      throw new Error("Extension not connected. Make sure Chrome is running with the extension active.");
    }

    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout executing tool "${name}"`));
      }, 60_000);

      pending.set(id, { resolve, reject, timer });

      send({
        type: "tool_request",
        method: "execute_tool",
        params: { tool: name, args, client_id: id },
      });
    });
  };

  // ---------------------------------------------------------------------------
  // MCP Server Setup
  // ---------------------------------------------------------------------------

  const server = new McpServer({
    name: "browser-mcp",
    version: "0.1.0",
  });

  registerBrowserTools(server, execTool);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("MCP server started on stdio");

  if (options.skipPermissions) {
    log("Permission bypass enabled — all domains auto-approved");
  }

  log("Waiting for Chrome extension connection…");
}
