-- Groundswell: an all-or-nothing crowdfunding platform.
-- Security model: clients never read or write tables directly. Every call goes through the
-- SECURITY DEFINER functions below. Accounts are local to this schema: passwords are bcrypt
-- hashed, and sessions are random tokens of which only a SHA-256 hash is stored.

create extension if not exists pgcrypto with schema extensions;

-- ============================================================ tables

create table public.users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  pw_hash       text not null,
  recovery_hash bytea,
  bio           text not null default '' check (char_length(bio) <= 600),
  location      text not null default '' check (char_length(location) <= 80),
  avatar_path   text,
  show_backed   boolean not null default false,
  is_admin      boolean not null default false,
  sample        boolean not null default false,
  failed_logins int not null default 0,
  locked_until  timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now()
);

create table public.sessions (
  token_hash bytea primary key,
  user_id    uuid not null references public.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);
create index sessions_user on public.sessions (user_id);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  creator_id    uuid not null references public.users,
  status        text not null default 'draft' check (status in ('draft','live','successful','unsuccessful','canceled')),
  title         text not null default '' check (char_length(title) <= 80),
  blurb         text not null default '' check (char_length(blurb) <= 160),
  category      text not null default 'design',
  location      text not null default '' check (char_length(location) <= 80),
  cover_path    text,
  cover_seed    int not null default floor(random() * 1000000)::int,
  video_url     text not null default '' check (char_length(video_url) <= 300),
  story         text not null default '' check (char_length(story) <= 60000),
  risks         text not null default '' check (char_length(risks) <= 8000),
  faqs          jsonb not null default '[]'::jsonb,
  currency      text not null default 'USD' check (currency in ('USD','CAD','EUR','GBP','AUD')),
  goal_cents    bigint not null default 500000 check (goal_cents between 100 and 10000000000),
  duration_days int not null default 30 check (duration_days between 1 and 60),
  launched_at   timestamptz,
  deadline      timestamptz,
  ended_at      timestamptz,
  pledged_cents bigint not null default 0,
  backers_count int not null default 0,
  preview_key   text not null default encode(extensions.gen_random_bytes(9), 'hex'),
  featured      boolean not null default false,
  hidden        boolean not null default false,
  sample        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index projects_status_deadline on public.projects (status, deadline);
create index projects_creator on public.projects (creator_id);

create table public.rewards (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects on delete cascade,
  title          text not null check (char_length(title) between 1 and 80),
  description    text not null default '' check (char_length(description) <= 1500),
  items          jsonb not null default '[]'::jsonb,
  amount_cents   bigint not null check (amount_cents between 100 and 1000000),
  ships          boolean not null default false,
  shipping_cents bigint not null default 0 check (shipping_cents between 0 and 100000),
  est_delivery   date,
  limit_qty      int check (limit_qty is null or limit_qty between 1 and 1000000),
  backers_count  int not null default 0,
  created_at     timestamptz not null default now()
);
create index rewards_project on public.rewards (project_id);

create table public.pledges (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects on delete cascade,
  backer_id      uuid not null references public.users,
  reward_id      uuid references public.rewards on delete set null,
  amount_cents   bigint not null check (amount_cents between 100 and 1000000),
  shipping_cents bigint not null default 0,
  status         text not null default 'active' check (status in ('active','canceled','collected','dropped')),
  backer_no      int not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  canceled_at    timestamptz,
  unique (project_id, backer_id)
);
create index pledges_backer on public.pledges (backer_id);
create index pledges_reward on public.pledges (reward_id);

-- Every change to a project's total, for the creator's funding chart.
create table public.pledge_events (
  id            bigint generated always as identity primary key,
  project_id    uuid not null references public.projects on delete cascade,
  at            timestamptz not null default now(),
  delta_cents   bigint not null,
  delta_backers int not null
);
create index pledge_events_project on public.pledge_events (project_id, at);

create table public.updates (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects on delete cascade,
  n            int not null,
  title        text not null check (char_length(title) between 1 and 120),
  body         text not null check (char_length(body) <= 40000),
  backers_only boolean not null default false,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  unique (project_id, n)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  update_id  uuid references public.updates on delete cascade,
  parent_id  uuid references public.comments on delete cascade,
  user_id    uuid not null references public.users,
  body       text not null check (char_length(body) <= 2000),
  deleted    boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_thread on public.comments (project_id, update_id, created_at);

create table public.saves (
  user_id    uuid not null references public.users on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  notified   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
create index saves_project on public.saves (project_id);

create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users on delete cascade,
  kind       text not null,
  project_id uuid references public.projects on delete cascade,
  actor_id   uuid references public.users on delete set null,
  data       jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc);

-- Upload tickets: a signed-in user asks for a path, and Storage accepts a file only at an
-- unexpired ticketed path (see 002_groundswell_storage.sql).
create table public.uploads (
  path       text primary key,
  user_id    uuid not null references public.users on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);

create table public.reports (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects on delete cascade,
  user_id    uuid not null references public.users on delete cascade,
  reason     text not null check (char_length(reason) <= 1000),
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.throttle (
  key text not null,
  at  timestamptz not null default now()
);
create index throttle_key on public.throttle (key, at);

alter table public.users         enable row level security;
alter table public.sessions      enable row level security;
alter table public.projects      enable row level security;
alter table public.rewards       enable row level security;
alter table public.pledges       enable row level security;
alter table public.pledge_events enable row level security;
alter table public.updates       enable row level security;
alter table public.comments      enable row level security;
alter table public.saves         enable row level security;
alter table public.notifications enable row level security;
alter table public.uploads       enable row level security;
alter table public.reports       enable row level security;
alter table public.throttle      enable row level security;

-- ============================================================ internal helpers

create function public.gs_categories() returns text[] language sql immutable as $$
  select array['art','comics','crafts','dance','design','fashion','film','food','games',
               'journalism','music','photography','publishing','technology','theater']
$$;

-- Client IP as reported by the API gateway, or null when called outside the API.
create function public.gs_ip() returns text language sql stable as $$
  select nullif(trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1)), '')
$$;

