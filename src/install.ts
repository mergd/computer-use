/**
 * Install/uninstall the Chrome native messaging host and extension.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  return path.join(stateDir(), "native-host");
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

/** Create the shell wrapper that Chrome will exec as the native host. */
function writeHostBinary(): string {
  const target = hostBinaryPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // Point at the compiled JS entry or TS source depending on what exists.
  const distEntry = path.resolve(__dirname, "native-host-entry.js");
  const srcEntry = path.resolve(__dirname, "native-host-entry.ts");

  let exec: string;
  if (fs.existsSync(distEntry)) {
    exec = `exec node "${distEntry}" "$@"`;
  } else if (process.versions.bun) {
    exec = `exec bun "${srcEntry}" "$@"`;
  } else {
    exec = `exec npx tsx "${srcEntry}" "$@"`;
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

/** Remove the native messaging host registration. */
export function uninstall(): boolean {
  const mp = manifestPath();
  if (!fs.existsSync(mp)) return false;
  fs.unlinkSync(mp);

  const hp = hostBinaryPath();
  if (fs.existsSync(hp)) fs.unlinkSync(hp);

  return true;
}
