-- Architecture Replication Checklist overlay tables (admin-only).
-- Matrix architecture content remains in repo JSON/CSV/MD.
-- These tables store ONLY human-authored operational checklist state.
--
-- DO NOT APPLY in this task. Railway development currently shares the
-- production Supabase project — applying this migration is a production
-- schema change and requires explicit owner approval.

CREATE TABLE IF NOT EXISTS public.architecture_replication_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  matrix_row_id TEXT NOT NULL UNIQUE,
  implementation_status TEXT NOT NULL DEFAULT 'Audited'
    CHECK (implementation_status IN (
      'Not reviewed',
      'Audited',
      'Ready for implementation',
      'In progress',
      'Implemented',
      'Blocked',
      'Do not implement'
    )),
  verification_status TEXT NOT NULL DEFAULT 'Not tested'
    CHECK (verification_status IN (
      'Not tested',
      'Code inspected',
      'Visual checked',
      'Functional checked',
      'E2E checked',
      'Client approved'
    )),
  assigned_owner TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  blocker_description TEXT,
  implementation_commit TEXT,
  preview_url TEXT,
  test_evidence TEXT,
  last_tested_at TIMESTAMPTZ,
  client_approved_at TIMESTAMPTZ,
  client_feedback TEXT,
  completion_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_architecture_replication_items_status
  ON public.architecture_replication_items (implementation_status, verification_status);

CREATE INDEX IF NOT EXISTS idx_architecture_replication_items_blocked
  ON public.architecture_replication_items (is_blocked);

CREATE TABLE IF NOT EXISTS public.architecture_replication_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  matrix_row_id TEXT NOT NULL,
  comment_type TEXT NOT NULL DEFAULT 'General'
    CHECK (comment_type IN (
      'General',
      'UI mismatch',
      'Functional gap',
      'Backend preservation',
      'Bug',
      'Blocker',
      'Test result',
      'Client feedback',
      'Decision'
    )),
  comment_text TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_architecture_replication_comments_row
  ON public.architecture_replication_comments (matrix_row_id, created_at DESC);

DROP TRIGGER IF EXISTS architecture_replication_items_updated_at
  ON public.architecture_replication_items;
CREATE TRIGGER architecture_replication_items_updated_at
  BEFORE UPDATE ON public.architecture_replication_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.architecture_replication_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.architecture_replication_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can manage architecture replication items"
  ON public.architecture_replication_items;
CREATE POLICY "Platform admins can manage architecture replication items"
ON public.architecture_replication_items
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Platform admins can manage architecture replication comments"
  ON public.architecture_replication_comments;
CREATE POLICY "Platform admins can manage architecture replication comments"
ON public.architecture_replication_comments
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
