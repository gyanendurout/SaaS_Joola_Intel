-- Migration 017: ask_intel_qa_log
-- Captures every Ask Intel Q&A turn plus thumbs-up/down feedback so we can
-- iterate on the planner prompt + alias map. Created 2026-05-25.
--
-- Read-only after insert from the user's side; the /feedback API route only
-- patches `feedback`, `feedback_notes`, `user_followup` columns.
--
-- Idempotent: `create table if not exists` + `create index if not exists`.

begin;

create table if not exists ask_intel_qa_log (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  question text not null,
  answer_summary text,
  visuals_count int default 0,
  data_sources text[] default '{}',
  feedback text check (feedback in ('up','down','none')) default 'none',
  feedback_notes text,
  user_followup text,
  latency_ms int,
  confidence numeric,
  warnings text[] default '{}',
  error_message text,
  created_at timestamptz default now()
);

create index if not exists ask_intel_qa_log_created_at_idx
  on ask_intel_qa_log (created_at desc);

create index if not exists ask_intel_qa_log_feedback_idx
  on ask_intel_qa_log (feedback);

create index if not exists ask_intel_qa_log_session_id_idx
  on ask_intel_qa_log (session_id, created_at desc);

commit;
