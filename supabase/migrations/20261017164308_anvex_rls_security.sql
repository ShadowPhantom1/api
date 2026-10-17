-- =============================================================================
-- Anvex 0002: row level security, policies and least-privilege grants
-- =============================================================================
-- The dashboard and gateway use the service-role key on the server, after
-- performing their own authorization checks. These policies exist so that the
-- same data is safe if it is ever queried directly with a user JWT, and the
-- grants make sure encrypted upstream credentials are never readable by anon
-- or authenticated clients, even through a `select *`.
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.providers enable row level security;
alter table public.apis enable row level security;
alter table public.ai_models enable row level security;
alter table public.platform_api_keys enable row level security;
alter table public.discovery_runs enable row level security;

-- Start from zero for browser-facing roles. Service role bypasses RLS.
revoke all on public.profiles from anon, authenticated;
revoke all on public.categories from anon, authenticated;
revoke all on public.providers from anon, authenticated;
revoke all on public.apis from anon, authenticated;
revoke all on public.ai_models from anon, authenticated;
revoke all on public.platform_api_keys from anon, authenticated;
revoke all on public.discovery_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (true);

drop policy if exists providers_public_read on public.providers;
create policy providers_public_read on public.providers
  for select to anon, authenticated
  using (true);

drop policy if exists apis_read_public_or_owned on public.apis;
create policy apis_read_public_or_owned on public.apis
  for select to anon, authenticated
  using ((is_public and is_enabled) or owner_id = auth.uid() or public.is_admin());

drop policy if exists apis_insert_own on public.apis;
create policy apis_insert_own on public.apis
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists apis_update_own_or_admin on public.apis;
create policy apis_update_own_or_admin on public.apis
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists apis_delete_own_or_admin on public.apis;
create policy apis_delete_own_or_admin on public.apis
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists ai_models_read_public_or_owned on public.ai_models;
create policy ai_models_read_public_or_owned on public.ai_models
  for select to anon, authenticated
  using ((is_public and is_enabled) or owner_id = auth.uid() or public.is_admin());

drop policy if exists ai_models_write_owned on public.ai_models;
create policy ai_models_write_owned on public.ai_models
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Column grants (auth_config_encrypted is deliberately excluded)
-- ---------------------------------------------------------------------------
do $$
declare
  col text;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'apis'
      and column_name <> 'auth_config_encrypted'
  loop
    execute format('grant select (%I) on public.apis to anon, authenticated', col);
  end loop;

  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_models'
      and column_name <> 'auth_config_encrypted'
  loop
    execute format('grant select (%I) on public.ai_models to anon, authenticated', col);
  end loop;

  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
  loop
    execute format('grant select (%I) on public.profiles to authenticated', col);
  end loop;
end $$;

grant select on public.categories to anon, authenticated;
grant select on public.providers to anon, authenticated;
grant select on public.api_directory to anon, authenticated;
grant select on public.catalog_stats to anon, authenticated;

-- No grants at all on platform_api_keys, discovery_runs or api_requests yet:
-- key digests are service-role only and request accounting is added by 0004.
