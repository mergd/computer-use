/**
 * MCP Tool definitions for macOS desktop automation.
 *
 * Uses native macOS tools:
 * - screencapture: screenshots
 * - cliclick: mouse/keyboard control (brew install cliclick)
 * - osascript: AppleScript automation
 * - ffmpeg: GIF recording (brew install ffmpeg)
 */

import { z } from "zod";
import { execSync, exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAnthropicClient, hasAnthropicClient } from "./anthropic-client.js";
import { createMessageWithOAuth, isClaudeCodeOAuthAvailable } from "./claude-code-oauth.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Status & Notifications
// ---------------------------------------------------------------------------

let notificationsEnabled = true; // ON by default

export function setNotificationsEnabled(enabled: boolean): void {
  notificationsEnabled = enabled;
}

function setTerminalTitle(status: string): void {
  process.stderr.write(`\x1b]0;computer-control: ${status}\x07`);
}

function clearTerminalTitle(): void {
  process.stderr.write(`\x1b]0;\x07`);
}

// Throttled notification - max 1 per 5 seconds, for high-level operations only
let lastNotifyTime = 0;
export function notify(message: string, subtitle?: string): void {
  if (!notificationsEnabled) return;

  const now = Date.now();
  if (now - lastNotifyTime < 5000) return; // Throttle: 5 second minimum gap
  lastNotifyTime = now;

  // Use macOS notification center - visible even when terminal is hidden
  const subtitleArg = subtitle ? ` subtitle "${subtitle}"` : "";
  try {
    execSync(
      `osascript -e 'display notification "${message}"${subtitleArg} with title "computer-control"'`,
      { stdio: "ignore" }
    );
  } catch {
    // Fallback to OSC 9 terminal notification
    process.stderr.write(`\x1b]9;${message}\x07`);
  }
}

// ---------------------------------------------------------------------------
// GIF Recording State
// ---------------------------------------------------------------------------

interface GifRecordingState {
  isRecording: boolean;
  frames: string[];
  frameDir: string;
  startTime: number;
  interval: ReturnType<typeof setInterval> | null;
  fps: number;
}

const gifState: GifRecordingState = {
  isRecording: false,
  frames: [],
  frameDir: "",
  startTime: 0,
  interval: null,
  fps: 10,
};

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

const screenshotSchema = {
  region: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional().describe("Capture specific region, or full screen if omitted"),
  format: z.enum(["png", "jpg"]).optional().describe("Image format (default: png)"),
};

const mouseClickSchema = {
  x: z.number().describe("X coordinate"),
  y: z.number().describe("Y coordinate"),
  button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default: left)"),
  clicks: z.number().optional().describe("Number of clicks (default: 1, use 2 for double-click)"),
};

const mouseMoveSchema = {
  x: z.number().describe("X coordinate"),
  y: z.number().describe("Y coordinate"),
};

const mouseScrollSchema = {
  direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
  amount: z.number().optional().describe("Scroll amount (default: 3)"),
  x: z.number().optional().describe("X coordinate (default: current position)"),
  y: z.number().optional().describe("Y coordinate (default: current position)"),
};

const mouseDragSchema = {
  startX: z.number().describe("Start X coordinate"),
  startY: z.number().describe("Start Y coordinate"),
  endX: z.number().describe("End X coordinate"),
  endY: z.number().describe("End Y coordinate"),
};

const typeTextSchema = {
  text: z.string().describe("Text to type"),
};

const keyPressSchema = {
  key: z.string().describe("Key to press (e.g., 'return', 'escape', 'tab', 'space', 'delete')"),
  modifiers: z.array(z.enum(["cmd", "ctrl", "alt", "shift"])).optional().describe("Modifier keys"),
};

const getCursorPositionSchema = {};

const getScreenSizeSchema = {};

const runAppleScriptSchema = {
  script: z.string().describe("AppleScript code to execute"),
};

const getActiveWindowSchema = {};

const listWindowsSchema = {
  app: z.string().optional().describe("Filter by application name"),
};

const focusAppSchema = {
  app: z.string().describe("Application name to focus"),
};

const getAccessibilityTreeSchema = {
  app: z.string().optional().describe("Application name (default: frontmost app)"),
  maxDepth: z.number().optional().describe("Maximum depth to traverse (default: 3)"),
};

const ocrScreenSchema = {
  region: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional().describe("Region to OCR, or full screen if omitted"),
};

const findSchema = {
  query: z.string().describe("Natural language description of what to find (e.g., 'search bar', 'submit button', 'red icon')"),
  app: z.string().optional().describe("Application to search in (default: frontmost app)"),
};

const gifStartSchema = {
  fps: z.number().optional().describe("Frames per second (default: 10)"),
};

const gifStopSchema = {};

const gifExportSchema = {
  filename: z.string().optional().describe("Output filename (default: recording-{timestamp}.gif)"),
  width: z.number().optional().describe("Output width in pixels (default: original)"),
  showClickIndicators: z.boolean().optional().describe("Show click indicators (requires tracking)"),
};

// New Swift-based accessibility tools schemas
const clickElementSchema = {
  app: z.string().optional().describe("Application name (default: frontmost app)"),
  ref: z.string().describe("Element reference ID from get_accessibility_tree (e.g., 'ref_5')"),
  action: z.enum(["press", "showMenu", "pick", "cancel", "raise", "confirm"]).optional().describe("Action to perform (default: press)"),
};

const setValueSchema = {
  app: z.string().optional().describe("Application name (default: frontmost app)"),
  ref: z.string().describe("Element reference ID from get_accessibility_tree"),
  value: z.string().describe("Value to set (for text fields, etc.)"),
};

const getElementInfoSchema = {
  app: z.string().optional().describe("Application name (default: frontmost app)"),
  ref: z.string().describe("Element reference ID from get_accessibility_tree"),
};

const selectMenuSchema = {
  app: z.string().optional().describe("Application name (default: frontmost app)"),
  path: z.array(z.string()).describe("Menu path, e.g., ['File', 'New Window']"),
};

const pressKeyCGSchema = {
  key: z.string().describe("Key to press (e.g., 'a', 'return', 'space', 'delete', 'escape', 'tab', 'up', 'down', 'left', 'right', 'f1'-'f12')"),
  modifiers: z.array(z.enum(["cmd", "ctrl", "alt", "shift", "fn"])).optional().describe("Modifier keys to hold"),
  appTarget: z.string().optional().describe("Send to specific app by name (even if not focused)"),
  keyDown: z.boolean().optional().describe("If true, only press down (don't release). Use for holding keys."),
  keyUp: z.boolean().optional().describe("If true, only release (don't press). Use after keyDown."),
};

