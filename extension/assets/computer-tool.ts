/**
 * computer-tool.ts - Computer tool for browser automation
 *
 * Contains the main computer tool (ie) and helper functions:
 * - scaleCoordinates: coordinate scaling
 * - scrollAtCoordinates: scroll helper
 * - getElementCoordinates: get element coordinates from ref
 * - handleClick: click action handler
 * - captureScreenshot: screenshot capture
 * - getScrollPosition: get scroll position
 */

import { re, Q } from "./cdp-debugger.js";
import { K } from "./tab-group-manager.js";
import { T as ToolTypes } from "./storage.js";
import { generateId, checkNavigationInterception } from "./utils.js";

// =============================================================================
// Type Definitions
// =============================================================================

/** Coordinate pair [x, y] */
type Coordinate = [number, number];

/** Region for zoom [x0, y0, x1, y1] */
type Region = [number, number, number, number];

/** Scroll direction options */
type ScrollDirection = "up" | "down" | "left" | "right";

/** Mouse button types */
type MouseButton = "left" | "right" | "none";

/** Computer tool action types */
type ComputerAction =
  | "left_click"
  | "right_click"
  | "type"
  | "screenshot"
  | "wait"
  | "scroll"
  | "key"
  | "left_click_drag"
  | "double_click"
  | "triple_click"
  | "zoom"
  | "scroll_to"
  | "hover";

/** Indicator state for tabs */
type IndicatorState = "none" | "pulsing" | "static";

/** Screenshot context for coordinate scaling */
interface ScalingContext {
  viewportWidth: number;
  viewportHeight: number;
  screenshotWidth: number;
  screenshotHeight: number;
}

/** Result from getElementCoordinates */
interface ElementCoordinatesResult {
  success: boolean;
  coordinates?: Coordinate;
  error?: string;
}

/** Parameters for computer tool actions */
interface ComputerToolParams {
  action?: ComputerAction;
  coordinate?: Coordinate;
  text?: string;
  duration?: number;
  scroll_direction?: ScrollDirection;
  scroll_amount?: number;
  start_coordinate?: Coordinate;
  region?: Region;
  repeat?: number;
  ref?: string;
  modifiers?: string;
  tabId?: number;
}

/** Execution context for computer tool */
interface ExecutionContext {
  tabId?: number;
  toolUseId?: string;
  permissionManager: {
    checkPermission: (
      url: string,
      toolUseId?: string
    ) => Promise<{ allowed: boolean; needsPrompt?: boolean }>;
  };
}

/** Screenshot result from CDPDebugger */
interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  format: string;
  viewportWidth?: number;
  viewportHeight?: number;
}

/** Tool result with possible error or output */
interface ToolResult {
  output?: string;
  error?: string;
  base64Image?: string;
  imageFormat?: string;
  imageId?: string;
  type?: string;
  tool?: string;
  url?: string;
  toolUseId?: string;
  actionData?: {
    screenshot?: string;
    coordinate?: Coordinate;
    text?: string;
    start_coordinate?: Coordinate;
  };
  tabContext?: {
    currentTabId?: number;
    executedOnTabId: number;
    availableTabs: TabMetadata[];
    tabCount: number;
  };
}

/** Tab metadata for results */
interface TabMetadata {
  id: number;
  title: string;
  url: string;
}

/** Scroll position result */
interface ScrollPosition {
  x: number;
  y: number;
}

/** Tool parameter schema definition */
interface ParameterSchema {
  type: string;
  enum?: string[];
  items?: { type: string };
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  description?: string;
}

/** Tool definition interface */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  execute: (params: ComputerToolParams, context: ExecutionContext) => Promise<ToolResult>;
  toAnthropicSchema: () => Promise<{
    name: string;
    description: string;
    input_schema: {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
  }>;
}

/** Modifier key name */
type ModifierKey =
  | "alt"
  | "ctrl"
  | "control"
  | "meta"
  | "cmd"
  | "command"
  | "win"
  | "windows"
  | "shift";

