-- Record writes (with calendar subscriptions and photo metadata) and the photo store.
create or replace function public.kb_put_many(code text, rows jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  fid uuid := public.kb_family(code);
  r jsonb; n int; last bigint := 0;
  allowed text[] := array['members','events','chores','completions','lists','items','meals','rewards','redemptions','settings','feeds','photos'];
begin
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then raise exception 'too_many_rows'; end if;
  select count(*) into n from public.docs where family_id = fid;
  if n > 20000 then raise exception 'family_full'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    if not (r->>'col' = any(allowed)) or length(r->>'id') not between 1 and 200 then raise exception 'bad_row'; end if;
    if coalesce((r->>'deleted')::boolean, false) then
      update public.docs set deleted = true, data = '{}'::jsonb, rev = nextval('public.kb_rev_seq'), updated_at = now()
        where family_id = fid and docs.col = r->>'col' and docs.id = r->>'id' returning docs.rev into last;
    else
      if jsonb_typeof(r->'data') <> 'object' or octet_length((r->'data')::text) > 65536 then raise exception 'bad_data'; end if;
      insert into public.docs(family_id, col, id, data) values (fid, r->>'col', r->>'id', r->'data')
        on conflict (family_id, col, id) do update set data = excluded.data, deleted = false,
          rev = nextval('public.kb_rev_seq'), updated_at = now()
        returning docs.rev into last;
    end if;
  end loop;
  return last;
end $$;
grant execute on function public.kb_put_many(text,jsonb) to anon, authenticated;

create table public.photos (
  family_id uuid not null references public.families(id) on delete cascade,
  id text not null check (length(id) between 1 and 80),
  mime text not null check (mime in ('image/jpeg','image/webp','image/png')),
  bytes bytea not null,
  created_at timestamptz not null default now(),
  primary key (family_id, id)
);
alter table public.photos enable row level security;
revoke all on public.photos from anon, authenticated;

create or replace function public.kb_photo_put(code text, photo_id text, mime text, b64 text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare fid uuid := public.kb_family(code); raw bytea; n int;
begin
  raw := decode(b64, 'base64');
  if octet_length(raw) > 600000 then raise exception 'photo_too_large'; end if;
  select count(*) into n from public.photos where family_id = fid;
  if n >= 300 then raise exception 'too_many_photos'; end if;
  insert into public.photos(family_id, id, mime, bytes) values (fid, photo_id, mime, raw)
    on conflict (family_id, id) do update set mime = excluded.mime, bytes = excluded.bytes;
  return true;
end $$;

create or replace function public.kb_photo_get(code text, photo_id text) returns table(mime text, b64 text)
language plpgsql security definer set search_path = '' stable as $$
declare fid uuid := public.kb_family(code);
begin
  return query select p.mime, encode(p.bytes, 'base64') from public.photos p where p.family_id = fid and p.id = photo_id;
end $$;

create or replace function public.kb_photo_del(code text, photo_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare fid uuid := public.kb_family(code);
begin delete from public.photos where family_id = fid and id = photo_id; return true; end $$;

grant execute on function public.kb_photo_put(text,text,text,text), public.kb_photo_get(text,text), public.kb_photo_del(text,text) to anon, authenticated;