const runSwiftSchema = {
  code: z.string().describe("Swift code to execute. Has access to Cocoa, ApplicationServices, Foundation."),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkCliclick(): boolean {
  try {
    execSync("which cliclick", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Permission Checking
// ---------------------------------------------------------------------------

export interface PermissionStatus {
  terminal: string;
  accessibility: boolean;
  screenRecording: boolean;
  automation: boolean;
}

export function detectTerminal(): string {
  // Check common terminal environment variables
  const termProgram = process.env.TERM_PROGRAM || "";
  const terminalApp = process.env.__CFBundleIdentifier || "";

  if (termProgram.toLowerCase().includes("ghostty")) return "Ghostty";
  if (termProgram.toLowerCase().includes("iterm")) return "iTerm2";
  if (termProgram.toLowerCase().includes("apple_terminal") || termProgram === "Apple_Terminal") return "Terminal";
  if (termProgram.toLowerCase().includes("vscode")) return "VS Code";
  if (termProgram.toLowerCase().includes("cursor")) return "Cursor";
  if (termProgram.toLowerCase().includes("warp")) return "Warp";
  if (termProgram.toLowerCase().includes("alacritty")) return "Alacritty";
  if (termProgram.toLowerCase().includes("kitty")) return "Kitty";
  if (terminalApp) return terminalApp;
  if (termProgram) return termProgram;

  return "Unknown Terminal";
}

export function checkPermissions(): PermissionStatus {
  const terminal = detectTerminal();

  // Test Accessibility (cliclick needs this)
  let accessibility = false;
  try {
    execSync("cliclick p:.", { stdio: "ignore", timeout: 2000 });
    accessibility = true;
  } catch {}

  // Test Screen Recording (screencapture needs this)
  let screenRecording = false;
  try {
    const testFile = `/tmp/perm-test-${Date.now()}.png`;
    execSync(`screencapture -x "${testFile}"`, { stdio: "ignore", timeout: 2000 });
    if (fs.existsSync(testFile)) {
      const stats = fs.statSync(testFile);
      // If file is very small, permission was denied (creates empty/tiny file)
      screenRecording = stats.size > 1000;
      fs.unlinkSync(testFile);
    }
  } catch {}

  // Test Automation (System Events access)
  let automation = false;
  try {
    execSync(`osascript -e 'tell application "System Events" to get name of first process'`, {
      stdio: "ignore",
      timeout: 2000
    });
    automation = true;
  } catch {}

  return { terminal, accessibility, screenRecording, automation };
}

function checkFfmpeg(): boolean {
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function checkGifsicle(): boolean {
  try {
    execSync("which gifsicle", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function checkSips(): boolean {
  // sips is always available on macOS
  return true;
}

function runCliclick(args: string): string {
  try {
    return execSync(`cliclick ${args}`, { encoding: "utf-8" }).trim();
  } catch (err) {
    throw new Error(`cliclick failed: ${err}`);
  }
}

async function runOsascript(script: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
    return stdout.trim();
  } catch (err) {
    throw new Error(`osascript failed: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

// Max dimensions for screenshots to avoid "Request too large" errors
// Claude's vision works well at 1568px max dimension
const MAX_SCREENSHOT_WIDTH = 1568;
const MAX_SCREENSHOT_HEIGHT = 1568;

async function screenshot(args: { region?: { x: number; y: number; width: number; height: number }; format?: string }) {
  setTerminalTitle("Taking screenshot...");
  const format = args.format || "png";
  const tmpFile = path.join(os.tmpdir(), `screenshot-${Date.now()}.${format}`);

  let cmd = `screencapture -x`; // -x to silence sound
  if (args.region) {
    const { x, y, width, height } = args.region;
    cmd += ` -R${x},${y},${width},${height}`;
  }
  cmd += ` "${tmpFile}"`;

  execSync(cmd);

  // Always resize to fit within max dimensions (maintains aspect ratio)
  // This prevents "Request too large" errors that crash the conversation
  execSync(
    `sips --resampleHeightWidthMax ${MAX_SCREENSHOT_HEIGHT} "${tmpFile}" >/dev/null 2>&1`
  );

  const data = fs.readFileSync(tmpFile);
  const base64 = data.toString("base64");
  fs.unlinkSync(tmpFile);
  clearTerminalTitle();

  return {
    type: "image" as const,
    data: base64,
    mimeType: format === "png" ? "image/png" : "image/jpeg",
  };
}

function mouseClick(args: { x: number; y: number; button?: string; clicks?: number }) {
  const button = args.button || "left";
  const clicks = args.clicks || 1;

  const buttonMap: Record<string, string> = {
    left: "c",
    right: "rc",
    middle: "mc",
  };

  const cmd = buttonMap[button] || "c";

  // For double-click, use dc command
  if (clicks === 2 && button === "left") {
    runCliclick(`dc:${args.x},${args.y}`);
  } else {
    for (let i = 0; i < clicks; i++) {
      runCliclick(`${cmd}:${args.x},${args.y}`);
    }
  }

  return { success: true, x: args.x, y: args.y, button, clicks };
}

function mouseMove(args: { x: number; y: number }) {
  runCliclick(`m:${args.x},${args.y}`);
  return { success: true, x: args.x, y: args.y };
}

function mouseScroll(args: { direction: string; amount?: number; x?: number; y?: number }) {
  const amount = args.amount || 3;

  // Move to position first if specified
  if (args.x !== undefined && args.y !== undefined) {
    runCliclick(`m:${args.x},${args.y}`);
  }

  // cliclick uses positive for up, negative for down
  const scrollMap: Record<string, string> = {
    up: `+${amount}`,
    down: `-${amount}`,
    left: `+${amount},0`, // horizontal scroll
    right: `-${amount},0`,
  };

  // cliclick scroll syntax: scroll up/down with amount
  if (args.direction === "up") {
    runCliclick(`w:+${amount}`);
  } else if (args.direction === "down") {
    runCliclick(`w:-${amount}`);
  } else {
    // For horizontal, use AppleScript
    const dir = args.direction === "left" ? -amount : amount;
    execSync(`osascript -e 'tell application "System Events" to scroll horizontal ${dir}'`);
  }

  return { success: true, direction: args.direction, amount };
}

function mouseDrag(args: { startX: number; startY: number; endX: number; endY: number }) {
  runCliclick(`dd:${args.startX},${args.startY} du:${args.endX},${args.endY}`);
  return { success: true, from: { x: args.startX, y: args.startY }, to: { x: args.endX, y: args.endY } };
}

function typeText(args: { text: string }) {
  // Use cliclick for typing - need to escape special characters
  const escaped = args.text.replace(/([:\-])/g, "\\$1");
  runCliclick(`t:"${escaped}"`);
  return { success: true, text: args.text };
}

function keyPress(args: { key: string; modifiers?: string[] }) {
  const modifiers = args.modifiers || [];

  // Map key names to cliclick key codes
  const keyMap: Record<string, string> = {
    return: "return",
    enter: "enter",
    escape: "esc",
    esc: "esc",
    tab: "tab",
    space: "space",
    delete: "delete",
    backspace: "delete",
    forwarddelete: "fwd-delete",
    up: "arrow-up",
    down: "arrow-down",
    left: "arrow-left",
    right: "arrow-right",
    home: "home",
    end: "end",
    pageup: "page-up",
    pagedown: "page-down",
    f1: "f1", f2: "f2", f3: "f3", f4: "f4", f5: "f5", f6: "f6",
    f7: "f7", f8: "f8", f9: "f9", f10: "f10", f11: "f11", f12: "f12",
    f13: "f13", f14: "f14", f15: "f15", f16: "f16",
    mute: "mute",
    volumeup: "volume-up",
    volumedown: "volume-down",
    playpause: "play-pause",
  };

  const mappedKey = keyMap[args.key.toLowerCase()] || args.key;

  // For key combos with modifiers, use cliclick's kd (key down) and ku (key up)
  // Format: kd:modifier kp:key ku:modifier
  if (modifiers.length > 0) {
    const modMap: Record<string, string> = {
      cmd: "cmd",
      ctrl: "ctrl",
      alt: "alt",
      shift: "shift",
    };

    const modKeys = modifiers.map(m => modMap[m] || m);
    // Hold modifiers, press key, release modifiers
    const cmds: string[] = [];
    for (const mod of modKeys) {
      cmds.push(`kd:${mod}`);
    }
    cmds.push(`kp:${mappedKey}`);
    for (const mod of modKeys.reverse()) {
      cmds.push(`ku:${mod}`);
    }
    runCliclick(cmds.join(" "));
  } else {
    runCliclick(`kp:${mappedKey}`);
  }

  return { success: true, key: args.key, modifiers };
}

function getCursorPosition() {
  const output = runCliclick("p:.");
  // Output format: "x:1234 y:567"
  const match = output.match(/(\d+),(\d+)/);
  if (match) {
    return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
  }
  return { x: 0, y: 0 };
}

async function getScreenSize() {
  const script = `tell application "Finder" to get bounds of window of desktop`;
  const output = await runOsascript(script);
  const [, , width, height] = output.split(", ").map(Number);
  return { width, height };
}

async function runAppleScriptTool(args: { script: string }) {
  const result = await runOsascript(args.script);
  return { success: true, result };
}

async function getActiveWindow() {
  const script = `
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
      set frontWindow to name of front window of (first application process whose frontmost is true)
      return frontApp & "|" & frontWindow
    end tell
  `;
  const output = await runOsascript(script);
  const [app, window] = output.split("|");
  return { app, window };
}

async function listWindows(args: { app?: string }) {
  let script: string;
  if (args.app) {
    script = `
      tell application "System Events"
        tell process "${args.app}"
          set windowList to {}
          repeat with w in windows
            set end of windowList to name of w
          end repeat
          return windowList as text
        end tell
      end tell
    `;
  } else {
    script = `
      tell application "System Events"
        set windowInfo to {}
        repeat with proc in (application processes whose visible is true)
          repeat with w in windows of proc
            set end of windowInfo to (name of proc) & ": " & (name of w)
          end repeat
        end repeat
        return windowInfo as text
      end tell
    `;
  }
  const output = await runOsascript(script);
  return { windows: output.split(", ").filter(Boolean) };
}

async function focusApp(args: { app: string }) {
  const script = `tell application "${args.app}" to activate`;
  await runOsascript(script);
  return { success: true, app: args.app };
}

async function getAccessibilityTree(args: { app?: string; maxDepth?: number }) {
  const maxDepth = args.maxDepth ?? 3;
  const appName = args.app ?? "";

  // Use Swift with native Accessibility APIs for better performance and proper depth limiting
  // The AppleScript `entire contents` approach ignores maxDepth and times out on complex apps
  const swiftScript = `
import Cocoa
import ApplicationServices

var refCounter = 0

struct Element {
    let role: String
    let title: String
    let x: Int
    let y: Int
    let width: Int
    let height: Int
    let refId: Int
    let depth: Int
}

func getStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let str = value as? String else { return nil }
    return str
}

func getPointAttribute(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let axValue = value else { return nil }
    var point = CGPoint.zero
    if AXValueGetValue(axValue as! AXValue, .cgPoint, &point) {
        return point
    }
    return nil
}

func getSizeAttribute(_ element: AXUIElement, _ attribute: String) -> CGSize? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let axValue = value else { return nil }
    var size = CGSize.zero
    if AXValueGetValue(axValue as! AXValue, .cgSize, &size) {
        return size
    }
    return nil
}

func getChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
    guard result == .success, let children = value as? [AXUIElement] else { return [] }
    return children
}

func traverseElement(_ element: AXUIElement, depth: Int, maxDepth: Int, elements: inout [Element]) {
    if depth > maxDepth { return }

    // Get role
    let role = getStringAttribute(element, kAXRoleAttribute as String) ?? "Unknown"

    // Get title or description
    var title = getStringAttribute(element, kAXTitleAttribute as String) ?? ""
    if title.isEmpty {
        title = getStringAttribute(element, kAXDescriptionAttribute as String) ?? ""
    }
    if title.isEmpty {
        title = getStringAttribute(element, kAXValueAttribute as String) ?? ""
    }

    // Get position and size
    let position = getPointAttribute(element, kAXPositionAttribute as String) ?? CGPoint.zero
    let size = getSizeAttribute(element, kAXSizeAttribute as String) ?? CGSize.zero

    // Only include elements that have some visible presence (size > 0)
    if size.width > 0 && size.height > 0 {
        refCounter += 1
        let elem = Element(
            role: role,
            title: title,
            x: Int(position.x),
            y: Int(position.y),
            width: Int(size.width),
            height: Int(size.height),
            refId: refCounter,
            depth: depth
        )
        elements.append(elem)
    }

    // Recurse into children
    let children = getChildren(element)
    for child in children {
        traverseElement(child, depth: depth + 1, maxDepth: maxDepth, elements: &elements)
    }
}

func getAppElement(named appName: String) -> AXUIElement? {
    let apps = NSWorkspace.shared.runningApplications
    for app in apps {
        if let name = app.localizedName, name == appName {
            return AXUIElementCreateApplication(app.processIdentifier)
        }
    }
    return nil
}

func getFrontmostApp() -> (AXUIElement, String)? {
    guard let frontApp = NSWorkspace.shared.frontmostApplication else { return nil }
    let element = AXUIElementCreateApplication(frontApp.processIdentifier)
    return (element, frontApp.localizedName ?? "Unknown")
}

// Main execution
let maxDepth = ${maxDepth}
let appName = "${appName}"

var appElement: AXUIElement?
var resolvedAppName = appName

if appName.isEmpty {
    if let (element, name) = getFrontmostApp() {
        appElement = element
        resolvedAppName = name
    }
} else {
    appElement = getAppElement(named: appName)
}

guard let element = appElement else {
    print("ERROR: Could not find app")
    exit(1)
}

var elements: [Element] = []
traverseElement(element, depth: 0, maxDepth: maxDepth, elements: &elements)

// Output in the expected format: role "name" [ref_N] @x,y wxh
if !appName.isEmpty {
    // Don't print app header when specific app requested
} else {
    print("App: \\(resolvedAppName)")
}

for elem in elements {
    var line = elem.role
    if !elem.title.isEmpty {
        // Escape quotes in title
        let escapedTitle = elem.title.replacingOccurrences(of: "\\\\", with: "\\\\\\\\").replacingOccurrences(of: "\\"", with: "\\\\\\"")
        line += " \\"\\(escapedTitle)\\""
    }
    line += " [ref_\\(elem.refId)]"
    line += " @\\(elem.x),\\(elem.y) \\(elem.width)x\\(elem.height)"
    print(line)
}
`;

  const swiftFile = path.join(os.tmpdir(), `ax-tree-${Date.now()}.swift`);
  fs.writeFileSync(swiftFile, swiftScript);

  try {
    const { stdout } = await execAsync(`swift "${swiftFile}"`, { timeout: 30000 });
    fs.unlinkSync(swiftFile);
    return { tree: stdout };
  } catch (err: unknown) {
    try {
      fs.unlinkSync(swiftFile);
    } catch {
      // Ignore cleanup errors
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Accessibility tree failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Swift-based Accessibility Tools
// ---------------------------------------------------------------------------

// Helper: Common Swift preamble for accessibility operations
function getSwiftAXPreamble(appName: string): string {
  return `
import Cocoa
import ApplicationServices

func getAppElement(named appName: String) -> AXUIElement? {
    let apps = NSWorkspace.shared.runningApplications
    for app in apps {
        if let name = app.localizedName, name == appName {
            return AXUIElementCreateApplication(app.processIdentifier)
        }
    }
    return nil
}

func getFrontmostApp() -> (AXUIElement, String)? {
    guard let frontApp = NSWorkspace.shared.frontmostApplication else { return nil }
    let element = AXUIElementCreateApplication(frontApp.processIdentifier)
    return (element, frontApp.localizedName ?? "Unknown")
}

func getChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
    guard result == .success, let children = value as? [AXUIElement] else { return [] }
    return children
}

// Traverse and find element by ref number
func findElementByRef(_ element: AXUIElement, targetRef: Int, currentRef: inout Int) -> AXUIElement? {
    currentRef += 1
    if currentRef == targetRef {
        return element
    }

    let children = getChildren(element)
    for child in children {
        if let found = findElementByRef(child, targetRef: targetRef, currentRef: &currentRef) {
            return found
        }
    }
    return nil
}

let appName = "${appName}"
var appElement: AXUIElement?

if appName.isEmpty {
    if let (element, _) = getFrontmostApp() {
        appElement = element
    }
} else {
    appElement = getAppElement(named: appName)
}

guard let rootElement = appElement else {
    print("ERROR: Could not find app")
    exit(1)
}
`;
}

async function runSwiftAX(swiftCode: string, timeoutMs: number = 15000, label: string = "swift"): Promise<{ output: string; timing: { total: number } }> {
  const swiftFile = path.join(os.tmpdir(), `ax-${Date.now()}.swift`);
  const startTotal = Date.now();

  fs.writeFileSync(swiftFile, swiftCode);

  try {
    const { stdout, stderr } = await execAsync(`swift "${swiftFile}"`, { timeout: timeoutMs });
    fs.unlinkSync(swiftFile);

    const totalMs = Date.now() - startTotal;

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    // Log timing to stderr for debugging
    console.error(`[${label}] completed in ${totalMs}ms`);

    return { output: stdout, timing: { total: totalMs } };
  } catch (err: unknown) {
    try {
      fs.unlinkSync(swiftFile);
    } catch {
      // Ignore cleanup errors
    }
    const totalMs = Date.now() - startTotal;
    const message = err instanceof Error ? err.message : String(err);

    // Check if it was a timeout
    if (message.includes("TIMEOUT") || message.includes("timed out") || totalMs >= timeoutMs - 100) {
      throw new Error(`Swift execution timed out after ${totalMs}ms (limit: ${timeoutMs}ms). Try reducing maxDepth.`);
    }

    throw new Error(`Swift execution failed after ${totalMs}ms: ${message}`);
  }
}

async function clickElement(args: { app?: string; ref: string; action?: string }) {
  const appName = args.app ?? "";
  const refNum = parseInt(args.ref.replace("ref_", ""), 10);
  const action = args.action ?? "press";

  // Map action names to AX action constants
  const actionMap: Record<string, string> = {
    press: "kAXPressAction",
    showMenu: "kAXShowMenuAction",
    pick: "kAXPickAction",
    cancel: "kAXCancelAction",
    raise: "kAXRaiseAction",
    confirm: "kAXConfirmAction",
  };

  const axAction = actionMap[action] || "kAXPressAction";

  const swiftCode = getSwiftAXPreamble(appName) + `
var refCounter = 0
guard let targetElement = findElementByRef(rootElement, targetRef: ${refNum}, currentRef: &refCounter) else {
    print("ERROR: Could not find element ref_${refNum}")
    exit(1)
}

let result = AXUIElementPerformAction(targetElement, ${axAction} as CFString)
if result == .success {
    print("SUCCESS: Performed ${action} on ref_${refNum}")
} else {
    print("ERROR: Action failed with code \\(result.rawValue)")
    exit(1)
}
`;

  const output = await runSwiftAX(swiftCode);
  return { success: output.includes("SUCCESS"), output: output.trim() };
}

async function setValue(args: { app?: string; ref: string; value: string }) {
  const appName = args.app ?? "";
  const refNum = parseInt(args.ref.replace("ref_", ""), 10);
  // Escape the value for Swift string
  const escapedValue = args.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const swiftCode = getSwiftAXPreamble(appName) + `
var refCounter = 0
guard let targetElement = findElementByRef(rootElement, targetRef: ${refNum}, currentRef: &refCounter) else {
    print("ERROR: Could not find element ref_${refNum}")
    exit(1)
}

// First try to focus the element
AXUIElementPerformAction(targetElement, kAXPressAction as CFString)
usleep(50000) // 50ms

// Set the value
let value = "${escapedValue}" as CFTypeRef
let result = AXUIElementSetAttributeValue(targetElement, kAXValueAttribute as CFString, value)
if result == .success {
    print("SUCCESS: Set value on ref_${refNum}")
} else if result == .attributeUnsupported {
    // Try setting focused attribute and typing instead
    print("ERROR: Element does not support value attribute (code: \\(result.rawValue))")
    exit(1)
} else {
    print("ERROR: Failed to set value (code: \\(result.rawValue))")
    exit(1)
}
`;

  const output = await runSwiftAX(swiftCode);
  return { success: output.includes("SUCCESS"), output: output.trim() };
}

async function getElementInfo(args: { app?: string; ref: string }) {
  const appName = args.app ?? "";
  const refNum = parseInt(args.ref.replace("ref_", ""), 10);

  const swiftCode = getSwiftAXPreamble(appName) + `
func getStringAttr(_ element: AXUIElement, _ attr: String) -> String? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    guard result == .success else { return nil }
    if let str = value as? String { return str }
    if let num = value as? NSNumber { return num.stringValue }
    if let bool = value as? Bool { return bool ? "true" : "false" }
    return nil
}

func getBoolAttr(_ element: AXUIElement, _ attr: String) -> Bool? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    guard result == .success else { return nil }
    if let num = value as? NSNumber { return num.boolValue }
    return nil
}

func getPointAttr(_ element: AXUIElement, _ attr: String) -> CGPoint? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    guard result == .success, let axValue = value else { return nil }
    var point = CGPoint.zero
    if AXValueGetValue(axValue as! AXValue, .cgPoint, &point) { return point }
    return nil
}

func getSizeAttr(_ element: AXUIElement, _ attr: String) -> CGSize? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    guard result == .success, let axValue = value else { return nil }
    var size = CGSize.zero
    if AXValueGetValue(axValue as! AXValue, .cgSize, &size) { return size }
    return nil
}

var refCounter = 0
guard let targetElement = findElementByRef(rootElement, targetRef: ${refNum}, currentRef: &refCounter) else {
    print("ERROR: Could not find element ref_${refNum}")
    exit(1)
}

// Get available attributes
var attrNames: CFArray?
AXUIElementCopyAttributeNames(targetElement, &attrNames)

var info: [String: String] = [:]

// Standard attributes
if let role = getStringAttr(targetElement, kAXRoleAttribute as String) { info["role"] = role }
if let title = getStringAttr(targetElement, kAXTitleAttribute as String) { info["title"] = title }
if let desc = getStringAttr(targetElement, kAXDescriptionAttribute as String) { info["description"] = desc }
if let value = getStringAttr(targetElement, kAXValueAttribute as String) { info["value"] = value }
if let enabled = getBoolAttr(targetElement, kAXEnabledAttribute as String) { info["enabled"] = enabled ? "true" : "false" }
if let focused = getBoolAttr(targetElement, kAXFocusedAttribute as String) { info["focused"] = focused ? "true" : "false" }
if let selected = getBoolAttr(targetElement, "AXSelected") { info["selected"] = selected ? "true" : "false" }

if let pos = getPointAttr(targetElement, kAXPositionAttribute as String) {
    info["position"] = "\\(Int(pos.x)),\\(Int(pos.y))"
}
if let size = getSizeAttr(targetElement, kAXSizeAttribute as String) {
    info["size"] = "\\(Int(size.width))x\\(Int(size.height))"
}

// Get available actions
var actionNames: CFArray?
AXUIElementCopyActionNames(targetElement, &actionNames)
if let actions = actionNames as? [String] {
    info["actions"] = actions.joined(separator: ",")
}

// Print as key=value pairs
for (key, value) in info.sorted(by: { $0.key < $1.key }) {
    print("\\(key)=\\(value)")
}
`;

  const output = await runSwiftAX(swiftCode);

  // Parse output into object
  const info: Record<string, string> = {};
  for (const line of output.trim().split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) {
      info[line.substring(0, idx)] = line.substring(idx + 1);
    }
  }

  return info;
}

async function selectMenu(args: { app?: string; path: string[] }) {
  const appName = args.app ?? "";
  const menuPath = args.path;

  if (menuPath.length === 0) {
    throw new Error("Menu path cannot be empty");
  }

  // Build Swift array literal for the path
  const pathLiteral = menuPath.map(p => `"${p.replace(/"/g, '\\"')}"`).join(", ");

  const swiftCode = getSwiftAXPreamble(appName) + `
func getStringAttr(_ element: AXUIElement, _ attr: String) -> String? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    guard result == .success, let str = value as? String else { return nil }
    return str
}

func findChild(_ parent: AXUIElement, withTitle title: String) -> AXUIElement? {
    let children = getChildren(parent)
    for child in children {
        if let childTitle = getStringAttr(child, kAXTitleAttribute as String), childTitle == title {
            return child
        }
        // Also check AXMenuItems by their title attribute
        if let role = getStringAttr(child, kAXRoleAttribute as String),
           role == "AXMenuItem" || role == "AXMenu" {
            if let childTitle = getStringAttr(child, kAXTitleAttribute as String), childTitle == title {
                return child
            }
        }
    }
    return nil
}

let menuPath: [String] = [${pathLiteral}]

// Find the menu bar
var menuBar: AXUIElement?
var value: AnyObject?
if AXUIElementCopyAttributeValue(rootElement, kAXMenuBarAttribute as CFString, &value) == .success {
    menuBar = (value as! AXUIElement)
}

guard let bar = menuBar else {
    print("ERROR: Could not find menu bar")
    exit(1)
}

var current: AXUIElement = bar

for (index, menuName) in menuPath.enumerated() {
    guard let menuItem = findChild(current, withTitle: menuName) else {
        print("ERROR: Could not find menu item '\\(menuName)'")
        exit(1)
    }

    if index < menuPath.count - 1 {
        // Open submenu
        AXUIElementPerformAction(menuItem, kAXPressAction as CFString)
        usleep(100000) // 100ms for menu to open

        // Get the submenu
        var submenuValue: AnyObject?
        if AXUIElementCopyAttributeValue(menuItem, kAXChildrenAttribute as CFString, &submenuValue) == .success,
           let children = submenuValue as? [AXUIElement],
           let submenu = children.first {
            current = submenu
        } else {
            print("ERROR: Could not open submenu for '\\(menuName)'")
            exit(1)
        }
    } else {
        // Final item - click it
        let result = AXUIElementPerformAction(menuItem, kAXPressAction as CFString)
        if result == .success {
            print("SUCCESS: Selected menu item '\\(menuName)'")
        } else {
            print("ERROR: Failed to click menu item (code: \\(result.rawValue))")
            exit(1)
        }
    }
}
`;

  const output = await runSwiftAX(swiftCode);
  return { success: output.includes("SUCCESS"), output: output.trim() };
}

