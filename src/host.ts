/**
 * Native messaging host — bridges the Chrome extension to local consumers.
 *
 * The extension connects via Chrome's native messaging (stdio).
 * We expose browser automation tools that can be called programmatically
 * or over MCP.
 *
 * Extension → host protocol:
 *   { type: "ping" }                → we reply { type: "pong" }
 *   { type: "get_status" }          → we reply with status, then "mcp_connected"
 *   { type: "tool_response", ... }  → result/error for a tool we requested
 *
 * Host → extension protocol:
 *   { type: "pong" }
 *   { type: "status_response", ... }
 *   { type: "mcp_connected" }
 *   { type: "set_skip_permissions", value: boolean }
 *   { type: "tool_request", method: "execute_tool", params: { tool, args } }
 */

import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

import { decodeNativeMessage, encodeNativeMessage } from "./native-messaging.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: string | unknown[];
  is_error?: boolean;
}

interface PendingRequest {
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type IncomingMessage =
  | { type: "ping" }
  | { type: "get_status" }
  | { type: "tool_response"; result?: { content: string | unknown[] }; error?: { content: string | unknown[] } };

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export interface BrowserHostOptions {
  skipPermissions?: boolean;
}

export class BrowserHost extends EventEmitter {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private connected = false;
  private pending = new Map<string, PendingRequest>();
  private options: BrowserHostOptions;

  constructor(
    private stdin: NodeJS.ReadableStream = process.stdin,
    private stdout: NodeJS.WritableStream = process.stdout,
    private log: (msg: string) => void = (m) => process.stderr.write(`[browser-mcp] ${m}\n`),
    options: BrowserHostOptions = {},
  ) {
    super();
    this.options = options;
  }

  /** Start reading from stdin. */
  start(): void {
    this.stdin.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    this.stdin.on("end", () => {
      this.log("Extension disconnected (stdin closed)");
      this.emit("disconnected");
    });
    this.log("Waiting for extension connection…");
  }

  get isConnected(): boolean {
    return this.connected;
  }

  // -----------------------------------------------------------------------
  // Outbound: execute a browser tool
  // -----------------------------------------------------------------------

  async exec(
    tool: string,
    args: Record<string, unknown> = {},
    opts: { timeoutMs?: number } = {},
  ): Promise<ToolResult> {
    if (!this.connected) throw new Error("Extension not connected");

    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout executing tool "${tool}"`));
      }, opts.timeoutMs ?? 30_000);

      this.pending.set(id, { resolve, reject, timer });

      this.send({
        type: "tool_request",
        method: "execute_tool",
        params: { tool, args, client_id: id },
      });
    });
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private drain(): void {
    let parsed: ReturnType<typeof decodeNativeMessage>;
    while ((parsed = decodeNativeMessage(this.buffer)) !== null) {
      this.buffer = parsed.remaining;
      this.handle(parsed.message as IncomingMessage);
    }
  }

  private handle(msg: IncomingMessage): void {
    switch (msg.type) {
      case "ping":
        this.send({ type: "pong" });
        break;

      case "get_status":
        this.send({ type: "status_response", nativeHostInstalled: true, mcpConnected: true });
        if (!this.connected) {
          this.connected = true;
          if (this.options.skipPermissions) {
            this.send({ type: "set_skip_permissions", value: true });
          }
          this.send({ type: "mcp_connected" });
          this.log("Extension connected");
          this.emit("connected");
        }
        break;

      case "tool_response": {
        // Find the most recent pending request (FIFO — only one in-flight at a time
        // because the extension serializes via currentToolUseId on its side).
        const [id, req] = [...this.pending.entries()].at(-1) ?? [];
        if (id && req) {
          clearTimeout(req.timer);
          this.pending.delete(id);
          if (msg.error) {
            const errContent = typeof msg.error.content === "string"
              ? msg.error.content
              : JSON.stringify(msg.error.content);
            req.reject(new Error(errContent));
          } else {
            req.resolve({
              content: msg.result?.content ?? "",
              is_error: false,
            });
          }
        }
        break;
      }

      default:
        this.log(`Unknown message type: ${JSON.stringify(msg).slice(0, 120)}`);
    }
  }

  private send(message: unknown): void {
    this.stdout.write(encodeNativeMessage(message));
  }
}
