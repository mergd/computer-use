/**
 * page-tools.ts - Page interaction tools
 *
 * Contains tools for reading and interacting with page content:
 * - le: read_page tool
 * - de: form_input tool
 * - he: get_page_text tool
 * - De: javascript_tool
 */

import { cdpDebuggerInstance as cdpDebugger } from "./cdp-debugger.js";
import { tabGroupManagerInstance as TabGroupManager } from "./tab-group-manager.js";
import { ToolPermissionType } from "./storage.js";
import { checkNavigationInterception } from "./utils.js";

// =============================================================================
// Type Definitions
// =============================================================================

/** Permission check result from permission manager */
interface PermissionResult {
  allowed: boolean;
  needsPrompt?: boolean;
}

/** Permission manager interface */
interface PermissionManager {
  checkPermission(url: string, toolUseId?: string): Promise<PermissionResult>;
}

/** Context passed to tool execute functions */
interface ToolContext {
  tabId: number;
  toolUseId?: string;
  permissionManager: PermissionManager;
}

/** Tab metadata returned for context */
interface TabMetadata {
  id: number;
  title: string;
  url: string;
}

/** Tab context included in tool responses */
interface TabContext {
  currentTabId: number;
  executedOnTabId: number;
  availableTabs: TabMetadata[];
  tabCount: number;
}

/** Parameter schema definition */
interface ParameterSchema {
  type: string | string[];
  enum?: string[];
  description: string;
}

/** Anthropic tool schema format */
interface AnthropicSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, ParameterSchema>;
    required: string[];
  };
}

/** Base tool result with optional output or error */
interface ToolResult {
  output?: string;
  error?: string;
  tabContext?: TabContext;
}

/** Permission required result */
interface PermissionRequiredResult {
  type: "permission_required";
  tool: string;
  url: string;
  toolUseId?: string;
  actionData?: Record<string, unknown>;
}

/** Tool definition interface */
interface Tool<TParams = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  execute: (params: TParams, context: ToolContext) => Promise<ToolResult | PermissionRequiredResult>;
  toAnthropicSchema: () => Promise<AnthropicSchema>;
}

// =============================================================================
// Parameter Interfaces
// =============================================================================

/** Parameters for read_page tool */
interface ReadPageParams {
  filter?: "interactive" | "all" | null;
  tabId?: number;
  depth?: number | null;
  ref_id?: string | null;
  max_chars?: number;
}

/** Parameters for form_input tool */
interface FormInputParams {
  ref: string;
  value: string | boolean | number;
  tabId?: number;
}

/** Parameters for get_page_text tool */
interface GetPageTextParams {
  tabId?: number;
  max_chars?: number;
}

/** Parameters for javascript_tool */
interface JavaScriptToolParams {
  action: string;
  text: string;
  tabId?: number;
}

// Window globals (__generateAccessibilityTree, __claudeElementMap) are declared in types.ts

// =============================================================================
// read_page tool (le)
// =============================================================================

