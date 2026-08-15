-- Embeddings provider changed from OpenAI (text-embedding-3-small, 1536-dim)
-- to Voyage AI (voyage-4-lite, 1024-dim default). See CHANGELOG.md decision
-- log. knowledge_chunks is still empty (Phase 2 hasn't started), so this is
-- a safe type change with no data to migrate -- the index is dropped and
-- recreated explicitly rather than relying on ALTER COLUMN TYPE to rebuild
-- it implicitly.
drop index if exists idx_knowledge_chunks_embedding;
alter table knowledge_chunks alter column embedding type vector(1024);
create index idx_knowledge_chunks_embedding on knowledge_chunks
  using hnsw (embedding vector_cosine_ops);
