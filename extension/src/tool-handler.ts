/**
 * tool-handler.ts - Tool execution engine
 *
 * Contains:
 * - ToolCallHandler: Main tool execution handler class
 * - toolRegistry: Registry of all available tools
 * - mcpOnlyToolNames: Tool names that are MCP-only
 * - getOrCreateToolHandler: Context factory for tool handlers
 */

import { cdpDebuggerInstance as cdpDebugger } from "./cdp-debugger.js";
import { tabGroupManagerInstance as TabGroupManager } from "./tab-group-manager.js";
import { coerceParameterTypes } from "./utils.js";
import { gifFrameStorage } from "./gif-tools.js";

// Import all tools
import { readPageTool, formInputTool, getPageTextTool, javascriptTool } from "./page-tools.js";
import { computerTool } from "./computer-tool.js";
import { navigateTool, tabsContextTool, tabsCreateTool, tabsContextMcpTool, tabsCreateMcpTool } from "./navigation-tools.js";
import { updatePlanTool } from "./plan-tools.js";
import { gifCreatorTool } from "./gif-tools.js";
import {
  uploadImageTool,
  readConsoleMessagesTool,
  readNetworkRequestsTool,
  resizeWindowTool,
  turnAnswerStartTool,
  shortcutsListTool,
  shortcutsExecuteTool,
  click1PasswordPasskeyTool,
} from "./utility-tools.js";

// Import types
import type {
  ToolResult,
  ToolExecutionContext,
  PermissionRequiredResult,
  PermissionManager,
  PermissionCheckResult,
  ToolCall,
  FormattedToolResult,
  ToolResultContent,
  GifFrame,
  GifActionInfo,
  ComputerAction,
  Analytics,
  ToolParameterSchema,
  AnthropicToolSchema,
} from "./types.js";

// Declare global self with __skipPermissions
declare const self: typeof globalThis & { __skipPermissions?: boolean };

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Stub for tracing - just executes the function directly
 */
interface TraceSpan {
  setAttribute(key: string, value: unknown): void;
}

type TraceFn<T> = (span: TraceSpan) => Promise<T>;

/**
 * Tool definition interface compatible with all tool modules
 * This is a more flexible interface that works with the various Tool<T> types
 * defined in individual tool modules. Uses 'any' for execute return type
 * because different tool modules have slightly different ToolResult/PermissionRequiredResult types.
 */
interface ToolDefinition {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(params: any, context: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toAnthropicSchema(context?: any): Promise<any> | any;
}

/**
 * Analytics data for tool calls
 */
interface ToolAnalyticsData {
  name: string;
  sessionId: string;
  permissions?: string;
  action?: string;
  domain?: string;
  success?: boolean;
  failureReason?: string;
  [key: string]: unknown;
}

/**
 * Parameters for computer tool
 */
interface ComputerToolParams {
  action?: ComputerAction;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  [key: string]: unknown;
}

/**
 * Parameters for navigate tool
 */
interface NavigateToolParams {
  url?: string;
  [key: string]: unknown;
}

/**
 * Context for ToolCallHandler (extends ToolExecutionContext)
 * Makes toolUseId optional since it's set per-call, not per-handler
 */
export interface ToolCallHandlerContext {
  toolUseId?: string;
  tabId: number | undefined;
  tabGroupId?: number;
  model?: string;
  sessionId: string;
  permissionManager: PermissionManager;
  messages?: unknown[];
  analytics?: Analytics;
  onPermissionRequired?: (
    permRequest: PermissionRequiredResult,
    tabId: number
  ) => Promise<boolean>;
}

/**
 * Pending error info type
 */
interface PendingErrorInfo {
  message: string | undefined;
  timestamp: number | undefined;
}

/**
 * Permission prompt handler type
 */
type PermissionPromptHandler = (
  permRequest: PermissionRequiredResult,
  tabId: number
) => Promise<boolean>;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Stub trace function - just executes the function directly
 */
const trace = async <T>(
  name: string,
  fn: TraceFn<T>,
  ...args: unknown[]
): Promise<T> => fn({ setAttribute: () => {} });

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Tool registry array (We)
 * Contains all available tools for execution
 */
export const toolRegistry: ToolDefinition[] = [
  readPageTool,
  // find tool removed - handled by MCP server
  formInputTool,
  computerTool,
  navigateTool,
  getPageTextTool,
  tabsContextTool,
  tabsContextMcpTool,
  tabsCreateTool,
  tabsCreateMcpTool,
  updatePlanTool,
  uploadImageTool,
  readConsoleMessagesTool,
  readNetworkRequestsTool,
  resizeWindowTool,
  gifCreatorTool,
  turnAnswerStartTool,
  javascriptTool,
  shortcutsListTool,
  shortcutsExecuteTool,
  click1PasswordPasskeyTool,
];

/**
 * MCP-only tool names (je)
 * These tools don't require a tab to be present
 */
export const mcpOnlyToolNames: string[] = ["tabs_context_mcp", "tabs_create_mcp"];

// =============================================================================
// ToolCallHandler Class
// =============================================================================

/**
 * ToolCallHandler class (ze)
 * Main class for handling tool execution
 */
export class ToolCallHandler {
  context: ToolCallHandlerContext;

