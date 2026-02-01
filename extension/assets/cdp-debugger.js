/**
 * cdp-debugger.js - Chrome DevTools Protocol Debugger
 *
 * This module handles CDP-based browser automation including:
 * - Console message capture
 * - Network request tracking
 * - Mouse/keyboard input simulation
 * - Screenshot capture
 *
 * EXPORTS:
 *   re = CDPDebugger singleton instance
 *   setTabGroupManager = function to inject TabGroupManager dependency
 */

// TabGroupManager reference (injected from mcp-tools.js)
let K = null;

/**
 * Set the TabGroupManager dependency
 * @param {Object} tabGroupManager - The TabGroupManager singleton (K from mcp-tools.js)
 */
export function setTabGroupManager(tabGroupManager) {
  K = tabGroupManager;
}

// ============================================================================
// Screenshot resize helper functions
// ============================================================================
function V(e, t) {
  return Math.floor((e - 1) / t) + 1;
}
function J(e, t, r) {
  return V(e, r) * V(t, r);
}
function X(e, t, r) {
  const { pxPerToken: o, maxTargetPx: n, maxTargetTokens: i } = r;
  if (e <= n && t <= n && J(e, t, o) <= i) return [e, t];
  if (t > e) {
    const [o, n] = X(t, e, r);
    return [n, o];
  }
  const a = e / t;
  let s = e,
    c = 1;
  for (;;) {
    if (c + 1 === s) return [c, Math.max(Math.round(c / a), 1)];
    const e = Math.floor((c + s) / 2),
      t = Math.max(Math.round(e / a), 1);
    e <= n && J(e, t, o) <= i ? (c = e) : (s = e);
  }
}

// ============================================================================
// ScreenshotContext - Tracks viewport/screenshot dimensions per tab
// ============================================================================
const Q = new (class {
  contexts = new Map();
  setContext(e, t) {
    if (t.viewportWidth && t.viewportHeight) {
      const r = {
        viewportWidth: t.viewportWidth,
        viewportHeight: t.viewportHeight,
        screenshotWidth: t.width,
        screenshotHeight: t.height,
      };
      this.contexts.set(e, r);
    }
  }
  getContext(e) {
    return this.contexts.get(e);
  }
  clearContext(e) {
    this.contexts.delete(e);
  }
  clearAllContexts() {
    this.contexts.clear();
  }
})();

// Export ScreenshotContext for use in mcp-tools.js
export { Q };

