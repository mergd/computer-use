/**
 * Find tool implementation.
 * Uses Anthropic API to interpret natural language queries against accessibility trees.
 */

import { getAnthropicClient, hasAnthropicClient } from "./anthropic-client.js";

const FIND_PROMPT = `You are helping find elements on a page/screen. The user wants to find: "{query}"

Here is the accessibility tree:
{tree}

Find ALL elements that match the user's query. Return up to 20 most relevant matches, ordered by relevance.

Return your findings in this exact format (one line per matching element):

FOUND: <total_number_of_matching_elements>
SHOWING: <number_shown_up_to_20>
---
ref_X | role | name | type | reason why this matches
ref_Y | role | name | type | reason why this matches
...

If there are more than 20 matches, add this line at the end:
MORE: Use a more specific query to see additional results

If no matching elements are found, return only:
FOUND: 0
ERROR: explanation of why no elements were found`;

export interface FindMatch {
  ref: string;
  role: string;
  name: string;
  type?: string;
  description?: string;
}

export interface FindResult {
  success: boolean;
  matches: FindMatch[];
  totalFound: number;
  hasMore: boolean;
  error?: string;
}

/**
 * Parse the LLM response into structured findings
 */
function parseFindings(response: string): FindResult {
  const lines = response.trim().split("\n").map(l => l.trim()).filter(l => l);

  let totalFound = 0;
  const matches: FindMatch[] = [];
  let error: string | undefined;
  let hasMore = false;

  for (const line of lines) {
    if (line.startsWith("FOUND:")) {
      totalFound = parseInt(line.split(":")[1].trim()) || 0;
    } else if (line.startsWith("SHOWING:")) {
      // Just informational
    } else if (line.startsWith("ERROR:")) {
      error = line.substring(6).trim();
    } else if (line.startsWith("MORE:")) {
      hasMore = true;
    } else if (line.includes("|") && line.startsWith("ref_")) {
      const parts = line.split("|").map(p => p.trim());
      if (parts.length >= 4) {
        matches.push({
          ref: parts[0],
          role: parts[1],
          name: parts[2],
          type: parts[3] || undefined,
          description: parts[4] || undefined,
        });
      }
    }
  }

  return {
    success: totalFound > 0 && matches.length > 0,
    matches,
    totalFound,
    hasMore,
    error,
  };
}

/**
 * Format the find result for MCP response
 */
function formatFindResult(result: FindResult): string {
  if (!result.success || result.matches.length === 0) {
    return result.error || "No matching elements found";
  }

  let output = `Found ${result.totalFound} matching element${result.totalFound === 1 ? "" : "s"}`;
  if (result.hasMore) {
    output += ` (showing first ${result.matches.length}, use a more specific query to narrow results)`;
  }
  output += "\n\n";

  output += result.matches.map(m =>
    `- ${m.ref}: ${m.role}${m.name ? ` "${m.name}"` : ""}${m.type ? ` (${m.type})` : ""}${m.description ? ` - ${m.description}` : ""}`
  ).join("\n");

  return output;
}

export interface FindToolOptions {
  apiKey?: string;
}

/**
 * Execute the find tool
 * @param query - Natural language query (e.g., "search bar", "login button")
 * @param tree - Accessibility tree string from read_page or macOS
 * @param options - Optional API key override
 */
export async function executeFindTool(
  query: string,
  tree: string,
  options: FindToolOptions = {}
): Promise<{ output?: string; error?: string }> {
  const client = getAnthropicClient(options.apiKey);

  if (!client) {
    return {
      error: "Find tool requires an Anthropic API key. Set ANTHROPIC_API_KEY environment variable or provide it in options.",
    };
  }

  try {
    const prompt = FIND_PROMPT
      .replace("{query}", query)
      .replace("{tree}", tree);

    const response = await client.createMessage({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const textContent = response.content.find(c => c.type === "text");
    if (!textContent) {
      return { error: "No text response from API" };
    }

    const result = parseFindings(textContent.text);
    return { output: formatFindResult(result) };
  } catch (err) {
    return {
      error: `Find tool failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Check if find tool is available (has API key configured)
 */
export function isFindToolAvailable(apiKey?: string): boolean {
  return hasAnthropicClient(apiKey);
}
