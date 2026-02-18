export type TaskCategory =
  | "simple_qa"
  | "code_gen"
  | "code_review"
  | "debug"
  | "refactor"
  | "explain"
  | "other";

export type ClaudeModel = "claude-sonnet-4-5-20250929" | "claude-haiku-4-5-20251001" | "claude-opus-4-6";
export type ModelAlias = "opus" | "sonnet" | "haiku" | "auto";

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
  model: ClaudeModel;
  alias: string;
  reason: string;
}

export interface ClassificationResult {
  category: TaskCategory;
  complexityScore: number;
}

export interface SuccessEvaluation {
  cliSuccess: boolean;
  heuristicScore: number;
}

export interface TaskLogInsert {
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
