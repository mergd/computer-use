// @ts-nocheck
/**
 * mcp-tools.ts - MCP (Model Context Protocol) Tools Implementation
 *
 * This is the deminified TypeScript source. Key components:
 *
 * IMPORTS:
 *   TabGroupManagerClass = TabGroupManager class    - from tab-group-manager.js
 *   tabGroupManager = TabGroupManager singleton     - from tab-group-manager.js
 *   cdpDebugger = CDPDebugger instance              - from cdp-debugger.js
 *
 * CLASSES:
 *   DomainCategoryCache - Caches domain category lookups
 *
 * KEY FUNCTIONS (exported):
 *   executeToolRequest  - Main entry for MCP tool execution
 *   createErrorResponse - Creates error responses
 *   notifyDisconnection - Called on native host disconnect
 *
 * EXPORTS (maintaining compatibility with minified aliases):
 *   t (tabGroupManager)      = TabGroupManager singleton
 *   B (DomainCategoryCache)  = DomainCategoryCache
 *   J (cdpDebugger)          = CDPDebugger instance
 *   M (createErrorResponse)  = createErrorResponse
 *   N (executeToolRequest)   = executeToolRequest
 *   L (notifyDisconnection)  = notifyDisconnection
 */

// =============================================================================
// IMPORTS
// =============================================================================

import {
  k as generateScreenshotId,        // generateScreenshotId - generates unique IDs for screenshots
  S as StorageKeys,                  // StorageKeys - enum of chrome storage keys
  T as ToolPermissionType,           // ToolPermissionType - enum of tool permission types
  h as getEnvironmentConfig,         // getEnvironmentConfig - returns API config
  b as SavedPromptsService,          // SavedPromptsService - service for managing saved prompts
  s as setStorageValue,              // setStorageValue - sets value in chrome storage
  z as getStoragePromise,            // getStoragePromise - gets value from chrome storage
  w as captureViewportDimensions,    // captureViewportDimensions - gets viewport size
  A as SegmentConfig,                // SegmentConfig - segment analytics config
  x as getApiToken,                  // getApiToken - gets API authentication token
  B as AuthHelpers,                  // AuthHelpers - authentication helper functions
  y as SavedPromptsServiceInstance,  // SavedPromptsServiceInstance - singleton instance
  C as OAuthConfig,                  // OAuthConfig - OAuth configuration
  E as Analytics,                    // Analytics - analytics utilities
  _ as createElementRef,             // createElementRef - creates element references
  d as getOrCreateAnonymousId,       // getOrCreateAnonymousId - gets anonymous user ID
  K as formatUserIdentity,           // formatUserIdentity - formats user identity for analytics
  g as getStorageValue,              // getStorageValue - gets value from chrome storage
  v as extensionId,                  // extensionId - Chrome extension ID
} from "./storage";

import {
  re as cdpDebugger,                 // cdpDebugger - CDP (Chrome DevTools Protocol) debugger instance
  Q as ScreenshotContext,            // ScreenshotContext - manages screenshot context/dimensions
  setTabGroupManager
} from "./cdp-debugger";

import {
  K as tabGroupManager,              // tabGroupManager - TabGroupManager singleton instance
  H as TabGroupManagerClass,         // TabGroupManagerClass - TabGroupManager class
  j as tabGroupUtils,                // tabGroupUtils - tab group utility functions
  z as tabValidation,                // tabValidation - tab validation helpers
  D as domainUtils,                  // domainUtils - domain utility functions
  M as tabMetadata,                  // tabMetadata - tab metadata helpers
  setDomainCategoryCache
} from "./tab-group-manager";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface TabInfo {
  id: number;
  title: string;
  url: string;
}

interface TabContext {
  currentTabId: number;
  executedOnTabId?: number;
  availableTabs: TabInfo[];
  tabCount: number;
  tabGroupId?: number;
}

interface ToolResult {
  output?: string;
  error?: string;
  base64Image?: string;
  imageFormat?: string;
  imageId?: string;
  tabContext?: TabContext;
  type?: string;
  tool?: string;
  url?: string;
  toolUseId?: string;
  actionData?: Record<string, unknown>;
}

interface ToolExecutionContext {
  toolUseId?: string;
  tabId?: number;
  tabGroupId?: number;
  model?: string;
  sessionId: string;
  anthropicClient?: unknown;
  permissionManager: PermissionManager;
  createAnthropicMessage: unknown;
  messages?: Message[];
  analytics?: {
    track: (event: string, data: Record<string, unknown>) => void;
  };
  onPermissionRequired?: (prompt: ToolResult, tabId: number) => Promise<boolean>;
}

interface Message {
  role: string;
  content: MessageContent[];
}

interface MessageContent {
  type: string;
  text?: string;
  content?: MessageContent[] | string;
  source?: {
    type: string;
    data?: string;
    media_type?: string;
  };
}

interface DomainCategoryInfo {
  category?: string;
  org_policy?: string;
}

interface ScreenshotResult {
  base64: string;
  format: string;
  width: number;
  height: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

interface ScrollPosition {
  x: number;
  y: number;
}

interface ElementCoordinatesResult {
  success: boolean;
  error?: string;
  coordinates?: [number, number];
}

interface GifFrame {
  base64: string;
  action?: GifAction;
  frameNumber: number;
  timestamp: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

interface GifAction {
  type: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  timestamp: number;
  description?: string;
}

interface GifExportOptions {
  showClickIndicators?: boolean;
  showDragPaths?: boolean;
  showActionLabels?: boolean;
  showProgressBar?: boolean;
  showWatermark?: boolean;
  quality?: number;
}

interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>;
  toAnthropicSchema: () => Promise<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

// =============================================================================
// STUB PERMISSION MANAGER
// =============================================================================

/**
 * Stub PermissionManager for MCP mode (real permissions handled via --skip-permissions)
 */
class PermissionManager {
  private skipCheck: () => boolean;

  constructor(skipCheck: () => boolean, opts: Record<string, unknown>) {
    this.skipCheck = skipCheck;
  }

  async checkPermission(url: string, toolUseId?: string): Promise<{ allowed: boolean; needsPrompt: boolean }> {
    // In MCP mode, permissions are controlled by --skip-permissions flag
    return { allowed: this.skipCheck(), needsPrompt: false };
  }
}

// =============================================================================
// STUB TRACING
// =============================================================================

/**
 * Stub for tracing/telemetry - just executes the function directly
 */
const executeWithTracing = async <T>(
  name: string,
  fn: (span: { setAttribute: (key: string, value: unknown) => void }) => Promise<T>,
  ...args: unknown[]
): Promise<T> => fn({ setAttribute: () => {} });

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Formats tab information as JSON string for MCP responses
 */
function formatTabsAsJson(tabs: TabInfo[], tabGroupId?: number): string {
  const result: { availableTabs: TabInfo[]; tabGroupId?: number } = {
    availableTabs: tabs.map((tab) => ({ tabId: tab.id, title: tab.title, url: tab.url })),
  };
  if (tabGroupId !== undefined) {
    result.tabGroupId = tabGroupId;
  }
  return JSON.stringify(result);
}

/**
 * Formats tab context with optional domain skills
 */
function formatTabContextWithSkills(context: {
  availableTabs?: TabInfo[];
  domainSkills?: string[];
  initialTabId?: number;
}): string {
  const result: Record<string, unknown> = {};

  if (context.availableTabs) {
    result.availableTabs = context.availableTabs.map((tab) => ({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
    }));
  }

  if (context.domainSkills && context.domainSkills.length > 0) {
    result.domainSkills = context.domainSkills;
  }

  if (context.initialTabId !== undefined) {
    result.initialTabId = context.initialTabId;
  }

  return JSON.stringify(result);
}

/**
 * Strips system reminder tags from text
 */
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim();
}

/**
 * Converts tool schemas to Anthropic format
 */
const convertToolsToAnthropicSchema = async (
  tools: ToolSchema[],
  context: unknown
): Promise<unknown[]> => {
  return await Promise.all(tools.map((tool) => tool.toAnthropicSchema()));
};

/**
 * Coerces tool arguments to correct types based on schema
 */
const coerceToolArguments = (
  toolName: string,
  args: Record<string, unknown>,
  tools: ToolSchema[]
): Record<string, unknown> => {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool || !tool.parameters || typeof args !== "object" || !args) {
    return args;
  }

  const coercedArgs = { ...args };

  for (const [paramName, paramSchema] of Object.entries(tool.parameters)) {
    if (paramName in coercedArgs && paramSchema && typeof paramSchema === "object") {
      const value = coercedArgs[paramName];
      const schema = paramSchema as { type?: string };

      if (schema.type === "number" && typeof value === "string") {
        const numValue = Number(value);
        if (!isNaN(numValue)) {
          coercedArgs[paramName] = numValue;
        }
      } else if (schema.type === "boolean" && typeof value === "string") {
        coercedArgs[paramName] = value === "true";
      }
    }
  }

  return coercedArgs;
};

/**
 * Parses array from string or returns as-is
 */
const parseArrayArgument = (value: unknown, fallback: unknown[] = []): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// =============================================================================
// IMAGE UTILITIES
// =============================================================================

/**
 * Finds an image by ID in message history
 */
function findImageInMessages(
  messages: Message[],
  imageId: string
): { base64: string; width?: number; height?: number } | undefined {
  console.info(`[imageUtils] Looking for image with ID: ${imageId}`);
  console.info(`[imageUtils] Total messages to search: ${messages.length}`);

  // Search messages in reverse order (most recent first)
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];

    if (message.role === "user" && Array.isArray(message.content)) {
      // Check tool_result content
      for (const contentBlock of message.content) {
        if (contentBlock.type === "tool_result") {
          const toolResult = contentBlock as MessageContent;

          if (toolResult.content) {
            const contentArray = Array.isArray(toolResult.content)
              ? toolResult.content
              : [{ type: "text", text: toolResult.content }];

            let foundIdInText = false;
            let textContent = "";

            // First pass: check if imageId is in any text block
            for (const item of contentArray) {
              if (item.type === "text" && item.text && item.text.includes(imageId)) {
                foundIdInText = true;
                textContent = item.text;
                console.info("[imageUtils] Found image ID in tool_result text");
                break;
              }
            }

            // Second pass: if found, look for adjacent image
            if (foundIdInText) {
              for (const item of contentArray) {
                if (item.type === "image") {
                  const imageBlock = item as MessageContent;
                  if (imageBlock.source && "data" in imageBlock.source && imageBlock.source.data) {
                    console.info(`[imageUtils] Found image data for ID ${imageId}`);
                    return {
                      base64: imageBlock.source.data,
                      width: extractDimensionFromText(textContent, "width"),
                      height: extractDimensionFromText(textContent, "height"),
                    };
                  }
                }
              }
            }
          }
        }
      }

      // Check for user-uploaded images
      const textIndex = message.content.findIndex(
        (c) => c.type === "text" && c.text?.includes(imageId)
      );

      if (textIndex !== -1) {
        console.info(
          `[imageUtils] Found image ID in user text at index ${textIndex}, looking for next adjacent image`
        );

        for (let i = textIndex + 1; i < message.content.length; i++) {
          const content = message.content[i];

          if (content.type === "image") {
            const imageBlock = content as MessageContent;
            if (imageBlock.source && "data" in imageBlock.source && imageBlock.source.data) {
              console.info(
                `[imageUtils] Found user-uploaded image for ID ${imageId} at index ${i}`
              );
              return { base64: imageBlock.source.data };
            }
          }

          if (content.type === "text") {
            console.info("[imageUtils] Hit another text block, stopping search");
            break;
          }
        }
      }
    }
  }

  console.info(`[imageUtils] Image not found with ID: ${imageId}`);
  return undefined;
}

/**
 * Extracts width or height from dimension text like "(800x600)"
 */