/** Mouse event parameters for CDP */
interface MouseEventParams {
  type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
  x: number;
  y: number;
  button: MouseButton | "left";
  buttons: number;
  modifiers?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Scale coordinates based on viewport vs screenshot dimensions
 */
export function scaleCoordinates(
  x: number,
  y: number,
  context: ScalingContext
): Coordinate {
  const scaleX = context.viewportWidth / context.screenshotWidth;
  const scaleY = context.viewportHeight / context.screenshotHeight;
  return [Math.round(x * scaleX), Math.round(y * scaleY)];
}

/**
 * Scroll at coordinates using scripting API
 */
export async function scrollAtCoordinates(
  tabId: number,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (dx: number, dy: number, px: number, py: number) => {
      const element = document.elementFromPoint(px, py);
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
        let scrollTarget: Element | null = element;
        while (scrollTarget && !isScrollable(scrollTarget)) {
          scrollTarget = scrollTarget.parentElement;
        }
        if (scrollTarget && isScrollable(scrollTarget)) {
          scrollTarget.scrollBy({ left: dx, top: dy, behavior: "instant" });
          return;
        }
      }
      window.scrollBy({ left: dx, top: dy, behavior: "instant" });
    },
    args: [deltaX, deltaY, x, y],
  });
}

/**
 * Get element coordinates from ref ID
 */
