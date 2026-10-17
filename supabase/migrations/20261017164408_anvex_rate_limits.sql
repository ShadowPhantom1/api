-- =============================================================================
-- Anvex 0003: platform key rate limiting
-- =============================================================================
-- Fixed-window counters backed by a security-definer function. Only the
-- service role may execute it, so anonymous clients cannot inflate counters.
-- =============================================================================

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  subject text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_subject_idx
  on public.rate_limit_events (subject, created_at desc);

alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;

create or replace function public.consume_rate_limit(
  p_subject text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid rate limit parameters';
  end if;

  -- Serialise concurrent checks for the same subject.
  perform pg_advisory_xact_lock(hashtext(p_subject));

  -- Opportunistic cleanup keeps the table bounded.
  delete from public.rate_limit_events
   where subject = p_subject
     and created_at < now() - make_interval(secs => p_window_seconds * 2);

  select count(*) into v_count
    from public.rate_limit_events
   where subject = p_subject
     and created_at >= now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_events (subject) values (p_subject);
  return true;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