function extractDimensionFromText(text: string, dimension: "width" | "height"): number | undefined {
  if (!text) return undefined;
  const match = text.match(/\((\d+)x(\d+)/);
  if (!match) return undefined;
  return dimension === "width" ? parseInt(match[1], 10) : parseInt(match[2], 10);
}

// =============================================================================
// URL/DOMAIN UTILITIES
// =============================================================================

/**
 * Extracts hostname from URL
 */
function extractHostname(url: string): string {
  if (!url.startsWith("http")) {
    url = `https://${url}`;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Normalizes domain for comparison (removes protocol, www, and path)
 */
function normalizeDomain(url: string): string {
  return url
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/\/.*$/, "");
}

/**
 * Verifies that current tab URL domain matches expected domain
 */
async function verifyDomainIntegrity(
  tabId: number,
  expectedUrl: string | undefined,
  actionName: string
): Promise<{ error: string } | null> {
  if (!expectedUrl) return null;

  const currentTab = await chrome.tabs.get(tabId);
  if (!currentTab.url) {
    return { error: "Unable to verify current URL for security check" };
  }

  const expectedDomain = extractHostname(expectedUrl);
  const currentDomain = extractHostname(currentTab.url);

  if (expectedDomain !== currentDomain) {
    return {
      error: `Security check failed: Domain changed from ${expectedDomain} to ${currentDomain} during ${actionName}`,
    };
  }

  return null;
}

// =============================================================================
// DOMAIN CATEGORY CACHE
// =============================================================================

/**
 * Caches domain category lookups from the Anthropic API
 */
class DomainCategoryCache {
  private static cache = new Map<string, { category: string | null; timestamp: number }>();
  private static CACHE_TTL_MS = 300000; // 5 minutes
  private static pendingRequests = new Map<string, Promise<string | null | undefined>>();

  /**
   * Gets the category for a domain, using cache if available
   */
  static async getCategory(url: string): Promise<string | null | undefined> {
    // Skip if permissions are disabled
    if ((self as unknown as { __skipPermissions?: boolean }).__skipPermissions) {
      return null;
    }

    const domain = normalizeDomain(extractHostname(url));

    // Check cache
    const cached = this.cache.get(domain);
    if (cached) {
      if (!(Date.now() - cached.timestamp > this.CACHE_TTL_MS)) {
        return cached.category;
      }
      this.cache.delete(domain);
    }

    // Check for pending request
    const pending = this.pendingRequests.get(domain);
    if (pending) return pending;

    // Fetch from API
    const request = this.fetchCategoryFromAPI(domain);
    this.pendingRequests.set(domain, request);

    try {
      return await request;
    } finally {
      this.pendingRequests.delete(domain);
    }
  }

  /**
   * Fetches domain category from Anthropic API
   */
  private static async fetchCategoryFromAPI(domain: string): Promise<string | null | undefined> {
    const token = await getApiToken();
    if (!token) return undefined;

    try {
      const apiUrl = new URL(
        "/api/web/domain_info/browser_extension",
        "https://api.anthropic.com"
      );
      apiUrl.searchParams.append("domain", domain);

      const response = await fetch(apiUrl.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) return undefined;

      const data: DomainCategoryInfo = await response.json();
      const category = this.getEffectiveCategory(data);

      this.cache.set(domain, { category, timestamp: Date.now() });
      return category;
    } catch {
      return undefined;
    }
  }

  /**
   * Determines effective category from API response
   */
  private static getEffectiveCategory(info: DomainCategoryInfo): string | null {
    if (info.org_policy === "block") {
      return "category_org_blocked";
    }
    return info.category ?? null;
  }

  static clearCache(): void {
    this.cache.clear();
  }

  static evictFromCache(url: string): void {
    const domain = normalizeDomain(url);
    this.cache.delete(domain);
  }

  static getCacheSize(): number {
    return this.cache.size;
  }
}

// Initialize the DomainCategoryCache for TabGroupManager
setDomainCategoryCache(DomainCategoryCache);
setTabGroupManager(tabGroupManager);

// =============================================================================
// COORDINATE UTILITIES
// =============================================================================

/**
 * Scales screenshot coordinates to viewport coordinates
 */
function scaleToViewportCoordinates(
  screenshotX: number,
  screenshotY: number,
  context: { viewportWidth: number; viewportHeight: number; screenshotWidth: number; screenshotHeight: number }
): [number, number] {
  const scaleX = context.viewportWidth / context.screenshotWidth;
  const scaleY = context.viewportHeight / context.screenshotHeight;
  return [Math.round(screenshotX * scaleX), Math.round(screenshotY * scaleY)];
}

/**
 * Scrolls at specified coordinates, detecting scrollable containers
 */
async function scrollAtCoordinates(
  tabId: number,
  viewportX: number,
  viewportY: number,
  deltaX: number,
  deltaY: number
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (dx: number, dy: number, x: number, y: number) => {
      const element = document.elementFromPoint(x, y);

      if (element && element !== document.body && element !== document.documentElement) {
        const isScrollable = (el: Element): boolean => {
          const style = window.getComputedStyle(el);
          const overflowY = style.overflowY;
          const overflowX = style.overflowX;
          return (
            (overflowY === "auto" || overflowY === "scroll" ||
             overflowX === "auto" || overflowX === "scroll") &&
            (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
          );
        };

        let scrollableParent: Element | null = element;
        while (scrollableParent && !isScrollable(scrollableParent)) {
          scrollableParent = scrollableParent.parentElement;
        }

        if (scrollableParent && isScrollable(scrollableParent)) {
          scrollableParent.scrollBy({ left: dx, top: dy, behavior: "instant" });
          return;
        }
      }

      window.scrollBy({ left: dx, top: dy, behavior: "instant" });
    },
    args: [deltaX, deltaY, viewportX, viewportY],
  });
}

// =============================================================================
// NAVIGATE TOOL
// =============================================================================

const navigateTool: ToolSchema = {
  name: "navigate",
  description:
    "Navigate to a URL, or go forward/back in browser history. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    url: {
      type: "string",
      description:
        'The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history.',
    },
    tabId: {
      type: "number",
      description:
        "Tab ID to navigate. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
    },
  },
  execute: async (args, context) => {
    try {
      const { url, tabId: requestedTabId } = args as { url?: string; tabId?: number };

      if (!url) {
        throw new Error("URL parameter is required");
      }

      if (!context?.tabId) {
        throw new Error("No active tab found");
      }

      const effectiveTabId = await tabGroupManager.getEffectiveTabId(requestedTabId, context.tabId);

      // Check domain category for non-navigation commands
      if (url && !["back", "forward"].includes(url.toLowerCase())) {
        try {
          const category = await DomainCategoryCache.getCategory(url);
          if (
            category &&
            (category === "category1" || category === "category2" || category === "category_org_blocked")
          ) {
            return {
              error:
                category === "category_org_blocked"
                  ? "This site is blocked by your organization's policy."
                  : "This site is not allowed due to safety restrictions.",
            };
          }
        } catch {
          // Continue if category check fails
        }
      }

      const currentTab = await chrome.tabs.get(effectiveTabId);
      if (!currentTab.id) {
        throw new Error("Active tab has no ID");
      }

      // Handle back navigation
      if (url.toLowerCase() === "back") {
        await chrome.tabs.goBack(currentTab.id);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const updatedTab = await chrome.tabs.get(currentTab.id);
        const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

        return {
          output: `Navigated back to ${updatedTab.url}`,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs,
            tabCount: availableTabs.length,
          },
        };
      }

      // Handle forward navigation
      if (url.toLowerCase() === "forward") {
        await chrome.tabs.goForward(currentTab.id);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const updatedTab = await chrome.tabs.get(currentTab.id);
        const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

        return {
          output: `Navigated forward to ${updatedTab.url}`,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs,
            tabCount: availableTabs.length,
          },
        };
      }

      // Handle URL navigation
      let normalizedUrl = url;
      if (!normalizedUrl.match(/^https?:\/\//)) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      try {
        new URL(normalizedUrl);
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }

      const toolUseId = context?.toolUseId;
      const permissionResult = await context.permissionManager.checkPermission(normalizedUrl, toolUseId);

      if (!permissionResult.allowed) {
        if (permissionResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.NAVIGATE,
            url: normalizedUrl,
            toolUseId,
          };
        }
        return { error: "Navigation to this domain is not allowed" };
      }

      await chrome.tabs.update(effectiveTabId, { url: normalizedUrl });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        output: `Navigated to ${normalizedUrl}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to navigate: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "navigate",
    description:
      "Navigate to a URL, or go forward/back in browser history. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            'The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history.',
        },
        tabId: {
          type: "number",
          description:
            "Tab ID to navigate. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
      },
      required: ["url", "tabId"],
    },
  }),
};

// CDPDebugger code moved to cdp-debugger.js
// Inject TabGroupManager dependency after tabGroupManager is defined
setTabGroupManager(tabGroupManager);

// =============================================================================
// ELEMENT REFERENCE UTILITIES
// =============================================================================

/**
 * Gets element coordinates from a reference ID, scrolling element into view
 */
async function getElementCoordinatesFromRef(
  tabId: number,
  refId: string
): Promise<ElementCoordinatesResult> {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (ref: string) => {
        try {
          let element: Element | null = null;

          // Look up element from the page's element map
          const elementMap = (window as unknown as { __claudeElementMap?: Record<string, WeakRef<Element>> }).__claudeElementMap;
          if (elementMap && elementMap[ref]) {
            element = elementMap[ref].deref() || null;
            if (element && !document.contains(element)) {
              delete elementMap[ref];
              element = null;
            }
          }

          if (!element) {
            return {
              success: false,
              error: `No element found with reference: "${ref}". The element may have been removed from the page.`,
            };
          }

          // Scroll element into view
          element.scrollIntoView({
            behavior: "instant",
            block: "center",
            inline: "center",
          });

          // Force layout calculation
          if (element instanceof HTMLElement) {
            void element.offsetHeight;
          }

          // Get center coordinates
          const rect = element.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          return { success: true, coordinates: [centerX, centerY] };
        } catch (error) {
          return {
            success: false,
            error: `Error getting element coordinates: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
      },
      args: [refId],
    });

    if (!result || result.length === 0) {
      return {
        success: false,
        error: "Failed to execute script to get element coordinates",
      };
    }

    return result[0].result as ElementCoordinatesResult;
  } catch (error) {
    return {
      success: false,
      error: `Failed to get element coordinates from ref: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// =============================================================================
// CLICK HANDLER
// =============================================================================

/**
 * Handles click actions (left, right, double, triple click)
 */
async function handleClickAction(
  tabId: number,
  args: Record<string, unknown>,
  clickCount: number = 1,
  originalUrl?: string
): Promise<ToolResult> {
  let x: number;
  let y: number;

  // Get coordinates from ref or coordinate parameter
  if (args.ref) {
    const refResult = await getElementCoordinatesFromRef(tabId, args.ref as string);
    if (!refResult.success) {
      return { error: refResult.error };
    }
    [x, y] = refResult.coordinates!;
  } else {
    if (!args.coordinate) {
      throw new Error("Either ref or coordinate parameter is required for click action");
    }

    [x, y] = args.coordinate as [number, number];

    // Scale coordinates if screenshot context available
    const screenshotContext = ScreenshotContext.getContext(tabId);
    if (screenshotContext) {
      [x, y] = scaleToViewportCoordinates(x, y, screenshotContext);
    }
  }

  const button = args.action === "right_click" ? "right" : "left";

  // Parse modifier keys
  let modifiers = 0;
  if (args.modifiers) {
    modifiers = parseModifierKeys(parseModifierString(args.modifiers as string));
  }

  try {
    // Verify domain hasn't changed
    const domainCheck = await verifyDomainIntegrity(tabId, originalUrl, "click action");
    if (domainCheck) return domainCheck;

    await cdpDebugger.click(tabId, x, y, button, clickCount, modifiers);

    const clickTypeLabel =
      clickCount === 1 ? "Clicked" : clickCount === 2 ? "Double-clicked" : "Triple-clicked";

    if (args.ref) {
      return { output: `${clickTypeLabel} on element ${args.ref}` };
    }

    const [origX, origY] = args.coordinate as [number, number];
    return { output: `${clickTypeLabel} at (${Math.round(origX)}, ${Math.round(origY)})` };
  } catch (error) {
    return {
      error: `Error clicking: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Parses modifier string like "ctrl+shift" into array of modifier names
 */
function parseModifierString(modifierStr: string): string[] {
  const parts = modifierStr.toLowerCase().split("+");
  const validModifiers = [
    "ctrl", "control", "alt", "shift", "cmd", "meta", "command", "win", "windows",
  ];
  return parts.filter((part) => validModifiers.includes(part.trim()));
}

/**
 * Converts modifier names to CDP modifier bitmask
 */
function parseModifierKeys(modifiers: string[]): number {
  const modifierMap: Record<string, number> = {
    alt: 1,
    ctrl: 2,
    control: 2,
    meta: 4,
    cmd: 4,
    command: 4,
    win: 4,
    windows: 4,
    shift: 8,
  };

  let result = 0;
  for (const mod of modifiers) {
    result |= modifierMap[mod] || 0;
  }
  return result;
}

// =============================================================================
// SCREENSHOT HANDLER
// =============================================================================

/**
 * Captures a screenshot of the tab
 */
async function captureScreenshot(tabId: number): Promise<ToolResult> {
  try {
    const screenshot: ScreenshotResult = await cdpDebugger.screenshot(tabId);
    const imageId = generateScreenshotId();

    console.info(`[Computer Tool] Generated screenshot ID: ${imageId}`);
    console.info(`[Computer Tool] Screenshot dimensions: ${screenshot.width}x${screenshot.height}`);

    return {
      output: `Successfully captured screenshot (${screenshot.width}x${screenshot.height}, ${screenshot.format}) - ID: ${imageId}`,
      base64Image: screenshot.base64,
      imageFormat: screenshot.format,
      imageId,
    };
  } catch (error) {
    return {
      error: `Error capturing screenshot: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Gets current scroll position
 */
async function getScrollPosition(tabId: number): Promise<ScrollPosition> {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      x: window.pageXOffset || document.documentElement.scrollLeft,
      y: window.pageYOffset || document.documentElement.scrollTop,
    }),
  });

  if (!result || !result[0]?.result) {
    throw new Error("Failed to get scroll position");
  }

  return result[0].result;
}

/**
 * Captures screenshot if permissions allow (for scroll action)
 */
async function captureScreenshotIfAllowed(
  tabId: number,
  permissionManager: PermissionManager
): Promise<{ base64Image: string; imageFormat: string } | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return undefined;

    const permResult = await permissionManager.checkPermission(tab.url, undefined);
    if (!permResult.allowed) return undefined;

    try {
      const screenshot = await captureScreenshot(tabId);
      return {
        base64Image: screenshot.base64Image!,
        imageFormat: screenshot.imageFormat || "png",
      };
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}

// =============================================================================
// COMPUTER TOOL
// =============================================================================

const computerTool: ToolSchema = {
  name: "computer",
  description:
    "Use a mouse and keyboard to interact with a web browser, and take screenshots. If you don't have a valid tab ID, use tabs_context first to get available tabs.\n* Whenever you intend to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.\n* If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your click location so that the tip of the cursor visually falls on the element that you want to click.\n* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.",
  parameters: {
    action: {
      type: "string",
      enum: [
        "left_click", "right_click", "type", "screenshot", "wait", "scroll",
        "key", "left_click_drag", "double_click", "triple_click", "zoom", "scroll_to", "hover",
      ],
      description:
        "The action to perform:\n* `left_click`: Click the left mouse button.\n* `right_click`: Click the right mouse button.\n* `double_click`: Double-click.\n* `triple_click`: Triple-click.\n* `type`: Type text.\n* `screenshot`: Take a screenshot.\n* `wait`: Wait for seconds.\n* `scroll`: Scroll at coordinates.\n* `key`: Press keyboard key.\n* `left_click_drag`: Drag from start_coordinate to coordinate.\n* `zoom`: Screenshot a region.\n* `scroll_to`: Scroll element into view.\n* `hover`: Move cursor without clicking.",
    },
    coordinate: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
      description: "(x, y): Coordinates for actions. For click actions, either coordinate or ref is required.",
    },
    text: {
      type: "string",
      description: 'Text to type or key(s) to press. For key action: space-separated keys.',
    },
    duration: {
      type: "number",
      minimum: 0,
      maximum: 30,
      description: "Seconds to wait. Required for wait action.",
    },
    scroll_direction: {
      type: "string",
      enum: ["up", "down", "left", "right"],
      description: "Direction to scroll.",
    },
    scroll_amount: {
      type: "number",
      minimum: 1,
      maximum: 10,
      description: "Scroll wheel ticks (default: 3).",
    },
    start_coordinate: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
      description: "Starting coordinates for left_click_drag.",
    },
    region: {
      type: "array",
      items: { type: "number" },
      minItems: 4,
      maxItems: 4,
      description: "(x0, y0, x1, y1): Region for zoom action.",
    },
    repeat: {
      type: "number",
      minimum: 1,
      maximum: 100,
      description: "Repeat count for key action.",
    },
    ref: {
      type: "string",
      description: 'Element reference ID. Required for scroll_to, alternative for click actions.',
    },
    modifiers: {
      type: "string",
      description: 'Modifier keys for clicks: "ctrl", "shift", "alt", "cmd". Combine with "+".',
    },
    tabId: {
      type: "number",
      description: "Tab ID to execute action on.",
    },
  },
  execute: async (args, context) => {
    try {
      const params = args || {};

      if (!params.action) {
        throw new Error("Action parameter is required");
      }

      if (!context?.tabId) {
        throw new Error("No active tab found in context");
      }

      const effectiveTabId = await tabGroupManager.getEffectiveTabId(
        params.tabId as number | undefined,
        context.tabId
      );

      const tab = await chrome.tabs.get(effectiveTabId);
      if (!tab.id) {
        throw new Error("Active tab has no ID");
      }

      // Check permissions for non-wait actions
      if (!["wait"].includes(params.action as string)) {
        const tabUrl = tab.url;
        if (!tabUrl) {
          throw new Error("No URL available for active tab");
        }

        const permissionType = getPermissionTypeForAction(params.action as string);
        const toolUseId = context?.toolUseId;
        const permResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

        if (!permResult.allowed) {
          if (permResult.needsPrompt) {
            const response: ToolResult = {
              type: "permission_required",
              tool: permissionType,
              url: tabUrl,
              toolUseId,
            };

            // Include screenshot for click actions
            if (["left_click", "right_click", "double_click", "triple_click"].includes(params.action as string)) {
              try {
                const screenshot = await cdpDebugger.screenshot(effectiveTabId);
                response.actionData = {
                  screenshot: `data:image/${screenshot.format};base64,${screenshot.base64}`,
                };
                if (params.coordinate) {
                  response.actionData.coordinate = params.coordinate;
                }
              } catch {
                response.actionData = {};
                if (params.coordinate) {
                  response.actionData.coordinate = params.coordinate;
                }
              }
            } else if (params.action === "type" && params.text) {
              response.actionData = { text: params.text };
            } else if (params.action === "left_click_drag" && params.start_coordinate && params.coordinate) {
              response.actionData = {
                start_coordinate: params.start_coordinate,
                coordinate: params.coordinate,
              };
            }

            return response;
          }
          return { error: "Permission denied for this action on this domain" };
        }
      }

      const originalUrl = tab.url;
      let result: ToolResult;

      // Execute the action
      switch (params.action) {
        case "left_click":
        case "right_click":
          result = await handleClickAction(effectiveTabId, params, 1, originalUrl);
          break;

        case "double_click":
          result = await handleClickAction(effectiveTabId, params, 2, originalUrl);
          break;

        case "triple_click":
          result = await handleClickAction(effectiveTabId, params, 3, originalUrl);
          break;

        case "type":
          result = await handleTypeAction(effectiveTabId, params, originalUrl);
          break;

        case "screenshot":
          result = await captureScreenshot(effectiveTabId);
          break;

        case "wait":
          result = await handleWaitAction(params);
          break;

        case "scroll":
          result = await handleScrollAction(effectiveTabId, params, context.permissionManager);
          break;

        case "key":
          result = await handleKeyAction(effectiveTabId, params, originalUrl);
          break;

        case "left_click_drag":
          result = await handleDragAction(effectiveTabId, params, originalUrl);
          break;

        case "zoom":
          result = await handleZoomAction(effectiveTabId, params);
          break;

        case "scroll_to":
          result = await handleScrollToAction(effectiveTabId, params, originalUrl);
          break;

        case "hover":
          result = await handleHoverAction(effectiveTabId, params, originalUrl);
          break;

        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      // Add tab context to result
      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        ...result,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to execute action: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "computer",
    description:
      "Use a mouse and keyboard to interact with a web browser, and take screenshots. If you don't have a valid tab ID, use tabs_context first to get available tabs.\n* Whenever you intend to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.\n* If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your click location so that the tip of the cursor visually falls on the element that you want to click.\n* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "left_click", "right_click", "type", "screenshot", "wait", "scroll",
            "key", "left_click_drag", "double_click", "triple_click", "zoom", "scroll_to", "hover",
          ],
          description: "The action to perform.",
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "(x, y): Coordinates for click/scroll actions.",
        },
        text: {
          type: "string",
          description: 'Text to type or key(s) to press.',
        },
        duration: {
          type: "number",
          minimum: 0,
          maximum: 30,
          description: "Seconds to wait.",
        },
        scroll_direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Direction to scroll.",
        },
        scroll_amount: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "Scroll wheel ticks.",
        },
        start_coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Starting coordinates for drag.",
        },
        region: {
          type: "array",
          items: { type: "number" },
          minItems: 4,
          maxItems: 4,
          description: "Region for zoom.",
        },
        repeat: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "Repeat count for key action.",
        },
        ref: {
          type: "string",
          description: 'Element reference ID.',
        },
        modifiers: {
          type: "string",
          description: 'Modifier keys for clicks.',
        },
        tabId: {
          type: "number",
          description: "Tab ID to execute on.",
        },
      },
      required: ["action", "tabId"],
    },
  }),
};

/**
 * Gets the permission type for a computer action
 */
function getPermissionTypeForAction(action: string): string {
  const actionPermissionMap: Record<string, string> = {
    screenshot: ToolPermissionType.READ_PAGE_CONTENT,
    scroll: ToolPermissionType.READ_PAGE_CONTENT,
    scroll_to: ToolPermissionType.READ_PAGE_CONTENT,
    zoom: ToolPermissionType.READ_PAGE_CONTENT,
    hover: ToolPermissionType.READ_PAGE_CONTENT,
    left_click: ToolPermissionType.CLICK,
    right_click: ToolPermissionType.CLICK,
    double_click: ToolPermissionType.CLICK,
    triple_click: ToolPermissionType.CLICK,
    left_click_drag: ToolPermissionType.CLICK,
    type: ToolPermissionType.TYPE,
    key: ToolPermissionType.TYPE,
  };

  if (!actionPermissionMap[action]) {
    throw new Error(`Unsupported action: ${action}`);
  }

  return actionPermissionMap[action];
}

// =============================================================================
// ACTION HANDLERS
// =============================================================================

/**
 * Handles type action
 */
async function handleTypeAction(
  tabId: number,
  params: Record<string, unknown>,
  originalUrl?: string
): Promise<ToolResult> {
  if (!params.text) {
    throw new Error("Text parameter is required for type action");
  }

  try {
    const domainCheck = await verifyDomainIntegrity(tabId, originalUrl, "type action");
    if (domainCheck) return domainCheck;

    await cdpDebugger.type(tabId, params.text as string);
    return { output: `Typed "${params.text}"` };
  } catch (error) {
    return {
      error: `Failed to type: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Handles wait action
 */
async function handleWaitAction(params: Record<string, unknown>): Promise<ToolResult> {
  if (!params.duration || (params.duration as number) <= 0) {
    throw new Error("Duration parameter is required and must be positive");
  }

  if ((params.duration as number) > 30) {
    throw new Error("Duration cannot exceed 30 seconds");
  }

  const milliseconds = Math.round((params.duration as number) * 1000);
  await new Promise((resolve) => setTimeout(resolve, milliseconds));

  return {
    output: `Waited for ${params.duration} second${params.duration === 1 ? "" : "s"}`,
  };
}

/**
 * Handles scroll action
 */
async function handleScrollAction(
  tabId: number,
  params: Record<string, unknown>,
  permissionManager: PermissionManager
): Promise<ToolResult> {
  if (!params.coordinate || (params.coordinate as number[]).length !== 2) {
    throw new Error("Coordinate parameter is required for scroll action");
  }

  let [x, y] = params.coordinate as [number, number];

  // Scale coordinates if needed
  const screenshotContext = ScreenshotContext.getContext(tabId);
  if (screenshotContext) {
    [x, y] = scaleToViewportCoordinates(x, y, screenshotContext);
  }

  const direction = (params.scroll_direction as string) || "down";
  const amount = (params.scroll_amount as number) || 3;

  try {
    let deltaX = 0;
    let deltaY = 0;
    const pixelsPerTick = 100;

    switch (direction) {
      case "up":
        deltaY = -amount * pixelsPerTick;
        break;
      case "down":
        deltaY = amount * pixelsPerTick;
        break;
      case "left":
        deltaX = -amount * pixelsPerTick;
        break;
      case "right":
        deltaX = amount * pixelsPerTick;
        break;
      default:
        throw new Error(`Invalid scroll direction: ${direction}`);
    }

    const beforeScroll = await getScrollPosition(tabId);
    const tabInfo = await chrome.tabs.get(tabId);

    // Try CDP scroll first if tab is active
    if (tabInfo.active ?? false) {
      try {
        const scrollPromise = cdpDebugger.scrollWheel(tabId, x, y, deltaX, deltaY);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Scroll timeout")), 5000);
        });

        await Promise.race([scrollPromise, timeoutPromise]);
        await new Promise((resolve) => setTimeout(resolve, 200));

        const afterScroll = await getScrollPosition(tabId);
        if (!(Math.abs(afterScroll.x - beforeScroll.x) > 5 || Math.abs(afterScroll.y - beforeScroll.y) > 5)) {
          throw new Error("CDP scroll ineffective");
        }
      } catch {
        // Fall back to script-based scroll
        await scrollAtCoordinates(tabId, x, y, deltaX, deltaY);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } else {
      // Use script-based scroll for inactive tabs
      await scrollAtCoordinates(tabId, x, y, deltaX, deltaY);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Capture screenshot if allowed
    const screenshot = await captureScreenshotIfAllowed(tabId, permissionManager);

    return {
      output: `Scrolled ${direction} by ${amount} ticks at (${x}, ${y})`,
      ...(screenshot && {
        base64Image: screenshot.base64Image,
        imageFormat: screenshot.imageFormat,
      }),
    };
  } catch (error) {
    return {
      error: `Error scrolling: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Handles key action
 */
async function handleKeyAction(
  tabId: number,
  params: Record<string, unknown>,
  originalUrl?: string
): Promise<ToolResult> {
  if (!params.text) {
    throw new Error("Text parameter is required for key action");
  }

  const repeatCount = (params.repeat as number) ?? 1;

  if (!Number.isInteger(repeatCount) || repeatCount < 1) {
    throw new Error("Repeat parameter must be a positive integer");
  }

  if (repeatCount > 100) {
    throw new Error("Repeat parameter cannot exceed 100");
  }

  try {
    const domainCheck = await verifyDomainIntegrity(tabId, originalUrl, "key action");
    if (domainCheck) return domainCheck;

    const keyInputs = (params.text as string)
      .trim()
      .split(/\s+/)
      .filter((key) => key.length > 0);

    console.info({ keyInputs });

    // Handle refresh shortcuts specially
    if (keyInputs.length === 1) {
      const key = keyInputs[0].toLowerCase();
      const refreshShortcuts = [
        "cmd+r", "cmd+shift+r", "ctrl+r", "ctrl+shift+r", "f5", "ctrl+f5", "shift+f5",
      ];

      if (refreshShortcuts.includes(key)) {
        const isHardRefresh = ["cmd+shift+r", "ctrl+shift+r", "ctrl+f5", "shift+f5"].includes(key);
        await chrome.tabs.reload(tabId, { bypassCache: isHardRefresh });
        const refreshType = isHardRefresh ? "hard reload" : "reload";
        return { output: `Executed ${keyInputs[0]} (${refreshType} page)` };
      }
    }

    // Execute key presses
    for (let i = 0; i < repeatCount; i++) {
      for (const keyInput of keyInputs) {
        if (keyInput.includes("+")) {
          await cdpDebugger.pressKeyChord(tabId, keyInput);
        } else {
          const keyCode = cdpDebugger.getKeyCode(keyInput);
          if (keyCode) {
            await cdpDebugger.pressKey(tabId, keyCode);
          } else {
            await cdpDebugger.insertText(tabId, keyInput);
          }
        }
      }
    }

    const repeatSuffix = repeatCount > 1 ? ` (repeated ${repeatCount} times)` : "";
    return {
      output: `Pressed ${keyInputs.length} key${keyInputs.length === 1 ? "" : "s"}: ${keyInputs.join(" ")}${repeatSuffix}`,
    };
  } catch (error) {
    return {
      error: `Error pressing key: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Handles drag action
 */
async function handleDragAction(
  tabId: number,
  params: Record<string, unknown>,
  originalUrl?: string
): Promise<ToolResult> {
  if (!params.start_coordinate || (params.start_coordinate as number[]).length !== 2) {
    throw new Error("start_coordinate parameter is required for left_click_drag action");
  }

  if (!params.coordinate || (params.coordinate as number[]).length !== 2) {
    throw new Error("coordinate parameter (end position) is required for left_click_drag action");
  }

  let [startX, startY] = params.start_coordinate as [number, number];
  let [endX, endY] = params.coordinate as [number, number];

  // Scale coordinates if needed
  const screenshotContext = ScreenshotContext.getContext(tabId);
  if (screenshotContext) {
    [startX, startY] = scaleToViewportCoordinates(startX, startY, screenshotContext);
    [endX, endY] = scaleToViewportCoordinates(endX, endY, screenshotContext);
  }

  try {
    const domainCheck = await verifyDomainIntegrity(tabId, originalUrl, "drag action");
    if (domainCheck) return domainCheck;

    // Move to start position
    await cdpDebugger.dispatchMouseEvent(tabId, {
      type: "mouseMoved",
      x: startX,
      y: startY,
      button: "none",
      buttons: 0,
      modifiers: 0,
    });

    // Press mouse button
    await cdpDebugger.dispatchMouseEvent(tabId, {
      type: "mousePressed",
      x: startX,
      y: startY,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    });

    // Move to end position
    await cdpDebugger.dispatchMouseEvent(tabId, {
      type: "mouseMoved",
      x: endX,
      y: endY,
      button: "left",
      buttons: 1,
      modifiers: 0,
    });

    // Release mouse button
    await cdpDebugger.dispatchMouseEvent(tabId, {
      type: "mouseReleased",
      x: endX,
      y: endY,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers: 0,
    });

    return { output: `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})` };
  } catch (error) {
    return {
      error: `Error performing drag: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Handles zoom action (captures a region screenshot)
 */
async function handleZoomAction(
  tabId: number,
  params: Record<string, unknown>
): Promise<ToolResult> {
  if (!params.region || (params.region as number[]).length !== 4) {
    throw new Error("Region parameter is required for zoom action and must be [x0, y0, x1, y1]");
  }

  let [x0, y0, x1, y1] = params.region as [number, number, number, number];

  if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) {
    throw new Error("Invalid region coordinates: x0 and y0 must be non-negative, and x1 > x0, y1 > y0");
  }

  try {
    // Scale coordinates if needed
    const screenshotContext = ScreenshotContext.getContext(tabId);
    if (screenshotContext) {
      [x0, y0] = scaleToViewportCoordinates(x0, y0, screenshotContext);
      [x1, y1] = scaleToViewportCoordinates(x1, y1, screenshotContext);
    }

    // Get viewport dimensions
    const viewportResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    });

    if (!viewportResult || !viewportResult[0]?.result) {
      throw new Error("Failed to get viewport dimensions");
    }

    const { width: viewportWidth, height: viewportHeight } = viewportResult[0].result;

    if (x1 > viewportWidth || y1 > viewportHeight) {
      throw new Error(
        `Region exceeds viewport boundaries (${viewportWidth}x${viewportHeight}). Please choose a region within the visible viewport.`
      );
    }

    const regionWidth = x1 - x0;
    const regionHeight = y1 - y0;

    // Capture region screenshot via CDP
    const screenshot = await cdpDebugger.sendCommand(tabId, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
      clip: { x: x0, y: y0, width: regionWidth, height: regionHeight, scale: 1 },
    });

    if (!screenshot || !screenshot.data) {
      throw new Error("Failed to capture zoomed screenshot via CDP");
    }

    return {
      output: `Successfully captured zoomed screenshot of region (${x0},${y0}) to (${x1},${y1}) - ${regionWidth}x${regionHeight} pixels`,
      base64Image: screenshot.data,
      imageFormat: "png",
    };
  } catch (error) {
    return {
      error: `Error capturing zoomed screenshot: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Handles scroll_to action
 */
async function handleScrollToAction(
  tabId: number,
  params: Record<string, unknown>,
  originalUrl?: string
): Promise<ToolResult> {
  if (!params.ref) {
    throw new Error("ref parameter is required for scroll_to action");
  }

  try {
    const domainCheck = await verifyDomainIntegrity(tabId, originalUrl, "scroll_to action");
    if (domainCheck) return domainCheck;

    const refResult = await getElementCoordinatesFromRef(tabId, params.ref as string);

    if (refResult.success) {
      return { output: `Scrolled to element with reference: ${params.ref}` };
    }

    return { error: refResult.error };
  } catch (error) {
    return {
      error: `Failed to scroll to element: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Handles hover action
 */
async function handleHoverAction(
  tabId: number,
  params: Record<string, unknown>,
  originalUrl?: string
): Promise<ToolResult> {
  let x: number;
  let y: number;

  if (params.ref) {
    const refResult = await getElementCoordinatesFromRef(tabId, params.ref as string);
    if (!refResult.success) {
      return { error: refResult.error };
    }
    [x, y] = refResult.coordinates!;
  } else {
    if (!params.coordinate) {
      throw new Error("Either ref or coordinate parameter is required for hover action");
    }

    [x, y] = params.coordinate as [number, number];

    const screenshotContext = ScreenshotContext.getContext(tabId);
    if (screenshotContext) {
      [x, y] = scaleToViewportCoordinates(x, y, screenshotContext);
    }
  }

  try {
    const domainCheck = await verifyDomainIntegrity(tabId, originalUrl, "hover action");
    if (domainCheck) return domainCheck;

    await cdpDebugger.dispatchMouseEvent(tabId, {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
      modifiers: 0,
    });

    if (params.ref) {
      return { output: `Hovered over element ${params.ref}` };
    }

    const [origX, origY] = params.coordinate as [number, number];
    return { output: `Hovered at (${Math.round(origX)}, ${Math.round(origY)})` };
  } catch (error) {
    return {
      error: `Error hovering: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// =============================================================================
// READ PAGE TOOL
// =============================================================================

const readPageTool: ToolSchema = {
  name: "read_page",
  description:
    "Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Can optionally filter for only interactive elements, limit tree depth, or focus on a specific element. Returns a structured tree that represents how screen readers see the page content. If you don't have a valid tab ID, use tabs_context first to get available tabs. Output is limited to 50000 characters - if exceeded, specify a depth limit or ref_id to focus on a specific element.",
  parameters: {
    filter: {
      type: "string",
      enum: ["interactive", "all"],
      description: 'Filter elements: "interactive" for buttons/links/inputs only, "all" for all elements.',
    },
    tabId: {
      type: "number",
      description: "Tab ID to read from.",
    },
    depth: {
      type: "number",
      description: "Maximum depth of the tree to traverse (default: 15).",
    },
    ref_id: {
      type: "string",
      description: "Reference ID of a parent element to focus on.",
    },
    max_chars: {
      type: "number",
      description: "Maximum characters for output (default: 50000).",
    },
  },
  execute: async (args, context) => {
    const { filter, tabId: requestedTabId, depth, ref_id: refId, max_chars: maxChars } = args as {
      filter?: string;
      tabId?: number;
      depth?: number;
      ref_id?: string;
      max_chars?: number;
    };

    if (!context?.tabId) {
      throw new Error("No active tab found");
    }

    const effectiveTabId = await tabGroupManager.getEffectiveTabId(requestedTabId, context.tabId);
    const tab = await chrome.tabs.get(effectiveTabId);

    if (!tab.id) {
      throw new Error("Active tab has no ID");
    }

    const tabUrl = tab.url;
    if (!tabUrl) {
      throw new Error("No URL available for active tab");
    }

    const toolUseId = context?.toolUseId;
    const permResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

    if (!permResult.allowed) {
      if (permResult.needsPrompt) {
        return {
          type: "permission_required",
          tool: ToolPermissionType.READ_PAGE_CONTENT,
          url: tabUrl,
          toolUseId,
        };
      }
      return { error: "Permission denied for reading pages on this domain" };
    }

    // Hide indicator during tool use
    await tabGroupManager.hideIndicatorForToolUse(effectiveTabId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (filterParam: string | null, depthParam: number | null, maxCharsParam: number, refIdParam: string | null) => {
          if (typeof (window as unknown as { __generateAccessibilityTree?: Function }).__generateAccessibilityTree !== "function") {
            throw new Error("Accessibility tree function not found. Please refresh the page.");
          }
          return (window as unknown as { __generateAccessibilityTree: Function }).__generateAccessibilityTree(
            filterParam,
            depthParam,
            maxCharsParam,
            refIdParam
          );
        },
        args: [filter || null, depth ?? null, maxChars ?? 50000, refId ?? null],
      });

      if (!result || result.length === 0) {
        throw new Error("No results returned from page script");
      }

      if ("error" in result[0] && result[0].error) {
        throw new Error(`Script execution failed: ${(result[0].error as { message?: string }).message || "Unknown error"}`);
      }

      if (!result[0].result) {
        throw new Error("Page script returned empty result");
      }

      const pageResult = result[0].result as { error?: string; pageContent: string; viewport: { width: number; height: number } };

      if (pageResult.error) {
        return { error: pageResult.error };
      }

      const viewportInfo = `Viewport: ${pageResult.viewport.width}x${pageResult.viewport.height}`;
      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        output: `${pageResult.pageContent}\n\n${viewportInfo}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to read page: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    } finally {
      await tabGroupManager.restoreIndicatorAfterToolUse(effectiveTabId);
    }
  },
  toAnthropicSchema: async () => ({
    name: "read_page",
    description:
      "Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Output is limited to 50000 characters. If the output exceeds this limit, you will receive an error asking you to specify a smaller depth or focus on a specific element using ref_id. Optionally filter for only interactive elements. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["interactive", "all"],
          description: 'Filter elements: "interactive" for buttons/links/inputs only, "all" for all elements (default: all elements)',
        },
        tabId: {
          type: "number",
          description: "Tab ID to read from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
        depth: {
          type: "number",
          description: "Maximum depth of the tree to traverse (default: 15). Use a smaller depth if output is too large.",
        },
        ref_id: {
          type: "string",
          description: "Reference ID of a parent element to read. Will return the specified element and all its children. Use this to focus on a specific part of the page when output is too large.",
        },
        max_chars: {
          type: "number",
          description: "Maximum characters for output (default: 50000). Set to a higher value if your client can handle larger outputs.",
        },
      },
      required: ["tabId"],
    },
  }),
};

// =============================================================================
// FORM INPUT TOOL
// =============================================================================

const formInputTool: ToolSchema = {
  name: "form_input",
  description:
    "Set values in form elements using element reference ID from the read_page or find tools. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    ref: {
      type: "string",
      description: 'Element reference ID from the read_page or find tools (e.g., "ref_1", "ref_2")',
    },
    value: {
      type: ["string", "boolean", "number"],
      description: "The value to set. For checkboxes use boolean, for selects use option value or text.",
    },
    tabId: {
      type: "number",
      description: "Tab ID to set form value in.",
    },
  },
  execute: async (args, context) => {
    try {
      const params = args as { ref?: string; value?: unknown; tabId?: number };

      if (!params?.ref) {
        throw new Error("ref parameter is required");
      }

      if (params.value === undefined || params.value === null) {
        throw new Error("Value parameter is required");
      }

      if (!context?.tabId) {
        throw new Error("No active tab found");
      }

      const effectiveTabId = await tabGroupManager.getEffectiveTabId(params.tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);

      if (!tab.id) {
        throw new Error("Active tab has no ID");
      }

      const tabUrl = tab.url;
      if (!tabUrl) {
        throw new Error("No URL available for active tab");
      }

      const toolUseId = context?.toolUseId;
      const permResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

      if (!permResult.allowed) {
        if (permResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.TYPE,
            url: tabUrl,
            toolUseId,
            actionData: { ref: params.ref, value: params.value },
          };
        }
        return { error: "Permission denied for form input on this domain" };
      }

      const originalUrl = tab.url;
      if (!originalUrl) {
        return { error: "Unable to get original URL for security check" };
      }

      const domainCheck = await verifyDomainIntegrity(tab.id, originalUrl, "form input action");
      if (domainCheck) return domainCheck;

      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (ref: string, value: unknown) => {
          try {
            let element: Element | null = null;

            const elementMap = (window as unknown as { __claudeElementMap?: Record<string, WeakRef<Element>> }).__claudeElementMap;
            if (elementMap && elementMap[ref]) {
              element = elementMap[ref].deref() || null;
              if (element && !document.contains(element)) {
                delete elementMap[ref];
                element = null;
              }
            }

            if (!element) {
              return {
                error: `No element found with reference: "${ref}". The element may have been removed from the page.`,
              };
            }

            element.scrollIntoView({ behavior: "smooth", block: "center" });

            // Handle select elements
            if (element instanceof HTMLSelectElement) {
              const previousValue = element.value;
              const options = Array.from(element.options);
              let found = false;
              const valueStr = String(value);

              for (let i = 0; i < options.length; i++) {
                if (options[i].value === valueStr || options[i].text === valueStr) {
                  element.selectedIndex = i;
                  found = true;
                  break;
                }
              }

              if (!found) {
                return {
                  error: `Option "${valueStr}" not found. Available options: ${options.map((o) => `"${o.text}" (value: "${o.value}")`).join(", ")}`,
                };
              }

              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));

              return {
                output: `Selected option "${valueStr}" in dropdown (previous: "${previousValue}")`,
              };
            }

            // Handle checkbox inputs
            if (element instanceof HTMLInputElement && element.type === "checkbox") {
              const previousChecked = element.checked;

              if (typeof value !== "boolean") {
                return { error: "Checkbox requires a boolean value (true/false)" };
              }

              element.checked = value;
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));

              return {
                output: `Checkbox ${element.checked ? "checked" : "unchecked"} (previous: ${previousChecked})`,
              };
            }

            // Handle radio inputs
            if (element instanceof HTMLInputElement && element.type === "radio") {
              const previousChecked = element.checked;
              const groupName = element.name;

              element.checked = true;
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));

              return {
                success: true,
                action: "form_input",
                ref,
                element_type: "radio",
                previous_value: previousChecked,
                new_value: element.checked,
                message: "Radio button selected" + (groupName ? ` in group "${groupName}"` : ""),
              };
            }

            // Handle date/time inputs
            if (
              element instanceof HTMLInputElement &&
              ["date", "time", "datetime-local", "month", "week"].includes(element.type)
            ) {
              const previousValue = element.value;
              element.value = String(value);
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));

              return { output: `Set ${element.type} to "${element.value}" (previous: ${previousValue})` };
            }

            // Handle range inputs
            if (element instanceof HTMLInputElement && element.type === "range") {
              const previousValue = element.value;
              const numValue = Number(value);

              if (isNaN(numValue)) {
                return { error: "Range input requires a numeric value" };
              }

              element.value = String(numValue);
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));

              return {
                success: true,
                action: "form_input",
                ref,
                element_type: "range",
                previous_value: previousValue,
                new_value: element.value,
                message: `Set range to ${element.value} (min: ${element.min}, max: ${element.max})`,
              };
            }

            // Handle number inputs
            if (element instanceof HTMLInputElement && element.type === "number") {
              const previousValue = element.value;
              const numValue = Number(value);

              if (isNaN(numValue) && value !== "") {
                return { error: "Number input requires a numeric value" };
              }

              element.value = String(value);
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));

              return { output: `Set number input to ${element.value} (previous: ${previousValue})` };
            }

            // Handle text inputs and textareas
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
              const previousValue = element.value;
              element.value = String(value);
              element.focus();

              // Set cursor to end
              if (
                element instanceof HTMLTextAreaElement ||
                (element instanceof HTMLInputElement &&
                  ["text", "search", "url", "tel", "password"].includes(element.type))
              ) {
                element.setSelectionRange(element.value.length, element.value.length);
              }

              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));

              const elementType = element instanceof HTMLTextAreaElement ? "textarea" : element.type || "text";
              return {
                output: `Set ${elementType} value to "${element.value}" (previous: "${previousValue}")`,
              };
            }

            return {
              error: `Element type "${(element as Element).tagName}" is not a supported form input`,
            };
          } catch (error) {
            return {
              error: `Error setting form value: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
          }
        },
        args: [params.ref, params.value],
      });

      if (!result || result.length === 0) {
        throw new Error("Failed to execute form input");
      }

      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        ...result[0].result,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to execute form input: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "form_input",
    description:
      "Set values in form elements using element reference ID from the read_page tool. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
    input_schema: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: 'Element reference ID from the read_page tool (e.g., "ref_1", "ref_2")',
        },
        value: {
          type: ["string", "boolean", "number"],
          description: "The value to set. For checkboxes use boolean, for selects use option value or text, for other inputs use appropriate string/number",
        },
        tabId: {
          type: "number",
          description: "Tab ID to set form value in. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
      },
      required: ["ref", "value", "tabId"],
    },
  }),
};

// =============================================================================
// GET PAGE TEXT TOOL
// =============================================================================

const getPageTextTool: ToolSchema = {
  name: "get_page_text",
  description:
    "Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting. If you don't have a valid tab ID, use tabs_context first to get available tabs. Output is limited to 50000 characters by default.",
  parameters: {
    tabId: {
      type: "number",
      description: "Tab ID to extract text from.",
    },
    max_chars: {
      type: "number",
      description: "Maximum characters for output (default: 50000).",
    },
  },
  execute: async (args, context) => {
    const { tabId: requestedTabId, max_chars: maxChars } = args as { tabId?: number; max_chars?: number };

    if (!context?.tabId) {
      throw new Error("No active tab found");
    }

    const effectiveTabId = await tabGroupManager.getEffectiveTabId(requestedTabId, context.tabId);
    const tabUrl = (await chrome.tabs.get(effectiveTabId)).url;

    if (!tabUrl) {
      throw new Error("No URL available for active tab");
    }

    const toolUseId = context?.toolUseId;
    const permResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

    if (!permResult.allowed) {
      if (permResult.needsPrompt) {
        return {
          type: "permission_required",
          tool: ToolPermissionType.READ_PAGE_CONTENT,
          url: tabUrl,
          toolUseId,
        };
      }
      return { error: "Permission denied for reading page content on this domain" };
    }

    await tabGroupManager.hideIndicatorForToolUse(effectiveTabId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: effectiveTabId },
        func: (charLimit: number) => {
          // Semantic content selectors in priority order
          const contentSelectors = [
            "article",
            "main",
            '[class*="articleBody"]',
            '[class*="article-body"]',
            '[class*="post-content"]',
            '[class*="entry-content"]',
            '[class*="content-body"]',
            '[role="main"]',
            ".content",
            "#content",
          ];

          let contentElement: Element | null = null;

          // Find best content element
          for (const selector of contentSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              let bestElement = elements[0];
              let maxLength = 0;

              elements.forEach((el) => {
                const length = el.textContent?.length || 0;
                if (length > maxLength) {
                  maxLength = length;
                  bestElement = el;
                }
              });

              contentElement = bestElement;
              break;
            }
          }

          // Fall back to body
          if (!contentElement) {
            if ((document.body.textContent || "").length > charLimit) {
              return {
                text: "",
                source: "none",
                title: document.title,
                url: window.location.href,
                error: "No semantic content element found and page body is too large (likely contains CSS/scripts). Try using read_page_content (screenshot) instead.",
              };
            }
            contentElement = document.body;
          }

          // Extract and clean text
          const text = (contentElement.textContent || "")
            .replace(/\s+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          if (!text || text.length < 10) {
            return {
              text: "",
              source: "none",
              title: document.title,
              url: window.location.href,
              error: "No text content found. Page may contain only images, videos, or canvas-based content.",
            };
          }

          if (text.length > charLimit) {
            return {
              text: "",
              source: contentElement.tagName.toLowerCase(),
              title: document.title,
              url: window.location.href,
              error: `Output exceeds ${charLimit} character limit (${text.length} characters). Try using read_page with a specific ref_id to focus on a smaller section, or increase max_chars if your client can handle larger outputs.`,
            };
          }

          return {
            text,
            source: contentElement.tagName.toLowerCase(),
            title: document.title,
            url: window.location.href,
          };
        },
        args: [maxChars ?? 50000],
      });

      if (!result || result.length === 0) {
        throw new Error("No main text content found. The content might be visual content only, or rendered in a canvas element.");
      }

      if ("error" in result[0] && result[0].error) {
        throw new Error(`Script execution failed: ${(result[0].error as { message?: string }).message || "Unknown error"}`);
      }

      if (!result[0].result) {
        throw new Error("Page script returned empty result");
      }

      const pageResult = result[0].result as { text: string; source: string; title: string; url: string; error?: string };
      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      if (pageResult.error) {
        return {
          error: pageResult.error,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs,
            tabCount: availableTabs.length,
          },
        };
      }

      return {
        output: `Title: ${pageResult.title}\nURL: ${pageResult.url}\nSource element: <${pageResult.source}>\n---\n${pageResult.text}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to extract page text: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    } finally {
      await tabGroupManager.restoreIndicatorAfterToolUse(effectiveTabId);
    }
  },
  toAnthropicSchema: async () => ({
    name: "get_page_text",
    description:
      "Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting. If you don't have a valid tab ID, use tabs_context first to get available tabs. Output is limited to 50000 characters by default. If the output exceeds this limit, you will receive an error suggesting alternatives.",
    input_schema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Tab ID to extract text from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
        max_chars: {
          type: "number",
          description: "Maximum characters for output (default: 50000). Set to a higher value if your client can handle larger outputs.",
        },
      },
      required: ["tabId"],
    },
  }),
};

// =============================================================================
// SESSION CONSTANTS
// =============================================================================

const MCP_NATIVE_SESSION_ID = "mcp-native-session";

// =============================================================================
// TABS TOOLS
// =============================================================================

const tabsContextTool: ToolSchema = {
  name: "tabs_context",
  description: "Get context information about all tabs in the current tab group",
  parameters: {},
  execute: async (args, context) => {
    try {
      if (!context?.tabId) {
        throw new Error("No active tab found");
      }

      const isMcpSession = context.sessionId === MCP_NATIVE_SESSION_ID;
      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);
      const tabContext = {
        currentTabId: context.tabId,
        availableTabs,
        tabCount: availableTabs.length,
      };

      let tabGroupId: number | undefined;

      if (isMcpSession) {
        tabGroupId = await getTabGroupId(context.tabId);
      }

      const output = formatTabsAsJson(availableTabs, tabGroupId);

      if (tabGroupId !== undefined) {
        return { output, tabContext: { ...tabContext, tabGroupId } };
      }

      return { output, tabContext };
    } catch (error) {
      return {
        error: `Failed to query tabs: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "tabs_context",
    description: "Get context information about all tabs in the current tab group",
    input_schema: { type: "object", properties: {}, required: [] },
  }),
};

/**
 * Gets tab group ID for a tab
 */
async function getTabGroupId(tabId: number): Promise<number | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      return tab.groupId;
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

const tabsCreateTool: ToolSchema = {
  name: "tabs_create",
  description: "Creates a new empty tab in the current tab group",
  parameters: {},
  execute: async (args, context) => {
    try {
      if (!context?.tabId) {
        throw new Error("No active tab found");
      }

      const currentTab = await chrome.tabs.get(context.tabId);
      const newTab = await chrome.tabs.create({ url: "chrome://newtab", active: false });

      if (!newTab.id) {
        throw new Error("Failed to create tab - no tab ID returned");
      }

      // Add to same group if current tab is in a group
      if (currentTab.groupId && currentTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await chrome.tabs.group({ tabIds: newTab.id, groupId: currentTab.groupId });
      }

      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        output: `Created new tab. Tab ID: ${newTab.id}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: newTab.id,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to create tab: ${error instanceof Error ? error.message : "Unknown error"}`,
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
// PLANNING UTILITIES
// =============================================================================

/**
 * Checks if planning mode is required
 */
function requiresPlanningMode(permissionType: string, hasPlan: boolean): boolean {
  return permissionType === "follow_a_plan" && !hasPlan;
}

/**
 * Gets planning mode system reminder
 */
function getPlanningModeReminder(): string {
  return "<system-reminder>You are in planning mode. Before executing any tools, you must first present a plan to the user using the update_plan tool. The plan should include: domains (list of domains you will visit) and approach (high-level steps you will take).</system-reminder>";
}

/**
 * Approves domains for the current turn
 */
async function approveTurnDomains(
  domains: string[],
  turnContext: { setTurnApprovedDomains: (domains: string[]) => void }
): Promise<string[]> {
  if (!domains || domains.length === 0) return [];

  const approved: string[] = [];
  const filtered: string[] = [];

  for (const domain of domains) {
    try {
      const url = domain.startsWith("http") ? domain : `https://${domain}`;
      const category = await DomainCategoryCache.getCategory(url);

      if (!category || (category !== "category1" && category !== "category2" && category !== "category_org_blocked")) {
        approved.push(domain);
      } else {
        filtered.push(domain);
      }
    } catch {
      approved.push(domain);
    }
  }

  turnContext.setTurnApprovedDomains(approved);
  return approved;
}

// =============================================================================
// UPDATE PLAN TOOL
// =============================================================================

const updatePlanInputSchema = {
  type: "object",
  properties: {
    domains: {
      type: "array",
      items: { type: "string" },
      description: "List of domains you will visit (e.g., ['github.com', 'stackoverflow.com']). These domains will be approved for the session when the user accepts the plan.",
    },
    approach: {
      type: "array",
      items: { type: "string" },
      description: "High-level description of what you will do. Focus on outcomes and key actions, not implementation details. Be concise - aim for 3-7 items.",
    },
  },
  required: ["domains", "approach"],
};

const updatePlanTool: ToolSchema & { setPromptsConfig: (config: Record<string, unknown>) => void } = {
  name: "update_plan",
  description:
    "Present a plan to the user for approval before taking actions. The user will see the domains you intend to visit and your approach. Once approved, you can proceed with actions on the approved domains without additional permission prompts.",
  parameters: updatePlanInputSchema,
  async execute(args, context) {
    // Validate plan format
    const params = args as { domains?: string[]; approach?: string[] };
    const validationErrors: Record<string, string> = {};

    if (!params.domains || !Array.isArray(params.domains)) {
      validationErrors.domains = "Required field missing or not an array";
    }

    if (!params.approach || !Array.isArray(params.approach)) {
      validationErrors.approach = "Required field missing or not an array";
    }

    if (Object.keys(validationErrors).length > 0) {
      return {
        error: JSON.stringify({
          type: "validation_error",
          message: "Invalid plan format. Both 'domains' and 'approach' are required arrays.",
          fields: validationErrors,
        }),
      };
    }

    const { domains, approach } = params as { domains: string[]; approach: string[] };

    // Get domain categories
    const domainInfos: { domain: string; category?: string }[] = [];

    for (const domain of domains) {
      try {
        const url = domain.startsWith("http") ? domain : `https://${domain}`;
        const category = await DomainCategoryCache.getCategory(url);
        domainInfos.push({ domain, category: category ?? undefined });
      } catch {
        domainInfos.push({ domain });
      }
    }

    return {
      type: "permission_required",
      tool: ToolPermissionType.PLAN_APPROVAL,
      url: "",
      toolUseId: context?.toolUseId,
      actionData: { plan: { domains: domainInfos, approach } },
    };
  },
  setPromptsConfig(config: Record<string, unknown>) {
    if ((config as { toolDescription?: string }).toolDescription) {
      this.description = (config as { toolDescription: string }).toolDescription;
    }

    const inputDescriptions = (config as { inputPropertyDescriptions?: Record<string, string> }).inputPropertyDescriptions;
    if (inputDescriptions) {
      const props = updatePlanInputSchema.properties as Record<string, { description?: string }>;

      if (inputDescriptions.domains) {
        props.domains.description = inputDescriptions.domains;
      }

      if (inputDescriptions.approach) {
        props.approach.description = inputDescriptions.approach;
      }
    }
  },
  toAnthropicSchema() {
    return Promise.resolve({
      type: "custom",
      name: this.name,
      description: this.description,
      input_schema: updatePlanInputSchema,
    }) as any;
  },
};

// =============================================================================
// UPLOAD IMAGE TOOL
// =============================================================================

const uploadImageTool: ToolSchema = {
  name: "upload_image",
  description:
    "Upload a previously captured screenshot or user-uploaded image to a file input or drag & drop target. Supports two approaches: (1) ref - for targeting specific elements, especially hidden file inputs, (2) coordinate - for drag & drop to visible locations like Google Docs. Provide either ref or coordinate, not both.",
  parameters: {
    imageId: {
      type: "string",
      description: "ID of a previously captured screenshot (from the computer tool's screenshot action) or a user-uploaded image",
    },
    ref: {
      type: "string",
      description: 'Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Use this for file inputs (especially hidden ones) or specific elements. Provide either ref or coordinate, not both.',
    },
    coordinate: {
      type: "array",
      description: "Viewport coordinates [x, y] for drag & drop to a visible location. Use this for drag & drop targets like Google Docs. Provide either ref or coordinate, not both.",
    },
    tabId: {
      type: "number",
      description: "Tab ID where the target element is located. This is where the image will be uploaded to.",
    },
    filename: {
      type: "string",
      description: 'Optional filename for the uploaded file (default: "image.png")',
    },
  },
  execute: async (args, context) => {
    try {
      const params = args as {
        imageId?: string;
        ref?: string;
        coordinate?: [number, number];
        tabId?: number;
        filename?: string;
      };

      if (!params?.imageId) {
        throw new Error("imageId parameter is required");
      }

      if (!params?.ref && !params?.coordinate) {
        throw new Error("Either ref or coordinate parameter is required. Provide ref for targeting specific elements or coordinate for drag & drop to a location.");
      }

      if (params?.ref && params?.coordinate) {
        throw new Error("Provide either ref or coordinate, not both. Use ref for specific elements or coordinate for drag & drop.");
      }

      if (!context?.tabId) {
        throw new Error("No active tab found");
      }

      const effectiveTabId = await tabGroupManager.getEffectiveTabId(params.tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);

      if (!tab.id) {
        throw new Error("Upload tab has no ID");
      }

      const tabUrl = tab.url;
      if (!tabUrl) {
        throw new Error("No URL available for upload tab");
      }

      const toolUseId = context?.toolUseId;
      const permResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

      if (!permResult.allowed) {
        if (permResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.UPLOAD_IMAGE,
            url: tabUrl,
            toolUseId,
            actionData: {
              ref: params.ref,
              coordinate: params.coordinate,
              imageId: params.imageId,
            },
          };
        }
        return { error: "Permission denied for uploading to this domain" };
      }

      const originalUrl = tab.url;
      if (!originalUrl) {
        return { error: "Unable to get original URL for security check" };
      }

      if (!context.messages) {
        return { error: "Unable to access message history to retrieve image" };
      }

      console.info(`[Upload-Image] Looking for image with ID: ${params.imageId}`);
      console.info(`[Upload-Image] Messages available: ${context.messages.length}`);

      const imageData = findImageInMessages(context.messages, params.imageId);

      if (!imageData) {
        return {
          error: `Image not found with ID: ${params.imageId}. Please ensure the image was captured or uploaded earlier in this conversation.`,
        };
      }

      const base64Data = imageData.base64;

      const domainCheck = await verifyDomainIntegrity(tab.id, originalUrl, "upload image action");
      if (domainCheck) return domainCheck;

      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (elementRef: string | null, coordinates: [number, number] | null, base64: string, filename: string) => {
          try {
            let targetElement: Element | null = null;

            if (coordinates) {
              targetElement = document.elementFromPoint(coordinates[0], coordinates[1]);

              if (!targetElement) {
                return { error: `No element found at coordinates (${coordinates[0]}, ${coordinates[1]})` };
              }

              // Handle iframe
              if (targetElement.tagName === "IFRAME") {
                try {
                  const iframe = targetElement as HTMLIFrameElement;
                  const iframeDoc = iframe.contentDocument || (iframe.contentWindow ? iframe.contentWindow.document : null);

                  if (iframeDoc) {
                    const iframeRect = iframe.getBoundingClientRect();
                    const iframeX = coordinates[0] - iframeRect.left;
                    const iframeY = coordinates[1] - iframeRect.top;
                    const iframeElement = iframeDoc.elementFromPoint(iframeX, iframeY);

                    if (iframeElement) {
                      targetElement = iframeElement;
                    }
                  }
                } catch {
                  // Continue with original element
                }
              }
            } else {
              if (!elementRef) {
                return { error: "Neither coordinate nor elementRef provided" };
              }

              const elementMap = (window as unknown as { __claudeElementMap?: Record<string, WeakRef<Element>> }).__claudeElementMap;
              if (elementMap && elementMap[elementRef]) {
                targetElement = elementMap[elementRef].deref() || null;
                if (targetElement && !document.contains(targetElement)) {
                  delete elementMap[elementRef];
                  targetElement = null;
                }
              }

              if (!targetElement) {
                return { error: `No element found with reference: "${elementRef}". The element may have been removed from the page.` };
              }
            }

            targetElement.scrollIntoView({ behavior: "smooth", block: "center" });

            // Decode base64 to binary
            const binaryString = atob(base64);
            const bytes = new Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const uint8Array = new Uint8Array(bytes);

            // Create file
            const blob = new Blob([uint8Array], { type: "image/png" });
            const file = new File([blob], filename, {
              type: "image/png",
              lastModified: Date.now(),
            });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            // Handle file input
            if (targetElement.tagName === "INPUT" && (targetElement as HTMLInputElement).type === "file") {
              const input = targetElement as HTMLInputElement;
              input.files = dataTransfer.files;
              input.focus();
              input.dispatchEvent(new Event("change", { bubbles: true }));
              input.dispatchEvent(new Event("input", { bubbles: true }));

              const fileChangeEvent = new CustomEvent("filechange", {
                bubbles: true,
                detail: { files: dataTransfer.files },
              });
              input.dispatchEvent(fileChangeEvent);

              return {
                output: `Successfully uploaded image "${filename}" (${Math.round(blob.size / 1024)}KB) to file input`,
              };
            }

            // Handle drag & drop
            let dropX: number;
            let dropY: number;

            targetElement.focus();

            if (coordinates) {
              dropX = coordinates[0];
              dropY = coordinates[1];
            } else {
              const rect = targetElement.getBoundingClientRect();
              dropX = rect.left + rect.width / 2;
              dropY = rect.top + rect.height / 2;
            }

            // Dispatch drag events
            const dragEnterEvent = new DragEvent("dragenter", {
              bubbles: true,
              cancelable: true,
              dataTransfer,
              clientX: dropX,
              clientY: dropY,
              screenX: dropX + window.screenX,
              screenY: dropY + window.screenY,
            });
            targetElement.dispatchEvent(dragEnterEvent);

            const dragOverEvent = new DragEvent("dragover", {
              bubbles: true,
              cancelable: true,
              dataTransfer,
              clientX: dropX,
              clientY: dropY,
              screenX: dropX + window.screenX,
              screenY: dropY + window.screenY,
            });
            targetElement.dispatchEvent(dragOverEvent);

            const dropEvent = new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              dataTransfer,
              clientX: dropX,
              clientY: dropY,
              screenX: dropX + window.screenX,
              screenY: dropY + window.screenY,
            });
            targetElement.dispatchEvent(dropEvent);

            return {
              output: `Successfully dropped image "${filename}" (${Math.round(blob.size / 1024)}KB) onto element at (${Math.round(dropX)}, ${Math.round(dropY)})`,
            };
          } catch (error) {
            return {
              error: `Error uploading image: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
          }
        },
        args: [params.ref || null, params.coordinate || null, base64Data, params.filename || "image.png"],
      });

      if (!result || result.length === 0) {
        throw new Error("Failed to execute upload image");
      }

      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        ...result[0].result,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to upload image: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "upload_image",
    description:
      "Upload a previously captured screenshot or user-uploaded image to a file input or drag & drop target. Supports two approaches: (1) ref - for targeting specific elements, especially hidden file inputs, (2) coordinate - for drag & drop to visible locations like Google Docs. Provide either ref or coordinate, not both.",
    input_schema: {
      type: "object",
      properties: {
        imageId: {
          type: "string",
          description: "ID of a previously captured screenshot (from the computer tool's screenshot action) or a user-uploaded image",
        },
        ref: {
          type: "string",
          description: 'Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Use this for file inputs (especially hidden ones) or specific elements. Provide either ref or coordinate, not both.',
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          description: "Viewport coordinates [x, y] for drag & drop to a visible location. Use this for drag & drop targets like Google Docs. Provide either ref or coordinate, not both.",
        },
        tabId: {
          type: "number",
          description: "Tab ID where the target element is located. This is where the image will be uploaded to.",
        },
        filename: {
          type: "string",
          description: 'Optional filename for the uploaded file (default: "image.png")',
        },
      },
      required: ["imageId", "tabId"],
    },
  }),
};

// =============================================================================
// CONSOLE & NETWORK TOOLS
// =============================================================================

/**
 * Read browser console messages tool
 */
const readConsoleMessagesTool: ToolSchema = {
  name: "read_console_messages",
  description:
    "Read browser console messages (console.log, console.error, console.warn, etc.) from a specific tab. Useful for debugging JavaScript errors, viewing application logs, or understanding what's happening in the browser console. Returns console messages from the current domain only. If you don't have a valid tab ID, use tabs_context first to get available tabs. IMPORTANT: Always provide a pattern to filter messages - without a pattern, you may get too many irrelevant messages.",
  parameters: {
    tabId: {
      type: "number",
      description:
        "Tab ID to read console messages from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
      required: true,
    },
    onlyErrors: {
      type: "boolean",
      description:
        "If true, only return error and exception messages. Default is false (return all message types).",
      required: false,
    },
    clear: {
      type: "boolean",
      description:
        "If true, clear the console messages after reading to avoid duplicates on subsequent calls. Default is false.",
      required: false,
    },
    pattern: {
      type: "string",
      description:
        "Regex pattern to filter console messages. Only messages matching this pattern will be returned (e.g., 'error|warning' to find errors and warnings, 'MyApp' to filter app-specific logs). You should always provide a pattern to avoid getting too many irrelevant messages.",
      required: false,
    },
    limit: {
      type: "number",
      description:
        "Maximum number of messages to return. Defaults to 100. Increase only if you need more results.",
      required: false,
    },
  },
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    try {
      const {
        tabId,
        onlyErrors = false,
        clear = false,
        pattern,
        limit = 100,
      } = params as {
        tabId?: number;
        onlyErrors?: boolean;
        clear?: boolean;
        pattern?: string;
        limit?: number;
      };

      if (!context?.tabId) throw new Error("No active tab found");

      const effectiveTabId = await tabGroupManager.getEffectiveTabId(tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);

      if (!tab.id) throw new Error("Active tab has no ID");

      const tabUrl = tab.url;
      if (!tabUrl) throw new Error("No URL available for active tab");

      const toolUseId = context?.toolUseId;
      const permissionResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

      if (!permissionResult.allowed) {
        if (permissionResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.READ_CONSOLE_MESSAGES,
            url: tabUrl,
            toolUseId: toolUseId,
          };
        }
        return {
          error: "Permission denied for reading console messages on this domain",
        };
      }

      // Enable console tracking
      try {
        await cdpDebugger.enableConsoleTracking(tab.id);
      } catch {
        // Ignore errors - console tracking may already be enabled
      }

      const messages = cdpDebugger.getConsoleMessages(tab.id, onlyErrors as boolean, pattern as string | undefined);

      if (clear) {
        cdpDebugger.clearConsoleMessages(tab.id);
      }

      if (messages.length === 0) {
        return {
          output: `No console ${onlyErrors ? "errors or exceptions" : "messages"} found for this tab.\n\nNote: Console tracking starts when this tool is first called. If the page loaded before calling this tool, you may need to refresh the page to capture console messages from page load.`,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs: await tabGroupManager.getValidTabsWithMetadata(context.tabId),
            tabCount: (await tabGroupManager.getValidTabsWithMetadata(context.tabId)).length,
          },
        };
      }

      const limitedMessages = messages.slice(0, limit as number);
      const hasMore = messages.length > (limit as number);

      const formattedMessages = limitedMessages
        .map((msg: { timestamp: number; url?: string; lineNumber?: number; columnNumber?: number; type: string; text: string; stackTrace?: string }, index: number) => {
          const timestamp = new Date(msg.timestamp).toLocaleTimeString();
          const location =
            msg.url && msg.lineNumber !== undefined
              ? ` (${msg.url}:${msg.lineNumber}${msg.columnNumber !== undefined ? `:${msg.columnNumber}` : ""})`
              : "";

          let formatted = `[${index + 1}] [${timestamp}] [${msg.type.toUpperCase()}]${location}\n${msg.text}`;

          if (msg.stackTrace) {
            formatted += `\nStack trace:\n${msg.stackTrace}`;
          }

          return formatted;
        })
        .join("\n\n");

      const messageType = onlyErrors ? "error/exception messages" : "console messages";
      const truncationNote = hasMore ? ` (showing first ${limit} of ${messages.length})` : "";
      const summary = `Found ${messages.length} ${messageType}${truncationNote}:`;

      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        output: `${summary}\n\n${formattedMessages}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to read console messages: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "read_console_messages",
    description:
      "Read browser console messages (console.log, console.error, console.warn, etc.) from a specific tab. Useful for debugging JavaScript errors, viewing application logs, or understanding what's happening in the browser console. Returns console messages from the current domain only. If you don't have a valid tab ID, use tabs_context first to get available tabs. IMPORTANT: Always provide a pattern to filter messages - without a pattern, you may get too many irrelevant messages.",
    input_schema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description:
            "Tab ID to read console messages from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
        onlyErrors: {
          type: "boolean",
          description:
            "If true, only return error and exception messages. Default is false (return all message types).",
        },
        clear: {
          type: "boolean",
          description:
            "If true, clear the console messages after reading to avoid duplicates on subsequent calls. Default is false.",
        },
        pattern: {
          type: "string",
          description:
            "Regex pattern to filter console messages. Only messages matching this pattern will be returned (e.g., 'error|warning' to find errors and warnings, 'MyApp' to filter app-specific logs). You should always provide a pattern to avoid getting too many irrelevant messages.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of messages to return. Defaults to 100. Increase only if you need more results.",
        },
      },
      required: ["tabId"],
    },
  }),
};

/**
 * Read HTTP network requests tool
 */
const readNetworkRequestsTool: ToolSchema = {
  name: "read_network_requests",
  description:
    "Read HTTP network requests (XHR, Fetch, documents, images, etc.) from a specific tab. Useful for debugging API calls, monitoring network activity, or understanding what requests a page is making. Returns all network requests made by the current page, including cross-origin requests. Requests are automatically cleared when the page navigates to a different domain. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    tabId: {
      type: "number",
      description:
        "Tab ID to read network requests from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
      required: true,
    },
    urlPattern: {
      type: "string",
      description:
        "Optional URL pattern to filter requests. Only requests whose URL contains this string will be returned (e.g., '/api/' to filter API calls, 'example.com' to filter by domain).",
      required: false,
    },
    clear: {
      type: "boolean",
      description:
        "If true, clear the network requests after reading to avoid duplicates on subsequent calls. Default is false.",
      required: false,
    },
    limit: {
      type: "number",
      description:
        "Maximum number of requests to return. Defaults to 100. Increase only if you need more results.",
      required: false,
    },
  },
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    try {
      const {
        tabId,
        urlPattern,
        clear = false,
        limit = 100,
      } = params as {
        tabId?: number;
        urlPattern?: string;
        clear?: boolean;
        limit?: number;
      };

      if (!context?.tabId) throw new Error("No active tab found");

      const effectiveTabId = await tabGroupManager.getEffectiveTabId(tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);

      if (!tab.id) throw new Error("Active tab has no ID");

      const tabUrl = tab.url;
      if (!tabUrl) throw new Error("No URL available for active tab");

      const toolUseId = context?.toolUseId;
      const permissionResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

      if (!permissionResult.allowed) {
        if (permissionResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.READ_NETWORK_REQUESTS,
            url: tabUrl,
            toolUseId: toolUseId,
          };
        }
        return {
          error: "Permission denied for reading network requests on this domain",
        };
      }

      // Enable network tracking
      try {
        await cdpDebugger.enableNetworkTracking(tab.id);
      } catch {
        // Ignore errors - network tracking may already be enabled
      }

      const requests = cdpDebugger.getNetworkRequests(tab.id, urlPattern as string | undefined);

      if (clear) {
        cdpDebugger.clearNetworkRequests(tab.id);
      }

      if (requests.length === 0) {
        let requestType = "network requests";
        if (urlPattern) {
          requestType = `requests matching "${urlPattern}"`;
        }

        return {
          output: `No ${requestType} found for this tab.\n\nNote: Network tracking starts when this tool is first called. If the page loaded before calling this tool, you may need to refresh the page or perform actions that trigger network requests.`,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs: await tabGroupManager.getValidTabsWithMetadata(context.tabId),
            tabCount: (await tabGroupManager.getValidTabsWithMetadata(context.tabId)).length,
          },
        };
      }

      const limitedRequests = requests.slice(0, limit as number);
      const hasMore = requests.length > (limit as number);

      const formattedRequests = limitedRequests
        .map((req: { url: string; method: string; status?: number | string }, index: number) => {
          const status = req.status || "pending";
          return `${index + 1}. url: ${req.url}\n   method: ${req.method}\n   statusCode: ${status}`;
        })
        .join("\n\n");

      const filters: string[] = [];
      if (urlPattern) {
        filters.push(`URL pattern: "${urlPattern}"`);
      }

      const filterNote = filters.length > 0 ? ` (filtered by ${filters.join(", ")})` : "";
      const truncationNote = hasMore ? ` (showing first ${limit} of ${requests.length})` : "";
      const summary = `Found ${requests.length} network request${requests.length === 1 ? "" : "s"}${filterNote}${truncationNote}:`;

      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        output: `${summary}\n\n${formattedRequests}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to read network requests: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "read_network_requests",
    description:
      "Read HTTP network requests (XHR, Fetch, documents, images, etc.) from a specific tab. Useful for debugging API calls, monitoring network activity, or understanding what requests a page is making. Returns all network requests made by the current page, including cross-origin requests. Requests are automatically cleared when the page navigates to a different domain. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
    input_schema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description:
            "Tab ID to read network requests from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
        urlPattern: {
          type: "string",
          description:
            "Optional URL pattern to filter requests. Only requests whose URL contains this string will be returned (e.g., '/api/' to filter API calls, 'example.com' to filter by domain).",
        },
        clear: {
          type: "boolean",
          description:
            "If true, clear the network requests after reading to avoid duplicates on subsequent calls. Default is false.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of requests to return. Defaults to 100. Increase only if you need more results.",
        },
      },
      required: ["tabId"],
    },
  }),
};

// =============================================================================
// WINDOW RESIZE TOOL
// =============================================================================

/**
 * Resize browser window tool
 */
const resizeWindowTool: ToolSchema = {
  name: "resize_window",
  description:
    "Resize the current browser window to specified dimensions. Useful for testing responsive designs or setting up specific screen sizes. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    width: { type: "number", description: "Target window width in pixels" },
    height: { type: "number", description: "Target window height in pixels" },
    tabId: {
      type: "number",
      description:
        "Tab ID to get the window for. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
    },
  },
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    try {
      const { width, height, tabId } = params as {
        width?: number;
        height?: number;
        tabId?: number;
      };

      if (!width || !height) {
        throw new Error("Both width and height parameters are required");
      }
      if (!tabId) {
        throw new Error("tabId parameter is required");
      }
      if (!context?.tabId) {
        throw new Error("No active tab found");
      }
      if (typeof width !== "number" || typeof height !== "number") {
        throw new Error("Width and height must be numbers");
      }
      if (width <= 0 || height <= 0) {
        throw new Error("Width and height must be positive numbers");
      }
      if (width > 7680 || height > 4320) {
        throw new Error(
          "Dimensions exceed 8K resolution limit. Maximum dimensions are 7680x4320"
        );
      }

      const effectiveTabId = await tabGroupManager.getEffectiveTabId(tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);

      if (!tab.windowId) {
        throw new Error("Tab does not have an associated window");
      }

      await chrome.windows.update(tab.windowId, {
        width: Math.floor(width),
        height: Math.floor(height),
      });

      return {
        output: `Successfully resized window containing tab ${effectiveTabId} to ${Math.floor(width)}x${Math.floor(height)} pixels`,
      };
    } catch (error) {
      return {
        error: `Failed to resize window: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "resize_window",
    description:
      "Resize the current browser window to specified dimensions. Useful for testing responsive designs or setting up specific screen sizes. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
    input_schema: {
      type: "object",
      properties: {
        width: {
          type: "number",
          description: "Target window width in pixels",
        },
        height: {
          type: "number",
          description: "Target window height in pixels",
        },
        tabId: {
          type: "number",
          description:
            "Tab ID to get the window for. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
      },
      required: ["width", "height", "tabId"],
    },
  }),
};