-- Records a hit and returns true while under the limit. A null key always passes.
create function public.gs_throttle(p_key text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_key is null then return true; end if;
  if (select count(*) from throttle where key = p_key and at > now() - p_window) >= p_max then return false; end if;
  insert into throttle (key) values (p_key);
  return true;
end $$;

create function public.gs_new_token() returns text language sql volatile set search_path = public, extensions, pg_temp as $$
  select translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_')
$$;

-- 16-character recovery code, e.g. K7QM-2XRP-9HCW-T4NB (about 79 bits).
create function public.gs_new_code() returns text language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare
  a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := gen_random_bytes(16);
  s text := '';
begin
  for i in 0..15 loop
    s := s || substr(a, (get_byte(b, i) % 31) + 1, 1);
    if i in (3, 7, 11) then s := s || '-'; end if;
  end loop;
  return s;
end $$;

create function public.gs_code_hash(p_code text) returns bytea language sql immutable set search_path = public, extensions, pg_temp as $$
  select digest(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'), 'sha256')
$$;

create function public.gs_session(p_uid uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t text := gs_new_token();
begin
  insert into sessions (token_hash, user_id) values (digest(t, 'sha256'), p_uid);
  delete from sessions where user_id = p_uid and expires_at < now();
  return t;
end $$;

-- Signed-in user id, or null for a missing or expired token.
create function public.gs_uid_opt(p_token text) returns uuid
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.user_id from sessions s join users u on u.id = s.user_id
  where p_token is not null and p_token <> '' and s.token_hash = digest(p_token, 'sha256')
    and s.expires_at > now() and u.deleted_at is null
$$;

create function public.gs_uid(p_token text) returns uuid
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := gs_uid_opt(p_token);
begin
  if v is null then raise exception 'Please log in to continue.' using hint = 'auth'; end if;
  return v;
end $$;

create function public.gs_money(p_cents bigint, p_currency text) returns text language sql immutable as $$
  select case p_currency when 'USD' then 'US$' when 'CAD' then 'CA$' when 'AUD' then 'A$' when 'EUR' then '€' when 'GBP' then '£' else '' end
      || case when p_cents % 100 = 0 then trim(to_char(p_cents / 100, 'FM999,999,999,990'))
              else trim(to_char(p_cents / 100.0, 'FM999,999,999,990.00')) end
$$;

create function public.gs_user_json(p_uid uuid) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select case when u.deleted_at is not null
           then jsonb_build_object('username', null, 'name', 'Deleted user', 'avatar', null)
           else jsonb_build_object('username', u.username, 'name', u.display_name, 'avatar', u.avatar_path) end
  from users u where u.id = p_uid
$$;

create function public.gs_me_json(p_uid uuid) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'name', u.display_name, 'bio', u.bio,
    'location', u.location, 'avatar', u.avatar_path, 'show_backed', u.show_backed, 'admin', u.is_admin,
    'joined', u.created_at)
  from users u where u.id = p_uid
$$;

-- The card shown in every project list.
create function public.gs_card(p public.projects, p_viewer uuid) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'blurb', p.blurb, 'category', p.category,
    'location', p.location, 'cover', p.cover_path, 'seed', p.cover_seed, 'currency', p.currency,
    'goal', p.goal_cents, 'pledged', p.pledged_cents, 'backers', p.backers_count, 'status', p.status,
    'launched_at', p.launched_at, 'deadline', p.deadline, 'ended_at', p.ended_at,
    'duration', p.duration_days, 'sample', p.sample, 'featured', p.featured, 'hidden', p.hidden,
    'creator', gs_user_json(p.creator_id),
    'saved', p_viewer is not null and exists (select 1 from saves s where s.user_id = p_viewer and s.project_id = p.id))
$$;

create function public.gs_reward_json(r public.rewards) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'title', r.title, 'description', r.description, 'items', r.items,
    'amount', r.amount_cents, 'ships', r.ships, 'shipping', r.shipping_cents,
    'est_delivery', to_char(r.est_delivery, 'YYYY-MM'), 'limit', r.limit_qty, 'backers', r.backers_count,
    'left', case when r.limit_qty is null then null else greatest(r.limit_qty - r.backers_count, 0) end)
$$;

create function public.gs_pledge_json(x public.pledges) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', x.id, 'amount', x.amount_cents, 'shipping', x.shipping_cents,
    'reward_id', x.reward_id, 'reward', (select r.title from rewards r where r.id = x.reward_id),
    'status', x.status, 'backer_no', x.backer_no, 'created_at', x.created_at, 'updated_at', x.updated_at)
$$;

-- Ratio of pledged to goal, used for sorting.
create function public.gs_pct(p public.projects) returns numeric language sql immutable as $$
  select p.pledged_cents::numeric / greatest(p.goal_cents, 1)
$$;

-- Backers gained in the last 7 days.
create function public.gs_recent(p_project uuid) returns bigint language sql stable set search_path = public, extensions, pg_temp as $$
  select coalesce(sum(delta_backers), 0) from pledge_events where project_id = p_project and at > now() - interval '7 days'
$$;

-- Close out every live project whose deadline has passed. All-or-nothing: projects that met
-- their goal collect their pledges; the rest drop them. Called at the top of most API calls,
-- so no scheduler is needed.
create function public.gs_settle() returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r record; res text;
begin
  for r in select id, creator_id, pledged_cents, goal_cents from projects
           where status = 'live' and deadline <= now() for update skip locked loop
    res := case when r.pledged_cents >= r.goal_cents then 'successful' else 'unsuccessful' end;
    update projects set status = res, ended_at = deadline, updated_at = now() where id = r.id and status = 'live';
    update pledges set status = case when res = 'successful' then 'collected' else 'dropped' end, updated_at = now()
      where project_id = r.id and status = 'active';
    insert into notifications (user_id, kind, project_id, data)
      values (r.creator_id, 'ended', r.id, jsonb_build_object('result', res, 'role', 'creator'));
    insert into notifications (user_id, kind, project_id, data)
      select backer_id, 'ended', r.id, jsonb_build_object('result', res, 'role', 'backer')
      from pledges where project_id = r.id and status in ('collected', 'dropped');
  end loop;

  -- Saved projects ending within 48 hours (skip people who already backed them).
  with s as (
    update saves sv set notified = true
    from projects p
    where p.id = sv.project_id and p.status = 'live' and p.deadline > now()
      and p.deadline <= now() + interval '48 hours' and not sv.notified
      and not exists (select 1 from pledges x where x.project_id = p.id and x.backer_id = sv.user_id and x.status = 'active')
    returning sv.user_id, sv.project_id)
  insert into notifications (user_id, kind, project_id) select user_id, 'ending_soon', project_id from s;

  delete from throttle where at < now() - interval '1 day';
end $$;

-- ============================================================ triggers

create function public.gs_pledges_changed() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  pid    uuid := coalesce(new.project_id, old.project_id);
  old_c  bigint := case when tg_op <> 'INSERT' and old.status <> 'canceled' then old.amount_cents else 0 end;
  new_c  bigint := case when tg_op <> 'DELETE' and new.status <> 'canceled' then new.amount_cents else 0 end;
  old_b  int := case when tg_op <> 'INSERT' and old.status <> 'canceled' then 1 else 0 end;
  new_b  int := case when tg_op <> 'DELETE' and new.status <> 'canceled' then 1 else 0 end;
begin
  if new_c <> old_c or new_b <> old_b then
    insert into pledge_events (project_id, delta_cents, delta_backers) values (pid, new_c - old_c, new_b - old_b);
  end if;
  update projects set
    pledged_cents = (select coalesce(sum(amount_cents), 0) from pledges where project_id = pid and status <> 'canceled'),
    backers_count = (select count(*) from pledges where project_id = pid and status <> 'canceled')
  where id = pid;
  update rewards rw set backers_count = (select count(*) from pledges x where x.reward_id = rw.id and x.status <> 'canceled')
  where rw.id in (case when tg_op <> 'INSERT' then old.reward_id end, case when tg_op <> 'DELETE' then new.reward_id end);
  return null;
end $$;

create trigger pledges_changed after insert or update or delete on public.pledges
  for each row execute function public.gs_pledges_changed();

-- ============================================================ accounts

create function public.gs_signup(p_username text, p_password text, p_name text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  u    text := lower(trim(coalesce(p_username, '')));
  n    text := trim(coalesce(p_name, ''));
  code text := gs_new_code();
  uid  uuid;
begin
  if u !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Usernames are 3 to 24 characters: letters, numbers and underscores.';
  end if;
  if u in ('admin','administrator','groundswell','support','help','staff','team','official','moderator','deleted','root','system') then
    raise exception 'That username is reserved. Please pick another.';
  end if;
  if char_length(coalesce(p_password, '')) < 8 then raise exception 'Use at least 8 characters for your password.'; end if;
  if char_length(p_password) > 72 then raise exception 'Passwords can be at most 72 characters.'; end if;
  if n = '' then n := u; end if;
  n := left(n, 60);
  if exists (select 1 from users where username = u) then raise exception 'That username is taken.'; end if;
  if not gs_throttle('signup:' || gs_ip(), 20, interval '1 hour') then
    raise exception 'Too many new accounts from this network. Please try again later.';
  end if;
  insert into users (username, display_name, pw_hash, recovery_hash)
    values (u, n, crypt(p_password, gen_salt('bf', 10)), gs_code_hash(code))
    returning id into uid;
  return jsonb_build_object('token', gs_session(uid), 'recovery', code, 'me', gs_me_json(uid));
exception when unique_violation then
  raise exception 'That username is taken.';
end $$;

-- Wrong credentials return {error} instead of raising, so failed-attempt counters are kept.
create function public.gs_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r users; ip text := gs_ip();
begin
  if ip is not null and (select count(*) from throttle where key = 'loginfail:' || ip and at > now() - interval '15 minutes') >= 30 then
    return jsonb_build_object('error', 'Too many attempts from this network. Please wait 15 minutes.');
  end if;
  select * into r from users where username = lower(trim(coalesce(p_username, ''))) and deleted_at is null;
  if r.id is null then
    perform gs_throttle('loginfail:' || ip, 1000, interval '15 minutes');
    return jsonb_build_object('error', 'Wrong username or password.');
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('error', 'Too many wrong passwords. This account is locked for 15 minutes.');
  end if;
  if r.pw_hash <> crypt(coalesce(p_password, ''), r.pw_hash) then
    update users set failed_logins = case when failed_logins >= 9 then 0 else failed_logins + 1 end,
                     locked_until = case when failed_logins >= 9 then now() + interval '15 minutes' else locked_until end
      where id = r.id;
    perform gs_throttle('loginfail:' || ip, 1000, interval '15 minutes');
    return jsonb_build_object('error', 'Wrong username or password.');
  end if;
  update users set failed_logins = 0, locked_until = null where id = r.id;
  return jsonb_build_object('token', gs_session(r.id), 'me', gs_me_json(r.id));
end $$;

create function public.gs_logout(p_token text) returns jsonb
language sql security definer set search_path = public, extensions, pg_temp as $$
  delete from sessions where token_hash = digest(coalesce(p_token, ''), 'sha256');
  select '{}'::jsonb;
$$;

create function public.gs_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token);
begin
  perform gs_settle();
  -- Sliding expiry: stay signed in while the app keeps being used.
  update sessions set expires_at = now() + interval '90 days'
    where token_hash = digest(p_token, 'sha256') and expires_at < now() + interval '80 days';
  return jsonb_build_object('me', gs_me_json(uid), 'now', now(),
    'unread', (select count(*) from notifications where user_id = uid and not read));
