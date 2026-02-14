/**
 * Stage 3 — Symbol Table
 * Detect phrases repeated 3+ times (min 20 chars), extract to symbols.
 */

interface PhraseOccurrence {
  phrase: string;
  count: number;
}

function findRepeatedPhrases(text: string, minLength: number = 20, minOccurrences: number = 3): PhraseOccurrence[] {
  const phrases = new Map<string, number>();

  // Extract sentences and significant phrases
  const segments = text.split(/[.!?\n]/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.length >= minLength) {
      const count = phrases.get(trimmed) ?? 0;
      phrases.set(trimmed, count + 1);
    }
  }

  // Also look for repeated substrings within long segments
  const words = text.split(/\s+/);
  for (let windowSize = 5; windowSize <= 15; windowSize++) {
    for (let i = 0; i <= words.length - windowSize; i++) {
      const phrase = words.slice(i, i + windowSize).join(" ");
      if (phrase.length >= minLength) {
        const count = phrases.get(phrase) ?? 0;
        phrases.set(phrase, count + 1);
      }
    }
  }

  return Array.from(phrases.entries())
    .filter(([, count]) => count >= minOccurrences)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.phrase.length * b.count - a.phrase.length * a.count)
    .slice(0, 10); // Cap at 10 symbols
}

export function buildSymbolTable(text: string): string {
  const repeated = findRepeatedPhrases(text);
  if (repeated.length === 0) return text;

  let result = text;
  const definitions: string[] = [];

  for (let i = 0; i < repeated.length; i++) {
    const symbol = `§${i + 1}`;
    const { phrase } = repeated[i];

    // Replace occurrences after the first
    let firstFound = false;
    result = result.split(phrase).map((part, idx, arr) => {
      if (idx === arr.length - 1) return part;
      if (!firstFound) {
        firstFound = true;
        return part + phrase;
      }
      return part + symbol;
    }).join("");

    if (firstFound) {
      definitions.push(`${symbol} = "${phrase}"`);
    }
  }

  if (definitions.length > 0) {
    result = `[Symbol definitions]\n${definitions.join("\n")}\n[/Symbol definitions]\n\n${result}`;
  }

  return result;
}
