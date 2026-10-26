-- The pieces of a Supabase database that the Groundswell migrations rely on, so they can run
-- against a plain local Postgres for tests.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated to authenticator;
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets,
  name text not null, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant insert, select on storage.objects to anon, authenticated;
