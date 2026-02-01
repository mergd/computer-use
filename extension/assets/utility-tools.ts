/**
 * utility-tools.ts - Miscellaneous utility tools
 *
 * Contains various utility tools:
 * - Te: upload_image tool
 * - ke: read_console_messages tool
 * - _e: read_network_requests tool
 * - Ee: resize_window tool
 * - Me: turn_answer_start tool
 * - shortcuts_list tool
 * - shortcuts_execute tool
 */

import { cdpDebuggerInstance as cdpDebugger } from "./cdp-debugger.js";
import { tabGroupManagerInstance as TabGroupManager } from "./tab-group-manager.js";
import { ToolPermissionType, SavedPromptsService, setStorageValue, StorageKeys } from "./storage.js";
import { findImageInMessages, checkNavigationInterception } from "./utils.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  ToolResultSuccess,
  ToolResultError,
  PermissionRequiredResult,
  ToolParameterSchema,
  AnthropicToolSchema,
  UploadImageParams,
  ReadConsoleMessagesParams,
  ReadNetworkRequestsParams,
  ResizeWindowParams,
  ShortcutsExecuteParams,
  ShortcutInfo,
  TabMetadata,
  ConsoleMessage,
  NetworkRequest,
  ImageData,
} from "./types.js";

// =============================================================================
// Type Definitions for Script Execution Results
// =============================================================================

/** Result from upload image script execution */
interface UploadImageScriptResult {
  output?: string;
  error?: string;
}

/** Parameters for launching shortcut window */
interface LaunchShortcutParams {
  tabId: number;
  tabGroupId?: number;
  prompt: string;
  taskName: string;
  skipPermissions?: boolean;
  model?: string;
}

/** Saved prompt structure */
interface SavedPrompt {
  id: string;
  command?: string;
  skipPermissions?: boolean;
  model?: string;
}

/** Chrome scripting execution result */
interface ScriptingResult<T> {
  result: T;
}

// =============================================================================
// Upload Image Tool
// =============================================================================

