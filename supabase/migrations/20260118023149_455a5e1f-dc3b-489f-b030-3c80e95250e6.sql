-- Create scheduled checklist reports table
CREATE TABLE public.scheduled_checklist_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  project_filter TEXT DEFAULT 'all',
  status_filter TEXT DEFAULT 'all',
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
  day_of_month INTEGER CHECK (day_of_month >= 1 AND day_of_month <= 28),
  send_time TIME DEFAULT '09:00:00',
  is_active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMP WITH TIME ZONE,
  next_send_at TIMESTAMP WITH TIME ZONE,
  email_subject TEXT,
  email_intro TEXT,
  include_summary BOOLEAN DEFAULT true,
  include_details BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scheduled_checklist_reports ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own scheduled reports"
ON public.scheduled_checklist_reports
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own scheduled reports"
ON public.scheduled_checklist_reports
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scheduled reports"
ON public.scheduled_checklist_reports
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scheduled reports"
ON public.scheduled_checklist_reports
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_scheduled_checklist_reports_updated_at
BEFORE UPDATE ON public.scheduled_checklist_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();