// @ts-nocheck
/**
 * cdp-debugger.ts - Chrome DevTools Protocol Debugger
 *
 * This module handles CDP-based browser automation including:
 * - Console message capture
 * - Network request tracking
 * - Mouse/keyboard input simulation
 * - Screenshot capture
 *
 * EXPORTS:
 *   cdpDebugger = CDPDebugger singleton instance (exported as 're' for compatibility)
 *   setTabGroupManager = function to inject TabGroupManager dependency
 *   screenshotContext = ScreenshotContext singleton (exported as 'Q' for compatibility)
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** CDP debugger target identifier */
interface DebuggerTarget {
  tabId: number;
}

/** Keyboard key definition for CDP Input events */
interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
  isKeypad?: boolean;
  windowsVirtualKeyCode?: number;
  location?: number;
}

/** Mouse event parameters for CDP Input.dispatchMouseEvent */
interface MouseEventParams {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  x: number;
  y: number;
  button?: 'none' | 'left' | 'right' | 'middle';
  buttons?: number;
  clickCount?: number;
  modifiers?: number;
  deltaX?: number;
  deltaY?: number;
}

/** Key event parameters for CDP Input.dispatchKeyEvent */
interface KeyEventParams {
  type: 'keyDown' | 'rawKeyDown' | 'keyUp' | 'char';
  key?: string;
  code?: string;
  windowsVirtualKeyCode?: number;
  modifiers?: number;
  text?: string;
  unmodifiedText?: string;
  location?: number;
  commands?: string[];
  isKeypad?: boolean;
}

/** Console message from Runtime.consoleAPICalled */
interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  args?: Array<{ value?: unknown; description?: string }>;
  stackTrace?: string;
}

/** Network request from Network.requestWillBeSent */
interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  status?: number;
}

/** Console messages grouped by domain for a tab */
interface TabConsoleData {
  domain: string;
  messages: ConsoleMessage[];
}

/** Network requests grouped by domain for a tab */
interface TabNetworkData {
  domain: string;
  requests: NetworkRequest[];
}

/** Screenshot resize parameters */
interface ResizeParams {
  pxPerToken: number;
  maxTargetPx: number;
  maxTargetTokens: number;
}

/** Screenshot result */
interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  viewportWidth: number;
  viewportHeight: number;
}

/** Screenshot context data */
interface ScreenshotContextData {
  viewportWidth: number;
  viewportHeight: number;
  screenshotWidth: number;
  screenshotHeight: number;
}

/** TabGroupManager interface (injected dependency) */
interface TabGroupManager {
  hideIndicatorForToolUse(tabId: number): Promise<void>;
  restoreIndicatorAfterToolUse(tabId: number): Promise<void>;
}

// TabGroupManager reference (injected from mcp-tools.js)
let tabGroupManager: TabGroupManager | null = null;

/**
 * Set the TabGroupManager dependency
 * @param manager - The TabGroupManager singleton (K from mcp-tools.js)
 */
export function setTabGroupManager(manager: TabGroupManager): void {
  tabGroupManager = manager;
}

// ============================================================================
// Screenshot resize helper functions
// ============================================================================

/**
 * Calculate number of tokens for a dimension
 */
function calculateTokensForDimension(pixels: number, pixelsPerToken: number): number {
  return Math.floor((pixels - 1) / pixelsPerToken) + 1;
}

/**
 * Calculate total tokens for an image
 */
function calculateTotalTokens(width: number, height: number, pixelsPerToken: number): number {
  return calculateTokensForDimension(width, pixelsPerToken) * calculateTokensForDimension(height, pixelsPerToken);
}

/**
 * Calculate optimal resize dimensions within token/pixel limits
 */
function calculateOptimalDimensions(
  width: number,
  height: number,
  params: ResizeParams
): [number, number] {
  const { pxPerToken: pixelsPerToken, maxTargetPx: maxPixels, maxTargetTokens: maxTokens } = params;

  // If already within limits, return as-is
  if (width <= maxPixels && height <= maxPixels && calculateTotalTokens(width, height, pixelsPerToken) <= maxTokens) {
    return [width, height];
  }

  // Handle portrait orientation by swapping and recursing
  if (height > width) {
    const [newHeight, newWidth] = calculateOptimalDimensions(height, width, params);
    return [newWidth, newHeight];
  }

  const aspectRatio = width / height;
  let maxWidth = width;
  let minWidth = 1;

  // Binary search for optimal width
  for (;;) {
    if (minWidth + 1 === maxWidth) {
      return [minWidth, Math.max(Math.round(minWidth / aspectRatio), 1)];
    }

    const midWidth = Math.floor((minWidth + maxWidth) / 2);
    const midHeight = Math.max(Math.round(midWidth / aspectRatio), 1);

    if (midWidth <= maxPixels && calculateTotalTokens(midWidth, midHeight, pixelsPerToken) <= maxTokens) {
      minWidth = midWidth;
    } else {
      maxWidth = midWidth;
    }
  }
}

// ============================================================================
// ScreenshotContext - Tracks viewport/screenshot dimensions per tab
// ============================================================================
const screenshotContext = new (class ScreenshotContext {
  private contexts = new Map<number, ScreenshotContextData>();

  setContext(tabId: number, result: ScreenshotResult): void {
    if (result.viewportWidth && result.viewportHeight) {
      const contextData: ScreenshotContextData = {
        viewportWidth: result.viewportWidth,
        viewportHeight: result.viewportHeight,
        screenshotWidth: result.width,
        screenshotHeight: result.height,
      };
      this.contexts.set(tabId, contextData);
    }
  }

  getContext(tabId: number): ScreenshotContextData | undefined {
    return this.contexts.get(tabId);
  }

  clearContext(tabId: number): void {
    this.contexts.delete(tabId);
  }

  clearAllContexts(): void {
    this.contexts.clear();
  }
})();

// Export ScreenshotContext for use in mcp-tools.js
export { screenshotContext as Q };

