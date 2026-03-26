-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Service role can manage all campaigns" ON public.user_drip_campaigns;

-- Create more specific policies for user operations
CREATE POLICY "Users can insert their own drip campaigns"
ON public.user_drip_campaigns
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own drip campaigns"
ON public.user_drip_campaigns
FOR UPDATE
USING (auth.uid() = user_id);