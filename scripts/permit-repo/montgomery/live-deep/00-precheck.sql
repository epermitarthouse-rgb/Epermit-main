-- Montgomery supervised deep run, step 0 (READ ONLY). Expect: credential encrypted, no Montgomery source yet,
-- 0 Montgomery permits, 0 active jobs, the Railway worker idle, no manual scrape on this login.
--   supabase db query --linked -f scripts/permit-repo/montgomery/live-deep/00-precheck.sql
SELECT json_build_object(
  'credential_encrypted', (SELECT portal_password LIKE '{"pc_v"%' FROM public.portal_credentials WHERE id = '93857549-eb37-47cd-ad83-6701f835de66'),
  'login_host', (SELECT split_part(split_part(coalesce(login_url, ''), '//', 2), '/', 1) FROM public.portal_credentials WHERE id = '93857549-eb37-47cd-ad83-6701f835de66'),
  'montgomery_source', (SELECT json_build_object('adapter', adapter_key, 'status', status, 'automation', automation_enabled) FROM public.permit_sync_sources WHERE credential_id = '93857549-eb37-47cd-ad83-6701f835de66'),
  'montgomery_permits', (SELECT count(*) FROM public.permits WHERE adapter_key = 'montgomery-projectdox'),
  'active_jobs', (SELECT count(*) FROM public.permit_sync_jobs WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user')),
  'manual_scrape_on_login', (SELECT count(*) FROM public.scrape_jobs WHERE status IN ('running', 'queued') AND credential_id = '93857549-eb37-47cd-ad83-6701f835de66'),
  'workers', (SELECT json_agg(w) FROM (SELECT worker_id, status, details->>'version' AS version, last_seen_at FROM public.permit_sync_workers WHERE last_seen_at > now() - interval '10 minutes') w)
) AS precheck;
