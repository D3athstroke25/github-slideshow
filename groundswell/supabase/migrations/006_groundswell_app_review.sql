-- Safeguards for user-generated content, as App Store guideline 1.2 asks:
--   * a filter for objectionable words in what people post
--   * reporting comments as well as projects, with every report sent to the moderators
--   * blocking people: their comments are hidden from you, they can't comment on your projects,
--     and they can't send you notifications
--   * moderators can suspend accounts
-- Needs 004.

-- ============================================================ tables

alter table public.reports add column comment_id uuid references public.comments on delete cascade;
create index reports_comment on public.reports (comment_id);

alter table public.users add column suspended_at timestamptz;

create table public.blocks (
  user_id    uuid not null references public.users on delete cascade,
  blocked_id uuid not null references public.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id);
alter table public.blocks enable row level security;

-- Words that can't be posted, matched as whole words with common endings (s, ed, ing, ...).
-- Moderators edit the list in Moderation. Kept short to avoid blocking innocent words.
insert into public.settings (key, value) values ('blocked_words', '["fuck", "motherfucker", "shit", "shitty", "bullshit",
  "cunt", "bitch", "asshole", "dickhead", "wanker", "twat", "whore", "slut", "retard", "faggot", "nigger", "nigga", "kike"]')
on conflict (key) do nothing;

-- ============================================================ word filter

create function public.gs_check_words(p_text text, p_what text) returns void
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare re text;
begin
  if coalesce(p_text, '') = '' then return; end if;
  select '\m(' || string_agg(regexp_replace(lower(trim(w)), '([^a-z0-9])', '\\\1', 'g'), '|') || ')(s|es|ed|er|ers|ing|in|y)?\M' into re
    from jsonb_array_elements_text(coalesce(gs_setting('blocked_words'), '[]'::jsonb)) w where trim(w) <> '';
  if re is not null and lower(p_text) ~ re then
    raise exception 'Please keep it friendly: your % includes words that aren''t allowed on Groundswell.', p_what using hint = 'words';
  end if;
end $$;

-- Drafts are not checked as people type; a project is checked when it launches and on later edits.
create function public.gs_words_guard() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare st text;
begin
  if tg_table_name = 'comments' then
    if tg_op = 'INSERT' and exists (select 1 from projects p join blocks b on b.user_id = p.creator_id and b.blocked_id = new.user_id
                                    where p.id = new.project_id) then
      raise exception 'You can''t comment on this project.';
    end if;
    if not new.deleted then perform gs_check_words(new.body, 'comment'); end if;
  elsif tg_table_name = 'updates' then
    perform gs_check_words(new.title || ' ' || new.body, 'update');
  elsif tg_table_name = 'users' then
    if not new.sample and new.deleted_at is null then
      perform gs_check_words(new.username || ' ' || new.display_name || ' ' || new.bio || ' ' || new.location, 'profile');
    end if;
  elsif tg_table_name = 'rewards' then
    select status into st from projects where id = new.project_id;
    if st is distinct from 'draft' then
      perform gs_check_words(new.title || ' ' || new.description || ' ' ||
        coalesce((select string_agg(i, ' ') from jsonb_array_elements_text(new.items) i), ''), 'reward');
    end if;
  elsif tg_table_name = 'projects' then
    if new.status <> 'draft' and (old.status = 'draft' or (new.title, new.blurb, new.story, new.risks, new.faqs)
                                  is distinct from (old.title, old.blurb, old.story, old.risks, old.faqs)) then
      perform gs_check_words(new.title || ' ' || new.blurb || ' ' || new.story || ' ' || new.risks || ' ' ||
        coalesce((select string_agg(coalesce(f->>'q', '') || ' ' || coalesce(f->>'a', ''), ' ') from jsonb_array_elements(new.faqs) f), ''), 'project');
      if old.status = 'draft' then
        perform gs_check_words((select string_agg(r.title || ' ' || r.description || ' ' ||
          coalesce((select string_agg(i, ' ') from jsonb_array_elements_text(r.items) i), ''), ' ') from rewards r where r.project_id = new.id), 'project');
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger comments_words before insert or update of body on public.comments
  for each row execute function public.gs_words_guard();