  constructor(context: ToolCallHandlerContext) {
    this.context = context;
  }

  /**
   * Handle a single tool call
   */
  async handleToolCall(
    toolName: string,
    params: Record<string, unknown>,
    toolUseId: string | undefined,
    permissions?: string,
    domain?: string,
    analytics?: unknown
  ): Promise<ToolResult> {
    const action = params.action as string | undefined;

    return await trace(
      `tool_execution_${toolName}${action ? "_" + action : ""}`,
      async (span: TraceSpan): Promise<ToolResult> => {
        if (!this.context.tabId && !mcpOnlyToolNames.includes(toolName)) {
          throw new Error("No tab available");
        }

        span.setAttribute("session_id", this.context.sessionId);
        span.setAttribute("tool_name", toolName);
        if (permissions) span.setAttribute("permissions", permissions);
        if (action) span.setAttribute("action", action);

        const executionContext: ToolExecutionContext = {
          toolUseId,
          tabId: this.context.tabId,
          tabGroupId: this.context.tabGroupId,
          model: this.context.model,
          sessionId: this.context.sessionId,
          permissionManager: this.context.permissionManager,
        };

        const tool = toolRegistry.find((t) => t.name === toolName);
        if (!tool) throw new Error(`Unknown tool: ${toolName}`);

        const analyticsData: ToolAnalyticsData = {
          name: toolName,
          sessionId: this.context.sessionId,
          permissions,
        };

        if (toolName === "computer" && action) {
          analyticsData.action = action;
        }
        if (domain) {
          analyticsData.domain = domain;
        }

        try {
          // Cast toolRegistry since coerceParameterTypes uses a slightly different Tool type from utils.ts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coercedParams = coerceParameterTypes(toolName, params, toolRegistry as any);
          const result = await tool.execute(coercedParams ?? {}, executionContext);

          if ("type" in result) {
            analyticsData.success = false;
            span.setAttribute("success", false);
            span.setAttribute("failure_reason", "needs_permission");
          } else {
            analyticsData.success = !result.error;
            span.setAttribute("success", !result.error);
          }

          // Record GIF frame for certain tools
          if (!("type" in result) && !result.error && executionContext.tabId) {
            await this.recordGifFrame(toolName, coercedParams ?? {}, executionContext.tabId);
          }

          this.context.analytics?.track("claude_chrome.chat.tool_called", analyticsData);
          return result;
        } catch (err) {
          this.context.analytics?.track("claude_chrome.chat.tool_called", {
            ...analyticsData,
            success: false,
            failureReason: "exception",
          });
          throw err;
        }
      },
      analytics
    );
  }

