/**
 * Runtime-configurable pinned model setting.
 *
 * When set, the Claude CLI persistent provider uses a single long-lived
 * PinnedProcess for this model, reused across all requests.
 * Simpler than the warm pool — no context tracking, single model only.
 *
 * Initialized from CLAUDE_CLI_MODEL env var (if set), toggleable via settings API.
 * Setting to null disables pinned mode.
 */

let pinnedModel: string | null = process.env.CLAUDE_CLI_MODEL ?? null;

export function getPinnedModel(): string | null {
  return pinnedModel;
}

export function setPinnedModel(model: string | null): void {
  pinnedModel = model;
}
