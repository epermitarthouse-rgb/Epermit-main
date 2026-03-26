-- Add cost tracking column to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS permit_fee numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS expeditor_cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS rejection_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS rejection_reasons text[] DEFAULT '{}';

-- Create analytics summary view for permit cycle times
CREATE OR REPLACE VIEW public.project_analytics AS
SELECT 
  p.id,
  p.name,
  p.user_id,
  p.status,
  p.jurisdiction,
  p.project_type,
  p.permit_fee,
  p.expeditor_cost,
  p.total_cost,
  p.rejection_count,
  p.rejection_reasons,
  p.created_at,
  p.submitted_at,
  p.approved_at,
  -- Cycle time calculations (in days)
  CASE 
    WHEN p.submitted_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (p.submitted_at - p.created_at)) / 86400 
    ELSE NULL 
  END AS draft_to_submit_days,
  CASE 
    WHEN p.approved_at IS NOT NULL AND p.submitted_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (p.approved_at - p.submitted_at)) / 86400 
    ELSE NULL 
  END AS submit_to_approval_days,
  CASE 
    WHEN p.approved_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (p.approved_at - p.created_at)) / 86400 
    ELSE NULL 
  END AS total_cycle_days,
  -- Count related data
  (SELECT COUNT(*) FROM inspections i WHERE i.project_id = p.id) AS inspection_count,
  (SELECT COUNT(*) FROM inspections i WHERE i.project_id = p.id AND i.status = 'failed') AS failed_inspection_count,
  (SELECT COUNT(*) FROM punch_list_items pl WHERE pl.project_id = p.id) AS punch_list_count,
  (SELECT COUNT(*) FROM punch_list_items pl WHERE pl.project_id = p.id AND pl.status IN ('open', 'in_progress')) AS open_punch_items,
  (SELECT COUNT(*) FROM project_documents pd WHERE pd.project_id = p.id) AS document_count
FROM projects p;

-- Create RLS policy for the view (views inherit table RLS)
-- The view will use the projects table RLS policies

-- Create staff productivity tracking table
CREATE TABLE IF NOT EXISTS public.staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  assigned_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  hours_worked numeric DEFAULT 0,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS on staff_assignments
ALTER TABLE public.staff_assignments ENABLE ROW LEVEL SECURITY;

-- RLS policies for staff_assignments
CREATE POLICY "Users can view staff assignments for accessible projects"
ON public.staff_assignments
FOR SELECT
USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create staff assignments for accessible projects"
ON public.staff_assignments
FOR INSERT
WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update staff assignments for accessible projects"
ON public.staff_assignments
FOR UPDATE
USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete staff assignments for accessible projects"
ON public.staff_assignments
FOR DELETE
USING (has_project_access(auth.uid(), project_id));

-- Create trigger for updated_at
CREATE TRIGGER update_staff_assignments_updated_at
  BEFORE UPDATE ON public.staff_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();