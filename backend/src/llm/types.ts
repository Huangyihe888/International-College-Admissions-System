export type LlmProvider = "qwen" | "deepseek" | "vllm" | "openai";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ChatChunk {
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ChatResponse {
  content: string;
  finishReason?: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: LlmProvider;
}

export interface EmbeddingItem {
  index: number;
  embedding: number[];
}

export interface EmbeddingResponse {
  items: EmbeddingItem[];
  model: string;
  dim: number;
  usage: { promptTokens: number; totalTokens: number };
}

export interface RerankItem {
  index: number;
  score: number;
  document?: string;
}

export interface RerankResponse {
  results: RerankItem[];
  model: string;
}

export interface LlmProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface EmbeddingProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dim: number;
  batchSize: number;
  timeoutMs: number;
}

export interface RerankProviderConfig {
  provider: "bge" | "cohere" | "none";
  apiKey?: string;
  baseUrl?: string;
  model: string;
}
