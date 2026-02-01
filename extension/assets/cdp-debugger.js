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
 *   re = CDPDebugger singleton instance
 *   Q = ScreenshotContext singleton instance
 *   setTabGroupManager = function to inject TabGroupManager dependency
 */
// =============================================================================
// Module state
// =============================================================================
// TabGroupManager reference (injected from mcp-tools.js)
let tabGroupManagerRef = null;
/**
 * Set the TabGroupManager dependency
 * @param tabGroupManager - The TabGroupManager singleton (K from mcp-tools.js)
 */
export function setTabGroupManager(tabGroupManager) {
    tabGroupManagerRef = tabGroupManager;
}
// =============================================================================
// Screenshot resize helper functions
// =============================================================================
/**
 * Calculate ceiling division: ceil(dividend / divisor)
 * Used for token calculation in screenshot resizing
 */
function ceilingDivision(dividend, divisor) {
    return Math.floor((dividend - 1) / divisor) + 1;
}
/**
 * Calculate the number of tokens for given image dimensions
 * Tokens are calculated as ceil(width/pxPerToken) * ceil(height/pxPerToken)
 */
function calculateTokensForDimensions(width, height, pxPerToken) {
    return ceilingDivision(width, pxPerToken) * ceilingDivision(height, pxPerToken);
}
/**
 * Calculate optimal target dimensions for screenshot resizing
 * Uses binary search to find the largest dimensions that fit within token/pixel limits
 */