// =============================================================================
// GIF RECORDING
// =============================================================================

/**
 * GIF recording storage - manages frame capture for animated GIF creation
 * Uses the GifFrame interface defined in the type definitions section
 */
class GifRecordingStorage {
  private storage = new Map<number, { frames: GifFrame[]; lastUpdated: number }>();
  private recordingGroups = new Set<number>();

  addFrame(groupId: number, frame: GifFrame): void {
    if (!this.storage.has(groupId)) {
      this.storage.set(groupId, { frames: [], lastUpdated: Date.now() });
    }

    const data = this.storage.get(groupId)!;
    data.frames.push(frame);
    data.lastUpdated = Date.now();

    // Limit to 50 frames max
    if (data.frames.length > 50) {
      data.frames.shift();
    }
  }

  getFrames(groupId: number): GifFrame[] {
    return this.storage.get(groupId)?.frames ?? [];
  }

  clearFrames(groupId: number): void {
    this.storage.get(groupId)?.frames.length;
    this.storage.delete(groupId);
    this.recordingGroups.delete(groupId);
  }

  getFrameCount(groupId: number): number {
    return this.storage.get(groupId)?.frames.length ?? 0;
  }

  getActiveGroupIds(): number[] {
    return Array.from(this.storage.keys());
  }

  startRecording(groupId: number): void {
    this.recordingGroups.add(groupId);
  }

