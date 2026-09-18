-- Platform Control Phase 1: jurisdiction subscription integrity + CSV bulk upsert RPC
-- DO NOT apply until pre-flight audit queries below are reviewed in the target environment.

-- =============================================================================
-- PRE-FLIGHT AUDIT (run manually before applying):
--
-- 1) Invalid UUID jurisdiction_id values:
--    SELECT id, jurisdiction_id, jurisdiction_name, jurisdiction_state
--    FROM public.jurisdiction_subscriptions
--    WHERE jurisdiction_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--
-- 2) Orphan subscriptions (no matching jurisdiction):
--    SELECT js.id, js.jurisdiction_id, js.jurisdiction_name, js.jurisdiction_state
--    FROM public.jurisdiction_subscriptions js
--    LEFT JOIN public.jurisdictions j ON j.id::text = js.jurisdiction_id
--    WHERE j.id IS NULL;
--
-- 3) Subscription volume:
--    SELECT COUNT(*) AS total_subscriptions FROM public.jurisdiction_subscriptions;
--
-- Notes:
-- - jurisdiction_subscriptions.jurisdiction_id is currently TEXT storing jurisdiction UUID strings.
-- - Production audit (2026-09-18): 0 rows, 0 anomalies — safe to apply after manual review.
-- - If invalid/orphan rows exist, repair them first; this migration fails rather than deleting.
-- =============================================================================

DO $$
DECLARE
  v_invalid_count integer;
  v_orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.jurisdiction_subscriptions
  WHERE jurisdiction_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  SELECT COUNT(*) INTO v_orphan_count
  FROM public.jurisdiction_subscriptions js
  WHERE NOT EXISTS (
    SELECT 1 FROM public.jurisdictions j WHERE j.id::text = js.jurisdiction_id
  );

  IF v_invalid_count > 0 OR v_orphan_count > 0 THEN
    RAISE EXCEPTION
      'jurisdiction_subscriptions has % invalid UUID row(s) and % orphan row(s). Run pre-flight audit queries and repair before applying this migration.',
      v_invalid_count,
      v_orphan_count;
  END IF;
END $$;

-- Convert jurisdiction_id to UUID and enforce referential integrity
ALTER TABLE public.jurisdiction_subscriptions
  ALTER COLUMN jurisdiction_id TYPE uuid USING jurisdiction_id::uuid;

ALTER TABLE public.jurisdiction_subscriptions
  DROP CONSTRAINT IF EXISTS fk_jurisdiction_subscriptions_jurisdiction;

ALTER TABLE public.jurisdiction_subscriptions
  ADD CONSTRAINT fk_jurisdiction_subscriptions_jurisdiction
  FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_jurisdiction_subscriptions_jurisdiction_id
  ON public.jurisdiction_subscriptions(jurisdiction_id);

-- Keep denormalized subscription labels in sync when jurisdiction identity changes
CREATE OR REPLACE FUNCTION public.sync_jurisdiction_subscription_denorm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name OR OLD.state IS DISTINCT FROM NEW.state THEN
    UPDATE public.jurisdiction_subscriptions
    SET jurisdiction_name = NEW.name,
        jurisdiction_state = NEW.state
    WHERE jurisdiction_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_jurisdiction_subscription_denorm ON public.jurisdictions;
CREATE TRIGGER trg_sync_jurisdiction_subscription_denorm
AFTER UPDATE OF name, state ON public.jurisdictions
FOR EACH ROW
EXECUTE FUNCTION public.sync_jurisdiction_subscription_denorm();

-- Admin helper: subscription count for safe delete UX
CREATE OR REPLACE FUNCTION public.get_jurisdiction_subscription_count(p_jurisdiction_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN (
    SELECT COUNT(*)::integer
    FROM public.jurisdiction_subscriptions
    WHERE jurisdiction_id = p_jurisdiction_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_jurisdiction_subscription_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_jurisdiction_subscription_count(uuid) TO authenticated;

-- Admin CSV import: server-side dedup/upsert without loading full table in browser
CREATE OR REPLACE FUNCTION public.bulk_upsert_jurisdiction_volume(
  p_rows jsonb,
  p_mode text DEFAULT 'skip_existing'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row jsonb;
  v_state text;
  v_name text;
  v_existing_id uuid;
  v_imported integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_total_units integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_mode NOT IN ('skip_existing', 'upsert_volume') THEN
    RAISE EXCEPTION 'Invalid import mode: %', p_mode;
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  v_total := jsonb_array_length(p_rows);

  FOR row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    BEGIN
      v_state := upper(trim(coalesce(row->>'state', '')));
      v_name := trim(coalesce(row->>'place_name', ''));

      IF v_state = '' OR v_name = '' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'place_name', coalesce(row->>'place_name', ''),
          'state', coalesce(row->>'state', ''),
          'message', 'Missing state or place_name'
        ));
        CONTINUE;
      END IF;

      v_total_units := coalesce(nullif(row->>'total_units', '')::integer, 0);

      SELECT id INTO v_existing_id
      FROM public.jurisdictions
      WHERE lower(name) = lower(v_name) AND lower(state) = lower(v_state)
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        IF p_mode = 'skip_existing' THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        UPDATE public.jurisdictions
        SET
          fips_place = coalesce(nullif(trim(row->>'fips_place'), ''), fips_place),
          residential_units_2024 = v_total_units,
          sf_1unit_units_2024 = coalesce(nullif(row->>'sf_1unit_units', '')::integer, 0),
          duplex_units_2024 = coalesce(nullif(row->>'duplex_units', '')::integer, 0),
          mf_3plus_units_2024 = coalesce(nullif(row->>'mf_3plus_units', '')::integer, 0),
          is_high_volume = v_total_units >= 1000,
          data_source = coalesce(data_source, 'BPS 2024 CSV Import')
        WHERE id = v_existing_id;

        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.jurisdictions (
        name,
        state,
        fips_place,
        residential_units_2024,
        sf_1unit_units_2024,
        duplex_units_2024,
        mf_3plus_units_2024,
        is_high_volume,
        is_active,
        data_source,
        base_permit_fee,
        plan_review_fee,
        inspection_fee,
        expedited_available,
        expedited_fee_multiplier,
        reviewer_contacts
      ) VALUES (
        v_name,
        v_state,
        nullif(trim(row->>'fips_place'), ''),
        v_total_units,
        coalesce(nullif(row->>'sf_1unit_units', '')::integer, 0),
        coalesce(nullif(row->>'duplex_units', '')::integer, 0),
        coalesce(nullif(row->>'mf_3plus_units', '')::integer, 0),
        v_total_units >= 1000,
        true,
        'BPS 2024 CSV Import',
        0,
        0,
        0,
        false,
        1,
        '[]'::jsonb
      );

      v_imported := v_imported + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'place_name', coalesce(row->>'place_name', ''),
        'state', coalesce(row->>'state', ''),
        'message', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'imported', v_imported,
    'updated', v_updated,
    'skipped', v_skipped,
    'errors', v_errors,
    'error_count', jsonb_array_length(v_errors)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_upsert_jurisdiction_volume(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_jurisdiction_volume(jsonb, text) TO authenticated;
