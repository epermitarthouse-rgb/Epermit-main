-- Fix project document upload RLS for tenant members and project team editors.
--
-- Root cause (production):
--   project_documents INSERT requires has_project_access, which only checks project
--   owner + project_team_members. Tenant org members (tenant_memberships) could reach
--   Documents/UCI flows but failed with:
--     42501 new row violates row-level security policy for table "project_documents"
--
-- Fix:
--   1. Extend has_project_access / has_project_editor_access with tenant membership
--      on tenant-scoped projects (respecting can_access_tenant demo isolation).
--   2. Align project_documents mutations with parsed_comments: editor access for writes.
--   3. Harden project-documents storage policies: editor check on upload; project access
--      on read/update/delete so team/tenant collaborators can access shared files.

CREATE OR REPLACE FUNCTION public.has_project_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.project_team_members
    WHERE project_id = _project_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.tenant_memberships tm ON tm.tenant_id = p.tenant_id
    WHERE p.id = _project_id
      AND p.tenant_id IS NOT NULL
      AND tm.user_id = _user_id
      AND public.can_access_tenant(_user_id, p.tenant_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.has_project_editor_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.project_team_members
    WHERE project_id = _project_id
      AND user_id = _user_id
      AND role IN ('owner', 'admin', 'editor')
  ) OR EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.tenant_memberships tm ON tm.tenant_id = p.tenant_id
    WHERE p.id = _project_id
      AND p.tenant_id IS NOT NULL
      AND tm.user_id = _user_id
      AND tm.role IN ('owner', 'admin', 'member')
      AND public.can_access_tenant(_user_id, p.tenant_id)
  )
$$;

-- project_documents: viewers may read; editors upload/update/delete.
DROP POLICY IF EXISTS "Users can view documents for accessible projects" ON public.project_documents;
CREATE POLICY "Users can view documents for accessible projects"
  ON public.project_documents
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can insert documents for accessible projects" ON public.project_documents;
DROP POLICY IF EXISTS "Users can insert documents for editable projects" ON public.project_documents;
CREATE POLICY "Users can insert documents for editable projects"
  ON public.project_documents
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.has_project_editor_access(auth.uid(), project_id)
  );

DROP POLICY IF EXISTS "Users can update documents for accessible projects" ON public.project_documents;
DROP POLICY IF EXISTS "Users can update documents for editable projects" ON public.project_documents;
CREATE POLICY "Users can update documents for editable projects"
  ON public.project_documents
  FOR UPDATE
  USING (public.has_project_editor_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can delete documents for accessible projects" ON public.project_documents;
DROP POLICY IF EXISTS "Users can delete documents for editable projects" ON public.project_documents;
CREATE POLICY "Users can delete documents for editable projects"
  ON public.project_documents
  FOR DELETE
  USING (public.has_project_editor_access(auth.uid(), project_id));

-- project-documents storage bucket: path is {uploader_user_id}/{project_id}/{object_id}_{filename}
DROP POLICY IF EXISTS "Users can upload to their project folders" ON storage.objects;
CREATE POLICY "Users can upload to their project folders"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'project-documents'
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND (storage.foldername(name))[2] IS NOT NULL
    AND public.has_project_editor_access(
      auth.uid(),
      ((storage.foldername(name))[2])::uuid
    )
  );

DROP POLICY IF EXISTS "Users can view their project documents" ON storage.objects;
CREATE POLICY "Users can view their project documents"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'project-documents'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[2] IS NOT NULL
        AND public.has_project_access(
          auth.uid(),
          ((storage.foldername(name))[2])::uuid
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can update their project documents" ON storage.objects;
CREATE POLICY "Users can update their project documents"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'project-documents'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[2] IS NOT NULL
        AND public.has_project_editor_access(
          auth.uid(),
          ((storage.foldername(name))[2])::uuid
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete their project documents" ON storage.objects;
CREATE POLICY "Users can delete their project documents"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'project-documents'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[2] IS NOT NULL
        AND public.has_project_editor_access(
          auth.uid(),
          ((storage.foldername(name))[2])::uuid
        )
      )
    )
  );

GRANT EXECUTE ON FUNCTION public.has_project_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_editor_access(UUID, UUID) TO authenticated;
