/**
 * tool-handler.ts - Tool execution engine
 *
 * Contains:
 * - ze: ToolCallHandler class
 * - We: tool registry array
 * - je: MCP-only tool names
 * - Vt: context factory
 */
import { re } from "./cdp-debugger.js";
import { coerceParameterTypes } from "./utils.js";
import { gifFrameStorage } from "./gif-tools.js";
// Import all tools
import { readPageTool, formInputTool, getPageTextTool, javascriptTool } from "./page-tools.js";
import { computerTool } from "./computer-tool.js";
import { navigateTool, tabsContextTool, tabsCreateTool, tabsContextMcpTool, tabsCreateMcpTool } from "./navigation-tools.js";
import { updatePlanTool } from "./plan-tools.js";
import { gifCreatorTool } from "./gif-tools.js";
import { uploadImageTool, readConsoleMessagesTool, readNetworkRequestsTool, resizeWindowTool, turnAnswerStartTool, shortcutsListTool, shortcutsExecuteTool, } from "./utility-tools.js";
// =============================================================================
// Helpers
// =============================================================================
/**
 * Stub trace function - just executes the function directly
 */
const trace = async (name, fn, ...args) => fn({ setAttribute: () => { } });
// =============================================================================
// Tool Registry
// =============================================================================
/**
 * Tool registry array (We)
 * Contains all available tools for execution
 */
export const toolRegistry = [
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
];
/**
 * MCP-only tool names (je)
 * These tools don't require a tab to be present
 */
export const mcpOnlyToolNames = ["tabs_context_mcp", "tabs_create_mcp"];
// =============================================================================
// ToolCallHandler Class
// =============================================================================
/**
 * ToolCallHandler class (ze)
 * Main class for handling tool execution
 */
