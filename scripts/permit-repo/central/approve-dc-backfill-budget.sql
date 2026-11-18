-- Approve the AI budget for the DC central backfill (D-123). NOT RUN: apply only after written approval.
-- permit-comment-pipeline action central_backfill refuses to run unless this row exists, is approved and open,
-- and every call reserves its worst-case cost against cap_usd first, so spend stops before the cap.
--
-- Apply:    supabase db query --linked -f scripts/permit-repo/central/approve-dc-backfill-budget.sql
-- Stop now: UPDATE public.permit_ai_budgets SET closed_at = now(), updated_at = now() WHERE scope = 'dc-backfill';
-- Spend:    SELECT public.permit_ai_budget_status('dc-backfill');

INSERT INTO public.permit_ai_budgets (scope, cap_usd, approved_at, approved_by, notes)
VALUES ('dc-backfill', 5.00, now(), 'replace-with-approver', 'DC central comment backfill, dc-projectdox, one pass')
ON CONFLICT (scope) DO UPDATE
  SET cap_usd = EXCLUDED.cap_usd,
      approved_at = EXCLUDED.approved_at,
      approved_by = EXCLUDED.approved_by,
      notes = EXCLUDED.notes,
      updated_at = now()
  WHERE public.permit_ai_budgets.closed_at IS NULL;