  stopRecording(groupId: number): void {
    this.recordingGroups.delete(groupId);
  }

  isRecording(groupId: number): boolean {
    return this.recordingGroups.has(groupId);
  }

  getRecordingGroupIds(): number[] {
    return Array.from(this.recordingGroups);
  }

  clearAll(): void {
    Array.from(this.storage.values()).reduce(
      (acc, data) => acc + data.frames.length,
      0
    );
    this.storage.clear();
    this.recordingGroups.clear();
  }
}

const gifRecordingStorage = new GifRecordingStorage();

/**
 * Get delay time for a GIF frame based on action type
 */
function getGifFrameDelay(actionType: string): number {
  const delays: Record<string, number> = {
    wait: 300,
    screenshot: 300,
    navigate: 800,
    scroll: 800,
    scroll_to: 800,
    type: 800,
    key: 800,
    zoom: 800,
    left_click: 1500,
    right_click: 1500,
    double_click: 1500,
    triple_click: 1500,
    left_click_drag: 1500,
  };
  return delays[actionType] ?? 800;
}

/**
 * GIF creator tool for recording and exporting browser action GIFs
 */
const gifCreatorTool: ToolSchema = {
  name: "gif_creator",
  description:
    "Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays (click indicators, action labels, progress bar, watermark). All operations are scoped to the tab's group. When starting recording, take a screenshot immediately after to capture the initial state as the first frame. When stopping recording, take a screenshot immediately before to capture the final state as the last frame. For export, either provide 'coordinate' to drag/drop upload to a page element, or set 'download: true' to download the GIF.",
  parameters: {
    action: {
      type: "string",
      description:
        "Action to perform: 'start_recording' (begin capturing), 'stop_recording' (stop capturing but keep frames), 'export' (generate and export GIF), 'clear' (discard frames)",
    },
    tabId: {
      type: "number",
      description:
        "Tab ID to identify which tab group this operation applies to",
    },
    coordinate: {
      type: "array",
      description:
        "Viewport coordinates [x, y] for drag & drop upload. Required for 'export' action unless 'download' is true.",
    },
    download: {
      type: "boolean",
      description:
        "If true, download the GIF instead of drag/drop upload. For 'export' action only.",
    },
    filename: {
      type: "string",
      description:
        "Optional filename for exported GIF (default: 'recording-[timestamp].gif'). For 'export' action only.",
    },
    options: {
      type: "object",
      description:
        "Optional GIF enhancement options for 'export' action. All default to true.",
    },
  },
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    try {
      const gifParams = params as {
        action?: string;
        tabId?: number;
        coordinate?: [number, number];
        download?: boolean;
        filename?: string;
        options?: {
          showClickIndicators?: boolean;
          showDragPaths?: boolean;
          showActionLabels?: boolean;
          showProgressBar?: boolean;
          showWatermark?: boolean;
          quality?: number;
        };
      };

      if (!gifParams?.action) throw new Error("action parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tab = await chrome.tabs.get(gifParams.tabId!);
      if (!tab) throw new Error(`Tab ${gifParams.tabId} not found`);

      const groupId = tab.groupId ?? -1;

      // For MCP mode, verify tab is in MCP tab group
      if (context.sessionId === MCP_NATIVE_SESSION_ID) {
        const stored = await chrome.storage.local.get(StorageKeys.MCP_TAB_GROUP_ID);
        if (groupId !== stored[StorageKeys.MCP_TAB_GROUP_ID]) {
          return {
            error: `Tab ${gifParams.tabId} is not in the MCP tab group. GIF recording only works for tabs within the MCP tab group.`,
          };
        }
      }

      switch (gifParams.action) {
        case "start_recording":
          return await handleStartRecording(groupId);

        case "stop_recording":
          return await handleStopRecording(groupId);

        case "export":
          return await handleExportGif(gifParams, tab, groupId, context);

        case "clear":
          return await handleClearFrames(groupId);

        default:
          throw new Error(
            `Unknown action: ${gifParams.action}. Must be one of: start_recording, stop_recording, export, clear`
          );
      }
    } catch (error) {
      return {
        error: `Failed to execute gif_creator: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "gif_creator",
    description:
      "Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays (click indicators, action labels, progress bar, watermark). All operations are scoped to the tab's group. When starting recording, take a screenshot immediately after to capture the initial state as the first frame. When stopping recording, take a screenshot immediately before to capture the final state as the last frame. For export, either provide 'coordinate' to drag/drop upload to a page element, or set 'download: true' to download the GIF.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start_recording", "stop_recording", "export", "clear"],
          description:
            "Action to perform: 'start_recording' (begin capturing), 'stop_recording' (stop capturing but keep frames), 'export' (generate and export GIF), 'clear' (discard frames)",
        },
        tabId: {
          type: "number",
          description:
            "Tab ID to identify which tab group this operation applies to",
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          description:
            "Viewport coordinates [x, y] for drag & drop upload. Required for 'export' action unless 'download' is true.",
        },
        download: {
          type: "boolean",
          description:
            "If true, download the GIF instead of drag/drop upload. For 'export' action only.",
        },
        filename: {
          type: "string",
          description:
            "Optional filename for exported GIF (default: 'recording-[timestamp].gif'). For 'export' action only.",
        },
        options: {
          type: "object",
          description:
            "Optional GIF enhancement options for 'export' action. Properties: showClickIndicators (bool), showDragPaths (bool), showActionLabels (bool), showProgressBar (bool), showWatermark (bool), quality (number 1-30). All default to true except quality (default: 10).",
          properties: {
            showClickIndicators: {
              type: "boolean",
              description: "Show orange circles at click locations (default: true)",
            },
            showDragPaths: {
              type: "boolean",
              description: "Show red arrows for drag actions (default: true)",
            },
            showActionLabels: {
              type: "boolean",
              description: "Show black labels describing actions (default: true)",
            },
            showProgressBar: {
              type: "boolean",
              description: "Show orange progress bar at bottom (default: true)",
            },
            showWatermark: {
              type: "boolean",
              description: "Show Logo watermark (default: true)",
            },
            quality: {
              type: "number",
              description:
                "GIF compression quality, 1-30 (lower = better quality, slower encoding). Default: 10",
            },
          },
        },
      },
      required: ["action", "tabId"],
    },
  }),
};

/**
 * Handle start_recording action for GIF creator
 */
async function handleStartRecording(groupId: number): Promise<ToolResult> {
  const isAlreadyRecording = gifRecordingStorage.isRecording(groupId);

  if (isAlreadyRecording) {
    return {
      output:
        "Recording is already active for this tab group. Use 'stop_recording' to stop or 'export' to generate GIF.",
    };
  }

  gifRecordingStorage.clearFrames(groupId);
  gifRecordingStorage.startRecording(groupId);

  return {
    output:
      "Started recording browser actions for this tab group. All computer and navigate tool actions will now be captured (max 50 frames). Previous frames cleared.",
  };
}

/**
 * Handle stop_recording action for GIF creator
 */
async function handleStopRecording(groupId: number): Promise<ToolResult> {
  const isRecording = gifRecordingStorage.isRecording(groupId);

  if (!isRecording) {
    return {
      output:
        "Recording is not active for this tab group. Use 'start_recording' to begin capturing.",
    };
  }

  gifRecordingStorage.stopRecording(groupId);
  const frameCount = gifRecordingStorage.getFrameCount(groupId);

  return {
    output: `Stopped recording for this tab group. Captured ${frameCount} frame${frameCount === 1 ? "" : "s"}. Use 'export' to generate GIF or 'clear' to discard.`,
  };
}

/**
 * Handle export action for GIF creator
 */
async function handleExportGif(
  params: {
    coordinate?: [number, number];
    download?: boolean;
    filename?: string;
    options?: {
      showClickIndicators?: boolean;
      showDragPaths?: boolean;
      showActionLabels?: boolean;
      showProgressBar?: boolean;
      showWatermark?: boolean;
      quality?: number;
    };
  },
  tab: chrome.tabs.Tab,
  groupId: number,
  context: ToolContext
): Promise<ToolResult> {
  const shouldDownload = params.download === true;

  if (!shouldDownload && (!params.coordinate || params.coordinate.length !== 2)) {
    throw new Error(
      "coordinate parameter is required for export action (or set download: true to download the GIF)"
    );
  }

  if (!tab.id || !tab.url) {
    throw new Error("Tab has no ID or URL");
  }

  const frames = gifRecordingStorage.getFrames(groupId);

  if (frames.length === 0) {
    return {
      error:
        "No frames recorded for this tab group. Use 'start_recording' and perform browser actions first.",
    };
  }

  // Check permissions for upload (not needed for download)
  if (!shouldDownload) {
    const tabUrl = tab.url;
    const toolUseId = context?.toolUseId;
    const permissionResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

    if (!permissionResult.allowed) {
      if (permissionResult.needsPrompt) {
        return {
          type: "permission_required",
          tool: ToolPermissionType.UPLOAD_IMAGE,
          url: tabUrl,
          toolUseId: toolUseId,
          actionData: { coordinate: params.coordinate },
        };
      }
      return {
        error: "Permission denied for uploading to this domain",
      };
    }
  }

  const originalUrl = tab.url;

  // Ensure offscreen document exists for GIF generation
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS" as chrome.offscreen.Reason],
      justification: "Generate animated GIF from screenshots",
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Prepare frame data for offscreen document
  const frameData = frames.map((frame) => ({
    base64: frame.base64,
    format: "png",
    action: frame.action,
    delay: frame.action ? getGifFrameDelay(frame.action.type) : 800,
    viewportWidth: frame.viewportWidth,
    viewportHeight: frame.viewportHeight,
    devicePixelRatio: frame.devicePixelRatio,
  }));

  const gifOptions = {
    showClickIndicators: params.options?.showClickIndicators ?? true,
    showDragPaths: params.options?.showDragPaths ?? true,
    showActionLabels: params.options?.showActionLabels ?? true,
    showProgressBar: params.options?.showProgressBar ?? true,
    showWatermark: params.options?.showWatermark ?? true,
    quality: params.options?.quality ?? 10,
  };

  // Generate GIF via offscreen document
  const gifResult = await new Promise<{ blobUrl: string; base64: string; size: number; width: number; height: number }>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "GENERATE_GIF", frames: frameData, options: gifOptions },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response?.error || "Unknown error from offscreen"));
        }
      }
    );
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = params.filename || `recording-${timestamp}.gif`;

  let outputMessage: string;

  if (shouldDownload) {
    // Download the GIF
    await chrome.downloads.download({
      url: gifResult.blobUrl,
      filename: filename,
      saveAs: false,
    });

    outputMessage = `Successfully exported GIF with ${frames.length} frames. Downloaded "${filename}" (${Math.round(gifResult.size / 1024)}KB). Dimensions: ${gifResult.width}x${gifResult.height}. Recording cleared.`;
  } else {
    // Upload via drag & drop
    const securityCheck = await verifyDomainIntegrity(tab.id!, originalUrl, "GIF export upload action");
    if (securityCheck) return securityCheck;

    const uploadResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (base64Data: string, fileName: string, x: number, y: number) => {
        const binaryString = atob(base64Data);
        const bytes = new Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const uint8Array = new Uint8Array(bytes);
        const blob = new Blob([uint8Array], { type: "image/gif" });
        const file = new File([blob], fileName, {
          type: "image/gif",
          lastModified: Date.now(),
        });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const targetElement = document.elementFromPoint(x, y);
        if (!targetElement) {
          throw new Error(`No element found at coordinates (${x}, ${y})`);
        }

        targetElement.dispatchEvent(
          new DragEvent("dragenter", {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
            clientX: x,
            clientY: y,
          })
        );

        targetElement.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
            clientX: x,
            clientY: y,
          })
        );

        targetElement.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
            clientX: x,
            clientY: y,
          })
        );

        return {
          output: `Successfully dropped ${fileName} (${Math.round(blob.size / 1024)}KB) at (${x}, ${y})`,
        };
      },
      args: [gifResult.base64, filename, params.coordinate![0], params.coordinate![1]],
    });

    if (!uploadResult || !uploadResult[0]?.result) {
      throw new Error("Failed to upload GIF to page");
    }

    outputMessage = `Successfully exported GIF with ${frames.length} frames. ${uploadResult[0].result.output}. Dimensions: ${gifResult.width}x${gifResult.height}. Recording cleared.`;
  }

  // Clear frames after successful export
  gifRecordingStorage.clearFrames(groupId);

  const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

  return {
    output: outputMessage,
    tabContext: {
      currentTabId: context.tabId,
      executedOnTabId: tab.id,
      availableTabs,
      tabCount: availableTabs.length,
    },
  };
}

/**
 * Handle clear action for GIF creator
 */
async function handleClearFrames(groupId: number): Promise<ToolResult> {
  const frameCount = gifRecordingStorage.getFrameCount(groupId);

  if (frameCount === 0) {
    return { output: "No frames to clear for this tab group." };
  }

  gifRecordingStorage.clearFrames(groupId);

  return {
    output: `Cleared ${frameCount} frame${frameCount === 1 ? "" : "s"} for this tab group. Recording stopped.`,
  };
}

// =============================================================================
// TURN ANSWER START & JAVASCRIPT TOOLS
// =============================================================================

/**
 * Empty parameters schema for tools with no parameters
 */
const emptyParametersSchema = { type: "object", properties: {}, required: [] };

/**
 * Turn answer start tool - marker to indicate the model should proceed with its response
 */
const turnAnswerStartTool: ToolSchema = {
  name: "turn_answer_start",
  description:
    "Call this immediately before your text response to the user for this turn. Required every turn - whether or not you made tool calls. After calling, write your response. No more tools after this.",
  parameters: emptyParametersSchema,
  execute: async (): Promise<ToolResult> => ({ output: "Proceed with your response." }),
  toAnthropicSchema() {
    return {
      type: "custom",
      name: this.name,
      description: this.description,
      input_schema: emptyParametersSchema,
    };
  },
};

/**
 * JavaScript execution tool - runs JavaScript in the page context
 */
const javascriptTool: ToolSchema = {
  name: "javascript_tool",
  description:
    "Execute JavaScript code in the context of the current page. The code runs in the page's context and can interact with the DOM, window object, and page variables. Returns the result of the last expression or any thrown errors. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    action: {
      type: "string",
      description: "Must be set to 'javascript_exec'",
    },
    text: {
      type: "string",
      description:
        "The JavaScript code to execute. The code will be evaluated in the page context. The result of the last expression will be returned automatically. Do NOT use 'return' statements - just write the expression you want to evaluate (e.g., 'window.myData.value' not 'return window.myData.value'). You can access and modify the DOM, call page functions, and interact with page variables.",
    },
    tabId: {
      type: "number",
      description:
        "Tab ID to execute the code in. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
    },
  },
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    try {
      const { action, text, tabId } = params as {
        action?: string;
        text?: string;
        tabId?: number;
      };

      if (action !== "javascript_exec") {
        throw new Error("'javascript_exec' is the only supported action");
      }
      if (!text) {
        throw new Error("Code parameter is required");
      }
      if (!context?.tabId) {
        throw new Error("No active tab found");
      }

      const effectiveTabId = await tabGroupManager.getEffectiveTabId(tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);
      const tabUrl = tab.url;

      if (!tabUrl) {
        throw new Error("No URL available for active tab");
      }

      const toolUseId = context?.toolUseId;
      const permissionResult = await context.permissionManager.checkPermission(tabUrl, toolUseId);

      if (!permissionResult.allowed) {
        if (permissionResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.EXECUTE_JAVASCRIPT,
            url: tabUrl,
            toolUseId: toolUseId,
            actionData: { text },
          };
        }
        return {
          error: "Permission denied for JavaScript execution on this domain",
        };
      }

      const securityCheck = await verifyDomainIntegrity(effectiveTabId, tabUrl, "JavaScript execution");
      if (securityCheck) return securityCheck;

      // Wrap code in IIFE with strict mode
      const wrappedCode = `
        (function() {
          'use strict';
          try {
            return eval(\`${text.replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`);
          } catch (e) {
            throw e;
          }
        })()
      `;

      const result = await cdpDebugger.sendCommand(effectiveTabId, "Runtime.evaluate", {
        expression: wrappedCode,
        returnByValue: true,
        awaitPromise: true,
        timeout: 10000,
      });

      let output = "";
      let hasError = false;
      let errorMessage = "";

      // Sanitize sensitive data from results
      const sanitizeValue = (value: unknown, depth = 0): unknown => {
        if (depth > 5) return "[TRUNCATED: Max depth exceeded]";

        const sensitivePatterns = [
          /password/i,
          /token/i,
          /secret/i,
          /api[_-]?key/i,
          /auth/i,
          /credential/i,
          /private[_-]?key/i,
          /access[_-]?key/i,
          /bearer/i,
          /oauth/i,
          /session/i,
        ];

        if (typeof value === "string") {
          // Block cookie/query string data
          if (value.includes("=") && (value.includes(";") || value.includes("&"))) {
            return "[BLOCKED: Cookie/query string data]";
          }
          // Block JWT tokens
          if (value.match(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)) {
            return "[BLOCKED: JWT token]";
          }
          // Block base64 encoded data
          if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(value)) {
            return "[BLOCKED: Base64 encoded data]";
          }
          // Block hex credentials
          if (/^[a-f0-9]{32,}$/i.test(value)) {
            return "[BLOCKED: Hex credential]";
          }
          // Truncate long strings
          if (value.length > 1000) {
            return value.substring(0, 1000) + "[TRUNCATED]";
          }
        }

        if (value && typeof value === "object" && !Array.isArray(value)) {
          const sanitized: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            const isSensitiveKey = sensitivePatterns.some((pattern) => pattern.test(key));
            if (isSensitiveKey) {
              sanitized[key] = "[BLOCKED: Sensitive key]";
            } else if (key === "cookie" || key === "cookies") {
              sanitized[key] = "[BLOCKED: Cookie access]";
            } else {
              sanitized[key] = sanitizeValue(val, depth + 1);
            }
          }
          return sanitized;
        }

        if (Array.isArray(value)) {
          const sanitized = value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
          if (value.length > 100) {
            sanitized.push(`[TRUNCATED: ${value.length - 100} more items]`);
          }
          return sanitized;
        }

        return value;
      };

      const maxOutputSize = 51200; // 50KB

      if (result.exceptionDetails) {
        hasError = true;
        const exception = result.exceptionDetails.exception;
        const isTimeout = exception?.description?.includes("execution was terminated");
        errorMessage = isTimeout
          ? "Execution timeout: Code exceeded 10-second limit"
          : exception?.description || exception?.value || "Unknown error";
      } else if (result.result) {
        const evalResult = result.result;

        if (evalResult.type === "undefined") {
          output = "undefined";
        } else if (evalResult.type === "object" && evalResult.subtype === "null") {
          output = "null";
        } else if (evalResult.type === "function") {
          output = evalResult.description || "[Function]";
        } else if (evalResult.type === "object") {
          if (evalResult.subtype === "node") {
            output = evalResult.description || "[DOM Node]";
          } else if (evalResult.subtype === "array") {
            output = evalResult.description || "[Array]";
          } else {
            const sanitized = sanitizeValue(evalResult.value || {});
            output = evalResult.description || JSON.stringify(sanitized, null, 2);
          }
        } else if (evalResult.value !== undefined) {
          const sanitized = sanitizeValue(evalResult.value);
          output = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized, null, 2);
        } else {
          output = evalResult.description || String(evalResult.value);
        }
      } else {
        output = "undefined";
      }

      const availableTabs = await tabGroupManager.getValidTabsWithMetadata(context.tabId);

      if (hasError) {
        return {
          error: `JavaScript execution error: ${errorMessage}`,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs,
            tabCount: availableTabs.length,
          },
        };
      }

      // Truncate output if too large
      if (output.length > maxOutputSize) {
        output = output.substring(0, maxOutputSize) + "\n[OUTPUT TRUNCATED: Exceeded 50KB limit]";
      }

      return {
        output,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs,
          tabCount: availableTabs.length,
        },
      };
    } catch (error) {
      return {
        error: `Failed to execute JavaScript: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "javascript_tool",
    description:
      "Execute JavaScript code in the context of the current page. The code runs in the page's context and can interact with the DOM, window object, and page variables. Returns the result of the last expression or any thrown errors. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Must be set to 'javascript_exec'",
        },
        text: {
          type: "string",
          description:
            "The JavaScript code to execute. The code will be evaluated in the page context. The result of the last expression will be returned automatically. Do NOT use 'return' statements - just write the expression you want to evaluate (e.g., 'window.myData.value' not 'return window.myData.value'). You can access and modify the DOM, call page functions, and interact with page variables.",
        },
        tabId: {
          type: "number",
          description:
            "Tab ID to execute the code in. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
      },
      required: ["action", "text", "tabId"],
    },
  }),
};

