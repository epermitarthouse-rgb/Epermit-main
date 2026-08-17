-- Reopen only the synthetic Agent 3 package review exercised by backend testing.
-- Agent 2 verified inputs, package mappings, signatures, validation evidence, and lifecycle rows remain unchanged.
DO $$
DECLARE
  target_application_id CONSTANT UUID := '6314b620-8cc3-4642-a08c-28c2949e921f';
  target_coordination_id CONSTANT UUID := '1a2b4b06-a7f9-4b17-96ca-f757be8e0c69';
  matched_rows INTEGER;
BEGIN
  UPDATE public.coordination_applications
  SET
    draft_status = 'draft',
    reviewed_by = NULL,
    reviewed_at = NULL,
    agent_draft_metadata = jsonb_set(
      agent_draft_metadata #- '{application_package,last_review}',
      '{application_package,package_review}',
      jsonb_build_object(
        'version', 'agent-3-package-review-v1',
        'status', 'not_reviewed',
        'items', '{}'::jsonb,
        'reset_at', now(),
        'reset_reason', 'Reopened for explicit operator package-mapping review'
      ),
      true
    )
  WHERE id = target_application_id
    AND coordination_record_id = target_coordination_id
    AND record_source = 'agent_draft'
    AND idempotency_key = 'agent_3_application_package:d3-v1';

  GET DIAGNOSTICS matched_rows = ROW_COUNT;
  IF matched_rows <> 1 THEN
    RAISE EXCEPTION
      'Highland Springs package review reset expected 1 row, matched %',
      matched_rows;
  END IF;
END
$$;