async function pressKeyCG(args: {
  key: string;
  modifiers?: string[];
  appTarget?: string;
  keyDown?: boolean;
  keyUp?: boolean;
}) {
  const modifiers = args.modifiers ?? [];
  const appTarget = args.appTarget ?? "";
  const keyDown = args.keyDown ?? false;
  const keyUp = args.keyUp ?? false;

  // Map key names to virtual key codes
  // Based on: https://developer.apple.com/documentation/coregraphics/cgkeycode
  const keyCodeMap: Record<string, number> = {
    // Letters
    a: 0x00, s: 0x01, d: 0x02, f: 0x03, h: 0x04, g: 0x05, z: 0x06, x: 0x07,
    c: 0x08, v: 0x09, b: 0x0B, q: 0x0C, w: 0x0D, e: 0x0E, r: 0x0F, y: 0x10,
    t: 0x11, 1: 0x12, 2: 0x13, 3: 0x14, 4: 0x15, 6: 0x16, 5: 0x17, "=": 0x18,
    9: 0x19, 7: 0x1A, "-": 0x1B, 8: 0x1C, 0: 0x1D, "]": 0x1E, o: 0x1F, u: 0x20,
    "[": 0x21, i: 0x22, p: 0x23, l: 0x25, j: 0x26, "'": 0x27, k: 0x28, ";": 0x29,
    "\\": 0x2A, ",": 0x2B, "/": 0x2C, n: 0x2D, m: 0x2E, ".": 0x2F, "`": 0x32,
    // Special keys
    return: 0x24, enter: 0x24, tab: 0x30, space: 0x31, delete: 0x33, backspace: 0x33,
    escape: 0x35, esc: 0x35,
    // Arrow keys
    left: 0x7B, right: 0x7C, down: 0x7D, up: 0x7E,
    // Function keys
    f1: 0x7A, f2: 0x78, f3: 0x63, f4: 0x76, f5: 0x60, f6: 0x61,
    f7: 0x62, f8: 0x64, f9: 0x65, f10: 0x6D, f11: 0x67, f12: 0x6F,
    // Other
    home: 0x73, end: 0x77, pageup: 0x74, pagedown: 0x79,
    forwarddelete: 0x75, help: 0x72,
  };

  const keyLower = args.key.toLowerCase();
  const keyCode = keyCodeMap[keyLower];

  if (keyCode === undefined) {
    throw new Error(`Unknown key: ${args.key}. Supported: ${Object.keys(keyCodeMap).join(", ")}`);
  }

  // Build modifier flags
  const modifierFlags: string[] = [];
  for (const mod of modifiers) {
    switch (mod.toLowerCase()) {
      case "cmd": modifierFlags.push(".maskCommand"); break;
      case "ctrl": modifierFlags.push(".maskControl"); break;
      case "alt": modifierFlags.push(".maskAlternate"); break;
      case "shift": modifierFlags.push(".maskShift"); break;
      case "fn": modifierFlags.push(".maskSecondaryFn"); break;
    }
  }

  const flagsExpr = modifierFlags.length > 0
    ? `[${modifierFlags.join(", ")}]`
    : "[]";

  const swiftCode = `
import Cocoa
import ApplicationServices

${appTarget ? `
func getAppPid(named appName: String) -> pid_t? {
    let apps = NSWorkspace.shared.runningApplications
    for app in apps {
        if let name = app.localizedName, name == appName {
            return app.processIdentifier
        }
    }
    return nil
}
` : ""}

let keyCode: CGKeyCode = ${keyCode}
let flags: CGEventFlags = CGEventFlags(rawValue: ${modifierFlags.map(f => `CGEventFlags${f}.rawValue`).join(" | ") || "0"})

${keyDown && !keyUp ? `
// Key down only
guard let eventDown = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true) else {
    print("ERROR: Could not create key event")
    exit(1)
}
eventDown.flags = flags
${appTarget ? `
if let pid = getAppPid(named: "${appTarget}") {
    eventDown.postToPid(pid)
} else {
    print("ERROR: Could not find app ${appTarget}")
    exit(1)
}
` : `eventDown.post(tap: .cghidEventTap)`}
` : keyUp && !keyDown ? `
// Key up only
guard let eventUp = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
    print("ERROR: Could not create key event")
    exit(1)
}
eventUp.flags = flags
${appTarget ? `
if let pid = getAppPid(named: "${appTarget}") {
    eventUp.postToPid(pid)
} else {
    print("ERROR: Could not find app ${appTarget}")
    exit(1)
}
` : `eventUp.post(tap: .cghidEventTap)`}
` : `
// Full key press (down + up)
guard let eventDown = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
      let eventUp = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
    print("ERROR: Could not create key event")
    exit(1)
}
eventDown.flags = flags
eventUp.flags = flags
${appTarget ? `
if let pid = getAppPid(named: "${appTarget}") {
    eventDown.postToPid(pid)
    usleep(10000)
    eventUp.postToPid(pid)
} else {
    print("ERROR: Could not find app ${appTarget}")
    exit(1)
}
` : `
eventDown.post(tap: .cghidEventTap)
usleep(10000)
eventUp.post(tap: .cghidEventTap)
`}
`}

print("SUCCESS: Key ${args.key} ${keyDown && !keyUp ? "down" : keyUp && !keyDown ? "up" : "pressed"}${modifiers.length > 0 ? ` with ${modifiers.join("+")}` : ""}${appTarget ? ` to ${appTarget}` : ""}")
`;

  const output = await runSwiftAX(swiftCode);
  return { success: output.includes("SUCCESS"), output: output.trim() };
}

