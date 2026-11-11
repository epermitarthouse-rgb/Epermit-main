-- Central permit repository UI support (Phase 3). Additive.
-- module.central_permits defaults OFF: the /permits pages stay hidden until an admin enables it (A-6).
-- search_permits is SECURITY INVOKER, so RLS on permits and permit_review_comments decides what a caller sees.

INSERT INTO public.feature_flags (key, enabled, label, description, category)
VALUES (
  'module.central_permits',
  false,
  'Permit Repository',
  'Central permit repository at /permits and sync admin at /admin/permit-sync',
  'Modules'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._permit_prefix_tsquery(p_query TEXT)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN q = '' THEN NULL ELSE to_tsquery('simple', q) END
  FROM (
    SELECT coalesce(array_to_string(array(
      SELECT w || ':*' FROM regexp_split_to_table(lower(coalesce(p_query, '')), '[^a-z0-9]+') AS w WHERE w <> '' LIMIT 8
    ), ' & '), '') AS q
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.search_permits(
  p_query TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_jurisdiction TEXT DEFAULT NULL,
  p_include_removed BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  adapter_key TEXT,
  jurisdiction TEXT,
  permit_number TEXT,
  title TEXT,
  description TEXT,
  address TEXT,
  status TEXT,
  status_raw TEXT,
  review_type TEXT,
  unresolved_comments INTEGER,
  uncompleted_tasks INTEGER,
  last_synced_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  removed_from_portal_at TIMESTAMPTZ,
  matched_in TEXT,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH q AS (
    SELECT public._permit_prefix_tsquery(p_query) AS tsq,
           nullif(regexp_replace(upper(coalesce(p_query, '')), '[^A-Z0-9]', '', 'g'), '') AS num
  ),
  hits AS (
    SELECT p.*,
      CASE
        WHEN q.tsq IS NULL THEN NULL
        WHEN q.num IS NOT NULL AND p.permit_number_normalized LIKE q.num || '%' THEN 'permit_number'
        WHEN p.search_tsv @@ q.tsq THEN 'permit'
        WHEN EXISTS (
          SELECT 1 FROM public.permit_review_comments c
          WHERE c.permit_id = p.id AND c.removed_at IS NULL AND c.search_tsv @@ q.tsq
        ) THEN 'comments'
      END AS matched_in
    FROM public.permits p, q
    WHERE (p_status IS NULL OR p.status = p_status)
      AND (p_jurisdiction IS NULL OR p.jurisdiction = p_jurisdiction)
      AND (p_include_removed OR p.removed_from_portal_at IS NULL)
  )
  SELECT h.id, h.adapter_key, h.jurisdiction, h.permit_number, h.title, h.description, h.address,
         h.status, h.status_raw, h.review_type, h.unresolved_comments, h.uncompleted_tasks,
         h.last_synced_at, h.last_changed_at, h.removed_from_portal_at, h.matched_in,
         count(*) OVER () AS total_count
  FROM hits h, q
  WHERE q.tsq IS NULL OR h.matched_in IS NOT NULL
  ORDER BY h.last_changed_at DESC NULLS LAST, h.permit_number
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public._permit_prefix_tsquery(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_permits(text, text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._permit_prefix_tsquery(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_permits(text, text, text, boolean, integer, integer) TO authenticated;
