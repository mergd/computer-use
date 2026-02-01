/**
 * MCP Server + WebSocket bridge for browser automation.
 *
 * Architecture:
 *   MCP Client ──HTTP/SSE──> mcp-server ──WebSocket──> native-host-entry ──native msg──> Extension
 *
 * The server runs persistently. Claude Code connects via SSE, and the Chrome
 * extension's native host connects via WebSocket.
 */

import fs from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";

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
  anthropicApiKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_PORT = 62220;
const WS_PORT = 62222;

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const log = (msg: string) => process.stderr.write(`[browser-mcp] ${msg}\n`);

  // State
  let extensionSocket: WebSocket | null = null;
  let connected = false;
  const pending = new Map<string, PendingRequest>();

  // ---------------------------------------------------------------------------
  // WebSocket Server (for Chrome extension native host)
  // ---------------------------------------------------------------------------

  const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });

  wss.on("listening", () => {
    log(`WebSocket server listening on 127.0.0.1:${WS_PORT}`);
  });

  wss.on("connection", (ws) => {
    log("Native host connected via WebSocket");
    extensionSocket = ws;
    connected = true;

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
  // Message Handling (from extension)
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
        if (options.skipPermissions) {
          send({ type: "set_skip_permissions", value: true });
        }
        send({ type: "mcp_connected" });
        log("Extension handshake complete");
        break;

      case "tool_response": {
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
      log("Waiting for extension connection...");
      const waitStart = Date.now();
      while (!connected && Date.now() - waitStart < 10_000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!connected) {
        throw new Error("Extension not connected. Make sure Chrome is running with the extension active.");
      }
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
  // MCP Server with Streamable HTTP Transport
  // ---------------------------------------------------------------------------

  const app = express();
  app.use(express.json());

  // Single persistent MCP server instance (stateless mode)
  const mcpServer = new McpServer({
    name: "browser-mcp",
    version: "0.1.0",
  });
  registerBrowserTools(mcpServer, execTool, {
    anthropicApiKey: options.anthropicApiKey,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless - no sessions
  });

  await mcpServer.connect(transport);
  log("MCP server initialized");

  // Single /mcp endpoint
  app.all("/mcp", async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });

  // Start HTTP server
  app.listen(HTTP_PORT, "127.0.0.1", () => {
    log(`HTTP/SSE server listening on http://127.0.0.1:${HTTP_PORT}`);
  });

  log("MCP server started");
  if (options.skipPermissions) {
    log("Permission bypass enabled — all domains auto-approved");
  }
  log("Waiting for connections...");
  log(`  - Claude Code: http://127.0.0.1:${HTTP_PORT}/mcp`);
  log(`  - Extension: WebSocket on port ${WS_PORT}`);
}
