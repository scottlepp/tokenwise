import type { TaskCategory, ChatMessage, ClassificationResult, ContentPart } from "./types";
import { spawnClaudeNonStreaming } from "./claude-cli";

/** Runtime-configurable LLM classifier flag. Initialized from env var, toggleable via settings API. */
let llmClassifierEnabled = process.env.LLM_CLASSIFIER === "true";

export function isLlmClassifierEnabled(): boolean {
  return llmClassifierEnabled;
}

export function setLlmClassifierEnabled(enabled: boolean): void {
  llmClassifierEnabled = enabled;
}

function extractText(content: string | ContentPart[] | null): string {
  if (content === null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

const CATEGORY_PATTERNS: { category: TaskCategory; patterns: RegExp[] }[] = [
  {
    category: "code_gen",
    patterns: [
      /\b(write|create|implement|build|generate|make|add)\b.*\b(function|class|component|module|api|endpoint|code|script|program)\b/i,
      /\b(implement|code|program)\b/i,
    ],
  },
  {
    category: "code_review",
    patterns: [
      /\b(review|check|audit|inspect|look at)\b.*\b(code|implementation|PR|pull request)\b/i,
      /\bcode review\b/i,
    ],
  },
  {
    category: "debug",
    patterns: [
      /\b(debug|fix|error|bug|issue|problem|broken|crash|fail|exception)\b/i,
      /\bstack trace\b/i,
      /\btraceback\b/i,
    ],
  },
  {
    category: "refactor",
    patterns: [
      /\b(refactor|restructure|clean up|reorganize|simplify|optimize|improve)\b.*\b(code|function|class|module)\b/i,
      /\brefactor\b/i,
    ],
  },
  {
    category: "explain",
    patterns: [
      /\b(explain|what does|how does|why does|what is|describe|walk through|tell me about)\b/i,
    ],
  },
  {
    category: "simple_qa",
    patterns: [
      /^.{0,100}\?$/m, // Short question
    ],
  },
];

const COMPLEX_KEYWORDS = /\b(architect|design|system|distributed|concurrent|async|optimize|performance|security|scale|migrate)\b/i;
const SIMPLE_KEYWORDS = /\b(what is|explain|hello|hi|thanks|help|list|show)\b/i;
const CODE_BLOCK_REGEX = /```[\s\S]*?```/g;

function detectCategory(text: string): TaskCategory {
  const lower = text.toLowerCase();

  for (const { category, patterns } of CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) return category;
    }
  }

  // Simple QA: short prompt with no code
  const hasCode = CODE_BLOCK_REGEX.test(text);
  if (!hasCode && text.length < 200) return "simple_qa";

  return "other";
}

