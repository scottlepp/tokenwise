import type { TaskCategory, SuccessEvaluation } from "./types";

const REFUSAL_PHRASES = [
  "i can't",
  "i'm unable",
  "i don't have",
  "i cannot",
  "i'm not able",
  "as an ai",
  "i apologize, but i",
];

export function evaluate(
  responseText: string,
  cliExitSuccess: boolean,
  taskCategory: TaskCategory,
  complexityScore: number
): SuccessEvaluation {
  // Layer 1: CLI exit code
  if (!cliExitSuccess) {
    return { cliSuccess: false, heuristicScore: 0 };
  }

  // Layer 2: Heuristic scoring
  let score = 70; // neutral baseline

  // Empty response
  if (!responseText || responseText.trim().length === 0) {
    score -= 30;
  }

  // Too-short response for non-trivial prompt
  if (responseText.trim().length < 20 && complexityScore > 20) {
    score -= 20;
  }

  // Contains code block for code-related tasks
  const isCodeTask = ["code_gen", "code_review", "debug", "refactor"].includes(taskCategory);
  const hasCodeBlock = /```[\s\S]*?```/.test(responseText);
  if (isCodeTask && hasCodeBlock) {
    score += 15;
  }

  // Response length proportional to complexity
  const responseLength = responseText.trim().length;
  if (responseLength > complexityScore * 5) {
    score += 10;
  }

  // Refusal phrases
  const lower = responseText.toLowerCase();
  for (const phrase of REFUSAL_PHRASES) {
    if (lower.includes(phrase)) {
      score -= 15;
      break;
    }
  }

  return {
    cliSuccess: true,
    heuristicScore: Math.max(0, Math.min(100, score)),
  };
}

// Combined success check for routing decisions
export function isSuccess(cliSuccess: boolean, heuristicScore: number | null, userRating: number | null): boolean {
  if (!cliSuccess) return false;
  if (heuristicScore !== null && heuristicScore < 40) return false;
  if (userRating !== null && userRating <= 2) return false;
  return true;
}
