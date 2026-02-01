/**
 * mcp-tools.ts - MCP (Model Context Protocol) Tools Entry Point
 *
 * This is the main entry point that orchestrates all MCP tool modules.
 *
 * Main exports for service-worker.js:
 *   - notifyDisconnection
 *   - tabGroupManager
 *   - createErrorResponse
 *   - executeToolRequest
 *
 * Additional exports for other modules.
 */

// Core imports
import { cdpDebuggerInstance as cdpDebugger, screenshotContext, setTabGroupManager } from "./cdp-debugger.js";
import {
  tabGroupManagerInstance as tabGroupManager,
  TabGroupManager as TabGroupManagerClass,
  COMPUTER_CONTROL,
  MCP,
  getTabSubscriptionManagerInstance as getTabSubscriptionManager,
  TabSubscriptionManager as TabSubscriptionManagerClass,
  setDomainCategoryCache,
} from "./tab-group-manager.js";
import { StorageKeys, getOrCreateAnonymousId } from "./storage.js";

// Module imports
import {
  isRestrictedUrl,
  formatTabsResponse,
  formatTabContextResponse,
  stripSystemReminders,
  toAnthropicSchemas,
  coerceParameterTypes,
  parseArrayParam,
  findImageInMessages,
  extractHostname,
} from "./utils.js";

import { DomainCategoryCache } from "./domain-cache.js";
const domainCategoryCache = DomainCategoryCache;

import { computerTool } from "./computer-tool.js";
import { readPageTool, formInputTool, getPageTextTool, javascriptTool } from "./page-tools.js";
import {
  navigateTool,
  tabsContextTool,
  tabsCreateTool,
  tabsContextMcpTool,
  tabsCreateMcpTool,
  MCP_NATIVE_SESSION,
} from "./navigation-tools.js";
import {
  shouldEnterPlanMode,
  getPlanModeReminder,
  filterAndApproveDomains,
  planSchema,
  updatePlanTool,
} from "./plan-tools.js";
import { gifFrameStorage, gifCreatorTool, getActionDelay } from "./gif-tools.js";
import {
  uploadImageTool,
  readConsoleMessagesTool,
  readNetworkRequestsTool,
  resizeWindowTool,
  turnAnswerStartTool,
  shortcutsListTool,
  shortcutsExecuteTool,
} from "./utility-tools.js";
import {
  ToolCallHandler,
  toolRegistry,
  mcpOnlyToolNames,
  getOrCreateToolHandler,
  setPermissionPromptHandler,
  setPendingError,
  getPendingError,
  clearPendingError,
} from "./tool-handler.js";

// Import types
import type {
  McpToolRequest,
  McpErrorResponse,
  ActiveToolCallInfo,
  TabGroup,
  TabContextCheckResult,
  PermissionRequiredResult,
  DomainTransitionRequest,
  DomainCategory,
  FormattedToolResult,
} from "./types.js";

// Declare global self with __skipPermissions
declare const self: typeof globalThis & { __skipPermissions?: boolean };

// Initialize dependency injection
setDomainCategoryCache(domainCategoryCache);
setTabGroupManager(tabGroupManager);

// ============================================================================
// Navigation and tab context helpers
// ============================================================================

/**
 * Check if tab is main or secondary tab in a group
 */
async function checkTabContext(
  mainTabId: number,
  targetTabId: number
): Promise<TabContextCheckResult> {
  const isMainTab = targetTabId === mainTabId;
  await tabGroupManager.initialize();
  const group = await tabGroupManager.findGroupByTab(targetTabId);
  return {
    isMainTab,
    isSecondaryTab: !!group && group.mainTabId === mainTabId && targetTabId !== mainTabId,
    group,
  };
}

/**
 * Check if category is restricted
 */
function isRestrictedCategory(category: DomainCategory): boolean {
  return category === "category1" || category === "category2";
}

/**
 * Get hostname from URL
 */
function getHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Domain change result */
interface DomainChangeResult {
  oldDomain: string;
  newDomain: string;
}

/**
 * Check for domain change during navigation
 */