end $$;

create function public.gs_profile_save(p_token text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); u users;
begin
  select * into u from users where id = uid for update;
  if p_patch ? 'name' then
    u.display_name := left(trim(coalesce(p_patch->>'name', '')), 60);
    if u.display_name = '' then raise exception 'Please enter a name.'; end if;
  end if;
  if p_patch ? 'bio' then u.bio := left(trim(coalesce(p_patch->>'bio', '')), 600); end if;
  if p_patch ? 'location' then u.location := left(trim(coalesce(p_patch->>'location', '')), 80); end if;
  if p_patch ? 'show_backed' then u.show_backed := coalesce((p_patch->>'show_backed')::boolean, false); end if;
  if p_patch ? 'avatar' then
    u.avatar_path := nullif(p_patch->>'avatar', '');
    if u.avatar_path is not null and not exists (select 1 from uploads where path = u.avatar_path and user_id = uid) then
      raise exception 'That image upload was not found. Please try again.';
    end if;
  end if;
  update users set display_name = u.display_name, bio = u.bio, location = u.location,
    show_backed = u.show_backed, avatar_path = u.avatar_path where id = uid;
  return gs_me_json(uid);
end $$;

create function public.gs_password_change(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); h text;
begin
  select pw_hash into h from users where id = uid;
  if h <> crypt(coalesce(p_old, ''), h) then raise exception 'Your current password is not right.'; end if;
  if char_length(coalesce(p_new, '')) < 8 then raise exception 'Use at least 8 characters for your new password.'; end if;
  if char_length(p_new) > 72 then raise exception 'Passwords can be at most 72 characters.'; end if;
  update users set pw_hash = crypt(p_new, gen_salt('bf', 10)) where id = uid;
  -- Sign out every other device.
  delete from sessions where user_id = uid and token_hash <> digest(p_token, 'sha256');
  return '{}'::jsonb;
end $$;

