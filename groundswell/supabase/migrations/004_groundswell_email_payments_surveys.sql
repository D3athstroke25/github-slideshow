-- Email notifications, real payments through Stripe, and shipping surveys.
--
-- Payments and email stay off until their keys are added: the `gs` Edge Function reports what is
-- configured (settings email_ready / stripe_ready), and an admin switches payments from "test" to
-- "stripe" in Moderation. A project keeps the payment mode it launched with, so test pledges
-- never turn into real charges.

-- ============================================================ tables

create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values
  ('payments', '"test"'), ('fee_bps', '800'), ('email_ready', 'false'), ('stripe_ready', 'false')
on conflict (key) do nothing;

alter table public.users
  add column email             text check (email is null or char_length(email) <= 254),
  add column email_verified_at timestamptz,
  add column email_notify      boolean not null default true,
  add column stripe_customer_id text,
  add column stripe_account_id  text,
  add column stripe_ready       boolean not null default false;
create index users_stripe_account on public.users (stripe_account_id) where stripe_account_id is not null;

-- One-time codes: confirming an email address, and password resets by email.
create table public.email_codes (
  user_id    uuid not null references public.users on delete cascade,
  purpose    text not null check (purpose in ('verify', 'reset')),
  email      text not null,
  code_hash  bytea not null,
  attempts   int not null default 0,
  expires_at timestamptz not null,
  primary key (user_id, purpose)
);

-- Emails waiting to be sent by the worker.
create table public.outbox (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.users on delete cascade,
  to_email   text not null,
  template   text not null,
  data       jsonb not null default '{}'::jsonb,
  status     text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  locked_at  timestamptz,
  sent_at    timestamptz
);
create index outbox_status on public.outbox (status, created_at);
create index outbox_user on public.outbox (user_id);

alter table public.projects
  add column payments       text not null default 'test' check (payments in ('test', 'stripe')),
  add column survey_sent_at timestamptz;

alter table public.pledges
  add column stripe_pm       text,
  add column card_brand      text,
  add column card_last4      text,
  add column stripe_pi       text,
  add column charge_status   text check (charge_status is null or charge_status in ('due', 'processing', 'paid', 'failed', 'abandoned')),
  add column charge_error    text,
  add column charge_attempts int not null default 0,
  add column charged_at      timestamptz,
  add column fix_by          timestamptz;
create index pledges_charge on public.pledges (charge_status, updated_at) where charge_status is not null;

-- A pledge on a Stripe project that is waiting for the backer to save a card at Stripe Checkout.
-- It becomes a real pledge (and counts toward the goal) once the card is saved.
create table public.pledge_intents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects on delete cascade,
  backer_id    uuid not null references public.users on delete cascade,
  reward_id    uuid references public.rewards on delete cascade,
  amount_cents bigint not null,
  session_id   text,
  created_at   timestamptz not null default now(),
  unique (project_id, backer_id)
);
create index pledge_intents_backer on public.pledge_intents (backer_id);
create index pledge_intents_reward on public.pledge_intents (reward_id);