  /**
   * Record a GIF frame for certain tool actions
   */
  async recordGifFrame(
    toolName: string,
    params: Record<string, unknown>,
    tabId: number
  ): Promise<void> {
    try {
      if (!["computer", "navigate"].includes(toolName)) return;

      const tab = await chrome.tabs.get(tabId);
      if (!tab) return;

      const groupId = tab.groupId ?? -1;
      if (!gifFrameStorage.isRecording(groupId)) return;

      let actionInfo: GifActionInfo | undefined;
      let screenshot: { base64: string; viewportWidth?: number; viewportHeight?: number; width?: number; height?: number };

      const computerParams = params as ComputerToolParams;
      const navigateParams = params as NavigateToolParams;

      if (toolName === "computer" && computerParams.action) {
        const actionType = computerParams.action;

        // Skip screenshot actions
        if (actionType === "screenshot") return;

        actionInfo = {
          type: actionType,
          coordinate: computerParams.coordinate,
          start_coordinate: computerParams.start_coordinate,
          text: computerParams.text,
          timestamp: Date.now(),
        };

        if (actionType.includes("click")) {
          actionInfo.description = "Clicked";
        } else if (actionType === "type" && computerParams.text) {
          actionInfo.description = `Typed: "${computerParams.text}"`;
        } else if (actionType === "key" && computerParams.text) {
          actionInfo.description = `Pressed key: ${computerParams.text}`;
        } else if (actionType === "scroll") {
          actionInfo.description = "Scrolled";
        } else if (actionType === "left_click_drag") {
          actionInfo.description = "Dragged";
        } else {
          actionInfo.description = actionType;
        }
      } else if (toolName === "navigate" && navigateParams.url) {
        actionInfo = {
          type: "navigate",
          timestamp: Date.now(),
          description: `Navigated to ${navigateParams.url}`,
        };
      }

      // For click/drag actions, add frame with action overlay on previous screenshot
      if (actionInfo && (actionInfo.type.includes("click") || actionInfo.type === "left_click_drag")) {
        const frames = gifFrameStorage.getFrames(groupId);
        if (frames.length > 0) {
          const lastFrame = frames[frames.length - 1] as GifFrame;
          const overlayFrame: GifFrame = {
            base64: lastFrame.base64,
            action: actionInfo,
            frameNumber: frames.length,
            timestamp: Date.now(),
            viewportWidth: lastFrame.viewportWidth,
            viewportHeight: lastFrame.viewportHeight,
            devicePixelRatio: lastFrame.devicePixelRatio,
          };
          gifFrameStorage.addFrame(groupId, overlayFrame);
        }
      }

      // Wait briefly then capture screenshot
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      try {
        screenshot = await cdpDebugger.screenshot(tabId);
      } catch {
        return;
      }

      // Get device pixel ratio
      let devicePixelRatio = 1;
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.devicePixelRatio,
        });
        if (result && result[0]?.result) {
          devicePixelRatio = result[0].result as number;
        }
      } catch {
        // Ignore errors
      }

      const frameNumber = gifFrameStorage.getFrames(groupId).length;
      const frame: GifFrame = {
        base64: screenshot.base64,
        action: actionInfo,
        frameNumber,
        timestamp: Date.now(),
        viewportWidth: screenshot.viewportWidth || screenshot.width,
        viewportHeight: screenshot.viewportHeight || screenshot.height,
        devicePixelRatio,
      };

      gifFrameStorage.addFrame(groupId, frame);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Process multiple tool calls and return formatted results
   */
  async processToolResults(toolCalls: ToolCall[]): Promise<FormattedToolResult[]> {
    const results: FormattedToolResult[] = [];

    const formatContent = (result: ToolResult): ToolResultContent[] | string => {
      if ("error" in result && result.error) return result.error;

      const content: ToolResultContent[] = [];
      if ("output" in result && result.output) {
        content.push({ type: "text", text: result.output });
      }

      if ("tabContext" in result && result.tabContext) {
        const contextText = `\n\nTab Context:${
          result.tabContext.executedOnTabId
            ? `\n- Executed on tabId: ${result.tabContext.executedOnTabId}`
            : ""
        }\n- Available tabs:\n${result.tabContext.availableTabs
          .map((t) => `  \u2022 tabId ${t.id}: "${t.title}" (${t.url})`)
          .join("\n")}`;
        content.push({ type: "text", text: contextText });
      }

      if ("base64Image" in result && result.base64Image) {
        const mimeType = result.imageFormat ? `image/${result.imageFormat}` : "image/png";
        // Use MCP format for images (data and mimeType at top level)
        content.push({
          type: "image",
          data: result.base64Image,
          mimeType,
        } as unknown as ToolResultContent);
      }

      return content.length > 0 ? content : "";
    };

    const formatToolResult = (toolUseId: string, result: ToolResult): FormattedToolResult => {
      const isError = "error" in result && !!result.error;
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: formatContent(result),
        ...(isError && { is_error: true }),
      };
    };

