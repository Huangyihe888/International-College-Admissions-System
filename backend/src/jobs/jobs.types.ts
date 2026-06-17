export interface ProcessorOptions {
  concurrency?: number;
}

export interface DocumentIngestJobData {
  documentId: string;
}

export interface EmbeddingBatchJobData {
  documentId: string;
  chunkIds: string[];
}