create trigger updates_words before insert or update of title, body on public.updates
  for each row execute function public.gs_words_guard();
create trigger users_words before insert or update of username, display_name, bio, location on public.users
  for each row execute function public.gs_words_guard();
create trigger rewards_words before insert or update of title, description, items on public.rewards
  for each row execute function public.gs_words_guard();
create trigger projects_words before update on public.projects
  for each row execute function public.gs_words_guard();

-- ============================================================ blocking

create function public.gs_block(p_token text, p_username text, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); target uuid;
begin
  select id into target from users where username = lower(trim(coalesce(p_username, ''))) and deleted_at is null;
  if target is null then raise exception 'We couldn''t find that person.' using hint = 'notfound'; end if;
  if target = uid then raise exception 'You can''t block yourself.'; end if;
  if p_on then
    insert into blocks (user_id, blocked_id) values (uid, target) on conflict do nothing;
  else
    delete from blocks where user_id = uid and blocked_id = target;
  end if;
  return jsonb_build_object('blocked', p_on);
end $$;

create function public.gs_blocks(p_token text) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(jsonb_agg(gs_user_json(b.blocked_id) || jsonb_build_object('at', b.created_at) order by b.created_at desc), '[]'::jsonb)
  from blocks b join users u on u.id = b.blocked_id
  where b.user_id = gs_uid(p_token) and u.deleted_at is null
$$;

-- People you block can't send you notifications (comments, replies, first backer).
create function public.gs_notify_blocked() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if new.actor_id is not null and exists (select 1 from blocks where user_id = new.user_id and blocked_id = new.actor_id) then
    return null;
  end if;
  return new;
end $$;

create trigger notifications_blocked before insert on public.notifications
  for each row execute function public.gs_notify_blocked();

-- Blocks go with a deleted account.
create function public.gs_user_gone() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  delete from blocks where user_id = new.id or blocked_id = new.id;
  return null;
end $$;

create trigger users_gone after update of deleted_at on public.users
  for each row when (new.deleted_at is not null and old.deleted_at is null) execute function public.gs_user_gone();

-- Comments from people you blocked come back hidden, so replies from others still make sense.
create or replace function public.gs_comments(p_token text default null, p_project uuid default null, p_update uuid default null) returns jsonb
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
        'body', case when c.deleted or c.blocked then '' else c.body end, 'deleted', c.deleted, 'blocked', c.blocked,
        'created_at', c.created_at,
        'author', case when c.deleted or c.blocked then null else gs_user_json(c.user_id) end,
        'badge', case when c.deleted or c.blocked then null when c.user_id = creator then 'creator'
                      when exists (select 1 from pledges x where x.project_id = p.id and x.backer_id = c.user_id and x.status <> 'canceled') then 'backer' end,
        'mine', coalesce(c.user_id = v, false), 'can_delete', not c.deleted and coalesce(c.user_id = v or is_creator, false)) order by c.created_at)
      from (select x.*, v is not null and exists (select 1 from blocks b where b.user_id = v and b.blocked_id = x.user_id) as blocked
            from comments x where x.project_id = p.id and x.update_id is not distinct from p_update order by x.created_at limit 1000) c), '[]'));
end $$;

create or replace function public.gs_user(p_token text default null, p_username text default '') returns jsonb
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
        'blocked', v is not null and exists (select 1 from blocks b where b.user_id = v and b.blocked_id = u.id),
        'backed_count', (select count(*) from pledges x join projects p on p.id = x.project_id where x.backer_id = u.id and x.status <> 'canceled' and not p.hidden)),
    'created', coalesce((select jsonb_agg(gs_card(p, v) order by p.launched_at desc nulls first, p.created_at desc)
        from projects p where p.creator_id = u.id and ((p.status <> 'draft' and not p.hidden) or self)), '[]'),
    'backed', case when u.show_backed or self then coalesce((select jsonb_agg(gs_card(p, v) order by x.created_at desc)
        from pledges x join projects p on p.id = x.project_id where x.backer_id = u.id and x.status <> 'canceled' and not p.hidden), '[]') end
  );
