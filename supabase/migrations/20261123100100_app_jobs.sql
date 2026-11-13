-- Phase 12: let app-side cron jobs (Vercel Cron → /api/cron/*) record their
-- last run in job_runs, next to the pg_cron jobs (shown on /admin/health).
create or replace function public.record_app_job(p_job text, p_ok boolean, p_result jsonb default '{}'::jsonb, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.record_job(p_job, p_ok, p_result, p_error);
$$;
revoke execute on function public.record_app_job(text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_app_job(text, boolean, jsonb, text) to service_role;
