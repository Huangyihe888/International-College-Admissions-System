-- HNSW indexes for fast approximate nearest neighbor search
-- Run once after initial data load; safe to re-run (IF NOT EXISTS)

-- DocumentChunk vector index
CREATE INDEX IF NOT EXISTS idx_document_chunk_embedding_hnsw
ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- FaqItem vector index
CREATE INDEX IF NOT EXISTS idx_faq_item_embedding_hnsw
ON "FaqItem" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Also add a regular index on document status for faster filtering
CREATE INDEX IF NOT EXISTS idx_document_status
ON "Document" (status, "kbVersionId");
