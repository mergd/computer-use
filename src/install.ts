/**
 * Install/uninstall the Chrome native messaging host and extension.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HOST_NAME = "com.browsermcp.native_host";

/** Chrome Web Store published extension ID */
export const WEBSTORE_EXTENSION_ID = "kenhnnhgbbgkdbedfmijnllgpcognghl";

export function extensionDir(): string {
  return path.resolve(__dirname, "../extension");
}

export function stateDir(): string {
  return path.join(os.homedir(), ".browser-mcp");
}

export function nativeHostDir(): string {
  const p = process.platform;
  if (p === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  if (p === "linux")
    return path.join(os.homedir(), ".config", "google-chrome", "NativeMessagingHosts");
  if (p === "win32")
    return path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "NativeMessagingHosts");
  throw new Error(`Unsupported platform: ${p}`);
}

export function manifestPath(): string {
  return path.join(nativeHostDir(), `${HOST_NAME}.json`);
}

export function hostBinaryPath(): string {
  const ext = process.platform === "win32" ? ".bat" : "";
  return path.join(stateDir(), `native-host${ext}`);
}

/** Read the extension ID from an existing native host manifest. */
export function readExtensionId(): string | null {
  const mp = manifestPath();
  if (!fs.existsSync(mp)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(mp, "utf-8"));
    const origin: string | undefined = data.allowed_origins?.[0];
    return origin?.match(/chrome-extension:\/\/([a-z]{32})\//)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Resolve the full path to a binary so Chrome's minimal PATH can find it. */
function resolveRuntime(name: string): string {
  const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
  try {
    const result = execSync(cmd, { encoding: "utf-8" }).trim();
    return result.split("\n")[0];
  } catch {
    return name;
  }
}

/** Create the wrapper script that Chrome will exec as the native host. */
function writeHostBinary(): string {
  const target = hostBinaryPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const distEntry = path.resolve(__dirname, "native-host-entry.js");
  const srcEntry = path.resolve(__dirname, "native-host-entry.ts");

  if (process.platform === "win32") {
    let cmd: string;
    if (fs.existsSync(distEntry)) {
      const nodePath = resolveRuntime("node");
      cmd = `@"${nodePath}" "${distEntry}" %*`;
    } else {
      const npxPath = resolveRuntime("npx");
      cmd = `@"${npxPath}" tsx "${srcEntry}" %*`;
    }
    fs.writeFileSync(target, `@echo off\r\n${cmd}\r\n`);
    return target;
  }

  let exec: string;
  if (fs.existsSync(distEntry)) {
    const nodePath = resolveRuntime("node");
    exec = `exec "${nodePath}" "${distEntry}" "$@"`;
  } else if (process.versions.bun) {
    const bunPath = resolveRuntime("bun");
    exec = `exec "${bunPath}" "${srcEntry}" "$@"`;
  } else {
    const npxPath = resolveRuntime("npx");
    exec = `exec "${npxPath}" tsx "${srcEntry}" "$@"`;
  }

  const script = `#!/bin/sh
# browser-mcp native host — launched by Chrome native messaging
${exec}
`;

  fs.writeFileSync(target, script, { mode: 0o755 });
  return target;
}

/** Register (or update) the native messaging host for the given extension ID. */
export function install(extensionId: string): { manifestPath: string; hostPath: string } {
  if (!/^[a-z]{32}$/.test(extensionId)) {
    throw new Error(`Invalid Chrome extension ID: "${extensionId}"`);
  }

  const hostPath = writeHostBinary();

  // Include both the provided ID and the Chrome Web Store ID
  const allowedOrigins = [`chrome-extension://${extensionId}/`];
  if (extensionId !== WEBSTORE_EXTENSION_ID) {
    allowedOrigins.push(`chrome-extension://${WEBSTORE_EXTENSION_ID}/`);
  }

  const manifest = {
    name: HOST_NAME,
    description: "Computer Control native messaging host",
    path: hostPath,
    type: "stdio",
    allowed_origins: allowedOrigins,
  };

  const dir = nativeHostDir();
  fs.mkdirSync(dir, { recursive: true });

  const mp = path.join(dir, `${HOST_NAME}.json`);
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 2) + "\n");

  return { manifestPath: mp, hostPath };
}

/** Auto-register native host if not already done. */
export function ensureInstalled(): void {
  const mp = manifestPath();
  if (fs.existsSync(mp)) return;
  install(WEBSTORE_EXTENSION_ID);
}

/** Remove the native messaging host registration. */
export function uninstall(): boolean {
  const mp = manifestPath();
  if (!fs.existsSync(mp)) return false;
  fs.unlinkSync(mp);

  const hp = hostBinaryPath();
  if (fs.existsSync(hp)) fs.unlinkSync(hp);

  return true;
}
