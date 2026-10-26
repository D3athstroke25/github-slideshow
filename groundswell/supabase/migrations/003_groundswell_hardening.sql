-- Follow-ups from the Supabase advisors.
-- Pin the search path of the remaining helper functions.
alter function public.gs_categories() set search_path = public, extensions, pg_temp;
alter function public.gs_ip() set search_path = public, extensions, pg_temp;
alter function public.gs_money(bigint, text) set search_path = public, extensions, pg_temp;
alter function public.gs_reward_json(public.rewards) set search_path = public, extensions, pg_temp;
alter function public.gs_pct(public.projects) set search_path = public, extensions, pg_temp;
alter function public.gs_slugify(text) set search_path = public, extensions, pg_temp;

-- Index foreign keys so cascades and lookups by these columns stay fast.
create index if not exists comments_user on public.comments (user_id);
create index if not exists comments_parent on public.comments (parent_id);
create index if not exists comments_update on public.comments (update_id);
create index if not exists notifications_project on public.notifications (project_id);
create index if not exists notifications_actor on public.notifications (actor_id);
create index if not exists reports_project on public.reports (project_id);
create index if not exists reports_user on public.reports (user_id);
create index if not exists uploads_user on public.uploads (user_id);
