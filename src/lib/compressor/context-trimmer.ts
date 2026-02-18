import type { ChatMessage } from "../types";

const TOKEN_THRESHOLD = 150_000; // estimated tokens — only trim very large conversations
const KEEP_RECENT_TURNS = 10; // keep last N user turns in full
const MAX_TURNS_WITH_ASSISTANT = 20; // drop assistant turns older than this

/**
 * Stage 5 — Context Trimmer
 * For very long conversations: keep recent turns, summarize older ones.
 */
export function trimContext(messages: ChatMessage[], estimatedTokens: number): ChatMessage[] {
  if (estimatedTokens <= TOKEN_THRESHOLD) return messages;

  console.log("[context-trimmer] trimming: %d estimated tokens > %d threshold, %d messages", estimatedTokens, TOKEN_THRESHOLD, messages.length);

  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");

  if (conversationMessages.length <= KEEP_RECENT_TURNS * 2) return messages;

  const recentCount = KEEP_RECENT_TURNS * 2; // user + assistant pairs
  const recent = conversationMessages.slice(-recentCount);
  const older = conversationMessages.slice(0, -recentCount);

  const trimmed: ChatMessage[] = [];

  for (let i = 0; i < older.length; i++) {
    const msg = older[i];
    const turnsFromEnd = older.length - i;

    if (msg.role === "assistant" && turnsFromEnd > MAX_TURNS_WITH_ASSISTANT) {
      // Drop old assistant turns entirely
      continue;
    }

    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : "[complex content]";

      // Replace code blocks in old user messages
      const summarized = text.replace(
        /```(\w*)\n[\s\S]*?```/g,
        (_, lang) => `[code block: ${lang || "code"}]`
      );

      // Truncate very long old messages
      const truncated = summarized.length > 500
        ? summarized.slice(0, 500) + "\n[...truncated...]"
        : summarized;

      trimmed.push({ role: "user", content: truncated });
    } else {
      trimmed.push(msg);
    }
  }

  return [...systemMessages, ...trimmed, ...recent];
}
