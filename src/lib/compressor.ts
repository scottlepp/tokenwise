import type { ChatMessage, ContentPart } from "./types";
import { normalize } from "./compressor/normalizer";
import { deduplicate } from "./compressor/deduplicator";
import { buildSymbolTable } from "./compressor/symbol-table";
import { compressCode } from "./compressor/code-compressor";
import { trimContext } from "./compressor/context-trimmer";

export interface CompressionResult {
  messages: ChatMessage[];
  tokensBefore: number;
  tokensAfter: number;
}

function extractText(content: string | ContentPart[] | null): string {
  if (content === null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    chars += extractText(msg.content).length;
  }
  return Math.ceil(chars / 4);
}

function compressText(text: string): string {
  let result = text;

  // Stage 1: Normalize
  try {
    result = normalize(result);
  } catch {
    // Fail open
  }

  // Stage 2: Deduplicate blocks
  try {
    result = deduplicate(result);
  } catch {
    // Fail open
  }

  // Stage 3: Symbol table
  try {
    result = buildSymbolTable(result);
  } catch {
    // Fail open
  }

  // Stage 4: Code compressor
  try {
    result = compressCode(result);
  } catch {
    // Fail open
  }

  return result;
}

export function compress(messages: ChatMessage[]): CompressionResult {
  const tokensBefore = estimateTokens(messages);
  const msgsBefore = messages.length;

  // Stage 5: Context trimmer (operates on messages array)
  let compressed: ChatMessage[];
  try {
    compressed = trimContext(messages, tokensBefore);
  } catch {
    compressed = messages;
  }

  if (compressed.length !== msgsBefore) {
    console.log("[compressor] context trimmed: %d→%d messages", msgsBefore, compressed.length);
  }

  // Apply text compression to each message
  compressed = compressed.map((msg) => {
    if (typeof msg.content === "string") {
      return { ...msg, content: compressText(msg.content) };
    }
    // For content arrays, compress text parts
    const parts = (msg.content as ContentPart[]).map((p) => {
      if (p.type === "text") {
        return { ...p, text: compressText(p.text) };
      }
      return p;
    });
    return { ...msg, content: parts };
  });

  const tokensAfter = estimateTokens(compressed);

  return { messages: compressed, tokensBefore, tokensAfter };
}