async function runSwift(args: { code: string }) {
  const swiftCode = `
import Cocoa
import ApplicationServices
import Foundation

${args.code}
`;

  const output = await runSwiftAX(swiftCode);
  return { output: output.trim() };
}

async function ocrScreen(args: { region?: { x: number; y: number; width: number; height: number } }) {
  // Take screenshot first
  const tmpImage = path.join(os.tmpdir(), `ocr-${Date.now()}.png`);

  let cmd = "screencapture -x";
  if (args.region) {
    const { x, y, width, height } = args.region;
    cmd += ` -R${x},${y},${width},${height}`;
  }
  cmd += ` "${tmpImage}"`;
  execSync(cmd);

  // Use macOS Vision framework via Swift for OCR
  // Accounts for Retina scaling by dividing pixel coords by backingScaleFactor
  const swiftScript = `
import Vision
import AppKit

let imagePath = "${tmpImage}"
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERROR: Could not load image")
    exit(1)
}

// Get Retina scale factor (usually 2.0 on Retina displays)
let scaleFactor = NSScreen.main?.backingScaleFactor ?? 1.0

let request = VNRecognizeTextRequest { request, error in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }

    let height = CGFloat(cgImage.height)
    let width = CGFloat(cgImage.width)

    for observation in observations {
        guard let text = observation.topCandidates(1).first?.string else { continue }
        let box = observation.boundingBox
        // Convert normalized coordinates to logical screen coordinates (divide by scale factor)
        let x = Int(box.origin.x * width / scaleFactor)
        let y = Int((1 - box.origin.y - box.height) * height / scaleFactor)
        let w = Int(box.width * width / scaleFactor)
        let h = Int(box.height * height / scaleFactor)
        print("\\(text)|\\(x),\\(y),\\(w),\\(h)")
    }
}

request.recognitionLevel = .accurate

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
`;

  const swiftFile = path.join(os.tmpdir(), `ocr-${Date.now()}.swift`);
  fs.writeFileSync(swiftFile, swiftScript);

  try {
    const { stdout } = await execAsync(`swift "${swiftFile}"`);
    fs.unlinkSync(swiftFile);
    fs.unlinkSync(tmpImage);

    // Parse output into structured results
    const lines = stdout.trim().split("\n").filter(Boolean);
    const results = lines.map(line => {
      const [text, coords] = line.split("|");
      if (coords) {
        const [x, y, w, h] = coords.split(",").map(Number);
        return { text, bounds: { x, y, width: w, height: h } };
      }
      return { text, bounds: null };
    });

    return { results };
  } catch (err) {
    fs.unlinkSync(swiftFile);
    fs.unlinkSync(tmpImage);
    throw new Error(`OCR failed: ${err}`);
  }
}

