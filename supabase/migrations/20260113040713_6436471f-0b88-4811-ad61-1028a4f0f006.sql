-- Create admin activity log table
CREATE TABLE public.admin_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID NOT NULL,
  admin_email TEXT NOT NULL,
  action_type TEXT NOT NULL,
  jurisdiction_id TEXT,
  jurisdiction_name TEXT,
  notification_title TEXT,
  notification_message TEXT,
  subscriber_count INTEGER DEFAULT 0,
  email_sent BOOLEAN DEFAULT false,
  delivery_status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

-- Admins can view all activity logs
CREATE POLICY "Admins can view activity logs"
ON public.admin_activity_log
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert activity logs
CREATE POLICY "Admins can insert activity logs"
ON public.admin_activity_log
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Create index for faster queries
CREATE INDEX idx_admin_activity_log_created_at ON public.admin_activity_log(created_at DESC);
CREATE INDEX idx_admin_activity_log_admin_user_id ON public.admin_activity_log(admin_user_id);