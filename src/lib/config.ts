import type { ClaudeModel } from "./types";
import type { ModelTier } from "./providers/base";

// Model name reported to clients in all responses (streaming + non-streaming).
// Keeps agentic clients like Cline happy — they check for "capable" model names.
export const RESPONSE_MODEL = "claude-sonnet-4-5-20250929";

// ── Legacy Claude-only mappings (kept for backward compatibility) ──

export const MODEL_MAP: Record<string, ClaudeModel> = {
  // OpenAI model names → Claude
  "gpt-4": "claude-opus-4-6",
  "gpt-4o": "claude-opus-4-6",
  "gpt-4o-mini": "claude-sonnet-4-5-20250929",
  "gpt-3.5-turbo": "claude-haiku-4-5-20251001",
  "gpt-4-turbo": "claude-opus-4-6",
  // Claude aliases
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  // Full Claude model names
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
};

// Explicit user model names that bypass the smart router (Claude-specific aliases)
export const EXPLICIT_CLAUDE_MODELS = new Set([
  "opus",
  "sonnet",
  "haiku",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
]);

export const DEFAULT_MODEL: ClaudeModel = "claude-sonnet-4-6";

// Cost per 1M tokens (USD) — legacy, used as fallback
export const MODEL_COSTS: Record<ClaudeModel, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

export function calculateCost(model: ClaudeModel, tokensIn: number, tokensOut: number): number {
  const costs = MODEL_COSTS[model];
  if (!costs) return 0;
  return (tokensIn * costs.input + tokensOut * costs.output) / 1_000_000;
}

export function modelAlias(model: string): string {
  if (model === "claude-opus-4-6") return "opus";
  if (model === "claude-sonnet-4-6") return "sonnet";
  if (model === "claude-sonnet-4-5-20250929") return "sonnet-4.5";
  if (model === "claude-haiku-4-5-20251001") return "haiku";
  return model;
}

// ── Static models list for /v1/models (augmented dynamically by provider registry) ──

export const STATIC_MODELS = [
  { id: "auto", name: "Auto (Smart Router)" },
  { id: "economy", name: "Economy Tier (cheapest)" },
  { id: "standard", name: "Standard Tier" },
  { id: "premium", name: "Premium Tier" },
  { id: "opus", name: "Claude Opus 4.6" },
  { id: "sonnet", name: "Claude Sonnet 4.6" },
  { id: "haiku", name: "Claude Haiku 4.5" },
];

// Keep backward-compatible export — will be dynamically augmented in models route
export const AVAILABLE_MODELS = STATIC_MODELS;

// ── Tier names recognized as routing hints ──

export const TIER_NAMES = new Set<string>(["economy", "standard", "premium"]);

// ── Complexity score → tier mapping ──

export const COMPLEXITY_TIER_MAP: Record<string, { max: number; tier: ModelTier }> = {
  low: { max: 25, tier: "economy" },
  medium: { max: 60, tier: "standard" },
  high: { max: 100, tier: "premium" },
};

// Legacy — still used by budget downgrade logic
export const COMPLEXITY_TIERS = {
  low: { max: 20, model: "claude-haiku-4-5-20251001" as ClaudeModel },
  medium: { max: 75, model: "claude-sonnet-4-6" as ClaudeModel },
  high: { max: 100, model: "claude-opus-4-6" as ClaudeModel },
};

export const SUCCESS_THRESHOLD = parseFloat(process.env.SUCCESS_THRESHOLD ?? "0.8");
export const CONSECUTIVE_FAILURE_LIMIT = parseInt(process.env.CONSECUTIVE_FAILURE_LIMIT ?? "3", 10);
export const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER ?? "claude-cli";

// ── Legacy model name → tier mapping (for names like gpt-4, gpt-3.5-turbo) ──

export const LEGACY_MODEL_TIER_MAP: Record<string, ModelTier> = {
  "gpt-4": "premium",
  "gpt-4o": "standard",
  "gpt-4-turbo": "premium",
  "gpt-4o-mini": "economy",
  "gpt-3.5-turbo": "economy",
  o1: "premium",
  "o3-mini": "economy",
};