// Find prompt for Haiku - mirrors browser find tool
const FIND_PROMPT = `You are helping find UI elements on a macOS screen. The user wants to find: "{query}"

Here is a screenshot of the current screen and the accessibility tree of UI elements.

The accessibility tree format is:
role "name" [ref_N] @x,y wxh

Where:
- role: The element type (AXButton, AXLink, AXStaticText, AXImage, etc.)
- name: The visible text or description
- ref_N: Reference ID for the element
- @x,y: Screen coordinates (top-left corner)
- wxh: Width and height in pixels

Accessibility tree:
{tree}

Find ALL elements that match the user's query. Consider both the visual appearance in the screenshot AND the accessibility tree. Return up to 10 most relevant matches, ordered by relevance.

Return your findings in this exact format:

FOUND: <total_number_of_matching_elements>
---
ref_N | role | name | @x,y wxh | reason why this matches
...

For each match, include the click coordinates (center of element) like this:
CLICK: x,y

If no matching elements are found, return only:
FOUND: 0
ERROR: explanation of why no elements were found`;

interface FindMatch {
  ref: string;
  role: string;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  clickPoint: { x: number; y: number };
  reason?: string;
}

interface FindResult {
  success: boolean;
  matches: FindMatch[];
  totalFound: number;
  error?: string;
}