create function public.gs_password_reset(p_username text, p_code text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r users; code text := gs_new_code();
begin
  if char_length(coalesce(p_new, '')) < 8 then return jsonb_build_object('error', 'Use at least 8 characters for your new password.'); end if;
  if char_length(p_new) > 72 then return jsonb_build_object('error', 'Passwords can be at most 72 characters.'); end if;
  select * into r from users where username = lower(trim(coalesce(p_username, ''))) and deleted_at is null;
  if r.id is null then return jsonb_build_object('error', 'That username and recovery code don''t match.'); end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('error', 'Too many attempts. This account is locked for 15 minutes.');
  end if;
  if r.recovery_hash is null or r.recovery_hash <> gs_code_hash(p_code) then
    update users set failed_logins = case when failed_logins >= 9 then 0 else failed_logins + 1 end,
                     locked_until = case when failed_logins >= 9 then now() + interval '15 minutes' else locked_until end
      where id = r.id;
    return jsonb_build_object('error', 'That username and recovery code don''t match.');
  end if;
  update users set pw_hash = crypt(p_new, gen_salt('bf', 10)), recovery_hash = gs_code_hash(code),
                   failed_logins = 0, locked_until = null where id = r.id;
  delete from sessions where user_id = r.id;
  return jsonb_build_object('token', gs_session(r.id), 'recovery', code, 'me', gs_me_json(r.id));
end $$;

create function public.gs_recovery_new(p_token text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); h text; code text := gs_new_code();
begin
  select pw_hash into h from users where id = uid;
  if h <> crypt(coalesce(p_password, ''), h) then raise exception 'That password is not right.'; end if;
  update users set recovery_hash = gs_code_hash(code) where id = uid;
  return jsonb_build_object('recovery', code);
end $$;

-- Deleting an account cancels its live projects and pledges, removes drafts, and anonymizes
-- the profile. Finished projects stay up (backers still need them), credited to "Deleted user".
create function public.gs_account_delete(p_token text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); h text; pid uuid;
begin
  select pw_hash into h from users where id = uid;
  if h <> crypt(coalesce(p_password, ''), h) then raise exception 'That password is not right.'; end if;
  for pid in select id from projects where creator_id = uid and status = 'live' loop
    update projects set status = 'canceled', ended_at = now(), updated_at = now() where id = pid;
    update pledges set status = 'dropped', updated_at = now() where project_id = pid and status = 'active';
    insert into notifications (user_id, kind, project_id)
      select backer_id, 'canceled', pid from pledges where project_id = pid and status = 'dropped';
  end loop;
  delete from projects where creator_id = uid and status = 'draft';
  update pledges set status = 'canceled', canceled_at = now(), updated_at = now() where backer_id = uid and status = 'active';
  update comments set deleted = true, body = '' where user_id = uid;
  delete from saves where user_id = uid;
  delete from notifications where user_id = uid;
  delete from sessions where user_id = uid;
  update users set username = 'deleted_' || substr(replace(id::text, '-', ''), 1, 12), display_name = 'Deleted user',
    pw_hash = '!', recovery_hash = null, bio = '', location = '', avatar_path = null, show_backed = false,
    deleted_at = now() where id = uid;
  return '{}'::jsonb;
end $$;

-- ============================================================ discovery

create function public.gs_home(p_token text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid; feat projects;
begin
  perform gs_settle();
  v := gs_uid_opt(p_token);
  select * into feat from projects p where p.status = 'live' and not p.hidden
    order by p.featured desc, gs_recent(p.id) desc, gs_pct(p) desc, p.launched_at desc limit 1;
  return jsonb_build_object(
    'now', now(),
    'featured', case when feat.id is null then null else gs_card(feat, v) end,
    'loved', coalesce((select jsonb_agg(gs_card(p, v) order by s.o) from (
        select id, row_number() over (order by featured desc, gs_pct(x) desc) o from projects x
        where x.status = 'live' and not x.hidden and x.id is distinct from feat.id
        order by o limit 6) s join projects p on p.id = s.id), '[]'),
    'trending', coalesce((select jsonb_agg(gs_card(p, v) order by s.o) from (
        select id, row_number() over (order by gs_recent(x.id) desc, gs_pct(x) desc, x.launched_at desc) o from projects x
        where x.status = 'live' and not x.hidden order by o limit 8) s join projects p on p.id = s.id), '[]'),
    'nearly', coalesce((select jsonb_agg(gs_card(p, v) order by s.o) from (
        select id, row_number() over (order by gs_pct(x) desc) o from projects x
        where x.status = 'live' and not x.hidden and gs_pct(x) >= 0.6 and gs_pct(x) < 1 order by o limit 8) s join projects p on p.id = s.id), '[]'),
    'ending', coalesce((select jsonb_agg(gs_card(p, v) order by p.deadline) from (
        select id from projects x where x.status = 'live' and not x.hidden order by x.deadline limit 8) s join projects p on p.id = s.id), '[]'),
    'fresh', coalesce((select jsonb_agg(gs_card(p, v) order by p.launched_at desc) from (
        select id from projects x where x.status = 'live' and not x.hidden order by x.launched_at desc limit 8) s join projects p on p.id = s.id), '[]'),
    'funded', coalesce((select jsonb_agg(gs_card(p, v) order by p.ended_at desc) from (
        select id from projects x where x.status = 'successful' and not x.hidden order by x.ended_at desc limit 8) s join projects p on p.id = s.id), '[]'),
    'stats', jsonb_build_object(
        'live', (select count(*) from projects where status = 'live' and not hidden),
        'funded', (select count(*) from projects where status = 'successful' and not hidden),
        'backers', (select count(distinct backer_id) from pledges where status <> 'canceled')),
    'categories', (select jsonb_object_agg(c, (select count(*) from projects p where p.category = c and p.status = 'live' and not p.hidden))
        from unnest(gs_categories()) c)
  );
end $$;

create function public.gs_explore(p_token text default null, p_q text default '', p_category text default '',
  p_state text default 'live', p_sort text default 'magic', p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid; q text := trim(coalesce(p_q, '')); pat text; total int; items jsonb; lim int := 24;
begin
  perform gs_settle();
  v := gs_uid_opt(p_token);
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  with f as (
    select p.id, p.featured, p.status, p.launched_at, p.deadline, p.ended_at, p.backers_count, p.pledged_cents,
           gs_pct(p) pct, gs_recent(p.id) r
    from projects p left join users u on u.id = p.creator_id
    where not p.hidden
      and case coalesce(p_state, 'live')
            when 'live' then p.status = 'live'
            when 'successful' then p.status = 'successful'
            when 'ended' then p.status in ('successful', 'unsuccessful')
            else p.status in ('live', 'successful', 'unsuccessful') end
      and (coalesce(p_category, '') = '' or p.category = p_category)
      and (q = '' or p.title ilike pat or p.blurb ilike pat or p.location ilike pat
           or (u.deleted_at is null and (u.display_name ilike pat or u.username ilike pat)))
  ), s as (
    select f.id, row_number() over (order by
        case when p_sort = 'newest' then extract(epoch from f.launched_at) end desc nulls last,
        case when p_sort = 'ending' then case when f.status = 'live' then extract(epoch from f.deadline) else 1e12 + extract(epoch from now() - f.ended_at) end end asc nulls last,
        case when p_sort = 'funded' then f.pct end desc nulls last,
        case when p_sort = 'backers' then f.backers_count end desc nulls last,
        case when p_sort = 'pledged' then f.pledged_cents end desc nulls last,
        -- "magic": momentum first, then progress, with a lift for new launches
        f.featured::int * 3 + f.r * 2 + least(f.pct, 2) * 10
          + case when f.launched_at > now() - interval '5 days' then 4 else 0 end desc,
        f.launched_at desc) rn
    from f)
  select count(*)::int, coalesce(jsonb_agg(gs_card(p, v) order by s.rn) filter (where s.rn > p_offset and s.rn <= p_offset + lim), '[]')
    into total, items from s join projects p on p.id = s.id;
  return jsonb_build_object('items', items, 'total', total, 'more', total > p_offset + lim, 'now', now());
end $$;

create function public.gs_can_see(p projects, v uuid, p_preview text) returns boolean language sql stable set search_path = public, extensions, pg_temp as $$
  select coalesce(p.id is not null and (
    (p.status <> 'draft' and not p.hidden)
    or (v is not null and p.creator_id = v)
    or (p.status = 'draft' and not p.hidden and p_preview is not null and p_preview = p.preview_key)
    or exists (select 1 from users a where a.id = v and a.is_admin)), false)
$$;

create function public.gs_is_backer(p_project uuid, v uuid) returns boolean language sql stable set search_path = public, extensions, pg_temp as $$
  select v is not null and exists (select 1 from pledges where project_id = p_project and backer_id = v and status <> 'canceled')
$$;

create function public.gs_project(p_token text default null, p_slug text default '', p_preview text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid; p projects; me_pledge pledges; is_creator boolean; is_backer boolean;
begin
  perform gs_settle();
  v := gs_uid_opt(p_token);
  select * into p from projects where slug = lower(coalesce(p_slug, ''));
  if not gs_can_see(p, v, p_preview) then raise exception 'We couldn''t find that project.' using hint = 'notfound'; end if;
  is_creator := coalesce(p.creator_id = v, false);
  is_backer := gs_is_backer(p.id, v);
  select * into me_pledge from pledges where project_id = p.id and backer_id = v;
  return jsonb_build_object(
    'now', now(),
    'project', gs_card(p, v) || jsonb_build_object('story', p.story, 'risks', p.risks, 'faqs', p.faqs,
        'video', p.video_url, 'created_at', p.created_at,
        'preview_key', case when is_creator then p.preview_key end,
        'comments', (select count(*) from comments c where c.project_id = p.id and c.update_id is null and not c.deleted)),
    'creator', gs_user_json(p.creator_id) || coalesce((select jsonb_build_object('bio', u.bio, 'location', u.location, 'joined', u.created_at,
        'created', (select count(*) from projects x where x.creator_id = u.id and x.status <> 'draft' and not x.hidden),
        'backed', (select count(*) from pledges x where x.backer_id = u.id and x.status <> 'canceled'))
        from users u where u.id = p.creator_id and u.deleted_at is null), '{}'::jsonb),
    'rewards', coalesce((select jsonb_agg(gs_reward_json(r) order by r.amount_cents, r.created_at) from rewards r where r.project_id = p.id), '[]'),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'n', u.n, 'title', u.title,
        'body', case when not u.backers_only or is_creator or is_backer then u.body end,
        'backers_only', u.backers_only, 'created_at', u.created_at, 'edited_at', u.edited_at,
        'comments', (select count(*) from comments c where c.update_id = u.id and not c.deleted)) order by u.n desc)
        from updates u where u.project_id = p.id), '[]'),
    'community', jsonb_build_object(
        'backers', p.backers_count,
        'returning', (select count(*) from pledges x where x.project_id = p.id and x.status <> 'canceled'
            and exists (select 1 from pledges y where y.backer_id = x.backer_id and y.project_id <> p.id and y.status <> 'canceled'))),
    'me', jsonb_build_object('signed_in', v is not null, 'creator', is_creator, 'backer', is_backer,
        'can_comment', is_creator or is_backer,
        'saved', v is not null and exists (select 1 from saves s where s.user_id = v and s.project_id = p.id),
        'admin', exists (select 1 from users a where a.id = v and a.is_admin),
        'pledge', case when me_pledge.id is null then null else gs_pledge_json(me_pledge) end)
  );
end $$;

create function public.gs_comments(p_token text default null, p_project uuid default null, p_update uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := gs_uid_opt(p_token); p projects; u updates; creator uuid; is_backer boolean; is_creator boolean;
begin
  select * into p from projects where id = p_project;
  if not gs_can_see(p, v, null) then raise exception 'We couldn''t find that project.' using hint = 'notfound'; end if;
  is_backer := gs_is_backer(p.id, v);
  is_creator := coalesce(p.creator_id = v, false);
  if p_update is not null then
    select * into u from updates where id = p_update and project_id = p.id;
    if u.id is null then raise exception 'That update was deleted.' using hint = 'notfound'; end if;
    if u.backers_only and not (is_backer or is_creator) then
      return jsonb_build_object('items', '[]'::jsonb, 'can_comment', false, 'locked', true);
    end if;
  end if;
  creator := p.creator_id;
  return jsonb_build_object(
    'can_comment', is_creator or is_backer,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'parent', c.parent_id,
        'body', case when c.deleted then '' else c.body end, 'deleted', c.deleted, 'created_at', c.created_at,
        'author', case when c.deleted then null else gs_user_json(c.user_id) end,
        'badge', case when c.deleted then null when c.user_id = creator then 'creator'
                      when exists (select 1 from pledges x where x.project_id = p.id and x.backer_id = c.user_id and x.status <> 'canceled') then 'backer' end,
        'mine', coalesce(c.user_id = v, false), 'can_delete', not c.deleted and coalesce(c.user_id = v or is_creator, false)) order by c.created_at)
      from (select * from comments where project_id = p.id and update_id is not distinct from p_update order by created_at limit 1000) c), '[]'));
