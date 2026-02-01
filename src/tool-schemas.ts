/**
 * MCP Tool definitions with Zod schemas for browser automation.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export type ExecToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function registerBrowserTools(server: McpServer, execTool: ExecToolFn): void {
  server.tool("read_page", "Get accessibility tree of page elements", readPageSchema, async (args) => {
    const result = await execTool("read_page", args);
    return formatResult(result);
  });

  server.tool("find", "Find elements by natural language query", findSchema, async (args) => {
    const result = await execTool("find", args);
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
    const result = await execTool("tabs_context", args);
    return formatResult(result);
  });

  server.tool("tabs_create", "Create new tab in MCP group", tabsCreateSchema, async () => {
    const result = await execTool("tabs_create", {});
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