function parseFindResponse(response: string, treeLines: string[]): FindResult {
  const lines = response.trim().split("\n").map(l => l.trim()).filter(l => l);

  let totalFound = 0;
  const matches: FindMatch[] = [];
  let error: string | undefined;

  // Build a map of ref -> position/size from tree
  const refMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const line of treeLines) {
    const refMatch = line.match(/\[ref_(\d+)\]\s*@(\d+),(\d+)\s+(\d+)x(\d+)/);
    if (refMatch) {
      refMap.set(`ref_${refMatch[1]}`, {
        x: parseInt(refMatch[2]),
        y: parseInt(refMatch[3]),
        w: parseInt(refMatch[4]),
        h: parseInt(refMatch[5]),
      });
    }
  }

  for (const line of lines) {
    if (line.startsWith("FOUND:")) {
      totalFound = parseInt(line.split(":")[1].trim()) || 0;
    } else if (line.startsWith("ERROR:")) {
      error = line.substring(6).trim();
    } else if (line.includes("|") && line.includes("ref_")) {
      const parts = line.split("|").map(p => p.trim());
      if (parts.length >= 4) {
        const ref = parts[0];
        const coords = refMap.get(ref);
        if (coords) {
          matches.push({
            ref,
            role: parts[1],
            name: parts[2],
            position: { x: coords.x, y: coords.y },
            size: { width: coords.w, height: coords.h },
            clickPoint: {
              x: coords.x + Math.floor(coords.w / 2),
              y: coords.y + Math.floor(coords.h / 2),
            },
            reason: parts[4] || undefined,
          });
        }
      }
    }
  }

  return {
    success: totalFound > 0 && matches.length > 0,
    matches,
    totalFound,
    error,
  };
}