// ============================================================================
// Global CDP state initialization
// ============================================================================
declare global {
  var __cdpDebuggerListenerRegistered: boolean;
  var __cdpConsoleMessagesByTab: Map<number, TabConsoleData>;
  var __cdpNetworkRequestsByTab: Map<number, TabNetworkData>;
  var __cdpNetworkTrackingEnabled: Set<number>;
  var __cdpConsoleTrackingEnabled: Set<number>;
  var __cdpDebuggerEventHandler: ((source: DebuggerTarget, method: string, params: any) => void) | undefined;
}

(globalThis.__cdpDebuggerListenerRegistered ||
  (globalThis.__cdpDebuggerListenerRegistered = false),
  globalThis.__cdpConsoleMessagesByTab ||
    (globalThis.__cdpConsoleMessagesByTab = new Map()),
  globalThis.__cdpNetworkRequestsByTab ||
    (globalThis.__cdpNetworkRequestsByTab = new Map()),
  globalThis.__cdpNetworkTrackingEnabled ||
    (globalThis.__cdpNetworkTrackingEnabled = new Set()),
  globalThis.__cdpConsoleTrackingEnabled ||
    (globalThis.__cdpConsoleTrackingEnabled = new Set()));

// ============================================================================
// Keyboard mappings - Mac-specific key commands
// ============================================================================
const macKeyCommands: Record<string, string | string[]> = {
  backspace: "deleteBackward",
  enter: "insertNewline",
  numpadenter: "insertNewline",
  kp_enter: "insertNewline",
  escape: "cancelOperation",
  arrowup: "moveUp",
  arrowdown: "moveDown",
  arrowleft: "moveLeft",
  arrowRight: "moveRight",
  up: "moveUp",
  down: "moveDown",
  left: "moveLeft",
  right: "moveRight",
  f5: "complete",
  delete: "deleteForward",
  home: "scrollToBeginningOfDocument",
  end: "scrollToEndOfDocument",
  pageup: "scrollPageUp",
  pagedown: "scrollPageDown",
  "shift+backspace": "deleteBackward",
  "shift+enter": "insertNewline",
  "shift+escape": "cancelOperation",
  "shift+arrowup": "moveUpAndModifySelection",
  "shift+arrowdown": "moveDownAndModifySelection",
  "shift+arrowleft": "moveLeftAndModifySelection",
  "shift+arrowright": "moveRightAndModifySelection",
  "shift+up": "moveUpAndModifySelection",
  "shift+down": "moveDownAndModifySelection",
  "shift+left": "moveLeftAndModifySelection",
  "shift+right": "moveRightAndModifySelection",
  "shift+f5": "complete",
  "shift+delete": "deleteForward",
  "shift+home": "moveToBeginningOfDocumentAndModifySelection",
  "shift+end": "moveToEndOfDocumentAndModifySelection",
  "shift+pageup": "pageUpAndModifySelection",
  "shift+pagedown": "pageDownAndModifySelection",
  "shift+numpad5": "delete",
  "ctrl+tab": "selectNextKeyView",
  "ctrl+enter": "insertLineBreak",
  "ctrl+numpadenter": "insertLineBreak",
  "ctrl+kp_enter": "insertLineBreak",
  "ctrl+quote": "insertSingleQuoteIgnoringSubstitution",
  "ctrl+'": "insertSingleQuoteIgnoringSubstitution",
  "ctrl+a": "moveToBeginningOfParagraph",
  "ctrl+b": "moveBackward",
  "ctrl+d": "deleteForward",
  "ctrl+e": "moveToEndOfParagraph",
  "ctrl+f": "moveForward",
  "ctrl+h": "deleteBackward",
  "ctrl+k": "deleteToEndOfParagraph",
  "ctrl+l": "centerSelectionInVisibleArea",
  "ctrl+n": "moveDown",
  "ctrl+p": "moveUp",
  "ctrl+t": "transpose",
  "ctrl+v": "moveUp",
  "ctrl+y": "yank",
  "ctrl+o": ["insertNewlineIgnoringFieldEditor", "moveBackward"],
  "ctrl+backspace": "deleteBackwardByDecomposingPreviousCharacter",
  "ctrl+arrowup": "scrollPageUp",
  "ctrl+arrowdown": "scrollPageDown",
  "ctrl+arrowleft": "moveToLeftEndOfLine",
  "ctrl+arrowright": "moveToRightEndOfLine",
  "ctrl+up": "scrollPageUp",
  "ctrl+down": "scrollPageDown",
  "ctrl+left": "moveToLeftEndOfLine",
  "ctrl+right": "moveToRightEndOfLine",
  "shift+ctrl+enter": "insertLineBreak",
  "shift+control+numpadenter": "insertLineBreak",
  "shift+control+kp_enter": "insertLineBreak",
  "shift+ctrl+tab": "selectPreviousKeyView",
  "shift+ctrl+quote": "insertDoubleQuoteIgnoringSubstitution",
  "shift+ctrl+'": "insertDoubleQuoteIgnoringSubstitution",
  'ctrl+"': "insertDoubleQuoteIgnoringSubstitution",
  "shift+ctrl+a": "moveToBeginningOfParagraphAndModifySelection",
  "shift+ctrl+b": "moveBackwardAndModifySelection",
  "shift+ctrl+e": "moveToEndOfParagraphAndModifySelection",
  "shift+ctrl+f": "moveForwardAndModifySelection",
  "shift+ctrl+n": "moveDownAndModifySelection",
  "shift+ctrl+p": "moveUpAndModifySelection",
  "shift+ctrl+v": "pageDownAndModifySelection",
  "shift+ctrl+backspace": "deleteBackwardByDecomposingPreviousCharacter",
  "shift+ctrl+arrowup": "scrollPageUp",
  "shift+ctrl+arrowdown": "scrollPageDown",
  "shift+ctrl+arrowleft": "moveToLeftEndOfLineAndModifySelection",
  "shift+ctrl+arrowright": "moveToRightEndOfLineAndModifySelection",
  "shift+ctrl+up": "scrollPageUp",
  "shift+ctrl+down": "scrollPageDown",
  "shift+ctrl+left": "moveToLeftEndOfLineAndModifySelection",
  "shift+ctrl+right": "moveToRightEndOfLineAndModifySelection",
  "alt+backspace": "deleteWordBackward",
  "alt+enter": "insertNewlineIgnoringFieldEditor",
  "alt+numpadenter": "insertNewlineIgnoringFieldEditor",
  "alt+kp_enter": "insertNewlineIgnoringFieldEditor",
  "alt+escape": "complete",
  "alt+arrowup": ["moveBackward", "moveToBeginningOfParagraph"],
  "alt+arrowdown": ["moveForward", "moveToEndOfParagraph"],
  "alt+arrowleft": "moveWordLeft",
  "alt+arrowright": "moveWordRight",
  "alt+up": ["moveBackward", "moveToBeginningOfParagraph"],
  "alt+down": ["moveForward", "moveToEndOfParagraph"],
  "alt+left": "moveWordLeft",
  "alt+right": "moveWordRight",
  "alt+delete": "deleteWordForward",
  "alt+pageup": "pageUp",
  "alt+pagedown": "pageDown",
  "shift+alt+backspace": "deleteWordBackward",
  "shift+alt+enter": "insertNewlineIgnoringFieldEditor",
  "shift+alt+numpadenter": "insertNewlineIgnoringFieldEditor",
  "shift+alt+kp_enter": "insertNewlineIgnoringFieldEditor",
  "shift+alt+escape": "complete",
  "shift+alt+arrowup": "moveParagraphBackwardAndModifySelection",
  "shift+alt+arrowdown": "moveParagraphForwardAndModifySelection",
  "shift+alt+arrowleft": "moveWordLeftAndModifySelection",
  "shift+alt+arrowright": "moveWordRightAndModifySelection",
  "shift+alt+up": "moveParagraphBackwardAndModifySelection",
  "shift+alt+down": "moveParagraphForwardAndModifySelection",
  "shift+alt+left": "moveWordLeftAndModifySelection",
  "shift+alt+right": "moveWordRightAndModifySelection",
  "shift+alt+delete": "deleteWordForward",
  "shift+alt+pageup": "pageUp",
  "shift+alt+pagedown": "pageDown",
  "ctrl+alt+b": "moveWordBackward",
  "ctrl+alt+f": "moveWordForward",
  "ctrl+alt+backspace": "deleteWordBackward",
  "shift+ctrl+alt+b": "moveWordBackwardAndModifySelection",
  "shift+ctrl+alt+f": "moveWordForwardAndModifySelection",
  "shift+ctrl+alt+backspace": "deleteWordBackward",
  "cmd+numpadsubtract": "cancel",
  "cmd+backspace": "deleteToBeginningOfLine",
  "cmd+arrowup": "moveToBeginningOfDocument",
  "cmd+arrowdown": "moveToEndOfDocument",
  "cmd+arrowleft": "moveToLeftEndOfLine",
  "cmd+arrowright": "moveToRightEndOfLine",
  "cmd+home": "moveToBeginningOfDocument",
  "cmd+up": "moveToBeginningOfDocument",
  "cmd+down": "moveToEndOfDocument",
  "cmd+left": "moveToLeftEndOfLine",
  "cmd+right": "moveToRightEndOfLine",
  "shift+cmd+numpadsubtract": "cancel",
  "shift+cmd+backspace": "deleteToBeginningOfLine",
  "shift+cmd+arrowup": "moveToBeginningOfDocumentAndModifySelection",
  "shift+cmd+arrowdown": "moveToEndOfDocumentAndModifySelection",
  "shift+cmd+arrowleft": "moveToLeftEndOfLineAndModifySelection",
  "shift+cmd+arrowright": "moveToRightEndOfLineAndModifySelection",
  "cmd+a": "selectAll",
  "cmd+c": "copy",
  "cmd+x": "cut",
  "cmd+v": "paste",
  "cmd+z": "undo",
  "shift+cmd+z": "redo",
};

