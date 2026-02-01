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

const findTextSchema = {
  text: z.string().describe("Text to find on screen"),
  clickable: z.boolean().optional().describe("Return center coordinates for clicking"),
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

  // AppleScript to get UI element hierarchy
  const script = args.app
    ? `
      tell application "System Events"
        tell process "${args.app}"
          set uiTree to my getUITree(entire contents, ${maxDepth}, 0)
          return uiTree
        end tell
      end tell

      on getUITree(elements, maxD, currentD)
        if currentD > maxD then return ""
        set result to ""
        repeat with elem in elements
          try
            set elemRole to role of elem
            set elemTitle to ""
            set elemValue to ""
            try
              set elemTitle to title of elem
            end try
            try
              set elemValue to value of elem
            end try
            try
              set elemDesc to description of elem
            end try
            set pos to position of elem
            set sz to size of elem
            set indent to ""
            repeat currentD times
              set indent to indent & "  "
            end repeat
            set result to result & indent & elemRole
            if elemTitle is not "" then set result to result & " \\\"" & elemTitle & "\\\""
            if elemValue is not "" then set result to result & " [" & elemValue & "]"
            set result to result & " @" & (item 1 of pos) & "," & (item 2 of pos) & " " & (item 1 of sz) & "x" & (item 2 of sz)
            set result to result & "\\n"
          end try
        end repeat
        return result
      end getUITree
    `
    : `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        tell process frontApp
          set allElements to entire contents
          set result to "App: " & frontApp & "\\n"
          repeat with elem in allElements
            try
              set elemRole to role of elem
              set elemTitle to ""
              set elemValue to ""
              try
                set elemTitle to title of elem
              end try
              try
                set elemValue to value of elem
              end try
              set pos to position of elem
              set sz to size of elem
              set result to result & elemRole
              if elemTitle is not "" then set result to result & " \\\"" & elemTitle & "\\\""
              if elemValue is not "" then set result to result & " [" & elemValue & "]"
              set result to result & " @" & (item 1 of pos) & "," & (item 2 of pos) & " " & (item 1 of sz) & "x" & (item 2 of sz)
              set result to result & "\\n"
            end try
          end repeat
          return result
        end tell
      end tell
    `;

  const result = await runOsascript(script);
  return { tree: result };
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
  const swiftScript = `
import Vision
import AppKit

let imagePath = "${tmpImage}"
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERROR: Could not load image")
    exit(1)
}

let request = VNRecognizeTextRequest { request, error in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }

    let height = CGFloat(cgImage.height)
    let width = CGFloat(cgImage.width)

    for observation in observations {
        guard let text = observation.topCandidates(1).first?.string else { continue }
        let box = observation.boundingBox
        // Convert normalized coordinates to pixel coordinates
        let x = Int(box.origin.x * width)
        let y = Int((1 - box.origin.y - box.height) * height)
        let w = Int(box.width * width)
        let h = Int(box.height * height)
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

async function findText(args: { text: string; clickable?: boolean }) {
  const ocrResult = await ocrScreen({});

  const searchLower = args.text.toLowerCase();
  const matches = ocrResult.results.filter(r =>
    r.text.toLowerCase().includes(searchLower)
  );

  if (matches.length === 0) {
    return { found: false, matches: [] };
  }

  const results = matches.map(m => {
    const result: { text: string; bounds: typeof m.bounds; clickPoint?: { x: number; y: number } } = {
      text: m.text,
      bounds: m.bounds,
    };

    if (args.clickable && m.bounds) {
      result.clickPoint = {
        x: m.bounds.x + Math.floor(m.bounds.width / 2),
        y: m.bounds.y + Math.floor(m.bounds.height / 2),
      };
    }

    return result;
  });

  return { found: true, matches: results };
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

  server.tool("screenshot", "Capture screenshot of screen or region", screenshotSchema, async (args) => {
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

  server.tool("find_text", "Find text on screen and get its location", findTextSchema, async (args) => {
    const result = await findText(args);
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
}