-- Shipping addresses from backer surveys. Visible only to the backer and the project's creator.
create table public.addresses (
  pledge_id  uuid primary key references public.pledges on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.settings       enable row level security;
alter table public.email_codes    enable row level security;
alter table public.outbox         enable row level security;
alter table public.pledge_intents enable row level security;
alter table public.addresses      enable row level security;

-- ============================================================ settings

create function public.gs_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select value from settings where key = p_key
$$;

create function public.gs_flag(p_key text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce((select (value #>> '{}')::boolean from settings where key = p_key), false)
$$;

-- Payment mode new launches get: "stripe" only while Stripe is actually configured.
create function public.gs_payments_mode() returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select case when gs_setting('payments') #>> '{}' = 'stripe' and gs_flag('stripe_ready') then 'stripe' else 'test' end
$$;

create function public.gs_config() returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('payments', gs_payments_mode(), 'fee_bps', coalesce((gs_setting('fee_bps') #>> '{}')::int, 800),
    'email', gs_flag('email_ready'), 'stripe', gs_flag('stripe_ready'), 'now', now())
$$;

-- Asks the worker to run now (used for time-sensitive emails). Never fails the caller.
create function public.gs_kick() returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare url text := gs_setting('worker_url') #>> '{}';
begin
  if url is null or not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  execute $q$select net.http_post(url := $1, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'gs_worker_secret')))$q$ using url;
exception when others then
  null;
end $$;

-- ============================================================ updated JSON shapes

create or replace function public.gs_me_json(p_uid uuid) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'name', u.display_name, 'bio', u.bio,
    'location', u.location, 'avatar', u.avatar_path, 'show_backed', u.show_backed, 'admin', u.is_admin,
    'joined', u.created_at,
    'email', case when u.email_verified_at is not null then u.email end,
    'email_pending', (select c.email from email_codes c where c.user_id = u.id and c.purpose = 'verify' and c.expires_at > now()),
    'email_notify', u.email_notify,
    'stripe', jsonb_build_object('connected', u.stripe_account_id is not null, 'ready', u.stripe_ready))
  from users u where u.id = p_uid
$$;

create or replace function public.gs_card(p public.projects, p_viewer uuid) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'blurb', p.blurb, 'category', p.category,
    'location', p.location, 'cover', p.cover_path, 'seed', p.cover_seed, 'currency', p.currency,
    'goal', p.goal_cents, 'pledged', p.pledged_cents, 'backers', p.backers_count, 'status', p.status,
    'launched_at', p.launched_at, 'deadline', p.deadline, 'ended_at', p.ended_at,
    'duration', p.duration_days, 'sample', p.sample, 'featured', p.featured, 'hidden', p.hidden,
    'payments', case when p.status = 'draft' then gs_payments_mode() else p.payments end,
    'creator', gs_user_json(p.creator_id),
    'saved', p_viewer is not null and exists (select 1 from saves s where s.user_id = p_viewer and s.project_id = p.id))
$$;

create or replace function public.gs_pledge_json(x public.pledges) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', x.id, 'amount', x.amount_cents, 'shipping', x.shipping_cents,
    'reward_id', x.reward_id, 'reward', r.title, 'ships', coalesce(r.ships, false),
    'status', x.status, 'backer_no', x.backer_no, 'created_at', x.created_at, 'updated_at', x.updated_at,
    'card', case when x.stripe_pm is not null then jsonb_build_object('brand', x.card_brand, 'last4', x.card_last4) end,
    'charge_status', x.charge_status, 'charge_error', x.charge_error, 'fix_by', x.fix_by,
    'has_address', exists (select 1 from addresses a where a.pledge_id = x.id))
  from (select 1) one left join rewards r on r.id = x.reward_id
$$;

-- ============================================================ settlement (adds charging for Stripe projects)

create or replace function public.gs_settle() returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r record; res text;
begin
  for r in select id, creator_id, pledged_cents, goal_cents, payments from projects
           where status = 'live' and deadline <= now() for update skip locked loop
    res := case when r.pledged_cents >= r.goal_cents then 'successful' else 'unsuccessful' end;
    update projects set status = res, ended_at = deadline, updated_at = now() where id = r.id and status = 'live';
    update pledges set status = case when res = 'successful' then 'collected' else 'dropped' end,
      charge_status = case when res = 'successful' and r.payments = 'stripe' and stripe_pm is not null then 'due' end,
      updated_at = now()
      where project_id = r.id and status = 'active';
    insert into notifications (user_id, kind, project_id, data)
      values (r.creator_id, 'ended', r.id, jsonb_build_object('result', res, 'role', 'creator', 'payments', r.payments));
    insert into notifications (user_id, kind, project_id, data)
      select backer_id, 'ended', r.id, jsonb_build_object('result', res, 'role', 'backer', 'payments', r.payments)
      from pledges where project_id = r.id and status in ('collected', 'dropped');
  end loop;

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

-- ============================================================ email

create function public.gs_six_digits() returns text language sql volatile set search_path = public, extensions, pg_temp as $$
  select lpad(((get_byte(b, 0)::bigint << 24 | get_byte(b, 1) << 16 | get_byte(b, 2) << 8 | get_byte(b, 3)) % 1000000)::text, 6, '0')
  from (select gen_random_bytes(4) b) x
$$;

create function public.gs_email_set(p_token text, p_email text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); e text := lower(trim(coalesce(p_email, ''))); code text := gs_six_digits();
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(e) > 254 then raise exception 'That doesn''t look like an email address.'; end if;
  if not gs_throttle('emailcode:' || uid, 5, interval '1 hour') then raise exception 'Too many codes requested. Please wait an hour.'; end if;
  insert into email_codes (user_id, purpose, email, code_hash, expires_at)
    values (uid, 'verify', e, digest(code, 'sha256'), now() + interval '30 minutes')
    on conflict (user_id, purpose) do update set email = excluded.email, code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at;
  insert into outbox (user_id, to_email, template, data)
    values (uid, e, 'verify', jsonb_build_object('code', code, 'name', (select display_name from users where id = uid)));
  perform gs_kick();
  return jsonb_build_object('pending', e, 'email_ready', gs_flag('email_ready'));
end $$;

-- Wrong codes return {error} so the attempt counter is kept.
create function public.gs_email_verify(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); c email_codes;
begin
  select * into c from email_codes where user_id = uid and purpose = 'verify';
  if c.user_id is null or c.expires_at < now() then return jsonb_build_object('error', 'That code has expired. Send a new one.'); end if;
  if c.attempts >= 5 then return jsonb_build_object('error', 'Too many wrong codes. Send a new one.'); end if;
  if c.code_hash <> digest(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256') then
    update email_codes set attempts = attempts + 1 where user_id = uid and purpose = 'verify';
    return jsonb_build_object('error', 'That code isn''t right. Check the latest email.');
  end if;
  update users set email = c.email, email_verified_at = now() where id = uid;
  delete from email_codes where user_id = uid and purpose = 'verify';
  return jsonb_build_object('me', gs_me_json(uid));
end $$;

create function public.gs_email_remove(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token);
begin
  update users set email = null, email_verified_at = null where id = uid;
  delete from email_codes where user_id = uid;
  update outbox set status = 'skipped' where user_id = uid and status = 'queued';
  return jsonb_build_object('me', gs_me_json(uid));
end $$;

-- Sends a reset code to the account's confirmed email. Always answers the same way, so it
-- doesn't reveal which usernames exist or have an email.
create function public.gs_reset_request(p_username text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r users; code text;
begin
  select * into r from users where username = lower(trim(coalesce(p_username, ''))) and deleted_at is null;
  if r.id is not null and r.email_verified_at is not null and gs_throttle('resetmail:' || r.id, 3, interval '1 hour')
     and gs_throttle('resetmail-ip:' || gs_ip(), 20, interval '1 hour') then
    code := left(replace(gs_new_code(), '-', ''), 8);
    insert into email_codes (user_id, purpose, email, code_hash, expires_at)
      values (r.id, 'reset', r.email, gs_code_hash(code), now() + interval '30 minutes')
      on conflict (user_id, purpose) do update set email = excluded.email, code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at;
    insert into outbox (user_id, to_email, template, data)
      values (r.id, r.email, 'reset', jsonb_build_object('code', code, 'username', r.username, 'name', r.display_name));
    perform gs_kick();
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Reset with either the recovery code from sign-up or a code emailed by gs_reset_request.
create or replace function public.gs_password_reset(p_username text, p_code text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r users; code text := gs_new_code(); ec email_codes; by_email boolean := false;
begin
  if char_length(coalesce(p_new, '')) < 8 then return jsonb_build_object('error', 'Use at least 8 characters for your new password.'); end if;
  if char_length(p_new) > 72 then return jsonb_build_object('error', 'Passwords can be at most 72 characters.'); end if;
  select * into r from users where username = lower(trim(coalesce(p_username, ''))) and deleted_at is null;
  if r.id is null then return jsonb_build_object('error', 'That username and code don''t match.'); end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('error', 'Too many attempts. This account is locked for 15 minutes.');
  end if;
  if r.recovery_hash is null or r.recovery_hash <> gs_code_hash(p_code) then
    select * into ec from email_codes where user_id = r.id and purpose = 'reset' and expires_at > now() and attempts < 5;
    if ec.user_id is not null and ec.code_hash = gs_code_hash(p_code) then
      by_email := true;
    else
      update email_codes set attempts = attempts + 1 where user_id = r.id and purpose = 'reset';
      update users set failed_logins = case when failed_logins >= 9 then 0 else failed_logins + 1 end,
                       locked_until = case when failed_logins >= 9 then now() + interval '15 minutes' else locked_until end
        where id = r.id;
      return jsonb_build_object('error', 'That username and code don''t match.');
    end if;
  end if;
  update users set pw_hash = crypt(p_new, gen_salt('bf', 10)), failed_logins = 0, locked_until = null,
    recovery_hash = case when by_email then recovery_hash else gs_code_hash(code) end
    where id = r.id;
  delete from email_codes where user_id = r.id and purpose = 'reset';
  delete from sessions where user_id = r.id;
  return jsonb_build_object('token', gs_session(r.id), 'recovery', case when by_email then null else code end, 'me', gs_me_json(r.id));
end $$;

create or replace function public.gs_profile_save(p_token text, p_patch jsonb) returns jsonb
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
  if p_patch ? 'email_notify' then u.email_notify := coalesce((p_patch->>'email_notify')::boolean, true); end if;
  if p_patch ? 'avatar' then
    u.avatar_path := nullif(p_patch->>'avatar', '');
    if u.avatar_path is not null and not exists (select 1 from uploads where path = u.avatar_path and user_id = uid) then
      raise exception 'That image upload was not found. Please try again.';
    end if;
  end if;
  update users set display_name = u.display_name, bio = u.bio, location = u.location, show_backed = u.show_backed,
    email_notify = u.email_notify, avatar_path = u.avatar_path where id = uid;
  return gs_me_json(uid);
end $$;

-- Every notification for someone with a confirmed email (and emails turned on) is queued as an email.
create function public.gs_notify_email() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u users;
begin
  select * into u from users where id = new.user_id;
  if u.email is null or u.email_verified_at is null or not u.email_notify or u.deleted_at is not null or u.sample then return null; end if;
  insert into outbox (user_id, to_email, template, data)
  values (new.user_id, u.email, 'notification', jsonb_build_object(
    'kind', new.kind, 'data', new.data, 'name', u.display_name,
    'actor', (select a.display_name from users a where a.id = new.actor_id),
    'project', (select jsonb_build_object('title', p.title, 'slug', p.slug, 'currency', p.currency, 'pledged', p.pledged_cents)
                from projects p where p.id = new.project_id)));
  return null;
end $$;

create trigger notifications_email after insert on public.notifications
  for each row execute function public.gs_notify_email();

-- ============================================================ backing (adds the Stripe card step)

-- The original gs_pledge body, callable for any user. With p_check_only it validates and stops.
create function public.gs_pledge_apply(p_uid uuid, p_project uuid, p_reward uuid, p_amount bigint, p_check_only boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := p_uid; p projects; r rewards; x pledges; minimum bigint := 100; ship bigint := 0;
  before_pct numeric; after_pct numeric; m numeric; first_time boolean;
begin
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
  if p_check_only then return '{}'::jsonb; end if;
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

-- On a Stripe project, a backer without a saved card gets an intent instead of a pledge:
-- {needs_card: true, intent}. The app sends them to Stripe Checkout, and the pledge is made
-- when the card is saved (gs_pay_intent_complete).
create or replace function public.gs_pledge(p_token text, p_project uuid, p_reward uuid default null, p_amount bigint default 0) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); p projects; card text; iid uuid;
begin
  perform gs_settle();
  select * into p from projects where id = p_project;
  if p.id is not null and p.payments = 'stripe' then
    select stripe_pm into card from pledges where project_id = p.id and backer_id = uid;
    if card is null then
      perform gs_pledge_apply(uid, p_project, p_reward, p_amount, true);
      insert into pledge_intents (project_id, backer_id, reward_id, amount_cents)
        values (p.id, uid, p_reward, p_amount)
        on conflict (project_id, backer_id) do update set reward_id = excluded.reward_id, amount_cents = excluded.amount_cents,
          session_id = null, created_at = now()
        returning id into iid;
      return jsonb_build_object('needs_card', true, 'intent', iid);
    end if;
  end if;
  return gs_pledge_apply(uid, p_project, p_reward, p_amount, false);
end $$;

-- ============================================================ surveys

create function public.gs_survey_send(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project); n int;
begin
  if p.status <> 'successful' then raise exception 'Surveys can be sent once your project is funded.'; end if;
  if p.survey_sent_at is not null then raise exception 'The survey was already sent.'; end if;
  insert into notifications (user_id, kind, project_id)
    select x.backer_id, 'survey', p.id from pledges x join rewards r on r.id = x.reward_id
    where x.project_id = p.id and x.status = 'collected' and r.ships and coalesce(x.charge_status, 'paid') not in ('abandoned');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'None of your backers chose a reward that ships.'; end if;
  update projects set survey_sent_at = now() where id = p.id;
  return jsonb_build_object('sent', n);
end $$;

create function public.gs_address_save(p_token text, p_project uuid, p_address jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); x pledges; ships boolean; a jsonb; k text;
begin
  select * into x from pledges where project_id = p_project and backer_id = uid and status <> 'canceled';
  if x.id is null then raise exception 'You haven''t backed this project.'; end if;
  select r.ships into ships from rewards r where r.id = x.reward_id;
  if not coalesce(ships, false) then raise exception 'Your reward doesn''t ship, so no address is needed.'; end if;
  if jsonb_typeof(p_address) <> 'object' then raise exception 'Please fill in your address.'; end if;
  a := jsonb_build_object(
    'name', left(trim(coalesce(p_address->>'name', '')), 100), 'line1', left(trim(coalesce(p_address->>'line1', '')), 200),
    'line2', left(trim(coalesce(p_address->>'line2', '')), 200), 'city', left(trim(coalesce(p_address->>'city', '')), 100),
    'region', left(trim(coalesce(p_address->>'region', '')), 100), 'postal', left(trim(coalesce(p_address->>'postal', '')), 20),
    'country', left(trim(coalesce(p_address->>'country', '')), 60), 'phone', left(trim(coalesce(p_address->>'phone', '')), 30));
  foreach k in array array['name', 'line1', 'city', 'country'] loop
    if a->>k = '' then raise exception 'Please fill in your %.', case k when 'line1' then 'street address' else k end; end if;
  end loop;
  insert into addresses (pledge_id, data) values (x.id, a)
    on conflict (pledge_id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('address', a);
end $$;

-- ============================================================ project page, launch, dashboard

create or replace function public.gs_project(p_token text default null, p_slug text default '', p_preview text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid; p projects; me_pledge pledges; is_creator boolean; is_backer boolean; addr jsonb; ships boolean;
begin
  perform gs_settle();
  v := gs_uid_opt(p_token);
  select * into p from projects where slug = lower(coalesce(p_slug, ''));
  if not gs_can_see(p, v, p_preview) then raise exception 'We couldn''t find that project.' using hint = 'notfound'; end if;
  is_creator := coalesce(p.creator_id = v, false);
  is_backer := gs_is_backer(p.id, v);
  select * into me_pledge from pledges where project_id = p.id and backer_id = v;
  if me_pledge.id is not null then
    select a.data into addr from addresses a where a.pledge_id = me_pledge.id;
    select r.ships into ships from rewards r where r.id = me_pledge.reward_id;
  end if;
  return jsonb_build_object(
    'now', now(),
    'project', gs_card(p, v) || jsonb_build_object('story', p.story, 'risks', p.risks, 'faqs', p.faqs,
        'video', p.video_url, 'created_at', p.created_at, 'survey_sent', p.survey_sent_at is not null,
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
        'pledge', case when me_pledge.id is null then null else gs_pledge_json(me_pledge) end,
        'address', addr,
        'needs_address', p.survey_sent_at is not null and coalesce(ships, false) and addr is null
                         and me_pledge.status = 'collected' and coalesce(me_pledge.charge_status, 'paid') <> 'abandoned')
  );
end $$;

create or replace function public.gs_checklist(p projects) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'title',   'step', 'basics',  'label', 'Give your project a title',            'ok', char_length(trim(p.title)) >= 4),
    jsonb_build_object('key', 'blurb',   'step', 'basics',  'label', 'Write a one-line subtitle',            'ok', char_length(trim(p.blurb)) >= 10),
    jsonb_build_object('key', 'goal',    'step', 'basics',  'label', 'Set a funding goal and duration',      'ok', p.goal_cents >= 100 and p.duration_days between 1 and 60),
    jsonb_build_object('key', 'rewards', 'step', 'rewards', 'label', 'Offer at least one reward',            'ok', exists (select 1 from rewards r where r.project_id = p.id)),
    jsonb_build_object('key', 'story',   'step', 'story',   'label', 'Tell your story (150+ characters)',    'ok', char_length(trim(p.story)) >= 150),
    jsonb_build_object('key', 'risks',   'step', 'story',   'label', 'Explain the risks and challenges',     'ok', char_length(trim(p.risks)) >= 30))
  || case when p.status = 'draft' and gs_payments_mode() = 'stripe' then jsonb_build_array(
    jsonb_build_object('key', 'payouts', 'step', 'payouts', 'label', 'Connect Stripe so you can get paid',
      'ok', exists (select 1 from users u where u.id = p.creator_id and u.stripe_ready))) else '[]'::jsonb end
$$;

create or replace function public.gs_project_launch(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects := gs_own(p_token, p_project); missing text;
begin
  if p.status <> 'draft' then raise exception 'This project has already launched.'; end if;
  select string_agg(lower(e->>'label'), ', ') into missing from jsonb_array_elements(gs_checklist(p)) e where not (e->>'ok')::boolean;
  if missing is not null then raise exception 'Almost there. Still to do: %.', missing; end if;
  update projects set status = 'live', launched_at = now(), deadline = now() + make_interval(days => duration_days),
    payments = gs_payments_mode(), updated_at = now()
    where id = p.id;
  return gs_editor_json(p.id);
end $$;

create or replace function public.gs_dashboard(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects;
begin
  perform gs_settle();
  p := gs_own(p_token, p_project);
  if p.status = 'draft' then raise exception 'The dashboard opens once your project launches.'; end if;
  return jsonb_build_object(
    'now', now(),
    'project', gs_editor_json(p.id) || jsonb_build_object('survey_sent_at', p.survey_sent_at),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'pledged', c, 'backers', b) order by d) from (
        select d, sum(sc) over (order by d) c, sum(sb) over (order by d) b from (
          select date_trunc('day', at)::date d, sum(delta_cents) sc, sum(delta_backers) sb
          from pledge_events where project_id = p.id group by 1) x) y), '[]'),
    'backers', coalesce((select jsonb_agg(jsonb_build_object('no', x.backer_no, 'user', gs_user_json(x.backer_id),
        'reward', r.title, 'ships', coalesce(r.ships, false), 'amount', x.amount_cents, 'shipping', x.shipping_cents,
        'status', x.status, 'at', x.created_at, 'charge', x.charge_status, 'charge_error', x.charge_error,
        'address', a.data) order by x.backer_no desc)
        from pledges x left join rewards r on r.id = x.reward_id left join addresses a on a.pledge_id = x.id
        where x.project_id = p.id and x.status <> 'canceled'), '[]'),
    'canceled', (select count(*) from pledges where project_id = p.id and status = 'canceled'),
    'no_reward', (select count(*) from pledges where project_id = p.id and status <> 'canceled' and reward_id is null),
    'saves', (select count(*) from saves where project_id = p.id),
    'comments', (select count(*) from comments where project_id = p.id and not deleted),
    'survey', jsonb_build_object('sent_at', p.survey_sent_at,
        'shipping', (select count(*) from pledges x join rewards r on r.id = x.reward_id where x.project_id = p.id and x.status <> 'canceled' and r.ships),
        'answered', (select count(*) from pledges x join addresses a on a.pledge_id = x.id where x.project_id = p.id and x.status <> 'canceled')),
    'payments', jsonb_build_object('mode', p.payments, 'fee_bps', coalesce((gs_setting('fee_bps') #>> '{}')::int, 800),
        'paid', (select coalesce(sum(amount_cents), 0) from pledges where project_id = p.id and charge_status = 'paid'),
        'paid_count', (select count(*) from pledges where project_id = p.id and charge_status = 'paid'),
        'pending_count', (select count(*) from pledges where project_id = p.id and charge_status in ('due', 'processing')),
        'failed_count', (select count(*) from pledges where project_id = p.id and charge_status = 'failed'),
        'abandoned_count', (select count(*) from pledges where project_id = p.id and charge_status = 'abandoned')),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'n', u.n, 'title', u.title, 'body', u.body,
        'backers_only', u.backers_only, 'created_at', u.created_at) order by u.n desc) from updates u where u.project_id = p.id), '[]')
  );
end $$;

create or replace function public.gs_account_delete(p_token text, p_password text) returns jsonb
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
  delete from addresses where pledge_id in (select id from pledges where backer_id = uid);
  delete from pledge_intents where backer_id = uid;
  update comments set deleted = true, body = '' where user_id = uid;
  delete from saves where user_id = uid;
  delete from notifications where user_id = uid;
  delete from sessions where user_id = uid;
  delete from email_codes where user_id = uid;
  delete from outbox where user_id = uid and status in ('queued', 'failed');
  update users set username = 'deleted_' || substr(replace(id::text, '-', ''), 1, 12), display_name = 'Deleted user',
    pw_hash = '!', recovery_hash = null, bio = '', location = '', avatar_path = null, show_backed = false,
    email = null, email_verified_at = null, stripe_customer_id = null, deleted_at = now() where id = uid;
  return '{}'::jsonb;
end $$;

-- ============================================================ moderation settings

create or replace function public.gs_admin(p_token text) returns jsonb
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
        'samples', (select count(*) from projects where sample)),
    'settings', jsonb_build_object('payments', gs_setting('payments') #>> '{}', 'fee_bps', (gs_setting('fee_bps') #>> '{}')::int,
        'email_ready', gs_flag('email_ready'), 'stripe_ready', gs_flag('stripe_ready'),
        'emails_queued', (select count(*) from outbox where status in ('queued', 'sending')),
        'emails_failed', (select count(*) from outbox where status = 'failed' and created_at > now() - interval '7 days'),
        'charges_failed', (select count(*) from pledges where charge_status = 'failed')));
