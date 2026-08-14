-- Backfill provider-account harvest inventory from PEPCO data captured before
-- uci_portal_harvest_items existed. This is idempotent and does not create
-- project links; matching remains an explicit human action.

INSERT INTO public.uci_portal_harvest_items (
  provider_slug,
  external_application_id,
  owner_user_id,
  tenant_id,
  portal_status,
  portal_milestone,
  external_job_id,
  snapshot,
  last_synced_at
)
SELECT
  'pepco',
  ca.external_application_id,
  cr.user_id,
  COALESCE(ca.tenant_id, cr.tenant_id),
  ca.portal_status,
  ca.portal_milestone,
  ca.external_job_id,
  COALESCE(ca.metadata -> 'portal_snapshot', '{}'::jsonb),
  COALESCE(ca.last_synced_at, ca.portal_last_updated_at, ca.updated_at, now())
FROM public.coordination_applications ca
JOIN public.coordination_records cr
  ON cr.id = ca.coordination_record_id
 AND cr.project_id = ca.project_id
WHERE ca.provider_slug = 'pepco'
  AND ca.external_application_id IS NOT NULL
  AND btrim(ca.external_application_id) <> ''
  AND cr.user_id IS NOT NULL
ON CONFLICT (owner_user_id, provider_slug, external_application_id) DO NOTHING;

INSERT INTO public.uci_portal_harvest_items (
  provider_slug,
  external_application_id,
  owner_user_id,
  tenant_id,
  portal_status,
  portal_milestone,
  external_job_id,
  snapshot,
  last_synced_at
)
SELECT
  'pepco',
  app ->> 'applicationUuid',
  cr.user_id,
  cr.tenant_id,
  NULLIF(app ->> 'currentStatus', ''),
  NULLIF(app ->> 'currentMilestone', ''),
  NULLIF(app #>> '{overview,jobId}', ''),
  app,
  cr.updated_at
FROM public.coordination_records cr
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(cr.metadata #> '{pepco_application_detail_discovery,applications}') = 'array'
      THEN cr.metadata #> '{pepco_application_detail_discovery,applications}'
    ELSE '[]'::jsonb
  END
) AS detail(app)
JOIN public.utility_providers up ON up.id = cr.utility_provider_id
WHERE lower(up.slug) = 'pepco'
  AND cr.user_id IS NOT NULL
  AND NULLIF(btrim(app ->> 'applicationUuid'), '') IS NOT NULL
ON CONFLICT (owner_user_id, provider_slug, external_application_id) DO NOTHING;

INSERT INTO public.uci_portal_harvest_items (
  provider_slug,
  external_application_id,
  owner_user_id,
  tenant_id,
  portal_status,
  portal_milestone,
  external_job_id,
  snapshot,
  last_synced_at
)
SELECT
  'pepco',
  card ->> 'applicationId',
  cr.user_id,
  cr.tenant_id,
  COALESCE(NULLIF(card ->> 'currentStatus', ''), NULLIF(card ->> 'status', '')),
  COALESCE(NULLIF(card ->> 'currentMilestone', ''), NULLIF(card ->> 'milestone', '')),
  COALESCE(NULLIF(card ->> 'jobId', ''), NULLIF(card ->> 'externalJobId', '')),
  card,
  cr.updated_at
FROM public.coordination_records cr
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(cr.metadata #> '{pepco_dashboard_discovery,cards}') = 'array'
      THEN cr.metadata #> '{pepco_dashboard_discovery,cards}'
    ELSE '[]'::jsonb
  END
) AS dashboard(card)
JOIN public.utility_providers up ON up.id = cr.utility_provider_id
WHERE lower(up.slug) = 'pepco'
  AND cr.user_id IS NOT NULL
  AND NULLIF(btrim(card ->> 'applicationId'), '') IS NOT NULL
ON CONFLICT (owner_user_id, provider_slug, external_application_id) DO NOTHING;
