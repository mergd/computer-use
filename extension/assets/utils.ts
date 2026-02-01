/**
 * utils.ts - Utility functions for MCP tools
 *
 * Contains helper functions with no direct tool dependencies:
 * - URL restriction checking
 * - Tab response formatters
 * - Type coercion helpers
 * - Image utilities
 * - Domain utilities
 */

import { generateScreenshotId } from "./storage.js";

// =============================================================================
// Type Definitions
// =============================================================================

/** Chrome tab type (subset of chrome.tabs.Tab) */
interface Tab {
  id?: number;
  title?: string;
  url?: string;
}

/** Formatted tab info for responses */
interface FormattedTab {
  tabId: number | undefined;
  title: string | undefined;
  url: string | undefined;
}

/** Tab response structure */
interface TabsResponse {
  availableTabs: FormattedTab[];
  tabGroupId?: number;
}

/** Tab context structure */
interface TabContext {
  availableTabs?: Tab[];
  domainSkills?: unknown[];
  initialTabId?: number;
}

/** Tab context response structure */
interface TabContextResponse {
  availableTabs?: FormattedTab[];
  domainSkills?: unknown[];
  initialTabId?: number;
}

/** Tool schema parameter definition */
interface ToolParameterSchema {
  type?: string;
  [key: string]: unknown;
}

/** Tool definition with parameters */
interface Tool {
  name: string;
  parameters?: Record<string, ToolParameterSchema>;
  toAnthropicSchema: (context: unknown) => Promise<unknown>;
}

/** Message content item - text type */
interface TextContentItem {
  type: "text";
  text?: string;
}

/** Image source with data */
interface ImageSource {
  type?: string;
  media_type?: string;
  data: string;
}

/** Message content item - image type */
interface ImageContentItem {
  type: "image";
  source?: ImageSource;
}

/** Tool result content item */
interface ToolResultContentItem {
  type: "tool_result";
  tool_use_id?: string;
  content?: string | ContentItem[];
}

/** Union of all content item types */
type ContentItem = TextContentItem | ImageContentItem | ToolResultContentItem;

/** Message structure in conversation history */
interface Message {
  role: string;
  content: string | ContentItem[];
}

/** Image data found in messages */
interface ImageData {
  base64: string;
  width?: number;
  height?: number;
}

/** Navigation interception check result */
interface NavigationInterceptionResult {
  error: string;
}

// Alias for backward compatibility
const generateId = generateScreenshotId;

// =============================================================================
// URL Restriction Checking
// =============================================================================

/**
 * Guard against restricted URLs (chrome://, about:, edge://, Chrome Web Store, etc.)
 */
export function isRestrictedUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const restrictedProtocols = /^(chrome|about|edge|brave|opera|vivaldi|file):/i;
  const restrictedDomains = /^https?:\/\/(chrome\.google\.com|chromewebstore\.google\.com)/i;
  // Block other extensions' URLs but allow our own
  if (url.startsWith("chrome-extension://")) {
    const ownExtensionId = chrome.runtime.id;
    return !url.startsWith(`chrome-extension://${ownExtensionId}/`);
  }
  return restrictedProtocols.test(url) || restrictedDomains.test(url);
}

/**
 * Assert that a tab is not restricted, throwing an error if it is
 */
export function assertNotRestrictedTab(tab: Tab | undefined | null): void {
  if (isRestrictedUrl(tab?.url)) {
    throw new Error(`Cannot interact with restricted URL: ${tab?.url || "unknown"}`);
  }
}

// =============================================================================
// Response Formatters
// =============================================================================

/**
 * Format available tabs for output
 */
export function formatTabsResponse(tabs: Tab[], tabGroupId?: number): string {
  const result: TabsResponse = {
    availableTabs: tabs.map((tab) => ({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
    })),
  };
  if (void 0 !== tabGroupId) {
    result.tabGroupId = tabGroupId;
  }
  return JSON.stringify(result);
}

/**
 * Format tab context with optional skills
 */
export function formatTabContextResponse(context: TabContext): string {
  const result: TabContextResponse = {};
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
  if (void 0 !== context.initialTabId) {
    result.initialTabId = context.initialTabId;
  }
  return JSON.stringify(result);
}

/**
 * Strip system reminders from text
 */
export function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim();
}

// =============================================================================
// Tool Schema Helpers
// =============================================================================

/**
 * Convert tools to Anthropic schema format
 */
export const toAnthropicSchemas = async (
  tools: Tool[],
  context: unknown
): Promise<unknown[]> =>
  await Promise.all(tools.map((tool) => tool.toAnthropicSchema(context)));

/**
 * Coerce parameter types based on tool schema
 */