export class ToolCallHandler {
    context;
    constructor(context) {
        this.context = context;
    }
    /**
     * Handle a single tool call
     */
    async handleToolCall(toolName, params, toolUseId, permissions, domain, analytics) {
        const action = params.action;
        return await trace(`tool_execution_${toolName}${action ? "_" + action : ""}`, async (span) => {
            if (!this.context.tabId && !mcpOnlyToolNames.includes(toolName)) {
                throw new Error("No tab available");
            }
            span.setAttribute("session_id", this.context.sessionId);
            span.setAttribute("tool_name", toolName);
            if (permissions)
                span.setAttribute("permissions", permissions);
            if (action)
                span.setAttribute("action", action);
            const executionContext = {
                toolUseId,
                tabId: this.context.tabId,
                tabGroupId: this.context.tabGroupId,
                model: this.context.model,
                sessionId: this.context.sessionId,
                permissionManager: this.context.permissionManager,
            };
            const tool = toolRegistry.find((t) => t.name === toolName);
            if (!tool)
                throw new Error(`Unknown tool: ${toolName}`);
            const analyticsData = {
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
                const coercedParams = coerceParameterTypes(toolName, params, toolRegistry);
                const result = await tool.execute(coercedParams ?? {}, executionContext);
                if ("type" in result) {
                    analyticsData.success = false;
                    span.setAttribute("success", false);
                    span.setAttribute("failure_reason", "needs_permission");
                }
                else {
                    analyticsData.success = !result.error;
                    span.setAttribute("success", !result.error);
                }
                // Record GIF frame for certain tools
                if (!("type" in result) && !result.error && executionContext.tabId) {
                    await this.recordGifFrame(toolName, coercedParams ?? {}, executionContext.tabId);
                }
                this.context.analytics?.track("claude_chrome.chat.tool_called", analyticsData);
                return result;
            }
            catch (err) {
                this.context.analytics?.track("claude_chrome.chat.tool_called", {
                    ...analyticsData,
                    success: false,
                    failureReason: "exception",
                });
                throw err;
            }
        }, analytics);
    }
    /**
     * Record a GIF frame for certain tool actions
     */
    async recordGifFrame(toolName, params, tabId) {
        try {
            if (!["computer", "navigate"].includes(toolName))
                return;
            const tab = await chrome.tabs.get(tabId);
            if (!tab)
                return;
            const groupId = tab.groupId ?? -1;
            if (!gifFrameStorage.isRecording(groupId))
                return;
            let actionInfo;
            let screenshot;
            const computerParams = params;
            const navigateParams = params;
            if (toolName === "computer" && computerParams.action) {
                const actionType = computerParams.action;
                // Skip screenshot actions
                if (actionType === "screenshot")
                    return;
                actionInfo = {
                    type: actionType,
                    coordinate: computerParams.coordinate,
                    start_coordinate: computerParams.start_coordinate,
                    text: computerParams.text,
                    timestamp: Date.now(),
                };
                if (actionType.includes("click")) {
                    actionInfo.description = "Clicked";
                }
                else if (actionType === "type" && computerParams.text) {
                    actionInfo.description = `Typed: "${computerParams.text}"`;
                }
                else if (actionType === "key" && computerParams.text) {
                    actionInfo.description = `Pressed key: ${computerParams.text}`;
                }
                else if (actionType === "scroll") {
                    actionInfo.description = "Scrolled";
                }
                else if (actionType === "left_click_drag") {
                    actionInfo.description = "Dragged";
                }
                else {
                    actionInfo.description = actionType;
                }
            }
            else if (toolName === "navigate" && navigateParams.url) {
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
                    const lastFrame = frames[frames.length - 1];
                    const overlayFrame = {
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
            await new Promise((resolve) => setTimeout(resolve, 100));
            try {
                screenshot = await re.screenshot(tabId);
            }
            catch {
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
                    devicePixelRatio = result[0].result;
                }
            }
            catch {
                // Ignore errors
            }
            const frameNumber = gifFrameStorage.getFrames(groupId).length;
            const frame = {
                base64: screenshot.base64,
                action: actionInfo,
                frameNumber,
                timestamp: Date.now(),
                viewportWidth: screenshot.viewportWidth || screenshot.width,
                viewportHeight: screenshot.viewportHeight || screenshot.height,
                devicePixelRatio,
            };
            gifFrameStorage.addFrame(groupId, frame);
        }
        catch {
            // Ignore errors
        }
    }
    /**
     * Process multiple tool calls and return formatted results
     */
    async processToolResults(toolCalls) {
        const results = [];
        const formatContent = (result) => {
            if ("error" in result && result.error)
                return result.error;
            const content = [];
            if ("output" in result && result.output) {
                content.push({ type: "text", text: result.output });
            }
            if ("tabContext" in result && result.tabContext) {
                const contextText = `\n\nTab Context:${result.tabContext.executedOnTabId
                    ? `\n- Executed on tabId: ${result.tabContext.executedOnTabId}`
                    : ""}\n- Available tabs:\n${result.tabContext.availableTabs
                    .map((t) => `  \u2022 tabId ${t.id}: "${t.title}" (${t.url})`)
                    .join("\n")}`;
                content.push({ type: "text", text: contextText });
            }
            if ("base64Image" in result && result.base64Image) {
                const mediaType = result.imageFormat ? `image/${result.imageFormat}` : "image/png";
                content.push({
                    type: "image",
                    source: { type: "base64", media_type: mediaType, data: result.base64Image },
                });
            }
            return content.length > 0 ? content : "";
        };
        const formatToolResult = (toolUseId, result) => {
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
                        results.push(formatToolResult(call.id, {
                            error: "Permission required but no handler or tab id available",
                        }));
                        continue;
                    }
                    const approved = await this.context.onPermissionRequired(result, this.context.tabId);
                    if (!approved) {
                        results.push(formatToolResult(call.id, {
                            error: call.name === "update_plan"
                                ? "Plan rejected by user. Ask the user how they would like to change the plan."
                                : "Permission denied by user",
                        }));
                        continue;
                    }
                    if (call.name === "update_plan") {
                        results.push(formatToolResult(call.id, {
                            output: "User has approved your plan. You can now start executing the plan. Start with updating your todo list if applicable.",
                        }));
                        continue;
                    }
                    const retryResult = await this.handleToolCall(call.name, call.input, call.id);
                    if ("type" in retryResult && retryResult.type === "permission_required") {
                        throw new Error("Permission still required after granting");
                    }
                    results.push(formatToolResult(call.id, retryResult));
                }
                else {
                    results.push(formatToolResult(call.id, result));
                }
            }
            catch (err) {
                results.push(formatToolResult(call.id, {
                    error: err instanceof Error ? err.message : "Unknown error",
                }));
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
class StubPermissionManager {
    skipCheck;
    constructor(skipCheck, opts) {
        this.skipCheck = skipCheck;
    }
    async checkPermission(url, toolUseId) {
        return { allowed: this.skipCheck(), needsPrompt: false };
    }
}
// =============================================================================
// Module State
// =============================================================================
// Singleton tool handler instance
let toolHandlerInstance;
let pendingErrorMessage;
let pendingErrorTimestamp;
// =============================================================================
// Factory Functions
// =============================================================================
/**
 * Context factory (Vt)
 * Get or create a singleton ToolCallHandler instance
 */
export async function getOrCreateToolHandler(tabId, tabGroupId) {
    if (toolHandlerInstance) {
        toolHandlerInstance.context.tabId = tabId;
        toolHandlerInstance.context.tabGroupId = tabGroupId;
        return toolHandlerInstance;
    }
    toolHandlerInstance = new ToolCallHandler({
        permissionManager: new StubPermissionManager(() => self.__skipPermissions || false, {}),
        sessionId: "mcp-native-session",
        tabId,
        tabGroupId,
        onPermissionRequired: async (permRequest, tabId) => {
            if (self.__skipPermissions)
                return true;
            return await promptForMcpPermission(permRequest, tabId);
        },
    });
    return toolHandlerInstance;
}
/**
 * Permission prompt for MCP mode
 * Implementation handled in mcp-tools.js entry point
 */
async function promptForMcpPermission(permRequest, tabId) {
    return false;
}
// =============================================================================
// Export Functions
// =============================================================================
/**
 * Export permission prompt setter for mcp-tools.js
 */
export function setPermissionPromptHandler(handler) {
    if (toolHandlerInstance) {
        toolHandlerInstance.context.onPermissionRequired = handler;
    }
}
/**
 * Set pending error message
 */
export function setPendingError(message) {
    pendingErrorMessage = message;
    pendingErrorTimestamp = Date.now();
}
/**
 * Get pending error info
 */
export function getPendingError() {
    return { message: pendingErrorMessage, timestamp: pendingErrorTimestamp };
}
/**
 * Clear pending error
 */
export function clearPendingError() {
    pendingErrorMessage = undefined;
    pendingErrorTimestamp = undefined;
}
// =============================================================================
// Aliases for Backward Compatibility
// =============================================================================
export { ToolCallHandler as ze };
export { toolRegistry as We };
export { mcpOnlyToolNames as je };
export { getOrCreateToolHandler as Vt };
