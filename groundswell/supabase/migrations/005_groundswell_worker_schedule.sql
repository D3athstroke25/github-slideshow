-- supabase-only: uses pg_cron, pg_net and Vault, so local test databases skip it.
-- Runs the `gs` Edge Function's worker every minute (emails, charges, settling projects).
-- Needs 004. The URL below is this project's; change it when rebuilding in another project.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Shared secret the worker checks (gs_svc_worker_ok), kept encrypted in Vault.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'gs_worker_secret', 'Groundswell worker secret')
where not exists (select 1 from vault.secrets where name = 'gs_worker_secret');

insert into public.settings (key, value)
values ('worker_url', to_jsonb('https://mrvuxjkahorglqnmyamh.supabase.co/functions/v1/gs/worker'::text))
on conflict (key) do update set value = excluded.value, updated_at = now();

select cron.schedule('gs-worker', '* * * * *', $$select public.gs_kick()$$);