// =============================================================================
// TOOL REGISTRY & EXECUTION
// =============================================================================

/**
 * All available tools
 */
const allTools: ToolSchema[] = [
  readPageTool,
  // find tool removed - handled by MCP server
  formInputTool,
  computerTool,
  navigateTool,
  getPageTextTool,
  tabsContextTool,
  // tabs_context_mcp defined inline below
  tabsCreateTool,
  // tabs_create_mcp defined inline below
  updatePlanTool,
  uploadImageTool,
  readConsoleMessagesTool,
  readNetworkRequestsTool,
  resizeWindowTool,
  gifCreatorTool,
  turnAnswerStartTool,
  javascriptTool,
];

/**
 * Tools that don't require a tab context
 */
const noTabRequiredTools = ["tabs_context_mcp", "tabs_create_mcp"];

// =============================================================================
// TOOL HANDLER CLASS
// =============================================================================

/**
 * Handles tool execution for a session
 */
class ToolHandler {
  context: {
    permissionManager: PermissionManager;
    sessionId: string;
    tabId?: number;
    tabGroupId?: number;
    model?: string;
    anthropicClient?: unknown;
    analytics?: { track: (event: string, data: Record<string, unknown>) => void };
    onPermissionRequired?: (prompt: ToolResult, tabId: number) => Promise<boolean>;
  };

