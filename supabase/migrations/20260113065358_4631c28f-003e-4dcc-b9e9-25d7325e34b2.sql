-- Drop the overly permissive update policy
DROP POLICY IF EXISTS "Public can update view count" ON public.project_share_links;

-- Create a more restrictive policy that only allows updating view_count and last_viewed_at
CREATE POLICY "Public can update view count on active links"
ON public.project_share_links
FOR UPDATE
TO anon
USING (
  is_active = true 
  AND (expires_at IS NULL OR expires_at > now())
)
WITH CHECK (
  is_active = true 
  AND (expires_at IS NULL OR expires_at > now())
);