    for (const call of toolCalls) {
      try {
        const result = await this.handleToolCall(call.name, call.input, call.id);

        if ("type" in result && result.type === "permission_required") {
          if (!this.context.onPermissionRequired || !this.context.tabId) {
            results.push(
              formatToolResult(call.id, {
                error: "Permission required but no handler or tab id available",
              })
            );
            continue;
          }

          const approved = await this.context.onPermissionRequired(
            result as PermissionRequiredResult,
            this.context.tabId
          );
          if (!approved) {
            results.push(
              formatToolResult(call.id, {
                error:
                  call.name === "update_plan"
                    ? "Plan rejected by user. Ask the user how they would like to change the plan."
                    : "Permission denied by user",
              })
            );
            continue;
          }

          if (call.name === "update_plan") {
            results.push(
              formatToolResult(call.id, {
                output:
                  "User has approved your plan. You can now start executing the plan. Start with updating your todo list if applicable.",
              })
            );
            continue;
          }

          const retryResult = await this.handleToolCall(call.name, call.input, call.id);
          if ("type" in retryResult && retryResult.type === "permission_required") {
            throw new Error("Permission still required after granting");
          }
          results.push(formatToolResult(call.id, retryResult));
        } else {
          results.push(formatToolResult(call.id, result));
        }
      } catch (err) {
        results.push(
          formatToolResult(call.id, {
            error: err instanceof Error ? err.message : "Unknown error",
          })
        );
      }
    }

    return results;
  }
}

// =============================================================================
// Stub PermissionManager
// =============================================================================

/**
 * Stub PermissionManager for MCP mode
 * Always returns allowed based on skipCheck flag
 */
class StubPermissionManager implements PermissionManager {
  private skipCheck: () => boolean;

  constructor(skipCheck: () => boolean, opts: Record<string, unknown>) {
    this.skipCheck = skipCheck;
  }

  async checkPermission(url: string, toolUseId: string | undefined): Promise<PermissionCheckResult> {
    return { allowed: this.skipCheck(), needsPrompt: false };
  }
}

// =============================================================================
// Module State
// =============================================================================

// Singleton tool handler instance
let toolHandlerInstance: ToolCallHandler | undefined;
let pendingErrorMessage: string | undefined;
let pendingErrorTimestamp: number | undefined;

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Context factory (Vt)
 * Get or create a singleton ToolCallHandler instance
 */
export async function getOrCreateToolHandler(
  tabId: number | undefined,
  tabGroupId: number | undefined
): Promise<ToolCallHandler> {
  if (toolHandlerInstance) {
    toolHandlerInstance.context.tabId = tabId;
    toolHandlerInstance.context.tabGroupId = tabGroupId;
    return toolHandlerInstance;
  }

  toolHandlerInstance = new ToolCallHandler({
    permissionManager: new StubPermissionManager(
      () => self.__skipPermissions || false,
      {}
    ),
    sessionId: "mcp-native-session",
    tabId,
    tabGroupId,
    onPermissionRequired: async (
      permRequest: PermissionRequiredResult,
      tabId: number
    ): Promise<boolean> => {
      if (self.__skipPermissions) return true;
      return await promptForMcpPermission(permRequest, tabId);
    },
  });

  return toolHandlerInstance;
}

/**
 * Permission prompt for MCP mode
 * Implementation handled in mcp-tools.js entry point
 */
async function promptForMcpPermission(
  permRequest: PermissionRequiredResult,
  tabId: number
): Promise<boolean> {
  return false;
}

// =============================================================================
// Export Functions
// =============================================================================

/**
 * Export permission prompt setter for mcp-tools.js
 */
export function setPermissionPromptHandler(handler: PermissionPromptHandler): void {
  if (toolHandlerInstance) {
    toolHandlerInstance.context.onPermissionRequired = handler;
  }
}

/**
 * Set pending error message
 */
export function setPendingError(message: string): void {
  pendingErrorMessage = message;
  pendingErrorTimestamp = Date.now();
}

/**
 * Get pending error info
 */
export function getPendingError(): PendingErrorInfo {
  return { message: pendingErrorMessage, timestamp: pendingErrorTimestamp };
}

/**
 * Clear pending error
 */
export function clearPendingError(): void {
  pendingErrorMessage = undefined;
  pendingErrorTimestamp = undefined;
}

