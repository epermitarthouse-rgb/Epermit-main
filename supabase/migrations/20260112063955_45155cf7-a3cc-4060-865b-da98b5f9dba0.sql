-- Create table for jurisdiction subscriptions
CREATE TABLE public.jurisdiction_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  jurisdiction_id TEXT NOT NULL,
  jurisdiction_name TEXT NOT NULL,
  jurisdiction_state TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint to prevent duplicate subscriptions
CREATE UNIQUE INDEX idx_jurisdiction_subscriptions_unique 
ON public.jurisdiction_subscriptions (user_id, jurisdiction_id);

-- Enable Row Level Security
ALTER TABLE public.jurisdiction_subscriptions ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own subscriptions" 
ON public.jurisdiction_subscriptions 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own subscriptions" 
ON public.jurisdiction_subscriptions 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own subscriptions" 
ON public.jurisdiction_subscriptions 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create table for jurisdiction code update notifications
CREATE TABLE public.jurisdiction_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  jurisdiction_id TEXT NOT NULL,
  jurisdiction_name TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.jurisdiction_notifications ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own notifications" 
ON public.jurisdiction_notifications 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications" 
ON public.jurisdiction_notifications 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notifications" 
ON public.jurisdiction_notifications 
FOR DELETE 
USING (auth.uid() = user_id);

-- Allow insert for system/service role (for triggering notifications)
CREATE POLICY "System can insert notifications" 
ON public.jurisdiction_notifications 
FOR INSERT 
WITH CHECK (true);

-- Add indexes for performance
CREATE INDEX idx_jurisdiction_notifications_user_id ON public.jurisdiction_notifications (user_id);
CREATE INDEX idx_jurisdiction_notifications_unread ON public.jurisdiction_notifications (user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_jurisdiction_subscriptions_user_id ON public.jurisdiction_subscriptions (user_id);