end $$;

create function public.gs_user(p_token text default null, p_username text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := gs_uid_opt(p_token); u users; self boolean;
begin
  perform gs_settle();
  select * into u from users where username = lower(coalesce(p_username, '')) and deleted_at is null;
  if u.id is null then raise exception 'We couldn''t find that person.' using hint = 'notfound'; end if;
  self := coalesce(u.id = v, false);
  return jsonb_build_object(
    'now', now(),
    'user', gs_user_json(u.id) || jsonb_build_object('bio', u.bio, 'location', u.location, 'joined', u.created_at, 'self', self,
        'show_backed', u.show_backed or self, 'sample', u.sample,
        'backed_count', (select count(*) from pledges x join projects p on p.id = x.project_id where x.backer_id = u.id and x.status <> 'canceled' and not p.hidden)),
    'created', coalesce((select jsonb_agg(gs_card(p, v) order by p.launched_at desc nulls first, p.created_at desc)
        from projects p where p.creator_id = u.id and ((p.status <> 'draft' and not p.hidden) or self)), '[]'),
    'backed', case when u.show_backed or self then coalesce((select jsonb_agg(gs_card(p, v) order by x.created_at desc)
        from pledges x join projects p on p.id = x.project_id where x.backer_id = u.id and x.status <> 'canceled' and not p.hidden), '[]') end
  );
end $$;

create function public.gs_mine(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := gs_uid(p_token);
begin
  perform gs_settle();
  return jsonb_build_object(
    'now', now(),
    'created', coalesce((select jsonb_agg(gs_card(p, v) order by p.created_at desc) from projects p where p.creator_id = v), '[]'),
    'backed', coalesce((select jsonb_agg(gs_card(p, v) || jsonb_build_object('pledge', gs_pledge_json(x))
        order by (x.status = 'active') desc, x.updated_at desc)
        from pledges x join projects p on p.id = x.project_id where x.backer_id = v and x.status <> 'canceled'), '[]'),
    'saved', coalesce((select jsonb_agg(gs_card(p, v) order by (p.status = 'live') desc, p.deadline)
        from saves s join projects p on p.id = s.project_id where s.user_id = v and not p.hidden), '[]')
  );
end $$;

-- ============================================================ creating projects

create function public.gs_slugify(p_text text) returns text language sql immutable as $$
  select trim(both '-' from left(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), 60))
$$;

create function public.gs_unique_slug(p_title text, p_id uuid) returns text
language plpgsql set search_path = public, extensions, pg_temp as $$
declare b text := gs_slugify(p_title); s text;
begin
  if char_length(b) < 3 then b := 'project'; end if;
  s := b;
  while exists (select 1 from projects where slug = s and id is distinct from p_id) loop
    s := b || '-' || substr(md5(random()::text), 1, 5);
  end loop;
  return s;
end $$;

create function public.gs_checklist(p projects) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'title',   'step', 'basics',  'label', 'Give your project a title',            'ok', char_length(trim(p.title)) >= 4),
    jsonb_build_object('key', 'blurb',   'step', 'basics',  'label', 'Write a one-line subtitle',            'ok', char_length(trim(p.blurb)) >= 10),
    jsonb_build_object('key', 'goal',    'step', 'basics',  'label', 'Set a funding goal and duration',      'ok', p.goal_cents >= 100 and p.duration_days between 1 and 60),
    jsonb_build_object('key', 'rewards', 'step', 'rewards', 'label', 'Offer at least one reward',            'ok', exists (select 1 from rewards r where r.project_id = p.id)),
    jsonb_build_object('key', 'story',   'step', 'story',   'label', 'Tell your story (150+ characters)',    'ok', char_length(trim(p.story)) >= 150),
    jsonb_build_object('key', 'risks',   'step', 'story',   'label', 'Explain the risks and challenges',     'ok', char_length(trim(p.risks)) >= 30)
  )
$$;

create function public.gs_editor_json(p_id uuid) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select gs_card(p, p.creator_id) || jsonb_build_object('story', p.story, 'risks', p.risks, 'faqs', p.faqs,
      'video', p.video_url, 'preview_key', p.preview_key, 'updated_at', p.updated_at,
      'locked', p.status <> 'draft', 'checklist', gs_checklist(p),
      'rewards', coalesce((select jsonb_agg(gs_reward_json(r) order by r.amount_cents, r.created_at) from rewards r where r.project_id = p.id), '[]'))
  from projects p where p.id = p_id
$$;

create function public.gs_own(p_token text, p_project uuid) returns projects
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); p projects;
begin
  select * into p from projects where id = p_project for update;
  if p.id is null or p.creator_id <> uid then raise exception 'We couldn''t find that project.' using hint = 'notfound'; end if;
  return p;
end $$;

create function public.gs_project_new(p_token text, p_title text, p_category text, p_currency text default 'USD') returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); t text := left(trim(coalesce(p_title, '')), 80); pid uuid;
begin
  if char_length(t) < 1 then raise exception 'Give your project a working title.'; end if;
  if not (p_category = any (gs_categories())) then raise exception 'Pick a category.'; end if;
  if coalesce(p_currency, 'USD') not in ('USD','CAD','EUR','GBP','AUD') then raise exception 'That currency isn''t supported.'; end if;
  if (select count(*) from projects where creator_id = uid and status = 'draft') >= 10 then
    raise exception 'You have 10 drafts already. Launch or delete one first.';
  end if;
  if not gs_throttle('newproject:' || uid, 20, interval '1 day') then raise exception 'You''ve started a lot of projects today. Please try again tomorrow.'; end if;
  insert into projects (slug, creator_id, title, category, currency)
    values (gs_unique_slug(t, null), uid, t, p_category, coalesce(p_currency, 'USD')) returning id into pid;
  return gs_editor_json(pid);
end $$;

create function public.gs_project_edit(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project);
begin
  return gs_editor_json(p.id);
end $$;

