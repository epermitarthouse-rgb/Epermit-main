-- Parsed permit comments from Comment Parser Agent (Phase 2: AI Vision Extraction)
CREATE TABLE public.parsed_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  original_text TEXT NOT NULL,
  discipline TEXT NOT NULL,
  code_reference TEXT,
  status TEXT NOT NULL DEFAULT 'Pending Review' CHECK (status IN ('Pending Review', 'Pending', 'Approved', 'Rejected')),
  page_number INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.parsed_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view parsed_comments for own projects"
ON public.parsed_comments
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = parsed_comments.project_id AND p.user_id = auth.uid())
);

CREATE POLICY "Users can insert parsed_comments for own projects"
ON public.parsed_comments
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = parsed_comments.project_id AND p.user_id = auth.uid())
);

CREATE POLICY "Users can update parsed_comments for own projects"
ON public.parsed_comments
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = parsed_comments.project_id AND p.user_id = auth.uid())
);

CREATE POLICY "Users can delete parsed_comments for own projects"
ON public.parsed_comments
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = parsed_comments.project_id AND p.user_id = auth.uid())
);

CREATE INDEX idx_parsed_comments_project_id ON public.parsed_comments(project_id);
CREATE INDEX idx_parsed_comments_status ON public.parsed_comments(status);
