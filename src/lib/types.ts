export type TaskCategory =
  | "simple_qa"
  | "code_gen"
  | "code_review"
  | "debug"
  | "refactor"
  | "explain"
  | "other";

export type ClaudeModel = "claude-sonnet-4-5-20250929" | "claude-sonnet-4-6" | "claude-haiku-4-5-20251001" | "claude-opus-4-6";
export type ModelAlias = "opus" | "sonnet" | "haiku" | "auto";

export type ProviderId =
  | "claude-cli"
  | "claude-api"
  | "openai"
  | "gemini"
  | "ollama"
  | string;

export interface ContentPartText {
  type: "text";
  text: string;
}

export interface ContentPartImage {
  type: "image_url";
  image_url: { url: string };
}

export type ContentPart = ContentPartText | ContentPartImage;

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  max_tokens?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: string | { type: string; function?: { name: string } };
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: "stop" | "length" | "tool_calls" | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunkDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: "stop" | "length" | "tool_calls" | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

export interface RouterDecision {
  provider: ProviderId;
  model: string;
  alias: string;
  reason: string;
  category: TaskCategory;
  complexityScore: number;
}

export interface ClassificationResult {
  category: TaskCategory;
  complexityScore: number;
  /** Present when LLM classifier was used */
  llm?: {
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
  };
}

export interface SuccessEvaluation {
  cliSuccess: boolean;
  heuristicScore: number;
}

export interface TaskLogInsert {
  requestId?: string;
  provider: string;
  taskCategory: TaskCategory;
  complexityScore: number;
  promptSummary: string;
  messageCount: number;
  modelRequested: string | null;
  modelSelected: string;
  routerReason: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  latencyMs: number;
  streaming: boolean;
  cliSuccess: boolean;
  heuristicScore: number;
  errorMessage?: string;
  tokensBeforeCompression?: number;
  tokensAfterCompression?: number;
  cacheHit?: boolean;
  budgetRemainingUsd?: string;
}

export interface RequestLogInsert {
  userAgent?: string;
  clientIp?: string;
  modelRequested?: string;
  messageCount: number;
  toolCount: number;
  streaming: boolean;
  promptPreview?: string;
}

export type PipelineStep =
  | "parse"
  | "feedback"
  | "dedup"
  | "classify"
  | "route"
  | "budget_check"
  | "cache_check"
  | "compress"
  | "cli_spawn"
  | "cli_streaming"
  | "cli_done"
  | "provider_dispatch"
  | "provider_streaming"
  | "provider_done"
  | "tool_parse"
  | "response_sent"
  | "log_task";

export interface StatusLogInsert {
  requestId: string;
  step: PipelineStep;
  status: "started" | "completed" | "error" | "skipped";
  durationMs?: number;
  detail?: string;
}
