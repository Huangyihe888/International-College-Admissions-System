-- =========================================================
-- PostgreSQL initialization for Wyu RAG
-- Mounted at /docker-entrypoint-initdb.d/ to be executed
-- automatically on first-time container startup.
-- =========================================================

-- Vector similarity search (RAG core)
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigram index for fuzzy / keyword fallback search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- UUID generation helpers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
