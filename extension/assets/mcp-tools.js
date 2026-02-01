/**
 * mcp-tools.js - MCP (Model Context Protocol) Tools Implementation
 *
 * This is a Vite-bundled production build. Key components:
 *
 * IMPORTS:
 *   H = TabGroupManager class    - from tab-group-manager.js
 *   K = TabGroupManager singleton - from tab-group-manager.js
 *   re = CDPDebugger instance    - from cdp-debugger.js
 *
 * CLASSES:
 *   W = DomainCategoryCache - Caches domain category lookups
 *
 * KEY FUNCTIONS (exported):
 *   Qt = executeToolRequest  - Main entry for MCP tool execution
 *   Xt = createErrorResponse - Creates error responses
 *   nr = notifyDisconnection - Called on native host disconnect
 *
 * EXPORTS:
 *   t (K)  = TabGroupManager singleton
 *   B (W)  = DomainCategoryCache
 *   J (re) = CDPDebugger instance
 *   M (Xt) = createErrorResponse
 *   N (Qt) = executeToolRequest
 *   L (nr) = notifyDisconnection
 */
// Note: __vite__mapDeps removed - was dead code for dynamic imports that were never used
// Note: anthropic-client.js import removed - find tool now handled by MCP server
import {
  k as r,
  S as o,
  T as n,
  h as a,
  b as s,
  s as c,
  z as u,
  w as l,
  A as d,
  x as h,
  B as p,
  y as f,
  C as m,
  E as g,
  _ as b,
  d as w,
  K as y,
  g as v,
} from "./storage.js";
import { re, Q, setTabGroupManager } from "./cdp-debugger.js";
import { K, H, j, z, D, M, setDomainCategoryCache } from "./tab-group-manager.js";

// Stub PermissionManager for MCP mode (real permissions handled via --skip-permissions)
class T {
  constructor(skipCheck, opts) {
    this.skipCheck = skipCheck;
  }
  async checkPermission(url, toolUseId) {
    // In MCP mode, permissions are controlled by --skip-permissions flag
    return { allowed: this.skipCheck(), needsPrompt: false };
  }
}

// Stub for tracing/telemetry - just executes the function directly
const I = async (name, fn, ...args) => fn({ setAttribute: () => {} });
function R(e, t) {
  const r = {
    availableTabs: e.map((e) => ({ tabId: e.id, title: e.title, url: e.url })),
  };
  return (void 0 !== t && (r.tabGroupId = t), JSON.stringify(r));
}
function U(e) {
  const t = {};
  return (
    e.availableTabs &&
      (t.availableTabs = e.availableTabs.map((e) => ({
        tabId: e.id,
        title: e.title,
        url: e.url,
      }))),
    e.domainSkills &&
      e.domainSkills.length > 0 &&
      (t.domainSkills = e.domainSkills),
    void 0 !== e.initialTabId && (t.initialTabId = e.initialTabId),
    JSON.stringify(t)
  );
}
function P(e) {
  return e.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim();
}
const G = async (e, t) =>
    await Promise.all(e.map((e) => e.toAnthropicSchema(t))),
  B = (e, t, r) => {
    const o = r.find((t) => t.name === e);
    if (!o || !o.parameters || "object" != typeof t || !t) return t;
    const n = { ...t };
    for (const [i, a] of Object.entries(o.parameters))
      if (i in n && a && "object" == typeof a) {
        const e = n[i],
          t = a;
        if ("number" === t.type && "string" == typeof e) {
          const t = Number(e);
          isNaN(t) || (n[i] = t);
        } else
          "boolean" === t.type && "string" == typeof e && (n[i] = "true" === e);
      }
    return n;
  },
  O = (e, t) => {
    if (Array.isArray(e)) return e;
    if ("string" == typeof e)
      try {
        const t = JSON.parse(e);
        return Array.isArray(t) ? t : [];
      } catch {
        return [];
      }
    return [];
  };
