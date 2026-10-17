-- =============================================================================
-- Anvex 0004: request/usage ledger
-- =============================================================================
-- One row per gateway execution or AI chat completion. Token counts are only
-- written when an upstream provider actually returns them; nothing is
-- estimated or fabricated.
-- =============================================================================

create table if not exists public.api_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  api_id uuid references public.apis (id) on delete set null,
  ai_model_id uuid references public.ai_models (id) on delete set null,
  platform_key_id uuid references public.platform_api_keys (id) on delete set null,
  kind public.request_kind not null default 'rest',
  method text,
  status_code integer,
  duration_ms integer,
  response_bytes integer,
  ok boolean not null default false,
  error_code text,
  created_at timestamptz not null default now(),
  prompt_tokens integer,
  completion_tokens integer
);

create index if not exists api_requests_user_time_idx
  on public.api_requests (user_id, created_at desc);
create index if not exists api_requests_api_time_idx
  on public.api_requests (api_id, created_at desc);
create index if not exists api_requests_key_time_idx
  on public.api_requests (platform_key_id, created_at desc);

alter table public.api_requests enable row level security;
revoke all on public.api_requests from anon, authenticated;

drop policy if exists api_requests_read_own_or_admin on public.api_requests;
create policy api_requests_read_own_or_admin on public.api_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

do $$
declare
  col text;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'api_requests'
  loop
    execute format('grant select (%I) on public.api_requests to authenticated', col);
  end loop;
end $$;
