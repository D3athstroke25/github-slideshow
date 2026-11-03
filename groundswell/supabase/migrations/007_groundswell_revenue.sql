-- Revenue and risk:
--   * a $5 minimum pledge on projects with real payments, so Stripe's per-charge fee can't eat the platform fee
--   * an optional tip for Groundswell, charged with the pledge and kept by the platform
--   * creators can buy the home page's featured spot for a week (sold on the website, not in the iPhone app)
-- Refunds and disputes are pulled back from the creator's Stripe account by the gs Edge Function.
-- Needs 006.

-- ============================================================ tables

alter table public.pledges        add column tip_cents bigint not null default 0 check (tip_cents >= 0),
                                  add column fee_cents bigint; -- platform fee on the pledge, fixed when it's charged
alter table public.pledge_intents add column tip_cents bigint not null default 0 check (tip_cents >= 0);
alter table public.projects       add column featured_until timestamptz;

-- One row per paid featuring. The Checkout session id makes the app return and the webhook safe to repeat.
create table public.feature_purchases (
  session_id   text primary key,
  project_id   uuid not null references public.projects on delete cascade,
  buyer_id     uuid references public.users on delete set null,
  amount_cents bigint not null,
  currency     text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_at   timestamptz not null default now()
);
create index feature_purchases_project on public.feature_purchases (project_id);
alter table public.feature_purchases enable row level security;

insert into public.settings (key, value) values ('feature_price_cents', '4900'), ('feature_days', '7')
  on conflict (key) do nothing;

-- ============================================================ settings

