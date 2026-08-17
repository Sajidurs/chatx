-- Centralizes the tenant-scoped similarity search in one place (same
-- reasoning as the RLS helper functions): every caller -- Phase 2's own
-- verification, Phase 3's chat engine -- gets business_id scoping applied
-- consistently rather than re-deriving the same WHERE clause everywhere.
-- Not SECURITY DEFINER: the underlying RLS policy on knowledge_chunks
-- already scopes SELECT to business members, so this relies on that as a
-- second, independent safety net for any caller other than the service role
-- (which bypasses RLS regardless of this function's security context).
create or replace function public.match_knowledge_chunks(
  p_business_id uuid,
  p_query_embedding vector(1024),
  p_match_count int default 5
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  similarity float
)
language sql
stable
set search_path = public
as $$
  select id, source_id, content, 1 - (embedding <=> p_query_embedding) as similarity
  from knowledge_chunks
  where business_id = p_business_id
  order by embedding <=> p_query_embedding
  limit p_match_count
$$;