create function public.gs_project_save(p_token text, p_project uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project); uid uuid := p.creator_id; f jsonb; v text;
begin
  if p.status = 'canceled' then raise exception 'This project was canceled and can''t be edited.'; end if;
  if p.status <> 'draft' then
    if (p_patch ? 'goal_cents' and (p_patch->>'goal_cents')::bigint is distinct from p.goal_cents)
       or (p_patch ? 'currency' and p_patch->>'currency' is distinct from p.currency)
       or (p_patch ? 'duration_days' and (p_patch->>'duration_days')::int is distinct from p.duration_days) then
      raise exception 'The goal, currency and duration are locked once a project launches.';
    end if;
  end if;
  if p_patch ? 'title' then
    p.title := left(trim(coalesce(p_patch->>'title', '')), 80);
    if p.title = '' then raise exception 'Your project needs a title.'; end if;
    if p.status = 'draft' then p.slug := gs_unique_slug(p.title, p.id); end if;
  end if;
  if p_patch ? 'blurb' then p.blurb := left(trim(coalesce(p_patch->>'blurb', '')), 160); end if;
  if p_patch ? 'category' then
    if not (p_patch->>'category' = any (gs_categories())) then raise exception 'Pick a category.'; end if;
    p.category := p_patch->>'category';
  end if;
  if p_patch ? 'location' then p.location := left(trim(coalesce(p_patch->>'location', '')), 80); end if;
  if p_patch ? 'cover' then
    p.cover_path := nullif(p_patch->>'cover', '');
    if p.cover_path is not null and not exists (select 1 from uploads where path = p.cover_path and user_id = uid) then
      raise exception 'That image upload was not found. Please try again.';
    end if;
  end if;
  if p_patch ? 'seed' then p.cover_seed := abs(coalesce((p_patch->>'seed')::int, 0)) % 1000000; end if;
  if p_patch ? 'video' then
    v := trim(coalesce(p_patch->>'video', ''));
    if v <> '' and v !~* '^https://(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)/' then
      raise exception 'Video links must be YouTube or Vimeo links.';
    end if;
    p.video_url := left(v, 300);
  end if;
  if p_patch ? 'story' then
    if char_length(coalesce(p_patch->>'story', '')) > 60000 then raise exception 'Your story is too long (60,000 characters max).'; end if;
    p.story := coalesce(p_patch->>'story', '');
  end if;
  if p_patch ? 'risks' then
    if char_length(coalesce(p_patch->>'risks', '')) > 8000 then raise exception 'Risks and challenges can be at most 8,000 characters.'; end if;
    p.risks := coalesce(p_patch->>'risks', '');
  end if;
  if p_patch ? 'faqs' then
    if jsonb_typeof(p_patch->'faqs') <> 'array' or jsonb_array_length(p_patch->'faqs') > 30 then
      raise exception 'You can have up to 30 FAQ entries.';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('q', left(trim(e->>'q'), 200), 'a', left(trim(coalesce(e->>'a', '')), 2000)) order by o), '[]')
      into f from jsonb_array_elements(p_patch->'faqs') with ordinality t(e, o)
      where jsonb_typeof(e) = 'object' and trim(coalesce(e->>'q', '')) <> '';
    p.faqs := f;
  end if;
  if p.status = 'draft' then
    if p_patch ? 'currency' then
      if p_patch->>'currency' not in ('USD','CAD','EUR','GBP','AUD') then raise exception 'That currency isn''t supported.'; end if;
      p.currency := p_patch->>'currency';
    end if;
    if p_patch ? 'goal_cents' then
      p.goal_cents := (p_patch->>'goal_cents')::bigint;
      if p.goal_cents is null or p.goal_cents < 100 then raise exception 'Set a goal of at least 1.'; end if;
      if p.goal_cents > 10000000000 then raise exception 'That goal is too large.'; end if;
    end if;
    if p_patch ? 'duration_days' then
      p.duration_days := (p_patch->>'duration_days')::int;
      if p.duration_days is null or p.duration_days not between 1 and 60 then raise exception 'Campaigns run for 1 to 60 days.'; end if;
    end if;
  end if;
  update projects set slug = p.slug, title = p.title, blurb = p.blurb, category = p.category, location = p.location,
    cover_path = p.cover_path, cover_seed = p.cover_seed, video_url = p.video_url, story = p.story, risks = p.risks,
    faqs = p.faqs, currency = p.currency, goal_cents = p.goal_cents, duration_days = p.duration_days, updated_at = now()
  where id = p.id;
  return gs_editor_json(p.id);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Please enter a valid number.';
end $$;

create function public.gs_project_launch(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project); missing text;
begin
  if p.status <> 'draft' then raise exception 'This project has already launched.'; end if;
  select string_agg(lower(e->>'label'), ', ') into missing from jsonb_array_elements(gs_checklist(p)) e where not (e->>'ok')::boolean;
  if missing is not null then raise exception 'Almost there. Still to do: %.', missing; end if;
  update projects set status = 'live', launched_at = now(), deadline = now() + make_interval(days => duration_days), updated_at = now()
    where id = p.id;
  return gs_editor_json(p.id);
end $$;

create function public.gs_project_cancel(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project);
begin
  perform gs_settle();
  select * into p from projects where id = p.id;
  if p.status <> 'live' then raise exception 'Only live projects can be canceled.'; end if;
  update projects set status = 'canceled', ended_at = now(), updated_at = now() where id = p.id;
  update pledges set status = 'dropped', updated_at = now() where project_id = p.id and status = 'active';
  insert into notifications (user_id, kind, project_id)
    select backer_id, 'canceled', p.id from pledges where project_id = p.id and status = 'dropped';
  return gs_editor_json(p.id);
end $$;

create function public.gs_project_delete(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project);
begin
  if p.status <> 'draft' then raise exception 'Launched projects can''t be deleted. You can cancel a live project instead.'; end if;
  delete from projects where id = p.id;
  return '{}'::jsonb;
end $$;