-- Pledges on real-payment projects start at $5 (in the project's currency).
create function public.gs_min_pledge(p projects) returns bigint
language sql immutable set search_path = public, extensions, pg_temp as $$
  select case when p.payments = 'stripe' then 500 else 100 end::bigint
$$;

create or replace function public.gs_config() returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('payments', gs_payments_mode(), 'fee_bps', coalesce((gs_setting('fee_bps') #>> '{}')::int, 800),
    'email', gs_flag('email_ready'), 'stripe', gs_flag('stripe_ready'), 'now', now(),
    'feature_price', coalesce((gs_setting('feature_price_cents') #>> '{}')::int, 4900),
    'feature_days', coalesce((gs_setting('feature_days') #>> '{}')::int, 7))
$$;

-- ============================================================ pledges

create or replace function public.gs_pledge_json(x public.pledges) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', x.id, 'amount', x.amount_cents, 'shipping', x.shipping_cents, 'tip', x.tip_cents,
    'reward_id', x.reward_id, 'reward', r.title, 'ships', coalesce(r.ships, false),
    'status', x.status, 'backer_no', x.backer_no, 'created_at', x.created_at, 'updated_at', x.updated_at,
    'card', case when x.stripe_pm is not null then jsonb_build_object('brand', x.card_brand, 'last4', x.card_last4) end,
    'charge_status', x.charge_status, 'charge_error', x.charge_error, 'fix_by', x.fix_by,
    'has_address', exists (select 1 from addresses a where a.pledge_id = x.id))
  from (select 1) one left join rewards r on r.id = x.reward_id
$$;

-- The tip is kept apart from amount_cents: it never counts toward the goal or the creator's payout.
create function public.gs_tip_check(p_amount bigint, p_tip bigint, p_currency text) returns void
language plpgsql immutable set search_path = public, extensions, pg_temp as $$
begin
  if p_tip is null or p_tip < 0 then raise exception 'The tip can''t be negative.'; end if;
  if p_tip > greatest(p_amount / 4, 500) then raise exception 'Tips are limited to 25%% of your pledge.'; end if;
end $$;

drop function public.gs_pledge_apply(uuid, uuid, uuid, bigint, boolean);
create function public.gs_pledge_apply(p_uid uuid, p_project uuid, p_reward uuid, p_amount bigint, p_check_only boolean, p_tip bigint default 0) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := p_uid; p projects; r rewards; x pledges; minimum bigint; ship bigint := 0;
  before_pct numeric; after_pct numeric; m numeric; first_time boolean;
begin
  select * into p from projects where id = p_project for update;
  if p.id is null or p.status = 'draft' or p.hidden then raise exception 'We couldn''t find that project.' using hint = 'notfound'; end if;
  if p.status <> 'live' or p.deadline <= now() then raise exception 'This project is no longer taking pledges.'; end if;
  if p.creator_id = uid then raise exception 'You can''t back your own project.'; end if;
  minimum := gs_min_pledge(p);
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
    minimum := greatest(minimum, r.amount_cents + ship);
  end if;
  if p_amount is null or p_amount < minimum then
    raise exception 'The minimum pledge for this reward is %.', gs_money(minimum, p.currency);
  end if;
  if p_amount > 1000000 then raise exception 'Pledges are limited to % per project.', gs_money(1000000, p.currency); end if;
  perform gs_tip_check(p_amount, p_tip, p.currency);
  if p_check_only then return '{}'::jsonb; end if;
  if first_time and not gs_throttle('pledge:' || uid, 30, interval '1 hour') then
    raise exception 'That''s a lot of pledges in an hour. Please try again later.';
  end if;
  before_pct := gs_pct(p);
  if x.id is null then
    insert into pledges (project_id, backer_id, reward_id, amount_cents, shipping_cents, tip_cents, backer_no)
      values (p.id, uid, p_reward, p_amount, ship, p_tip, coalesce((select max(backer_no) from pledges where project_id = p.id), 0) + 1)
      returning * into x;
  else
    update pledges set reward_id = p_reward, amount_cents = p_amount, shipping_cents = ship, tip_cents = p_tip, status = 'active',
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

drop function public.gs_pledge(text, uuid, uuid, bigint);
create function public.gs_pledge(p_token text, p_project uuid, p_reward uuid default null, p_amount bigint default 0, p_tip bigint default 0) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); p projects; card text; iid uuid;
begin
  perform gs_settle();
  select * into p from projects where id = p_project;
  if p.id is not null and p.payments = 'stripe' then
    select stripe_pm into card from pledges where project_id = p.id and backer_id = uid;
    if card is null then
      perform gs_pledge_apply(uid, p_project, p_reward, p_amount, true, p_tip);
      insert into pledge_intents (project_id, backer_id, reward_id, amount_cents, tip_cents)
        values (p.id, uid, p_reward, p_amount, p_tip)
        on conflict (project_id, backer_id) do update set reward_id = excluded.reward_id, amount_cents = excluded.amount_cents,
          tip_cents = excluded.tip_cents, session_id = null, created_at = now()
        returning id into iid;
      return jsonb_build_object('needs_card', true, 'intent', iid);
    end if;
  end if;
  return gs_pledge_apply(uid, p_project, p_reward, p_amount, false, p_tip);
end $$;

create or replace function public.gs_svc_intent_complete(p_intent uuid, p_customer text, p_pm text, p_brand text, p_last4 text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare i pledge_intents; r jsonb;
begin
  select * into i from pledge_intents where id = p_intent for update;
  if i.id is null then return jsonb_build_object('done', true); end if;
  update users set stripe_customer_id = coalesce(stripe_customer_id, p_customer) where id = i.backer_id;
  r := gs_pledge_apply(i.backer_id, i.project_id, i.reward_id, i.amount_cents, false, i.tip_cents);
  update pledges set stripe_pm = p_pm, card_brand = p_brand, card_last4 = p_last4, updated_at = now()
    where project_id = i.project_id and backer_id = i.backer_id;
  delete from pledge_intents where id = i.id;
  return r || jsonb_build_object('slug', (select slug from projects where id = i.project_id),
    'pledge', (select gs_pledge_json(x) from pledges x where x.project_id = i.project_id and x.backer_id = i.backer_id));
end $$;

-- The amount shown at Checkout includes the tip.
create or replace function public.gs_svc_checkout_target(p_uid uuid, p_intent uuid, p_pledge uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare t jsonb;
begin
  if p_intent is not null then
    select jsonb_build_object('kind', 'intent', 'id', i.id, 'amount', i.amount_cents + i.tip_cents, 'currency', p.currency, 'title', p.title,
        'slug', p.slug, 'reward', r.title, 'session', i.session_id)
      into t from pledge_intents i join projects p on p.id = i.project_id left join rewards r on r.id = i.reward_id
      where i.id = p_intent and i.backer_id = p_uid and p.status = 'live';
  else
    select jsonb_build_object('kind', 'fix', 'id', x.id, 'amount', x.amount_cents + x.tip_cents, 'currency', p.currency, 'title', p.title,
        'slug', p.slug, 'reward', r.title, 'charge_status', x.charge_status)
      into t from pledges x join projects p on p.id = x.project_id left join rewards r on r.id = x.reward_id
      where x.id = p_pledge and x.backer_id = p_uid and p.payments = 'stripe'
        and ((x.status = 'active' and p.status = 'live') or (x.charge_status = 'failed' and x.fix_by > now()));
  end if;
  return t;
end $$;

-- The backer is charged pledge + tip. The platform keeps the fee on the pledge plus the whole tip.
create or replace function public.gs_svc_charges_claim(p_limit int) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ids uuid[]; fee int := coalesce((gs_setting('fee_bps') #>> '{}')::int, 800);
begin
  select array_agg(id) into ids from (
    select x.id from pledges x
    where x.charge_status = 'due' or (x.charge_status = 'processing' and x.updated_at < now() - interval '15 minutes')
    order by x.updated_at limit p_limit for update skip locked) c;
  if ids is null then return '[]'::jsonb; end if;
  update pledges set charge_status = 'processing', charge_attempts = charge_attempts + 1, updated_at = now(),
    fee_cents = coalesce(fee_cents, floor(amount_cents * fee / 10000.0)::bigint) where id = any (ids);
  return coalesce((select jsonb_agg(jsonb_build_object('pledge', x.id, 'amount', x.amount_cents + x.tip_cents, 'currency', lower(p.currency),
      'customer', b.stripe_customer_id, 'pm', x.stripe_pm, 'destination', c.stripe_account_id,
      'fee', x.fee_cents + x.tip_cents, 'title', p.title, 'slug', p.slug, 'backer_no', x.backer_no,
      'attempts', x.charge_attempts))
    from pledges x join projects p on p.id = x.project_id join users b on b.id = x.backer_id join users c on c.id = p.creator_id
    where x.id = any (ids)), '[]'::jsonb);
end $$;

-- ============================================================ featured spot

-- What a creator would buy: their own live project, while nobody else holds the spot.
create function public.gs_svc_feature_target(p_uid uuid, p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare p projects; held projects;
begin
  select * into p from projects where id = p_project and creator_id = p_uid;
  if p.id is null then raise exception 'We couldn''t find that project.'; end if;
  if p.status <> 'live' or p.hidden then raise exception 'Only live projects can be featured.'; end if;
  select * into held from projects where id <> p.id and featured_until > now() order by featured_until desc limit 1;
  if held.id is not null then
    raise exception 'The featured spot is booked until %. Try again then.', to_char(held.featured_until at time zone 'UTC', 'Mon DD');
  end if;
  return jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'currency', p.currency,
    'price', coalesce((gs_setting('feature_price_cents') #>> '{}')::int, 4900),
    'days', coalesce((gs_setting('feature_days') #>> '{}')::int, 7));
end $$;

-- A paid featuring Checkout finished. Extends any time the project already has.
create function public.gs_svc_feature_paid(p_session text, p_project uuid, p_buyer uuid, p_amount bigint, p_currency text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p projects; days int := coalesce((gs_setting('feature_days') #>> '{}')::int, 7); f feature_purchases; starts timestamptz;
begin
  select * into f from feature_purchases where session_id = p_session;
  if f.session_id is not null then return jsonb_build_object('until', f.ends_at); end if;
  select * into p from projects where id = p_project for update;
  if p.id is null then raise exception 'We couldn''t find that project.'; end if;
  starts := greatest(now(), coalesce(p.featured_until, now()));
  insert into feature_purchases (session_id, project_id, buyer_id, amount_cents, currency, starts_at, ends_at)
    values (p_session, p.id, p_buyer, p_amount, p_currency, starts, starts + make_interval(days => days));
  update projects set featured = true, featured_until = starts + make_interval(days => days), updated_at = now() where id = p.id;
  return jsonb_build_object('until', starts + make_interval(days => days));
end $$;

-- Paid featuring ends on its own; moderators' manual featuring (featured_until null) doesn't.
create or replace function public.gs_admin_set(p_token text, p_project uuid, p_field text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token);
begin
  if p_field = 'featured' then update projects set featured = p_on, featured_until = null where id = p_project;
  elsif p_field = 'hidden' then update projects set hidden = p_on where id = p_project;
  else raise exception 'Unknown setting.'; end if;
  return '{}'::jsonb;
end $$;

create or replace function public.gs_svc_tick(p_email boolean, p_stripe boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n int;
begin
  insert into settings (key, value) values ('email_ready', to_jsonb(coalesce(p_email, false))), ('stripe_ready', to_jsonb(coalesce(p_stripe, false)))
    on conflict (key) do update set value = excluded.value, updated_at = now() where settings.value is distinct from excluded.value;
  perform gs_settle();
  update projects set featured = false, featured_until = null, updated_at = now() where featured_until <= now() or (featured_until is not null and status <> 'live');
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

-- ============================================================ dashboard

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
    'feature', jsonb_build_object('featured', p.featured, 'until', p.featured_until,
        'price', coalesce((gs_setting('feature_price_cents') #>> '{}')::int, 4900),
        'days', coalesce((gs_setting('feature_days') #>> '{}')::int, 7),
        'booked_until', (select max(featured_until) from projects where id <> p.id and featured_until > now())),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'n', u.n, 'title', u.title, 'body', u.body,
        'backers_only', u.backers_only, 'created_at', u.created_at) order by u.n desc) from updates u where u.project_id = p.id), '[]')
  );
end $$;

-- Moderation shows what Groundswell has earned.
create or replace function public.gs_admin(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token);
begin
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'at', r.created_at, 'resolved', r.resolved,
        'by', gs_user_json(r.user_id),
        'project', jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'hidden', p.hidden,
            'creator', gs_user_json(p.creator_id), 'creator_suspended', cu.suspended_at is not null),
        'comment', case when c.id is not null then jsonb_build_object('id', c.id, 'body', c.body, 'deleted', c.deleted,
            'author', gs_user_json(c.user_id), 'author_suspended', au.suspended_at is not null) end)
        order by r.resolved, r.created_at desc)
        from reports r join projects p on p.id = r.project_id join users cu on cu.id = p.creator_id
        left join comments c on c.id = r.comment_id left join users au on au.id = c.user_id), '[]'),
    'projects', coalesce((select jsonb_agg(gs_card(p, uid) order by p.status = 'live' desc, p.launched_at desc)
        from projects p where p.status <> 'draft'), '[]'),
    'suspended', coalesce((select jsonb_agg(gs_user_json(u.id) || jsonb_build_object('at', u.suspended_at) order by u.suspended_at desc)
        from users u where u.suspended_at is not null and u.deleted_at is null), '[]'),
    'stats', jsonb_build_object('users', (select count(*) from users where deleted_at is null and not sample),
        'samples', (select count(*) from projects where sample)),
    'settings', jsonb_build_object('payments', gs_setting('payments') #>> '{}', 'fee_bps', (gs_setting('fee_bps') #>> '{}')::int,
        'email_ready', gs_flag('email_ready'), 'stripe_ready', gs_flag('stripe_ready'),
        'emails_queued', (select count(*) from outbox where status in ('queued', 'sending')),
        'emails_failed', (select count(*) from outbox where status = 'failed' and created_at > now() - interval '7 days'),
        'charges_failed', (select count(*) from pledges where charge_status = 'failed'),
        'blocked_words', coalesce(gs_setting('blocked_words'), '[]'::jsonb),
        'revenue', jsonb_build_object(
          'fees', (select coalesce(sum(fee_cents), 0) from pledges where charge_status = 'paid'),
          'tips', (select coalesce(sum(tip_cents), 0) from pledges where charge_status = 'paid'),
          'featured', (select coalesce(sum(amount_cents), 0) from feature_purchases))));
end $$;

-- Moderators can change the price and length of the featured spot.
create or replace function public.gs_admin_settings(p_token text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token); fee int; n int;
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
  if p_patch ? 'feature_price_cents' then
    n := (p_patch->>'feature_price_cents')::int;
    if n is null or n not between 500 and 1000000 then raise exception 'The featured price must be between $5 and $10,000.'; end if;
    insert into settings (key, value) values ('feature_price_cents', to_jsonb(n))
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  if p_patch ? 'feature_days' then
    n := (p_patch->>'feature_days')::int;
    if n is null or n not between 1 and 60 then raise exception 'Featuring must last between 1 and 60 days.'; end if;
    insert into settings (key, value) values ('feature_days', to_jsonb(n))
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return gs_admin(p_token);
exception when invalid_text_representation then
  raise exception 'Please enter a valid number.';
end $$;

-- ============================================================ grants

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
    'gs_admin_settings',
    'gs_block','gs_blocks','gs_comment_report','gs_admin_suspend','gs_admin_words'])
  loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'gs\_svc\_%'
  loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