export const uploadImageTool: ToolDefinition = {
  name: "upload_image",
  description:
    "Upload a previously captured screenshot or user-uploaded image to a file input or drag & drop target. Supports two approaches: (1) ref - for targeting specific elements, especially hidden file inputs, (2) coordinate - for drag & drop to visible locations like Google Docs. Provide either ref or coordinate, not both.",
  parameters: {
    imageId: {
      type: "string",
      description:
        "ID of a previously captured screenshot (from the computer tool's screenshot action) or a user-uploaded image",
    },
    ref: {
      type: "string",
      description:
        'Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Use this for file inputs (especially hidden ones) or specific elements. Provide either ref or coordinate, not both.',
    },
    coordinate: {
      type: "array",
      description:
        "Viewport coordinates [x, y] for drag & drop to a visible location. Use this for drag & drop targets like Google Docs. Provide either ref or coordinate, not both.",
    },
    tabId: {
      type: "number",
      description:
        "Tab ID where the target element is located. This is where the image will be uploaded to.",
    },
    filename: {
      type: "string",
      description: 'Optional filename for the uploaded file (default: "image.png")',
    },
  },
  execute: async (params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const args = params as unknown as UploadImageParams;

      if (!args?.imageId) throw new Error("imageId parameter is required");
      if (!args?.ref && !args?.coordinate) {
        throw new Error(
          "Either ref or coordinate parameter is required. Provide ref for targeting specific elements or coordinate for drag & drop to a location."
        );
      }
      if (args?.ref && args?.coordinate) {
        throw new Error(
          "Provide either ref or coordinate, not both. Use ref for specific elements or coordinate for drag & drop."
        );
      }
      if (!context?.tabId) throw new Error("No active tab found");

      const effectiveTabId = await TabGroupManager.getEffectiveTabId(args.tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);

      if (!tab.id) throw new Error("Upload tab has no ID");

      const url = tab.url;
      if (!url) throw new Error("No URL available for upload tab");

      const toolUseId = context?.toolUseId;
      const permResult = await context.permissionManager.checkPermission(url, toolUseId);

      if (!permResult.allowed) {
        if (permResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.UPLOAD_IMAGE,
            url,
            toolUseId,
            actionData: {
              ref: args.ref,
              coordinate: args.coordinate,
              imageId: args.imageId,
            },
          } as PermissionRequiredResult;
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

      console.info(`[Upload-Image] Looking for image with ID: ${args.imageId}`);
      console.info(`[Upload-Image] Messages available: ${context.messages.length}`);

      const imageData: ImageData | undefined = findImageInMessages(context.messages, args.imageId);
      if (!imageData) {
        return {
          error: `Image not found with ID: ${args.imageId}. Please ensure the image was captured or uploaded earlier in this conversation.`,
        };
      }

      const base64 = imageData.base64;

      const navCheck = await checkNavigationInterception(tab.id, originalUrl, "upload image action");
      if (navCheck) return navCheck;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (elementRef: string | null, coordinate: [number, number] | null, base64Data: string, filename: string): UploadImageScriptResult => {
          try {
            let target: Element | null = null;

            if (coordinate) {
              target = document.elementFromPoint(coordinate[0], coordinate[1]);
              if (!target) {
                return { error: `No element found at coordinates (${coordinate[0]}, ${coordinate[1]})` };
              }

              // Handle iframe
              if (target.tagName === "IFRAME") {
                try {
                  const iframe = target as HTMLIFrameElement;
                  const iframeDoc = iframe.contentDocument || (iframe.contentWindow ? iframe.contentWindow.document : null);
                  if (iframeDoc) {
                    const rect = iframe.getBoundingClientRect();
                    const relX = coordinate[0] - rect.left;
                    const relY = coordinate[1] - rect.top;
                    const iframeElement = iframeDoc.elementFromPoint(relX, relY);
                    if (iframeElement) target = iframeElement;
                  }
                } catch {
                  // Ignore cross-origin iframe errors
                }
              }
            } else {
              if (!elementRef) {
                return { error: "Neither coordinate nor elementRef provided" };
              }

              // Type assertion for window with element map
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const win = window as any;

              if (win.__claudeElementMap && win.__claudeElementMap[elementRef]) {
                target = win.__claudeElementMap[elementRef].deref() || null;
                if (!target || !document.contains(target)) {
                  delete win.__claudeElementMap[elementRef];
                  target = null;
                }
              }

              if (!target) {
                return {
                  error: `No element found with reference: "${elementRef}". The element may have been removed from the page.`,
                };
              }
            }

            target.scrollIntoView({ behavior: "smooth", block: "center" });

            // Decode base64 to binary
            const binary = atob(base64Data);
            const bytes: number[] = new Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const array = new Uint8Array(bytes);
            const blob = new Blob([array], { type: "image/png" });
            const file = new File([blob], filename, {
              type: "image/png",
              lastModified: Date.now(),
            });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            // Handle file input
            if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "file") {
              const input = target as HTMLInputElement;
              input.files = dataTransfer.files;
              input.focus();
              input.dispatchEvent(new Event("change", { bubbles: true }));
              input.dispatchEvent(new Event("input", { bubbles: true }));
              const customEvent = new CustomEvent("filechange", {
                bubbles: true,
                detail: { files: dataTransfer.files },
              });
              input.dispatchEvent(customEvent);
              return {
                output: `Successfully uploaded image "${filename}" (${Math.round(blob.size / 1024)}KB) to file input`,
              };
            }

            // Handle drag & drop
            let dropX: number;
            let dropY: number;
            (target as HTMLElement).focus();

            if (coordinate) {
              dropX = coordinate[0];
              dropY = coordinate[1];
            } else {
              const rect = target.getBoundingClientRect();
              dropX = rect.left + rect.width / 2;
              dropY = rect.top + rect.height / 2;
            }

            target.dispatchEvent(
              new DragEvent("dragenter", {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX: dropX,
                clientY: dropY,
                screenX: dropX + window.screenX,
                screenY: dropY + window.screenY,
              })
            );
            target.dispatchEvent(
              new DragEvent("dragover", {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX: dropX,
                clientY: dropY,
                screenX: dropX + window.screenX,
                screenY: dropY + window.screenY,
              })
            );
            target.dispatchEvent(
              new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX: dropX,
                clientY: dropY,
                screenX: dropX + window.screenX,
                screenY: dropY + window.screenY,
              })
            );

            return {
              output: `Successfully dropped image "${filename}" (${Math.round(blob.size / 1024)}KB) onto element at (${Math.round(dropX)}, ${Math.round(dropY)})`,
            };
          } catch (err) {
            return {
              error: `Error uploading image: ${err instanceof Error ? err.message : "Unknown error"}`,
            };
          }
        },
        args: [args.ref || null, args.coordinate || null, base64, args.filename || "image.png"],
      }) as ScriptingResult<UploadImageScriptResult>[];

      if (!results || results.length === 0) {
        throw new Error("Failed to execute upload image");
      }

      const tabsMetadata: TabMetadata[] = await TabGroupManager.getValidTabsWithMetadata(context.tabId);
      const scriptResult = results[0].result;

      // If script returned error, return as ToolResultError
      if (scriptResult.error) {
        return {
          error: scriptResult.error,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs: tabsMetadata,
            tabCount: tabsMetadata.length,
          },
        };
      }

      return {
        output: scriptResult.output,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs: tabsMetadata,
          tabCount: tabsMetadata.length,
        },
      };
    } catch (err) {
      return {
        error: `Failed to upload image: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async (): Promise<AnthropicToolSchema> => ({
    name: "upload_image",
    description:
      "Upload a previously captured screenshot or user-uploaded image to a file input or drag & drop target. Supports two approaches: (1) ref - for targeting specific elements, especially hidden file inputs, (2) coordinate - for drag & drop to visible locations like Google Docs. Provide either ref or coordinate, not both.",
    input_schema: {
      type: "object",
      properties: {
        imageId: {
          type: "string",
          description:
            "ID of a previously captured screenshot (from the computer tool's screenshot action) or a user-uploaded image",
        },
        ref: {
          type: "string",
          description:
            'Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Use this for file inputs (especially hidden ones) or specific elements. Provide either ref or coordinate, not both.',
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          description:
            "Viewport coordinates [x, y] for drag & drop to a visible location. Use this for drag & drop targets like Google Docs. Provide either ref or coordinate, not both.",
        },
        tabId: {
          type: "number",
          description:
            "Tab ID where the target element is located. This is where the image will be uploaded to.",
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
// Read Console Messages Tool
// =============================================================================

export const readConsoleMessagesTool: ToolDefinition = {
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
  },
  execute: async (params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const { tabId, onlyErrors = false, clear = false, pattern, limit = 100 } = params as unknown as ReadConsoleMessagesParams;

      if (!context?.tabId) throw new Error("No active tab found");

      const effectiveTabId = await TabGroupManager.getEffectiveTabId(tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);

      if (!tab.id) throw new Error("Active tab has no ID");

      const url = tab.url;
      if (!url) throw new Error("No URL available for active tab");

      const toolUseId = context?.toolUseId;
      const permResult = await context.permissionManager.checkPermission(url, toolUseId);

      if (!permResult.allowed) {
        if (permResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.READ_CONSOLE_MESSAGES,
            url,
            toolUseId,
          } as PermissionRequiredResult;
        }
        return { error: "Permission denied for reading console messages on this domain" };
      }

      try {
        await cdpDebugger.enableConsoleTracking(tab.id);
      } catch {
        // Ignore errors enabling console tracking
      }

      const messages: ConsoleMessage[] = cdpDebugger.getConsoleMessages(tab.id, onlyErrors, pattern);
      if (clear) cdpDebugger.clearConsoleMessages(tab.id);

      if (messages.length === 0) {
        return {
          output: `No console ${onlyErrors ? "errors or exceptions" : "messages"} found for this tab.\n\nNote: Console tracking starts when this tool is first called. If the page loaded before calling this tool, you may need to refresh the page to capture console messages from page load.`,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs: await TabGroupManager.getValidTabsWithMetadata(context.tabId),
            tabCount: (await TabGroupManager.getValidTabsWithMetadata(context.tabId)).length,
          },
        };
      }

      const limitedMessages = messages.slice(0, limit);
      const truncated = messages.length > limit;

      const formatted = limitedMessages
        .map((msg: ConsoleMessage, idx: number) => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          const location =
            msg.url && msg.lineNumber !== undefined
              ? ` (${msg.url}:${msg.lineNumber}${msg.columnNumber !== undefined ? `:${msg.columnNumber}` : ""})`
              : "";
          let line = `[${idx + 1}] [${time}] [${msg.type.toUpperCase()}]${location}\n${msg.text}`;
          if (msg.stackTrace) line += `\nStack trace:\n${msg.stackTrace}`;
          return line;
        })
        .join("\n\n");

      const msgType = onlyErrors ? "error/exception messages" : "console messages";
      const truncateNote = truncated ? ` (showing first ${limit} of ${messages.length})` : "";
      const header = `Found ${messages.length} ${msgType}${truncateNote}:`;

      const tabsMetadata: TabMetadata[] = await TabGroupManager.getValidTabsWithMetadata(context.tabId);
      return {
        output: `${header}\n\n${formatted}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs: tabsMetadata,
          tabCount: tabsMetadata.length,
        },
      };
    } catch (err) {
      return {
        error: `Failed to read console messages: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async (): Promise<AnthropicToolSchema> => ({
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

// =============================================================================
// Read Network Requests Tool
// =============================================================================

export const readNetworkRequestsTool: ToolDefinition = {
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
  execute: async (params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const { tabId, urlPattern, clear = false, limit = 100 } = params as unknown as ReadNetworkRequestsParams;

      if (!context?.tabId) throw new Error("No active tab found");

      const effectiveTabId = await TabGroupManager.getEffectiveTabId(tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);

      if (!tab.id) throw new Error("Active tab has no ID");

      const url = tab.url;
      if (!url) throw new Error("No URL available for active tab");

      const toolUseId = context?.toolUseId;
      const permResult = await context.permissionManager.checkPermission(url, toolUseId);

      if (!permResult.allowed) {
        if (permResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.READ_NETWORK_REQUESTS,
            url,
            toolUseId,
          } as PermissionRequiredResult;
        }
        return { error: "Permission denied for reading network requests on this domain" };
      }

      try {
        await cdpDebugger.enableNetworkTracking(tab.id);
      } catch {
        // Ignore errors enabling network tracking
      }

      const requests: NetworkRequest[] = cdpDebugger.getNetworkRequests(tab.id, urlPattern);
      if (clear) cdpDebugger.clearNetworkRequests(tab.id);

      if (requests.length === 0) {
        let reqType = "network requests";
        if (urlPattern) reqType = `requests matching "${urlPattern}"`;
        return {
          output: `No ${reqType} found for this tab.\n\nNote: Network tracking starts when this tool is first called. If the page loaded before calling this tool, you may need to refresh the page or perform actions that trigger network requests.`,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs: await TabGroupManager.getValidTabsWithMetadata(context.tabId),
            tabCount: (await TabGroupManager.getValidTabsWithMetadata(context.tabId)).length,
          },
        };
      }

      const limitedRequests = requests.slice(0, limit);
      const truncated = requests.length > limit;

      const formatted = limitedRequests
        .map((req: NetworkRequest, idx: number) => {
          const status = req.status || "pending";
          return `${idx + 1}. url: ${req.url}\n   method: ${req.method}\n   statusCode: ${status}`;
        })
        .join("\n\n");

      const filters: string[] = [];
      if (urlPattern) filters.push(`URL pattern: "${urlPattern}"`);
      const filterNote = filters.length > 0 ? ` (filtered by ${filters.join(", ")})` : "";
      const truncateNote = truncated ? ` (showing first ${limit} of ${requests.length})` : "";
      const header = `Found ${requests.length} network request${requests.length === 1 ? "" : "s"}${filterNote}${truncateNote}:`;

      const tabsMetadata: TabMetadata[] = await TabGroupManager.getValidTabsWithMetadata(context.tabId);
      return {
        output: `${header}\n\n${formatted}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs: tabsMetadata,
          tabCount: tabsMetadata.length,
        },
      };
    } catch (err) {
      return {
        error: `Failed to read network requests: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async (): Promise<AnthropicToolSchema> => ({
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
// Resize Window Tool
// =============================================================================

export const resizeWindowTool: ToolDefinition = {
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
  execute: async (params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const { width, height, tabId } = params as unknown as ResizeWindowParams;

      if (!width || !height) {
        throw new Error("Both width and height parameters are required");
      }
      if (!tabId) throw new Error("tabId parameter is required");
      if (!context?.tabId) throw new Error("No active tab found");
      if (typeof width !== "number" || typeof height !== "number") {
        throw new Error("Width and height must be numbers");
      }
      if (width <= 0 || height <= 0) {
        throw new Error("Width and height must be positive numbers");
      }
      if (width > 7680 || height > 4320) {
        throw new Error("Dimensions exceed 8K resolution limit. Maximum dimensions are 7680x4320");
      }

      const effectiveTabId = await TabGroupManager.getEffectiveTabId(tabId, context.tabId);
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
    } catch (err) {
      return {
        error: `Failed to resize window: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async (): Promise<AnthropicToolSchema> => ({
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
// Turn Answer Start Tool
// =============================================================================

/** Schema for turn_answer_start tool */
const turnAnswerStartSchema: ToolParameterSchema = { type: "object", properties: {}, required: false };

export const turnAnswerStartTool: ToolDefinition = {
  name: "turn_answer_start",
  description:
    "Call this immediately before your text response to the user for this turn. Required every turn - whether or not you made tool calls. After calling, write your response. No more tools after this.",
  parameters: turnAnswerStartSchema as unknown as Record<string, ToolParameterSchema>,
  execute: async (): Promise<ToolResult> => ({ output: "Proceed with your response." }),
  toAnthropicSchema(): AnthropicToolSchema {
    return {
      type: "custom",
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    };
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Launch shortcut in new window
 */
async function launchShortcutWindow(params: LaunchShortcutParams): Promise<{ success: boolean; error?: string }> {
  const { tabId, prompt, taskName, skipPermissions, model } = params;
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const runLogId = `shortcut_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  await setStorageValue(StorageKeys.TARGET_TAB_ID, tabId);

  // Create sidepanel window
  const sidepanelUrl = chrome.runtime.getURL(
    `sidepanel.html?mode=window&sessionId=${sessionId}${skipPermissions ? "&skipPermissions=true" : ""}${model ? `&model=${encodeURIComponent(model)}` : ""}`
  );

  const window = await chrome.windows.create({
    url: sidepanelUrl,
    type: "popup",
    width: 500,
    height: 768,
    left: 100,
    top: 100,
    focused: true,
  });

  if (!window) throw new Error("Failed to create sidepanel window");

  // Wait for tab to load and send task
  await new Promise<void>((resolve, reject) => {
    const startTime = Date.now();
    let sent = false;

    const checkAndSend = async (): Promise<void> => {
      try {
        if (Date.now() - startTime > 30000) {
          reject(new Error("Timeout waiting for tab to load for task execution"));
          return;
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
                isScheduledTask: false,
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
      } catch (err) {
        reject(err);
      }
    };

    setTimeout(checkAndSend, 1000);
  });

  return { success: true };
}

// =============================================================================
// Shortcuts List Tool
// =============================================================================

export const shortcutsListTool: ToolDefinition = {
  name: "shortcuts_list",
  description:
    "List all available shortcuts and workflows (shortcuts and workflows are interchangeable). Returns shortcuts with their commands, descriptions, and whether they are workflows. Use shortcuts_execute to run a shortcut or workflow.",
  parameters: {},
  execute: async (): Promise<ToolResult> => {
    try {
      const prompts: SavedPrompt[] = await SavedPromptsService.getAllPrompts();
      const shortcuts: ShortcutInfo[] = prompts.map((prompt: SavedPrompt) => ({
        id: prompt.id,
        ...(prompt.command && { command: prompt.command }),
      }));

      if (shortcuts.length === 0) {
        return {
          output: JSON.stringify(
            { message: "No shortcuts found", shortcuts: [] },
            null,
            2
          ),
        };
      }

      return {
        output: JSON.stringify(
          { message: `Found ${shortcuts.length} shortcut(s)`, shortcuts },
          null,
          2
        ),
      };
    } catch (err) {
      return {
        error: `Failed to list shortcuts: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async (): Promise<AnthropicToolSchema> => ({
    name: "shortcuts_list",
    description:
      "List all available shortcuts and workflows (shortcuts and workflows are interchangeable). Returns shortcuts with their commands, descriptions, and whether they are workflows. Use shortcuts_execute to run a shortcut or workflow.",
    input_schema: { type: "object", properties: {}, required: [] },
  }),
};

// =============================================================================
// Shortcuts Execute Tool
// =============================================================================

export const shortcutsExecuteTool: ToolDefinition = {
  name: "shortcuts_execute",
  description:
    "Execute a shortcut or workflow by running it in a new sidepanel window using the current tab (shortcuts and workflows are interchangeable). Use shortcuts_list first to see available shortcuts. This starts the execution and returns immediately - it does not wait for completion.",
  parameters: {
    shortcutId: {
      type: "string",
      description: "The ID of the shortcut to execute",
    },
    command: {
      type: "string",
      description:
        "The command name of the shortcut to execute (e.g., 'debug', 'summarize'). Do not include the leading slash.",
    },
  },
  execute: async (params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const { shortcutId, command } = params as ShortcutsExecuteParams;

      if (!shortcutId && !command) {
        return {
          error:
            "Either shortcutId or command is required. Use shortcuts_list to see available shortcuts.",
        };
      }

      const tabId = context?.tabId;
      if (!tabId) {
        return {
          error: "No tab context available. Cannot execute shortcut without a target tab.",
        };
      }

      let prompt: SavedPrompt | undefined;
      if (shortcutId) {
        prompt = await SavedPromptsService.getPromptById(shortcutId);
      } else if (command) {
        const cmd = command.startsWith("/") ? command.slice(1) : command;
        prompt = await SavedPromptsService.getPromptByCommand(cmd);
      }

      if (!prompt) {
        return {
          error: `Shortcut not found. ${shortcutId ? `No shortcut with ID "${shortcutId}"` : `No shortcut with command "/${command}"`}. Use shortcuts_list to see available shortcuts.`,
        };
      }

      await SavedPromptsService.recordPromptUsage(prompt.id);

      const shortcutName = prompt.command || prompt.id;
      const shortcutPrompt = `[[shortcut:${prompt.id}:${shortcutName}]]`;

      const result = await launchShortcutWindow({
        tabId,
        tabGroupId: context?.tabGroupId,
        prompt: shortcutPrompt,
        taskName: prompt.command || prompt.id,
        skipPermissions: prompt.skipPermissions,
        model: prompt.model,
      });

      if (result.success) {
        return {
          output: JSON.stringify(
            {
              success: true,
              message: `Shortcut "${prompt.command || prompt.id}" started. Execution is running in a separate sidepanel window.`,
              shortcut: { id: prompt.id, command: prompt.command },
            },
            null,
            2
          ),
        };
      }

      return { error: result.error || "Shortcut execution failed" };
    } catch (err) {
      return {
        error: `Failed to execute shortcut: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async (): Promise<AnthropicToolSchema> => ({
    name: "shortcuts_execute",
    description:
      "Execute a shortcut or workflow by running it in a new sidepanel window using the current tab (shortcuts and workflows are interchangeable). Use shortcuts_list first to see available shortcuts. This starts the execution and returns immediately - it does not wait for completion.",
    input_schema: {
      type: "object",
      properties: {
        shortcutId: {
          type: "string",
          description: "The ID of the shortcut to execute",
        },
        command: {
          type: "string",
          description:
            "The command name of the shortcut to execute (e.g., 'debug', 'summarize'). Do not include the leading slash.",
        },
      },
      required: [],
    },
  }),
};