end $$;

-- ============================================================ reports

create function public.gs_comment_report(p_token text, p_comment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_uid(p_token); c comments;
begin
  select * into c from comments where id = p_comment and not deleted;
  if c.id is null or not exists (select 1 from projects where id = c.project_id and status <> 'draft') then
    raise exception 'That comment was deleted.';
  end if;
  if c.user_id = uid then raise exception 'You can delete your own comment instead.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Tell us briefly what''s wrong.'; end if;
  if exists (select 1 from reports where comment_id = c.id and user_id = uid and not resolved) then return '{}'::jsonb; end if;
  if not gs_throttle('report:' || uid, 10, interval '1 day') then raise exception 'You''ve sent a lot of reports today. Thank you. We''ll review them.'; end if;
  insert into reports (project_id, comment_id, user_id, reason) values (c.project_id, c.id, uid, left(trim(p_reason), 1000));
  return '{}'::jsonb;
end $$;

-- Every report reaches the moderators as a notification (and an email, if they have one).
create function public.gs_report_notify() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  insert into notifications (user_id, kind, project_id, data)
    select u.id, 'report', new.project_id, jsonb_build_object('comment', new.comment_id is not null, 'reason', left(new.reason, 140))
    from users u where u.is_admin and u.deleted_at is null and u.id <> new.user_id;
  return null;
end $$;

create trigger reports_notify after insert on public.reports
  for each row execute function public.gs_report_notify();

-- ============================================================ suspended accounts

create or replace function public.gs_uid_opt(p_token text) returns uuid
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.user_id from sessions s join users u on u.id = s.user_id
  where p_token is not null and p_token <> '' and s.token_hash = digest(p_token, 'sha256')
    and s.expires_at > now() and u.deleted_at is null and u.suspended_at is null
$$;

create or replace function public.gs_login(p_username text, p_password text) returns jsonb
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
  if r.suspended_at is not null then
    return jsonb_build_object('error', 'This account has been suspended for breaking the Terms of Use. If you think this is a mistake, contact us through Help & contact.');
  end if;
  update users set failed_logins = 0, locked_until = null where id = r.id;
  return jsonb_build_object('token', gs_session(r.id), 'me', gs_me_json(r.id));
end $$;

-- ============================================================ moderation

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
        'blocked_words', coalesce(gs_setting('blocked_words'), '[]'::jsonb)));
end $$;

-- Suspending signs the person out everywhere and stops them logging in. Their projects stay
-- up unless a moderator hides them.
create function public.gs_admin_suspend(p_token text, p_username text, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token); u users;
begin
  select * into u from users where username = lower(trim(coalesce(p_username, ''))) and deleted_at is null;
  if u.id is null then raise exception 'We couldn''t find that person.'; end if;
  if u.is_admin then raise exception 'Moderators can''t be suspended.'; end if;
  update users set suspended_at = case when p_on then coalesce(suspended_at, now()) end where id = u.id;
  if p_on then delete from sessions where user_id = u.id; end if;
  return gs_admin(p_token);
end $$;

-- p_words: one word or phrase per line, or separated by commas.
create function public.gs_admin_words(p_token text, p_words text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gs_admin_uid(p_token); list jsonb;
begin
  select coalesce(jsonb_agg(w order by w), '[]'::jsonb) into list from (
    select distinct left(lower(trim(w)), 60) w from regexp_split_to_table(coalesce(p_words, ''), '[,\n]') w where trim(w) <> '' limit 500) x;
  insert into settings (key, value) values ('blocked_words', list)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return gs_admin(p_token);
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
