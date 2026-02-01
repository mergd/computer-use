/**
 * Anthropic API client for the find tool.
 * Supports API key authentication with optional MCP sampling fallback.
 */

export interface AnthropicClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface CreateMessageParams {
  model: string;
  max_tokens: number;
  messages: Message[];
}

export interface ContentBlock {
  type: "text";
  text: string;
}

export interface MessageResponse {
  content: ContentBlock[];
  model: string;
  stop_reason: string;
}

export class AnthropicClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(options: AnthropicClientOptions) {
    if (!options.apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || "https://api.anthropic.com";
  }

  async createMessage(params: CreateMessageParams): Promise<MessageResponse> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    return response.json() as Promise<MessageResponse>;
  }
}

// Singleton instance, initialized lazily
let client: AnthropicClient | null = null;

export function getAnthropicClient(apiKey?: string): AnthropicClient | null {
  if (client) return client;

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  client = new AnthropicClient({ apiKey: key });
  return client;
}

export function hasAnthropicClient(apiKey?: string): boolean {
  return !!(apiKey || process.env.ANTHROPIC_API_KEY);
}
