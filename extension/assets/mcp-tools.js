/**
 * mcp-tools.ts - MCP (Model Context Protocol) Tools Entry Point
 *
 * This is the main entry point that orchestrates all MCP tool modules.
 *
 * EXPORTS for service-worker.js:
 *   L (nr) = notifyDisconnection
 *   t (K)  = TabGroupManager singleton
 *   M (Xt) = createErrorResponse
 *   N (Qt) = executeToolRequest
 *
 * Additional exports for other modules.
 */
// Core imports
import { re, setTabGroupManager } from "./cdp-debugger.js";
import { K, D, setDomainCategoryCache } from "./tab-group-manager.js";
import { d as getOrCreateAnonymousId } from "./storage.js";
// Module imports
import { isRestrictedUrl, formatTabContextResponse as U, stripSystemReminders as P, toAnthropicSchemas as G, coerceParameterTypes as B, parseArrayParam as O, findImageInMessages as $, } from "./utils.js";
import { W } from "./domain-cache.js";
import { computerTool as ie } from "./computer-tool.js";
import { readPageTool as le, formInputTool as de, getPageTextTool as he, javascriptTool as De } from "./page-tools.js";
import { navigateTool as Y, tabsContextTool as me, tabsCreateTool as ge } from "./navigation-tools.js";
import { shouldEnterPlanMode as be, getPlanModeReminder as we, filterAndApproveDomains as ye, updatePlanTool as Ie } from "./plan-tools.js";
import { gifCreatorTool as Ce } from "./gif-tools.js";
import { uploadImageTool as Te, readConsoleMessagesTool as ke, readNetworkRequestsTool as _e, resizeWindowTool as Ee, turnAnswerStartTool as Me } from "./utility-tools.js";
import { getOrCreateToolHandler as Vt, setPermissionPromptHandler, setPendingError, getPendingError, clearPendingError, } from "./tool-handler.js";
// Initialize dependency injection
setDomainCategoryCache(W);
setTabGroupManager(K);
// ============================================================================
// Navigation and tab context helpers
// ============================================================================
/**
 * Check if tab is main or secondary tab in a group (Re)
 */
async function checkTabContext(mainTabId, targetTabId) {
    const isMainTab = targetTabId === mainTabId;
    await K.initialize();
    const group = await K.findGroupByTab(targetTabId);
    return {
        isMainTab,
        isSecondaryTab: !!group && group.mainTabId === mainTabId && targetTabId !== mainTabId,
        group,
    };
}
/**
 * Check if category is restricted (Ue)
 */
function isRestrictedCategory(category) {
    return category === "category1" || category === "category2";
}
/**
 * Get hostname from URL (Pe)
 */
function getHostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    }
    catch {
        return null;
    }
}
/**
 * Check for domain change during navigation (Ge)
 */
function checkDomainChange(oldUrl, newUrl) {
    if (!oldUrl)
        return null;
    if (oldUrl.startsWith("chrome://") ||
        oldUrl.startsWith("chrome-extension://") ||
        oldUrl.startsWith("about:") ||
        oldUrl === "") {
        return null;
    }
    const oldDomain = getHostnameFromUrl(oldUrl);
    const newDomain = getHostnameFromUrl(newUrl);
    if (oldDomain && newDomain && oldDomain !== newDomain && oldDomain !== "newtab") {
        return { oldDomain, newDomain };
    }
    return null;
}
/**
 * Update tab blocklist status (Be)
 */
async function updateBlocklistStatus(tabId, url) {
    const category = await W.getCategory(url);
    await K.updateTabBlocklistStatus(tabId, url);
    return category ?? null;
}
/**
 * Get blocked page URL (Oe)
 */
