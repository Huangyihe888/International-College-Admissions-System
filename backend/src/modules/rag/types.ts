/**
 * RAG 模块对外暴露的稳定类型契约。
 * 任何 ChatModule / 前端 SSE 解析都依赖这些字段,变更需同步文档。
 */

export interface RagHistoryTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface RagSourceItem {
  type: "chunk" | "faq";
  id: string;
  filename?: string;
  content?: string;
  score?: number;
}

export type RagChunk =
  | { type: "token"; content: string }
  | { type: "sources"; items: RagSourceItem[] }
  | {
      type: "done";
      confidence?: number | null;
      faqHit?: boolean;
      cached?: boolean;
      fallback?: boolean;
      isAnswered?: boolean;
      rejectReason?: string | null;
      ragLogId?: string | null;
    }
  | { type: "reject"; reason: "no_relevant_context" | "forbidden" }
  | { type: "error"; code: number; message: string; ragLogId?: string | null };

export interface RagAnswer {
  answer: string;
  sources: RagSourceItem[];
  confidence: number;
  faqHit: boolean;
  cached: boolean;
}

export interface RagStreamRequest {
  question: string;
  visitorId?: string;
  sessionId?: string;
  history?: RagHistoryTurn[];
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  index: number;
  filename: string;
  score: number;
}

export interface FaqHit {
  faqId: string;
  question: string;
  answer: string;
  score: number;
}

export interface PromptBuildInput {
  question: string;
  history?: RagHistoryTurn[];
  retrievedChunks?: RetrievedChunk[];
  faqAnswer?: string;
  forbiddenSummary?: string;
}

export interface PromptBuildOutput {
  system: string;
  user: string;
}

export interface ForbiddenCheckResult {
  hit: boolean;
  ruleId?: string;
  ruleName?: string;
  reason?: string;
  reply?: string;
}

export interface CachedAnswer {
  answer: string;
  sources: RagSourceItem[];
  confidence: number;
  faqHit: boolean;
  storedAt: number;
}
