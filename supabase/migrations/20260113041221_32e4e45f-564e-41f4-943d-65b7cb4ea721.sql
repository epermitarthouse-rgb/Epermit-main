-- Create scheduled notifications table
CREATE TABLE public.scheduled_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID NOT NULL,
  admin_email TEXT NOT NULL,
  jurisdiction_id TEXT NOT NULL,
  jurisdiction_name TEXT NOT NULL,
  notification_title TEXT NOT NULL,
  notification_message TEXT NOT NULL,
  send_email BOOLEAN DEFAULT true,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  processed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;

-- Admins can view all scheduled notifications
CREATE POLICY "Admins can view scheduled notifications"
ON public.scheduled_notifications
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert scheduled notifications
CREATE POLICY "Admins can insert scheduled notifications"
ON public.scheduled_notifications
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Admins can update scheduled notifications
CREATE POLICY "Admins can update scheduled notifications"
ON public.scheduled_notifications
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can delete scheduled notifications
CREATE POLICY "Admins can delete scheduled notifications"
ON public.scheduled_notifications
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create indexes
CREATE INDEX idx_scheduled_notifications_status ON public.scheduled_notifications(status);
CREATE INDEX idx_scheduled_notifications_scheduled_for ON public.scheduled_notifications(scheduled_for);

-- Enable pg_cron and pg_net extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Grant usage to postgres role for cron
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;