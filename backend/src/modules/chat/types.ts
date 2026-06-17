/**
 * ChatModule 内部类型。
 *
 * RagService 由另一个并行 subagent 实现(Task 8),这里只声明本模块期望的最小契约,
 * 通过 ModuleRef 在运行时尝试解析;解析不到时降级到"暂未接入 RAG"占位回复。
 *
 * RagChunk 形状是流式问答的最小公分母:
 * - text token 走 content 字段(逐 chunk 累加)
 * - sources / confidence / faqHit / isAnswered / rejectReason / ragLogId 在最后一个 chunk 一起回传
 */
export interface RagSource {
  docId: string;
  chunkId: string;
  score: number;
  snippet: string;
}

export interface RagChunk {
  content?: string;
  sources?: RagSource[];
  confidence?: number;
  faqHit?: boolean;
  isAnswered?: boolean;
  rejectReason?: string;
  ragLogId?: string;
  finishReason?: string;
  /** 流开始时由 ChatService 下发的元信息,供前端把 local- 占位 ID 替换成真实 DB id */
  meta?: { messageId: string; userMessageId: string };
}

export interface RagAnswerInput {
  question: string;
  visitorId: string;
  sessionId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface RagServiceLike {
  answerStream(input: RagAnswerInput): AsyncIterable<RagChunk>;
}