export const readPageTool: Tool<ReadPageParams> = {
  name: "read_page",
  description:
    "Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Can optionally filter for only interactive elements, limit tree depth, or focus on a specific element. Returns a structured tree that represents how screen readers see the page content. If you don't have a valid tab ID, use tabs_context first to get available tabs. Output is limited to 50000 characters - if exceeded, specify a depth limit or ref_id to focus on a specific element.",
  parameters: {
    filter: {
      type: "string",
      enum: ["interactive", "all"],
      description:
        'Filter elements: "interactive" for buttons/links/inputs only, "all" for all elements including non-visible ones (default: all elements)',
    },
    tabId: {
      type: "number",
      description:
        "Tab ID to read from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
    },
    depth: {
      type: "number",
      description:
        "Maximum depth of the tree to traverse (default: 15). Use a smaller depth if output is too large.",
    },
    ref_id: {
      type: "string",
      description:
        "Reference ID of a parent element to read. Will return the specified element and all its children. Use this to focus on a specific part of the page when output is too large.",
    },
    max_chars: {
      type: "number",
      description:
        "Maximum characters for output (default: 50000). Set to a higher value if your client can handle large outputs.",
    },
  },
  execute: async (params, context) => {
    const { filter, tabId, depth, ref_id, max_chars } = params || {};

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
          tool: ToolPermissionType.READ_PAGE_CONTENT,
          url,
          toolUseId,
        };
      }
      return { error: "Permission denied for reading pages on this domain" };
    }

    await TabGroupManager.hideIndicatorForToolUse(effectiveTabId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (filterArg: string | null, depthArg: number | null, maxCharsArg: number, refIdArg: string | null) => {
          if (typeof window.__generateAccessibilityTree !== "function") {
            throw new Error("Accessibility tree function not found. Please refresh the page.");
          }
          return window.__generateAccessibilityTree(filterArg, depthArg, maxCharsArg, refIdArg);
        },
        args: [filter || null, depth ?? null, max_chars ?? 50000, ref_id ?? null],
      });

      if (!results || results.length === 0) {
        throw new Error("No results returned from page script");
      }
      if ("error" in results[0] && results[0].error) {
        throw new Error(`Script execution failed: ${(results[0].error as Error).message || "Unknown error"}`);
      }
      if (!results[0].result) {
        throw new Error("Page script returned empty result");
      }

      const result = results[0].result;
      if (result.error) return { error: result.error };

      const viewportInfo = `Viewport: ${result.viewport.width}x${result.viewport.height}`;
      const tabsMetadata = await TabGroupManager.getValidTabsWithMetadata(context.tabId);

      return {
        output: `${result.pageContent}\n\n${viewportInfo}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs: tabsMetadata,
          tabCount: tabsMetadata.length,
        },
      };
    } catch (err) {
      return {
        error: `Failed to read page: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    } finally {
      await TabGroupManager.restoreIndicatorAfterToolUse(effectiveTabId);
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
          description:
            'Filter elements: "interactive" for buttons/links/inputs only, "all" for all elements including non-visible ones (default: all elements)',
        },
        tabId: {
          type: "number",
          description:
            "Tab ID to read from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
        depth: {
          type: "number",
          description:
            "Maximum depth of the tree to traverse (default: 15). Use a smaller depth if output is too large.",
        },
        ref_id: {
          type: "string",
          description:
            "Reference ID of a parent element to read. Will return the specified element and all its children. Use this to focus on a specific part of the page when output is too large.",
        },
        max_chars: {
          type: "number",
          description:
            "Maximum characters for output (default: 50000). Set to a higher value if your client can handle large outputs.",
        },
      },
      required: ["tabId"],
    },
  }),
};

// =============================================================================
// form_input tool (de)
// =============================================================================