function calculateTargetDimensions(width, height, params) {
    const { pxPerToken, maxTargetPx, maxTargetTokens } = params;
    // If already within limits, return original dimensions
    if (width <= maxTargetPx && height <= maxTargetPx && calculateTokensForDimensions(width, height, pxPerToken) <= maxTargetTokens) {
        return [width, height];
    }
    // Handle portrait orientation by swapping and recursing
    if (height > width) {
        const [targetHeight, targetWidth] = calculateTargetDimensions(height, width, params);
        return [targetWidth, targetHeight];
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
        if (midWidth <= maxTargetPx && calculateTokensForDimensions(midWidth, midHeight, pxPerToken) <= maxTargetTokens) {
            minWidth = midWidth;
        }
        else {
            maxWidth = midWidth;
        }
    }
}
// =============================================================================
// ScreenshotContext - Tracks viewport/screenshot dimensions per tab
// =============================================================================
class ScreenshotContextClass {
    contexts = new Map();
    setContext(tabId, result) {
        if (result.viewportWidth && result.viewportHeight) {
            const context = {
                viewportWidth: result.viewportWidth,
                viewportHeight: result.viewportHeight,
                screenshotWidth: result.width,
                screenshotHeight: result.height,
            };
            this.contexts.set(tabId, context);
        }
    }
    getContext(tabId) {
        return this.contexts.get(tabId);
    }
    clearContext(tabId) {
        this.contexts.delete(tabId);
    }
    clearAllContexts() {
        this.contexts.clear();
    }
}
const screenshotContext = new ScreenshotContextClass();
// Export ScreenshotContext for use in mcp-tools.js
export { screenshotContext };
// =============================================================================
// Global CDP state initialization
// =============================================================================
if (!globalThis.__cdpDebuggerListenerRegistered) {
    globalThis.__cdpDebuggerListenerRegistered = false;
}
if (!globalThis.__cdpConsoleMessagesByTab) {
    globalThis.__cdpConsoleMessagesByTab = new Map();
}
if (!globalThis.__cdpNetworkRequestsByTab) {
    globalThis.__cdpNetworkRequestsByTab = new Map();
}
if (!globalThis.__cdpNetworkTrackingEnabled) {
    globalThis.__cdpNetworkTrackingEnabled = new Set();
}
if (!globalThis.__cdpConsoleTrackingEnabled) {
    globalThis.__cdpConsoleTrackingEnabled = new Set();
}
// =============================================================================
// Keyboard mappings - Mac-specific key commands
// =============================================================================
const macKeyCommands = {
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
const keyDefinitions = {
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
// =============================================================================
// CDPDebugger class - Chrome DevTools Protocol debugger management
// Handles console message capture and network request tracking
// Singleton instance: cdpDebuggerInstance = new CDPDebugger()
// =============================================================================
class CDPDebugger {
    static MAX_LOGS_PER_TAB = 10000;
    static MAX_REQUESTS_PER_TAB = 1000;
    static get debuggerListenerRegistered() {
        return globalThis.__cdpDebuggerListenerRegistered;
    }
    static set debuggerListenerRegistered(value) {
        globalThis.__cdpDebuggerListenerRegistered = value;
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
    isMac = false;
    constructor() {
        this.isMac =
            navigator.platform.toUpperCase().indexOf("MAC") >= 0 ||
                navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;
        this.initializeDebuggerEventListener();
    }
    registerDebuggerEventHandlers() {
        if (globalThis.__cdpDebuggerEventHandler)
            return;
        globalThis.__cdpDebuggerEventHandler = (source, method, params) => {
            const tabId = source.tabId;
            if (!tabId)
                return;
            if (method === "Runtime.consoleAPICalled") {
                const args = params;
                const message = {
                    type: args.type || "log",
                    text: args.args
                        ?.map((arg) => arg.value !== undefined ? String(arg.value) : arg.description || "")
                        .join(" ") || "",
                    timestamp: args.timestamp || Date.now(),
                    url: args.stackTrace?.callFrames?.[0]?.url,
                    lineNumber: args.stackTrace?.callFrames?.[0]?.lineNumber,
                    columnNumber: args.stackTrace?.callFrames?.[0]?.columnNumber,
                };
                const domain = this.extractDomain(message.url);
                this.addConsoleMessage(tabId, domain, message);
            }
            if (method === "Runtime.exceptionThrown") {
                const args = params;
                const exceptionDetails = args.exceptionDetails;
                const message = {
                    type: "exception",
                    text: exceptionDetails?.exception?.description ||
                        exceptionDetails?.text ||
                        "Unknown exception",
                    timestamp: exceptionDetails?.timestamp || Date.now(),
                    url: exceptionDetails?.url,
                    lineNumber: exceptionDetails?.lineNumber,
                    columnNumber: exceptionDetails?.columnNumber,
                    stackTrace: exceptionDetails?.stackTrace?.callFrames
                        ?.map((frame) => `    at ${frame.functionName || "<anonymous>"} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`)
                        .join("\n"),
                };
                const domain = this.extractDomain(message.url);
                this.addConsoleMessage(tabId, domain, message);
            }
            if (method === "Network.requestWillBeSent") {
                const args = params;
                const request = {
                    requestId: args.requestId,
                    url: args.request.url,
                    method: args.request.method,
                };
                const documentUrl = args.documentURL || args.request.url;
                const domain = this.extractDomain(documentUrl);
                this.addNetworkRequest(tabId, domain, request);
            }
            if (method === "Network.responseReceived") {
                const args = params;
                const storage = CDPDebugger.networkRequestsByTab.get(tabId);
                if (storage) {
                    const request = storage.requests.find((req) => req.requestId === args.requestId);
                    if (request) {
                        request.status = args.response.status;
                    }
                }
            }
            if (method === "Network.loadingFailed") {
                const args = params;
                const storage = CDPDebugger.networkRequestsByTab.get(tabId);
                if (storage) {
                    const request = storage.requests.find((req) => req.requestId === args.requestId);
                    if (request) {
                        request.status = 503;
                    }
                }
            }
        };
        chrome.debugger.onEvent.addListener(globalThis.__cdpDebuggerEventHandler);
    }
    initializeDebuggerEventListener() {
        if (CDPDebugger.debuggerListenerRegistered)
            return;
        CDPDebugger.debuggerListenerRegistered = true;
        this.registerDebuggerEventHandlers();
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
    async attachDebugger(tabId) {
        const target = { tabId };
        const networkEnabled = CDPDebugger.networkTrackingEnabled.has(tabId);
        const consoleEnabled = CDPDebugger.consoleTrackingEnabled.has(tabId);
        try {
            await this.detachDebugger(tabId);
        }
        catch {
            // Ignore detach errors
        }
        await new Promise((resolve, reject) => {
            chrome.debugger.attach(target, "1.3", () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                }
                else {
                    resolve();
                }
            });
        });
        this.registerDebuggerEventHandlers();
        if (consoleEnabled) {
            try {
                await this.sendCommand(tabId, "Runtime.enable");
            }
            catch {
                // Ignore errors
            }
        }
        if (networkEnabled) {
            try {
                await this.sendCommand(tabId, "Network.enable", {
                    maxPostDataSize: 65536,
                });
            }
            catch {
                // Ignore errors
            }
        }
    }
    async detachDebugger(tabId) {
        return new Promise((resolve) => {
            chrome.debugger.detach({ tabId }, () => {
                resolve();
            });
        });
    }
    async isDebuggerAttached(tabId) {
        return new Promise((resolve) => {
            chrome.debugger.getTargets((targets) => {
                const target = targets.find((t) => t.tabId === tabId);
                resolve(target?.attached ?? false);
            });
        });
    }
    async sendCommand(tabId, method, params) {
        try {
            return await new Promise((resolve, reject) => {
                chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    }
                    else {
                        resolve(result);
                    }
                });
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.toLowerCase().includes("debugger is not attached")) {
                await this.attachDebugger(tabId);
                return new Promise((resolve, reject) => {
                    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        }
                        else {
                            resolve(result);
                        }
                    });
                });
            }
            throw error;
        }
    }
    async dispatchMouseEvent(tabId, params) {
        const cdpParams = {
            type: params.type,
            x: Math.round(params.x),
            y: Math.round(params.y),
            modifiers: params.modifiers || 0,
        };
        if (params.type === "mousePressed" ||
            params.type === "mouseReleased" ||
            params.type === "mouseMoved") {
            cdpParams.button = params.button || "none";
            if (params.type === "mousePressed" || params.type === "mouseReleased") {
                cdpParams.clickCount = params.clickCount || 1;
            }
        }
        if (params.type !== "mouseWheel") {
            cdpParams.buttons = params.buttons !== undefined ? params.buttons : 0;
        }
        if (params.type === "mouseWheel" &&
            (params.deltaX !== undefined || params.deltaY !== undefined)) {
            cdpParams.deltaX = params.deltaX || 0;
            cdpParams.deltaY = params.deltaY || 0;
        }
        await this.sendCommand(tabId, "Input.dispatchMouseEvent", cdpParams);
    }
    async dispatchKeyEvent(tabId, params) {
        const cdpParams = { modifiers: 0, ...params };
        await this.sendCommand(tabId, "Input.dispatchKeyEvent", cdpParams);
    }
    async insertText(tabId, text) {
        await this.sendCommand(tabId, "Input.insertText", { text });
    }
    async click(tabId, x, y, button = "left", clickCount = 1, modifiers = 0) {
        if (tabGroupManagerRef) {
            await tabGroupManagerRef.hideIndicatorForToolUse(tabId);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        try {
            let buttons = 0;
            if (button === "left") {
                buttons = 1;
            }
            else if (button === "right") {
                buttons = 2;
            }
            else if (button === "middle") {
                buttons = 4;
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
                    buttons,
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
        }
        finally {
            if (tabGroupManagerRef) {
                await tabGroupManagerRef.restoreIndicatorAfterToolUse(tabId);
            }
        }
    }
    async type(tabId, text) {
        for (const char of text) {
            let key = char;
            if (char === "\n" || char === "\r") {
                key = "Enter";
            }
            const keyDef = this.getKeyCode(key);
            if (keyDef) {
                const modifiers = this.requiresShift(char) ? 8 : 0;
                await this.pressKey(tabId, keyDef, modifiers);
            }
            else {
                await this.insertText(tabId, char);
            }
        }
    }
    async keyDown(tabId, keyDef, modifiers = 0, commands) {
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
    async keyUp(tabId, keyDef, modifiers = 0) {
        await this.dispatchKeyEvent(tabId, {
            type: "keyUp",
            key: keyDef.key,
            modifiers,
            windowsVirtualKeyCode: keyDef.windowsVirtualKeyCode || keyDef.keyCode,
            code: keyDef.code,
            location: keyDef.location ?? 0,
        });
    }
    async pressKey(tabId, keyDef, modifiers = 0, commands) {
        await this.keyDown(tabId, keyDef, modifiers, commands);
        await this.keyUp(tabId, keyDef, modifiers);
    }
    async pressKeyChord(tabId, chord) {
        const parts = chord.toLowerCase().split("+");
        const modifierKeys = [];
        let mainKey = "";
        for (const part of parts) {
            if ([
                "ctrl",
                "control",
                "alt",
                "shift",
                "cmd",
                "meta",
                "command",
                "win",
                "windows",
            ].includes(part)) {
                modifierKeys.push(part);
            }
            else {
                mainKey = part;
            }
        }
        let modifiers = 0;
        const modifierMap = {
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
            modifiers |= modifierMap[mod] || 0;
        }
        const commands = [];
        if (this.isMac) {
            const macCommand = macKeyCommands[chord.toLowerCase()];
            if (macCommand) {
                if (Array.isArray(macCommand)) {
                    commands.push(...macCommand);
                }
                else {
                    commands.push(macCommand);
                }
            }
        }
        if (mainKey) {
            const keyDef = this.getKeyCode(mainKey);
            if (!keyDef) {
                throw new Error(`Unknown key: ${chord}`);
            }
            await this.pressKey(tabId, keyDef, modifiers, commands);
        }
    }
    async scrollWheel(tabId, x, y, deltaX, deltaY) {
        await this.dispatchMouseEvent(tabId, {
            type: "mouseWheel",
            x,
            y,
            deltaX,
            deltaY,
        });
    }
    getKeyCode(key) {
        const lowerKey = key.toLowerCase();
        const mapped = keyDefinitions[lowerKey];
        if (mapped)
            return mapped;
        if (key.length === 1) {
            const upper = key.toUpperCase();
            let code;
            if (upper >= "A" && upper <= "Z") {
                code = `Key${upper}`;
            }
            else if (key >= "0" && key <= "9") {
                code = `Digit${key}`;
            }
            else {
                return undefined;
            }
            return { key, code, keyCode: upper.charCodeAt(0), text: key };
        }
        return undefined;
    }
    requiresShift(char) {
        return '~!@#$%^&*()_+{}|:"<>?'.includes(char) || (char >= "A" && char <= "Z");
    }
    extractDomain(url) {
        if (!url)
            return "unknown";
        try {
            return new URL(url).hostname || "unknown";
        }
        catch {
            return "unknown";
        }
    }
    addConsoleMessage(tabId, domain, message) {
        let storage = CDPDebugger.consoleMessagesByTab.get(tabId);
        if (storage && storage.domain !== domain) {
            storage = { domain, messages: [] };
            CDPDebugger.consoleMessagesByTab.set(tabId, storage);
        }
        else if (!storage) {
            storage = { domain, messages: [] };
            CDPDebugger.consoleMessagesByTab.set(tabId, storage);
        }
        // Ensure timestamps are monotonically increasing
        if (storage.messages.length > 0) {
            const lastTimestamp = storage.messages[storage.messages.length - 1].timestamp;
            if (message.timestamp < lastTimestamp) {
                message.timestamp = lastTimestamp;
            }
        }
        storage.messages.push(message);
        // Trim if over limit
        if (storage.messages.length > CDPDebugger.MAX_LOGS_PER_TAB) {
            const excess = storage.messages.length - CDPDebugger.MAX_LOGS_PER_TAB;
            storage.messages.splice(0, excess);
        }
    }
    async enableConsoleTracking(tabId) {
        try {
            await this.sendCommand(tabId, "Runtime.enable");
            CDPDebugger.consoleTrackingEnabled.add(tabId);
        }
        catch (error) {
            throw error;
        }
    }
    getConsoleMessages(tabId, onlyErrors = false, pattern) {
        const storage = CDPDebugger.consoleMessagesByTab.get(tabId);
        if (!storage)
            return [];
        let messages = storage.messages;
        if (onlyErrors) {
            messages = messages.filter((msg) => msg.type === "error" || msg.type === "exception");
        }
        if (pattern) {
            try {
                const regex = new RegExp(pattern, "i");
                messages = messages.filter((msg) => regex.test(msg.text));
            }
            catch {
                messages = messages.filter((msg) => msg.text.toLowerCase().includes(pattern.toLowerCase()));
            }
        }
        return messages;
    }
    clearConsoleMessages(tabId) {
        CDPDebugger.consoleMessagesByTab.delete(tabId);
    }
    addNetworkRequest(tabId, domain, request) {
        let storage = CDPDebugger.networkRequestsByTab.get(tabId);
        if (storage) {
            if (storage.domain !== domain) {
                storage.domain = domain;
                storage.requests = [];
            }
        }
        else {
            storage = { domain, requests: [] };
            CDPDebugger.networkRequestsByTab.set(tabId, storage);
        }
        storage.requests.push(request);
        // Trim if over limit
        if (storage.requests.length > CDPDebugger.MAX_REQUESTS_PER_TAB) {
            const excess = storage.requests.length - CDPDebugger.MAX_REQUESTS_PER_TAB;
            storage.requests.splice(0, excess);
        }
    }
    async enableNetworkTracking(tabId) {
        try {
            if (!CDPDebugger.debuggerListenerRegistered) {
                this.initializeDebuggerEventListener();
            }
            try {
                await this.sendCommand(tabId, "Network.disable");
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            catch {
                // Ignore errors
            }
            await this.sendCommand(tabId, "Network.enable", { maxPostDataSize: 65536 });
            CDPDebugger.networkTrackingEnabled.add(tabId);
        }
        catch (error) {
            throw error;
        }
    }
    getNetworkRequests(tabId, urlPattern) {
        const storage = CDPDebugger.networkRequestsByTab.get(tabId);
        if (!storage)
            return [];
        let requests = storage.requests;
        if (urlPattern) {
            requests = requests.filter((req) => req.url.includes(urlPattern));
        }
        return requests;
    }
    clearNetworkRequests(tabId) {
        CDPDebugger.networkRequestsByTab.delete(tabId);
    }
    isNetworkTrackingEnabled(tabId) {
        return CDPDebugger.networkTrackingEnabled.has(tabId);
    }
    async screenshot(tabId, resizeParams) {
        const params = resizeParams || this.defaultResizeParams;
        if (tabGroupManagerRef) {
            await tabGroupManagerRef.hideIndicatorForToolUse(tabId);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        try {
            const scriptResult = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => ({
                    width: window.innerWidth,
                    height: window.innerHeight,
                    devicePixelRatio: window.devicePixelRatio,
                }),
            });
            if (!scriptResult || !scriptResult[0]?.result) {
                throw new Error("Failed to get viewport information");
            }
            const { width: viewportWidth, height: viewportHeight, devicePixelRatio } = scriptResult[0].result;
            const captureResult = await this.sendCommand(tabId, "Page.captureScreenshot", {
                format: "png",
                captureBeyondViewport: false,
                fromSurface: true,
            });
            if (!captureResult || !captureResult.data) {
                throw new Error("Failed to capture screenshot via CDP");
            }
            const base64Data = captureResult.data;
            // Check if Image is available (service worker context may not have it)
            if (typeof Image === "undefined") {
                return await this.processScreenshotInContentScript(tabId, base64Data, viewportWidth, viewportHeight, devicePixelRatio, params);
            }
            const dataUrl = `data:image/png;base64,${base64Data}`;
            const result = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;
                    const canvas = document.createElement("canvas");
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        reject(new Error("Failed to create 2D context for screenshot processing"));
                        return;
                    }
                    // Handle device pixel ratio scaling
                    if (devicePixelRatio > 1) {
                        width = Math.round(img.width / devicePixelRatio);
                        height = Math.round(img.height / devicePixelRatio);
                        canvas.width = width;
                        canvas.height = height;
                        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, width, height);
                    }
                    else {
                        canvas.width = width;
                        canvas.height = height;
                        ctx.drawImage(img, 0, 0);
                    }
                    const [targetWidth, targetHeight] = calculateTargetDimensions(width, height, params);
                    // If no resizing needed
                    if (width === targetWidth && height === targetHeight) {
                        const pngBase64 = canvas.toDataURL("image/png").split(",")[1];
                        resolve({
                            base64: pngBase64,
                            width,
                            height,
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
                    targetCtx.drawImage(canvas, 0, 0, width, height, 0, 0, targetWidth, targetHeight);
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
        }
        finally {
            if (tabGroupManagerRef) {
                await tabGroupManagerRef.restoreIndicatorAfterToolUse(tabId);
            }
        }
    }
    async processScreenshotInContentScript(tabId, base64Data, viewportWidth, viewportHeight, devicePixelRatio, resizeParams) {
        const scriptResult = await chrome.scripting.executeScript({
            target: { tabId },
            func: (base64, vpWidth, vpHeight, dpr, params, maxChars, initialQuality, qualityStep, minQuality) => {
                const dataUrl = `data:image/png;base64,${base64}`;
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        let width = img.width;
                        let height = img.height;
                        if (dpr > 1) {
                            width = Math.round(img.width / dpr);
                            height = Math.round(img.height / dpr);
                        }
                        const canvas = document.createElement("canvas");
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext("2d");
                        if (!ctx) {
                            reject(new Error("Failed to get canvas context"));
                            return;
                        }
                        if (dpr > 1) {
                            ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, width, height);
                        }
                        else {
                            ctx.drawImage(img, 0, 0);
                        }
                        // Calculate target dimensions
                        const aspectRatio = width / height;
                        const pxPerToken = params.pxPerToken || 28;
                        const maxTokens = params.maxTargetTokens || 1568;
                        const currentTokens = Math.ceil((width / pxPerToken) * (height / pxPerToken));
                        let targetWidth = width;
                        let targetHeight = height;
                        if (currentTokens > maxTokens) {
                            const scale = Math.sqrt(maxTokens / currentTokens);
                            targetWidth = Math.round(width * scale);
                            targetHeight = Math.round(targetWidth / aspectRatio);
                        }
                        // Helper to compress with quality adjustment
                        const compressWithQuality = (sourceCanvas) => {
                            let quality = initialQuality;
                            let result = sourceCanvas.toDataURL("image/jpeg", quality).split(",")[1];
                            while (result.length > maxChars && quality > minQuality) {
                                quality -= qualityStep;
                                result = sourceCanvas.toDataURL("image/jpeg", quality).split(",")[1];
                            }
                            return result;
                        };
                        // If no resize needed
                        if (targetWidth >= width && targetHeight >= height) {
                            const finalBase64 = compressWithQuality(canvas);
                            resolve({
                                base64: finalBase64,
                                width,
                                height,
                                format: "jpeg",
                                viewportWidth: vpWidth,
                                viewportHeight: vpHeight,
                            });
                            return;
                        }
                        // Resize canvas
                        const targetCanvas = document.createElement("canvas");
                        targetCanvas.width = targetWidth;
                        targetCanvas.height = targetHeight;
                        const targetCtx = targetCanvas.getContext("2d");
                        if (!targetCtx) {
                            reject(new Error("Failed to get target canvas context"));
                            return;
                        }
                        targetCtx.drawImage(canvas, 0, 0, width, height, 0, 0, targetWidth, targetHeight);
                        const finalBase64 = compressWithQuality(targetCanvas);
                        resolve({
                            base64: finalBase64,
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
        const result = scriptResult[0].result;
        screenshotContext.setContext(tabId, result);
        return result;
    }
}
// =============================================================================
// Singleton instance export
// =============================================================================
const cdpDebuggerInstance = new CDPDebugger();
// Export CDP debugger instance
export { cdpDebuggerInstance };
