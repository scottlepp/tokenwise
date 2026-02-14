import { createHash } from "crypto";

/**
 * Stage 2 — Structural Deduplicator
 * Hash semantic blocks; replace duplicates with [ref:block:<hash>].
 */

function hashBlock(kind: string, content: string): string {
  return createHash("sha256").update(`${kind}:${content}`).digest("hex").slice(0, 12);
}

interface Block {
  kind: string;
  content: string;
  start: number;
  end: number;
}

function extractBlocks(text: string): Block[] {
  const blocks: Block[] = [];

  // Match code blocks
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push({
      kind: "code",
      content: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Match XML-like tags (Cursor's <context>, <file>, etc.)
  const tagRegex = /<(\w+)>[\s\S]*?<\/\1>/g;
  while ((match = tagRegex.exec(text)) !== null) {
    // Skip if inside a code block
    const inCodeBlock = blocks.some(
      (b) => b.kind === "code" && match!.index >= b.start && match!.index < b.end
    );
    if (!inCodeBlock) {
      blocks.push({
        kind: "tag",
        content: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return blocks.sort((a, b) => a.start - b.start);
}

export function deduplicate(text: string): string {
  const blocks = extractBlocks(text);
  if (blocks.length === 0) return text;

  const seen = new Map<string, string>(); // hash → first occurrence
  const replacements: { start: number; end: number; replacement: string }[] = [];
  const expansions: string[] = [];

  for (const block of blocks) {
    const hash = hashBlock(block.kind, block.content);
    if (seen.has(hash)) {
      replacements.push({
        start: block.start,
        end: block.end,
        replacement: `[ref:block:${hash}]`,
      });
    } else {
      seen.set(hash, block.content);
    }
  }

  if (replacements.length === 0) return text;

  // Build expansion table
  for (const [hash] of seen) {
    // Only add to expansion table if it was actually referenced
    if (replacements.some((r) => r.replacement.includes(hash))) {
      expansions.push(`[block:${hash}] = (see first occurrence above)`);
    }
  }

  // Apply replacements in reverse order to preserve indices
  let result = text;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
  }

  if (expansions.length > 0) {
    result = `[Block references: ${replacements.length} duplicate blocks replaced]\n` + result;
  }

  return result;
}