  constructor(context: ToolHandler["context"]) {
    this.context = context;
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
    toolUseId: string,
    permissions?: string,
    domain?: string,
    messages?: Message[]
  ): Promise<ToolResult> {
    const action = (args as { action?: string }).action;

    return await executeWithTracing(
      `tool_execution_${toolName}${action ? "_" + action : ""}`,
      async (span) => {
        if (!this.context.tabId && !noTabRequiredTools.includes(toolName)) {
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
          anthropicClient: this.context.anthropicClient,
          permissionManager: this.context.permissionManager,
          createAnthropicMessage: null,
          messages,
        };

        const tool = allTools.find((t) => t.name === toolName);
        if (!tool) {
          throw new Error(`Unknown tool: ${toolName}`);
        }

        const analyticsData: Record<string, unknown> = {
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
          const coercedArgs = coerceToolArguments(toolName, args, allTools);
          const result = await tool.execute(coercedArgs, executionContext);

          if ("type" in result) {
            analyticsData.success = false;
            span.setAttribute("success", false);
            span.setAttribute("failure_reason", "needs_permission");
          } else {
            analyticsData.success = !result.error;
            span.setAttribute("success", !result.error);
          }

          // Record GIF frame if recording
          if (!("type" in result) && !result.error && executionContext.tabId) {
            await recordGifFrameIfNeeded(toolName, coercedArgs, executionContext.tabId);
          }

          this.context.analytics?.track("claude_chrome.chat.tool_called", analyticsData);

          return result;
        } catch (error) {
          this.context.analytics?.track("claude_chrome.chat.tool_called", {
            ...analyticsData,
            success: false,
            failureReason: "exception",
          });
          throw error;
        }
      },
      messages
    );
  }