export const coerceParameterTypes = (
  toolName: string,
  params: Record<string, unknown> | null | undefined,
  tools: Tool[]
): Record<string, unknown> | null | undefined => {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool || !tool.parameters || typeof params !== "object" || !params) return params;
  const coerced = { ...params };
  for (const [key, schema] of Object.entries(tool.parameters)) {
    if (key in coerced && schema && typeof schema === "object") {
      const value = coerced[key];
      const schemaObj = schema as ToolParameterSchema;
      if (schemaObj.type === "number" && typeof value === "string") {
        const num = Number(value);
        if (!isNaN(num)) coerced[key] = num;
      } else if (schemaObj.type === "boolean" && typeof value === "string") {
        coerced[key] = value === "true";
      }
    }
  }
  return coerced;
};

/**
 * Parse array from string or return as-is
 */
export const parseArrayParam = <T = unknown>(
  value: unknown,
  _context?: unknown
): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

// =============================================================================
// Image Utilities
// =============================================================================

/**
 * Find image by ID in message history
 */
export function findImageInMessages(
  messages: Message[],
  imageId: string
): ImageData | undefined {
  console.info(`[imageUtils] Looking for image with ID: ${imageId}`);
  console.info(`[imageUtils] Total messages to search: ${messages.length}`);

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const content of msg.content) {
        if (content.type === "tool_result") {
          const toolResult = content as ToolResultContentItem;
          if (toolResult.content) {
            const contentArray: ContentItem[] = Array.isArray(toolResult.content)
              ? toolResult.content
              : [{ type: "text", text: toolResult.content as string }];
            let found = false;
            let textContent = "";
            for (const item of contentArray) {
              if (item.type === "text" && item.text && item.text.includes(imageId)) {
                found = true;
                textContent = item.text;
                console.info("[imageUtils] Found image ID in tool_result text");
                break;
              }
            }
            if (found) {
              for (const item of contentArray) {
                if (item.type === "image") {
                  const imgItem = item as ImageContentItem;
                  if (imgItem.source && "data" in imgItem.source && imgItem.source.data) {
                    console.info(`[imageUtils] Found image data for ID ${imageId}`);
                    return {
                      base64: imgItem.source.data,
                      width: extractImageDimension(textContent, "width"),
                      height: extractImageDimension(textContent, "height"),
                    };
                  }
                }
              }
            }
          }
        }
      }
      // Check for user-uploaded images
      const textIndex = (msg.content as ContentItem[]).findIndex(
        (c) => c.type === "text" && (c as TextContentItem).text?.includes(imageId)
      );
      if (textIndex !== -1) {
        console.info(
          `[imageUtils] Found image ID in user text at index ${textIndex}, looking for next adjacent image`
        );
        for (let j = textIndex + 1; j < (msg.content as ContentItem[]).length; j++) {
          const item = (msg.content as ContentItem[])[j];
          if (item.type === "image") {
            const imgItem = item as ImageContentItem;
            if (imgItem.source && "data" in imgItem.source && imgItem.source.data) {
              console.info(
                `[imageUtils] Found user-uploaded image for ID ${imageId} at index ${j}`
              );
              return { base64: imgItem.source.data };
            }
          }
          if (item.type === "text") {
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
 * Extract width or height from dimension string
 */
export function extractImageDimension(
  text: string | undefined | null,
  dimension: "width" | "height"
): number | undefined {
  if (!text) return undefined;
  const match = text.match(/\((\d+)x(\d+)/);
  if (!match) return undefined;
  return dimension === "width" ? parseInt(match[1], 10) : parseInt(match[2], 10);
}

// =============================================================================
// Domain Utilities
// =============================================================================

/**
 * Extract hostname from URL
 */
export function extractHostname(url: string): string {
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
 * Normalize domain for cache lookups
 */
export function normalizeDomain(url: string): string {
  return url
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/\/.*$/, "");
}

/**
 * Check if navigation crossed domains during an action
 */
export async function checkNavigationInterception(
  tabId: number,
  originalUrl: string | undefined | null,
  actionName: string
): Promise<NavigationInterceptionResult | null> {
  if (!originalUrl) return null;
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { error: "Unable to verify current URL for security check" };
  }
  if (isRestrictedUrl(tab.url)) {
    return {
      error: `Cannot interact with restricted URL: ${tab.url}. Use computer-control-mac tools to interact with browser UI.`,
    };
  }
  const originalDomain = extractHostname(originalUrl);
  const currentDomain = extractHostname(tab.url);
  if (originalDomain !== currentDomain) {
    return {
      error: `Security check failed: Domain changed from ${originalDomain} to ${currentDomain} during ${actionName}`,
    };
  }
  return null;
}

// =============================================================================
// Re-exports
// =============================================================================

// Re-export generateId for screenshot IDs
export { generateId };