async function find(args: { query: string; app?: string }): Promise<FindResult> {
  // 1. Take screenshot
  const screenshotResult = await screenshot({ format: "png" });
  const screenshotBase64 = screenshotResult.data;

  // 2. Get accessibility tree
  const treeResult = await getAccessibilityTree({ app: args.app });
  const tree = treeResult.tree;
  const treeLines = tree.split("\n").filter(Boolean);

  // 3. Build prompt
  const prompt = FIND_PROMPT
    .replace("{query}", args.query)
    .replace("{tree}", tree);

  // 4. Send to Haiku with screenshot
  try {
    let responseText: string;

    const client = getAnthropicClient();
    if (client) {
      const response = await client.createMessage({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: screenshotBase64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        }],
      });

      const textContent = response.content.find(c => c.type === "text");
      if (!textContent) {
        return { success: false, matches: [], totalFound: 0, error: "No text response from API" };
      }
      responseText = textContent.text;
    } else if (await isClaudeCodeOAuthAvailable()) {
      // OAuth fallback: text-only (no image support via CLI)
      const textOnlyPrompt = prompt + "\n\n(Note: No screenshot available, using accessibility tree only)";
      const response = await createMessageWithOAuth({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: textOnlyPrompt,
        }],
      });

      const textContent = response.content.find((c: { type: string }) => c.type === "text") as { type: "text"; text: string } | undefined;
      if (!textContent) {
        return { success: false, matches: [], totalFound: 0, error: "No text response from OAuth" };
      }
      responseText = textContent.text;
    } else {
      return {
        success: false,
        matches: [],
        totalFound: 0,
        error: "Find tool requires ANTHROPIC_API_KEY or Claude Code OAuth credentials",
      };
    }

    return parseFindResponse(responseText, treeLines);
  } catch (err) {
    return {
      success: false,
      matches: [],
      totalFound: 0,
      error: `Find failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function gifStart(args: { fps?: number }) {
  if (gifState.isRecording) {
    return { success: false, error: "Already recording" };
  }

  const fps = args.fps || 10;
  const frameDir = path.join(os.tmpdir(), `gif-recording-${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });

  gifState.isRecording = true;
  gifState.frames = [];
  gifState.frameDir = frameDir;
  gifState.startTime = Date.now();
  gifState.fps = fps;

  // Capture frames at the specified FPS
  const intervalMs = Math.floor(1000 / fps);
  let frameNum = 0;

  gifState.interval = setInterval(() => {
    if (!gifState.isRecording) return;

    const framePath = path.join(frameDir, `frame-${String(frameNum).padStart(5, "0")}.png`);
    try {
      execSync(`screencapture -x "${framePath}"`, { stdio: "ignore" });
      gifState.frames.push(framePath);
      frameNum++;
    } catch {
      // Ignore capture errors
    }
  }, intervalMs);

  notify("GIF recording started", `${fps} FPS`);

  return {
    success: true,
    message: `Recording started at ${fps} FPS`,
    frameDir,
  };
}

function gifStop() {
  if (!gifState.isRecording) {
    return { success: false, error: "Not recording" };
  }

  if (gifState.interval) {
    clearInterval(gifState.interval);
    gifState.interval = null;
  }

  gifState.isRecording = false;
  const duration = (Date.now() - gifState.startTime) / 1000;

  return {
    success: true,
    frames: gifState.frames.length,
    duration: `${duration.toFixed(1)}s`,
    message: `Recording stopped. ${gifState.frames.length} frames captured.`,
  };
}

