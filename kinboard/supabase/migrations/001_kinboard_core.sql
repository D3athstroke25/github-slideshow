create extension if not exists pgcrypto with schema extensions;

create sequence public.kb_rev_seq;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  secret_hash bytea not null unique,
  created_at timestamptz not null default now()
);

create table public.docs (
  family_id uuid not null references public.families(id) on delete cascade,
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  rev bigint not null default nextval('public.kb_rev_seq'),
  updated_at timestamptz not null default now(),
  primary key (family_id, col, id)
);
create index docs_family_rev on public.docs (family_id, rev);

alter table public.families enable row level security;
alter table public.docs enable row level security;
revoke all on public.families, public.docs from anon, authenticated;

create or replace function public.kb_family(code text) returns uuid
language plpgsql security definer set search_path = '' stable as $$
declare fid uuid;
begin
  select id into fid from public.families
   where secret_hash = extensions.digest(upper(regexp_replace(coalesce(code,''), '[^A-Za-z0-9]', '', 'g')), 'sha256');
  if fid is null then raise exception 'family_not_found' using errcode = 'P0002'; end if;
  return fid;
end $$;
revoke execute on function public.kb_family(text) from public, anon, authenticated;

create or replace function public.kb_create_family() returns text
language plpgsql security definer set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(16);
  raw text := '';
  i int;
begin
  for i in 0..15 loop
    raw := raw || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  insert into public.families(secret_hash) values (extensions.digest(raw, 'sha256'));
  return substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4)||'-'||substr(raw,13,4);
end $$;

create or replace function public.kb_check(code text) returns boolean
language plpgsql security definer set search_path = '' stable as $$
begin perform public.kb_family(code); return true; end $$;

create or replace function public.kb_pull(code text, since bigint default 0)
returns table(col text, id text, data jsonb, deleted boolean, rev bigint)
language plpgsql security definer set search_path = '' stable as $$
declare fid uuid := public.kb_family(code);
begin
  return query select d.col, d.id, d.data, d.deleted, d.rev from public.docs d
    where d.family_id = fid and d.rev > coalesce(since,0)
    order by d.rev limit 5000;
end $$;

create or replace function public.kb_delete_family(code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare fid uuid := public.kb_family(code);
begin delete from public.families where id = fid; return true; end $$;

-- kb_put_many is (re)defined in 002 with the full list of record types.

grant execute on function public.kb_create_family(), public.kb_check(text), public.kb_pull(text,bigint),
  public.kb_delete_family(text) to anon, authenticated;
