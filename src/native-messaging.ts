/**
 * Chrome native messaging protocol (length-prefixed JSON on stdio).
 *
 * Chrome launches the native host binary and communicates via stdin/stdout
 * with 4-byte little-endian length-prefixed JSON messages.
 */

import { Buffer } from "node:buffer";

export function decodeNativeMessage(buffer: Buffer): { message: unknown; remaining: Buffer } | null {
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32LE(0);
  if (length > 1024 * 1024) throw new Error(`Message too large: ${length} bytes`);
  if (buffer.length < 4 + length) return null;
  const jsonStr = buffer.subarray(4, 4 + length).toString("utf-8");
  const message = JSON.parse(jsonStr);
  return { message, remaining: Buffer.from(buffer.subarray(4 + length)) };
}

export function encodeNativeMessage(message: unknown): Buffer {
  const json = JSON.stringify(message);
  const jsonBuffer = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(jsonBuffer.length, 0);
  return Buffer.concat([header, jsonBuffer]);
}
