import type { ToolCall } from "./types";

export interface ParsedToolResponse {
  textContent: string | null;
  toolCalls: ToolCall[];
}

/**
 * Parse Claude's text response for <tool_call> XML blocks.
 * Extracts tool calls and separates them from surrounding text.
 */
export function parseToolCalls(text: string): ParsedToolResponse {
  const toolCalls: ToolCall[] = [];
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

  let match;
  while ((match = toolCallRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const name = parsed.name;
      const args = parsed.arguments ?? {};

      toolCalls.push({
        id: `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
        type: "function",
        function: {
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args),
        },
      });
    } catch {
      // Malformed tool call JSON — skip it
      console.warn("[tool-parser] Failed to parse tool call:", match[1].slice(0, 200));
    }
  }

  // Extract text content (everything outside <tool_call> blocks)
  const textContent = text
    .replace(toolCallRegex, "")
    .trim();

  return {
    textContent: textContent || null,
    toolCalls,
  };
}

/**
 * Check if a response text contains any tool calls.
 */
export function hasToolCalls(text: string): boolean {
  return /<tool_call>[\s\S]*?<\/tool_call>/.test(text);
}
