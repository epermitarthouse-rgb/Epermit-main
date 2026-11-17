-- One-time removal of the unused duplicate DC permit-sync source 0610eaa5.
-- NOT a migration. Run once, after the read-only pre-check:
--   supabase db query --linked -f scripts/permit-repo/repairs/d119-remove-duplicate-dc-source.sql
--
-- There is no admin RPC that deletes a permit_sync_source and writes platform_audit_events.
-- DELETE /api/portal-credentials/:id cascades source -> jobs -> events, but it writes no audit
-- row and does not refuse a source that still has permits or automation. This script is the
-- audited path for this one row.
--
-- Refuses unless 0610eaa5 is the only matching source, is paused, automation is off, and it has
-- 0 permit links, 0 documents, 0 reports and 0 project links. Also refuses when any sync job is
-- queued or running, when this credential id is de8592f9, or when another source references it.
-- de8592f9 is read and compared only. This script never updates it and never enables a schedule.
--
-- Jobs and events are removed by the source delete (FK cascade). A direct job or event delete
-- is blocked. The portal_credentials row is deleted only after the source row is gone, only when
-- no source references that id, and only when the id differs from de8592f9.
--
-- Rollback: the password cannot be restored. The source, its jobs, its events and the credential
-- row are gone. The only remaining record is the platform_audit_events row
-- (action = 'permit_sync_source.remove', target_id = the removed credential id).

BEGIN;

DO $$
DECLARE
  v_real CONSTANT UUID := 'de8592f9-69fc-4c71-8544-cb22bbbd5813';
  v_dup UUID;
  v_n INTEGER;
  v_status TEXT;
  v_auto BOOLEAN;
  v_adapter TEXT;
  v_jobs INTEGER;
  v_events INTEGER;
  v_grants INTEGER;
  v_audit UUID;
  v_real_status TEXT;
  v_real_auto BOOLEAN;
  v_real_settings JSONB;
  v_real_enabled_at TIMESTAMPTZ;
  v_real_last_scheduled TIMESTAMPTZ;
  v_real_last_result TEXT;
  v_real_permits INTEGER;
