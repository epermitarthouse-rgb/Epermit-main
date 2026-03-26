-- Create jurisdictions table
CREATE TABLE IF NOT EXISTS public.jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state text NOT NULL,
  city text,
  county text,
  
  -- Contact info
  website_url text,
  phone text,
  email text,
  address text,
  
  -- Reviewer contacts (JSONB array for multiple contacts)
  reviewer_contacts jsonb DEFAULT '[]'::jsonb,
  
  -- Fee structure
  base_permit_fee numeric DEFAULT 0,
  plan_review_fee numeric DEFAULT 0,
  inspection_fee numeric DEFAULT 0,
  fee_notes text,
  fee_schedule_url text,
  
  -- SLA / Processing times (in business days)
  plan_review_sla_days integer,
  permit_issuance_sla_days integer,
  inspection_sla_days integer,
  expedited_available boolean DEFAULT false,
  expedited_fee_multiplier numeric DEFAULT 1.5,
  
  -- Additional info
  submission_methods text[], -- e.g., ['online', 'in-person', 'mail']
  accepted_file_formats text[], -- e.g., ['pdf', 'dwg']
  special_requirements text,
  notes text,
  
  -- Status
  is_active boolean DEFAULT true,
  last_verified_at timestamp with time zone,
  verified_by uuid,
  
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  
  UNIQUE(name, state)
);

-- Enable RLS
ALTER TABLE public.jurisdictions ENABLE ROW LEVEL SECURITY;

-- Everyone can read active jurisdictions
CREATE POLICY "Anyone can view active jurisdictions"
ON public.jurisdictions
FOR SELECT
USING (is_active = true OR has_role(auth.uid(), 'admin'));

-- Only admins can insert
CREATE POLICY "Admins can insert jurisdictions"
ON public.jurisdictions
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Only admins can update
CREATE POLICY "Admins can update jurisdictions"
ON public.jurisdictions
FOR UPDATE
USING (has_role(auth.uid(), 'admin'));

-- Only admins can delete
CREATE POLICY "Admins can delete jurisdictions"
ON public.jurisdictions
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Create updated_at trigger
CREATE TRIGGER update_jurisdictions_updated_at
  BEFORE UPDATE ON public.jurisdictions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for searching
CREATE INDEX idx_jurisdictions_state ON public.jurisdictions(state);
CREATE INDEX idx_jurisdictions_name ON public.jurisdictions(name);
CREATE INDEX idx_jurisdictions_active ON public.jurisdictions(is_active);