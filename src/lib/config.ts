import type { ClaudeModel } from "./types";

export const MODEL_MAP: Record<string, ClaudeModel> = {
  // OpenAI model names → Claude
  "gpt-4": "claude-opus-4-6",
  "gpt-4o": "claude-opus-4-6",
  "gpt-4o-mini": "claude-sonnet-4-5-20250929",
  "gpt-3.5-turbo": "claude-haiku-4-5-20251001",
  "gpt-4-turbo": "claude-opus-4-6",
  // Claude aliases
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-5-20250929",
  haiku: "claude-haiku-4-5-20251001",
  // Full Claude model names
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
};

// Explicit user model names that bypass the smart router
export const EXPLICIT_CLAUDE_MODELS = new Set([
  "opus",
  "sonnet",
  "haiku",
  "claude-opus-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
]);

export const DEFAULT_MODEL: ClaudeModel = "claude-sonnet-4-5-20250929";

// Cost per 1M tokens (USD)
export const MODEL_COSTS: Record<ClaudeModel, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

export function calculateCost(model: ClaudeModel, tokensIn: number, tokensOut: number): number {
  const costs = MODEL_COSTS[model];
  return (tokensIn * costs.input + tokensOut * costs.output) / 1_000_000;
}

export function modelAlias(model: ClaudeModel): string {
  if (model === "claude-opus-4-6") return "opus";
  if (model === "claude-sonnet-4-5-20250929") return "sonnet";
  if (model === "claude-haiku-4-5-20251001") return "haiku";
  return model;
}

// Models list for /v1/models endpoint
export const AVAILABLE_MODELS = [
  { id: "auto", name: "Auto (Smart Router)" },
  { id: "opus", name: "Claude Opus 4.6" },
  { id: "sonnet", name: "Claude Sonnet 4.5" },
  { id: "haiku", name: "Claude Haiku 4.5" },
  { id: "gpt-4", name: "GPT-4 → Claude Opus" },
  { id: "gpt-4o", name: "GPT-4o → Claude Opus" },
  { id: "gpt-4o-mini", name: "GPT-4o-mini → Claude Sonnet" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5-turbo → Claude Haiku" },
];

// Complexity score tiers for fallback routing
// Sonnet handles most agentic coding tasks well — opus only for genuinely complex work
export const COMPLEXITY_TIERS = {
  low: { max: 20, model: "claude-haiku-4-5-20251001" as ClaudeModel },
  medium: { max: 75, model: "claude-sonnet-4-5-20250929" as ClaudeModel },
  high: { max: 100, model: "claude-opus-4-6" as ClaudeModel },
};

export const SUCCESS_THRESHOLD = 0.8; // 80% success rate required
export const CONSECUTIVE_FAILURE_LIMIT = 3;