  async processToolResults(
    toolUses: Array<{ type: string; id: string; name: string; input: Record<string, unknown> }>
  ): Promise<Array<{ type: string; tool_use_id: string; content: unknown; is_error?: boolean }>> {
    const results: Array<{ type: string; tool_use_id: string; content: unknown; is_error?: boolean }> = [];

    const formatContent = (result: ToolResult): unknown => {
      if (result.error) return result.error;

      const content: Array<{ type: string; text?: string; source?: unknown }> = [];

      if (result.output) {
        content.push({ type: "text", text: result.output });
      }

      if (result.tabContext) {
        const contextText = `\n\nTab Context:${
          result.tabContext.executedOnTabId
            ? `\n- Executed on tabId: ${result.tabContext.executedOnTabId}`
            : ""
        }\n- Available tabs:\n${result.tabContext.availableTabs
          .map((t) => `  • tabId ${t.id}: "${t.title}" (${t.url})`)
          .join("\n")}`;
        content.push({ type: "text", text: contextText });
      }

      if (result.base64Image) {
        const mediaType = result.imageFormat ? `image/${result.imageFormat}` : "image/png";
        content.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: result.base64Image },
        });
      }

      return content.length > 0 ? content : "";
    };

    const createToolResult = (
      toolUseId: string,
      result: ToolResult
    ): { type: string; tool_use_id: string; content: unknown; is_error?: boolean } => {
      const isError = !!result.error;
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: formatContent(result),
        ...(isError && { is_error: true }),
      };
    };

    for (const toolUse of toolUses) {
      try {
        const result = await this.handleToolCall(toolUse.name, toolUse.input, toolUse.id);

        if ("type" in result && result.type === "permission_required") {
          if (!this.context.onPermissionRequired || !this.context.tabId) {
            results.push(
              createToolResult(toolUse.id, {
                error: "Permission required but no handler or tab id available",
              })
            );
            continue;
          }

          const approved = await this.context.onPermissionRequired(result, this.context.tabId);

          if (!approved) {
            results.push(
              createToolResult(toolUse.id, {
                error:
                  toolUse.name === "update_plan"
                    ? "Plan rejected by user. Ask the user how they would like to change the plan."
                    : "Permission denied by user",
              })
            );
            continue;
          }

          if (toolUse.name === "update_plan") {
            results.push(
              createToolResult(toolUse.id, {
                output:
                  "User has approved your plan. You can now start executing the plan. Start with updating your todo list if applicable.",
              })
            );
            continue;
          }

          // Retry after permission granted
          const retryResult = await this.handleToolCall(toolUse.name, toolUse.input, toolUse.id);

          if ("type" in retryResult && retryResult.type === "permission_required") {
            throw new Error("Permission still required after granting");
          }

          results.push(createToolResult(toolUse.id, retryResult));
        } else {
          results.push(createToolResult(toolUse.id, result));
        }
      } catch (error) {
        results.push(
          createToolResult(toolUse.id, {
            error: error instanceof Error ? error.message : "Unknown error",
          })
        );
      }
    }

    return results;
  }
}

/**
 * Records a GIF frame if recording is active for the tab's group
 */
async function recordGifFrameIfNeeded(
  toolName: string,
  args: Record<string, unknown>,
  tabId: number
): Promise<void> {
  try {
    if (!["computer", "navigate"].includes(toolName)) return;

    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;

    const groupId = tab.groupId ?? -1;
    if (!gifRecordingStorage.isRecording(groupId)) return;

    let action: GifAction | undefined;
    let screenshot: ScreenshotResult | undefined;

    if (toolName === "computer" && args.action) {
      const actionType = args.action as string;

      if (actionType === "screenshot") return; // Don't record screenshots as actions

      action = {
        type: actionType,
        coordinate: args.coordinate as [number, number] | undefined,
        start_coordinate: args.start_coordinate as [number, number] | undefined,
        text: args.text as string | undefined,
        timestamp: Date.now(),
        description: "",
      };

      // Set description based on action type
      if (actionType.includes("click")) {
        action.description = "Clicked";
      } else if (actionType === "type" && args.text) {
        action.description = `Typed: "${args.text}"`;
      } else if (actionType === "key" && args.text) {
        action.description = `Pressed key: ${args.text}`;
      } else if (actionType === "scroll") {
        action.description = "Scrolled";
      } else if (actionType === "left_click_drag") {
        action.description = "Dragged";
      } else {
        action.description = actionType;
      }
    } else if (toolName === "navigate" && args.url) {
      action = {
        type: "navigate",
        timestamp: Date.now(),
        description: `Navigated to ${args.url}`,
      };
    }

    // For click/drag actions, add action to previous frame
    if (action && (action.type.includes("click") || action.type === "left_click_drag")) {
      const frames = gifRecordingStorage.getFrames(groupId);
      if (frames.length > 0) {
        const lastFrame = frames[frames.length - 1];
        const frameWithAction: GifFrame = {
          base64: lastFrame.base64,
          action,
          frameNumber: frames.length,
          timestamp: Date.now(),
          viewportWidth: lastFrame.viewportWidth,
          viewportHeight: lastFrame.viewportHeight,
          devicePixelRatio: lastFrame.devicePixelRatio,
        };
        gifRecordingStorage.addFrame(groupId, frameWithAction);
      }
    }

    // Wait a bit then capture screenshot
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      screenshot = await cdpDebugger.screenshot(tabId);
    } catch {
      return;
    }

    // Get device pixel ratio
    let devicePixelRatio = 1;
    try {
      const dprResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.devicePixelRatio,
      });
      if (dprResult && dprResult[0]?.result) {
        devicePixelRatio = dprResult[0].result;
      }
    } catch {
      // Use default
    }

    const frameNumber = gifRecordingStorage.getFrames(groupId).length;
    const frame: GifFrame = {
      base64: screenshot.base64,
      action,
      frameNumber,
      timestamp: Date.now(),
      viewportWidth: screenshot.viewportWidth || screenshot.width,
      viewportHeight: screenshot.viewportHeight || screenshot.height,
      devicePixelRatio,
    };

    gifRecordingStorage.addFrame(groupId, frame);
  } catch {
    // Ignore errors during GIF recording
  }
}