function checkDomainChange(oldUrl: string | undefined, newUrl: string): DomainChangeResult | null {
  if (!oldUrl) return null;
  if (
    oldUrl.startsWith("chrome://") ||
    oldUrl.startsWith("chrome-extension://") ||
    oldUrl.startsWith("about:") ||
    oldUrl === ""
  ) {
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
 * Update tab blocklist status
 */
async function updateBlocklistStatus(tabId: number, url: string): Promise<DomainCategory> {
  const category = await domainCategoryCache.getCategory(url);
  await tabGroupManager.updateTabBlocklistStatus(tabId, url);
  return category ?? null;
}

/**
 * Get blocked page URL
 */
function getBlockedPageUrl(url: string): string {
  return chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(url)}`);
}

/** Domain transition action data */
interface DomainTransitionActionData {
  fromDomain: string;
  toDomain: string;
  sourceTabId: number;
  isSecondaryTab: boolean;
}

/**
 * Create domain transition permission request
 */
function createDomainTransitionRequest(
  fromDomain: string,
  toDomain: string,
  url: string,
  sourceTabId: number,
  isSecondaryTab: boolean
): DomainTransitionRequest {
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

/** Feature flags context (unused in MCP mode) */
interface FeatureFlagsContext {
  [key: string]: unknown;
}

/** Feature flags result */
interface FeatureFlags {
  [key: string]: unknown;
}

/**
 * Feature flags stub - disabled for MCP mode
 */
async function getFeatureFlags(context: FeatureFlagsContext): Promise<FeatureFlags> {
  return {};
}

// ============================================================================
// MCP Tool Execution State
// ============================================================================

const activeToolCalls: Map<number, ActiveToolCallInfo> = new Map();
const prefixTimeouts: Map<number, ReturnType<typeof setTimeout> | null> = new Map();
const PREFIX_TIMEOUT_MS = 20000;

/**
 * Clean up after tool execution
 */
function cleanupAfterToolExecution(tabId: number, clientId?: string): void {
  if (activeToolCalls.has(tabId)) {
    activeToolCalls.get(tabId);
    activeToolCalls.delete(tabId);

    const timeout = setTimeout(async () => {
      if (!activeToolCalls.has(tabId) && prefixTimeouts.has(tabId)) {
        tabGroupManager.addCompletionPrefix(tabId).catch(() => {});
        prefixTimeouts.set(tabId, null);
        try {
          await cdpDebugger.detachDebugger(tabId);
        } catch {}
      }
    }, PREFIX_TIMEOUT_MS);

    prefixTimeouts.set(tabId, timeout);
  }
}

/**
 * Clean up tab completely
 */
function cleanupTab(tabId: number): void {
  const timeout = prefixTimeouts.get(tabId);
  if (timeout) clearTimeout(timeout);
  prefixTimeouts.delete(tabId);
  tabGroupManager.removePrefix(tabId).catch(() => {});
}

/**
 * Notify disconnection - called when native host disconnects
 */
async function notifyDisconnection(): Promise<void> {
  try {
    const groups = await tabGroupManager.getAllGroups();
    for (const group of groups) {
      cleanupTab(group.mainTabId);
    }
  } catch {}
}

// ============================================================================
// Permission Prompt for MCP Mode
// ============================================================================

let permissionPromptChain: Promise<boolean> = Promise.resolve(true);

async function promptForMcpPermission(
  permRequest: PermissionRequiredResult,
  tabId: number
): Promise<boolean> {
  const result = permissionPromptChain.then(() =>
    showPermissionPromptWindow(permRequest, tabId)
  );
  permissionPromptChain = result.catch(() => false);
  return result;
}

async function showPermissionPromptWindow(
  permRequest: PermissionRequiredResult,
  tabId: number
): Promise<boolean> {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  // Clear any existing prefix timeout
  const existingTimeout = prefixTimeouts.get(tabId);
  if (existingTimeout) clearTimeout(existingTimeout);

  // Show permission prefix
  await tabGroupManager.addPermissionPrefix(tabId);
  prefixTimeouts.set(tabId, null);

  // Store prompt data
  await chrome.storage.local.set({
    [`mcp_prompt_${requestId}`]: { prompt: permRequest, tabId, timestamp: Date.now() },
  });

  return new Promise((resolve) => {
    let windowId: number | undefined;
    let resolved = false;

    const cleanup = async (allowed = false): Promise<void> => {
      if (resolved) return;
      resolved = true;
      chrome.runtime.onMessage.removeListener(messageHandler);
      await chrome.storage.local.remove(`mcp_prompt_${requestId}`);
      if (windowId) {
        chrome.windows.remove(windowId).catch(() => {});
      }
      await tabGroupManager.addLoadingPrefix(tabId);
      prefixTimeouts.set(tabId, null);
      resolve(allowed);
    };

    interface PermissionResponseMessage {
      type: string;
      requestId: string;
      allowed: boolean;
    }

    const messageHandler = (message: PermissionResponseMessage): void => {
      if (message.type === "MCP_PERMISSION_RESPONSE" && message.requestId === requestId) {
        cleanup(message.allowed);
      }
    };

    chrome.runtime.onMessage.addListener(messageHandler);

    chrome.windows.create(
      {
        url: chrome.runtime.getURL(
          `sidepanel.html?tabId=${tabId}&mcpPermissionOnly=true&requestId=${requestId}`
        ),
        type: "popup",
        width: 600,
        height: 600,
        focused: true,
      },
      (window) => {
        if (window) {
          windowId = window.id;
        } else {
          cleanup(false);
        }
      }
    );

    // Timeout after 30 seconds
    setTimeout(() => {
      cleanup(false);
    }, 30000);
  });
}

// Set up permission handler
setPermissionPromptHandler(async (permRequest, tabId) => {
  if (self.__skipPermissions) return true;
  return await promptForMcpPermission(permRequest, tabId);
});

// ============================================================================
// Main MCP Entry Points
// ============================================================================

/**
 * Create error response
 */
const createErrorResponse = (message: string): McpErrorResponse => ({
  content: [{ type: "text", text: message }],
  is_error: true,
});

/**
 * Execute tool request - main entry point
 */
async function executeToolRequest(
  request: McpToolRequest
): Promise<FormattedToolResult | McpErrorResponse> {
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
  let tabId: number | undefined;
  let domain: string | undefined;
  let tabGroupId: number | undefined;
  try {
    const tabInfo = await tabGroupManager.getTabForMcp(request.tabId, request.tabGroupId);
    tabId = tabInfo.tabId;
    domain = tabInfo.domain;

    // Guard against restricted URLs
    if (tabId !== undefined) {
      const tab = await chrome.tabs.get(tabId);
      if (isRestrictedUrl(tab?.url)) {
        return createErrorResponse(
          `Cannot interact with restricted URL: ${tab?.url}. Please navigate to a regular web page, or use the computer-control-mac tools to interact with browser UI.`
        );
      }
    }
  } catch {
    return createErrorResponse("No tabs available. Please open a new tab or window in Chrome.");
  }

  // Attach debugger if needed
  if (tabId !== undefined) {
    try {
      const wasAttached = await cdpDebugger.isDebuggerAttached(tabId);
      await cdpDebugger.attachDebugger(tabId);
      if (!wasAttached) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch {}
  }

  let result: FormattedToolResult | McpErrorResponse;
  let hasError = false;

  try {
    // Set up loading indicator
    if (tabId !== undefined) {
      activeToolCalls.set(tabId, {
        toolName: request.toolName,
        requestId: toolUseId,
        startTime: Date.now(),
        errorCallback: (error: string) => {
          setPendingError(error);
        },
      });

      await tabGroupManager.addTabToIndicatorGroup({
        tabId,
        isRunning: true,
        isMcp: true,
      });

      if (prefixTimeouts.has(tabId)) {
        const existingTimeout = prefixTimeouts.get(tabId);
        if (existingTimeout) clearTimeout(existingTimeout);
        tabGroupManager.addLoadingPrefix(tabId).catch(() => {});
        prefixTimeouts.set(tabId, null);
      } else {
        tabGroupManager.addLoadingPrefix(tabId).catch(() => {});
        prefixTimeouts.set(tabId, null);
      }
    }

    // Execute tool
    const handler = await getOrCreateToolHandler(tabId, request.tabGroupId);
    const [toolResult] = await handler.processToolResults([
      { type: "tool_use", id: toolUseId, name: request.toolName, input: request.args },
    ]);
    result = toolResult;
    hasError = result?.is_error === true;
  } catch (err) {
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
  if (details.frameId !== 0) return;
  if (!activeToolCalls.has(details.tabId)) return;

  const callInfo = activeToolCalls.get(details.tabId);
  if (!callInfo) return;

  const { isMainTab, isSecondaryTab } = await checkTabContext(details.tabId, details.tabId);
  if (!isMainTab && !isSecondaryTab) return;

  await getOrCreateToolHandler(details.tabId, undefined);

  try {
    const category = await updateBlocklistStatus(details.tabId, details.url);

    if (category === "category1") {
      const blockedUrl = getBlockedPageUrl(details.url);
      await chrome.tabs.update(details.tabId, { url: blockedUrl });

      if (callInfo?.errorCallback) {
        callInfo.errorCallback(
          "Cannot access this page. Computer Control cannot assist with the content on this page."
        );
      }

      cleanupAfterToolExecution(details.tabId);
      return;
    }

    await chrome.tabs.get(details.tabId);
    return undefined;
  } catch {}
});

// ============================================================================
// EXPORTS
// ============================================================================

// Main exports for service-worker.js
export {
  notifyDisconnection,
  tabGroupManager,
  createErrorResponse,
  executeToolRequest,
};

// Tool exports
export {
  gifCreatorTool,
  domainCategoryCache,
  turnAnswerStartTool,
  javascriptTool,
  coerceParameterTypes,
  formatTabContextResponse,
  filterAndApproveDomains,
  getPlanModeReminder,
  toAnthropicSchemas,
  cdpDebugger,
  findImageInMessages,
};

// Helper exports
export {
  checkTabContext,
  getOrCreateAnonymousId,
  isRestrictedCategory,
  getBlockedPageUrl,
  checkDomainChange,
  createDomainTransitionRequest,
  getTabSubscriptionManager,
  getFeatureFlags,
  formInputTool,
  computerTool,
  navigateTool,
  getPageTextTool,
  shouldEnterPlanMode,
  updatePlanTool,
  parseArrayParam,
  tabsCreateTool,
  readPageTool,
  stripSystemReminders,
  updateBlocklistStatus,
  tabsContextTool,
  uploadImageTool,
  readConsoleMessagesTool,
  readNetworkRequestsTool,
  resizeWindowTool,
};
