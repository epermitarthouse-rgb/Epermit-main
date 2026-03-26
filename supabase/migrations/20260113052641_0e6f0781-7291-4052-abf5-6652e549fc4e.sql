-- Create inspection status enum
CREATE TYPE public.inspection_status AS ENUM (
  'scheduled',
  'in_progress',
  'passed',
  'failed',
  'conditional',
  'cancelled'
);

-- Create inspection type enum
CREATE TYPE public.inspection_type AS ENUM (
  'foundation',
  'framing',
  'electrical_rough',
  'electrical_final',
  'plumbing_rough',
  'plumbing_final',
  'mechanical_rough',
  'mechanical_final',
  'insulation',
  'drywall',
  'fire_safety',
  'final',
  'other'
);

-- Create punch list item status enum
CREATE TYPE public.punch_list_status AS ENUM (
  'open',
  'in_progress',
  'resolved',
  'verified'
);

-- Create punch list priority enum
CREATE TYPE public.punch_list_priority AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

-- Create inspections table
CREATE TABLE public.inspections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  inspection_type inspection_type NOT NULL,
  status inspection_status NOT NULL DEFAULT 'scheduled',
  scheduled_date TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_date TIMESTAMP WITH TIME ZONE,
  inspector_name TEXT,
  inspector_notes TEXT,
  result_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create punch list items table
CREATE TABLE public.punch_list_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  priority punch_list_priority NOT NULL DEFAULT 'medium',
  status punch_list_status NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  due_date TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punch_list_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for inspections (using existing has_project_access function)
CREATE POLICY "Users can view inspections for accessible projects"
ON public.inspections
FOR SELECT
USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create inspections for accessible projects"
ON public.inspections
FOR INSERT
WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update inspections for accessible projects"
ON public.inspections
FOR UPDATE
USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete inspections for accessible projects"
ON public.inspections
FOR DELETE
USING (has_project_access(auth.uid(), project_id));

-- RLS policies for punch list items
CREATE POLICY "Users can view punch list for accessible projects"
ON public.punch_list_items
FOR SELECT
USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create punch list items for accessible projects"
ON public.punch_list_items
FOR INSERT
WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update punch list items for accessible projects"
ON public.punch_list_items
FOR UPDATE
USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete punch list items for accessible projects"
ON public.punch_list_items
FOR DELETE
USING (has_project_access(auth.uid(), project_id));

-- Triggers for updated_at
CREATE TRIGGER update_inspections_updated_at
BEFORE UPDATE ON public.inspections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_punch_list_items_updated_at
BEFORE UPDATE ON public.punch_list_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();