create function public.gs_reward_save(p_token text, p_project uuid, p_reward jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project); r rewards; rid uuid := nullif(p_reward->>'id', '')::uuid; items jsonb; d text;
begin
  if p.status not in ('draft', 'live') then raise exception 'Rewards can only be changed before the campaign ends.'; end if;
  if rid is not null then
    select * into r from rewards where id = rid and project_id = p.id for update;
    if r.id is null then raise exception 'That reward was deleted.'; end if;
  else
    if (select count(*) from rewards where project_id = p.id) >= 30 then raise exception 'A project can have up to 30 rewards.'; end if;
    r.project_id := p.id; r.backers_count := 0;
  end if;
  if r.backers_count > 0 and (
       (p_reward->>'amount')::bigint is distinct from r.amount_cents
    or coalesce((p_reward->>'ships')::boolean, false) is distinct from r.ships
    or (case when coalesce((p_reward->>'ships')::boolean, false) then (p_reward->>'shipping')::bigint else 0 end) is distinct from (case when r.ships then r.shipping_cents else 0 end)) then
    raise exception 'This reward has backers, so its price and shipping are locked. Add a new reward instead.';
  end if;
  r.title := left(trim(coalesce(p_reward->>'title', '')), 80);
  if r.title = '' then raise exception 'Give the reward a title.'; end if;
  r.description := left(trim(coalesce(p_reward->>'description', '')), 1500);
  r.amount_cents := (p_reward->>'amount')::bigint;
  if r.amount_cents is null or r.amount_cents < 100 then raise exception 'Rewards start at 1.'; end if;
  if r.amount_cents > 1000000 then raise exception 'Rewards can be at most 10,000.'; end if;
  r.ships := coalesce((p_reward->>'ships')::boolean, false);
  r.shipping_cents := case when r.ships then coalesce((p_reward->>'shipping')::bigint, 0) else 0 end;
  if r.shipping_cents not between 0 and 100000 then raise exception 'Shipping can be at most 1,000.'; end if;
  if r.amount_cents + r.shipping_cents > 1000000 then raise exception 'Reward plus shipping can be at most 10,000.'; end if;
  if jsonb_typeof(coalesce(p_reward->'items', '[]')) <> 'array' or jsonb_array_length(coalesce(p_reward->'items', '[]')) > 12 then
    raise exception 'List up to 12 included items.';
  end if;
  select coalesce(jsonb_agg(left(trim(e #>> '{}'), 80) order by o), '[]') into items
    from jsonb_array_elements(coalesce(p_reward->'items', '[]')) with ordinality t(e, o) where trim(coalesce(e #>> '{}', '')) <> '';
  r.items := items;
  d := nullif(trim(coalesce(p_reward->>'est_delivery', '')), '');
  if d is not null then
    if d !~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$' then raise exception 'Pick an estimated delivery month.'; end if;
    r.est_delivery := (d || '-01')::date;
  else
    r.est_delivery := null;
  end if;
  r.limit_qty := nullif(p_reward->>'limit', '')::int;
  if r.limit_qty is not null and r.limit_qty < 1 then raise exception 'Limits must be at least 1.'; end if;
  if r.limit_qty is not null and r.limit_qty < r.backers_count then
    raise exception 'This reward already has % backers, so the limit can''t go below that.', r.backers_count;
  end if;
  if rid is null then
    insert into rewards (project_id, title, description, items, amount_cents, ships, shipping_cents, est_delivery, limit_qty)
      values (p.id, r.title, r.description, r.items, r.amount_cents, r.ships, r.shipping_cents, r.est_delivery, r.limit_qty)
      returning * into r;
  else
    update rewards set title = r.title, description = r.description, items = r.items, amount_cents = r.amount_cents,
      ships = r.ships, shipping_cents = r.shipping_cents, est_delivery = r.est_delivery, limit_qty = r.limit_qty
      where id = r.id returning * into r;
  end if;
  update projects set updated_at = now() where id = p.id;
  return gs_editor_json(p.id);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Please enter a valid number.';
end $$;

create function public.gs_reward_delete(p_token text, p_reward uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r rewards; p projects;
begin
  select * into r from rewards where id = p_reward;
  if r.id is null then raise exception 'That reward was already deleted.'; end if;
  p := gs_own(p_token, r.project_id);
  if p.status not in ('draft', 'live') then raise exception 'Rewards can only be changed before the campaign ends.'; end if;
  if r.backers_count > 0 then raise exception 'This reward has backers, so it can''t be deleted. You can set its limit to stop new pledges.'; end if;
  delete from rewards where id = r.id;
  return gs_editor_json(p.id);
end $$;

create function public.gs_upload_ticket(p_token text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); path text;
begin
  if p_kind not in ('cover', 'avatar', 'story') then raise exception 'Unknown upload type.'; end if;
  if not gs_throttle('upload:' || uid, 60, interval '1 hour') then raise exception 'That''s a lot of uploads. Please try again in an hour.'; end if;
  path := 'u/' || uid || '/' || p_kind || '-' || encode(gen_random_bytes(12), 'hex') || '.jpg';
  insert into uploads (path, user_id, kind) values (path, uid, p_kind);
  return jsonb_build_object('path', path);
end $$;

-- Used by the Storage insert policy: a path is uploadable for 30 minutes after it is ticketed.
create function public.gs_ticket_ok(p_name text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (select 1 from uploads where path = p_name and created_at > now() - interval '30 minutes')
$$;

-- ============================================================ creator dashboard and updates

create function public.gs_dashboard(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects;
begin
  perform gs_settle();
  p := gs_own(p_token, p_project);
  if p.status = 'draft' then raise exception 'The dashboard opens once your project launches.'; end if;
  return jsonb_build_object(
    'now', now(),
    'project', gs_editor_json(p.id),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'pledged', c, 'backers', b) order by d) from (
        select d, sum(sc) over (order by d) c, sum(sb) over (order by d) b from (
          select date_trunc('day', at)::date d, sum(delta_cents) sc, sum(delta_backers) sb
          from pledge_events where project_id = p.id group by 1) x) y), '[]'),
    'backers', coalesce((select jsonb_agg(jsonb_build_object('no', x.backer_no, 'user', gs_user_json(x.backer_id),
        'reward', r.title, 'amount', x.amount_cents, 'shipping', x.shipping_cents, 'status', x.status, 'at', x.created_at) order by x.backer_no desc)
        from pledges x left join rewards r on r.id = x.reward_id where x.project_id = p.id and x.status <> 'canceled'), '[]'),
    'canceled', (select count(*) from pledges where project_id = p.id and status = 'canceled'),
    'no_reward', (select count(*) from pledges where project_id = p.id and status <> 'canceled' and reward_id is null),
    'saves', (select count(*) from saves where project_id = p.id),
    'comments', (select count(*) from comments where project_id = p.id and not deleted),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'n', u.n, 'title', u.title, 'body', u.body,
        'backers_only', u.backers_only, 'created_at', u.created_at) order by u.n desc) from updates u where u.project_id = p.id), '[]')
  );
end $$;

create function public.gs_update_post(p_token text, p_project uuid, p_id uuid default null, p_title text default '',
  p_body text default '', p_backers_only boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project); t text := left(trim(coalesce(p_title, '')), 120); u updates;
begin
  if p.status = 'draft' then raise exception 'You can post updates once your project launches.'; end if;
  if t = '' then raise exception 'Give your update a title.'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write something in your update.'; end if;
  if char_length(p_body) > 40000 then raise exception 'Updates can be at most 40,000 characters.'; end if;
  if p_id is null then
    if not gs_throttle('update:' || p.id, 20, interval '1 day') then raise exception 'That''s a lot of updates for one day. Try again tomorrow.'; end if;
    insert into updates (project_id, n, title, body, backers_only)
      values (p.id, coalesce((select max(n) from updates where project_id = p.id), 0) + 1, t, p_body, coalesce(p_backers_only, false))
      returning * into u;
    insert into notifications (user_id, kind, project_id, actor_id, data)
      select x.backer_id, 'update', p.id, p.creator_id, jsonb_build_object('n', u.n, 'title', u.title)
      from pledges x where x.project_id = p.id and x.status <> 'canceled';
  else
    update updates set title = t, body = p_body, backers_only = coalesce(p_backers_only, false), edited_at = now()
      where id = p_id and project_id = p.id returning * into u;
    if u.id is null then raise exception 'That update was deleted.'; end if;
  end if;
  return jsonb_build_object('id', u.id, 'n', u.n);
end $$;

create function public.gs_update_delete(p_token text, p_update uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u updates; p projects;
begin
  select * into u from updates where id = p_update;
  if u.id is null then return '{}'::jsonb; end if;
  p := gs_own(p_token, u.project_id);
  delete from updates where id = u.id;
  delete from notifications where kind = 'update' and project_id = p.id and (data->>'n')::int = u.n;
  return '{}'::jsonb;
end $$;

-- ============================================================ backing

create function public.gs_pledge(p_token text, p_project uuid, p_reward uuid default null, p_amount bigint default 0) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); p projects; r rewards; x pledges; minimum bigint := 100; ship bigint := 0;
  before_pct numeric; after_pct numeric; m numeric; first_time boolean;
begin
  perform gs_settle();
  select * into p from projects where id = p_project for update;
  if p.id is null or p.status = 'draft' or p.hidden then raise exception 'We couldn''t find that project.' using hint = 'notfound'; end if;
  if p.status <> 'live' or p.deadline <= now() then raise exception 'This project is no longer taking pledges.'; end if;
  if p.creator_id = uid then raise exception 'You can''t back your own project.'; end if;
  select * into x from pledges where project_id = p.id and backer_id = uid for update;
  first_time := x.id is null or x.status = 'canceled';
  if p_reward is not null then
    select * into r from rewards where id = p_reward and project_id = p.id for update;
    if r.id is null then raise exception 'That reward is no longer available.'; end if;
    if r.limit_qty is not null and r.backers_count >= r.limit_qty
       and not (x.id is not null and x.status = 'active' and x.reward_id = r.id) then
      raise exception 'Sorry, that reward just sold out.';
    end if;
    ship := case when r.ships then r.shipping_cents else 0 end;
    minimum := r.amount_cents + ship;
  end if;
  if p_amount is null or p_amount < minimum then
    raise exception 'The minimum pledge for this reward is %.', gs_money(minimum, p.currency);
  end if;
  if p_amount > 1000000 then raise exception 'Pledges are limited to % per project.', gs_money(1000000, p.currency); end if;
  if first_time and not gs_throttle('pledge:' || uid, 30, interval '1 hour') then
    raise exception 'That''s a lot of pledges in an hour. Please try again later.';
  end if;
  before_pct := gs_pct(p);
  if x.id is null then
    insert into pledges (project_id, backer_id, reward_id, amount_cents, shipping_cents, backer_no)
      values (p.id, uid, p_reward, p_amount, ship, coalesce((select max(backer_no) from pledges where project_id = p.id), 0) + 1)
      returning * into x;
  else
    update pledges set reward_id = p_reward, amount_cents = p_amount, shipping_cents = ship, status = 'active',
      canceled_at = null, updated_at = now(),
      backer_no = case when status = 'canceled' then coalesce((select max(backer_no) from pledges where project_id = p.id), 0) + 1 else backer_no end
      where id = x.id returning * into x;
  end if;
  select * into p from projects where id = p.id;
  after_pct := gs_pct(p);
  -- Tell the creator about their first backer and each funding milestone; tell backers when it's funded.
  if p.backers_count = 1 and first_time then
    insert into notifications (user_id, kind, project_id, actor_id) values (p.creator_id, 'first_backer', p.id, uid);
  end if;
  select max(t) into m from unnest(array[0.25, 0.5, 0.75, 1, 2, 5, 10]::numeric[]) t where before_pct < t and after_pct >= t;
  if m is not null then
    insert into notifications (user_id, kind, project_id, data) values (p.creator_id, 'milestone', p.id, jsonb_build_object('pct', (m * 100)::int));
  end if;
  if before_pct < 1 and after_pct >= 1 then
    insert into notifications (user_id, kind, project_id)
      select backer_id, 'funded', p.id from pledges where project_id = p.id and status = 'active' and backer_id <> uid;
  end if;
  return jsonb_build_object('pledge', gs_pledge_json(x), 'project', gs_card(p, uid), 'first', first_time);
end $$;

create function public.gs_pledge_cancel(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); p projects; x pledges;
begin
  perform gs_settle();
  select * into p from projects where id = p_project for update;
  select * into x from pledges where project_id = p_project and backer_id = uid for update;
  if x.id is null or x.status <> 'active' then raise exception 'You don''t have an active pledge on this project.'; end if;
  if p.status <> 'live' then raise exception 'This campaign has ended, so pledges can''t be changed.'; end if;
  update pledges set status = 'canceled', canceled_at = now(), updated_at = now() where id = x.id;
  select * into p from projects where id = p.id;
  return jsonb_build_object('project', gs_card(p, uid));
end $$;

create function public.gs_save(p_token text, p_project uuid, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token);
begin
  if p_on then
    if not exists (select 1 from projects where id = p_project and status <> 'draft' and not hidden) then
      raise exception 'We couldn''t find that project.' using hint = 'notfound';
    end if;
    insert into saves (user_id, project_id) values (uid, p_project) on conflict do nothing;
  else
    delete from saves where user_id = uid and project_id = p_project;
  end if;
  return jsonb_build_object('saved', p_on);
end $$;

create function public.gs_comment_post(p_token text, p_project uuid, p_update uuid default null, p_parent uuid default null, p_body text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); p projects; par comments; b text := trim(coalesce(p_body, '')); c comments; up updates;
begin
  select * into p from projects where id = p_project;
  if p.id is null or p.status = 'draft' or p.hidden then raise exception 'We couldn''t find that project.' using hint = 'notfound'; end if;
  if not (p.creator_id = uid or gs_is_backer(p.id, uid)) then raise exception 'Only backers can comment on this project.'; end if;
  if p_update is not null then
    select * into up from updates where id = p_update and project_id = p.id;
    if up.id is null then raise exception 'That update was deleted.'; end if;
  end if;
  if b = '' then raise exception 'Write a comment first.'; end if;
  if char_length(b) > 2000 then raise exception 'Comments can be at most 2,000 characters.'; end if;
  if p_parent is not null then
    select * into par from comments where id = p_parent and project_id = p.id and update_id is not distinct from p_update;
    if par.id is null then raise exception 'That comment was deleted.'; end if;
    if par.parent_id is not null then select * into par from comments where id = par.parent_id; end if;
  end if;
  if not gs_throttle('comment:' || uid, 20, interval '10 minutes') then raise exception 'You''re commenting very fast. Take a short break.'; end if;
  insert into comments (project_id, update_id, parent_id, user_id, body) values (p.id, p_update, par.id, uid, b) returning * into c;
  if uid <> p.creator_id then
    insert into notifications (user_id, kind, project_id, actor_id, data)
      values (p.creator_id, 'comment', p.id, uid, jsonb_build_object('excerpt', left(b, 140), 'n', up.n));
  end if;
  if par.id is not null and par.user_id <> uid and par.user_id <> p.creator_id and not par.deleted then
    insert into notifications (user_id, kind, project_id, actor_id, data)
      values (par.user_id, 'reply', p.id, uid, jsonb_build_object('excerpt', left(b, 140), 'n', up.n));
  end if;
  return jsonb_build_object('id', c.id);
end $$;

create function public.gs_comment_delete(p_token text, p_comment uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); c comments;
begin
  select * into c from comments where id = p_comment;
  if c.id is null then return '{}'::jsonb; end if;
  if c.user_id <> uid and not exists (select 1 from projects where id = c.project_id and creator_id = uid)
     and not exists (select 1 from users where id = uid and is_admin) then
    raise exception 'You can only delete your own comments.';
  end if;
  update comments set deleted = true, body = '' where id = c.id;
  return '{}'::jsonb;
end $$;

create function public.gs_report(p_token text, p_project uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token);
begin
  if not exists (select 1 from projects where id = p_project and status <> 'draft') then raise exception 'We couldn''t find that project.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Tell us briefly what''s wrong.'; end if;
  if not gs_throttle('report:' || uid, 10, interval '1 day') then raise exception 'You''ve sent a lot of reports today. Thank you. We''ll review them.'; end if;
  insert into reports (project_id, user_id, reason) values (p_project, uid, left(trim(p_reason), 1000));
  return '{}'::jsonb;
end $$;

create function public.gs_notifications(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token);
begin
  perform gs_settle();
  return jsonb_build_object('now', now(), 'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind,
      'data', n.data, 'read', n.read, 'at', n.created_at,
      'project', case when p.id is null then null else jsonb_build_object('slug', p.slug, 'title', p.title, 'cover', p.cover_path,
          'seed', p.cover_seed, 'category', p.category, 'currency', p.currency, 'pledged', p.pledged_cents) end,
      'actor', case when n.actor_id is null then null else gs_user_json(n.actor_id) end) order by n.created_at desc, n.id desc)
    from (select * from notifications where user_id = uid order by created_at desc, id desc limit 100) n
    left join projects p on p.id = n.project_id), '[]'));
