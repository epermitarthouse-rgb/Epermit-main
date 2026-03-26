-- Create a table to track scheduled report delivery history
CREATE TABLE public.scheduled_report_delivery_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.scheduled_checklist_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  report_name TEXT NOT NULL,
  recipient_emails TEXT[] NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  successful_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  failed_emails TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'success', -- 'success', 'partial', 'failed'
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scheduled_report_delivery_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own delivery logs
CREATE POLICY "Users can view their own delivery logs"
  ON public.scheduled_report_delivery_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert logs (from edge function)
CREATE POLICY "Service role can insert delivery logs"
  ON public.scheduled_report_delivery_logs
  FOR INSERT
  WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_delivery_logs_report_id ON public.scheduled_report_delivery_logs(report_id);
CREATE INDEX idx_delivery_logs_user_id ON public.scheduled_report_delivery_logs(user_id);
CREATE INDEX idx_delivery_logs_sent_at ON public.scheduled_report_delivery_logs(sent_at DESC);