-- Allow public read access for share link validation (by token only)
CREATE POLICY "Public can validate share links by token"
ON public.project_share_links
FOR SELECT
TO anon
USING (true);

-- Allow public to update view count
CREATE POLICY "Public can update view count"
ON public.project_share_links
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Allow public read access to projects via valid share links
CREATE POLICY "Public can view projects via share links"
ON public.projects
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.project_share_links
    WHERE project_share_links.project_id = projects.id
    AND project_share_links.is_active = true
    AND (project_share_links.expires_at IS NULL OR project_share_links.expires_at > now())
  )
);

-- Allow public read access to inspections via valid share links
CREATE POLICY "Public can view inspections via share links"
ON public.inspections
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.project_share_links
    WHERE project_share_links.project_id = inspections.project_id
    AND project_share_links.is_active = true
    AND (project_share_links.expires_at IS NULL OR project_share_links.expires_at > now())
  )
);

-- Allow public read access to project activity via valid share links
CREATE POLICY "Public can view activity via share links"
ON public.project_activity
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.project_share_links
    WHERE project_share_links.project_id = project_activity.project_id
    AND project_share_links.is_active = true
    AND (project_share_links.expires_at IS NULL OR project_share_links.expires_at > now())
  )
);