export async function getElementCoordinates(
  tabId: number,
  ref: string
): Promise<ElementCoordinatesResult> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (refId: string) => {
        try {
          let element: Element | null = null;
          const elementMap = (window as Window & { __claudeElementMap?: Record<string, WeakRef<Element>> }).__claudeElementMap;
          if (elementMap && elementMap[refId]) {
            element = elementMap[refId].deref() || null;
            if (!element || !document.contains(element)) {
              delete elementMap[refId];
              element = null;
            }
          }
          if (!element) {
            return {
              success: false,
              error: `No element found with reference: "${refId}". The element may have been removed from the page.`,
            };
          }
          element.scrollIntoView({
            behavior: "instant",
            block: "center",
            inline: "center",
          });
          if (element instanceof HTMLElement) element.offsetHeight; // Force reflow
          const rect = element.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          return { success: true, coordinates: [centerX, centerY] as [number, number] };
        } catch (err) {
          return {
            success: false,
            error: `Error getting element coordinates: ${err instanceof Error ? err.message : "Unknown error"}`,
          };
        }
      },
      args: [ref],
    });
    if (!results || results.length === 0) {
      return {
        success: false,
        error: "Failed to execute script to get element coordinates",
      };
    }
    return results[0].result as ElementCoordinatesResult;
  } catch (err) {
    return {
      success: false,
      error: `Failed to get element coordinates from ref: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Parse modifier string to bitmask
 */
function parseModifiers(modifiers: string[]): number {
  const modifierMap: Record<ModifierKey, number> = {
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
  let mask = 0;
  for (const mod of modifiers) {
    mask |= modifierMap[mod as ModifierKey] || 0;
  }
  return mask;
}

/**
 * Extract modifier keys from string
 */
function extractModifiers(modifierString: string): string[] {
  const parts = modifierString.toLowerCase().split("+");
  const validMods = [
    "ctrl", "control", "alt", "shift", "cmd", "meta", "command", "win", "windows"
  ];
  return parts.filter((p) => validMods.includes(p.trim()));
}

/**
 * Click action handler
 */
export async function handleClick(
  tabId: number,
  params: ComputerToolParams,
  clickCount: number = 1,
  originalUrl?: string
): Promise<ToolResult> {
  let x: number;
  let y: number;

  if (params.ref) {
    const result = await getElementCoordinates(tabId, params.ref);
    if (!result.success) return { error: result.error };
    [x, y] = result.coordinates!;
  } else {
    if (!params.coordinate) {
      throw new Error("Either ref or coordinate parameter is required for click action");
    }
    [x, y] = params.coordinate;
    const context = Q.getContext(tabId) as ScalingContext | undefined;
    if (context) {
      [x, y] = scaleCoordinates(x, y, context);
    }
  }

  const button: "left" | "right" = params.action === "right_click" ? "right" : "left";
  let modifiers = 0;

  if (params.modifiers) {
    modifiers = parseModifiers(extractModifiers(params.modifiers));
  }

  try {
    const navCheck = await checkNavigationInterception(tabId, originalUrl, "click action");
    if (navCheck) return navCheck;

    await re.click(tabId, x, y, button, clickCount, modifiers);

    const clickType =
      clickCount === 1 ? "Clicked" :
      clickCount === 2 ? "Double-clicked" : "Triple-clicked";

    return params.ref
      ? { output: `${clickType} on element ${params.ref}` }
      : { output: `${clickType} at (${Math.round(params.coordinate![0])}, ${Math.round(params.coordinate![1])})` };
  } catch (err) {
    return {
      error: `Error clicking: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Screenshot capture
 */
export async function captureScreenshot(tabId: number): Promise<ToolResult> {
  try {
    const screenshotResult: ScreenshotResult = await re.screenshot(tabId);
    const imageId = generateId();
    console.info(`[Computer Tool] Generated screenshot ID: ${imageId}`);
    console.info(
      `[Computer Tool] Screenshot dimensions: ${screenshotResult.width}x${screenshotResult.height}`
    );
    return {
      output: `Successfully captured screenshot (${screenshotResult.width}x${screenshotResult.height}, ${screenshotResult.format}) - ID: ${imageId}`,
      base64Image: screenshotResult.base64,
      imageFormat: screenshotResult.format,
      imageId,
    };
  } catch (err) {
    return {
      error: `Error capturing screenshot: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Get scroll position
 */
export async function getScrollPosition(tabId: number): Promise<ScrollPosition> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      x: window.pageXOffset || document.documentElement.scrollLeft,
      y: window.pageYOffset || document.documentElement.scrollTop,
    }),
  });
  if (!results || !results[0]?.result) {
    throw new Error("Failed to get scroll position");
  }
  return results[0].result as ScrollPosition;
}

/**
 * Get permission type for action
 */
function getPermissionType(action: ComputerAction): string {
  const permissionMap: Record<ComputerAction, string> = {
    screenshot: ToolTypes.READ_PAGE_CONTENT,
    scroll: ToolTypes.READ_PAGE_CONTENT,
    scroll_to: ToolTypes.READ_PAGE_CONTENT,
    zoom: ToolTypes.READ_PAGE_CONTENT,
    hover: ToolTypes.READ_PAGE_CONTENT,
    left_click: ToolTypes.CLICK,
    right_click: ToolTypes.CLICK,
    double_click: ToolTypes.CLICK,
    triple_click: ToolTypes.CLICK,
    left_click_drag: ToolTypes.CLICK,
    type: ToolTypes.TYPE,
    key: ToolTypes.TYPE,
    wait: ToolTypes.READ_PAGE_CONTENT, // Not actually checked, but needed for completeness
  };
  const permType = permissionMap[action];
  if (!permType) throw new Error(`Unsupported action: ${action}`);
  return permType;
}

/**
 * Helper for post-scroll screenshot
 */
async function captureScrollScreenshot(
  tabId: number,
  permissionManager: ExecutionContext["permissionManager"]
): Promise<{ base64Image: string; imageFormat: string } | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return;
    const permResult = await permissionManager.checkPermission(tab.url, undefined);
    if (!permResult.allowed) return;
    try {
      const screenshot = await captureScreenshot(tabId);
      return {
        base64Image: screenshot.base64Image!,
        imageFormat: screenshot.imageFormat || "png",
      };
    } catch {
      return;
    }
  } catch {
    return;
  }
}

// =============================================================================
// Action Handlers
// =============================================================================

/**
 * Type action handler
 */
async function handleType(
  tabId: number,
  params: ComputerToolParams,
  originalUrl?: string
): Promise<ToolResult> {
  if (!params.text) {
    throw new Error("Text parameter is required for type action");
  }
  try {
    const navCheck = await checkNavigationInterception(tabId, originalUrl, "type action");
    if (navCheck) return navCheck;
    await re.type(tabId, params.text);
    return { output: `Typed "${params.text}"` };
  } catch (err) {
    return {
      error: `Failed to type: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Wait action handler
 */
async function handleWait(params: ComputerToolParams): Promise<ToolResult> {
  if (!params.duration || params.duration <= 0) {
    throw new Error("Duration parameter is required and must be positive");
  }
  if (params.duration > 30) {
    throw new Error("Duration cannot exceed 30 seconds");
  }
  const ms = Math.round(1000 * params.duration);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return {
    output: `Waited for ${params.duration} second${params.duration === 1 ? "" : "s"}`,
  };
}

/**
 * Scroll action handler
 */
async function handleScroll(
  tabId: number,
  params: ComputerToolParams,
  permissionManager: ExecutionContext["permissionManager"]
): Promise<ToolResult> {
  if (!params.coordinate || params.coordinate.length !== 2) {
    throw new Error("Coordinate parameter is required for scroll action");
  }

  let [x, y] = params.coordinate;
  const context = Q.getContext(tabId) as ScalingContext | undefined;
  if (context) {
    [x, y] = scaleCoordinates(x, y, context);
  }

  const direction = params.scroll_direction || "down";
  const amount = params.scroll_amount || 3;

  try {
    let deltaX = 0;
    let deltaY = 0;
    const tickSize = 100;

    switch (direction) {
      case "up": deltaY = -amount * tickSize; break;
      case "down": deltaY = amount * tickSize; break;
      case "left": deltaX = -amount * tickSize; break;
      case "right": deltaX = amount * tickSize; break;
      default: throw new Error(`Invalid scroll direction: ${direction}`);
    }

    const beforeScroll = await getScrollPosition(tabId);
    const tab = await chrome.tabs.get(tabId);

    if (tab.active ?? false) {
      try {
        const cdpPromise = re.scrollWheel(tabId, x, y, deltaX, deltaY);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Scroll timeout")), 5000);
        });
        await Promise.race([cdpPromise, timeoutPromise]);
        await new Promise((resolve) => setTimeout(resolve, 200));

        const afterScroll = await getScrollPosition(tabId);
        if (!(Math.abs(afterScroll.x - beforeScroll.x) > 5 || Math.abs(afterScroll.y - beforeScroll.y) > 5)) {
          throw new Error("CDP scroll ineffective");
        }
      } catch {
        await scrollAtCoordinates(tabId, x, y, deltaX, deltaY);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } else {
      await scrollAtCoordinates(tabId, x, y, deltaX, deltaY);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const screenshot = await captureScrollScreenshot(tabId, permissionManager);
    return {
      output: `Scrolled ${direction} by ${amount} ticks at (${x}, ${y})`,
      ...(screenshot && {
        base64Image: screenshot.base64Image,
        imageFormat: screenshot.imageFormat,
      }),
    };
  } catch (err) {
    return {
      error: `Error scrolling: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Key action handler
 */
async function handleKey(
  tabId: number,
  params: ComputerToolParams,
  originalUrl?: string
): Promise<ToolResult> {
  if (!params.text) {
    throw new Error("Text parameter is required for key action");
  }

  const repeat = params.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error("Repeat parameter must be a positive integer");
  }
  if (repeat > 100) {
    throw new Error("Repeat parameter cannot exceed 100");
  }

  try {
    const navCheck = await checkNavigationInterception(tabId, originalUrl, "key action");
    if (navCheck) return navCheck;

    const keyInputs = params.text.trim().split(/\s+/).filter((k) => k.length > 0);
    console.info({ keyInputs });

    // Handle refresh shortcuts
    if (keyInputs.length === 1) {
      const key = keyInputs[0].toLowerCase();
      if (["cmd+r", "cmd+shift+r", "ctrl+r", "ctrl+shift+r", "f5", "ctrl+f5", "shift+f5"].includes(key)) {
        const hardReload = ["cmd+shift+r", "ctrl+shift+r", "ctrl+f5", "shift+f5"].includes(key);
        await chrome.tabs.reload(tabId, { bypassCache: hardReload });
        const reloadType = hardReload ? "hard reload" : "reload";
        return { output: `Executed ${keyInputs[0]} (${reloadType} page)` };
      }
    }

    for (let i = 0; i < repeat; i++) {
      for (const key of keyInputs) {
        if (key.includes("+")) {
          await re.pressKeyChord(tabId, key);
        } else {
          const keyCode = re.getKeyCode(key);
          if (keyCode) {
            await re.pressKey(tabId, keyCode);
          } else {
            await re.insertText(tabId, key);
          }
        }
      }
    }

    const repeatSuffix = repeat > 1 ? ` (repeated ${repeat} times)` : "";
    return {
      output: `Pressed ${keyInputs.length} key${keyInputs.length === 1 ? "" : "s"}: ${keyInputs.join(" ")}${repeatSuffix}`,
    };
  } catch (err) {
    return {
      error: `Error pressing key: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Drag action handler
 */
async function handleDrag(
  tabId: number,
  params: ComputerToolParams,
  originalUrl?: string
): Promise<ToolResult> {
  if (!params.start_coordinate || params.start_coordinate.length !== 2) {
    throw new Error("start_coordinate parameter is required for left_click_drag action");
  }
  if (!params.coordinate || params.coordinate.length !== 2) {
    throw new Error("coordinate parameter (end position) is required for left_click_drag action");
  }

  let [startX, startY] = params.start_coordinate;
  let [endX, endY] = params.coordinate;

  const context = Q.getContext(tabId) as ScalingContext | undefined;
  if (context) {
    [startX, startY] = scaleCoordinates(startX, startY, context);
    [endX, endY] = scaleCoordinates(endX, endY, context);
  }

  try {
    const navCheck = await checkNavigationInterception(tabId, originalUrl, "drag action");
    if (navCheck) return navCheck;

    await re.dispatchMouseEvent(tabId, {
      type: "mouseMoved",
      x: startX,
      y: startY,
      button: "none",
      buttons: 0,
      modifiers: 0,
    } as MouseEventParams);
    await re.dispatchMouseEvent(tabId, {
      type: "mousePressed",
      x: startX,
      y: startY,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    } as MouseEventParams);
    await re.dispatchMouseEvent(tabId, {
      type: "mouseMoved",
      x: endX,
      y: endY,
      button: "left",
      buttons: 1,
      modifiers: 0,
    } as MouseEventParams);
    await re.dispatchMouseEvent(tabId, {
      type: "mouseReleased",
      x: endX,
      y: endY,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers: 0,
    } as MouseEventParams);

    return { output: `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})` };
  } catch (err) {
    return {
      error: `Error performing drag: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Zoom action handler
 */
async function handleZoom(
  tabId: number,
  params: ComputerToolParams
): Promise<ToolResult> {
  if (!params.region || params.region.length !== 4) {
    throw new Error("Region parameter is required for zoom action and must be [x0, y0, x1, y1]");
  }

  let [x0, y0, x1, y1] = params.region;
  if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) {
    throw new Error("Invalid region coordinates: x0 and y0 must be non-negative, and x1 > x0, y1 > y0");
  }

  try {
    const context = Q.getContext(tabId) as ScalingContext | undefined;
    if (context) {
      [x0, y0] = scaleCoordinates(x0, y0, context);
      [x1, y1] = scaleCoordinates(x1, y1, context);
    }

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

    const { width, height } = viewportResult[0].result as { width: number; height: number };
    if (x1 > width || y1 > height) {
      throw new Error(
        `Region exceeds viewport boundaries (${width}x${height}). Please choose a region within the visible viewport.`
      );
    }

    const regionWidth = x1 - x0;
    const regionHeight = y1 - y0;

    const screenshotData = await re.sendCommand(tabId, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
      clip: { x: x0, y: y0, width: regionWidth, height: regionHeight, scale: 1 },
    }) as { data?: string };

    if (!screenshotData || !screenshotData.data) {
      throw new Error("Failed to capture zoomed screenshot via CDP");
    }

    return {
      output: `Successfully captured zoomed screenshot of region (${x0},${y0}) to (${x1},${y1}) - ${regionWidth}x${regionHeight} pixels`,
      base64Image: screenshotData.data,
      imageFormat: "png",
    };
  } catch (err) {
    return {
      error: `Error capturing zoomed screenshot: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Scroll to element handler
 */
async function handleScrollTo(
  tabId: number,
  params: ComputerToolParams,
  originalUrl?: string
): Promise<ToolResult> {
  if (!params.ref) {
    throw new Error("ref parameter is required for scroll_to action");
  }

  try {
    const navCheck = await checkNavigationInterception(tabId, originalUrl, "scroll_to action");
    if (navCheck) return navCheck;

    const result = await getElementCoordinates(tabId, params.ref);
    if (!result.success) {
      return { error: result.error };
    }

    return { output: `Scrolled to element with reference: ${params.ref}` };
  } catch (err) {
    return {
      error: `Failed to scroll to element: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Hover action handler
 */
async function handleHover(
  tabId: number,
  params: ComputerToolParams,
  originalUrl?: string
): Promise<ToolResult> {
  let x: number;
  let y: number;

  if (params.ref) {
    const result = await getElementCoordinates(tabId, params.ref);
    if (!result.success) return { error: result.error };
    [x, y] = result.coordinates!;
  } else {
    if (!params.coordinate) {
      throw new Error("Either ref or coordinate parameter is required for hover action");
    }
    [x, y] = params.coordinate;
    const context = Q.getContext(tabId) as ScalingContext | undefined;
    if (context) {
      [x, y] = scaleCoordinates(x, y, context);
    }
  }

  try {
    const navCheck = await checkNavigationInterception(tabId, originalUrl, "hover action");
    if (navCheck) return navCheck;

    await re.dispatchMouseEvent(tabId, {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
      modifiers: 0,
    } as MouseEventParams);

    return params.ref
      ? { output: `Hovered over element ${params.ref}` }
      : { output: `Hovered at (${Math.round(params.coordinate![0])}, ${Math.round(params.coordinate![1])})` };
  } catch (err) {
    return {
      error: `Error hovering: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

// =============================================================================
// Computer Tool Definition
// =============================================================================

/**
 * Computer tool definition (ie)
 */
export const computerTool: ToolDefinition = {
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
  execute: async (params: ComputerToolParams, context: ExecutionContext): Promise<ToolResult> => {
    try {
      const args = params || {};
      if (!args.action) throw new Error("Action parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const effectiveTabId = await K.getEffectiveTabId(args.tabId, context.tabId);
      const tab = await chrome.tabs.get(effectiveTabId);
      if (!tab.id) throw new Error("Active tab has no ID");

      // Permission check for non-wait actions
      if (!["wait"].includes(args.action)) {
        const url = tab.url;
        if (!url) throw new Error("No URL available for active tab");

        const permType = getPermissionType(args.action);
        const toolUseId = context?.toolUseId;
        const permResult = await context.permissionManager.checkPermission(url, toolUseId);

        if (!permResult.allowed) {
          if (permResult.needsPrompt) {
            const result: ToolResult = {
              type: "permission_required",
              tool: permType,
              url,
              toolUseId,
            };
            // Add screenshot for click actions
            if (["left_click", "right_click", "double_click", "triple_click"].includes(args.action)) {
              try {
                const screenshot: ScreenshotResult = await re.screenshot(effectiveTabId);
                result.actionData = {
                  screenshot: `data:image/${screenshot.format};base64,${screenshot.base64}`,
                };
                if (args.coordinate) result.actionData.coordinate = args.coordinate;
              } catch {
                result.actionData = {};
                if (args.coordinate) result.actionData.coordinate = args.coordinate;
              }
            } else if (args.action === "type" && args.text) {
              result.actionData = { text: args.text };
            } else if (args.action === "left_click_drag" && args.start_coordinate && args.coordinate) {
              result.actionData = {
                start_coordinate: args.start_coordinate,
                coordinate: args.coordinate,
              };
            }
            return result;
          }
          return { error: "Permission denied for this action on this domain" };
        }
      }

      const originalUrl = tab.url;
      let result: ToolResult;

      switch (args.action) {
        case "left_click":
        case "right_click":
          result = await handleClick(effectiveTabId, args, 1, originalUrl);
          break;

        case "type":
          result = await handleType(effectiveTabId, args, originalUrl);
          break;

        case "screenshot":
          result = await captureScreenshot(effectiveTabId);
          break;

        case "wait":
          result = await handleWait(args);
          break;

        case "scroll":
          result = await handleScroll(effectiveTabId, args, context.permissionManager);
          break;

        case "key":
          result = await handleKey(effectiveTabId, args, originalUrl);
          break;

        case "left_click_drag":
          result = await handleDrag(effectiveTabId, args, originalUrl);
          break;

        case "double_click":
          result = await handleClick(effectiveTabId, args, 2, originalUrl);
          break;

        case "triple_click":
          result = await handleClick(effectiveTabId, args, 3, originalUrl);
          break;

        case "zoom":
          result = await handleZoom(effectiveTabId, args);
          break;

        case "scroll_to":
          result = await handleScrollTo(effectiveTabId, args, originalUrl);
          break;

        case "hover":
          result = await handleHover(effectiveTabId, args, originalUrl);
          break;

        default:
          throw new Error(`Unsupported action: ${args.action}`);
      }

      const tabsMetadata = await K.getValidTabsWithMetadata(context.tabId);
      return {
        ...result,
        tabContext: {
          currentTabId: context.tabId,
          executedOnTabId: effectiveTabId,
          availableTabs: tabsMetadata,
          tabCount: tabsMetadata.length,
        },
      };
    } catch (err) {
      return {
        error: `Failed to execute action: ${err instanceof Error ? err.message : "Unknown error"}`,
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
            "left_click", "right_click", "type", "screenshot", "wait",
            "scroll", "key", "left_click_drag", "double_click",
            "triple_click", "zoom", "scroll_to", "hover",
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

// Alias for backward compatibility
export { computerTool as ie };
