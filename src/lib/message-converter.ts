import type { ChatMessage, ContentPart, ToolDefinition } from "./types";

function extractText(content: string | ContentPart[] | null): string {
  if (content === null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export interface ConvertedMessages {
  systemPrompt: string | null;
  prompt: string;
  estimatedTokens: number;
  hasTools: boolean;
}

function formatToolDefinitions(tools: ToolDefinition[]): string {
  const lines = ["# Available Tools", ""];
  for (const tool of tools) {
    lines.push(`## ${tool.function.name}`);
    if (tool.function.description) {
      lines.push(tool.function.description);
    }
    if (tool.function.parameters) {
      lines.push("Parameters:");
      lines.push("```json");
      lines.push(JSON.stringify(tool.function.parameters, null, 2));
      lines.push("```");
    }
    lines.push("");
  }
  lines.push("When you need to use a tool, respond with a tool call in this exact XML format:");
  lines.push("<tool_call>");
  lines.push('{"name": "tool_name", "arguments": {"param1": "value1"}}');
  lines.push("</tool_call>");
  lines.push("");
  lines.push("You may include text before or after tool calls. You may make multiple tool calls in one response.");
  lines.push("After each tool call, you will receive the result and can continue.");
  lines.push("");
  return lines.join("\n");
}

function formatMessage(msg: ChatMessage): string {
  if (msg.role === "user") {
    return `[User]\n${extractText(msg.content)}`;
  }

  if (msg.role === "assistant") {
    const textContent = extractText(msg.content);
    // If assistant made tool calls, render them as XML
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const toolCallsText = msg.tool_calls.map((tc) => {
        return `<tool_call>\n{"name": "${tc.function.name}", "arguments": ${tc.function.arguments}}\n</tool_call>`;
      }).join("\n");
      return `[Assistant]\n${textContent}${textContent ? "\n" : ""}${toolCallsText}`;
    }
    return `[Assistant]\n${textContent}`;
  }

  if (msg.role === "tool") {
    // Tool result — format as response to the tool call
    const name = msg.name ?? "unknown";
    return `[Tool Result: ${name}]\n${extractText(msg.content)}`;
  }

  return extractText(msg.content);
}

export function convertMessages(messages: ChatMessage[], tools?: ToolDefinition[]): ConvertedMessages {
  const systemMessages: string[] = [];
  const conversationMessages: ChatMessage[] = [];
  const hasTools = Array.isArray(tools) && tools.length > 0;

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(extractText(msg.content));
    } else {
      conversationMessages.push(msg);
    }
  }

  // Prepend tool definitions to system prompt if tools are provided
  if (hasTools) {
    systemMessages.unshift(formatToolDefinitions(tools!));
  }

  const systemPrompt = systemMessages.length > 0 ? systemMessages.join("\n\n") : null;

  let prompt: string;

  if (conversationMessages.length === 0) {
    prompt = "";
  } else if (
    conversationMessages.length === 1 &&
    conversationMessages[0].role === "user" &&
    !hasTools
  ) {
    // Single user message, no tools — pass directly
    prompt = extractText(conversationMessages[0].content);
  } else {
    // Multi-turn or tools — flatten with labels
    const parts: string[] = [];
    for (const msg of conversationMessages) {
      parts.push(formatMessage(msg));
    }
    prompt = parts.join("\n\n");
  }

  // Rough token estimate: ~4 chars per token
  const totalChars =
    prompt.length + (systemPrompt?.length ?? 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  return { systemPrompt, prompt, estimatedTokens, hasTools };
}
