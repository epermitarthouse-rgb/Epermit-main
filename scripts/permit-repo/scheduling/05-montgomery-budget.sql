-- Montgomery County MD central comment processing budget (D-147). NOT RUN: apply only after written approval,
-- after migration 20261123100000 and the permit-comment-pipeline deploy that reads settings.central_budget_scope.
-- 1. Budget row 'montgomery', cap $3.00 (every AI call reserves its worst-case cost first; spend stops at the cap).
-- 2. Every montgomery-projectdox source names it in settings.central_budget_scope, so central sweeps process
--    Montgomery permits against 'montgomery' and DC permits stay on CENTRAL_AI_BUDGET_SCOPE (dc-backfill).
--    The schedule save keeps this key (it merges settings). Nothing is enqueued and no AI call is made here.
-- Order matters: the row first, then the source setting. A source naming a scope without a row pauses its
-- permits with 'budget' (no spend) and raises a central_budget_paused alert.
--
-- Apply:    supabase db query --linked -f scripts/permit-repo/scheduling/05-montgomery-budget.sql
-- Stop now: UPDATE public.permit_ai_budgets SET closed_at = now(), updated_at = now() WHERE scope = 'montgomery';
-- Undo:     UPDATE public.permit_sync_sources SET settings = settings - 'central_budget_scope', updated_at = now()
--           WHERE adapter_key = 'montgomery-projectdox';   (Montgomery then shares the env scope again)
-- Spend:    SELECT public.permit_ai_budget_status('montgomery');

BEGIN;

INSERT INTO public.permit_ai_budgets (scope, cap_usd, approved_at, approved_by, notes)
VALUES ('montgomery', 3.00, now(), 'replace-with-approver', 'Montgomery County MD central comment processing, montgomery-projectdox')
ON CONFLICT (scope) DO UPDATE
  SET cap_usd = EXCLUDED.cap_usd,
      approved_at = EXCLUDED.approved_at,
      approved_by = EXCLUDED.approved_by,
      notes = EXCLUDED.notes,
      updated_at = now()
  WHERE public.permit_ai_budgets.closed_at IS NULL;

DO $$
DECLARE
  v_n INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.permit_ai_budgets WHERE scope = 'montgomery' AND approved_at IS NOT NULL AND closed_at IS NULL) THEN
    RAISE EXCEPTION 'budget montgomery is closed; reopen it deliberately before pointing sources at it';
  END IF;
  UPDATE public.permit_sync_sources
  SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{central_budget_scope}', '"montgomery"'), updated_at = now()
  WHERE adapter_key = 'montgomery-projectdox';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'no montgomery-projectdox source';
  END IF;
  RAISE NOTICE 'central_budget_scope set on % montgomery-projectdox source(s)', v_n;
END $$;

COMMIT;

SELECT adapter_key, count(*) AS sources, bool_and(settings ->> 'central_budget_scope' = 'montgomery') AS all_scoped
FROM public.permit_sync_sources WHERE adapter_key = 'montgomery-projectdox' GROUP BY adapter_key;
SELECT public.permit_ai_budget_status('montgomery') AS budget;
