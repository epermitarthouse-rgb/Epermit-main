-- Create table to track drip email campaigns for users
CREATE TABLE public.user_drip_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  user_name TEXT,
  campaign_type TEXT NOT NULL DEFAULT 'onboarding',
  enrolled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  emails_sent INTEGER NOT NULL DEFAULT 0,
  last_email_sent_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_campaign UNIQUE (user_id, campaign_type)
);

-- Enable RLS
ALTER TABLE public.user_drip_campaigns ENABLE ROW LEVEL SECURITY;

-- Users can view their own campaigns
CREATE POLICY "Users can view their own drip campaigns"
ON public.user_drip_campaigns
FOR SELECT
USING (auth.uid() = user_id);

-- Service role can manage all campaigns (for edge functions)
CREATE POLICY "Service role can manage all campaigns"
ON public.user_drip_campaigns
FOR ALL
USING (true)
WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_user_drip_campaigns_updated_at
BEFORE UPDATE ON public.user_drip_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();