export const formInputTool: Tool<FormInputParams> = {
  name: "form_input",
  description:
    "Set values in form elements using element reference ID from the read_page or find tools. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  parameters: {
    ref: {
      type: "string",
      description:
        'Element reference ID from the read_page or find tools (e.g., "ref_1", "ref_2")',
    },
    value: {
      type: ["string", "boolean", "number"],
      description:
        "The value to set. For checkboxes use boolean, for selects use option value or text, for other inputs use appropriate string/number",
    },
    tabId: {
      type: "number",
      description:
        "Tab ID to set form value in. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
    },
  },
  execute: async (params, context) => {
    try {
      const args = params;
      if (!args?.ref) throw new Error("ref parameter is required");
      if (args.value === undefined || args.value === null) {
        throw new Error("Value parameter is required");
      }
      if (!context?.tabId) throw new Error("No active tab found");

      const effectiveTabId = await TabGroupManager.getEffectiveTabId(args.tabId, context.tabId);
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
            tool: ToolPermissionType.TYPE,
            url,
            toolUseId,
            actionData: { ref: args.ref, value: args.value },
          };
        }
        return { error: "Permission denied for form input on this domain" };
      }

      const originalUrl = tab.url;
      if (!originalUrl) {
        return { error: "Unable to get original URL for security check" };
      }

      const navCheck = await checkNavigationInterception(tab.id, originalUrl, "form input action");
      if (navCheck) return navCheck;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (refId: string, value: string | boolean | number) => {
          try {
            let element: Element | null = null;
            if (window.__claudeElementMap && window.__claudeElementMap[refId]) {
              element = window.__claudeElementMap[refId].deref() || null;
              if (!element || !document.contains(element)) {
                delete window.__claudeElementMap[refId];
                element = null;
              }
            }

            if (!element) {
              return {
                error: `No element found with reference: "${refId}". The element may have been removed from the page.`,
              };
            }

            element.scrollIntoView({ behavior: "smooth", block: "center" });

            // Handle select elements
            if (element instanceof HTMLSelectElement) {
              const prevValue = element.value;
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
                output: `Selected option "${valueStr}" in dropdown (previous: "${prevValue}")`,
              };
            }

            // Handle checkbox
            if (element instanceof HTMLInputElement && element.type === "checkbox") {
              const prevChecked = element.checked;
              if (typeof value !== "boolean") {
                return { error: "Checkbox requires a boolean value (true/false)" };
              }
              element.checked = value;
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));
              return {
                output: `Checkbox ${element.checked ? "checked" : "unchecked"} (previous: ${prevChecked})`,
              };
            }

            // Handle radio
            if (element instanceof HTMLInputElement && element.type === "radio") {
              const prevChecked = element.checked;
              const groupName = element.name;
              element.checked = true;
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));
              return {
                success: true,
                action: "form_input",
                ref: refId,
                element_type: "radio",
                previous_value: prevChecked,
                new_value: element.checked,
                message: "Radio button selected" + (groupName ? ` in group "${groupName}"` : ""),
              };
            }

            // Handle date/time inputs
            if (
              element instanceof HTMLInputElement &&
              ["date", "time", "datetime-local", "month", "week"].includes(element.type)
            ) {
              const prevValue = element.value;
              element.value = String(value);
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));
              return { output: `Set ${element.type} to "${element.value}" (previous: ${prevValue})` };
            }

            // Handle range
            if (element instanceof HTMLInputElement && element.type === "range") {
              const prevValue = element.value;
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
                ref: refId,
                element_type: "range",
                previous_value: prevValue,
                new_value: element.value,
                message: `Set range to ${element.value} (min: ${element.min}, max: ${element.max})`,
              };
            }

            // Handle number
            if (element instanceof HTMLInputElement && element.type === "number") {
              const prevValue = element.value;
              const numValue = Number(value);
              if (isNaN(numValue) && value !== "") {
                return { error: "Number input requires a numeric value" };
              }
              element.value = String(value);
              element.focus();
              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));
              return {
                output: `Set number input to ${element.value} (previous: ${prevValue})`,
              };
            }

            // Handle text inputs and textareas
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
              const prevValue = element.value;
              element.value = String(value);
              element.focus();

              if (
                element instanceof HTMLTextAreaElement ||
                (element instanceof HTMLInputElement &&
                  ["text", "search", "url", "tel", "password"].includes(element.type))
              ) {
                element.setSelectionRange(element.value.length, element.value.length);
              }

              element.dispatchEvent(new Event("change", { bubbles: true }));
              element.dispatchEvent(new Event("input", { bubbles: true }));

              return {
                output: `Set ${element instanceof HTMLTextAreaElement ? "textarea" : element.type || "text"} value to "${element.value}" (previous: "${prevValue}")`,
              };
            }

            return {
              error: `Element type "${element.tagName}" is not a supported form input`,
            };
          } catch (err) {
            return {
              error: `Error setting form value: ${err instanceof Error ? err.message : "Unknown error"}`,
            };
          }
        },
        args: [args.ref, args.value],
      });

      if (!results || results.length === 0) {
        throw new Error("Failed to execute form input");
      }

      const tabsMetadata = await TabGroupManager.getValidTabsWithMetadata(context.tabId);
      return {
        ...results[0].result,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs: tabsMetadata,
          tabCount: tabsMetadata.length,
        },
      };
    } catch (err) {
      return {
        error: `Failed to execute form input: ${err instanceof Error ? err.message : "Unknown error"}`,
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
          description:
            'Element reference ID from the read_page tool (e.g., "ref_1", "ref_2")',
        },
        value: {
          type: ["string", "boolean", "number"],
          description:
            "The value to set. For checkboxes use boolean, for selects use option value or text, for other inputs use appropriate string/number",
        },
        tabId: {
          type: "number",
          description:
            "Tab ID to set form value in. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
      },
      required: ["ref", "value", "tabId"],
    },
  }),
};

// =============================================================================
// get_page_text tool (he)
// =============================================================================