// GIF output directory - temp folder with auto-cleanup
export const GIF_OUTPUT_DIR = path.join(os.tmpdir(), "computer-control-gifs");
const GIF_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export function cleanupOldGifs(): void {
  try {
    if (!fs.existsSync(GIF_OUTPUT_DIR)) return;
    const now = Date.now();
    for (const file of fs.readdirSync(GIF_OUTPUT_DIR)) {
      const filePath = path.join(GIF_OUTPUT_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > GIF_MAX_AGE_MS) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {}
}

async function gifExport(args: { filename?: string; width?: number }) {
  if (gifState.isRecording) {
    return { success: false, error: "Still recording. Call gif_stop first." };
  }

  if (gifState.frames.length === 0) {
    return { success: false, error: "No frames to export. Start recording first." };
  }

  // Ensure output dir exists and cleanup old files
  fs.mkdirSync(GIF_OUTPUT_DIR, { recursive: true });
  cleanupOldGifs();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = args.filename || `recording-${timestamp}.gif`;
  const outputPath = path.join(GIF_OUTPUT_DIR, filename);

  const hasGifsicle = checkGifsicle();
  const hasFfmpeg = checkFfmpeg();

  if (!hasGifsicle && !hasFfmpeg) {
    return {
      success: false,
      error: "No GIF encoder found. Install one: brew install gifsicle (lightweight, ~1MB) or brew install ffmpeg (full-featured, ~300MB)",
    };
  }

  try {
    if (hasGifsicle) {
      // Use gifsicle (lightweight)
      // First convert PNGs to GIF frames using sips, then combine with gifsicle
      const gifFrames: string[] = [];

      for (const frame of gifState.frames) {
        const gifFrame = frame.replace(".png", ".gif");
        // sips can convert PNG to GIF
        execSync(`sips -s format gif "${frame}" --out "${gifFrame}" 2>/dev/null`, { stdio: "ignore" });
        gifFrames.push(gifFrame);
      }

      // Calculate delay in centiseconds (gifsicle uses 1/100th of a second)
      const delay = Math.round(100 / gifState.fps);

      let cmd = `gifsicle --delay=${delay} --loop`;
      if (args.width) {
        cmd += ` --resize-width ${args.width}`;
      }
      cmd += ` -O3`; // Optimize
      cmd += ` ${gifFrames.map(f => `"${f}"`).join(" ")}`;
      cmd += ` -o "${outputPath}"`;

      await execAsync(cmd);

      // Clean up GIF frames
      for (const gf of gifFrames) {
        try { fs.unlinkSync(gf); } catch {}
      }
    } else {
      // Use ffmpeg (full-featured)
      const inputPattern = path.join(gifState.frameDir, "frame-%05d.png");
      let cmd = `ffmpeg -y -framerate ${gifState.fps} -i "${inputPattern}"`;

      if (args.width) {
        cmd += ` -vf "scale=${args.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"`;
      } else {
        cmd += ` -vf "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"`;
      }

      cmd += ` "${outputPath}"`;
      await execAsync(cmd);
    }

    // Clean up PNG frames
    for (const frame of gifState.frames) {
      try { fs.unlinkSync(frame); } catch {}
    }
    try { fs.rmdirSync(gifState.frameDir); } catch {}

    // Reset state
    gifState.frames = [];
    gifState.frameDir = "";

    // Get file size
    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    notify("GIF exported", `${sizeMB} MB (auto-deletes in 1hr)`);

    return {
      success: true,
      path: outputPath,
      size: `${sizeMB} MB`,
      encoder: hasGifsicle ? "gifsicle" : "ffmpeg",
      message: `GIF exported to ${outputPath}`,
    };
  } catch (err) {
    notify("GIF export failed");
    return { success: false, error: `GIF export failed: ${err}` };
  }
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerDesktopTools(server: McpServer): void {
  // Check for cliclick on startup
  const hasCliclick = checkCliclick();

  server.tool("screenshot", "Capture screenshot of screen or region. Images are auto-scaled to max 1568px. For higher detail on specific areas, use the region parameter to capture a smaller area at higher effective resolution.", screenshotSchema, async (args) => {
    const result = await screenshot(args);
    return {
      content: [{
        type: "image",
        data: result.data,
        mimeType: result.mimeType,
      }],
    };
  });

  server.tool("mouse_click", "Click at screen coordinates", mouseClickSchema, async (args) => {
    if (!hasCliclick) throw new Error("cliclick not installed. Run: brew install cliclick");
    const result = mouseClick(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("mouse_move", "Move cursor to coordinates", mouseMoveSchema, async (args) => {
    if (!hasCliclick) throw new Error("cliclick not installed. Run: brew install cliclick");
    const result = mouseMove(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("mouse_scroll", "Scroll in a direction", mouseScrollSchema, async (args) => {
    if (!hasCliclick) throw new Error("cliclick not installed. Run: brew install cliclick");
    const result = mouseScroll(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("mouse_drag", "Drag from one point to another", mouseDragSchema, async (args) => {
    if (!hasCliclick) throw new Error("cliclick not installed. Run: brew install cliclick");
    const result = mouseDrag(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("type_text", "Type text at current cursor position", typeTextSchema, async (args) => {
    if (!hasCliclick) throw new Error("cliclick not installed. Run: brew install cliclick");
    const result = typeText(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("key_press", "Press a key with optional modifiers", keyPressSchema, async (args) => {
    if (!hasCliclick) throw new Error("cliclick not installed. Run: brew install cliclick");
    const result = keyPress(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("get_cursor_position", "Get current cursor coordinates", getCursorPositionSchema, async () => {
    if (!hasCliclick) throw new Error("cliclick not installed. Run: brew install cliclick");
    const result = getCursorPosition();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("get_screen_size", "Get screen dimensions", getScreenSizeSchema, async () => {
    const result = await getScreenSize();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("run_applescript", "Execute AppleScript code", runAppleScriptSchema, async (args) => {
    const result = await runAppleScriptTool(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("get_active_window", "Get the currently focused window", getActiveWindowSchema, async () => {
    const result = await getActiveWindow();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("list_windows", "List open windows", listWindowsSchema, async (args) => {
    const result = await listWindows(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("focus_app", "Bring an application to the foreground", focusAppSchema, async (args) => {
    const result = await focusApp(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  // Accessibility & OCR Tools
  server.tool("get_accessibility_tree", "Get UI element hierarchy of an application", getAccessibilityTreeSchema, async (args) => {
    const result = await getAccessibilityTree(args);
    return { content: [{ type: "text", text: result.tree }] };
  });

  server.tool("ocr_screen", "Extract text from screen using OCR", ocrScreenSchema, async (args) => {
    const result = await ocrScreen(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.tool("find", "Find elements on screen using natural language (e.g., 'search bar', 'submit button', 'red icon')", findSchema, async (args) => {
    const result = await find(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  // GIF Recording Tools
  server.tool("gif_start", "Start recording screen as GIF", gifStartSchema, async (args) => {
    const result = gifStart(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("gif_stop", "Stop GIF recording", gifStopSchema, async () => {
    const result = gifStop();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("gif_export", "Export recorded frames to GIF file (requires gifsicle or ffmpeg)", gifExportSchema, async (args) => {
    const result = await gifExport(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  // Swift-based Accessibility Tools
  server.tool("click_element", "Click an element by its ref_id from get_accessibility_tree using native accessibility APIs (more reliable than coordinate clicking)", clickElementSchema, async (args) => {
    const result = await clickElement(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("set_value", "Set the value of a text field or other input element by ref_id", setValueSchema, async (args) => {
    const result = await setValue(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("get_element_info", "Get detailed info about an element (enabled, focused, value, available actions, etc.)", getElementInfoSchema, async (args) => {
    const result = await getElementInfo(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.tool("select_menu", "Select a menu item by path (e.g., ['File', 'New Window']) using native menu APIs", selectMenuSchema, async (args) => {
    const result = await selectMenu(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("press_key_cg", "Press a key using CoreGraphics (supports all modifiers, can target background apps)", pressKeyCGSchema, async (args) => {
    const result = await pressKeyCG(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("run_swift", "Execute arbitrary Swift code with access to Cocoa, ApplicationServices, Foundation", runSwiftSchema, async (args) => {
    const result = await runSwift(args);
    return { content: [{ type: "text", text: result.output }] };
  });
}