function calculateComplexity(
  text: string,
  messages: ChatMessage[],
  systemPrompt: string | null
): number {
  let score = 10; // base

  // Only count user message text length, not injected context/tool definitions
  // Agentic tools inflate prompts with file contents + tool schemas
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserText = userMessages.length > 0
    ? extractText(userMessages[userMessages.length - 1].content)
    : text;
  const userTokenEstimate = lastUserText.length / 4;
  score += Math.min(userTokenEstimate / 200, 15); // halved weight, capped at 15

  // Code blocks in user message only (not injected context)
  const codeBlocks = lastUserText.match(CODE_BLOCK_REGEX) ?? [];
  score += Math.min(codeBlocks.length * 3, 15); // capped

  // Complex keywords — these genuinely signal harder tasks
  const complexMatches = text.match(COMPLEX_KEYWORDS);
  if (complexMatches) score += complexMatches.length * 8;

  // Simple keywords
  const simpleMatches = text.match(SIMPLE_KEYWORDS);
  if (simpleMatches) score -= simpleMatches.length * 5;

  // Conversation turns — mild signal, long conversations don't necessarily need opus
  const turns = messages.filter((m) => m.role === "user").length;
  score += Math.min(turns * 2, 10); // capped at 10

  // System prompt — don't penalize agentic tools that always have long system prompts
  // Only count if it's NOT tool-definition heavy
  if (systemPrompt && systemPrompt.length > 200) {
    const hasToolDefs = /# Available Tools|<tool_call>|function\.name/i.test(systemPrompt);
    if (!hasToolDefs) score += 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

const VALID_CATEGORIES = new Set<TaskCategory>([
  "simple_qa", "code_gen", "code_review", "debug", "refactor", "explain", "other",
]);

const CLASSIFICATION_PROMPT = `Classify this coding task. Return ONLY a JSON object, no other text.

Categories: simple_qa, code_gen, code_review, debug, refactor, explain, other
Complexity: 0-100 (0=trivial, 30=simple file edit, 50=moderate feature, 70=complex multi-file, 90=architectural)

Guidelines for complexity:
- 0-20: trivial questions, greetings, simple lookups
- 21-45: single file edits, simple bug fixes, writing one function
- 46-65: multi-file changes, moderate features, debugging with investigation
- 66-80: complex features, refactoring across modules, system design
- 81-100: architectural changes, distributed systems, security audits

Respond with: {"category":"<category>","complexity":<number>}`;

async function classifyWithLLM(userText: string, messageCount: number, hasTools: boolean): Promise<ClassificationResult | null> {
  // Build a compact summary — don't send the whole conversation
  const truncatedText = userText.slice(0, 2000);
  const contextNote = messageCount > 2 ? ` (conversation with ${messageCount} messages)` : "";
  const toolNote = hasTools ? " (agentic tool-use context)" : "";
  const prompt = `${truncatedText}${contextNote}${toolNote}`;

  const llmStart = Date.now();
  try {
    const result = await spawnClaudeNonStreaming({
      model: "claude-haiku-4-5-20251001",
      prompt,
      systemPrompt: CLASSIFICATION_PROMPT,
      streaming: false,
    });
    const latencyMs = Date.now() - llmStart;

    if (result.isError || !result.text) return null;

    // Parse JSON from response — haiku might wrap it in markdown
    const jsonMatch = result.text.match(/\{[^}]+\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const category = VALID_CATEGORIES.has(parsed.category) ? parsed.category as TaskCategory : "other";
    const complexity = Math.max(0, Math.min(100, Math.round(Number(parsed.complexity) || 50)));

    console.log("[classifier] LLM (haiku): category=%s complexity=%d | cost=$%s | latency=%dms | input=%d chars",
      category, complexity, result.costUsd.toFixed(4), latencyMs, prompt.length);

    return {
      category,
      complexityScore: complexity,
      llm: {
        model: "claude-haiku-4-5-20251001",
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        latencyMs,
      },
    };
  } catch (err) {
    console.warn("[classifier] LLM classification failed, falling back to heuristic:", (err as Error).message);
    return null;
  }
}

/** Synchronous heuristic classifier — always available, zero latency */
export function classifyTaskHeuristic(messages: ChatMessage[]): ClassificationResult {
  const systemMessages = messages.filter((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserMessage = userMessages[userMessages.length - 1];

  const textToAnalyze = lastUserMessage ? extractText(lastUserMessage.content) : "";
  const systemPrompt = systemMessages.map((m) => extractText(m.content)).join("\n") || null;
  const fullText = [systemPrompt ?? "", textToAnalyze].join("\n");

  const category = detectCategory(textToAnalyze);
  const complexityScore = calculateComplexity(fullText, messages, systemPrompt);

  console.log("[classifier] heuristic: category=%s complexity=%d | user_msg=%d chars | turns=%d | messages=%d",
    category, complexityScore, textToAnalyze.length, userMessages.length, messages.length);

  return { category, complexityScore };
}

/** Main classifier — uses LLM (haiku) if enabled, falls back to heuristic */
export async function classifyTask(messages: ChatMessage[]): Promise<ClassificationResult> {
  if (llmClassifierEnabled) {
    const userMessages = messages.filter((m) => m.role === "user");
    const lastUserText = userMessages.length > 0
      ? extractText(userMessages[userMessages.length - 1].content)
      : "";
    const hasTools = messages.some((m) => m.role === "tool" || (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0));

    const llmResult = await classifyWithLLM(lastUserText, messages.length, hasTools);
    if (llmResult) return llmResult;
  }

  return classifyTaskHeuristic(messages);
}