/** Key definitions for special keys and characters */
const keyDefinitions: Record<string, KeyDefinition> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  kp_enter: {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    text: "\r",
    isKeypad: true,
  },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  " ": { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  f1: { key: "F1", code: "F1", keyCode: 112 },
  f2: { key: "F2", code: "F2", keyCode: 113 },
  f3: { key: "F3", code: "F3", keyCode: 114 },
  f4: { key: "F4", code: "F4", keyCode: 115 },
  f5: { key: "F5", code: "F5", keyCode: 116 },
  f6: { key: "F6", code: "F6", keyCode: 117 },
  f7: { key: "F7", code: "F7", keyCode: 118 },
  f8: { key: "F8", code: "F8", keyCode: 119 },
  f9: { key: "F9", code: "F9", keyCode: 120 },
  f10: { key: "F10", code: "F10", keyCode: 121 },
  f11: { key: "F11", code: "F11", keyCode: 122 },
  f12: { key: "F12", code: "F12", keyCode: 123 },
  ";": { key: ";", code: "Semicolon", keyCode: 186, text: ";" },
  "=": { key: "=", code: "Equal", keyCode: 187, text: "=" },
  ",": { key: ",", code: "Comma", keyCode: 188, text: "," },
  "-": { key: "-", code: "Minus", keyCode: 189, text: "-" },
  ".": { key: ".", code: "Period", keyCode: 190, text: "." },
  "/": { key: "/", code: "Slash", keyCode: 191, text: "/" },
  "`": { key: "`", code: "Backquote", keyCode: 192, text: "`" },
  "[": { key: "[", code: "BracketLeft", keyCode: 219, text: "[" },
  "\\": { key: "\\", code: "Backslash", keyCode: 220, text: "\\" },
  "]": { key: "]", code: "BracketRight", keyCode: 221, text: "]" },
  "'": { key: "'", code: "Quote", keyCode: 222, text: "'" },
  "!": { key: "!", code: "Digit1", keyCode: 49, text: "!" },
  "@": { key: "@", code: "Digit2", keyCode: 50, text: "@" },
  "#": { key: "#", code: "Digit3", keyCode: 51, text: "#" },
  $: { key: "$", code: "Digit4", keyCode: 52, text: "$" },
  "%": { key: "%", code: "Digit5", keyCode: 53, text: "%" },
  "^": { key: "^", code: "Digit6", keyCode: 54, text: "^" },
  "&": { key: "&", code: "Digit7", keyCode: 55, text: "&" },
  "*": { key: "*", code: "Digit8", keyCode: 56, text: "*" },
  "(": { key: "(", code: "Digit9", keyCode: 57, text: "(" },
  ")": { key: ")", code: "Digit0", keyCode: 48, text: ")" },
  _: { key: "_", code: "Minus", keyCode: 189, text: "_" },
  "+": { key: "+", code: "Equal", keyCode: 187, text: "+" },
  "{": { key: "{", code: "BracketLeft", keyCode: 219, text: "{" },
  "}": { key: "}", code: "BracketRight", keyCode: 221, text: "}" },
  "|": { key: "|", code: "Backslash", keyCode: 220, text: "|" },
  ":": { key: ":", code: "Semicolon", keyCode: 186, text: ":" },
  '"': { key: '"', code: "Quote", keyCode: 222, text: '"' },
  "<": { key: "<", code: "Comma", keyCode: 188, text: "<" },
  ">": { key: ">", code: "Period", keyCode: 190, text: ">" },
  "?": { key: "?", code: "Slash", keyCode: 191, text: "?" },
  "~": { key: "~", code: "Backquote", keyCode: 192, text: "~" },
  capslock: { key: "CapsLock", code: "CapsLock", keyCode: 20 },
  numlock: { key: "NumLock", code: "NumLock", keyCode: 144 },
  scrolllock: { key: "ScrollLock", code: "ScrollLock", keyCode: 145 },
  pause: { key: "Pause", code: "Pause", keyCode: 19 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  printscreen: { key: "PrintScreen", code: "PrintScreen", keyCode: 44 },
  numpad0: { key: "0", code: "Numpad0", keyCode: 96, isKeypad: true },
  numpad1: { key: "1", code: "Numpad1", keyCode: 97, isKeypad: true },
  numpad2: { key: "2", code: "Numpad2", keyCode: 98, isKeypad: true },
  numpad3: { key: "3", code: "Numpad3", keyCode: 99, isKeypad: true },
  numpad4: { key: "4", code: "Numpad4", keyCode: 100, isKeypad: true },
  numpad5: { key: "5", code: "Numpad5", keyCode: 101, isKeypad: true },
  numpad6: { key: "6", code: "Numpad6", keyCode: 102, isKeypad: true },
  numpad7: { key: "7", code: "Numpad7", keyCode: 103, isKeypad: true },
  numpad8: { key: "8", code: "Numpad8", keyCode: 104, isKeypad: true },
  numpad9: { key: "9", code: "Numpad9", keyCode: 105, isKeypad: true },
  numpadmultiply: {
    key: "*",
    code: "NumpadMultiply",
    keyCode: 106,
    isKeypad: true,
  },
  numpadadd: { key: "+", code: "NumpadAdd", keyCode: 107, isKeypad: true },
  numpadsubtract: {
    key: "-",
    code: "NumpadSubtract",
    keyCode: 109,
    isKeypad: true,
  },
  numpaddecimal: {
    key: ".",
    code: "NumpadDecimal",
    keyCode: 110,
    isKeypad: true,
  },
  numpaddivide: {
    key: "/",
    code: "NumpadDivide",
    keyCode: 111,
    isKeypad: true,
  },
};

// ============================================================================
// CDPDebugger - Chrome DevTools Protocol debugger management
// Handles console message capture and network request tracking
// Singleton instance: cdpDebugger = new CDPDebugger()
// ============================================================================
class CDPDebugger {
  static MAX_LOGS_PER_TAB = 10000;
  static MAX_REQUESTS_PER_TAB = 1000;

  static get debuggerListenerRegistered(): boolean {
    return globalThis.__cdpDebuggerListenerRegistered;
  }

  static set debuggerListenerRegistered(value: boolean) {
    globalThis.__cdpDebuggerListenerRegistered = value;
  }

  static get consoleMessagesByTab(): Map<number, TabConsoleData> {
    return globalThis.__cdpConsoleMessagesByTab;
  }

  static get networkRequestsByTab(): Map<number, TabNetworkData> {
    return globalThis.__cdpNetworkRequestsByTab;
  }

  static get networkTrackingEnabled(): Set<number> {
    return globalThis.__cdpNetworkTrackingEnabled;
  }

  static get consoleTrackingEnabled(): Set<number> {
    return globalThis.__cdpConsoleTrackingEnabled;
  }

  isMac = false;

  constructor() {
    this.isMac =
      navigator.platform.toUpperCase().indexOf("MAC") >= 0 ||
      navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;
    this.initializeDebuggerEventListener();
  }

  registerDebuggerEventHandlers(): void {
    if (globalThis.__cdpDebuggerEventHandler) return;

    globalThis.__cdpDebuggerEventHandler = (
      source: DebuggerTarget,
      method: string,
      params: any
    ) => {
      const tabId = source.tabId;
      if (!tabId) return;

      // Handle Runtime.consoleAPICalled
      if (method === "Runtime.consoleAPICalled") {
        const consoleMessage: ConsoleMessage = {
          type: params.type || "log",
          text: params.args
            ?.map((arg: any) =>
              arg.value !== undefined ? String(arg.value) : arg.description || ""
            )
            .join(" "),
          timestamp: params.timestamp || Date.now(),
          url: params.stackTrace?.callFrames?.[0]?.url,
          lineNumber: params.stackTrace?.callFrames?.[0]?.lineNumber,
          columnNumber: params.stackTrace?.callFrames?.[0]?.columnNumber,
          args: params.args,
        };
        const domain = this.extractDomain(consoleMessage.url);
        this.addConsoleMessage(tabId, domain, consoleMessage);
      }

      // Handle Runtime.exceptionThrown
      if (method === "Runtime.exceptionThrown") {
        const exceptionDetails = params.exceptionDetails;
        const exceptionMessage: ConsoleMessage = {
          type: "exception",
          text:
            exceptionDetails?.exception?.description ||
            exceptionDetails?.text ||
            "Unknown exception",
          timestamp: exceptionDetails?.timestamp || Date.now(),
          url: exceptionDetails?.url,
          lineNumber: exceptionDetails?.lineNumber,
          columnNumber: exceptionDetails?.columnNumber,
          stackTrace: exceptionDetails?.stackTrace?.callFrames
            ?.map(
              (frame: any) =>
                `    at ${frame.functionName || "<anonymous>"} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`
            )
            .join("\n"),
        };
        const domain = this.extractDomain(exceptionMessage.url);
        this.addConsoleMessage(tabId, domain, exceptionMessage);
      }

      // Handle Network.requestWillBeSent
      if (method === "Network.requestWillBeSent") {
        const requestId = params.requestId;
        const request = params.request;
        const documentURL = params.documentURL;
        const networkRequest: NetworkRequest = {
          requestId,
          url: request.url,
          method: request.method,
        };
        const urlForDomain = documentURL || request.url;
        const domain = this.extractDomain(urlForDomain);
        this.addNetworkRequest(tabId, domain, networkRequest);
      }

      // Handle Network.responseReceived
      if (method === "Network.responseReceived") {
        const requestId = params.requestId;
        const response = params.response;
        const tabData = CDPDebugger.networkRequestsByTab.get(tabId);
        if (tabData) {
          const existingRequest = tabData.requests.find(
            (req) => req.requestId === requestId
          );
          if (existingRequest) {
            existingRequest.status = response.status;
          }
        }
      }

      // Handle Network.loadingFailed
      if (method === "Network.loadingFailed") {
        const requestId = params.requestId;
        const tabData = CDPDebugger.networkRequestsByTab.get(tabId);
        if (tabData) {
          const existingRequest = tabData.requests.find(
            (req) => req.requestId === requestId
          );
          if (existingRequest) {
            existingRequest.status = 503;
          }
        }
      }
    };

    chrome.debugger.onEvent.addListener(globalThis.__cdpDebuggerEventHandler);
  }

  initializeDebuggerEventListener(): void {
    if (CDPDebugger.debuggerListenerRegistered) return;
    CDPDebugger.debuggerListenerRegistered = true;
    this.registerDebuggerEventHandlers();
  }

  defaultResizeParams: ResizeParams = {
    pxPerToken: 28,
    maxTargetPx: 1568,
    maxTargetTokens: 1568,
  };

  static MAX_BASE64_CHARS = 1398100;
  static INITIAL_JPEG_QUALITY = 0.85;
  static JPEG_QUALITY_STEP = 0.05;
  static MIN_JPEG_QUALITY = 0.1;

  async attachDebugger(tabId: number): Promise<void> {
    const target: DebuggerTarget = { tabId };
    const hasNetworkTracking = CDPDebugger.networkTrackingEnabled.has(tabId);
    const hasConsoleTracking = CDPDebugger.consoleTrackingEnabled.has(tabId);

    try {
      await this.detachDebugger(tabId);
    } catch {}

    await new Promise<void>((resolve, reject) => {
      chrome.debugger.attach(target, "1.3", () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });

    this.registerDebuggerEventHandlers();

    if (hasConsoleTracking) {
      try {
        await this.sendCommand(tabId, "Runtime.enable");
      } catch {}
    }

    if (hasNetworkTracking) {
      try {
        await this.sendCommand(tabId, "Network.enable", { maxPostDataSize: 65536 });
      } catch {}
    }
  }

  async detachDebugger(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        resolve();
      });
    });
  }

  async isDebuggerAttached(tabId: number): Promise<boolean> {
    return new Promise((resolve) => {
      chrome.debugger.getTargets((targets) => {
        const target = targets.find((t) => t.tabId === tabId);
        resolve(target?.attached ?? false);
      });
    });
  }

  async sendCommand(tabId: number, method: string, params?: object): Promise<any> {
    try {
      return await new Promise((resolve, reject) => {
        chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.toLowerCase().includes("debugger is not attached")) {
        await this.attachDebugger(tabId);
        return new Promise((resolve, reject) => {
          chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(result);
            }
          });
        });
      }
      throw error;
    }
  }

  async dispatchMouseEvent(tabId: number, eventParams: MouseEventParams): Promise<void> {
    const cdpParams: any = {
      type: eventParams.type,
      x: Math.round(eventParams.x),
      y: Math.round(eventParams.y),
      modifiers: eventParams.modifiers || 0,
    };

    if (
      eventParams.type === "mousePressed" ||
      eventParams.type === "mouseReleased" ||
      eventParams.type === "mouseMoved"
    ) {
      cdpParams.button = eventParams.button || "none";
      if (eventParams.type === "mousePressed" || eventParams.type === "mouseReleased") {
        cdpParams.clickCount = eventParams.clickCount || 1;
      }
    }

    if (eventParams.type !== "mouseWheel") {
      cdpParams.buttons = eventParams.buttons !== undefined ? eventParams.buttons : 0;
    }

    if (
      eventParams.type === "mouseWheel" &&
      (eventParams.deltaX !== undefined || eventParams.deltaY !== undefined)
    ) {
      Object.assign(cdpParams, {
        deltaX: eventParams.deltaX || 0,
        deltaY: eventParams.deltaY || 0,
      });
    }

    await this.sendCommand(tabId, "Input.dispatchMouseEvent", cdpParams);
  }

  async dispatchKeyEvent(tabId: number, eventParams: KeyEventParams): Promise<void> {
    const cdpParams = { modifiers: 0, ...eventParams };
    await this.sendCommand(tabId, "Input.dispatchKeyEvent", cdpParams);
  }

  async insertText(tabId: number, text: string): Promise<void> {
    await this.sendCommand(tabId, "Input.insertText", { text });
  }

  async click(
    tabId: number,
    x: number,
    y: number,
    button: 'left' | 'right' | 'middle' = "left",
    clickCount: number = 1,
    modifiers: number = 0
  ): Promise<void> {
    if (tabGroupManager) {
      await tabGroupManager.hideIndicatorForToolUse(tabId);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      let buttonBitmask = 0;
      if (button === "left") {
        buttonBitmask = 1;
      } else if (button === "right") {
        buttonBitmask = 2;
      } else if (button === "middle") {
        buttonBitmask = 4;
      }

      await this.dispatchMouseEvent(tabId, {
        type: "mouseMoved",
        x,
        y,
        button: "none",
        buttons: 0,
        modifiers,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      for (let clickIndex = 1; clickIndex <= clickCount; clickIndex++) {
        await this.dispatchMouseEvent(tabId, {
          type: "mousePressed",
          x,
          y,
          button,
          buttons: buttonBitmask,
          clickCount: clickIndex,
          modifiers,
        });
        await new Promise((resolve) => setTimeout(resolve, 12));
        await this.dispatchMouseEvent(tabId, {
          type: "mouseReleased",
          x,
          y,
          button,
          buttons: 0,
          modifiers,
          clickCount: clickIndex,
        });
        if (clickIndex < clickCount) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    } finally {
      if (tabGroupManager) {
        await tabGroupManager.restoreIndicatorAfterToolUse(tabId);
      }
    }
  }

  async type(tabId: number, text: string): Promise<void> {
    for (const char of text) {
      let keyToPress = char;
      if (char === "\n" || char === "\r") {
        keyToPress = "Enter";
      }

      const keyDef = this.getKeyCode(keyToPress);
      if (keyDef) {
        const modifiers = this.requiresShift(char) ? 8 : 0;
        await this.pressKey(tabId, keyDef, modifiers);
      } else {
        await this.insertText(tabId, char);
      }
    }
  }

  async keyDown(
    tabId: number,
    keyDef: KeyDefinition,
    modifiers: number = 0,
    commands?: string[]
  ): Promise<void> {
    await this.dispatchKeyEvent(tabId, {
      type: keyDef.text ? "keyDown" : "rawKeyDown",
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.windowsVirtualKeyCode || keyDef.keyCode,
      modifiers,
      text: keyDef.text ?? "",
      unmodifiedText: keyDef.text ?? "",
      location: keyDef.location ?? 0,
      commands: commands ?? [],
      isKeypad: keyDef.isKeypad ?? false,
    });
  }

  async keyUp(tabId: number, keyDef: KeyDefinition, modifiers: number = 0): Promise<void> {
    await this.dispatchKeyEvent(tabId, {
      type: "keyUp",
      key: keyDef.key,
      modifiers,
      windowsVirtualKeyCode: keyDef.windowsVirtualKeyCode || keyDef.keyCode,
      code: keyDef.code,
      location: keyDef.location ?? 0,
    });
  }

  async pressKey(
    tabId: number,
    keyDef: KeyDefinition,
    modifiers: number = 0,
    commands?: string[]
  ): Promise<void> {
    await this.keyDown(tabId, keyDef, modifiers, commands);
    await this.keyUp(tabId, keyDef, modifiers);
  }

  async pressKeyChord(tabId: number, keyChord: string): Promise<void> {
    const keyParts = keyChord.toLowerCase().split("+");
    const modifierKeys: string[] = [];
    let mainKey = "";

    for (const part of keyParts) {
      if (
        [
          "ctrl",
          "control",
          "alt",
          "shift",
          "cmd",
          "meta",
          "command",
          "win",
          "windows",
        ].includes(part)
      ) {
        modifierKeys.push(part);
      } else {
        mainKey = part;
      }
    }

    let modifierBitmask = 0;
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

    for (const mod of modifierKeys) {
      modifierBitmask |= modifierMap[mod] || 0;
    }

    const macCommands: string[] = [];
    if (this.isMac) {
      const command = macKeyCommands[keyChord.toLowerCase()];
      if (command) {
        if (Array.isArray(command)) {
          macCommands.push(...command);
        } else {
          macCommands.push(command);
        }
      }
    }

    if (mainKey) {
      const keyDef = this.getKeyCode(mainKey);
      if (!keyDef) {
        throw new Error(`Unknown key: ${keyChord}`);
      }
      await this.pressKey(tabId, keyDef, modifierBitmask, macCommands);
    }
  }

  async scrollWheel(
    tabId: number,
    x: number,
    y: number,
    deltaX: number,
    deltaY: number
  ): Promise<void> {
    await this.dispatchMouseEvent(tabId, {
      type: "mouseWheel",
      x,
      y,
      deltaX,
      deltaY,
    });
  }

  getKeyCode(key: string): KeyDefinition | undefined {
    const lowerKey = key.toLowerCase();
    const knownKey = keyDefinitions[lowerKey];
    if (knownKey) return knownKey;

    if (key.length === 1) {
      const upperKey = key.toUpperCase();
      let code: string;

      if (upperKey >= "A" && upperKey <= "Z") {
        code = `Key${upperKey}`;
      } else if (key >= "0" && key <= "9") {
        code = `Digit${key}`;
      } else {
        return undefined;
      }

      return { key, code, keyCode: upperKey.charCodeAt(0), text: key };
    }

    return undefined;
  }

  requiresShift(char: string): boolean {
    return '~!@#$%^&*()_+{}|:"<>?'.includes(char) || (char >= "A" && char <= "Z");
  }

  extractDomain(url?: string): string {
    if (!url) return "unknown";
    try {
      return new URL(url).hostname || "unknown";
    } catch {
      return "unknown";
    }
  }

  addConsoleMessage(tabId: number, domain: string, message: ConsoleMessage): void {
    let tabData = CDPDebugger.consoleMessagesByTab.get(tabId);

    if (tabData && tabData.domain !== domain) {
      tabData = { domain, messages: [] };
      CDPDebugger.consoleMessagesByTab.set(tabId, tabData);
    } else if (!tabData) {
      tabData = { domain, messages: [] };
      CDPDebugger.consoleMessagesByTab.set(tabId, tabData);
    }

    // Ensure monotonically increasing timestamps
    if (tabData.messages.length > 0) {
      const lastTimestamp = tabData.messages[tabData.messages.length - 1].timestamp;
      if (message.timestamp < lastTimestamp) {
        message.timestamp = lastTimestamp;
      }
    }

    tabData.messages.push(message);

    // Trim to max size
    if (tabData.messages.length > CDPDebugger.MAX_LOGS_PER_TAB) {
      const excess = tabData.messages.length - CDPDebugger.MAX_LOGS_PER_TAB;
      tabData.messages.splice(0, excess);
    }
  }

  async enableConsoleTracking(tabId: number): Promise<void> {
    try {
      await this.sendCommand(tabId, "Runtime.enable");
      CDPDebugger.consoleTrackingEnabled.add(tabId);
    } catch (error) {
      throw error;
    }
  }

  getConsoleMessages(
    tabId: number,
    onlyErrors: boolean = false,
    pattern?: string
  ): ConsoleMessage[] {
    const tabData = CDPDebugger.consoleMessagesByTab.get(tabId);
    if (!tabData) return [];

    let messages = tabData.messages;

    if (onlyErrors) {
      messages = messages.filter(
        (msg) => msg.type === "error" || msg.type === "exception"
      );
    }

    if (pattern) {
      try {
        const regex = new RegExp(pattern, "i");
        messages = messages.filter((msg) => regex.test(msg.text));
      } catch {
        messages = messages.filter((msg) =>
          msg.text.toLowerCase().includes(pattern.toLowerCase())
        );
      }
    }

    return messages;
  }

  clearConsoleMessages(tabId: number): void {
    CDPDebugger.consoleMessagesByTab.delete(tabId);
  }

  addNetworkRequest(tabId: number, domain: string, request: NetworkRequest): void {
    let tabData = CDPDebugger.networkRequestsByTab.get(tabId);

    if (tabData) {
      if (tabData.domain !== domain) {
        tabData.domain = domain;
        tabData.requests = [];
      }
    } else {
      tabData = { domain, requests: [] };
      CDPDebugger.networkRequestsByTab.set(tabId, tabData);
    }

    tabData.requests.push(request);

    // Trim to max size
    if (tabData.requests.length > CDPDebugger.MAX_REQUESTS_PER_TAB) {
      const excess = tabData.requests.length - CDPDebugger.MAX_REQUESTS_PER_TAB;
      tabData.requests.splice(0, excess);
    }
  }

  async enableNetworkTracking(tabId: number): Promise<void> {
    try {
      if (!CDPDebugger.debuggerListenerRegistered) {
        this.initializeDebuggerEventListener();
      }

      try {
        await this.sendCommand(tabId, "Network.disable");
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {}

      await this.sendCommand(tabId, "Network.enable", { maxPostDataSize: 65536 });
      CDPDebugger.networkTrackingEnabled.add(tabId);
    } catch (error) {
      throw error;
    }
  }

  getNetworkRequests(tabId: number, urlPattern?: string): NetworkRequest[] {
    const tabData = CDPDebugger.networkRequestsByTab.get(tabId);
    if (!tabData) return [];

    let requests = tabData.requests;

    if (urlPattern) {
      requests = requests.filter((req) => req.url.includes(urlPattern));
    }

    return requests;
  }

  clearNetworkRequests(tabId: number): void {
    CDPDebugger.networkRequestsByTab.delete(tabId);
  }

  isNetworkTrackingEnabled(tabId: number): boolean {
    return CDPDebugger.networkTrackingEnabled.has(tabId);
  }

  async screenshot(tabId: number, resizeParams?: ResizeParams): Promise<ScreenshotResult> {
    const params = resizeParams || this.defaultResizeParams;

    if (tabGroupManager) {
      await tabGroupManager.hideIndicatorForToolUse(tabId);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const viewportResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        }),
      });

      if (!viewportResult || !viewportResult[0]?.result) {
        throw new Error("Failed to get viewport information");
      }

      const {
        width: viewportWidth,
        height: viewportHeight,
        devicePixelRatio,
      } = viewportResult[0].result;

      const captureResult = await this.sendCommand(tabId, "Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
        fromSurface: true,
      });

      if (!captureResult || !captureResult.data) {
        throw new Error("Failed to capture screenshot via CDP");
      }

      const base64Data = captureResult.data;

      // Check if Image is available (service worker vs content script context)
      if (typeof Image === "undefined") {
        return await this.processScreenshotInContentScript(
          tabId,
          base64Data,
          viewportWidth,
          viewportHeight,
          devicePixelRatio,
          params
        );
      }

      const dataUrl = `data:image/png;base64,${base64Data}`;

      const result = await new Promise<ScreenshotResult>((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
          let scaledWidth = img.width;
          let scaledHeight = img.height;

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          if (!ctx) {
            reject(new Error("Failed to create 2D context for screenshot processing"));
            return;
          }

          // Handle device pixel ratio scaling
          if (devicePixelRatio > 1) {
            scaledWidth = Math.round(img.width / devicePixelRatio);
            scaledHeight = Math.round(img.height / devicePixelRatio);
            canvas.width = scaledWidth;
            canvas.height = scaledHeight;
            ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, scaledWidth, scaledHeight);
          } else {
            canvas.width = scaledWidth;
            canvas.height = scaledHeight;
            ctx.drawImage(img, 0, 0);
          }

          const [targetWidth, targetHeight] = calculateOptimalDimensions(
            scaledWidth,
            scaledHeight,
            params
          );

          // If no resize needed
          if (scaledWidth === targetWidth && scaledHeight === targetHeight) {
            const pngBase64 = canvas.toDataURL("image/png").split(",")[1];
            resolve({
              base64: pngBase64,
              width: scaledWidth,
              height: scaledHeight,
              format: "png",
              viewportWidth,
              viewportHeight,
            });
            return;
          }

          // Resize to target dimensions
          const targetCanvas = document.createElement("canvas");
          const targetCtx = targetCanvas.getContext("2d");

          if (!targetCtx) {
            reject(new Error("Failed to create 2D context for target resizing"));
            return;
          }

          targetCanvas.width = targetWidth;
          targetCanvas.height = targetHeight;
          targetCtx.drawImage(canvas, 0, 0, scaledWidth, scaledHeight, 0, 0, targetWidth, targetHeight);

          const resizedBase64 = targetCanvas.toDataURL("image/png").split(",")[1];
          resolve({
            base64: resizedBase64,
            width: targetWidth,
            height: targetHeight,
            format: "png",
            viewportWidth,
            viewportHeight,
          });
        };

        img.onerror = () => {
          reject(new Error("Failed to load screenshot image"));
        };

        img.src = dataUrl;
      });

      screenshotContext.setContext(tabId, result);
      return result;
    } finally {
      if (tabGroupManager) {
        await tabGroupManager.restoreIndicatorAfterToolUse(tabId);
      }
    }
  }

  async processScreenshotInContentScript(
    tabId: number,
    base64Data: string,
    viewportWidth: number,
    viewportHeight: number,
    devicePixelRatio: number,
    resizeParams: ResizeParams
  ): Promise<ScreenshotResult> {
    const scriptResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: (
        base64: string,
        vpWidth: number,
        vpHeight: number,
        dpr: number,
        params: ResizeParams,
        maxBase64Chars: number,
        initialJpegQuality: number,
        jpegQualityStep: number,
        minJpegQuality: number
      ) => {
        const dataUrl = `data:image/png;base64,${base64}`;

        return new Promise<ScreenshotResult>((resolve, reject) => {
          const img = new Image();

          img.onload = () => {
            let scaledWidth = img.width;
            let scaledHeight = img.height;

            // Handle device pixel ratio
            if (dpr > 1) {
              scaledWidth = Math.round(img.width / dpr);
              scaledHeight = Math.round(img.height / dpr);
            }

            const canvas = document.createElement("canvas");
            canvas.width = scaledWidth;
            canvas.height = scaledHeight;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Failed to get canvas context"));
              return;
            }

            if (dpr > 1) {
              ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, scaledWidth, scaledHeight);
            } else {
              ctx.drawImage(img, 0, 0);
            }

            const aspectRatio = scaledWidth / scaledHeight;
            const pixelsPerToken = params.pxPerToken || 28;
            const maxTokens = params.maxTargetTokens || 1568;
            const currentTokens = Math.ceil((scaledWidth / pixelsPerToken) * (scaledHeight / pixelsPerToken));

            let targetWidth = scaledWidth;
            let targetHeight = scaledHeight;

            if (currentTokens > maxTokens) {
              const scale = Math.sqrt(maxTokens / currentTokens);
              targetWidth = Math.round(scaledWidth * scale);
              targetHeight = Math.round(targetWidth / aspectRatio);
            }

            const compressToFit = (sourceCanvas: HTMLCanvasElement): string => {
              let quality = initialJpegQuality;
              let result = sourceCanvas.toDataURL("image/jpeg", quality).split(",")[1];

              while (result.length > maxBase64Chars && quality > minJpegQuality) {
                quality -= jpegQualityStep;
                result = sourceCanvas.toDataURL("image/jpeg", quality).split(",")[1];
              }

              return result;
            };

            // If no resize needed
            if (targetWidth >= scaledWidth && targetHeight >= scaledHeight) {
              const outputBase64 = compressToFit(canvas);
              resolve({
                base64: outputBase64,
                width: scaledWidth,
                height: scaledHeight,
                format: "jpeg",
                viewportWidth: vpWidth,
                viewportHeight: vpHeight,
              });
              return;
            }

            // Resize to target
            const targetCanvas = document.createElement("canvas");
            targetCanvas.width = targetWidth;
            targetCanvas.height = targetHeight;

            const targetCtx = targetCanvas.getContext("2d");
            if (!targetCtx) {
              reject(new Error("Failed to get target canvas context"));
              return;
            }

            targetCtx.drawImage(canvas, 0, 0, scaledWidth, scaledHeight, 0, 0, targetWidth, targetHeight);

            const outputBase64 = compressToFit(targetCanvas);
            resolve({
              base64: outputBase64,
              width: targetWidth,
              height: targetHeight,
              format: "jpeg",
              viewportWidth: vpWidth,
              viewportHeight: vpHeight,
            });
          };

          img.onerror = () => {
            reject(new Error("Failed to load screenshot image"));
          };

          img.src = dataUrl;
        });
      },
      args: [
        base64Data,
        viewportWidth,
        viewportHeight,
        devicePixelRatio,
        resizeParams,
        CDPDebugger.MAX_BASE64_CHARS,
        CDPDebugger.INITIAL_JPEG_QUALITY,
        CDPDebugger.JPEG_QUALITY_STEP,
        CDPDebugger.MIN_JPEG_QUALITY,
      ],
    });

    if (!scriptResult || !scriptResult[0]?.result) {
      throw new Error("Failed to process screenshot in content script");
    }

    const result = scriptResult[0].result as ScreenshotResult;
    screenshotContext.setContext(tabId, result);
    return result;
  }
}

// ============================================================================
// Singleton instance export
// ============================================================================
const cdpDebugger = new CDPDebugger();

// Export with compatibility aliases
export { cdpDebugger as re };
