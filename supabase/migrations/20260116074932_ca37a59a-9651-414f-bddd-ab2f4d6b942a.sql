-- Create table for coverage requests
CREATE TABLE public.coverage_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  company_name TEXT,
  jurisdiction_name TEXT NOT NULL,
  city TEXT,
  state TEXT NOT NULL,
  county TEXT,
  project_type TEXT,
  estimated_permits_per_year INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.coverage_requests ENABLE ROW LEVEL SECURITY;

-- Allow anyone to submit a coverage request (public form)
CREATE POLICY "Anyone can submit coverage requests"
ON public.coverage_requests
FOR INSERT
WITH CHECK (true);

-- Only admins can view/manage coverage requests
CREATE POLICY "Admins can view coverage requests"
ON public.coverage_requests
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update coverage requests"
ON public.coverage_requests
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete coverage requests"
ON public.coverage_requests
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_coverage_requests_updated_at
BEFORE UPDATE ON public.coverage_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();