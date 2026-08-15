-- Initial schema for the multi-tenant chatbot SaaS.
-- Source of truth: system_design.md section 2 (Data model).

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists vector;     -- pgvector, for knowledge_chunks.embedding

-- Embedding dimension: 1536, matching OpenAI text-embedding-3-small.
-- Anthropic's Claude API has no native embeddings endpoint, so Phase 2 will need a
-- separate embedding provider. 1536 is a placeholder chosen for schema purposes only;
-- no cost has been committed and no vendor decision has been made yet. This must be
-- confirmed with the founder before Phase 2 starts calling a real embeddings API,
-- since it is a paid third-party service and system_design.md's tech stack table
-- does not name one.

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro')),
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  assistant_name text,
  assistant_photo_url text,
  assistant_bio text,
  system_prompt text,
  google_refresh_token text,  -- encrypted at the application layer before storage
  google_calendar_id text,
  created_at timestamptz not null default now()
);

create table business_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  email text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (business_id, auth_user_id)
);

create table knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  type text not null check (type in ('pdf', 'doc', 'text')),
  file_url text not null,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  source_id uuid not null references knowledge_sources (id) on delete cascade,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  visitor_id text not null,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions (id) on delete cascade,
  role text not null check (role in ('visitor', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  session_id uuid references chat_sessions (id) on delete set null,
  google_event_id text,
  customer_name text not null,
  customer_contact text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'rescheduled')),
  created_at timestamptz not null default now()
);

create table usage_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  month text not null,  -- 'YYYY-MM'
  message_count integer not null default 0,
  unique (business_id, month)
);

-- Global reference table, not tenant-scoped.
create table plan_limits (
  plan text primary key check (plan in ('free', 'starter', 'pro')),
  monthly_messages integer,  -- null = unlimited
  booking_enabled boolean not null default false
);

insert into plan_limits (plan, monthly_messages, booking_enabled) values
  ('free', 20, false),
  ('starter', 1000, false),
  ('pro', null, true);

-- Indexes for tenant-scoped lookups and common query patterns.
create index idx_business_users_business_id on business_users (business_id);
create index idx_business_users_auth_user_id on business_users (auth_user_id);
create index idx_knowledge_sources_business_id on knowledge_sources (business_id);
create index idx_knowledge_chunks_business_id on knowledge_chunks (business_id);
create index idx_knowledge_chunks_source_id on knowledge_chunks (source_id);
create index idx_chat_sessions_business_id on chat_sessions (business_id);
create index idx_chat_messages_session_id on chat_messages (session_id);
create index idx_bookings_business_id on bookings (business_id);
create index idx_usage_logs_business_id on usage_logs (business_id);

-- Vector similarity index for RAG lookups (Phase 2).
create index idx_knowledge_chunks_embedding on knowledge_chunks
  using hnsw (embedding vector_cosine_ops);
