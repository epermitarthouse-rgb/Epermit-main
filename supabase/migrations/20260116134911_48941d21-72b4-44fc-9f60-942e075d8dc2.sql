-- Create a table for inspection checklist templates
CREATE TABLE public.inspection_checklist_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  inspection_type TEXT NOT NULL,
  description TEXT,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique index for default templates per user per inspection type
CREATE UNIQUE INDEX idx_unique_default_template 
ON public.inspection_checklist_templates (user_id, inspection_type) 
WHERE is_default = true;

-- Enable Row Level Security
ALTER TABLE public.inspection_checklist_templates ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own templates" 
ON public.inspection_checklist_templates 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own templates" 
ON public.inspection_checklist_templates 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own templates" 
ON public.inspection_checklist_templates 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own templates" 
ON public.inspection_checklist_templates 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_inspection_checklist_templates_updated_at
BEFORE UPDATE ON public.inspection_checklist_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();