function getBlockedPageUrl(url) {
    return chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(url)}`);
}
/**
 * Create domain transition permission request ($e)
 */
function createDomainTransitionRequest(fromDomain, toDomain, url, sourceTabId, isSecondaryTab) {
    return {
        type: "permission_required",
        tool: "domain_transition",
        url,
        toolUseId: crypto.randomUUID(),
        actionData: {
            fromDomain,
            toDomain,
            sourceTabId,
            isSecondaryTab,
        },
    };
}
/**
 * Feature flags stub (qe) - disabled for MCP mode
 */
async function getFeatureFlags(context) {
    return {};
}
// ============================================================================
// MCP Tool Execution State
// ============================================================================
const activeToolCalls = new Map(); // Zt
const prefixTimeouts = new Map(); // er
const PREFIX_TIMEOUT_MS = 20000; // tr
/**
 * Clean up after tool execution (rr)
 */
function cleanupAfterToolExecution(tabId, clientId) {
    if (activeToolCalls.has(tabId)) {
        activeToolCalls.get(tabId);
        activeToolCalls.delete(tabId);
        const timeout = setTimeout(async () => {
            if (!activeToolCalls.has(tabId) && prefixTimeouts.has(tabId)) {
                K.addCompletionPrefix(tabId).catch(() => { });
                prefixTimeouts.set(tabId, null);
                try {
                    await re.detachDebugger(tabId);
                }
                catch { }
            }
        }, PREFIX_TIMEOUT_MS);
        prefixTimeouts.set(tabId, timeout);
    }
}
/**
 * Clean up tab completely (or)
 */
function cleanupTab(tabId) {
    const timeout = prefixTimeouts.get(tabId);
    if (timeout)
        clearTimeout(timeout);
    prefixTimeouts.delete(tabId);
    K.removePrefix(tabId).catch(() => { });
}
/**
 * Notify disconnection - called when native host disconnects (nr)
 */
async function notifyDisconnection() {
    try {
        const groups = await K.getAllGroups();
        for (const group of groups) {
            cleanupTab(group.mainTabId);
        }
    }
    catch { }
}
// ============================================================================
// Permission Prompt for MCP Mode
// ============================================================================
let permissionPromptChain = Promise.resolve(true); // ir
async function promptForMcpPermission(permRequest, tabId) {
    const result = permissionPromptChain.then(() => showPermissionPromptWindow(permRequest, tabId));
    permissionPromptChain = result.catch(() => false);
    return result;
}
async function showPermissionPromptWindow(permRequest, tabId) {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    // Clear any existing prefix timeout
    const existingTimeout = prefixTimeouts.get(tabId);
    if (existingTimeout)
        clearTimeout(existingTimeout);
    // Show permission prefix
    await K.addPermissionPrefix(tabId);
    prefixTimeouts.set(tabId, null);
    // Store prompt data
    await chrome.storage.local.set({
        [`mcp_prompt_${requestId}`]: { prompt: permRequest, tabId, timestamp: Date.now() },
    });
    return new Promise((resolve) => {
        let windowId;
        let resolved = false;
        const cleanup = async (allowed = false) => {
            if (resolved)
                return;
            resolved = true;
            chrome.runtime.onMessage.removeListener(messageHandler);
            await chrome.storage.local.remove(`mcp_prompt_${requestId}`);
            if (windowId) {
                chrome.windows.remove(windowId).catch(() => { });
            }
            await K.addLoadingPrefix(tabId);
            prefixTimeouts.set(tabId, null);
            resolve(allowed);
        };
        const messageHandler = (message) => {
            if (message.type === "MCP_PERMISSION_RESPONSE" && message.requestId === requestId) {
                cleanup(message.allowed);
            }
        };
        chrome.runtime.onMessage.addListener(messageHandler);
        chrome.windows.create({
            url: chrome.runtime.getURL(`sidepanel.html?tabId=${tabId}&mcpPermissionOnly=true&requestId=${requestId}`),
            type: "popup",
            width: 600,
            height: 600,
            focused: true,
        }, (window) => {
            if (window) {
                windowId = window.id;
            }
            else {
                cleanup(false);
            }
        });
        // Timeout after 30 seconds
        setTimeout(() => {
            cleanup(false);
        }, 30000);
    });
}
// Set up permission handler
setPermissionPromptHandler(async (permRequest, tabId) => {
    if (self.__skipPermissions)
        return true;
    return await promptForMcpPermission(permRequest, tabId);
});
// ============================================================================
// Main MCP Entry Points
// ============================================================================
/**
 * Create error response (Xt)
 */
const createErrorResponse = (message) => ({
    content: [{ type: "text", text: message }],
    is_error: true,
});
/**
 * Execute tool request - main entry point (Qt)
 */
async function executeToolRequest(request) {
    const toolUseId = crypto.randomUUID();
    const clientId = request.clientId;
    const startTime = Date.now();
    // Check for pending error from previous request
    const { message: pendingError, timestamp: pendingTimestamp } = getPendingError();
    if (pendingError && pendingTimestamp) {
        if (Date.now() - pendingTimestamp < 60000) {
            clearPendingError();
            return createErrorResponse(pendingError);
        }
        clearPendingError();
    }
    // Get tab for MCP
    let tabId;
    let domain;
    let tabGroupId;
    try {
        const tabInfo = await K.getTabForMcp(request.tabId, request.tabGroupId);
        tabId = tabInfo.tabId;
        domain = tabInfo.domain;
        // Guard against restricted URLs
        if (tabId !== undefined) {
            const tab = await chrome.tabs.get(tabId);
            if (isRestrictedUrl(tab?.url)) {
                return createErrorResponse(`Cannot interact with restricted URL: ${tab?.url}. Please navigate to a regular web page, or use the computer-control-mac tools to interact with browser UI.`);
            }
        }
    }
    catch {
        return createErrorResponse("No tabs available. Please open a new tab or window in Chrome.");
    }
    // Attach debugger if needed
    if (tabId !== undefined) {
        try {
            const wasAttached = await re.isDebuggerAttached(tabId);
            await re.attachDebugger(tabId);
            if (!wasAttached) {
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
        catch { }
    }
    let result;
    let hasError = false;
    try {
        // Set up loading indicator
        if (tabId !== undefined) {
            activeToolCalls.set(tabId, {
                toolName: request.toolName,
                requestId: toolUseId,
                startTime: Date.now(),
                errorCallback: (error) => {
                    setPendingError(error);
                },
            });
            await K.addTabToIndicatorGroup({
                tabId,
                isRunning: true,
                isMcp: true,
            });
            if (prefixTimeouts.has(tabId)) {
                const existingTimeout = prefixTimeouts.get(tabId);
                if (existingTimeout)
                    clearTimeout(existingTimeout);
                K.addLoadingPrefix(tabId).catch(() => { });
                prefixTimeouts.set(tabId, null);
            }
            else {
                K.addLoadingPrefix(tabId).catch(() => { });
                prefixTimeouts.set(tabId, null);
            }
        }
        // Execute tool
        const handler = await Vt(tabId, request.tabGroupId);
        const [toolResult] = await handler.processToolResults([
            { type: "tool_use", id: toolUseId, name: request.toolName, input: request.args },
        ]);
        result = toolResult;
        hasError = result?.is_error === true;
    }
    catch (err) {
        hasError = true;
        result = createErrorResponse(err instanceof Error ? err.message : String(err));
    }
    // Cleanup
    if (tabId !== undefined) {
        cleanupAfterToolExecution(tabId, clientId);
    }
    return result;
}
// ============================================================================
// WebNavigation Listener for Safety Checks
// ============================================================================
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0)
        return;
    if (!activeToolCalls.has(details.tabId))
        return;
    const callInfo = activeToolCalls.get(details.tabId);
    if (!callInfo)
        return;
    const { isMainTab, isSecondaryTab } = await checkTabContext(details.tabId, details.tabId);
    if (!isMainTab && !isSecondaryTab)
        return;
    await Vt(details.tabId, undefined);
    try {
        const category = await updateBlocklistStatus(details.tabId, details.url);
        if (category === "category1") {
            const blockedUrl = getBlockedPageUrl(details.url);
            await chrome.tabs.update(details.tabId, { url: blockedUrl });
            if (callInfo?.errorCallback) {
                callInfo.errorCallback("Cannot access this page. Computer Control cannot assist with the content on this page.");
            }
            cleanupAfterToolExecution(details.tabId);
            return;
        }
        await chrome.tabs.get(details.tabId);
        return undefined;
    }
    catch { }
});
// ============================================================================
// EXPORTS
// ============================================================================
export { 
// Main exports for service-worker.js
notifyDisconnection as L, K as t, createErrorResponse as M, executeToolRequest as N, 
// Tool exports
Ce as A, W as B, Me as C, De as D, B as E, U as F, ye as G, we as H, G as I, re as J, $ as K, 
// Helper exports
checkTabContext as a, getOrCreateAnonymousId as b, isRestrictedCategory as c, getBlockedPageUrl as d, checkDomainChange as e, createDomainTransitionRequest as f, D as g, getFeatureFlags as h, de as j, ie as k, Y as l, he as m, be as n, Ie as o, O as p, ge as q, le as r, P as s, updateBlocklistStatus as u, me as v, Te as w, ke as x, _e as y, Ee as z, };