BEGIN
  SELECT count(*) INTO v_n
  FROM public.permit_sync_sources
  WHERE credential_id::text LIKE '0610eaa5-%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'removal refused: expected 1 source 0610eaa5, found %', v_n;
  END IF;

  SELECT s.credential_id, s.status, s.automation_enabled, s.adapter_key
    INTO v_dup, v_status, v_auto, v_adapter
  FROM public.permit_sync_sources s
  WHERE s.credential_id::text LIKE '0610eaa5-%'
  FOR UPDATE;
  PERFORM 1 FROM public.portal_credentials WHERE id = v_dup FOR UPDATE;

  IF v_dup = v_real OR v_dup::text NOT LIKE '0610eaa5-%' THEN
    RAISE EXCEPTION 'removal refused: credential id is not the duplicate, or it is de8592f9';
  END IF;
  IF v_status IS DISTINCT FROM 'paused' OR v_auto IS DISTINCT FROM false OR v_adapter IS DISTINCT FROM 'dc-projectdox' THEN
    RAISE EXCEPTION 'removal refused: source must be paused dc-projectdox with automation off';
  END IF;

  IF (SELECT count(*) FROM public.permit_source_links WHERE credential_id = v_dup) <> 0
     OR (SELECT count(*) FROM public.permit_documents d
         JOIN public.permit_source_links l ON l.permit_id = d.permit_id
         WHERE l.credential_id = v_dup) <> 0
     OR (SELECT count(*) FROM public.permit_reports r
         JOIN public.permit_source_links l ON l.permit_id = r.permit_id
         WHERE l.credential_id = v_dup) <> 0
     OR (SELECT count(*) FROM public.project_permits pp
         JOIN public.permit_source_links l ON l.permit_id = pp.permit_id
         WHERE l.credential_id = v_dup) <> 0
     OR (SELECT count(*) FROM public.projects WHERE credential_id = v_dup) <> 0 THEN
    RAISE EXCEPTION 'removal refused: source still has permits, documents, reports or project links';
  END IF;

  IF (SELECT count(*) FROM public.permit_sync_sources WHERE credential_id = v_dup) <> 1 THEN
    RAISE EXCEPTION 'removal refused: another source references this credential';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.permit_sync_jobs
    WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user')
  ) THEN
    RAISE EXCEPTION 'removal refused: a permit sync job is queued or running';
  END IF;
  IF (SELECT count(*) FROM public.scrape_jobs WHERE credential_id = v_dup) <> 0
     OR (SELECT count(*) FROM public.permit_filings WHERE credential_id = v_dup) <> 0
     OR (SELECT count(*) FROM public.uci_portal_harvest_items WHERE source_credential_id = v_dup) <> 0 THEN
    RAISE EXCEPTION 'removal refused: credential is referenced outside this source';
  END IF;

  SELECT s.status, s.automation_enabled, s.settings, s.schedule_enabled_at, s.last_scheduled_at, s.last_schedule_result
    INTO v_real_status, v_real_auto, v_real_settings, v_real_enabled_at, v_real_last_scheduled, v_real_last_result
  FROM public.permit_sync_sources s
  WHERE s.credential_id = v_real;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'removal refused: de8592f9 source is missing';
  END IF;
  SELECT count(*) INTO v_real_permits FROM public.permit_source_links WHERE credential_id = v_real;
  IF v_real_auto IS DISTINCT FROM false
     OR v_real_enabled_at IS NOT NULL
     OR v_real_settings -> 'schedule' ->> 'frequency' IS DISTINCT FROM 'daily'
     OR v_real_settings -> 'schedule' ->> 'time' IS DISTINCT FROM '04:00'
     OR v_real_settings -> 'schedule' ->> 'timezone' IS DISTINCT FROM 'America/New_York'
     OR v_real_permits <> 28 THEN
    RAISE EXCEPTION 'removal refused: de8592f9 is not the expected unenabled daily 04:00 America/New_York source with 28 permits';
  END IF;

  SELECT count(*) INTO v_jobs FROM public.permit_sync_jobs WHERE credential_id = v_dup;
  SELECT count(*) INTO v_events
  FROM public.permit_sync_events e
  JOIN public.permit_sync_jobs j ON j.id = e.job_id
  WHERE j.credential_id = v_dup;
  SELECT count(*) INTO v_grants FROM public.user_portal_credential_grants WHERE credential_id = v_dup;
  IF EXISTS (
    SELECT 1 FROM public.permit_sync_jobs
    WHERE credential_id = v_dup AND status NOT IN ('completed', 'completed_with_warnings', 'failed', 'failed_unrecoverable', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'removal refused: source has a non-terminal job';
  END IF;

  INSERT INTO public.platform_audit_events (action, target_type, target_id, before_json, after_json, result)
  VALUES (
    'permit_sync_source.remove',
    'permit_sync_source',
    v_dup::text,
    jsonb_build_object(
      'credential_id_prefix', left(v_dup::text, 8),
      'status', v_status,
      'automation_enabled', false,
      'adapter_key', v_adapter,
      'permits', 0,
      'documents', 0,
      'reports', 0,
      'project_links', 0,
      'jobs', v_jobs,
      'events', v_events,
      'credential_grants', v_grants
    ),
    jsonb_build_object(
      'removed', true,
      'jobs_deleted', v_jobs,
      'events_deleted', v_events,
      'credential_deleted', true,
      'credential_grants_deleted', v_grants,
      'kept_source_prefix', 'de8592f9',
      'script', 'd119-remove-duplicate-dc-source.sql'
    ),
    'success'
  )
  RETURNING id INTO v_audit;

  DELETE FROM public.permit_sync_sources WHERE credential_id = v_dup AND credential_id <> v_real;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'removal refused: source delete removed % rows', v_n;
  END IF;
  IF (SELECT count(*) FROM public.permit_sync_jobs WHERE credential_id = v_dup) <> 0
     OR (SELECT count(*) FROM public.permit_sync_events e
         JOIN public.permit_sync_jobs j ON j.id = e.job_id
         WHERE j.credential_id = v_dup) <> 0 THEN
    RAISE EXCEPTION 'removal refused: jobs or events remained after the source delete';
  END IF;

  IF EXISTS (SELECT 1 FROM public.permit_sync_sources WHERE credential_id = v_dup) OR v_dup = v_real THEN
    RAISE EXCEPTION 'removal refused: credential is still referenced or is de8592f9';
  END IF;
  DELETE FROM public.portal_credentials AS c
  WHERE c.id = v_dup
    AND c.id <> v_real
    AND NOT EXISTS (SELECT 1 FROM public.permit_sync_sources s WHERE s.credential_id = c.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'removal refused: credential delete removed % rows', v_n;
  END IF;

  IF EXISTS (SELECT 1 FROM public.permit_sync_sources WHERE credential_id = v_dup)
     OR EXISTS (SELECT 1 FROM public.portal_credentials WHERE id = v_dup) THEN
    RAISE EXCEPTION 'removal refused: duplicate source or credential still exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.permit_sync_jobs
    WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user')
  ) THEN
    RAISE EXCEPTION 'removal refused: a permit sync job is queued or running';
  END IF;

  IF (SELECT count(*) FROM public.permit_source_links WHERE credential_id = v_real) <> v_real_permits
     OR EXISTS (
       SELECT 1 FROM public.permit_sync_sources s
       WHERE s.credential_id = v_real
         AND (s.status IS DISTINCT FROM v_real_status
           OR s.automation_enabled IS DISTINCT FROM v_real_auto
           OR s.settings IS DISTINCT FROM v_real_settings
           OR s.schedule_enabled_at IS DISTINCT FROM v_real_enabled_at
           OR s.last_scheduled_at IS DISTINCT FROM v_real_last_scheduled
           OR s.last_schedule_result IS DISTINCT FROM v_real_last_result)
     ) THEN
    RAISE EXCEPTION 'removal refused: de8592f9 changed during the removal';
  END IF;
END $$;

COMMIT;

-- Identifiers and counts only. The password is not in this row.
SELECT a.id AS audit_id,
       left(a.id::text, 8) AS audit_prefix,
       a.created_at,
       left(a.target_id, 8) AS source_prefix,
       a.before_json,
       a.after_json
FROM public.platform_audit_events a
WHERE a.action = 'permit_sync_source.remove'
  AND a.target_id LIKE '0610eaa5-%'
ORDER BY a.created_at DESC
LIMIT 1;