end $$;

create function public.gs_admin_settings(p_token text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token); fee int;
begin
  if p_patch ? 'payments' then
    if p_patch->>'payments' not in ('test', 'stripe') then raise exception 'Unknown payment mode.'; end if;
    if p_patch->>'payments' = 'stripe' and not gs_flag('stripe_ready') then
      raise exception 'Add your Stripe keys first. The worker reports Stripe as ready within a minute of that.';
    end if;
    insert into settings (key, value) values ('payments', to_jsonb(p_patch->>'payments'))
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  if p_patch ? 'fee_bps' then
    fee := (p_patch->>'fee_bps')::int;
    if fee is null or fee not between 0 and 3000 then raise exception 'The fee must be between 0%% and 30%%.'; end if;
    insert into settings (key, value) values ('fee_bps', to_jsonb(fee))
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return gs_admin(p_token);
exception when invalid_text_representation then
  raise exception 'Please enter a valid number.';
end $$;

-- ============================================================ for the `gs` Edge Function (service role only)

create function public.gs_svc_user(p_token text) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'name', u.display_name,
    'email', case when u.email_verified_at is not null then u.email end,
    'customer', u.stripe_customer_id, 'account', u.stripe_account_id, 'ready', u.stripe_ready)
  from users u where u.id = gs_uid_opt(p_token)