end $$;

create function public.gs_notifications_read(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token);
begin
  update notifications set read = true where user_id = uid and not read;
  return '{}'::jsonb;
end $$;

-- ============================================================ moderation (users with is_admin)

create function public.gs_admin_uid(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token);
begin
  if not exists (select 1 from users where id = uid and is_admin) then raise exception 'Admins only.'; end if;
  return uid;
end $$;

create function public.gs_admin(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token);
begin
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'at', r.created_at, 'resolved', r.resolved,
        'by', gs_user_json(r.user_id), 'project', jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'hidden', p.hidden))
        order by r.resolved, r.created_at desc) from reports r join projects p on p.id = r.project_id), '[]'),
    'projects', coalesce((select jsonb_agg(gs_card(p, uid) order by p.status = 'live' desc, p.launched_at desc)
        from projects p where p.status <> 'draft'), '[]'),
    'stats', jsonb_build_object('users', (select count(*) from users where deleted_at is null and not sample),
        'samples', (select count(*) from projects where sample)));
end $$;

create function public.gs_admin_set(p_token text, p_project uuid, p_field text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token);
begin
  if p_field = 'featured' then update projects set featured = p_on where id = p_project;
  elsif p_field = 'hidden' then update projects set hidden = p_on where id = p_project;
  else raise exception 'Unknown setting.'; end if;
  return '{}'::jsonb;
end $$;

create function public.gs_admin_resolve(p_token text, p_report bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token);
begin
  update reports set resolved = true where id = p_report;
  return '{}'::jsonb;
end $$;

create function public.gs_admin_remove_samples(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token); n int;
begin
  delete from pledges where backer_id in (select id from users where sample);
  delete from comments where user_id in (select id from users where sample);
  delete from projects where sample;
  get diagnostics n = row_count;
  delete from users where sample and not exists (select 1 from projects where creator_id = users.id);
  return jsonb_build_object('removed', n);
end $$;

-- ============================================================ grants

revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke execute on all functions in schema public from anon, authenticated, public;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[
    'gs_signup','gs_login','gs_logout','gs_me','gs_profile_save','gs_password_change','gs_password_reset','gs_recovery_new',
    'gs_account_delete','gs_home','gs_explore','gs_project','gs_comments','gs_user','gs_mine','gs_project_new','gs_project_edit',
    'gs_project_save','gs_project_launch','gs_project_cancel','gs_project_delete','gs_reward_save','gs_reward_delete',
    'gs_upload_ticket','gs_ticket_ok','gs_dashboard','gs_update_post','gs_update_delete','gs_pledge','gs_pledge_cancel',
    'gs_save','gs_comment_post','gs_comment_delete','gs_report','gs_notifications','gs_notifications_read',
    'gs_admin','gs_admin_set','gs_admin_resolve','gs_admin_remove_samples'])
  loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
