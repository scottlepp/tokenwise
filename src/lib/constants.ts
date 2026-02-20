export const PROVIDER_COLORS: Record<string, string> = {
  "claude-cli": "#8b5cf6",
  "claude-api": "#a78bfa",
  openai: "#10b981",
  gemini: "#3b82f6",
  ollama: "#f59e0b",
};

export const FALLBACK_COLORS = [
  "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899",
];

const PROVIDER_LABELS: Record<string, string> = {
  "claude-cli": "Claude CLI",
  "claude-api": "Claude API",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama",
};

const PROVIDER_SHORT_LABELS: Record<string, string> = {
  "claude-cli": "CLI",
  "claude-api": "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

export function providerShortLabel(id: string): string {
  return PROVIDER_SHORT_LABELS[id] ?? id;
}

export function shortModelLabel(model: string): string {
  // Handle bare aliases (may be stored in DB from older requests or returned as aliases)
  if (model === "opus") return "Opus 4.6";
  if (model === "sonnet") return "Sonnet 4.6";
  if (model === "sonnet-4.5") return "Sonnet 4.5";
  if (model === "haiku") return "Haiku 4.5";

  if (model.includes("opus")) {
    if (model.includes("4-6")) return "Opus 4.6";
    if (model.includes("4-5")) return "Opus 4.5";
    return "Opus";
  }
  if (model.includes("sonnet")) {
    if (model.includes("4-6")) return "Sonnet 4.6";
    if (model.includes("4-5")) return "Sonnet 4.5";
    return "Sonnet";
  }
  if (model.includes("haiku")) {
    if (model.includes("4-5")) return "Haiku 4.5";
    return "Haiku";
  }
  if (model.startsWith("gpt-4o-mini")) return "4o-mini";
  if (model.startsWith("gpt-4o")) return "GPT-4o";
  if (model.startsWith("gpt-4-turbo")) return "GPT-4 Turbo";
  if (model.includes("gemini-2.0-flash")) return "Flash 2.0";
  if (model.includes("gemini-2.0-pro")) return "Pro 2.0";
  if (model.includes("gemini-1.5-pro")) return "Gem 1.5 Pro";
  if (model.includes("gemini-1.5-flash")) return "Gem 1.5 Flash";
  return model.length > 20 ? model.slice(0, 20) + "..." : model;
}