export const getPageTextTool: Tool<GetPageTextParams> = {
  name: "get_page_text",
  description:
    "Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting. If you don't have a valid tab ID, use tabs_context first to get available tabs. Output is limited to 50000 characters by default.",
  parameters: {
    tabId: {
      type: "number",
      description:
        "Tab ID to extract text from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
    },
    max_chars: {
      type: "number",
      description:
        "Maximum characters for output (default: 50000). Set to a higher value if your client can handle large outputs.",
    },
  },
  execute: async (params, context) => {
    const { tabId, max_chars } = params || {};

    if (!context?.tabId) throw new Error("No active tab found");

    const effectiveTabId = await TabGroupManager.getEffectiveTabId(tabId, context.tabId);
    const url = (await chrome.tabs.get(effectiveTabId)).url;

    if (!url) throw new Error("No URL available for active tab");

    const toolUseId = context?.toolUseId;
    const permResult = await context.permissionManager.checkPermission(url, toolUseId);

    if (!permResult.allowed) {
      if (permResult.needsPrompt) {
        return {
          type: "permission_required",
          tool: ToolPermissionType.READ_PAGE_CONTENT,
          url,
          toolUseId,
        };
      }
      return { error: "Permission denied for reading page content on this domain" };
    }

    await TabGroupManager.hideIndicatorForToolUse(effectiveTabId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: effectiveTabId },
        func: (maxChars: number) => {
          const selectors = [
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
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              let best = elements[0];
              let bestLength = 0;
              elements.forEach((el) => {
                const len = el.textContent?.length || 0;
                if (len > bestLength) {
                  bestLength = len;
                  best = el;
                }
              });
              contentElement = best;
              break;
            }
          }

          if (!contentElement) {
            if ((document.body.textContent || "").length > maxChars) {
              return {
                text: "",
                source: "none",
                title: document.title,
                url: window.location.href,
                error:
                  "No semantic content element found and page body is too large (likely contains CSS/scripts). Try using read_page_content (screenshot) instead.",
              };
            }
            contentElement = document.body;
          }

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
              error:
                "No text content found. Page may contain only images, videos, or canvas-based content.",
            };
          }

          if (text.length > maxChars) {
            return {
              text: "",
              source: contentElement.tagName.toLowerCase(),
              title: document.title,
              url: window.location.href,
              error:
                "Output exceeds " +
                maxChars +
                " character limit (" +
                text.length +
                " characters). Try using read_page with a specific ref_id to focus on a smaller section, or increase max_chars if your client can handle larger outputs.",
            };
          }

          return {
            text,
            source: contentElement.tagName.toLowerCase(),
            title: document.title,
            url: window.location.href,
          };
        },
        args: [max_chars ?? 50000],
      });

      if (!results || results.length === 0) {
        throw new Error(
          "No main text content found. The content might be visual content only, or rendered in a canvas element."
        );
      }
      if ("error" in results[0] && results[0].error) {
        throw new Error(`Script execution failed: ${(results[0].error as Error).message || "Unknown error"}`);
      }
      if (!results[0].result) {
        throw new Error("Page script returned empty result");
      }

      const result = results[0].result;
      const tabsMetadata = await TabGroupManager.getValidTabsWithMetadata(context.tabId);

      if (result.error) {
        return {
          error: result.error,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs: tabsMetadata,
            tabCount: tabsMetadata.length,
          },
        };
      }

      return {
        output: `Title: ${result.title}\nURL: ${result.url}\nSource element: <${result.source}>\n---\n${result.text}`,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs: tabsMetadata,
          tabCount: tabsMetadata.length,
        },
      };
    } catch (err) {
      return {
        error: `Failed to extract page text: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    } finally {
      await TabGroupManager.restoreIndicatorAfterToolUse(effectiveTabId);
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
          description:
            "Tab ID to extract text from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
        max_chars: {
          type: "number",
          description:
            "Maximum characters for output (default: 50000). Set to a higher value if your client can handle large outputs.",
        },
      },
      required: ["tabId"],
    },
  }),
};

// =============================================================================
// javascript_tool (De)
// =============================================================================

export const javascriptTool: Tool<JavaScriptToolParams> = {
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
  execute: async (params, context) => {
    try {
      const { action, text, tabId } = params;

      if (action !== "javascript_exec") {
        throw new Error("'javascript_exec' is the only supported action");
      }
      if (!text) throw new Error("Code parameter is required");
      if (!context?.tabId) throw new Error("No active tab found");

      const effectiveTabId = await TabGroupManager.getEffectiveTabId(tabId, context.tabId);
      const url = (await chrome.tabs.get(effectiveTabId)).url;

      if (!url) throw new Error("No URL available for active tab");

      const toolUseId = context?.toolUseId;
      const permResult = await context.permissionManager.checkPermission(url, toolUseId);

      if (!permResult.allowed) {
        if (permResult.needsPrompt) {
          return {
            type: "permission_required",
            tool: ToolPermissionType.EXECUTE_JAVASCRIPT,
            url,
            toolUseId,
            actionData: { text },
          };
        }
        return { error: "Permission denied for JavaScript execution on this domain" };
      }

      const navCheck = await checkNavigationInterception(effectiveTabId, url, "JavaScript execution");
      if (navCheck) return navCheck;

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

      const evalResult = await cdpDebugger.sendCommand(effectiveTabId, "Runtime.evaluate", {
        expression: wrappedCode,
        returnByValue: true,
        awaitPromise: true,
        timeout: 10000,
      }) as {
        result?: { type: string; subtype?: string; value?: unknown; description?: string };
        exceptionDetails?: { exception?: { description?: string; value?: unknown } };
      };

      let output = "";
      let hasError = false;
      let errorMessage = "";

      // Sanitize sensitive data
      const sanitize = (value: unknown, depth = 0): unknown => {
        if (depth > 5) return "[TRUNCATED: Max depth exceeded]";

        const sensitivePatterns = [
          /password/i, /token/i, /secret/i, /api[_-]?key/i, /auth/i,
          /credential/i, /private[_-]?key/i, /access[_-]?key/i,
          /bearer/i, /oauth/i, /session/i,
        ];

        if (typeof value === "string") {
          if (value.includes("=") && (value.includes(";") || value.includes("&"))) {
            return "[BLOCKED: Cookie/query string data]";
          }
          if (value.match(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)) {
            return "[BLOCKED: JWT token]";
          }
          if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(value)) {
            return "[BLOCKED: Base64 encoded data]";
          }
          if (/^[a-f0-9]{32,}$/i.test(value)) {
            return "[BLOCKED: Hex credential]";
          }
          if (value.length > 1000) return value.substring(0, 1000) + "[TRUNCATED]";
        }

        if (value && typeof value === "object" && !Array.isArray(value)) {
          const sanitized: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            const isSensitive = sensitivePatterns.some((p) => p.test(key));
            sanitized[key] = isSensitive
              ? "[BLOCKED: Sensitive key]"
              : key === "cookie" || key === "cookies"
                ? "[BLOCKED: Cookie access]"
                : sanitize(val, depth + 1);
          }
          return sanitized;
        }

        if (Array.isArray(value)) {
          const result = value.slice(0, 100).map((v) => sanitize(v, depth + 1));
          if (value.length > 100) {
            result.push(`[TRUNCATED: ${value.length - 100} more items]`);
          }
          return result;
        }

        return value;
      };

      const maxOutput = 51200;

      if (evalResult.exceptionDetails) {
        hasError = true;
        const exception = evalResult.exceptionDetails.exception;
        const isTimeout = exception?.description?.includes("execution was terminated");
        errorMessage = isTimeout
          ? "Execution timeout: Code exceeded 10-second limit"
          : exception?.description || String(exception?.value) || "Unknown error";
      } else if (evalResult.result) {
        const result = evalResult.result;

        if (result.type === "undefined") {
          output = "undefined";
        } else if (result.type === "object" && result.subtype === "null") {
          output = "null";
        } else if (result.type === "function") {
          output = result.description || "[Function]";
        } else if (result.type === "object") {
          if (result.subtype === "node") {
            output = result.description || "[DOM Node]";
          } else if (result.subtype === "array") {
            output = result.description || "[Array]";
          } else {
            const sanitized = sanitize(result.value || {});
            output = result.description || JSON.stringify(sanitized, null, 2);
          }
        } else if (result.value !== undefined) {
          const sanitized = sanitize(result.value);
          output = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized, null, 2);
        } else {
          output = result.description || String(result.value);
        }
      } else {
        output = "undefined";
      }

      const tabsMetadata = await TabGroupManager.getValidTabsWithMetadata(context.tabId);

      if (hasError) {
        return {
          error: `JavaScript execution error: ${errorMessage}`,
          tabContext: {
            currentTabId: context.tabId,
            executedOnTabId: effectiveTabId,
            availableTabs: tabsMetadata,
            tabCount: tabsMetadata.length,
          },
        };
      }

      if (output.length > maxOutput) {
        output = output.substring(0, maxOutput) + "\n[OUTPUT TRUNCATED: Exceeded 50KB limit]";
      }

      return {
        output,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs: tabsMetadata,
          tabCount: tabsMetadata.length,
        },
      };
    } catch (err) {
      return {
        error: `Failed to execute JavaScript: ${err instanceof Error ? err.message : "Unknown error"}`,
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

