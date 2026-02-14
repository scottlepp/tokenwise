import type { ChatMessage, ContentPart } from "./types";

function extractText(content: string | ContentPart[]): string {
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
}

export function convertMessages(messages: ChatMessage[]): ConvertedMessages {
  const systemMessages: string[] = [];
  const conversationMessages: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(extractText(msg.content));
    } else {
      conversationMessages.push(msg);
    }
  }

  const systemPrompt = systemMessages.length > 0 ? systemMessages.join("\n\n") : null;

  let prompt: string;

  if (conversationMessages.length === 0) {
    prompt = "";
  } else if (
    conversationMessages.length === 1 &&
    conversationMessages[0].role === "user"
  ) {
    // Single user message — pass directly
    prompt = extractText(conversationMessages[0].content);
  } else {
    // Multi-turn — flatten with labels
    const parts: string[] = [];
    for (const msg of conversationMessages) {
      const label = msg.role === "user" ? "[User]" : "[Assistant]";
      parts.push(`${label}\n${extractText(msg.content)}`);
    }
    prompt = parts.join("\n\n");
  }

  // Rough token estimate: ~4 chars per token
  const totalChars =
    prompt.length + (systemPrompt?.length ?? 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  return { systemPrompt, prompt, estimatedTokens };
}
