import { createHash } from "crypto";

/**
 * Stage 4 — Code Compressor
 * Collapse blank lines in code blocks, strip trailing whitespace.
 * Deduplicate identical code blocks across messages.
 */

export function compressCode(text: string): string {
  const codeBlockRegex = /(```\w*\n)([\s\S]*?)(```)/g;
  const seen = new Map<string, number>();
  let blockIndex = 0;

  return text.replace(codeBlockRegex, (match, open: string, content: string, close: string) => {
    blockIndex++;

    // Collapse multiple blank lines within code to single blank line
    let compressed = content.replace(/\n{3,}/g, "\n\n");

    // Strip trailing whitespace in code lines
    compressed = compressed.replace(/[ \t]+$/gm, "");

    // Check for duplicates
    const hash = createHash("sha256").update(compressed).digest("hex").slice(0, 12);
    const prevIndex = seen.get(hash);

    if (prevIndex !== undefined) {
      return `[identical to code block #${prevIndex} above]`;
    }

    seen.set(hash, blockIndex);
    return `${open}${compressed}${close}`;
  });
}