// ============================================================================
// Global CDP state initialization
// ============================================================================
(globalThis.__cdpDebuggerListenerRegistered ||
  (globalThis.__cdpDebuggerListenerRegistered = !1),
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
const Z = {
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
  },
  ee = {
    enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
    return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
    kp_enter: {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      text: "\r",
      isKeypad: !0,
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
    numpad0: { key: "0", code: "Numpad0", keyCode: 96, isKeypad: !0 },
    numpad1: { key: "1", code: "Numpad1", keyCode: 97, isKeypad: !0 },
    numpad2: { key: "2", code: "Numpad2", keyCode: 98, isKeypad: !0 },
    numpad3: { key: "3", code: "Numpad3", keyCode: 99, isKeypad: !0 },
    numpad4: { key: "4", code: "Numpad4", keyCode: 100, isKeypad: !0 },
    numpad5: { key: "5", code: "Numpad5", keyCode: 101, isKeypad: !0 },
    numpad6: { key: "6", code: "Numpad6", keyCode: 102, isKeypad: !0 },
    numpad7: { key: "7", code: "Numpad7", keyCode: 103, isKeypad: !0 },
    numpad8: { key: "8", code: "Numpad8", keyCode: 104, isKeypad: !0 },
    numpad9: { key: "9", code: "Numpad9", keyCode: 105, isKeypad: !0 },
    numpadmultiply: {
      key: "*",
      code: "NumpadMultiply",
      keyCode: 106,
      isKeypad: !0,
    },
    numpadadd: { key: "+", code: "NumpadAdd", keyCode: 107, isKeypad: !0 },
    numpadsubtract: {
      key: "-",
      code: "NumpadSubtract",
      keyCode: 109,
      isKeypad: !0,
    },
    numpaddecimal: {
      key: ".",
      code: "NumpadDecimal",
      keyCode: 110,
      isKeypad: !0,
    },
    numpaddivide: {
      key: "/",
      code: "NumpadDivide",
      keyCode: 111,
      isKeypad: !0,
    },
  };

// ============================================================================
// CDPDebugger (class te) - Chrome DevTools Protocol debugger management
// Handles console message capture and network request tracking
// Singleton instance: re = new te()
// ============================================================================
class te {
  static MAX_LOGS_PER_TAB = 1e4;
  static MAX_REQUESTS_PER_TAB = 1e3;
  static get debuggerListenerRegistered() {
    return globalThis.__cdpDebuggerListenerRegistered;
  }
  static set debuggerListenerRegistered(e) {
    globalThis.__cdpDebuggerListenerRegistered = e;
  }
  static get consoleMessagesByTab() {
    return globalThis.__cdpConsoleMessagesByTab;
  }
  static get networkRequestsByTab() {
    return globalThis.__cdpNetworkRequestsByTab;
  }
  static get networkTrackingEnabled() {
    return globalThis.__cdpNetworkTrackingEnabled;
  }
  static get consoleTrackingEnabled() {
    return globalThis.__cdpConsoleTrackingEnabled;
  }
  isMac = !1;
  constructor() {
    ((this.isMac =
      navigator.platform.toUpperCase().indexOf("MAC") >= 0 ||
      navigator.userAgent.toUpperCase().indexOf("MAC") >= 0),
      this.initializeDebuggerEventListener());
  }
  registerDebuggerEventHandlers() {
    globalThis.__cdpDebuggerEventHandler ||
      ((globalThis.__cdpDebuggerEventHandler = (e, t, r) => {
        const o = e.tabId;
        if (o) {
          if ("Runtime.consoleAPICalled" === t) {
            const e = {
                type: r.type || "log",
                text: r.args
                  ?.map((e) =>
                    void 0 !== e.value ? String(e.value) : e.description || "",
                  )
                  .join(" "),
                timestamp: r.timestamp || Date.now(),
                url: r.stackTrace?.callFrames?.[0]?.url,
                lineNumber: r.stackTrace?.callFrames?.[0]?.lineNumber,
                columnNumber: r.stackTrace?.callFrames?.[0]?.columnNumber,
                args: r.args,
              },
              t = this.extractDomain(e.url);
            this.addConsoleMessage(o, t, e);
          }
          if ("Runtime.exceptionThrown" === t) {
            const e = r.exceptionDetails,
              t = {
                type: "exception",
                text:
                  e?.exception?.description || e?.text || "Unknown exception",
                timestamp: e?.timestamp || Date.now(),
                url: e?.url,
                lineNumber: e?.lineNumber,
                columnNumber: e?.columnNumber,
                stackTrace: e?.stackTrace?.callFrames
                  ?.map(
                    (e) =>
                      `    at ${e.functionName || "<anonymous>"} (${e.url}:${e.lineNumber}:${e.columnNumber})`,
                  )
                  .join("\n"),
              },
              n = this.extractDomain(t.url);
            this.addConsoleMessage(o, n, t);
          }
          if ("Network.requestWillBeSent" === t) {
            const e = r.requestId,
              t = r.request,
              n = r.documentURL,
              i = { requestId: e, url: t.url, method: t.method },
              a = n || t.url,
              s = this.extractDomain(a);
            this.addNetworkRequest(o, s, i);
          }
          if ("Network.responseReceived" === t) {
            const e = r.requestId,
              t = r.response,
              n = te.networkRequestsByTab.get(o);
            if (n) {
              const r = n.requests.find((t) => t.requestId === e);
              r && (r.status = t.status);
            }
          }
          if ("Network.loadingFailed" === t) {
            const e = r.requestId,
              t = te.networkRequestsByTab.get(o);
            if (t) {
              const r = t.requests.find((t) => t.requestId === e);
              r && (r.status = 503);
            }
          }
        }
      }),
      chrome.debugger.onEvent.addListener(
        globalThis.__cdpDebuggerEventHandler,
      ));
  }
  initializeDebuggerEventListener() {
    te.debuggerListenerRegistered ||
      ((te.debuggerListenerRegistered = !0),
      this.registerDebuggerEventHandlers());
  }
  defaultResizeParams = {
    pxPerToken: 28,
    maxTargetPx: 1568,
    maxTargetTokens: 1568,
  };
  static MAX_BASE64_CHARS = 1398100;
  static INITIAL_JPEG_QUALITY = 0.85;
  static JPEG_QUALITY_STEP = 0.05;
  static MIN_JPEG_QUALITY = 0.1;
  async attachDebugger(e) {
    const t = { tabId: e },
      r = te.networkTrackingEnabled.has(e),
      o = te.consoleTrackingEnabled.has(e);
    try {
      await this.detachDebugger(e);
    } catch {}
    if (
      (await new Promise((e, r) => {
        chrome.debugger.attach(t, "1.3", () => {
          chrome.runtime.lastError
            ? r(new Error(chrome.runtime.lastError.message))
            : e();
        });
      }),
      this.registerDebuggerEventHandlers(),
      o)
    )
      try {
        await this.sendCommand(e, "Runtime.enable");
      } catch (n) {}
    if (r)
      try {
        await this.sendCommand(e, "Network.enable", { maxPostDataSize: 65536 });
      } catch (n) {}
  }
  async detachDebugger(e) {
    return new Promise((t) => {
      chrome.debugger.detach({ tabId: e }, () => {
        t();
      });
    });
  }
  async isDebuggerAttached(e) {
    return new Promise((t) => {
      chrome.debugger.getTargets((r) => {
        const o = r.find((t) => t.tabId === e);
        t(o?.attached ?? !1);
      });
    });
  }
  async sendCommand(e, t, r) {
    try {
      return await new Promise((o, n) => {
        chrome.debugger.sendCommand({ tabId: e }, t, r, (e) => {
          chrome.runtime.lastError
            ? n(new Error(chrome.runtime.lastError.message))
            : o(e);
        });
      });
    } catch (o) {
      if (
        (o instanceof Error ? o.message : String(o))
          .toLowerCase()
          .includes("debugger is not attached")
      )
        return (
          await this.attachDebugger(e),
          new Promise((o, n) => {
            chrome.debugger.sendCommand({ tabId: e }, t, r, (e) => {
              chrome.runtime.lastError
                ? n(new Error(chrome.runtime.lastError.message))
                : o(e);
            });
          })
        );
      throw o;
    }
  }
  async dispatchMouseEvent(e, t) {
    const r = {
      type: t.type,
      x: Math.round(t.x),
      y: Math.round(t.y),
      modifiers: t.modifiers || 0,
    };
    (("mousePressed" !== t.type &&
      "mouseReleased" !== t.type &&
      "mouseMoved" !== t.type) ||
      ((r.button = t.button || "none"),
      ("mousePressed" !== t.type && "mouseReleased" !== t.type) ||
        (r.clickCount = t.clickCount || 1)),
      "mouseWheel" !== t.type &&
        (r.buttons = void 0 !== t.buttons ? t.buttons : 0),
      "mouseWheel" !== t.type ||
        (void 0 === t.deltaX && void 0 === t.deltaY) ||
        Object.assign(r, { deltaX: t.deltaX || 0, deltaY: t.deltaY || 0 }),
      await this.sendCommand(e, "Input.dispatchMouseEvent", r));
  }
  async dispatchKeyEvent(e, t) {
    const r = { modifiers: 0, ...t };
    await this.sendCommand(e, "Input.dispatchKeyEvent", r);
  }
  async insertText(e, t) {
    await this.sendCommand(e, "Input.insertText", { text: t });
  }
  async click(e, t, r, o = "left", n = 1, i = 0) {
    (K && await K.hideIndicatorForToolUse(e),
      await new Promise((e) => setTimeout(e, 50)));
    try {
      let a = 0;
      ("left" === o
        ? (a = 1)
        : "right" === o
          ? (a = 2)
          : "middle" === o && (a = 4),
        await this.dispatchMouseEvent(e, {
          type: "mouseMoved",
          x: t,
          y: r,
          button: "none",
          buttons: 0,
          modifiers: i,
        }),
        await new Promise((e) => setTimeout(e, 100)));
      for (let s = 1; s <= n; s++)
        (await this.dispatchMouseEvent(e, {
          type: "mousePressed",
          x: t,
          y: r,
          button: o,
          buttons: a,
          clickCount: s,
          modifiers: i,
        }),
          await new Promise((e) => setTimeout(e, 12)),
          await this.dispatchMouseEvent(e, {
            type: "mouseReleased",
            x: t,
            y: r,
            button: o,
            buttons: 0,
            modifiers: i,
            clickCount: s,
          }),
          s < n && (await new Promise((e) => setTimeout(e, 100))));
    } finally {
      K && await K.restoreIndicatorAfterToolUse(e);
    }
  }
  async type(e, t) {
    for (const r of t) {
      let t = r;
      ("\n" !== r && "\r" !== r) || (t = "Enter");
      const o = this.getKeyCode(t);
      if (o) {
        const t = this.requiresShift(r) ? 8 : 0;
        await this.pressKey(e, o, t);
      } else await this.insertText(e, r);
    }
  }
  async keyDown(e, t, r = 0, o) {
    await this.dispatchKeyEvent(e, {
      type: t.text ? "keyDown" : "rawKeyDown",
      key: t.key,
      code: t.code,
      windowsVirtualKeyCode: t.windowsVirtualKeyCode || t.keyCode,
      modifiers: r,
      text: t.text ?? "",
      unmodifiedText: t.text ?? "",
      location: t.location ?? 0,
      commands: o ?? [],
      isKeypad: t.isKeypad ?? !1,
    });
  }
  async keyUp(e, t, r = 0) {
    await this.dispatchKeyEvent(e, {
      type: "keyUp",
      key: t.key,
      modifiers: r,
      windowsVirtualKeyCode: t.windowsVirtualKeyCode || t.keyCode,
      code: t.code,
      location: t.location ?? 0,
    });
  }
  async pressKey(e, t, r = 0, o) {
    (await this.keyDown(e, t, r, o), await this.keyUp(e, t, r));
  }
  async pressKeyChord(e, t) {
    const r = t.toLowerCase().split("+"),
      o = [];
    let n = "";
    for (const c of r)
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
      ].includes(c)
        ? o.push(c)
        : (n = c);
    let i = 0;
    const a = {
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
    for (const c of o) i |= a[c] || 0;
    const s = [];
    if (this.isMac) {
      const e = Z[t.toLowerCase()];
      e && Array.isArray(e) ? s.push(...e) : e && s.push(e);
    }
    if (n) {
      const r = this.getKeyCode(n);
      if (!r) throw new Error(`Unknown key: ${t}`);
      await this.pressKey(e, r, i, s);
    }
  }
  async scrollWheel(e, t, r, o, n) {
    await this.dispatchMouseEvent(e, {
      type: "mouseWheel",
      x: t,
      y: r,
      deltaX: o,
      deltaY: n,
    });
  }
  getKeyCode(e) {
    const t = e.toLowerCase(),
      r = ee[t];
    if (r) return r;
    if (1 === e.length) {
      const t = e.toUpperCase();
      let r;
      if (t >= "A" && t <= "Z") r = `Key${t}`;
      else {
        if (!(e >= "0" && e <= "9")) return;
        r = `Digit${e}`;
      }
      return { key: e, code: r, keyCode: t.charCodeAt(0), text: e };
    }
  }
  requiresShift(e) {
    return '~!@#$%^&*()_+{}|:"<>?'.includes(e) || (e >= "A" && e <= "Z");
  }
  extractDomain(e) {
    if (!e) return "unknown";
    try {
      return new URL(e).hostname || "unknown";
    } catch {
      return "unknown";
    }
  }
  addConsoleMessage(e, t, r) {
    let o = te.consoleMessagesByTab.get(e);
    if (
      (o && o.domain !== t
        ? ((o = { domain: t, messages: [] }), te.consoleMessagesByTab.set(e, o))
        : o ||
          ((o = { domain: t, messages: [] }),
          te.consoleMessagesByTab.set(e, o)),
      o.messages.length > 0)
    ) {
      const e = o.messages[o.messages.length - 1].timestamp;
      r.timestamp < e && (r.timestamp = e);
    }
    if ((o.messages.push(r), o.messages.length > te.MAX_LOGS_PER_TAB)) {
      const e = o.messages.length - te.MAX_LOGS_PER_TAB;
      o.messages.splice(0, e);
    }
  }
  async enableConsoleTracking(e) {
    try {
      (await this.sendCommand(e, "Runtime.enable"),
        te.consoleTrackingEnabled.add(e));
    } catch (t) {
      throw t;
    }
  }
  getConsoleMessages(e, t = !1, r) {
    const o = te.consoleMessagesByTab.get(e);
    if (!o) return [];
    let n = o.messages;
    if (
      (t && (n = n.filter((e) => "error" === e.type || "exception" === e.type)),
      r)
    )
      try {
        const e = new RegExp(r, "i");
        n = n.filter((t) => e.test(t.text));
      } catch {
        n = n.filter((e) => e.text.toLowerCase().includes(r.toLowerCase()));
      }
    return n;
  }
  clearConsoleMessages(e) {
    te.consoleMessagesByTab.delete(e);
  }
  addNetworkRequest(e, t, r) {
    let o = te.networkRequestsByTab.get(e);
    if (
      (o
        ? o.domain !== t && ((o.domain = t), (o.requests = []))
        : ((o = { domain: t, requests: [] }),
          te.networkRequestsByTab.set(e, o)),
      o.requests.push(r),
      o.requests.length > te.MAX_REQUESTS_PER_TAB)
    ) {
      const e = o.requests.length - te.MAX_REQUESTS_PER_TAB;
      o.requests.splice(0, e);
    }
  }
  async enableNetworkTracking(e) {
    try {
      te.debuggerListenerRegistered || this.initializeDebuggerEventListener();
      try {
        (await this.sendCommand(e, "Network.disable"),
          await new Promise((e) => setTimeout(e, 50)));
      } catch {}
      (await this.sendCommand(e, "Network.enable", { maxPostDataSize: 65536 }),
        te.networkTrackingEnabled.add(e));
    } catch (t) {
      throw t;
    }
  }
  getNetworkRequests(e, t) {
    const r = te.networkRequestsByTab.get(e);
    if (!r) return [];
    let o = r.requests;
    return (t && (o = o.filter((e) => e.url.includes(t))), o);
  }
  clearNetworkRequests(e) {
    te.networkRequestsByTab.delete(e);
  }
  isNetworkTrackingEnabled(e) {
    return te.networkTrackingEnabled.has(e);
  }
  async screenshot(e, t) {
    const r = t || this.defaultResizeParams;
    (K && await K.hideIndicatorForToolUse(e),
      await new Promise((e) => setTimeout(e, 50)));
    try {
      const t = await chrome.scripting.executeScript({
        target: { tabId: e },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        }),
      });
      if (!t || !t[0]?.result)
        throw new Error("Failed to get viewport information");
      const { width: o, height: n, devicePixelRatio: i } = t[0].result,
        a = await this.sendCommand(e, "Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: !1,
          fromSurface: !0,
        });
      if (!a || !a.data)
        throw new Error("Failed to capture screenshot via CDP");
      const s = a.data;
      if ("undefined" == typeof Image)
        return await this.processScreenshotInContentScript(e, s, o, n, i, r);
      const c = `data:image/png;base64,${s}`,
        u = await new Promise((e, t) => {
          const a = new Image();
          ((a.onload = () => {
            let s = a.width,
              c = a.height;
            const u = document.createElement("canvas"),
              l = u.getContext("2d");
            if (!l)
              return void t(
                new Error(
                  "Failed to create 2D context for screenshot processing",
                ),
              );
            i > 1
              ? ((s = Math.round(a.width / i)),
                (c = Math.round(a.height / i)),
                (u.width = s),
                (u.height = c),
                l.drawImage(a, 0, 0, a.width, a.height, 0, 0, s, c))
              : ((u.width = s), (u.height = c), l.drawImage(a, 0, 0));
            const [d, h] = X(s, c, r);
            if (!(s !== d || c !== h)) {
              const t = u.toDataURL("image/png").split(",")[1];
              return void e({
                base64: t,
                width: s,
                height: c,
                format: "png",
                viewportWidth: o,
                viewportHeight: n,
              });
            }
            const p = document.createElement("canvas"),
              f = p.getContext("2d");
            if (!f)
              return void t(
                new Error("Failed to create 2D context for target resizing"),
              );
            ((p.width = d),
              (p.height = h),
              f.drawImage(u, 0, 0, s, c, 0, 0, d, h));
            const m = p.toDataURL("image/png").split(",")[1];
            e({
              base64: m,
              width: d,
              height: h,
              format: "png",
              viewportWidth: o,
              viewportHeight: n,
            });
          }),
            (a.onerror = () => {
              t(new Error("Failed to load screenshot image"));
            }),
            (a.src = c));
        });
      return (Q.setContext(e, u), u);
    } finally {
      K && await K.restoreIndicatorAfterToolUse(e);
    }
  }
  async processScreenshotInContentScript(e, t, r, o, n, i) {
    const a = await chrome.scripting.executeScript({
      target: { tabId: e },
      func: (e, t, r, o, n, i, a, s, c) => {
        const u = `data:image/png;base64,${e}`;
        return new Promise((e, l) => {
          const d = new Image();
          ((d.onload = () => {
            let u = d.width,
              h = d.height;
            o > 1 &&
              ((u = Math.round(d.width / o)), (h = Math.round(d.height / o)));
            const p = document.createElement("canvas");
            ((p.width = u), (p.height = h));
            const f = p.getContext("2d");
            if (!f) return void l(new Error("Failed to get canvas context"));
            o > 1
              ? f.drawImage(d, 0, 0, d.width, d.height, 0, 0, u, h)
              : f.drawImage(d, 0, 0);
            const m = u / h,
              g = n.pxPerToken || 28,
              b = n.maxTargetTokens || 1568,
              w = Math.ceil((u / g) * (h / g));
            let y = u,
              v = h;
            if (w > b) {
              const e = Math.sqrt(b / w);
              ((y = Math.round(u * e)), (v = Math.round(y / m)));
            }
            const I = (e) => {
              let t = a,
                r = e.toDataURL("image/jpeg", t).split(",")[1];
              for (; r.length > i && t > c; )
                ((t -= s), (r = e.toDataURL("image/jpeg", t).split(",")[1]));
              return r;
            };
            if (y >= u && v >= h) {
              const o = I(p);
              return void e({
                base64: o,
                width: u,
                height: h,
                format: "jpeg",
                viewportWidth: t,
                viewportHeight: r,
              });
            }
            const T = document.createElement("canvas");
            ((T.width = y), (T.height = v));
            const k = T.getContext("2d");
            if (!k)
              return void l(new Error("Failed to get target canvas context"));
            k.drawImage(p, 0, 0, u, h, 0, 0, y, v);
            const _ = I(T);
            e({
              base64: _,
              width: y,
              height: v,
              format: "jpeg",
              viewportWidth: t,
              viewportHeight: r,
            });
          }),
            (d.onerror = () => {
              l(new Error("Failed to load screenshot image"));
            }),
            (d.src = u));
        });
      },
      args: [
        t,
        r,
        o,
        n,
        i,
        te.MAX_BASE64_CHARS,
        te.INITIAL_JPEG_QUALITY,
        te.JPEG_QUALITY_STEP,
        te.MIN_JPEG_QUALITY,
      ],
    });
    if (!a || !a[0]?.result)
      throw new Error("Failed to process screenshot in content script");
    const s = a[0].result;
    return (Q.setContext(e, s), s);
  }
}

// ============================================================================
// Singleton instance export
// ============================================================================
const re = new te();
export { re };
