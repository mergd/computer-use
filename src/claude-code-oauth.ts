/**
 * Claude Code CLI client for the find tool.
 * Uses Claude CLI subprocess to make API calls via Claude Code's authentication.
 */

import { spawn } from "child_process";

export interface ClaudeCodeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeCodeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeCodeMessage[];
  system?: string;
}

export interface ClaudeCodeResponse {
  content: Array<{ type: "text"; text: string }>;
  model: string;
  stop_reason: string;
}

// Cache the CLI check result
let cliAvailable: boolean | null = null;

/**
 * Check if Claude CLI is installed
 */
async function checkCliInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { stdio: "pipe" });

    proc.on("error", () => {
      resolve(false);
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * Check if Claude Code CLI is available
 */
export async function isClaudeCodeOAuthAvailable(): Promise<boolean> {
  if (cliAvailable !== null) {
    return cliAvailable;
  }
  cliAvailable = await checkCliInstalled();
  return cliAvailable;
}

/**
 * Synchronous check - returns cached value or false if not yet checked
 */
export function isClaudeCodeOAuthAvailableSync(): boolean {
  return cliAvailable === true;
}

// Initialize the cache on module load
checkCliInstalled().then(result => {
  cliAvailable = result;
});

/**
 * Make a request using Claude CLI subprocess
 */
export async function createMessageWithOAuth(
  params: ClaudeCodeRequest
): Promise<ClaudeCodeResponse> {
  // Build the prompt from messages
  const prompt = params.messages
    .map(m => m.content)
    .join("\n\n");

  // Map model name to Claude CLI model alias
  let modelAlias = "haiku";
  if (params.model.includes("opus")) {
    modelAlias = "opus";
  } else if (params.model.includes("sonnet")) {
    modelAlias = "sonnet";
  }

  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--output-format", "json",
      "--model", modelAlias,
      "--max-turns", "1",
      prompt,
    ];

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Parse the JSON output
        const result = JSON.parse(stdout);

        // Extract text from the result
        let text = "";
        if (result.result) {
          text = result.result;
        } else if (result.content) {
          // Handle content array format
          if (Array.isArray(result.content)) {
            text = result.content
              .filter((c: { type: string }) => c.type === "text")
              .map((c: { text: string }) => c.text)
              .join("");
          } else {
            text = String(result.content);
          }
        } else if (typeof result === "string") {
          text = result;
        } else {
          text = JSON.stringify(result);
        }

        resolve({
          content: [{ type: "text", text }],
          model: params.model,
          stop_reason: "end_turn",
        });
      } catch (parseErr) {
        // If not valid JSON, treat stdout as plain text response
        if (stdout.trim()) {
          resolve({
            content: [{ type: "text", text: stdout.trim() }],
            model: params.model,
            stop_reason: "end_turn",
          });
        } else {
          reject(new Error(`Failed to parse Claude CLI output: ${parseErr}`));
        }
      }
    });

    // Close stdin
    proc.stdin?.end();
  });
}
