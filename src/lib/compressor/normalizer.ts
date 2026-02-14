/**
 * Stage 1 — Normalizer
 * Lossless: collapse whitespace, normalize bullets, strip trailing whitespace.
 * Never changes wording, reorders, or removes content.
 */
export function normalize(text: string): string {
  let result = text;

  // Collapse multiple blank lines to one
  result = result.replace(/\n{3,}/g, "\n\n");

  // Normalize bullet styles (* and • → -)
  result = result.replace(/^[ \t]*[*•][ \t]/gm, "- ");

  // Strip trailing whitespace per line
  result = result.replace(/[ \t]+$/gm, "");

  return result;
}
