/**
 * MCP Tool definitions with Zod schemas for browser automation.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeFindTool, isFindToolAvailable } from "./find-tool.js";

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

const readPageSchema = {
  tabId: z.number().describe("Tab ID to read from"),
  depth: z.number().optional().describe("Maximum depth of tree traversal (default: 15)"),
  filter: z.enum(["interactive", "all"]).optional().describe("Filter for interactive elements only"),
  ref_id: z.string().optional().describe("Focus on a specific element by reference ID"),
};

const findSchema = {
  tabId: z.number().describe("Tab ID to search in"),
  query: z.string().describe("Natural language description of what to find"),
};

const computerSchema = {
  tabId: z.number().describe("Tab ID to execute action on"),
  action: z.enum([
    "left_click", "right_click", "double_click", "triple_click",
    "type", "key", "screenshot", "wait", "scroll", "left_click_drag",
    "zoom", "scroll_to", "hover"
  ]).describe("Action to perform"),
  coordinate: z.array(z.number()).length(2).optional().describe("[x, y] coordinates"),
  text: z.string().optional().describe("Text to type or key to press"),
  scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
  scroll_amount: z.number().optional().describe("Number of scroll ticks"),
  duration: z.number().optional().describe("Wait duration in seconds"),
  start_coordinate: z.array(z.number()).length(2).optional().describe("Start coords for drag"),
  region: z.array(z.number()).length(4).optional().describe("Region for zoom [x0,y0,x1,y1]"),
  ref: z.string().optional().describe("Element reference ID"),
  modifiers: z.string().optional().describe("Modifier keys (ctrl, shift, alt, cmd)"),
  repeat: z.number().optional().describe("Repeat count for key action"),
};

const navigateSchema = {
  tabId: z.number().describe("Tab ID to navigate"),
  url: z.string().describe("URL to navigate to, or 'back'/'forward'"),
};

const javascriptToolSchema = {
  tabId: z.number().describe("Tab ID to execute in"),
  action: z.string().describe("Must be 'javascript_exec'"),
  text: z.string().describe("JavaScript code to execute"),
};

const formInputSchema = {
  tabId: z.number().describe("Tab ID"),
  ref: z.string().describe("Element reference ID"),
  value: z.union([z.string(), z.boolean(), z.number()]).describe("Value to set"),
};

const getPageTextSchema = {
  tabId: z.number().describe("Tab ID to extract text from"),
};

const tabsContextSchema = {
  createIfEmpty: z.boolean().optional().describe("Create new tab group if none exists"),
};

const tabsCreateSchema = {};

const resizeWindowSchema = {
  tabId: z.number().describe("Tab ID to get window for"),
  width: z.number().describe("Target width in pixels"),
  height: z.number().describe("Target height in pixels"),
};

const uploadImageSchema = {
  tabId: z.number().describe("Tab ID where target is located"),
  imageId: z.string().describe("ID of previously captured screenshot"),
  ref: z.string().optional().describe("Element reference ID for file input"),
  coordinate: z.array(z.number()).length(2).optional().describe("[x,y] for drag & drop"),
  filename: z.string().optional().describe("Filename for uploaded file"),
};

const gifCreatorSchema = {
  tabId: z.number().describe("Tab ID for this operation"),
  action: z.enum(["start_recording", "stop_recording", "export", "clear"]).describe("Action to perform"),
  download: z.boolean().optional().describe("Download the GIF (for export action)"),
  filename: z.string().optional().describe("Filename for exported GIF"),
  options: z.object({
    showClickIndicators: z.boolean().optional(),
    showDragPaths: z.boolean().optional(),
    showActionLabels: z.boolean().optional(),
    showProgressBar: z.boolean().optional(),
    showWatermark: z.boolean().optional(),
    quality: z.number().optional(),
  }).optional().describe("GIF enhancement options"),
};

const readConsoleMessagesSchema = {
  tabId: z.number().describe("Tab ID to read console from"),
  pattern: z.string().optional().describe("Regex pattern to filter messages"),
  limit: z.number().optional().describe("Max messages to return (default: 100)"),
  onlyErrors: z.boolean().optional().describe("Only return error messages"),
  clear: z.boolean().optional().describe("Clear messages after reading"),
};

const readNetworkRequestsSchema = {
  tabId: z.number().describe("Tab ID to read network from"),
  urlPattern: z.string().optional().describe("URL pattern to filter requests"),
  limit: z.number().optional().describe("Max requests to return (default: 100)"),
  clear: z.boolean().optional().describe("Clear requests after reading"),
};

const shortcutsListSchema = {
  tabId: z.number().describe("Tab ID"),
};

const shortcutsExecuteSchema = {
  tabId: z.number().describe("Tab ID to execute on"),
  shortcutId: z.string().optional().describe("Shortcut ID to execute"),
  command: z.string().optional().describe("Command name (without leading slash)"),
};

const clipboardReadSchema = {};

const clipboardWriteSchema = {
  text: z.string().describe("Text to write to clipboard"),
};

const getCookiesSchema = {
  url: z.string().describe("URL to get cookies for"),
  name: z.string().optional().describe("Specific cookie name to get"),
};

const setCookieSchema = {
  url: z.string().describe("URL for the cookie"),
  name: z.string().describe("Cookie name"),
  value: z.string().describe("Cookie value"),
  domain: z.string().optional().describe("Cookie domain"),
  path: z.string().optional().describe("Cookie path (default: /)"),
  secure: z.boolean().optional().describe("Secure flag"),
  httpOnly: z.boolean().optional().describe("HttpOnly flag"),
  expirationDate: z.number().optional().describe("Expiration as Unix timestamp"),
};

const deleteCookieSchema = {
  url: z.string().describe("URL of the cookie"),
  name: z.string().describe("Cookie name to delete"),
};

const searchHistorySchema = {
  query: z.string().describe("Search query for history"),
  maxResults: z.number().optional().describe("Max results (default: 100)"),
  startTime: z.number().optional().describe("Start time as Unix timestamp (ms)"),
  endTime: z.number().optional().describe("End time as Unix timestamp (ms)"),
};

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export type ExecToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface RegisterToolsOptions {
  anthropicApiKey?: string;
}

export function registerBrowserTools(
  server: McpServer,
  execTool: ExecToolFn,
  options: RegisterToolsOptions = {}
): void {
  server.tool("read_page", "Get accessibility tree of page elements", readPageSchema, async (args) => {
    const result = await execTool("read_page", args);
    return formatResult(result);
  });

  // Find tool: get tree from extension, then use Anthropic API or Claude Code OAuth
  server.tool("find", "Find elements by natural language query", findSchema, async (args) => {
    const { tabId, query } = args as { tabId: number; query: string };

    // Check if find tool is available (API key or Claude Code CLI)
    if (!(await isFindToolAvailable(options.anthropicApiKey))) {
      return formatResult({
        error: "Find tool requires ANTHROPIC_API_KEY or Claude Code OAuth credentials (~/.claude/.credentials.json)",
      });
    }

    // Get accessibility tree from extension
    const treeResult = await execTool("read_page", { tabId }) as {
      content?: Array<{ type: string; text?: string }>;
      output?: string;
      error?: string;
    };

    // Extract tree text from result
    let tree: string;
    if (treeResult.error) {
      return formatResult({ error: treeResult.error });
    } else if (treeResult.content && Array.isArray(treeResult.content)) {
      tree = treeResult.content
        .filter(c => c.type === "text" && c.text)
        .map(c => c.text)
        .join("\n");
    } else if (treeResult.output) {
      tree = treeResult.output;
    } else {
      tree = JSON.stringify(treeResult);
    }

    // Execute find with Anthropic client or Claude Code OAuth fallback
    const result = await executeFindTool(query, tree, {
      apiKey: options.anthropicApiKey,
    });
    return formatResult(result);
  });

  server.tool("computer", "Mouse/keyboard actions and screenshots", computerSchema, async (args) => {
    const result = await execTool("computer", args);
    return formatResult(result);
  });

  server.tool("navigate", "Navigate to URL or go back/forward", navigateSchema, async (args) => {
    const result = await execTool("navigate", args);
    return formatResult(result);
  });

  server.tool("javascript_tool", "Execute JavaScript in page context", javascriptToolSchema, async (args) => {
    const result = await execTool("javascript_tool", args);
    return formatResult(result);
  });

  server.tool("form_input", "Set form input values", formInputSchema, async (args) => {
    const result = await execTool("form_input", args);
    return formatResult(result);
  });

  server.tool("get_page_text", "Extract raw text content from page", getPageTextSchema, async (args) => {
    const result = await execTool("get_page_text", args);
    return formatResult(result);
  });

  server.tool("tabs_context", "Get tab group context info", tabsContextSchema, async (args) => {
    const result = await execTool("tabs_context_mcp", args);
    return formatResult(result);
  });

  server.tool("tabs_create", "Create new tab in MCP group", tabsCreateSchema, async () => {
    const result = await execTool("tabs_create_mcp", {});
    return formatResult(result);
  });

  server.tool("resize_window", "Resize browser window", resizeWindowSchema, async (args) => {
    const result = await execTool("resize_window", args);
    return formatResult(result);
  });

  server.tool("upload_image", "Upload image to file input or drag target", uploadImageSchema, async (args) => {
    const result = await execTool("upload_image", args);
    return formatResult(result);
  });

  server.tool("gif_creator", "Record and export GIF of browser actions", gifCreatorSchema, async (args) => {
    const result = await execTool("gif_creator", args);
    return formatResult(result);
  });

  server.tool("read_console_messages", "Read browser console output", readConsoleMessagesSchema, async (args) => {
    const result = await execTool("read_console_messages", args);
    return formatResult(result);
  });

  server.tool("read_network_requests", "Read network requests made by page", readNetworkRequestsSchema, async (args) => {
    const result = await execTool("read_network_requests", args);
    return formatResult(result);
  });

  server.tool("shortcuts_list", "List available shortcuts/workflows", shortcutsListSchema, async (args) => {
    const result = await execTool("shortcuts_list", args);
    return formatResult(result);
  });

  server.tool("shortcuts_execute", "Execute a shortcut/workflow", shortcutsExecuteSchema, async (args) => {
    const result = await execTool("shortcuts_execute", args);
    return formatResult(result);
  });

  // Clipboard tools - handled by extension service worker
  server.tool("clipboard_read", "Read text from clipboard", clipboardReadSchema, async (args) => {
    const result = await execTool("clipboard_read", args);
    return formatResult(result);
  });

  server.tool("clipboard_write", "Write text to clipboard", clipboardWriteSchema, async (args) => {
    const result = await execTool("clipboard_write", args);
    return formatResult(result);
  });

  // Cookie tools - handled by extension service worker
  server.tool("get_cookies", "Get cookies for a URL", getCookiesSchema, async (args) => {
    const result = await execTool("get_cookies", args);
    return formatResult(result);
  });

  server.tool("set_cookie", "Set a cookie", setCookieSchema, async (args) => {
    const result = await execTool("set_cookie", args);
    return formatResult(result);
  });

  server.tool("delete_cookie", "Delete a cookie", deleteCookieSchema, async (args) => {
    const result = await execTool("delete_cookie", args);
    return formatResult(result);
  });

  // History tools - handled by extension service worker
  server.tool("search_history", "Search browsing history", searchHistorySchema, async (args) => {
    const result = await execTool("search_history", args);
    return formatResult(result);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  // Handle results that are already in MCP content format
  if (result && typeof result === "object" && "content" in result) {
    const r = result as { content: unknown };
    if (Array.isArray(r.content)) {
      // Already formatted content array
      return { content: r.content as Array<{ type: "text"; text: string }> };
    }
    if (typeof r.content === "string") {
      return { content: [{ type: "text", text: r.content }] };
    }
  }

  // Stringify other results
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return { content: [{ type: "text", text }] };
}