// =============================================================================
// MCP SESSION MANAGEMENT
// =============================================================================

let mcpToolHandler: ToolHandler | undefined;
let pendingErrorMessage: string | undefined;
let pendingErrorTimestamp: number | undefined;

/**
 * Gets or creates the MCP tool handler
 */
async function getOrCreateMcpToolHandler(
  tabId?: number,
  tabGroupId?: number
): Promise<ToolHandler> {
  if (mcpToolHandler) {
    mcpToolHandler.context.tabId = tabId;
    mcpToolHandler.context.tabGroupId = tabGroupId;
    return mcpToolHandler;
  }

  mcpToolHandler = new ToolHandler({
    permissionManager: new PermissionManager(
      () => (self as unknown as { __skipPermissions?: boolean }).__skipPermissions || false,
      {}
    ),
    sessionId: MCP_NATIVE_SESSION_ID,
    tabId,
    tabGroupId,
    onPermissionRequired: async (prompt, tabId) => {
      if ((self as unknown as { __skipPermissions?: boolean }).__skipPermissions) {
        return true;
      }
      return await showPermissionPrompt(prompt, tabId);
    },
  });

  return mcpToolHandler;
}

// =============================================================================
// MCP TOOL EXECUTION
// =============================================================================

/**
 * Creates an error response for MCP tools
 */
const createErrorResponse = (message: string): { content: Array<{ type: string; text: string }>; is_error: boolean } => ({
  content: [{ type: "text", text: message }],
  is_error: true,
});

/**
 * Main entry point for executing MCP tool requests
 */
async function executeToolRequest(request: {
  toolName: string;
  args: Record<string, unknown>;
  tabId?: number;
  tabGroupId?: number;
  clientId?: string;
}): Promise<{ content: unknown; is_error?: boolean }> {
  const requestId = crypto.randomUUID();
  const clientId = request.clientId;
  const startTime = Date.now();

  // Check for pending error from previous request
  if (pendingErrorMessage && pendingErrorTimestamp) {
    if (Date.now() - pendingErrorTimestamp < 60000) {
      const errorMessage = pendingErrorMessage;
      pendingErrorMessage = undefined;
      pendingErrorTimestamp = undefined;
      return createErrorResponse(errorMessage);
    }
    pendingErrorMessage = undefined;
    pendingErrorTimestamp = undefined;
  }

  let effectiveTabId: number | undefined;
  let domain: string | undefined;

  // Get tab for MCP
  try {
    const tabInfo = await tabGroupManager.getTabForMcp(request.tabId, request.tabGroupId);
    effectiveTabId = tabInfo.tabId;
    domain = tabInfo.domain;
  } catch {
    return createErrorResponse("No tabs available. Please open a new tab or window in Chrome.");
  }

  // Attach debugger if needed
  if (effectiveTabId !== undefined) {
    try {
      const isAttached = await cdpDebugger.isDebuggerAttached(effectiveTabId);
      await cdpDebugger.attachDebugger(effectiveTabId);
      if (!isAttached) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch {
      // Continue even if attach fails
    }
  }

  let result: { content: unknown; is_error?: boolean } | undefined;
  let hasError = false;

  try {
    // Set up tool tracking
    if (effectiveTabId !== undefined) {
      await setupToolTracking(effectiveTabId, request.toolName, requestId, (error) => {
        pendingErrorMessage = error;
        pendingErrorTimestamp = Date.now();
      });
    }

    const handler = await getOrCreateMcpToolHandler(effectiveTabId, request.tabGroupId);

    const [toolResult] = await handler.processToolResults([
      { type: "tool_use", id: requestId, name: request.toolName, input: request.args },
    ]);

    result = toolResult;
    hasError = toolResult?.is_error === true;
  } catch (error) {
    hasError = true;
    result = createErrorResponse(error instanceof Error ? error.message : String(error));
  }

  // Clean up tool tracking
  if (effectiveTabId !== undefined) {
    cleanupToolTracking(effectiveTabId, clientId);
  }

  return result!;
}

// =============================================================================
// TOOL TRACKING
// =============================================================================

const activeToolRequests = new Map<number, {
  toolName: string;
  requestId: string;
  startTime: number;
  errorCallback: (error: string) => void;
}>();

const pendingCleanups = new Map<number, ReturnType<typeof setTimeout> | null>();
const CLEANUP_DELAY_MS = 20000;

/**
 * Sets up tracking for a tool request
 */
async function setupToolTracking(
  tabId: number,
  toolName: string,
  requestId: string,
  errorCallback: (error: string) => void
): Promise<void> {
  activeToolRequests.set(tabId, {
    toolName,
    requestId,
    startTime: Date.now(),
    errorCallback,
  });

  await tabGroupManager.addTabToIndicatorGroup({
    tabId,
    isRunning: true,
    isMcp: true,
  });

  // Handle pending cleanup
  if (pendingCleanups.has(tabId)) {
    const timeout = pendingCleanups.get(tabId);
    if (timeout) clearTimeout(timeout);
    tabGroupManager.addLoadingPrefix(tabId).catch(() => {});
    pendingCleanups.set(tabId, null);
  } else {
    tabGroupManager.addLoadingPrefix(tabId).catch(() => {});
    pendingCleanups.set(tabId, null);
  }
}

/**
 * Cleans up tool tracking after execution
 */
function cleanupToolTracking(tabId: number, clientId?: string): void {
  if (activeToolRequests.has(tabId)) {
    activeToolRequests.delete(tabId);

    const timeout = setTimeout(async () => {
      if (!activeToolRequests.has(tabId) && pendingCleanups.has(tabId)) {
        tabGroupManager.addCompletionPrefix(tabId).catch(() => {});
        pendingCleanups.set(tabId, null);

        try {
          await cdpDebugger.detachDebugger(tabId);
        } catch {
          // Ignore detach errors
        }
      }
    }, CLEANUP_DELAY_MS);

    pendingCleanups.set(tabId, timeout);
  }
}

/**
 * Removes prefix immediately for a tab
 */
function removeTabPrefix(tabId: number): void {
  const timeout = pendingCleanups.get(tabId);
  if (timeout) clearTimeout(timeout);
  pendingCleanups.delete(tabId);
  tabGroupManager.removePrefix(tabId).catch(() => {});
}

/**
 * Called when native host disconnects - cleans up all tracking
 */
async function notifyDisconnection(): Promise<void> {
  try {
    const groups = await tabGroupManager.getAllGroups();
    for (const group of groups) {
      removeTabPrefix(group.mainTabId);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

// =============================================================================
// PERMISSION PROMPT
// =============================================================================

let permissionPromptQueue = Promise.resolve(true);

/**
 * Shows a permission prompt to the user
 */
async function showPermissionPrompt(prompt: ToolResult, tabId: number): Promise<boolean> {
  const result = permissionPromptQueue.then(() => showPermissionPromptInternal(prompt, tabId));
  permissionPromptQueue = result.catch(() => false);
  return result;
}

async function showPermissionPromptInternal(prompt: ToolResult, tabId: number): Promise<boolean> {
  const promptId = crypto.randomUUID();

  // Cancel any pending cleanup
  const pendingTimeout = pendingCleanups.get(tabId);
  if (pendingTimeout) clearTimeout(pendingTimeout);

  // Update tab to show permission state
  await tabGroupManager.addPermissionPrefix(tabId);
  pendingCleanups.set(tabId, null);

  // Store prompt data
  await chrome.storage.local.set({
    [`mcp_prompt_${promptId}`]: { prompt, tabId, timestamp: Date.now() },
  });

  return new Promise((resolve) => {
    let promptWindowId: number | undefined;
    let resolved = false;

    const cleanup = async (approved = false) => {
      if (resolved) return;
      resolved = true;

      chrome.runtime.onMessage.removeListener(messageHandler);
      await chrome.storage.local.remove(`mcp_prompt_${promptId}`);

      if (promptWindowId) {
        chrome.windows.remove(promptWindowId).catch(() => {});
      }

      await tabGroupManager.addLoadingPrefix(tabId);
      pendingCleanups.set(tabId, null);

      resolve(approved);
    };

    const messageHandler = (message: { type: string; requestId: string; allowed: boolean }) => {
      if (message.type === "MCP_PERMISSION_RESPONSE" && message.requestId === promptId) {
        cleanup(message.allowed);
      }
    };

    chrome.runtime.onMessage.addListener(messageHandler);

    // Create permission prompt window
    chrome.windows.create(
      {
        url: chrome.runtime.getURL(
          `sidepanel.html?tabId=${tabId}&mcpPermissionOnly=true&requestId=${promptId}`
        ),
        type: "popup",
        width: 600,
        height: 600,
        focused: true,
      },
      (window) => {
        if (window) {
          promptWindowId = window.id;
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

// =============================================================================
// NAVIGATION SAFETY
// =============================================================================

/**
 * Checks if a tab is the main tab or a secondary tab in a group
 */
async function checkTabRole(
  mainTabId: number,
  checkTabId: number
): Promise<{ isMainTab: boolean; isSecondaryTab: boolean; group: unknown }> {
  const isMainTab = checkTabId === mainTabId;
  await tabGroupManager.initialize();
  const group = await tabGroupManager.findGroupByTab(checkTabId);

  return {
    isMainTab,
    isSecondaryTab: !!group && (group as { mainTabId: number }).mainTabId === mainTabId && checkTabId !== mainTabId,
    group,
  };
}

/**
 * Checks if a category is blocked
 */
function isBlockedCategory(category: string): boolean {
  return category === "category1" || category === "category2";
}

/**
 * Gets hostname from URL
 */
function getHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Detects domain change between two URLs
 */
function detectDomainChange(
  oldUrl: string | undefined,
  newUrl: string
): { oldDomain: string; newDomain: string } | null {
  if (
    !oldUrl ||
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
 * Checks domain category and updates blocklist status
 */
async function checkAndUpdateDomainStatus(tabId: number, url: string): Promise<string | null> {
  const category = await DomainCategoryCache.getCategory(url);
  await tabGroupManager.updateTabBlocklistStatus(tabId, url);
  return category ?? null;
}

/**
 * Gets blocked page URL
 */
function getBlockedPageUrl(originalUrl: string): string {
  return chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(originalUrl)}`);
}

/**
 * Creates domain transition permission request
 */
function createDomainTransitionRequest(
  fromDomain: string,
  toDomain: string,
  url: string,
  sourceTabId: number,
  isSecondaryTab: boolean
): ToolResult {
  return {
    type: "permission_required",
    tool: ToolPermissionType.DOMAIN_TRANSITION,
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
 * Gets feature flags (disabled for MCP mode - CSP blocks external API calls)
 */
async function getFeatureFlags(context: unknown): Promise<Record<string, never>> {
  return {};
}

/**
 * Executes a shortcut task
 */
async function executeShortcutTask(params: {
  tabId: number;
  prompt: string;
  taskName: string;
  skipPermissions?: boolean;
  model?: string;
  tabGroupId?: number;
}): Promise<{ success: boolean; error?: string }> {
  const { tabId, prompt, taskName, skipPermissions, model } = params;

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const runLogId = `shortcut_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  await setStorageValue(StorageKeys.TARGET_TAB_ID, tabId);

  // Create sidepanel window
  await createSidepanelWindow({ sessionId, skipPermissions, model });

  // Wait for tab to load and send task
  await sendTaskToWindow({
    tabId,
    prompt,
    taskName,
    runLogId,
    sessionId,
    isScheduledTask: false,
  });

  return { success: true };
}

/**
 * Creates a sidepanel window
 */
async function createSidepanelWindow(params: {
  sessionId: string;
  skipPermissions?: boolean;
  model?: string;
}): Promise<chrome.windows.Window> {
  const { sessionId, skipPermissions, model } = params;

  const url = chrome.runtime.getURL(
    `sidepanel.html?mode=window&sessionId=${sessionId}${skipPermissions ? "&skipPermissions=true" : ""}${model ? `&model=${encodeURIComponent(model)}` : ""}`
  );

  const window = await chrome.windows.create({
    url,
    type: "popup",
    width: 500,
    height: 768,
    left: 100,
    top: 100,
    focused: true,
  });

  if (!window) {
    throw new Error("Failed to create sidepanel window");
  }

  return window;
}

/**
 * Sends a task to a sidepanel window
 */
async function sendTaskToWindow(params: {
  tabId: number;
  prompt: string;
  taskName: string;
  runLogId: string;
  sessionId: string;
  isScheduledTask: boolean;
}): Promise<void> {
  const { tabId, prompt, taskName, runLogId, sessionId, isScheduledTask } = params;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let sent = false;

    const checkAndSend = async () => {
      try {
        if (Date.now() - startTime > 30000) {
          return reject(new Error("Timeout waiting for tab to load for task execution"));
        }

        const tab = await chrome.tabs.get(tabId);

        if (tab.status === "complete") {
          setTimeout(() => {
            if (sent) return;
            sent = true;

            chrome.runtime.sendMessage(
              {
                type: "EXECUTE_TASK",
                prompt,
                taskName,
                runLogId,
                windowSessionId: sessionId,
                isScheduledTask,
              },
              () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(`Failed to send prompt: ${chrome.runtime.lastError.message}`));
                } else {
                  resolve();
                }
              }
            );
          }, 3000);
        } else {
          setTimeout(checkAndSend, 500);
        }
      } catch (error) {
        reject(error);
      }
    };

    setTimeout(checkAndSend, 1000);
  });
}

// =============================================================================
// NAVIGATION LISTENER
// =============================================================================

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  // Check if tab is being tracked
  if (!activeToolRequests.has(details.tabId)) return;

  const request = activeToolRequests.get(details.tabId);
  if (!request) return;

  const { isMainTab, isSecondaryTab } = await checkTabRole(details.tabId, details.tabId);
  if (!isMainTab && !isSecondaryTab) return;

  await getOrCreateMcpToolHandler(details.tabId);

  try {
    const category = await checkAndUpdateDomainStatus(details.tabId, details.url);

    if (category === "category1") {
      const blockedUrl = getBlockedPageUrl(details.url);
      await chrome.tabs.update(details.tabId, { url: blockedUrl });

      if (request?.errorCallback) {
        request.errorCallback(
          "Cannot access this page. Computer Control cannot assist with the content on this page."
        );
      }

      cleanupToolTracking(details.tabId);
      return;
    }

    await chrome.tabs.get(details.tabId);
    return undefined;
  } catch {
    // Ignore errors
  }
});

// =============================================================================
// EXPORTS
// =============================================================================

// Export with original minified aliases for compatibility
export {
  // Primary exports
  gifCreatorTool as A,
  DomainCategoryCache as B,
  turnAnswerStartTool as C,
  javascriptTool as D,
  coerceToolArguments as E,
  formatTabContextWithSkills as F,
  approveTurnDomains as G,
  getPlanningModeReminder as H,
  convertToolsToAnthropicSchema as I,
  cdpDebugger as J,
  findImageInMessages as K,
  notifyDisconnection as L,
  createErrorResponse as M,
  executeToolRequest as N,
  checkTabRole as a,
  getOrCreateAnonymousId as b,
  isBlockedCategory as c,
  getBlockedPageUrl as d,
  detectDomainChange as e,
  createDomainTransitionRequest as f,
  domainUtils as g,
  getFeatureFlags as h,
  formInputTool as j,
  computerTool as k,
  navigateTool as l,
  getPageTextTool as m,
  requiresPlanningMode as n,
  updatePlanTool as o,
  parseArrayArgument as p,
  tabsCreateTool as q,
  readPageTool as r,
  stripSystemReminders as s,
  tabGroupManager as t,
  checkAndUpdateDomainStatus as u,
  tabsContextTool as v,
  uploadImageTool as w,
  readConsoleMessagesTool as x,
  readNetworkRequestsTool as y,
  resizeWindowTool as z,
};
