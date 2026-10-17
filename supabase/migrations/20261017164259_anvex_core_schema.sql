-- =============================================================================
-- Anvex — dynamic API aggregator
-- 0001: extensions, types, tables, constraints, indexes, views and triggers
-- =============================================================================
-- This migration is the authoritative schema for a fresh Supabase project.
-- It intentionally creates no policies; those live in 0002. Rate limiting and
-- request accounting are added in 0003/0004.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.api_verification_status as enum ('unverified', 'verified', 'failed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.request_kind as enum ('rest', 'ai_chat', 'discovery_test');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Profiles must exist before this function is created: it reads public.profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- The first account to sign up becomes the platform administrator.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_admin boolean;
begin
  select not exists (select 1 from public.profiles where role = 'admin') into first_admin;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'developer'), '@', 1)),
    case when first_admin then 'admin' else 'user' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Catalog taxonomy
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text not null,
  description text,
  icon text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text not null,
  description text,
  homepage_url text,
  base_url text,
  docs_url text,
  terms_url text,
  allowed_hosts text[] not null default '{}',
  discovery_adapter text not null default 'none'
    check (discovery_adapter in ('none', 'rebix_manifest', 'openapi', 'json_manifest')),
  discovery_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists providers_set_updated_at on public.providers;
create trigger providers_set_updated_at
before update on public.providers
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Endpoints
-- ---------------------------------------------------------------------------
create table if not exists public.apis (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  provider_id uuid references public.providers (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null,
  description text,
  base_url text not null check (base_url ~ '^https?://'),
  path text not null default '/',
  method text not null default 'GET' check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  query_params jsonb not null default '[]'::jsonb check (jsonb_typeof(query_params) = 'array'),
  path_params jsonb not null default '[]'::jsonb check (jsonb_typeof(path_params) = 'array'),
  headers_schema jsonb not null default '[]'::jsonb check (jsonb_typeof(headers_schema) = 'array'),
  body_schema jsonb,
  auth_type text not null default 'none' check (auth_type in ('none', 'bearer', 'api_key', 'basic')),
  auth_config_encrypted text,
  auth_config_meta jsonb not null default '{}'::jsonb,
  content_type text not null default 'application/json',
  request_example jsonb,
  response_example jsonb,
  response_schema jsonb,
  docs_url text,
  source_url text,
  discovery_source text not null default 'manual',
  discovery_metadata jsonb not null default '{}'::jsonb,
  verification_status public.api_verification_status not null default 'unverified',
  last_status_code integer,
  last_tested_at timestamptz,
  last_error text,
  is_public boolean not null default false,
  is_enabled boolean not null default true,
  is_nsfw boolean not null default false,
  is_managed boolean not null default false,
  allow_extra_query boolean not null default false,
  supports_streaming boolean not null default false,
  timeout_ms integer not null default 15000 check (timeout_ms between 1000 and 60000),
  source_key text unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector,
  constraint managed_needs_source_key check (not is_managed or source_key is not null)
);

drop trigger if exists apis_set_updated_at on public.apis;
create trigger apis_set_updated_at
before update on public.apis
for each row execute function public.set_updated_at();

create index if not exists apis_directory_idx on public.apis (is_public, is_enabled, category_id)
  where is_public and is_enabled;
create index if not exists apis_owner_idx on public.apis (owner_id);
create index if not exists apis_provider_idx on public.apis (provider_id);
create index if not exists apis_search_idx on public.apis using gin (search_vector);
create index if not exists apis_name_trgm_idx on public.apis using gin (name extensions.gin_trgm_ops);
create index if not exists apis_last_tested_idx on public.apis (last_tested_at desc nulls last);

-- ---------------------------------------------------------------------------
-- AI model aliases for the OpenAI-compatible gateway
-- ---------------------------------------------------------------------------
create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  provider_id uuid references public.providers (id) on delete set null,
  api_id uuid references public.apis (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  name text not null,
  description text,
  adapter text not null
    check (adapter in ('openai_compatible', 'anthropic_messages', 'gemini_generate', 'rebix_text')),
  base_url text,
  chat_path text not null default '/chat/completions',
  upstream_model text,
  auth_type text not null default 'none' check (auth_type in ('none', 'bearer', 'api_key', 'basic')),
  auth_config_encrypted text,
  auth_config_meta jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default
    '{"chat": true, "tools": false, "usage": false, "streaming": false}'::jsonb,
  context_window integer,
  is_public boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists ai_models_set_updated_at on public.ai_models;
create trigger ai_models_set_updated_at
before update on public.ai_models
for each row execute function public.set_updated_at();

create index if not exists ai_models_public_idx on public.ai_models (is_public, is_enabled)
  where is_public and is_enabled;
create index if not exists ai_models_owner_idx on public.ai_models (owner_id);

-- ---------------------------------------------------------------------------
-- Platform API keys (digest only; the secret is never stored)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  last_four text not null,
  permissions text[] not null default array['execute', 'chat', 'models'],
  rate_limit_per_minute integer not null default 60 check (rate_limit_per_minute between 1 and 10000),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  rotated_from uuid references public.platform_api_keys (id) on delete set null
);

create index if not exists platform_api_keys_user_idx
  on public.platform_api_keys (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Discovery audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider_id uuid references public.providers (id) on delete set null,
  adapter text not null,
  source_url text not null,
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  attempted_methods jsonb not null default '[]'::jsonb,
  notes text,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  failed_count integer not null default 0,
  endpoint_ids uuid[] not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists discovery_runs_started_idx on public.discovery_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Public read models (security_invoker so RLS still applies)
-- ---------------------------------------------------------------------------
create or replace view public.api_directory
with (security_invoker = true) as
select
  a.id, a.slug, a.name, a.description, a.base_url, a.path, a.method,
  a.query_params, a.path_params, a.headers_schema, a.body_schema,
  a.auth_type, a.content_type, a.request_example, a.response_example,
  a.response_schema, a.docs_url, a.source_url, a.verification_status,
  a.last_status_code, a.last_tested_at, a.is_public, a.is_nsfw,
  a.supports_streaming, a.timeout_ms, a.owner_id, a.is_enabled,
  a.created_at, a.updated_at,
  c.slug as category_slug, c.name as category_name,
  p.slug as provider_slug, p.name as provider_name, p.homepage_url as provider_homepage
from public.apis a
left join public.categories c on c.id = a.category_id
left join public.providers p on p.id = a.provider_id;

create or replace view public.catalog_stats
with (security_invoker = true) as
select
  count(*) filter (where is_public and is_enabled) as public_endpoints,
  count(*) filter (where verification_status = 'verified' and is_public and is_enabled) as verified_endpoints,
  count(distinct category_id) filter (where is_public and is_enabled) as categories
from public.apis;