function $(e, t) {
  (console.info(`[imageUtils] Looking for image with ID: ${t}`),
    console.info(`[imageUtils] Total messages to search: ${e.length}`));
  for (let r = e.length - 1; r >= 0; r--) {
    const o = e[r];
    if ("user" === o.role && Array.isArray(o.content)) {
      for (const r of o.content)
        if ("tool_result" === r.type) {
          const e = r;
          if (e.content) {
            const r = Array.isArray(e.content)
              ? e.content
              : [{ type: "text", text: e.content }];
            let o = !1,
              n = "";
            for (const e of r)
              if ("text" === e.type && e.text && e.text.includes(t)) {
                ((o = !0),
                  (n = e.text),
                  console.info(
                    "[imageUtils] ✅ Found image ID in tool_result text",
                  ));
                break;
              }
            if (o)
              for (const e of r)
                if ("image" === e.type) {
                  const r = e;
                  if (r.source && "data" in r.source && r.source.data)
                    return (
                      console.info(
                        `[imageUtils] ✅ Found image data for ID ${t}`,
                      ),
                      {
                        base64: r.source.data,
                        width: L(n, "width"),
                        height: L(n, "height"),
                      }
                    );
                }
          }
        }
      const e = o.content.findIndex(
        (e) => "text" === e.type && e.text?.includes(t),
      );
      if (-1 !== e) {
        console.info(
          `[imageUtils] Found image ID in user text at index ${e}, looking for next adjacent image`,
        );
        for (let r = e + 1; r < o.content.length; r++) {
          const e = o.content[r];
          if ("image" === e.type) {
            const o = e;
            if (o.source && "data" in o.source && o.source.data)
              return (
                console.info(
                  `[imageUtils] ✅ Found user-uploaded image for ID ${t} at index ${r}`,
                ),
                { base64: o.source.data }
              );
          }
          if ("text" === e.type) {
            console.info(
              "[imageUtils] Hit another text block, stopping search",
            );
            break;
          }
        }
      }
    }
  }
  console.info(`[imageUtils] ❌ Image not found with ID: ${t}`);
}
function L(e, t) {
  if (!e) return;
  const r = e.match(/\((\d+)x(\d+)/);
  return r ? ("width" === t ? parseInt(r[1], 10) : parseInt(r[2], 10)) : void 0;
}
function N(e) {
  e.startsWith("http") || (e = `https://${e}`);
  try {
    return new URL(e).hostname;
  } catch {
    return "";
  }
}
function q(e) {
  return e
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/\/.*$/, "");
}
async function F(e, t, r) {
  if (!t) return null;
  const o = await chrome.tabs.get(e);
  if (!o.url)
    return { error: "Unable to verify current URL for security check" };
  const n = N(t),
    i = N(o.url);
  return n !== i
    ? {
        error: `Security check failed: Domain changed from ${n} to ${i} during ${r}`,
      }
    : null;
}
class W {
  static cache = new Map();
  static CACHE_TTL_MS = 3e5;
  static pendingRequests = new Map();
  static async getCategory(e) {
    if (self.__skipPermissions) return null;
    const t = q(N(e)),
      r = this.cache.get(t);
    if (r) {
      if (!(Date.now() - r.timestamp > this.CACHE_TTL_MS)) return r.category;
      this.cache.delete(t);
    }
    const o = this.pendingRequests.get(t);
    if (o) return o;
    const n = this.fetchCategoryFromAPI(t);
    this.pendingRequests.set(t, n);
    try {
      return await n;
    } finally {
      this.pendingRequests.delete(t);
    }
  }
  static async fetchCategoryFromAPI(e) {
    const t = await r();
    if (t)
      try {
        const r = new URL(
          "/api/web/domain_info/browser_extension",
          "https://api.anthropic.com",
        );
        r.searchParams.append("domain", e);
        const o = await fetch(r.toString(), {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${t}`,
          },
        });
        if (!o.ok) return;
        const n = await o.json(),
          i = this.getEffectiveCategory(n);
        return (this.cache.set(e, { category: i, timestamp: Date.now() }), i);
      } catch (o) {
        return;
      }
  }
  static getEffectiveCategory(e) {
    return "block" === e.org_policy ? "category_org_blocked" : e.category;
  }
  static clearCache() {
    this.cache.clear();
  }
  static evictFromCache(e) {
    const t = q(e);
    this.cache.delete(t);
  }
  static getCacheSize() {
    return this.cache.size;
  }
}

// Initialize the DomainCategoryCache for TabGroupManager
setDomainCategoryCache(W);
setTabGroupManager(K);

// NOTE: TabGroupManager (class H) and related code moved to tab-group-manager.js


const Y = {
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
    execute: async (e, t) => {
      try {
        const { url: o, tabId: i } = e;
        if (!o) throw new Error("URL parameter is required");
        if (!t?.tabId) throw new Error("No active tab found");
        const a = await K.getEffectiveTabId(i, t.tabId);
        if (o && !["back", "forward"].includes(o.toLowerCase()))
          try {
            const e = await W.getCategory(o);
            if (
              e &&
              ("category1" === e ||
                "category2" === e ||
                "category_org_blocked" === e)
            ) {
              return {
                error:
                  "category_org_blocked" === e
                    ? "This site is blocked by your organization's policy."
                    : "This site is not allowed due to safety restrictions.",
              };
            }
          } catch {}
        const s = await chrome.tabs.get(a);
        if (!s.id) throw new Error("Active tab has no ID");
        if ("back" === o.toLowerCase()) {
          (await chrome.tabs.goBack(s.id),
            await new Promise((e) => setTimeout(e, 100)));
          const e = await chrome.tabs.get(s.id),
            r = await K.getValidTabsWithMetadata(t.tabId);
          return {
            output: `Navigated back to ${e.url}`,
            tabContext: {
              currentTabId: t.tabId,
              executedOnTabId: a,
              availableTabs: r,
              tabCount: r.length,
            },
          };
        }
        if ("forward" === o.toLowerCase()) {
          (await chrome.tabs.goForward(s.id),
            await new Promise((e) => setTimeout(e, 100)));
          const e = await chrome.tabs.get(s.id),
            r = await K.getValidTabsWithMetadata(t.tabId);
          return {
            output: `Navigated forward to ${e.url}`,
            tabContext: {
              currentTabId: t.tabId,
              executedOnTabId: a,
              availableTabs: r,
              tabCount: r.length,
            },
          };
        }
        let c = o;
        c.match(/^https?:\/\//) || (c = `https://${c}`);
        try {
          new URL(c);
        } catch (r) {
          throw new Error(`Invalid URL: ${o}`);
        }
        const u = t?.toolUseId,
          l = await t.permissionManager.checkPermission(c, u);
        if (!l.allowed)
          return l.needsPrompt
            ? {
                type: "permission_required",
                tool: n.NAVIGATE,
                url: c,
                toolUseId: u,
              }
            : { error: "Navigation to this domain is not allowed" };
        (await chrome.tabs.update(a, { url: c }),
          await new Promise((e) => setTimeout(e, 100)));
        const d = await K.getValidTabsWithMetadata(t.tabId);
        return {
          output: `Navigated to ${c}`,
          tabContext: {
            currentTabId: t.tabId,
            executedOnTabId: a,
            availableTabs: d,
            tabCount: d.length,
          },
        };
      } catch (o) {
        return {
          error: `Failed to navigate: ${o instanceof Error ? o.message : "Unknown error"}`,
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
// Inject TabGroupManager dependency after K is defined
setTabGroupManager(K);

function oe(e, t, r) {
  const o = r.viewportWidth / r.screenshotWidth,
    n = r.viewportHeight / r.screenshotHeight;
  return [Math.round(e * o), Math.round(t * n)];
}
async function ne(e, t, r, o, n) {
  await chrome.scripting.executeScript({
    target: { tabId: e },
    func: (e, t, r, o) => {
      const n = document.elementFromPoint(r, o);
      if (n && n !== document.body && n !== document.documentElement) {
        const r = (e) => {
          const t = window.getComputedStyle(e),
            r = t.overflowY,
            o = t.overflowX;
          return (
            ("auto" === r ||
              "scroll" === r ||
              "auto" === o ||
              "scroll" === o) &&
            (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)
          );
        };
        let o = n;
        for (; o && !r(o); ) o = o.parentElement;
        if (o && r(o))
          return void o.scrollBy({ left: e, top: t, behavior: "instant" });
      }
      window.scrollBy({ left: e, top: t, behavior: "instant" });
    },
    args: [o, n, t, r],
  });
}
const ie = {
  name: "computer",
  description:
    "Use a mouse and keyboard to interact with a web browser, and take screenshots. If you don't have a valid tab ID, use tabs_context first to get available tabs.\n* The screen's resolution is {self.display_width_px}x{self.display_height_px}.\n* Whenever you intend to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.\n* If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your click location so that the tip of the cursor visually falls on the element that you want to click.\n* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.",
  parameters: {
    action: {
      type: "string",
      enum: [
        "left_click",
        "right_click",
        "type",
        "screenshot",
        "wait",
        "scroll",
        "key",
        "left_click_drag",
        "double_click",
        "triple_click",
        "zoom",
        "scroll_to",
        "hover",
      ],
      description:
        "The action to perform:\n* `left_click`: Click the left mouse button at the specified coordinates.\n* `right_click`: Click the right mouse button at the specified coordinates to open context menus.\n* `double_click`: Double-click the left mouse button at the specified coordinates.\n* `triple_click`: Triple-click the left mouse button at the specified coordinates.\n* `type`: Type a string of text.\n* `screenshot`: Take a screenshot of the screen.\n* `wait`: Wait for a specified number of seconds.\n* `scroll`: Scroll up, down, left, or right at the specified coordinates.\n* `key`: Press a specific keyboard key.\n* `left_click_drag`: Drag from start_coordinate to coordinate.\n* `zoom`: Take a screenshot of a specific region and scale it to fill the viewport.\n* `scroll_to`: Scroll an element into view using its element reference ID from read_page or find tools.\n* `hover`: Move the mouse cursor to the specified coordinates or element without clicking. Useful for revealing tooltips, dropdown menus, or triggering hover states.",
    },
    coordinate: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
      description:
        "(x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates. Required for `scroll` and `left_click_drag`. For click actions (left_click, right_click, double_click, triple_click), either `coordinate` or `ref` must be provided (not both).",
    },
    text: {
      type: "string",
      description:
        'The text to type (for `type` action) or the key(s) to press (for `key` action). For `key` action: Provide space-separated keys (e.g., "Backspace Backspace Delete"). Supports keyboard shortcuts using the platform\'s modifier key (use "cmd" on Mac, "ctrl" on Windows/Linux, e.g., "cmd+a" or "ctrl+a" for select all).',
    },
    duration: {
      type: "number",
      minimum: 0,
      maximum: 30,
      description:
        "The number of seconds to wait. Required for `wait`. Maximum 30 seconds.",
    },
    scroll_direction: {
      type: "string",
      enum: ["up", "down", "left", "right"],
      description: "The direction to scroll. Required for `scroll`.",
    },
    scroll_amount: {
      type: "number",
      minimum: 1,
      maximum: 10,
      description:
        "The number of scroll wheel ticks. Optional for `scroll`, defaults to 3.",
    },
    start_coordinate: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
      description: "(x, y): The starting coordinates for `left_click_drag`.",
    },
    region: {
      type: "array",
      items: { type: "number" },
      minItems: 4,
      maxItems: 4,
      description:
        "(x0, y0, x1, y1): The rectangular region to capture for `zoom`. Coordinates are in pixels from the top-left corner of the viewport. Required for `zoom` action.",
    },
    repeat: {
      type: "number",
      minimum: 1,
      maximum: 100,
      description:
        "Number of times to repeat the key sequence. Only applicable for `key` action. Must be a positive integer between 1 and 100. Default is 1.",
    },
    ref: {
      type: "string",
      description:
        'Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Required for `scroll_to` action. Can be used as alternative to `coordinate` for click actions (left_click, right_click, double_click, triple_click).',
    },
    modifiers: {
      type: "string",
      description:
        'Modifier keys for click actions (left_click, right_click, double_click, triple_click). Supports: "ctrl", "shift", "alt", "cmd" (or "meta"), "win" (or "windows"). Can be combined with "+" (e.g., "ctrl+shift", "cmd+alt"). Optional.',
    },
    tabId: {
      type: "number",
      description:
        "Tab ID to execute the action on. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
    },
  },
  execute: async (e, t) => {
    try {
      const o = e || {};
      if (!o.action) throw new Error("Action parameter is required");
      if (!t?.tabId) throw new Error("No active tab found in context");
      const i = await K.getEffectiveTabId(o.tabId, t.tabId),
        a = await chrome.tabs.get(i);
      if (!a.id) throw new Error("Active tab has no ID");
      if (!["wait"].includes(o.action)) {
        const e = a.url;
        if (!e) throw new Error("No URL available for active tab");
        const s = (function (e) {
            const t = {
              screenshot: n.READ_PAGE_CONTENT,
              scroll: n.READ_PAGE_CONTENT,
              scroll_to: n.READ_PAGE_CONTENT,
              zoom: n.READ_PAGE_CONTENT,
              hover: n.READ_PAGE_CONTENT,
              left_click: n.CLICK,
              right_click: n.CLICK,
              double_click: n.CLICK,
              triple_click: n.CLICK,
              left_click_drag: n.CLICK,
              type: n.TYPE,
              key: n.TYPE,
            };
            if (!t[e]) throw new Error(`Unsupported action: ${e}`);
            return t[e];
          })(o.action),
          c = t?.toolUseId,
          u = await t.permissionManager.checkPermission(e, c);
        if (!u.allowed) {
          if (u.needsPrompt) {
            const t = {
              type: "permission_required",
              tool: s,
              url: e,
              toolUseId: c,
            };
            if (
              "left_click" === o.action ||
              "right_click" === o.action ||
              "double_click" === o.action ||
              "triple_click" === o.action
            )
              try {
                const e = await re.screenshot(i);
                ((t.actionData = {
                  screenshot: `data:image/${e.format};base64,${e.base64}`,
                }),
                  o.coordinate && (t.actionData.coordinate = o.coordinate));
              } catch (r) {
                ((t.actionData = {}),
                  o.coordinate && (t.actionData.coordinate = o.coordinate));
              }
            else
              "type" === o.action && o.text
                ? (t.actionData = { text: o.text })
                : "left_click_drag" === o.action &&
                  o.start_coordinate &&
                  o.coordinate &&
                  (t.actionData = {
                    start_coordinate: o.start_coordinate,
                    coordinate: o.coordinate,
                  });
            return t;
          }
          return { error: "Permission denied for this action on this domain" };
        }
      }
      const s = a.url;
      let c;
      switch (o.action) {
        case "left_click":
        case "right_click":
          c = await se(i, o, 1, s);
          break;
        case "type":
          c = await (async function (e, t, o) {
            if (!t.text)
              throw new Error("Text parameter is required for type action");
            try {
              const r = await F(e, o, "type action");
              return (
                r || (await re.type(e, t.text), { output: `Typed "${t.text}"` })
              );
            } catch (r) {
              return {
                error: `Failed to type: ${r instanceof Error ? r.message : "Unknown error"}`,
              };
            }
          })(i, o, s);
          break;
        case "screenshot":
          c = await ce(i);
          break;
        case "wait":
          c = await (async function (e) {
            if (!e.duration || e.duration <= 0)
              throw new Error(
                "Duration parameter is required and must be positive",
              );
            if (e.duration > 30)
              throw new Error("Duration cannot exceed 30 seconds");
            const t = Math.round(1e3 * e.duration);
            return (
              await new Promise((e) => setTimeout(e, t)),
              {
                output: `Waited for ${e.duration} second${1 === e.duration ? "" : "s"}`,
              }
            );
          })(o);
          break;
        case "scroll":
          c = await (async function (e, t, o) {
            if (!t.coordinate || 2 !== t.coordinate.length)
              throw new Error(
                "Coordinate parameter is required for scroll action",
              );
            let [n, i] = t.coordinate;
            const a = Q.getContext(e);
            if (a) {
              const [e, t] = oe(n, i, a);
              ((n = e), (i = t));
            }
            const s = t.scroll_direction || "down",
              c = t.scroll_amount || 3;
            try {
              let t = 0,
                a = 0;
              const u = 100;
              switch (s) {
                case "up":
                  a = -c * u;
                  break;
                case "down":
                  a = c * u;
                  break;
                case "left":
                  t = -c * u;
                  break;
                case "right":
                  t = c * u;
                  break;
                default:
                  throw new Error(`Invalid scroll direction: ${s}`);
              }
              const l = await ue(e),
                d = await chrome.tabs.get(e);
              if (d.active ?? !1)
                try {
                  const r = re.scrollWheel(e, n, i, t, a),
                    o = new Promise((e, t) => {
                      setTimeout(() => t(new Error("Scroll timeout")), 5e3);
                    });
                  (await Promise.race([r, o]),
                    await new Promise((e) => setTimeout(e, 200)));
                  const s = await ue(e);
                  if (!(Math.abs(s.x - l.x) > 5 || Math.abs(s.y - l.y) > 5))
                    throw new Error("CDP scroll ineffective");
                } catch (r) {
                  (await ne(e, n, i, t, a),
                    await new Promise((e) => setTimeout(e, 200)));
                }
              else
                (await ne(e, n, i, t, a),
                  await new Promise((e) => setTimeout(e, 200)));
              const h = await (async function (e, t) {
                try {
                  const r = await chrome.tabs.get(e);
                  if (!r?.url) return;
                  if ((await t.checkPermission(r.url, void 0)).allowed)
                    try {
                      const t = await ce(e);
                      return {
                        base64Image: t.base64Image,
                        imageFormat: t.imageFormat || "png",
                      };
                    } catch (o) {
                      return;
                    }
                  return;
                } catch (r) {
                  return;
                }
              })(e, o);
              return {
                output: `Scrolled ${s} by ${c} ticks at (${n}, ${i})`,
                ...(h && {
                  base64Image: h.base64Image,
                  imageFormat: h.imageFormat,
                }),
              };
            } catch (r) {
              return {
                error: `Error scrolling: ${r instanceof Error ? r.message : "Unknown error"}`,
              };
            }
          })(i, o, t.permissionManager);
          break;
        case "key":
          c = await (async function (e, t, o) {
            if (!t.text)
              throw new Error("Text parameter is required for key action");
            const n = t.repeat ?? 1;
            if (!Number.isInteger(n) || n < 1)
              throw new Error("Repeat parameter must be a positive integer");
            if (n > 100) throw new Error("Repeat parameter cannot exceed 100");
            try {
              const r = await F(e, o, "key action");
              if (r) return r;
              const i = t.text
                .trim()
                .split(/\s+/)
                .filter((e) => e.length > 0);
              if ((console.info({ keyInputs: i }), 1 === i.length)) {
                const t = i[0].toLowerCase();
                if (
                  "cmd+r" === t ||
                  "cmd+shift+r" === t ||
                  "ctrl+r" === t ||
                  "ctrl+shift+r" === t ||
                  "f5" === t ||
                  "ctrl+f5" === t ||
                  "shift+f5" === t
                ) {
                  const r =
                    "cmd+shift+r" === t ||
                    "ctrl+shift+r" === t ||
                    "ctrl+f5" === t ||
                    "shift+f5" === t;
                  await chrome.tabs.reload(e, { bypassCache: r });
                  const o = r ? "hard reload" : "reload";
                  return { output: `Executed ${i[0]} (${o} page)` };
                }
              }
              for (let t = 0; t < n; t++)
                for (const r of i)
                  if (r.includes("+")) await re.pressKeyChord(e, r);
                  else {
                    const t = re.getKeyCode(r);
                    t ? await re.pressKey(e, t) : await re.insertText(e, r);
                  }
              const a = n > 1 ? ` (repeated ${n} times)` : "";
              return {
                output: `Pressed ${i.length} key${1 === i.length ? "" : "s"}: ${i.join(" ")}${a}`,
              };
            } catch (r) {
              return {
                error: `Error pressing key: ${r instanceof Error ? r.message : "Unknown error"}`,
              };
            }
          })(i, o, s);
          break;
        case "left_click_drag":
          c = await (async function (e, t, o) {
            if (!t.start_coordinate || 2 !== t.start_coordinate.length)
              throw new Error(
                "start_coordinate parameter is required for left_click_drag action",
              );
            if (!t.coordinate || 2 !== t.coordinate.length)
              throw new Error(
                "coordinate parameter (end position) is required for left_click_drag action",
              );
            let [n, i] = t.start_coordinate,
              [a, s] = t.coordinate;
            const c = Q.getContext(e);
            if (c) {
              const [e, t] = oe(n, i, c),
                [r, o] = oe(a, s, c);
              ((n = e), (i = t), (a = r), (s = o));
            }
            try {
              const t = await F(e, o, "drag action");
              return (
                t ||
                (await re.dispatchMouseEvent(e, {
                  type: "mouseMoved",
                  x: n,
                  y: i,
                  button: "none",
                  buttons: 0,
                  modifiers: 0,
                }),
                await re.dispatchMouseEvent(e, {
                  type: "mousePressed",
                  x: n,
                  y: i,
                  button: "left",
                  buttons: 1,
                  clickCount: 1,
                  modifiers: 0,
                }),
                await re.dispatchMouseEvent(e, {
                  type: "mouseMoved",
                  x: a,
                  y: s,
                  button: "left",
                  buttons: 1,
                  modifiers: 0,
                }),
                await re.dispatchMouseEvent(e, {
                  type: "mouseReleased",
                  x: a,
                  y: s,
                  button: "left",
                  buttons: 0,
                  clickCount: 1,
                  modifiers: 0,
                }),
                { output: `Dragged from (${n}, ${i}) to (${a}, ${s})` })
              );
            } catch (r) {
              return {
                error: `Error performing drag: ${r instanceof Error ? r.message : "Unknown error"}`,
              };
            }
          })(i, o, s);
          break;
        case "double_click":
          c = await se(i, o, 2, s);
          break;
        case "triple_click":
          c = await se(i, o, 3, s);
          break;
        case "zoom":
          c = await (async function (e, t) {
            if (!t.region || 4 !== t.region.length)
              throw new Error(
                "Region parameter is required for zoom action and must be [x0, y0, x1, y1]",
              );
            let [o, n, i, a] = t.region;
            if (o < 0 || n < 0 || i <= o || a <= n)
              throw new Error(
                "Invalid region coordinates: x0 and y0 must be non-negative, and x1 > x0, y1 > y0",
              );
            try {
              const t = Q.getContext(e);
              if (t) {
                const [e, r] = oe(o, n, t),
                  [s, c] = oe(i, a, t);
                ((o = e), (n = r), (i = s), (a = c));
              }
              const r = await chrome.scripting.executeScript({
                target: { tabId: e },
                func: () => ({
                  width: window.innerWidth,
                  height: window.innerHeight,
                }),
              });
              if (!r || !r[0]?.result)
                throw new Error("Failed to get viewport dimensions");
              const { width: s, height: c } = r[0].result;
              if (i > s || a > c)
                throw new Error(
                  `Region exceeds viewport boundaries (${s}x${c}). Please choose a region within the visible viewport.`,
                );
              const u = i - o,
                l = a - n,
                d = await re.sendCommand(e, "Page.captureScreenshot", {
                  format: "png",
                  captureBeyondViewport: !1,
                  fromSurface: !0,
                  clip: { x: o, y: n, width: u, height: l, scale: 1 },
                });
              if (!d || !d.data)
                throw new Error("Failed to capture zoomed screenshot via CDP");
              return {
                output: `Successfully captured zoomed screenshot of region (${o},${n}) to (${i},${a}) - ${u}x${l} pixels`,
                base64Image: d.data,
                imageFormat: "png",
              };
            } catch (r) {
              return {
                error: `Error capturing zoomed screenshot: ${r instanceof Error ? r.message : "Unknown error"}`,
              };
            }
          })(i, o);
          break;
        case "scroll_to":
          c = await (async function (e, t, o) {
            if (!t.ref)
              throw new Error("ref parameter is required for scroll_to action");
            try {
              const r = await F(e, o, "scroll_to action");
              if (r) return r;
              const n = await ae(e, t.ref);
              return n.success
                ? { output: `Scrolled to element with reference: ${t.ref}` }
                : { error: n.error };
            } catch (r) {
              return {
                error: `Failed to scroll to element: ${r instanceof Error ? r.message : "Unknown error"}`,
              };
            }
          })(i, o, s);
          break;
        case "hover":
          c = await (async function (e, t, o) {
            let n, i;
            if (t.ref) {
              const r = await ae(e, t.ref);
              if (!r.success) return { error: r.error };
              [n, i] = r.coordinates;
            } else {
              if (!t.coordinate)
                throw new Error(
                  "Either ref or coordinate parameter is required for hover action",
                );
              {
                [n, i] = t.coordinate;
                const r = Q.getContext(e);
                if (r) {
                  const [e, t] = oe(n, i, r);
                  ((n = e), (i = t));
                }
              }
            }
            try {
              const r = await F(e, o, "hover action");
              return (
                r ||
                (await re.dispatchMouseEvent(e, {
                  type: "mouseMoved",
                  x: n,
                  y: i,
                  button: "none",
                  buttons: 0,
                  modifiers: 0,
                }),
                t.ref
                  ? { output: `Hovered over element ${t.ref}` }
                  : {
                      output: `Hovered at (${Math.round(t.coordinate[0])}, ${Math.round(t.coordinate[1])})`,
                    })
              );
            } catch (r) {
              return {
                error: `Error hovering: ${r instanceof Error ? r.message : "Unknown error"}`,
              };
            }
          })(i, o, s);
          break;
        default:
          throw new Error(`Unsupported action: ${o.action}`);
      }
      const u = await K.getValidTabsWithMetadata(t.tabId);
      return {
        ...c,
        tabContext: {
          currentTabId: t.tabId,
          executedOnTabId: i,
          availableTabs: u,
          tabCount: u.length,
        },
      };
    } catch (r) {
      return {
        error: `Failed to execute action: ${r instanceof Error ? r.message : "Unknown error"}`,
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
            "left_click",
            "right_click",
            "type",
            "screenshot",
            "wait",
            "scroll",
            "key",
            "left_click_drag",
            "double_click",
            "triple_click",
            "zoom",
            "scroll_to",
            "hover",
          ],
          description:
            "The action to perform:\n* `left_click`: Click the left mouse button at the specified coordinates.\n* `right_click`: Click the right mouse button at the specified coordinates to open context menus.\n* `double_click`: Double-click the left mouse button at the specified coordinates.\n* `triple_click`: Triple-click the left mouse button at the specified coordinates.\n* `type`: Type a string of text.\n* `screenshot`: Take a screenshot of the screen.\n* `wait`: Wait for a specified number of seconds.\n* `scroll`: Scroll up, down, left, or right at the specified coordinates.\n* `key`: Press a specific keyboard key.\n* `left_click_drag`: Drag from start_coordinate to coordinate.\n* `zoom`: Take a screenshot of a specific region for closer inspection.\n* `scroll_to`: Scroll an element into view using its element reference ID from read_page or find tools.\n* `hover`: Move the mouse cursor to the specified coordinates or element without clicking. Useful for revealing tooltips, dropdown menus, or triggering hover states.",
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description:
            "(x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates. Required for `left_click`, `right_click`, `double_click`, `triple_click`, and `scroll`. For `left_click_drag`, this is the end position.",
        },
        text: {
          type: "string",
          description:
            'The text to type (for `type` action) or the key(s) to press (for `key` action). For `key` action: Provide space-separated keys (e.g., "Backspace Backspace Delete"). Supports keyboard shortcuts using the platform\'s modifier key (use "cmd" on Mac, "ctrl" on Windows/Linux, e.g., "cmd+a" or "ctrl+a" for select all).',
        },
        duration: {
          type: "number",
          minimum: 0,
          maximum: 30,
          description:
            "The number of seconds to wait. Required for `wait`. Maximum 30 seconds.",
        },
        scroll_direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "The direction to scroll. Required for `scroll`.",
        },
        scroll_amount: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description:
            "The number of scroll wheel ticks. Optional for `scroll`, defaults to 3.",
        },
        start_coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description:
            "(x, y): The starting coordinates for `left_click_drag`.",
        },
        region: {
          type: "array",
          items: { type: "number" },
          minItems: 4,
          maxItems: 4,
          description:
            "(x0, y0, x1, y1): The rectangular region to capture for `zoom`. Coordinates define a rectangle from top-left (x0, y0) to bottom-right (x1, y1) in pixels from the viewport origin. Required for `zoom` action. Useful for inspecting small UI elements like icons, buttons, or text.",
        },
        repeat: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description:
            "Number of times to repeat the key sequence. Only applicable for `key` action. Must be a positive integer between 1 and 100. Default is 1. Useful for navigation tasks like pressing arrow keys multiple times.",
        },
        ref: {
          type: "string",
          description:
            'Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Required for `scroll_to` action. Can be used as alternative to `coordinate` for click actions.',
        },
        modifiers: {
          type: "string",
          description:
            'Modifier keys for click actions. Supports: "ctrl", "shift", "alt", "cmd" (or "meta"), "win" (or "windows"). Can be combined with "+" (e.g., "ctrl+shift", "cmd+alt"). Optional.',
        },
        tabId: {
          type: "number",
          description:
            "Tab ID to execute the action on. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        },
      },
      required: ["action", "tabId"],
    },
  }),
};
async function ae(e, t) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: e },
      func: (e) => {
        try {
          let t = null;
          if (window.__claudeElementMap && window.__claudeElementMap[e]) {
            ((t = window.__claudeElementMap[e].deref() || null),
              (t && document.contains(t)) ||
                (delete window.__claudeElementMap[e], (t = null)));
          }
          if (!t)
            return {
              success: !1,
              error: `No element found with reference: "${e}". The element may have been removed from the page.`,
            };
          (t.scrollIntoView({
            behavior: "instant",
            block: "center",
            inline: "center",
          }),
            t instanceof HTMLElement && t.offsetHeight);
          const r = t.getBoundingClientRect(),
            o = r.left + r.width / 2;
          return { success: !0, coordinates: [o, r.top + r.height / 2] };
        } catch (t) {
          return {
            success: !1,
            error: `Error getting element coordinates: ${t instanceof Error ? t.message : "Unknown error"}`,
          };
        }
      },
      args: [t],
    });
    return r && 0 !== r.length
      ? r[0].result
      : {
          success: !1,
          error: "Failed to execute script to get element coordinates",
        };
  } catch (r) {
    return {
      success: !1,
      error: `Failed to get element coordinates from ref: ${r instanceof Error ? r.message : "Unknown error"}`,
    };
  }
}
async function se(e, t, r = 1, o) {
  let n, i;
  if (t.ref) {
    const r = await ae(e, t.ref);
    if (!r.success) return { error: r.error };
    [n, i] = r.coordinates;
  } else {
    if (!t.coordinate)
      throw new Error(
        "Either ref or coordinate parameter is required for click action",
      );
    {
      [n, i] = t.coordinate;
      const r = Q.getContext(e);
      if (r) {
        const [e, t] = oe(n, i, r);
        ((n = e), (i = t));
      }
    }
  }
  const a = "right_click" === t.action ? "right" : "left";
  let s = 0;
  if (t.modifiers) {
    s = (function (e) {
      const t = {
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
      let r = 0;
      for (const o of e) r |= t[o] || 0;
      return r;
    })(
      (function (e) {
        const t = e.toLowerCase().split("+"),
          r = [
            "ctrl",
            "control",
            "alt",
            "shift",
            "cmd",
            "meta",
            "command",
            "win",
            "windows",
          ];
        return t.filter((e) => r.includes(e.trim()));
      })(t.modifiers),
    );
  }
  try {
    const c = await F(e, o, "click action");
    if (c) return c;
    await re.click(e, n, i, a, r, s);
    const u =
      1 === r ? "Clicked" : 2 === r ? "Double-clicked" : "Triple-clicked";
    return t.ref
      ? { output: `${u} on element ${t.ref}` }
      : {
          output: `${u} at (${Math.round(t.coordinate[0])}, ${Math.round(t.coordinate[1])})`,
        };
  } catch (c) {
    return {
      error: `Error clicking: ${c instanceof Error ? c.message : "Unknown error"}`,
    };
  }
}
async function ce(t) {
  try {
    const r = await re.screenshot(t),
      o = e();
    return (
      console.info(`[Computer Tool] Generated screenshot ID: ${o}`),
      console.info(
        `[Computer Tool] Screenshot dimensions: ${r.width}x${r.height}`,
      ),
      {
        output: `Successfully captured screenshot (${r.width}x${r.height}, ${r.format}) - ID: ${o}`,
        base64Image: r.base64,
        imageFormat: r.format,
        imageId: o,
      }
    );
  } catch (r) {
    return {
      error: `Error capturing screenshot: ${r instanceof Error ? r.message : "Unknown error"}`,
    };
  }
}
async function ue(e) {
  const t = await chrome.scripting.executeScript({
    target: { tabId: e },
    func: () => ({
      x: window.pageXOffset || document.documentElement.scrollLeft,
      y: window.pageYOffset || document.documentElement.scrollTop,
    }),
  });
  if (!t || !t[0]?.result) throw new Error("Failed to get scroll position");
  return t[0].result;
}
const le = {
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
    execute: async (e, t) => {
      const {
        filter: r,
        tabId: o,
        depth: i,
        ref_id: a,
        max_chars: s,
      } = e || {};
      if (!t?.tabId) throw new Error("No active tab found");
      const c = await K.getEffectiveTabId(o, t.tabId),
        u = await chrome.tabs.get(c);
      if (!u.id) throw new Error("Active tab has no ID");
      const l = u.url;
      if (!l) throw new Error("No URL available for active tab");
      const d = t?.toolUseId,
        h = await t.permissionManager.checkPermission(l, d);
      if (!h.allowed) {
        if (h.needsPrompt) {
          return {
            type: "permission_required",
            tool: n.READ_PAGE_CONTENT,
            url: l,
            toolUseId: d,
          };
        }
        return { error: "Permission denied for reading pages on this domain" };
      }
      (await K.hideIndicatorForToolUse(c),
        await new Promise((e) => setTimeout(e, 50)));
      try {
        const e = await chrome.scripting.executeScript({
          target: { tabId: u.id },
          func: (e, t, r, o) => {
            if ("function" != typeof window.__generateAccessibilityTree)
              throw new Error(
                "Accessibility tree function not found. Please refresh the page.",
              );
            return window.__generateAccessibilityTree(e, t, r, o);
          },
          args: [r || null, i ?? null, s ?? 5e4, a ?? null],
        });
        if (!e || 0 === e.length)
          throw new Error("No results returned from page script");
        if ("error" in e[0] && e[0].error)
          throw new Error(
            `Script execution failed: ${e[0].error.message || "Unknown error"}`,
          );
        if (!e[0].result) throw new Error("Page script returned empty result");
        const o = e[0].result;
        if (o.error) return { error: o.error };
        if (!e[0].result) throw new Error("Page script returned empty result");
        const n = `Viewport: ${o.viewport.width}x${o.viewport.height}`,
          l = await K.getValidTabsWithMetadata(t.tabId);
        return {
          output: `${o.pageContent}\n\n${n}`,
          tabContext: {
            currentTabId: t.tabId,
            executedOnTabId: c,
            availableTabs: l,
            tabCount: l.length,
          },
        };
      } catch (p) {
        return {
          error: `Failed to read page: ${p instanceof Error ? p.message : "Unknown error"}`,
        };
      } finally {
        await K.restoreIndicatorAfterToolUse(c);
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
  },
  de = {
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
    execute: async (e, t) => {
      try {
        const r = e;
        if (!r?.ref) throw new Error("ref parameter is required");
        if (void 0 === r.value || null === r.value)
          throw new Error("Value parameter is required");
        if (!t?.tabId) throw new Error("No active tab found");
        const o = await K.getEffectiveTabId(r.tabId, t.tabId),
          i = await chrome.tabs.get(o);
        if (!i.id) throw new Error("Active tab has no ID");
        const a = i.url;
        if (!a) throw new Error("No URL available for active tab");
        const s = t?.toolUseId,
          c = await t.permissionManager.checkPermission(a, s);
        if (!c.allowed) {
          if (c.needsPrompt) {
            return {
              type: "permission_required",
              tool: n.TYPE,
              url: a,
              toolUseId: s,
              actionData: { ref: r.ref, value: r.value },
            };
          }
          return { error: "Permission denied for form input on this domain" };
        }
        const u = i.url;
        if (!u)
          return { error: "Unable to get original URL for security check" };
        const l = await F(i.id, u, "form input action");
        if (l) return l;
        const d = await chrome.scripting.executeScript({
          target: { tabId: i.id },
          func: (e, t) => {
            try {
              let r = null;
              if (window.__claudeElementMap && window.__claudeElementMap[e]) {
                ((r = window.__claudeElementMap[e].deref() || null),
                  (r && document.contains(r)) ||
                    (delete window.__claudeElementMap[e], (r = null)));
              }
              if (!r)
                return {
                  error: `No element found with reference: "${e}". The element may have been removed from the page.`,
                };
              if (
                (r.scrollIntoView({ behavior: "smooth", block: "center" }),
                r instanceof HTMLSelectElement)
              ) {
                const e = r.value,
                  o = Array.from(r.options);
                let n = !1;
                const i = String(t);
                for (let t = 0; t < o.length; t++)
                  if (o[t].value === i || o[t].text === i) {
                    ((r.selectedIndex = t), (n = !0));
                    break;
                  }
                return n
                  ? (r.focus(),
                    r.dispatchEvent(new Event("change", { bubbles: !0 })),
                    r.dispatchEvent(new Event("input", { bubbles: !0 })),
                    {
                      output: `Selected option "${i}" in dropdown (previous: "${e}")`,
                    })
                  : {
                      error: `Option "${i}" not found. Available options: ${o.map((e) => `"${e.text}" (value: "${e.value}")`).join(", ")}`,
                    };
              }
              if (r instanceof HTMLInputElement && "checkbox" === r.type) {
                const e = r.checked;
                return "boolean" != typeof t
                  ? { error: "Checkbox requires a boolean value (true/false)" }
                  : ((r.checked = t),
                    r.focus(),
                    r.dispatchEvent(new Event("change", { bubbles: !0 })),
                    r.dispatchEvent(new Event("input", { bubbles: !0 })),
                    {
                      output: `Checkbox ${r.checked ? "checked" : "unchecked"} (previous: ${e})`,
                    });
              }
              if (r instanceof HTMLInputElement && "radio" === r.type) {
                const t = r.checked,
                  o = r.name;
                return (
                  (r.checked = !0),
                  r.focus(),
                  r.dispatchEvent(new Event("change", { bubbles: !0 })),
                  r.dispatchEvent(new Event("input", { bubbles: !0 })),
                  {
                    success: !0,
                    action: "form_input",
                    ref: e,
                    element_type: "radio",
                    previous_value: t,
                    new_value: r.checked,
                    message:
                      "Radio button selected" + (o ? ` in group "${o}"` : ""),
                  }
                );
              }
              if (
                r instanceof HTMLInputElement &&
                ("date" === r.type ||
                  "time" === r.type ||
                  "datetime-local" === r.type ||
                  "month" === r.type ||
                  "week" === r.type)
              ) {
                const e = r.value;
                return (
                  (r.value = String(t)),
                  r.focus(),
                  r.dispatchEvent(new Event("change", { bubbles: !0 })),
                  r.dispatchEvent(new Event("input", { bubbles: !0 })),
                  { output: `Set ${r.type} to "${r.value}" (previous: ${e})` }
                );
              }
              if (r instanceof HTMLInputElement && "range" === r.type) {
                const o = r.value,
                  n = Number(t);
                return isNaN(n)
                  ? { error: "Range input requires a numeric value" }
                  : ((r.value = String(n)),
                    r.focus(),
                    r.dispatchEvent(new Event("change", { bubbles: !0 })),
                    r.dispatchEvent(new Event("input", { bubbles: !0 })),
                    {
                      success: !0,
                      action: "form_input",
                      ref: e,
                      element_type: "range",
                      previous_value: o,
                      new_value: r.value,
                      message: `Set range to ${r.value} (min: ${r.min}, max: ${r.max})`,
                    });
              }
              if (r instanceof HTMLInputElement && "number" === r.type) {
                const e = r.value,
                  o = Number(t);
                return isNaN(o) && "" !== t
                  ? { error: "Number input requires a numeric value" }
                  : ((r.value = String(t)),
                    r.focus(),
                    r.dispatchEvent(new Event("change", { bubbles: !0 })),
                    r.dispatchEvent(new Event("input", { bubbles: !0 })),
                    {
                      output: `Set number input to ${r.value} (previous: ${e})`,
                    });
              }
              if (
                r instanceof HTMLInputElement ||
                r instanceof HTMLTextAreaElement
              ) {
                const e = r.value;
                ((r.value = String(t)), r.focus());
                ((r instanceof HTMLTextAreaElement ||
                  (r instanceof HTMLInputElement &&
                    ["text", "search", "url", "tel", "password"].includes(
                      r.type,
                    ))) &&
                  r.setSelectionRange(r.value.length, r.value.length),
                  r.dispatchEvent(new Event("change", { bubbles: !0 })),
                  r.dispatchEvent(new Event("input", { bubbles: !0 })));
                return {
                  output: `Set ${r instanceof HTMLTextAreaElement ? "textarea" : r.type || "text"} value to "${r.value}" (previous: "${e}")`,
                };
              }
              return {
                error: `Element type "${r.tagName}" is not a supported form input`,
              };
            } catch (r) {
              return {
                error: `Error setting form value: ${r instanceof Error ? r.message : "Unknown error"}`,
              };
            }
          },
          args: [r.ref, r.value],
        });
        if (!d || 0 === d.length)
          throw new Error("Failed to execute form input");
        const h = await K.getValidTabsWithMetadata(t.tabId);
        return {
          ...d[0].result,
          tabContext: {
            currentTabId: t.tabId,
            executedOnTabId: o,
            availableTabs: h,
            tabCount: h.length,
          },
        };
      } catch (r) {
        return {
          error: `Failed to execute form input: ${r instanceof Error ? r.message : "Unknown error"}`,
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
  },
  he = {
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
    execute: async (e, t) => {
      const { tabId: r, max_chars: o } = e || {};
      if (!t?.tabId) throw new Error("No active tab found");
      const i = await K.getEffectiveTabId(r, t.tabId),
        a = (await chrome.tabs.get(i)).url;
      if (!a) throw new Error("No URL available for active tab");
      const s = t?.toolUseId,
        c = await t.permissionManager.checkPermission(a, s);
      if (!c.allowed) {
        if (c.needsPrompt) {
          return {
            type: "permission_required",
            tool: n.READ_PAGE_CONTENT,
            url: a,
            toolUseId: s,
          };
        }
        return {
          error: "Permission denied for reading page content on this domain",
        };
      }
      (await K.hideIndicatorForToolUse(i),
        await new Promise((e) => setTimeout(e, 50)));
      try {
        const e = await chrome.scripting.executeScript({
          target: { tabId: i },
          func: (e) =>
            (function () {
              const t = [
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
              let r = null;
              for (const e of t) {
                const t = document.querySelectorAll(e);
                if (t.length > 0) {
                  let e = t[0],
                    o = 0;
                  (t.forEach((t) => {
                    const r = t.textContent?.length || 0;
                    r > o && ((o = r), (e = t));
                  }),
                    (r = e));
                  break;
                }
              }
              if (!r) {
                if ((document.body.textContent || "").length > e)
                  return {
                    text: "",
                    source: "none",
                    title: document.title,
                    url: window.location.href,
                    error:
                      "No semantic content element found and page body is too large (likely contains CSS/scripts). Try using read_page_content (screenshot) instead.",
                  };
                r = document.body;
              }
              const o = (r.textContent || "")
                .replace(/\s+/g, " ")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
              return !o || o.length < 10
                ? {
                    text: "",
                    source: "none",
                    title: document.title,
                    url: window.location.href,
                    error:
                      "No text content found. Page may contain only images, videos, or canvas-based content.",
                  }
                : o.length > e
                  ? {
                      text: "",
                      source: r.tagName.toLowerCase(),
                      title: document.title,
                      url: window.location.href,
                      error:
                        "Output exceeds " +
                        e +
                        " character limit (" +
                        o.length +
                        " characters). Try using read_page with a specific ref_id to focus on a smaller section, or increase max_chars if your client can handle larger outputs.",
                    }
                  : {
                      text: o,
                      source: r.tagName.toLowerCase(),
                      title: document.title,
                      url: window.location.href,
                    };
            })(),
          args: [o ?? 5e4],
        });
        if (!e || 0 === e.length)
          throw new Error(
            "No main text content found. The content might be visual content only, or rendered in a canvas element.",
          );
        if ("error" in e[0] && e[0].error)
          throw new Error(
            `Script execution failed: ${e[0].error.message || "Unknown error"}`,
          );
        if (!e[0].result) throw new Error("Page script returned empty result");
        const r = e[0].result,
          n = await K.getValidTabsWithMetadata(t.tabId);
        return r.error
          ? {
              error: r.error,
              tabContext: {
                currentTabId: t.tabId,
                executedOnTabId: i,
                availableTabs: n,
                tabCount: n.length,
              },
            }
          : {
              output: `Title: ${r.title}\nURL: ${r.url}\nSource element: <${r.source}>\n---\n${r.text}`,
              tabContext: {
                currentTabId: t.tabId,
                executedOnTabId: i,
                availableTabs: n,
                tabCount: n.length,
              },
            };
      } catch (u) {
        return {
          error: `Failed to extract page text: ${u instanceof Error ? u.message : "Unknown error"}`,
        };
      } finally {
        await K.restoreIndicatorAfterToolUse(i);
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
  },
// pe (find tool) removed - now handled by MCP server
  fe = "mcp-native-session";
const me = {
    name: "tabs_context",
    description:
      "Get context information about all tabs in the current tab group",
    parameters: {},
    execute: async (e, t) => {
      try {
        if (!t?.tabId) throw new Error("No active tab found");
        const e = t.sessionId === fe,
          r = await K.getValidTabsWithMetadata(t.tabId),
          o = { currentTabId: t.tabId, availableTabs: r, tabCount: r.length };
        let n;
        e &&
          (n = await (async function (e) {
            try {
              const t = await chrome.tabs.get(e);
              if (t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
                return t.groupId;
            } catch (t) {}
          })(t.tabId));
        const i = R(r, n);
        return void 0 !== n
          ? { output: i, tabContext: { ...o, tabGroupId: n } }
          : { output: i, tabContext: o };
      } catch (r) {
        return {
          error: `Failed to query tabs: ${r instanceof Error ? r.message : "Unknown error"}`,
        };
      }
    },
    toAnthropicSchema: async () => ({
      name: "tabs_context",
      description:
        "Get context information about all tabs in the current tab group",
      input_schema: { type: "object", properties: {}, required: [] },
    }),
  },
  ge = {
    name: "tabs_create",
    description: "Creates a new empty tab in the current tab group",
    parameters: {},
    execute: async (e, t) => {
      try {
        if (!t?.tabId) throw new Error("No active tab found");
        const e = await chrome.tabs.get(t.tabId),
          r = await chrome.tabs.create({ url: "chrome://newtab", active: !1 });
        if (!r.id) throw new Error("Failed to create tab - no tab ID returned");
        e.groupId &&
          e.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE &&
          (await chrome.tabs.group({ tabIds: r.id, groupId: e.groupId }));
        const o = await K.getValidTabsWithMetadata(t.tabId);
        return {
          output: `Created new tab. Tab ID: ${r.id}`,
          tabContext: {
            currentTabId: t.tabId,
            executedOnTabId: r.id,
            availableTabs: o,
            tabCount: o.length,
          },
        };
      } catch (r) {
        return {
          error: `Failed to create tab: ${r instanceof Error ? r.message : "Unknown error"}`,
        };
      }
    },
    toAnthropicSchema: async () => ({
      name: "tabs_create",
      description: "Creates a new empty tab in the current tab group",
      input_schema: { type: "object", properties: {}, required: [] },
    }),
  };
function be(e, t) {
  return "follow_a_plan" === e && !t;
}
function we() {
  return "<system-reminder>You are in planning mode. Before executing any tools, you must first present a plan to the user using the update_plan tool. The plan should include: domains (list of domains you will visit) and approach (high-level steps you will take).</system-reminder>";
}
async function ye(e, t) {
  if (!e || 0 === e.length) return [];
  const { approved: r, filtered: o } = await (async function (e) {
    const t = [],
      r = [];
    for (const n of e)
      try {
        const e = n.startsWith("http") ? n : `https://${n}`,
          o = await W.getCategory(e);
        !o ||
        ("category1" !== o && "category2" !== o && "category_org_blocked" !== o)
          ? t.push(n)
          : r.push(n);
      } catch (o) {
        t.push(n);
      }
    return { approved: t, filtered: r };
  })(e);
  return (o.length, t.setTurnApprovedDomains(r), r);
}
const ve = {
  type: "object",
  properties: {
    domains: {
      type: "array",
      items: { type: "string" },
      description:
        "List of domains you will visit (e.g., ['github.com', 'stackoverflow.com']). These domains will be approved for the session when the user accepts the plan.",
    },
    approach: {
      type: "array",
      items: { type: "string" },
      description:
        "High-level description of what you will do. Focus on outcomes and key actions, not implementation details. Be concise - aim for 3-7 items.",
    },
  },
  required: ["domains", "approach"],
};
const Ie = {
    name: "update_plan",
    description:
      "Present a plan to the user for approval before taking actions. The user will see the domains you intend to visit and your approach. Once approved, you can proceed with actions on the approved domains without additional permission prompts.",
    parameters: ve,
    async execute(e, t) {
      const r = (function (e) {
        const t = e,
          r = {};
        return (
          (t.domains && Array.isArray(t.domains)) ||
            (r.domains = "Required field missing or not an array"),
          (t.approach && Array.isArray(t.approach)) ||
            (r.approach = "Required field missing or not an array"),
          Object.keys(r).length > 0
            ? {
                error: {
                  type: "validation_error",
                  message:
                    "Invalid plan format. Both 'domains' and 'approach' are required arrays.",
                  fields: r,
                },
              }
            : null
        );
      })(e);
      if (r) return { error: JSON.stringify(r.error) };
      const { domains: o, approach: i } = e,
        a = await (async function (e) {
          const t = [];
          for (const o of e)
            try {
              const e = o.startsWith("http") ? o : `https://${o}`,
                r = await W.getCategory(e);
              t.push({ domain: o, category: r });
            } catch (r) {
              t.push({ domain: o });
            }
          return t;
        })(o);
      return {
        type: "permission_required",
        tool: n.PLAN_APPROVAL,
        url: "",
        toolUseId: t?.toolUseId,
        actionData: { plan: { domains: a, approach: i } },
      };
    },
    setPromptsConfig(e) {
      if (
        (e.toolDescription && (this.description = e.toolDescription),
        e.inputPropertyDescriptions)
      ) {
        const t = ve.properties;
        (e.inputPropertyDescriptions.domains &&
          (t.domains.description = e.inputPropertyDescriptions.domains),
          e.inputPropertyDescriptions.approach &&
            (t.approach.description = e.inputPropertyDescriptions.approach));
      }
    },
    toAnthropicSchema() {
      return {
        type: "custom",
        name: this.name,
        description: this.description,
        input_schema: ve,
      };
    },
  },
  Te = {
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
        description:
          'Optional filename for the uploaded file (default: "image.png")',
      },
    },
    execute: async (e, t) => {
      try {
        const r = e;
        if (!r?.imageId) throw new Error("imageId parameter is required");
        if (!r?.ref && !r?.coordinate)
          throw new Error(
            "Either ref or coordinate parameter is required. Provide ref for targeting specific elements or coordinate for drag & drop to a location.",
          );
        if (r?.ref && r?.coordinate)
          throw new Error(
            "Provide either ref or coordinate, not both. Use ref for specific elements or coordinate for drag & drop.",
          );
        if (!t?.tabId) throw new Error("No active tab found");
        const o = await K.getEffectiveTabId(r.tabId, t.tabId),
          i = await chrome.tabs.get(o);
        if (!i.id) throw new Error("Upload tab has no ID");
        const a = i.url;
        if (!a) throw new Error("No URL available for upload tab");
        const s = t?.toolUseId,
          c = await t.permissionManager.checkPermission(a, s);
        if (!c.allowed) {
          if (c.needsPrompt) {
            return {
              type: "permission_required",
              tool: n.UPLOAD_IMAGE,
              url: a,
              toolUseId: s,
              actionData: {
                ref: r.ref,
                coordinate: r.coordinate,
                imageId: r.imageId,
              },
            };
          }
          return { error: "Permission denied for uploading to this domain" };
        }
        const u = i.url;
        if (!u)
          return { error: "Unable to get original URL for security check" };
        if (!t.messages)
          return {
            error: "Unable to access message history to retrieve image",
          };
        (console.info(`[Upload-Image] Looking for image with ID: ${r.imageId}`),
          console.info(
            `[Upload-Image] Messages available: ${t.messages.length}`,
          ));
        const l = $(t.messages, r.imageId);
        if (!l)
          return {
            error: `Image not found with ID: ${r.imageId}. Please ensure the image was captured or uploaded earlier in this conversation.`,
          };
        const d = l.base64,
          h = await F(i.id, u, "upload image action");
        if (h) return h;
        const p = await chrome.scripting.executeScript({
          target: { tabId: i.id },
          func: (e, t, r, o) => {
            try {
              let n = null;
              if (t) {
                if (((n = document.elementFromPoint(t[0], t[1])), !n))
                  return {
                    error: `No element found at coordinates (${t[0]}, ${t[1]})`,
                  };
                if ("IFRAME" === n.tagName)
                  try {
                    const e = n,
                      r =
                        e.contentDocument ||
                        (e.contentWindow ? e.contentWindow.document : null);
                    if (r) {
                      const o = e.getBoundingClientRect(),
                        i = t[0] - o.left,
                        a = t[1] - o.top,
                        s = r.elementFromPoint(i, a);
                      s && (n = s);
                    }
                  } catch {}
              } else {
                if (!e)
                  return {
                    error: "Neither coordinate nor elementRef provided",
                  };
                if (window.__claudeElementMap && window.__claudeElementMap[e]) {
                  ((n = window.__claudeElementMap[e].deref() || null),
                    (n && document.contains(n)) ||
                      (delete window.__claudeElementMap[e], (n = null)));
                }
                if (!n)
                  return {
                    error: `No element found with reference: "${e}". The element may have been removed from the page.`,
                  };
              }
              n.scrollIntoView({ behavior: "smooth", block: "center" });
              const i = atob(r),
                a = new Array(i.length);
              for (let e = 0; e < i.length; e++) a[e] = i.charCodeAt(e);
              const s = new Uint8Array(a),
                c = new Blob([s], { type: "image/png" }),
                u = new File([c], o, {
                  type: "image/png",
                  lastModified: Date.now(),
                }),
                l = new DataTransfer();
              l.items.add(u);
              if ("INPUT" === n.tagName && "file" === n.type) {
                const e = n;
                ((e.files = l.files),
                  e.focus(),
                  e.dispatchEvent(new Event("change", { bubbles: !0 })),
                  e.dispatchEvent(new Event("input", { bubbles: !0 })));
                const t = new CustomEvent("filechange", {
                  bubbles: !0,
                  detail: { files: l.files },
                });
                return (
                  e.dispatchEvent(t),
                  {
                    output: `Successfully uploaded image "${o}" (${Math.round(c.size / 1024)}KB) to file input`,
                  }
                );
              }
              {
                let e, r;
                if ((n.focus(), t)) ((e = t[0]), (r = t[1]));
                else {
                  const t = n.getBoundingClientRect();
                  ((e = t.left + t.width / 2), (r = t.top + t.height / 2));
                }
                const i = new DragEvent("dragenter", {
                  bubbles: !0,
                  cancelable: !0,
                  dataTransfer: l,
                  clientX: e,
                  clientY: r,
                  screenX: e + window.screenX,
                  screenY: r + window.screenY,
                });
                n.dispatchEvent(i);
                const a = new DragEvent("dragover", {
                  bubbles: !0,
                  cancelable: !0,
                  dataTransfer: l,
                  clientX: e,
                  clientY: r,
                  screenX: e + window.screenX,
                  screenY: r + window.screenY,
                });
                n.dispatchEvent(a);
                const s = new DragEvent("drop", {
                  bubbles: !0,
                  cancelable: !0,
                  dataTransfer: l,
                  clientX: e,
                  clientY: r,
                  screenX: e + window.screenX,
                  screenY: r + window.screenY,
                });
                return (
                  n.dispatchEvent(s),
                  {
                    output: `Successfully dropped image "${o}" (${Math.round(c.size / 1024)}KB) onto element at (${Math.round(e)}, ${Math.round(r)})`,
                  }
                );
              }
            } catch (n) {
              return {
                error: `Error uploading image: ${n instanceof Error ? n.message : "Unknown error"}`,
              };
            }
          },
          args: [
            r.ref || null,
            r.coordinate || null,
            d,
            r.filename || "image.png",
          ],
        });
        if (!p || 0 === p.length)
          throw new Error("Failed to execute upload image");
        const f = await K.getValidTabsWithMetadata(t.tabId);
        return {
          ...p[0].result,
          tabContext: {
            currentTabId: t.tabId,
            executedOnTabId: o,
            availableTabs: f,
            tabCount: f.length,
          },
        };
      } catch (r) {
        return {
          error: `Failed to upload image: ${r instanceof Error ? r.message : "Unknown error"}`,
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
            description:
              'Optional filename for the uploaded file (default: "image.png")',
          },
        },
        required: ["imageId", "tabId"],
      },
    }),
  },
  ke = {
    name: "read_console_messages",
    description:
      "Read browser console messages (console.log, console.error, console.warn, etc.) from a specific tab. Useful for debugging JavaScript errors, viewing application logs, or understanding what's happening in the browser console. Returns console messages from the current domain only. If you don't have a valid tab ID, use tabs_context first to get available tabs. IMPORTANT: Always provide a pattern to filter messages - without a pattern, you may get too many irrelevant messages.",
    parameters: {
      tabId: {
        type: "number",
        description:
          "Tab ID to read console messages from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        required: !0,
      },
      onlyErrors: {
        type: "boolean",
        description:
          "If true, only return error and exception messages. Default is false (return all message types).",
        required: !1,
      },
      clear: {
        type: "boolean",
        description:
          "If true, clear the console messages after reading to avoid duplicates on subsequent calls. Default is false.",
        required: !1,
      },
      pattern: {
        type: "string",
        description:
          "Regex pattern to filter console messages. Only messages matching this pattern will be returned (e.g., 'error|warning' to find errors and warnings, 'MyApp' to filter app-specific logs). You should always provide a pattern to avoid getting too many irrelevant messages.",
        required: !1,
      },
    },
    execute: async (e, t) => {
      try {
        const {
          tabId: o,
          onlyErrors: i = !1,
          clear: a = !1,
          pattern: s,
          limit: c = 100,
        } = e;
        if (!t?.tabId) throw new Error("No active tab found");
        const u = await K.getEffectiveTabId(o, t.tabId),
          l = await chrome.tabs.get(u);
        if (!l.id) throw new Error("Active tab has no ID");
        const d = l.url;
        if (!d) throw new Error("No URL available for active tab");
        const h = t?.toolUseId,
          p = await t.permissionManager.checkPermission(d, h);
        if (!p.allowed) {
          if (p.needsPrompt) {
            return {
              type: "permission_required",
              tool: n.READ_CONSOLE_MESSAGES,
              url: d,
              toolUseId: h,
            };
          }
          return {
            error:
              "Permission denied for reading console messages on this domain",
          };
        }
        try {
          await re.enableConsoleTracking(l.id);
        } catch (r) {}
        const f = re.getConsoleMessages(l.id, i, s);
        if ((a && re.clearConsoleMessages(l.id), 0 === f.length)) {
          return {
            output: `No console ${i ? "errors or exceptions" : "messages"} found for this tab.\n\nNote: Console tracking starts when this tool is first called. If the page loaded before calling this tool, you may need to refresh the page to capture console messages from page load.`,
            tabContext: {
              currentTabId: t.tabId,
              executedOnTabId: u,
              availableTabs: await K.getValidTabsWithMetadata(t.tabId),
              tabCount: (await K.getValidTabsWithMetadata(t.tabId)).length,
            },
          };
        }
        const m = f.slice(0, c),
          g = f.length > c,
          b = m
            .map((e, t) => {
              const r = new Date(e.timestamp).toLocaleTimeString(),
                o =
                  e.url && void 0 !== e.lineNumber
                    ? ` (${e.url}:${e.lineNumber}${void 0 !== e.columnNumber ? `:${e.columnNumber}` : ""})`
                    : "";
              let n = `[${t + 1}] [${r}] [${e.type.toUpperCase()}]${o}\n${e.text}`;
              return (
                e.stackTrace && (n += `\nStack trace:\n${e.stackTrace}`),
                n
              );
            })
            .join("\n\n"),
          w = i ? "error/exception messages" : "console messages",
          y = g ? ` (showing first ${c} of ${f.length})` : "",
          v = `Found ${f.length} ${w}${y}:`,
          I = await K.getValidTabsWithMetadata(t.tabId);
        return {
          output: `${v}\n\n${b}`,
          tabContext: {
            currentTabId: t.tabId,
            executedOnTabId: u,
            availableTabs: I,
            tabCount: I.length,
          },
        };
      } catch (r) {
        return {
          error: `Failed to read console messages: ${r instanceof Error ? r.message : "Unknown error"}`,
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
  },
  _e = {
    name: "read_network_requests",
    description:
      "Read HTTP network requests (XHR, Fetch, documents, images, etc.) from a specific tab. Useful for debugging API calls, monitoring network activity, or understanding what requests a page is making. Returns all network requests made by the current page, including cross-origin requests. Requests are automatically cleared when the page navigates to a different domain. If you don't have a valid tab ID, use tabs_context first to get available tabs.",
    parameters: {
      tabId: {
        type: "number",
        description:
          "Tab ID to read network requests from. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
        required: !0,
      },
      urlPattern: {
        type: "string",
        description:
          "Optional URL pattern to filter requests. Only requests whose URL contains this string will be returned (e.g., '/api/' to filter API calls, 'example.com' to filter by domain).",
        required: !1,
      },
      clear: {
        type: "boolean",
        description:
          "If true, clear the network requests after reading to avoid duplicates on subsequent calls. Default is false.",
        required: !1,
      },
      limit: {
        type: "number",
        description:
          "Maximum number of requests to return. Defaults to 100. Increase only if you need more results.",
        required: !1,
      },
    },
    execute: async (e, t) => {
      try {
        const { tabId: o, urlPattern: i, clear: a = !1, limit: s = 100 } = e;
        if (!t?.tabId) throw new Error("No active tab found");
        const c = await K.getEffectiveTabId(o, t.tabId),
          u = await chrome.tabs.get(c);
        if (!u.id) throw new Error("Active tab has no ID");
        const l = u.url;
        if (!l) throw new Error("No URL available for active tab");
        const d = t?.toolUseId,
          h = await t.permissionManager.checkPermission(l, d);
        if (!h.allowed) {
          if (h.needsPrompt) {
            return {
              type: "permission_required",
              tool: n.READ_NETWORK_REQUESTS,
              url: l,
              toolUseId: d,
            };
          }
          return {
            error:
              "Permission denied for reading network requests on this domain",
          };
        }
        try {
          await re.enableNetworkTracking(u.id);
        } catch (r) {}
        const p = re.getNetworkRequests(u.id, i);
        if ((a && re.clearNetworkRequests(u.id), 0 === p.length)) {
          let e = "network requests";
          return (
            i && (e = `requests matching "${i}"`),
            {
              output: `No ${e} found for this tab.\n\nNote: Network tracking starts when this tool is first called. If the page loaded before calling this tool, you may need to refresh the page or perform actions that trigger network requests.`,
              tabContext: {
                currentTabId: t.tabId,
                executedOnTabId: c,
                availableTabs: await K.getValidTabsWithMetadata(t.tabId),
                tabCount: (await K.getValidTabsWithMetadata(t.tabId)).length,
              },
            }
          );
        }
        const f = p.slice(0, s),
          m = p.length > s,
          g = f
            .map((e, t) => {
              const r = e.status || "pending";
              return `${t + 1}. url: ${e.url}\n   method: ${e.method}\n   statusCode: ${r}`;
            })
            .join("\n\n"),
          b = [];
        i && b.push(`URL pattern: "${i}"`);
        const w = b.length > 0 ? ` (filtered by ${b.join(", ")})` : "",
          y = m ? ` (showing first ${s} of ${p.length})` : "",
          v = `Found ${p.length} network request${1 === p.length ? "" : "s"}${w}${y}:`,
          I = await K.getValidTabsWithMetadata(t.tabId);
        return {
          output: `${v}\n\n${g}`,
          tabContext: {
            currentTabId: t.tabId,
            executedOnTabId: c,
            availableTabs: I,
            tabCount: I.length,
          },
        };
      } catch (r) {
        return {
          error: `Failed to read network requests: ${r instanceof Error ? r.message : "Unknown error"}`,
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
  },
  Ee = {
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
    execute: async (e, t) => {
      try {
        const { width: r, height: o, tabId: n } = e;
        if (!r || !o)
          throw new Error("Both width and height parameters are required");
        if (!n) throw new Error("tabId parameter is required");
        if (!t?.tabId) throw new Error("No active tab found");
        if ("number" != typeof r || "number" != typeof o)
          throw new Error("Width and height must be numbers");
        if (r <= 0 || o <= 0)
          throw new Error("Width and height must be positive numbers");
        if (r > 7680 || o > 4320)
          throw new Error(
            "Dimensions exceed 8K resolution limit. Maximum dimensions are 7680x4320",
          );
        const i = await K.getEffectiveTabId(n, t.tabId),
          a = await chrome.tabs.get(i);
        if (!a.windowId)
          throw new Error("Tab does not have an associated window");
        return (
          await chrome.windows.update(a.windowId, {
            width: Math.floor(r),
            height: Math.floor(o),
          }),
          {
            output: `Successfully resized window containing tab ${i} to ${Math.floor(r)}x${Math.floor(o)} pixels`,
          }
        );
      } catch (r) {
        return {
          error: `Failed to resize window: ${r instanceof Error ? r.message : "Unknown error"}`,
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
const xe = new (class {
    storage = new Map();
    recordingGroups = new Set();
    addFrame(e, t) {
      this.storage.has(e) ||
        this.storage.set(e, { frames: [], lastUpdated: Date.now() });
      const r = this.storage.get(e);
      if (
        (r.frames.push(t), (r.lastUpdated = Date.now()), r.frames.length > 50)
      ) {
        r.frames.shift();
      }
    }
    getFrames(e) {
      return this.storage.get(e)?.frames ?? [];
    }
    clearFrames(e) {
      this.storage.get(e)?.frames.length;
      (this.storage.delete(e), this.recordingGroups.delete(e));
    }
    getFrameCount(e) {
      return this.storage.get(e)?.frames.length ?? 0;
    }
    getActiveGroupIds() {
      return Array.from(this.storage.keys());
    }
    startRecording(e) {
      this.recordingGroups.add(e);
    }
    stopRecording(e) {
      this.recordingGroups.delete(e);
    }
    isRecording(e) {
      return this.recordingGroups.has(e);
    }
    getRecordingGroupIds() {
      return Array.from(this.recordingGroups);
    }
    clearAll() {
      Array.from(this.storage.values()).reduce(
        (e, t) => e + t.frames.length,
        0,
      );
      (this.storage.clear(), this.recordingGroups.clear());
    }
  })(),
  Ce = {
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
    execute: async (e, t) => {
      try {
        const r = e;
        if (!r?.action) throw new Error("action parameter is required");
        if (!t?.tabId) throw new Error("No active tab found in context");
        const i = await chrome.tabs.get(r.tabId);
        if (!i) throw new Error(`Tab ${r.tabId} not found`);
        const a = i.groupId ?? -1;
        if (t.sessionId === fe) {
          const e = await chrome.storage.local.get(o.MCP_TAB_GROUP_ID);
          if (a !== e[o.MCP_TAB_GROUP_ID])
            return {
              error: `Tab ${r.tabId} is not in the MCP tab group. GIF recording only works for tabs within the MCP tab group.`,
            };
        }
        switch (r.action) {
          case "start_recording":
            return await (async function (e) {
              const t = xe.isRecording(e);
              if (t)
                return {
                  output:
                    "Recording is already active for this tab group. Use 'stop_recording' to stop or 'export' to generate GIF.",
                };
              return (
                xe.clearFrames(e),
                xe.startRecording(e),
                {
                  output:
                    "Started recording browser actions for this tab group. All computer and navigate tool actions will now be captured (max 50 frames). Previous frames cleared.",
                }
              );
            })(a);
          case "stop_recording":
            return await (async function (e) {
              const t = xe.isRecording(e);
              if (!t)
                return {
                  output:
                    "Recording is not active for this tab group. Use 'start_recording' to begin capturing.",
                };
              xe.stopRecording(e);
              const r = xe.getFrameCount(e);
              return {
                output: `Stopped recording for this tab group. Captured ${r} frame${1 === r ? "" : "s"}. Use 'export' to generate GIF or 'clear' to discard.`,
              };
            })(a);
          case "export":
            return await (async function (e, t, r, o) {
              const i = !0 === e.download;
              if (!(i || (e.coordinate && 2 === e.coordinate.length)))
                throw new Error(
                  "coordinate parameter is required for export action (or set download: true to download the GIF)",
                );
              if (!t.id || !t.url) throw new Error("Tab has no ID or URL");
              const a = xe.getFrames(r);
              if (0 === a.length)
                return {
                  error:
                    "No frames recorded for this tab group. Use 'start_recording' and perform browser actions first.",
                };
              if (!i) {
                const r = t.url,
                  i = o?.toolUseId,
                  a = await o.permissionManager.checkPermission(r, i);
                if (!a.allowed) {
                  if (a.needsPrompt) {
                    return {
                      type: "permission_required",
                      tool: n.UPLOAD_IMAGE,
                      url: r,
                      toolUseId: i,
                      actionData: { coordinate: e.coordinate },
                    };
                  }
                  return {
                    error: "Permission denied for uploading to this domain",
                  };
                }
              }
              const s = t.url;
              0 ===
                (
                  await chrome.runtime.getContexts({
                    contextTypes: ["OFFSCREEN_DOCUMENT"],
                  })
                ).length &&
                (await chrome.offscreen.createDocument({
                  url: "offscreen.html",
                  reasons: ["BLOBS"],
                  justification: "Generate animated GIF from screenshots",
                }),
                await new Promise((e) => setTimeout(e, 200)));
              const c = a.map((e) => ({
                  base64: e.base64,
                  format: "png",
                  action: e.action,
                  delay: e.action ? Se(e.action.type) : 800,
                  viewportWidth: e.viewportWidth,
                  viewportHeight: e.viewportHeight,
                  devicePixelRatio: e.devicePixelRatio,
                })),
                u = {
                  showClickIndicators: e.options?.showClickIndicators ?? !0,
                  showDragPaths: e.options?.showDragPaths ?? !0,
                  showActionLabels: e.options?.showActionLabels ?? !0,
                  showProgressBar: e.options?.showProgressBar ?? !0,
                  showWatermark: e.options?.showWatermark ?? !0,
                  quality: e.options?.quality ?? 10,
                };
              const l = await new Promise((e, t) => {
                chrome.runtime.sendMessage(
                  { type: "GENERATE_GIF", frames: c, options: u },
                  (r) => {
                    chrome.runtime.lastError
                      ? t(new Error(chrome.runtime.lastError.message))
                      : r && r.success
                        ? e(r.result)
                        : t(
                            new Error(
                              r?.error || "Unknown error from offscreen",
                            ),
                          );
                  },
                );
              });
              const d = new Date().toISOString().replace(/[:.]/g, "-"),
                h = e.filename || `recording-${d}.gif`;
              let p;
              if (i) {
                await chrome.downloads.download({
                  url: l.blobUrl,
                  filename: h,
                  saveAs: !1,
                });
                p = `Successfully exported GIF with ${a.length} frames. Downloaded "${h}" (${Math.round(l.size / 1024)}KB). Dimensions: ${l.width}x${l.height}. Recording cleared.`;
              } else {
                const r = await F(t.id, s, "GIF export upload action");
                if (r) return r;
                const o = await chrome.scripting.executeScript({
                  target: { tabId: t.id },
                  func: (e, t, r, o) => {
                    const n = atob(e),
                      i = new Array(n.length);
                    for (let d = 0; d < n.length; d++) i[d] = n.charCodeAt(d);
                    const a = new Uint8Array(i),
                      s = new Blob([a], { type: "image/gif" }),
                      c = new File([s], t, {
                        type: "image/gif",
                        lastModified: Date.now(),
                      }),
                      u = new DataTransfer();
                    u.items.add(c);
                    const l = document.elementFromPoint(r, o);
                    if (!l)
                      throw new Error(
                        `No element found at coordinates (${r}, ${o})`,
                      );
                    return (
                      l.dispatchEvent(
                        new DragEvent("dragenter", {
                          bubbles: !0,
                          cancelable: !0,
                          dataTransfer: u,
                          clientX: r,
                          clientY: o,
                        }),
                      ),
                      l.dispatchEvent(
                        new DragEvent("dragover", {
                          bubbles: !0,
                          cancelable: !0,
                          dataTransfer: u,
                          clientX: r,
                          clientY: o,
                        }),
                      ),
                      l.dispatchEvent(
                        new DragEvent("drop", {
                          bubbles: !0,
                          cancelable: !0,
                          dataTransfer: u,
                          clientX: r,
                          clientY: o,
                        }),
                      ),
                      {
                        output: `Successfully dropped ${t} (${Math.round(s.size / 1024)}KB) at (${r}, ${o})`,
                      }
                    );
                  },
                  args: [l.base64, h, e.coordinate[0], e.coordinate[1]],
                });
                if (!o || !o[0]?.result)
                  throw new Error("Failed to upload GIF to page");
                p = `Successfully exported GIF with ${a.length} frames. ${o[0].result.output}. Dimensions: ${l.width}x${l.height}. Recording cleared.`;
              }
              xe.clearFrames(r);
              const f = await K.getValidTabsWithMetadata(o.tabId);
              return {
                output: p,
                tabContext: {
                  currentTabId: o.tabId,
                  executedOnTabId: t.id,
                  availableTabs: f,
                  tabCount: f.length,
                },
              };
            })(r, i, a, t);
          case "clear":
            return await (async function (e) {
              const t = xe.getFrameCount(e);
              if (0 === t)
                return { output: "No frames to clear for this tab group." };
              return (
                xe.clearFrames(e),
                {
                  output: `Cleared ${t} frame${1 === t ? "" : "s"} for this tab group. Recording stopped.`,
                }
              );
            })(a);
          default:
            throw new Error(
              `Unknown action: ${r.action}. Must be one of: start_recording, stop_recording, export, clear`,
            );
        }
      } catch (r) {
        return {
          error: `Failed to execute gif_creator: ${r instanceof Error ? r.message : "Unknown error"}`,
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
                description:
                  "Show orange circles at click locations (default: true)",
              },
              showDragPaths: {
                type: "boolean",
                description: "Show red arrows for drag actions (default: true)",
              },
              showActionLabels: {
                type: "boolean",
                description:
                  "Show black labels describing actions (default: true)",
              },
              showProgressBar: {
                type: "boolean",
                description:
                  "Show orange progress bar at bottom (default: true)",
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
function Se(e) {
  return (
    {
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
    }[e] ?? 800
  );
}
const Ae = { type: "object", properties: {}, required: [] },
  Me = {
    name: "turn_answer_start",
    description:
      "Call this immediately before your text response to the user for this turn. Required every turn - whether or not you made tool calls. After calling, write your response. No more tools after this.",
    parameters: Ae,
    execute: async () => ({ output: "Proceed with your response." }),
    toAnthropicSchema() {
      return {
        type: "custom",
        name: this.name,
        description: this.description,
        input_schema: Ae,
      };
    },
  },
  De = {
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
    execute: async (e, t) => {
      try {
        const { action: r, text: o, tabId: i } = e;
        if ("javascript_exec" !== r)
          throw new Error("'javascript_exec' is the only supported action");
        if (!o) throw new Error("Code parameter is required");
        if (!t?.tabId) throw new Error("No active tab found");
        const a = await K.getEffectiveTabId(i, t.tabId),
          s = (await chrome.tabs.get(a)).url;
        if (!s) throw new Error("No URL available for active tab");
        const c = t?.toolUseId,
          u = await t.permissionManager.checkPermission(s, c);
        if (!u.allowed) {
          if (u.needsPrompt) {
            return {
              type: "permission_required",
              tool: n.EXECUTE_JAVASCRIPT,
              url: s,
              toolUseId: c,
              actionData: { text: o },
            };
          }
          return {
            error: "Permission denied for JavaScript execution on this domain",
          };
        }
        const l = await F(a, s, "JavaScript execution");
        if (l) return l;
        const d = `\n        (function() {\n          'use strict';\n          try {\n            return eval(\`${o.replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`);\n          } catch (e) {\n            throw e;\n          }\n        })()\n      `,
          h = await re.sendCommand(a, "Runtime.evaluate", {
            expression: d,
            returnByValue: !0,
            awaitPromise: !0,
            timeout: 1e4,
          });
        let p = "",
          f = !1,
          m = "";
        const g = (e, t = 0) => {
            if (t > 5) return "[TRUNCATED: Max depth exceeded]";
            const r = [
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
            if ("string" == typeof e) {
              if (e.includes("=") && (e.includes(";") || e.includes("&")))
                return "[BLOCKED: Cookie/query string data]";
              if (e.match(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/))
                return "[BLOCKED: JWT token]";
              if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(e))
                return "[BLOCKED: Base64 encoded data]";
              if (/^[a-f0-9]{32,}$/i.test(e))
                return "[BLOCKED: Hex credential]";
              if (e.length > 1e3) return e.substring(0, 1e3) + "[TRUNCATED]";
            }
            if (e && "object" == typeof e && !Array.isArray(e)) {
              const o = {};
              for (const [n, i] of Object.entries(e)) {
                const e = r.some((e) => e.test(n));
                o[n] = e
                  ? "[BLOCKED: Sensitive key]"
                  : "cookie" === n || "cookies" === n
                    ? "[BLOCKED: Cookie access]"
                    : g(i, t + 1);
              }
              return o;
            }
            if (Array.isArray(e)) {
              const r = e.slice(0, 100).map((e) => g(e, t + 1));
              return (
                e.length > 100 &&
                  r.push(`[TRUNCATED: ${e.length - 100} more items]`),
                r
              );
            }
            return e;
          },
          b = 51200;
        if (h.exceptionDetails) {
          f = !0;
          const e = h.exceptionDetails.exception,
            t = e?.description?.includes("execution was terminated");
          m = t
            ? "Execution timeout: Code exceeded 10-second limit"
            : e?.description || e?.value || "Unknown error";
        } else if (h.result) {
          const e = h.result;
          if ("undefined" === e.type) p = "undefined";
          else if ("object" === e.type && "null" === e.subtype) p = "null";
          else if ("function" === e.type) p = e.description || "[Function]";
          else if ("object" === e.type)
            if ("node" === e.subtype) p = e.description || "[DOM Node]";
            else if ("array" === e.subtype) p = e.description || "[Array]";
            else {
              const t = g(e.value || {});
              p = e.description || JSON.stringify(t, null, 2);
            }
          else if (void 0 !== e.value) {
            const t = g(e.value);
            p = "string" == typeof t ? t : JSON.stringify(t, null, 2);
          } else p = e.description || String(e.value);
        } else p = "undefined";
        const w = await K.getValidTabsWithMetadata(t.tabId);
        return f
          ? {
              error: `JavaScript execution error: ${m}`,
              tabContext: {
                currentTabId: t.tabId,
                executedOnTabId: a,
                availableTabs: w,
                tabCount: w.length,
              },
            }
          : (p.length > b &&
              (p =
                p.substring(0, b) +
                "\n[OUTPUT TRUNCATED: Exceeded 50KB limit]"),
            {
              output: p,
              tabContext: {
                currentTabId: t.tabId,
                executedOnTabId: a,
                availableTabs: w,
                tabCount: w.length,
              },
            });
      } catch (r) {
        return {
          error: `Failed to execute JavaScript: ${r instanceof Error ? r.message : "Unknown error"}`,
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
async function Re(e, t) {
  const r = t === e;
  await K.initialize();
  const o = await K.findGroupByTab(t);
  return {
    isMainTab: r,
    isSecondaryTab: !!o && o.mainTabId === e && t !== e,
    group: o,
  };
}
function Ue(e) {
  return "category1" === e || "category2" === e;
}
function Pe(e) {
  try {
    return new URL(e).hostname;
  } catch {
    return null;
  }
}
function Ge(e, t) {
  if (
    !e ||
    (r = e).startsWith("chrome://") ||
    r.startsWith("chrome-extension://") ||
    r.startsWith("about:") ||
    "" === r
  )
    return null;
  var r;
  const o = Pe(e),
    n = Pe(t);
  return o && n && o !== n && "newtab" !== o
    ? { oldDomain: o, newDomain: n }
    : null;
}
async function Be(e, t) {
  const r = await W.getCategory(t);
  return (await K.updateTabBlocklistStatus(e, t), r ?? null);
}
function Oe(e) {
  return chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(e)}`);
}
function $e(e, t, r, o, i) {
  return {
    type: "permission_required",
    tool: n.DOMAIN_TRANSITION,
    url: r,
    toolUseId: crypto.randomUUID(),
    actionData: {
      fromDomain: e,
      toDomain: t,
      sourceTabId: o,
      isSecondaryTab: i,
    },
  };
}
// Feature flags disabled for MCP mode (CSP blocks external API calls)
// Returns empty object - callers fall back to hardcoded defaults
async function qe(e) {
  return {};
}
async function Fe(e) {
  const { tabId: t, prompt: r, taskName: n, skipPermissions: i, model: a } = e,
    s = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    u = `shortcut_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  return (
    await c(o.TARGET_TAB_ID, t),
    await (async function (e) {
      const { sessionId: t, skipPermissions: r, model: o } = e,
        n = chrome.runtime.getURL(
          `sidepanel.html?mode=window&sessionId=${t}${r ? "&skipPermissions=true" : ""}${o ? `&model=${encodeURIComponent(o)}` : ""}`,
        ),
        i = await chrome.windows.create({
          url: n,
          type: "popup",
          width: 500,
          height: 768,
          left: 100,
          top: 100,
          focused: !0,
        });
      if (!i) throw new Error("Failed to create sidepanel window");
      return i;
    })({ sessionId: s, skipPermissions: i, model: a }),
    await (async function (e) {
      const {
        tabId: t,
        prompt: r,
        taskName: o,
        runLogId: n,
        sessionId: i,
        isScheduledTask: a,
      } = e;
      return new Promise((e, s) => {
        const c = Date.now();
        let u = !1;
        const l = async () => {
          try {
            if (Date.now() - c > 3e4)
              return void s(
                new Error("Timeout waiting for tab to load for task execution"),
              );
            "complete" === (await chrome.tabs.get(t)).status
              ? setTimeout(() => {
                  u ||
                    ((u = !0),
                    chrome.runtime.sendMessage(
                      {
                        type: "EXECUTE_TASK",
                        prompt: r,
                        taskName: o,
                        runLogId: n,
                        windowSessionId: i,
                        isScheduledTask: a,
                      },
                      () => {
                        chrome.runtime.lastError
                          ? s(
                              new Error(
                                `Failed to send prompt: ${chrome.runtime.lastError.message}`,
                              ),
                            )
                          : e();
                      },
                    ));
                }, 3e3)
              : setTimeout(l, 500);
          } catch (d) {
            s(d);
          }
        };
        setTimeout(l, 1e3);
      });
    })({
      tabId: t,
      prompt: r,
      taskName: n,
      runLogId: u,
      sessionId: s,
      isScheduledTask: !1,
    }),
    { success: !0 }
  );
}
const We = [
    le,
    // pe (find) removed - handled by MCP server
    de,
    ie,
    Y,
    he,
    me,
    {
      name: "tabs_context_mcp",
      description:
        "Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist. Each new conversation should create its own new tab (using tabs_create) rather than reusing existing tabs, unless the user explicitly asks to use an existing tab.",
      parameters: {
        createIfEmpty: {
          type: "boolean",
          description:
            "Creates a new MCP tab group if none exists, creates a new Window with a new tab group containing an empty tab (which can be used for this conversation). If a MCP tab group already exists, this parameter has no effect.",
        },
      },
      execute: async (e) => {
        try {
          const { createIfEmpty: t } = e || {};
          await K.initialize();
          const r = await K.getOrCreateMcpTabContext({ createIfEmpty: t });
          if (!r)
            return {
              output:
                "No MCP tab groups found. Use createIfEmpty: true to create one.",
            };
          const o = r.tabGroupId,
            n = r.availableTabs;
          return { output: R(n, o), tabContext: { ...r, tabGroupId: o } };
        } catch (t) {
          return {
            error: `Failed to query tabs: ${t instanceof Error ? t.message : "Unknown error"}`,
          };
        }
      },
      toAnthropicSchema: async () => ({
        name: "tabs_context_mcp",
        description:
          "Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist. Each new conversation should create its own new tab (using tabs_create) rather than reusing existing tabs, unless the user explicitly asks to use an existing tab.",
        input_schema: {
          type: "object",
          properties: {
            createIfEmpty: {
              type: "boolean",
              description:
                "Creates a new MCP tab group if none exists, creates a new Window with a new tab group containing an empty tab (which can be used for this conversation). If a MCP tab group already exists, this parameter has no effect.",
            },
          },
          required: [],
        },
      }),
    },
    ge,
    {
      name: "tabs_create_mcp",
      description: "Creates a new empty tab in the MCP tab group.",
      parameters: {},
      execute: async () => {
        try {
          await K.initialize();
          const e = await K.getOrCreateMcpTabContext({ createIfEmpty: !1 });
          if (!e?.tabGroupId)
            return {
              error:
                "No MCP tab group exists. Use tabs_context_mcp with createIfEmpty: true first to create one.",
            };
          const t = e.tabGroupId,
            r = await chrome.tabs.create({
              url: "chrome://newtab",
              active: !0,
            });
          if (!r.id)
            throw new Error("Failed to create tab - no tab ID returned");
          await chrome.tabs.group({ tabIds: r.id, groupId: t });
          const o = (await chrome.tabs.query({ groupId: t }))
            .filter((e) => void 0 !== e.id)
            .map((e) => ({ id: e.id, title: e.title || "", url: e.url || "" }));
          return {
            output: `Created new tab. Tab ID: ${r.id}`,
            tabContext: {
              currentTabId: r.id,
              executedOnTabId: r.id,
              availableTabs: o,
              tabCount: o.length,
              tabGroupId: t,
            },
          };
        } catch (e) {
          return {
            error: `Failed to create tab: ${e instanceof Error ? e.message : "Unknown error"}`,
          };
        }
      },
      toAnthropicSchema: async () => ({
        name: "tabs_create_mcp",
        description: "Creates a new empty tab in the MCP tab group.",
        input_schema: { type: "object", properties: {}, required: [] },
      }),
    },
    Ie,
    Te,
    ke,
    _e,
    Ee,
    Ce,
    Me,
    De,
    {
      name: "shortcuts_list",
      description:
        "List all available shortcuts and workflows (shortcuts and workflows are interchangeable). Returns shortcuts with their commands, descriptions, and whether they are workflows. Use shortcuts_execute to run a shortcut or workflow.",
      parameters: {},
      execute: async () => {
        try {
          const e = (await s.getAllPrompts()).map((e) => ({
            id: e.id,
            ...(e.command && { command: e.command }),
          }));
          return 0 === e.length
            ? {
                output: JSON.stringify(
                  { message: "No shortcuts found", shortcuts: [] },
                  null,
                  2,
                ),
              }
            : {
                output: JSON.stringify(
                  { message: `Found ${e.length} shortcut(s)`, shortcuts: e },
                  null,
                  2,
                ),
              };
        } catch (e) {
          return {
            error: `Failed to list shortcuts: ${e instanceof Error ? e.message : "Unknown error"}`,
          };
        }
      },
      toAnthropicSchema: async () => ({
        name: "shortcuts_list",
        description:
          "List all available shortcuts and workflows (shortcuts and workflows are interchangeable). Returns shortcuts with their commands, descriptions, and whether they are workflows. Use shortcuts_execute to run a shortcut or workflow.",
        input_schema: { type: "object", properties: {}, required: [] },
      }),
    },
    {
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
      execute: async (e, t) => {
        try {
          const { shortcutId: r, command: o } = e;
          if (!r && !o)
            return {
              error:
                "Either shortcutId or command is required. Use shortcuts_list to see available shortcuts.",
            };
          const n = t?.tabId;
          if (!n)
            return {
              error:
                "No tab context available. Cannot execute shortcut without a target tab.",
            };
          let i;
          if (r) i = await s.getPromptById(r);
          else if (o) {
            const e = o.startsWith("/") ? o.slice(1) : o;
            i = await s.getPromptByCommand(e);
          }
          if (!i)
            return {
              error: `Shortcut not found. ${r ? `No shortcut with ID "${r}"` : `No shortcut with command "/${o}"`}. Use shortcuts_list to see available shortcuts.`,
            };
          await s.recordPromptUsage(i.id);
          const a = i.command || i.id,
            c = `[[shortcut:${i.id}:${a}]]`,
            u = await Fe({
              tabId: n,
              tabGroupId: t?.tabGroupId,
              prompt: c,
              taskName: i.command || i.id,
              skipPermissions: i.skipPermissions,
              model: i.model,
            });
          return u.success
            ? {
                output: JSON.stringify(
                  {
                    success: !0,
                    message: `Shortcut "${i.command || i.id}" started. Execution is running in a separate sidepanel window.`,
                    shortcut: { id: i.id, command: i.command },
                  },
                  null,
                  2,
                ),
              }
            : { error: u.error || "Shortcut execution failed" };
        } catch (r) {
          return {
            error: `Failed to execute shortcut: ${r instanceof Error ? r.message : "Unknown error"}`,
          };
        }
      },
      toAnthropicSchema: async () => ({
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
    },
  ],
  je = ["tabs_context_mcp", "tabs_create_mcp"];
class ze {
  constructor(e) {
    this.context = e;
  }
  async handleToolCall(e, t, r, o, n, i) {
    const a = t.action;
    return await I(
      `tool_execution_${e}${a ? "_" + a : ""}`,
      async (i) => {
        if (!this.context.tabId && !je.includes(e))
          throw new Error("No tab available");
        (i.setAttribute("session_id", this.context.sessionId),
          i.setAttribute("tool_name", e),
          o && i.setAttribute("permissions", o),
          a && i.setAttribute("action", a));
        const s = {
            toolUseId: r,
            tabId: this.context.tabId,
            tabGroupId: this.context.tabGroupId,
            model: this.context.model,
            sessionId: this.context.sessionId,
            anthropicClient: this.context.anthropicClient,
            permissionManager: this.context.permissionManager,
            createAnthropicMessage: this.createAnthropicMessage(),
          },
          c = We.find((t) => t.name === e);
        if (!c) throw new Error(`Unknown tool: ${e}`);
        const u = {
          name: e,
          sessionId: this.context.sessionId,
          permissions: o,
        };
        ("computer" === e && a && (u.action = a), n && (u.domain = n));
        try {
          const r = B(e, t, We),
            o = await c.execute(r, s);
          return (
            "type" in o
              ? ((u.success = !1),
                i.setAttribute("success", !1),
                i.setAttribute("failure_reason", "needs_permission"))
              : ((u.success = !o.error), i.setAttribute("success", !o.error)),
            "type" in o ||
              o.error ||
              !s.tabId ||
              (await (async function (e, t, r) {
                try {
                  if (!["computer", "navigate"].includes(e)) return;
                  const n = await chrome.tabs.get(r);
                  if (!n) return;
                  const i = n.groupId ?? -1;
                  if (!xe.isRecording(i)) return;
                  let a, s;
                  if ("computer" === e && t.action) {
                    const e = t.action;
                    if ("screenshot" === e) return;
                    ((a = {
                      type: e,
                      coordinate: t.coordinate,
                      start_coordinate: t.start_coordinate,
                      text: t.text,
                      timestamp: Date.now(),
                    }),
                      e.includes("click")
                        ? (a.description = "Clicked")
                        : "type" === e && t.text
                          ? (a.description = `Typed: "${t.text}"`)
                          : "key" === e && t.text
                            ? (a.description = `Pressed key: ${t.text}`)
                            : (a.description =
                                "scroll" === e
                                  ? "Scrolled"
                                  : "left_click_drag" === e
                                    ? "Dragged"
                                    : e));
                  } else
                    "navigate" === e &&
                      t.url &&
                      (a = {
                        type: "navigate",
                        timestamp: Date.now(),
                        description: `Navigated to ${t.url}`,
                      });
                  if (
                    a &&
                    (a.type.includes("click") || "left_click_drag" === a.type)
                  ) {
                    const e = xe.getFrames(i);
                    if (e.length > 0) {
                      const t = e[e.length - 1],
                        r = {
                          base64: t.base64,
                          action: a,
                          frameNumber: e.length,
                          timestamp: Date.now(),
                          viewportWidth: t.viewportWidth,
                          viewportHeight: t.viewportHeight,
                          devicePixelRatio: t.devicePixelRatio,
                        };
                      xe.addFrame(i, r);
                    }
                  }
                  await new Promise((e) => setTimeout(e, 100));
                  try {
                    s = await re.screenshot(r);
                  } catch (o) {
                    return;
                  }
                  let c = 1;
                  try {
                    const e = await chrome.scripting.executeScript({
                      target: { tabId: r },
                      func: () => window.devicePixelRatio,
                    });
                    e && e[0]?.result && (c = e[0].result);
                  } catch (o) {}
                  const u = xe.getFrames(i).length,
                    l = {
                      base64: s.base64,
                      action: a,
                      frameNumber: u,
                      timestamp: Date.now(),
                      viewportWidth: s.viewportWidth || s.width,
                      viewportHeight: s.viewportHeight || s.height,
                      devicePixelRatio: c,
                    };
                  xe.addFrame(i, l);
                } catch (o) {}
              })(e, r, s.tabId)),
            this.context.analytics?.track("claude_chrome.chat.tool_called", u),
            o
          );
        } catch (l) {
          throw (
            this.context.analytics?.track("claude_chrome.chat.tool_called", {
              ...u,
              success: !1,
              failureReason: "exception",
            }),
            l
          );
        }
      },
      i,
    );
  }
  async processToolResults(e) {
    const t = [],
      r = (e) => {
        if (e.error) return e.error;
        const t = [];
        if (
          (e.output && t.push({ type: "text", text: e.output }), e.tabContext)
        ) {
          const r = `\n\nTab Context:${e.tabContext.executedOnTabId ? `\n- Executed on tabId: ${e.tabContext.executedOnTabId}` : ""}\n- Available tabs:\n${e.tabContext.availableTabs.map((e) => `  • tabId ${e.id}: "${e.title}" (${e.url})`).join("\n")}`;
          t.push({ type: "text", text: r });
        }
        if (e.base64Image) {
          const r = e.imageFormat ? `image/${e.imageFormat}` : "image/png";
          t.push({
            type: "image",
            source: { type: "base64", media_type: r, data: e.base64Image },
          });
        }
        return t.length > 0 ? t : "";
      },
      o = (e, t) => {
        const o = !!t.error;
        return {
          type: "tool_result",
          tool_use_id: e,
          content: r(t),
          ...(o && { is_error: !0 }),
        };
      };
    for (const i of e)
      try {
        const e = await this.handleToolCall(i.name, i.input, i.id);
        if ("type" in e && "permission_required" === e.type) {
          if (!this.context.onPermissionRequired || !this.context.tabId) {
            t.push(
              o(i.id, {
                error: "Permission required but no handler or tab id available",
              }),
            );
            continue;
          }
          if (
            !(await this.context.onPermissionRequired(e, this.context.tabId))
          ) {
            t.push(
              o(i.id, {
                error:
                  "update_plan" === i.name
                    ? "Plan rejected by user. Ask the user how they would like to change the plan."
                    : "Permission denied by user",
              }),
            );
            continue;
          }
          if ("update_plan" === i.name) {
            t.push(
              o(i.id, {
                output:
                  "User has approved your plan. You can now start executing the plan. Start with updating your todo list if applicable.",
              }),
            );
            continue;
          }
          const r = await this.handleToolCall(i.name, i.input, i.id);
          if ("type" in r && "permission_required" === r.type)
            throw new Error("Permission still required after granting");
          t.push(o(i.id, r));
        } else t.push(o(i.id, e));
      } catch (n) {
        t.push(
          o(i.id, { error: n instanceof Error ? n.message : "Unknown error" }),
        );
      }
    return t;
  }
}
// Anthropic client removed - find tool now handled by MCP server
let zt, Ht, Kt;

async function Vt(e, t) {
  if (zt) return ((zt.context.tabId = e), (zt.context.tabGroupId = t), zt);
  return (
    (zt = new ze({
      permissionManager: new T(() => self.__skipPermissions || !1, {}),
      sessionId: fe,
      tabId: e,
      tabGroupId: t,
      onPermissionRequired: async (e, t) =>
        self.__skipPermissions || (await ar(e, t)),
    })),
    zt
  );
}

// ============================================================================
// MCP Tool Execution
// Xt = createErrorResponse - creates error response for MCP tools
// Qt = executeToolRequest - main entry point for executing MCP tool requests
// ============================================================================
const Xt = (e) => ({ content: [{ type: "text", text: e }], is_error: !0 });
async function Qt(e) {
  const t = crypto.randomUUID(),
    r = e.clientId,
    o = Date.now();
  if (Ht && Kt) {
    if (Date.now() - Kt < 6e4) {
      const t = Ht;
      return (
        (Ht = void 0),
        (Kt = void 0),
        Xt(t)
      );
    }
    ((Ht = void 0), (Kt = void 0));
  }
  let i, a, s;
  try {
    const t = await K.getTabForMcp(e.tabId, e.tabGroupId);
    ((i = t.tabId), (a = t.domain));
  } catch {
    return Xt("No tabs available. Please open a new tab or window in Chrome.");
  }
  if (void 0 !== i)
    try {
      const e = await re.isDebuggerAttached(i);
      (await re.attachDebugger(i),
        e || (await new Promise((e) => setTimeout(e, 500))));
    } catch (l) {}
  let c,
    u = !1;
  try {
    void 0 !== i &&
      (await (async function (e, t, r, o) {
        if (
          (Zt.set(e, {
            toolName: t,
            requestId: r,
            startTime: Date.now(),
            errorCallback: o,
          }),
          await K.addTabToIndicatorGroup({
            tabId: e,
            isRunning: !0,
            isMcp: !0,
          }),
          er.has(e))
        ) {
          const t = er.get(e);
          (t && clearTimeout(t),
            K.addLoadingPrefix(e).catch(() => {}),
            er.set(e, null));
        } else (K.addLoadingPrefix(e).catch(() => {}), er.set(e, null));
      })(i, e.toolName, t, (e) => {
        ((Ht = e), (Kt = Date.now()));
      }));
    const r = await Vt(i, e.tabGroupId);
    (([s] = await r.processToolResults([
      { type: "tool_use", id: t, name: e.toolName, input: e.args },
    ])),
      (u = !0 === s?.is_error));
  } catch (l) {
    u = !0;
    c = "execution_error";
    s = Xt(l instanceof Error ? l.message : String(l));
  }
  return (
    void 0 !== i && rr(i, r),
    s
  );
}
const Zt = new Map(),
  er = new Map(),
  tr = 2e4;
function rr(e, t) {
  if (Zt.has(e)) {
    Zt.get(e);
    Zt.delete(e);
    const t = setTimeout(async () => {
      if (!Zt.has(e) && er.has(e)) {
        (K.addCompletionPrefix(e).catch(() => {}), er.set(e, null));
        try {
          await re.detachDebugger(e);
        } catch (t) {}
      }
    }, tr);
    er.set(e, t);
  }
}
function or(e) {
  const t = er.get(e);
  (t && clearTimeout(t), er.delete(e), K.removePrefix(e).catch(() => {}));
}

// nr = notifyDisconnection - called when native host disconnects
async function nr() {
  try {
    const e = await K.getAllGroups();
    for (const t of e) or(t.mainTabId);
  } catch (e) {}
}
let ir = Promise.resolve(!0);
async function ar(e, t) {
  const r = ir.then(() =>
    (async function (e, t) {
      const r = crypto.randomUUID(),
        o = Date.now(),
        n = er.get(t);
      n && clearTimeout(n);
      return (
        await K.addPermissionPrefix(t),
        er.set(t, null),
        await chrome.storage.local.set({
          [`mcp_prompt_${r}`]: { prompt: e, tabId: t, timestamp: Date.now() },
        }),
        new Promise((n) => {
          let i,
            a = !1;
          const s = async (s = !1) => {
              a ||
                ((a = !0),
                chrome.runtime.onMessage.removeListener(c),
                await chrome.storage.local.remove(`mcp_prompt_${r}`),
                i && chrome.windows.remove(i).catch(() => {}),
                await K.addLoadingPrefix(t),
                er.set(t, null),
                n(s));
            },
            c = (e) => {
              "MCP_PERMISSION_RESPONSE" === e.type &&
                e.requestId === r &&
                s(e.allowed);
            };
          (chrome.runtime.onMessage.addListener(c),
            chrome.windows.create(
              {
                url: chrome.runtime.getURL(
                  `sidepanel.html?tabId=${t}&mcpPermissionOnly=true&requestId=${r}`,
                ),
                type: "popup",
                width: 600,
                height: 600,
                focused: !0,
              },
              (e) => {
                e ? (i = e.id) : s(!1);
              },
            ),
            setTimeout(() => {
              s(!1);
            }, 3e4));
        })
      );
    })(e, t),
  );
  return ((ir = r.catch(() => !1)), r);
}
chrome.webNavigation.onBeforeNavigate.addListener(async (e) => {
  if (0 !== e.frameId || ((t = e.tabId), !Zt.has(t))) return;
  var t;
  const r = Zt.get(e.tabId);
  if (!r) return;
  const { isMainTab: o, isSecondaryTab: n } = await Re(e.tabId, e.tabId);
  if (!o && !n) return;
  (await Vt(e.tabId)).context.permissionManager;
  try {
    const t = await Be(e.tabId, e.url);
    if ("category1" === t) {
      const t = Oe(e.url);
      return (
        await chrome.tabs.update(e.tabId, { url: t }),
        r?.errorCallback &&
          r.errorCallback(
            "Cannot access this page. Computer Control cannot assist with the content on this page.",
          ),
        void rr(e.tabId)
      );
    }
    await chrome.tabs.get(e.tabId);
    return void 0;
  } catch (i) {}
});

// ============================================================================
// EXPORTS - Key exports used by service-worker.js:
//   L (nr) = notifyDisconnection
//   t (K)  = TabGroupManager (singleton)
//   M (Xt) = createErrorResponse
//   N (Qt) = executeToolRequest
//   J (re) = CDPDebugger instance
// ============================================================================
export {
  Ce as A,
  W as B,
  Me as C,
  De as D,
  B as E,
  U as F,
  ye as G,
  we as H,
  G as I,
  re as J,
  $ as K,
  nr as L,
  Xt as M,
  Qt as N,
  Re as a,
  d as b,
  Ue as c,
  Oe as d,
  Ge as e,
  $e as f,
  D as g,
  qe as h,
  de as j,
  ie as k,
  Y as l,
  he as m,
  be as n,
  Ie as o,
  O as p,
  ge as q,
  le as r,
  P as s,
  K as t,
  Be as u,
  me as v,
  Te as w,
  ke as x,
  _e as y,
  Ee as z,
};