$$;

create function public.gs_svc_set_customer(p_uid uuid, p_customer text) returns void
language sql security definer set search_path = public, extensions, pg_temp as $$
  update users set stripe_customer_id = p_customer where id = p_uid;
$$;

create function public.gs_svc_set_account(p_uid uuid, p_account text, p_ready boolean) returns void
language sql security definer set search_path = public, extensions, pg_temp as $$
  update users set stripe_account_id = p_account, stripe_ready = coalesce(p_ready, false) where id = p_uid;
$$;

create function public.gs_svc_account_ready(p_account text, p_ready boolean) returns void
language sql security definer set search_path = public, extensions, pg_temp as $$
  update users set stripe_ready = coalesce(p_ready, false) where stripe_account_id = p_account;
$$;

-- What Checkout needs for an intent (new pledge) or for a pledge whose card needs replacing.
create function public.gs_svc_checkout_target(p_uid uuid, p_intent uuid, p_pledge uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare t jsonb;
begin
  if p_intent is not null then
    select jsonb_build_object('kind', 'intent', 'id', i.id, 'amount', i.amount_cents, 'currency', p.currency, 'title', p.title,
        'slug', p.slug, 'reward', r.title, 'session', i.session_id)
      into t from pledge_intents i join projects p on p.id = i.project_id left join rewards r on r.id = i.reward_id
      where i.id = p_intent and i.backer_id = p_uid and p.status = 'live';
  else
    select jsonb_build_object('kind', 'fix', 'id', x.id, 'amount', x.amount_cents, 'currency', p.currency, 'title', p.title,
        'slug', p.slug, 'reward', r.title, 'charge_status', x.charge_status)
      into t from pledges x join projects p on p.id = x.project_id left join rewards r on r.id = x.reward_id
      where x.id = p_pledge and x.backer_id = p_uid and p.payments = 'stripe'
        and ((x.status = 'active' and p.status = 'live') or (x.charge_status = 'failed' and x.fix_by > now()));
  end if;
  return t;
end $$;

create function public.gs_svc_intent_session(p_intent uuid, p_session text) returns void
language sql security definer set search_path = public, extensions, pg_temp as $$
  update pledge_intents set session_id = p_session where id = p_intent;
$$;

-- A card was saved for an intent: make the pledge. Safe to call twice (app return and webhook).
create function public.gs_svc_intent_complete(p_intent uuid, p_customer text, p_pm text, p_brand text, p_last4 text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare i pledge_intents; r jsonb;
begin
  select * into i from pledge_intents where id = p_intent for update;
  if i.id is null then return jsonb_build_object('done', true); end if;
  update users set stripe_customer_id = coalesce(stripe_customer_id, p_customer) where id = i.backer_id;
  r := gs_pledge_apply(i.backer_id, i.project_id, i.reward_id, i.amount_cents, false);
  update pledges set stripe_pm = p_pm, card_brand = p_brand, card_last4 = p_last4, updated_at = now()
    where project_id = i.project_id and backer_id = i.backer_id;
  delete from pledge_intents where id = i.id;
  return r || jsonb_build_object('slug', (select slug from projects where id = i.project_id),
    'pledge', (select gs_pledge_json(x) from pledges x where x.project_id = i.project_id and x.backer_id = i.backer_id));
end $$;

-- A new card for an existing pledge. If the last charge failed, it is retried.
create function public.gs_svc_card_update(p_pledge uuid, p_pm text, p_brand text, p_last4 text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  update pledges set stripe_pm = p_pm, card_brand = p_brand, card_last4 = p_last4, charge_error = null,
    charge_status = case when charge_status = 'failed' then 'due' else charge_status end, updated_at = now()
    where id = p_pledge;
  return (select gs_pledge_json(x) || jsonb_build_object('slug', p.slug) from pledges x join projects p on p.id = x.project_id where x.id = p_pledge);
end $$;

-- Claim pledges to charge. A claim left "processing" for 15 minutes is retried; Stripe idempotency
-- keys (pledge + card) make a repeat request return the original charge instead of a new one.
create function public.gs_svc_charges_claim(p_limit int) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ids uuid[]; fee int := coalesce((gs_setting('fee_bps') #>> '{}')::int, 800);
begin
  select array_agg(id) into ids from (
    select x.id from pledges x
    where x.charge_status = 'due' or (x.charge_status = 'processing' and x.updated_at < now() - interval '15 minutes')
    order by x.updated_at limit p_limit for update skip locked) c;
  if ids is null then return '[]'::jsonb; end if;
  update pledges set charge_status = 'processing', charge_attempts = charge_attempts + 1, updated_at = now() where id = any (ids);
  return coalesce((select jsonb_agg(jsonb_build_object('pledge', x.id, 'amount', x.amount_cents, 'currency', lower(p.currency),
      'customer', b.stripe_customer_id, 'pm', x.stripe_pm, 'destination', c.stripe_account_id,
      'fee', floor(x.amount_cents * fee / 10000.0)::bigint, 'title', p.title, 'slug', p.slug, 'backer_no', x.backer_no,
      'attempts', x.charge_attempts))
    from pledges x join projects p on p.id = x.project_id join users b on b.id = x.backer_id join users c on c.id = p.creator_id
    where x.id = any (ids)), '[]'::jsonb);
end $$;

-- p_result: paid | failed (card problem: backer has 7 days to fix it) | retry (temporary error)
create function public.gs_svc_charge_done(p_pledge uuid, p_result text, p_pi text, p_error text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare x pledges;
begin
  select * into x from pledges where id = p_pledge for update;
  if x.id is null or x.charge_status = 'paid' then return; end if;
  if p_result = 'paid' then
    update pledges set charge_status = 'paid', charged_at = now(), stripe_pi = coalesce(p_pi, stripe_pi), charge_error = null,
      updated_at = now() where id = x.id;
    insert into notifications (user_id, kind, project_id, data) values (x.backer_id, 'charged', x.project_id, jsonb_build_object('amount', x.amount_cents));
  elsif p_result = 'retry' and x.charge_attempts < 5 then
    update pledges set charge_status = 'due', charge_error = left(p_error, 300), updated_at = now() where id = x.id;
  else
    update pledges set charge_status = 'failed', charge_error = left(coalesce(p_error, 'The card was declined.'), 300),
      stripe_pi = coalesce(p_pi, stripe_pi), fix_by = coalesce(fix_by, now() + interval '7 days'), updated_at = now() where id = x.id;
    insert into notifications (user_id, kind, project_id, data)
      values (x.backer_id, 'payment_failed', x.project_id, jsonb_build_object('amount', x.amount_cents, 'error', left(p_error, 200),
        'fix_by', coalesce(x.fix_by, now() + interval '7 days')));
  end if;
end $$;

create function public.gs_svc_charge_by_pi(p_pi text) returns uuid
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select id from pledges where stripe_pi = p_pi
$$;

create function public.gs_svc_emails_claim(p_limit int) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ids bigint[];
begin
  select array_agg(id) into ids from (
    select id from outbox where status = 'queued' or (status = 'sending' and locked_at < now() - interval '10 minutes')
    order by id limit p_limit for update skip locked) c;
  if ids is null then return '[]'::jsonb; end if;
  update outbox set status = 'sending', locked_at = now(), attempts = attempts + 1 where id = any (ids);
  return (select jsonb_agg(jsonb_build_object('id', o.id, 'to', o.to_email, 'template', o.template, 'data', o.data,
    'attempts', o.attempts) order by o.id) from outbox o where o.id = any (ids));
end $$;

create function public.gs_svc_email_done(p_id bigint, p_ok boolean, p_error text) returns void
language sql security definer set search_path = public, extensions, pg_temp as $$
  update outbox set
    status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'queued' end,
    sent_at = case when p_ok then now() end, last_error = case when p_ok then null else left(p_error, 500) end,
    data = case when p_ok then data - 'code' else data end
  where id = p_id;
$$;

-- Worker bookkeeping: report which services are configured, expire unfixed failed charges and
-- abandoned checkouts, and tidy old rows.
create function public.gs_svc_tick(p_email boolean, p_stripe boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n int;
begin
  insert into settings (key, value) values ('email_ready', to_jsonb(coalesce(p_email, false))), ('stripe_ready', to_jsonb(coalesce(p_stripe, false)))
    on conflict (key) do update set value = excluded.value, updated_at = now() where settings.value is distinct from excluded.value;
  perform gs_settle();
  update pledges set charge_status = 'abandoned', updated_at = now() where charge_status = 'failed' and fix_by < now();
  get diagnostics n = row_count;
  delete from pledge_intents where created_at < now() - interval '2 days';
  delete from outbox where status in ('sent', 'skipped') and created_at < now() - interval '30 days';
  delete from email_codes where expires_at < now() - interval '1 day';
  if not coalesce(p_email, false) then
    update outbox set status = 'skipped' where status = 'queued' and created_at < now() - interval '1 day';
  end if;
  return jsonb_build_object('abandoned', n);
end $$;

-- The worker is called by a scheduled job that sends the secret kept in Vault.
create function public.gs_svc_worker_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select p_secret is not null and p_secret <> ''
    and exists (select 1 from vault.decrypted_secrets where name = 'gs_worker_secret' and decrypted_secret = p_secret)
$$;

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
    'gs_admin','gs_admin_set','gs_admin_resolve','gs_admin_remove_samples',
    'gs_config','gs_email_set','gs_email_verify','gs_email_remove','gs_reset_request','gs_survey_send','gs_address_save',
    'gs_admin_settings'])
  loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'gs\_svc\_%'
  loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
