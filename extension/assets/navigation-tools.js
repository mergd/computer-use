/**
 * navigation-tools.ts - Navigation and tab management tools
 *
 * Contains tools for browser navigation and tab management:
 * - Y: navigate tool
 * - me: tabs_context tool
 * - ge: tabs_create tool
 * - tabs_context_mcp: MCP-specific tabs context
 * - tabs_create_mcp: MCP-specific tabs create
 */
import { K } from "./tab-group-manager.js";
import { T as ToolTypes } from "./storage.js";
import { DomainCategoryCache } from "./domain-cache.js";
import { formatTabsResponse } from "./utils.js";
// =============================================================================
// Constants
// =============================================================================
/** Session ID for MCP native mode */
export const MCP_NATIVE_SESSION = "mcp-native-session";
// =============================================================================
// Helper Functions
// =============================================================================
/**
 * Get tab group ID for a given tab
 */
async function getTabGroupId(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            return tab.groupId;
        }
    }
    catch {
        // Tab may not exist or be inaccessible
    }
    return undefined;
}
// =============================================================================
// Navigate Tool (Y)
// =============================================================================
export const navigateTool = {
    name: "navigate",
    description: "Navigate to a URL, or go forward/back in browser history. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
    parameters: {
        url: {
            type: "string",
            description: 'The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history.',
        },
        tabId: {
            type: "number",
            description: "Tab ID to navigate. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
    },
    execute: async (params, context) => {
        try {
            const { url, tabId } = params;
            if (!url)
                throw new Error("URL parameter is required");
            if (!context?.tabId)
                throw new Error("No active tab found");
            const effectiveTabId = await K.getEffectiveTabId(tabId, context.tabId);
            // Check domain category for non-navigation commands
            if (url && !["back", "forward"].includes(url.toLowerCase())) {
                try {
                    const category = await DomainCategoryCache.getCategory(url);
                    if (category &&
                        (category === "category1" || category === "category2" || category === "category_org_blocked")) {
                        return {
                            error: category === "category_org_blocked"
                                ? "This site is blocked by your organization's policy."
                                : "This site is not allowed due to safety restrictions.",
                        };
                    }
                }
                catch {
                    // Continue if category check fails
                }
            }
            const tab = await chrome.tabs.get(effectiveTabId);
            if (!tab.id)
                throw new Error("Active tab has no ID");
            // Handle back navigation
            if (url.toLowerCase() === "back") {
                await chrome.tabs.goBack(tab.id);
                await new Promise((resolve) => setTimeout(resolve, 100));
                const updatedTab = await chrome.tabs.get(tab.id);
                const tabsMetadata = await K.getValidTabsWithMetadata(context.tabId);
                return {
                    output: `Navigated back to ${updatedTab.url}`,
                    tabContext: {
                        currentTabId: context.tabId,
                        executedOnTabId: effectiveTabId,
                        availableTabs: tabsMetadata,
                        tabCount: tabsMetadata.length,
                    },
                };
            }
            // Handle forward navigation
            if (url.toLowerCase() === "forward") {
                await chrome.tabs.goForward(tab.id);
                await new Promise((resolve) => setTimeout(resolve, 100));
                const updatedTab = await chrome.tabs.get(tab.id);
                const tabsMetadata = await K.getValidTabsWithMetadata(context.tabId);
                return {
                    output: `Navigated forward to ${updatedTab.url}`,
                    tabContext: {
                        currentTabId: context.tabId,
                        executedOnTabId: effectiveTabId,
                        availableTabs: tabsMetadata,
                        tabCount: tabsMetadata.length,
                    },
                };
            }
            // Handle URL navigation
            let fullUrl = url;
            if (!fullUrl.match(/^https?:\/\//)) {
                fullUrl = `https://${fullUrl}`;
            }
            try {
                new URL(fullUrl);
            }
            catch {
                throw new Error(`Invalid URL: ${url}`);
            }
            const toolUseId = context?.toolUseId;
            const permResult = await context.permissionManager.checkPermission(fullUrl, toolUseId);
            if (!permResult.allowed) {
                if (permResult.needsPrompt) {
                    return {
                        type: "permission_required",
                        tool: ToolTypes.NAVIGATE,
                        url: fullUrl,
                        toolUseId,
                    };
                }
                return { error: "Navigation to this domain is not allowed" };
            }
            await chrome.tabs.update(effectiveTabId, { url: fullUrl });
            await new Promise((resolve) => setTimeout(resolve, 100));
            const tabsMetadata = await K.getValidTabsWithMetadata(context.tabId);
            return {
                output: `Navigated to ${fullUrl}`,
                tabContext: {
                    currentTabId: context.tabId,
                    executedOnTabId: effectiveTabId,
                    availableTabs: tabsMetadata,
                    tabCount: tabsMetadata.length,
                },
            };
        }
        catch (err) {
            return {
                error: `Failed to navigate: ${err instanceof Error ? err.message : "Unknown error"}`,
            };
        }
    },
    toAnthropicSchema: async () => ({
        name: "navigate",
        description: "Navigate to a URL, or go forward/back in browser history. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
        input_schema: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: 'The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history.',
                },
                tabId: {
                    type: "number",
                    description: "Tab ID to navigate. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
                },
            },
            required: ["url", "tabId"],
        },
    }),
};
// =============================================================================
// Tabs Context Tool (me)
// =============================================================================
export const tabsContextTool = {
    name: "tabs_context",
    description: "Get context information about all tabs in the current tab group",
    parameters: {},
    execute: async (_params, context) => {
        try {
            if (!context?.tabId)
                throw new Error("No active tab found");
            const isMcpNative = context.sessionId === MCP_NATIVE_SESSION;
            const tabsMetadata = await K.getValidTabsWithMetadata(context.tabId);
            const tabContext = {
                currentTabId: context.tabId,
                availableTabs: tabsMetadata,
                tabCount: tabsMetadata.length,
            };
            let tabGroupId;
            if (isMcpNative) {
                tabGroupId = await getTabGroupId(context.tabId);
            }
            const output = formatTabsResponse(tabsMetadata, tabGroupId);
            return tabGroupId !== undefined
                ? { output, tabContext: { ...tabContext, tabGroupId } }
                : { output, tabContext };
        }
        catch (err) {
            return {
                error: `Failed to query tabs: ${err instanceof Error ? err.message : "Unknown error"}`,
            };
        }
    },
    toAnthropicSchema: async () => ({
        name: "tabs_context",
        description: "Get context information about all tabs in the current tab group",
        input_schema: { type: "object", properties: {}, required: [] },
    }),
};
// =============================================================================
// Tabs Create Tool (ge)
// =============================================================================
export const tabsCreateTool = {
    name: "tabs_create",
    description: "Creates a new empty tab in the current tab group",
    parameters: {},
    execute: async (_params, context) => {
        try {
            if (!context?.tabId)
                throw new Error("No active tab found");
            const contextTab = await chrome.tabs.get(context.tabId);
            const newTab = await chrome.tabs.create({ url: "chrome://newtab", active: false });
            if (!newTab.id)
                throw new Error("Failed to create tab - no tab ID returned");
            if (contextTab.groupId && contextTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                await chrome.tabs.group({ tabIds: newTab.id, groupId: contextTab.groupId });
            }
            const tabsMetadata = await K.getValidTabsWithMetadata(context.tabId);
            return {
                output: `Created new tab. Tab ID: ${newTab.id}`,
                tabContext: {
                    currentTabId: context.tabId,
                    executedOnTabId: newTab.id,
                    availableTabs: tabsMetadata,
                    tabCount: tabsMetadata.length,
                },
            };
        }
        catch (err) {
            return {
                error: `Failed to create tab: ${err instanceof Error ? err.message : "Unknown error"}`,
            };
        }
    },
    toAnthropicSchema: async () => ({
        name: "tabs_create",
        description: "Creates a new empty tab in the current tab group",
        input_schema: { type: "object", properties: {}, required: [] },
    }),
};
// =============================================================================
// Tabs Context MCP Tool
// =============================================================================
export const tabsContextMcpTool = {
    name: "tabs_context_mcp",
    description: "Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist. Each new conversation should create its own new tab (using tabs_create) rather than reusing existing tabs, unless the user explicitly asks to use an existing tab.",
    parameters: {
        createIfEmpty: {
            type: "boolean",
            description: "Creates a new MCP tab group if none exists, creates a new Window with a new tab group containing an empty tab (which can be used for this conversation). If a MCP tab group already exists, this parameter has no effect.",
        },
    },
    execute: async (params) => {
        try {
            const { createIfEmpty } = params || {};
            await K.initialize();
            const mcpContext = await K.getOrCreateMcpTabContext({ createIfEmpty });
            if (!mcpContext) {
                return {
                    output: "No MCP tab groups found. Use createIfEmpty: true to create one.",
                };
            }
            const tabGroupId = mcpContext.tabGroupId;
            const availableTabs = mcpContext.availableTabs;
            return {
                output: formatTabsResponse(availableTabs, tabGroupId),
                tabContext: { ...mcpContext, tabGroupId },
            };
        }
        catch (err) {
            return {
                error: `Failed to query tabs: ${err instanceof Error ? err.message : "Unknown error"}`,
            };
        }
    },
    toAnthropicSchema: async () => ({
        name: "tabs_context_mcp",
        description: "Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist. Each new conversation should create its own new tab (using tabs_create) rather than reusing existing tabs, unless the user explicitly asks to use an existing tab.",
        input_schema: {
            type: "object",
            properties: {
                createIfEmpty: {
                    type: "boolean",
                    description: "Creates a new MCP tab group if none exists, creates a new Window with a new tab group containing an empty tab (which can be used for this conversation). If a MCP tab group already exists, this parameter has no effect.",
                },
            },
            required: [],
        },
    }),
};
// =============================================================================
// Tabs Create MCP Tool
// =============================================================================
export const tabsCreateMcpTool = {
    name: "tabs_create_mcp",
    description: "Creates a new empty tab in the MCP tab group.",
    parameters: {},
    execute: async () => {
        try {
            await K.initialize();
            const mcpContext = await K.getOrCreateMcpTabContext({ createIfEmpty: false });
            if (!mcpContext?.tabGroupId) {
                return {
                    error: "No MCP tab group exists. Use tabs_context_mcp with createIfEmpty: true first to create one.",
                };
            }
            const tabGroupId = mcpContext.tabGroupId;
            const newTab = await chrome.tabs.create({
                url: "chrome://newtab",
                active: true,
            });
            if (!newTab.id) {
                throw new Error("Failed to create tab - no tab ID returned");
            }
            await chrome.tabs.group({ tabIds: newTab.id, groupId: tabGroupId });
            const groupTabs = await chrome.tabs.query({ groupId: tabGroupId });
            const availableTabs = groupTabs
                .filter((tab) => tab.id !== undefined)
                .map((tab) => ({ id: tab.id, title: tab.title || "", url: tab.url || "" }));
            return {
                output: `Created new tab. Tab ID: ${newTab.id}`,
                tabContext: {
                    currentTabId: newTab.id,
                    executedOnTabId: newTab.id,
                    availableTabs,
                    tabCount: availableTabs.length,
                    tabGroupId,
                },
            };
        }
        catch (err) {
            return {
                error: `Failed to create tab: ${err instanceof Error ? err.message : "Unknown error"}`,
            };
        }
    },
    toAnthropicSchema: async () => ({
        name: "tabs_create_mcp",
        description: "Creates a new empty tab in the MCP tab group.",
        input_schema: { type: "object", properties: {}, required: [] },
    }),
};
// =============================================================================
// Backward Compatibility Aliases
// =============================================================================
export { navigateTool as Y };
export { tabsContextTool as me };
export { tabsCreateTool as ge };
