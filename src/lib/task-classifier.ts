import type { TaskCategory, ChatMessage, ClassificationResult, ContentPart } from "./types";

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

export function classifyTask(messages: ChatMessage[]): ClassificationResult {
  // Get the text to analyze — focus on last user message + system context
  const systemMessages = messages.filter((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserMessage = userMessages[userMessages.length - 1];

  const textToAnalyze = lastUserMessage ? extractText(lastUserMessage.content) : "";
  const systemPrompt = systemMessages.map((m) => extractText(m.content)).join("\n") || null;
  const fullText = [systemPrompt ?? "", textToAnalyze].join("\n");

  const category = detectCategory(textToAnalyze);
  const complexityScore = calculateComplexity(fullText, messages, systemPrompt);

  console.log("[classifier] category=%s complexity=%d | user_msg=%d chars | turns=%d | messages=%d",
    category, complexityScore, textToAnalyze.length, userMessages.length, messages.length);

  return { category, complexityScore };
}
