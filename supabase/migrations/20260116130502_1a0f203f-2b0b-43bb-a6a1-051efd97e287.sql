-- Create enum for e-permit submission status
CREATE TYPE public.epermit_status AS ENUM (
  'pending',
  'submitted',
  'under_review',
  'additional_info_required',
  'approved',
  'denied',
  'cancelled',
  'expired'
);

-- Create enum for e-permit system type
CREATE TYPE public.epermit_system AS ENUM ('accela', 'cityview');

-- Create table for tracking e-permit submissions
CREATE TABLE public.epermit_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  system epermit_system NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  tracking_number TEXT,
  record_id TEXT,
  permit_type TEXT NOT NULL,
  status epermit_status NOT NULL DEFAULT 'pending',
  status_message TEXT,
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  submitted_at TIMESTAMP WITH TIME ZONE,
  last_status_check TIMESTAMP WITH TIME ZONE,
  status_history JSONB DEFAULT '[]'::jsonb,
  response_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.epermit_submissions ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own submissions" 
ON public.epermit_submissions 
FOR SELECT 
USING (auth.uid() = user_id OR public.has_project_access(project_id, auth.uid()));

CREATE POLICY "Users can create submissions for their projects" 
ON public.epermit_submissions 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own submissions" 
ON public.epermit_submissions 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX idx_epermit_submissions_project ON public.epermit_submissions(project_id);
CREATE INDEX idx_epermit_submissions_user ON public.epermit_submissions(user_id);
CREATE INDEX idx_epermit_submissions_tracking ON public.epermit_submissions(tracking_number);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_epermit_submissions_updated_at
BEFORE UPDATE ON public.epermit_submissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.epermit_submissions;