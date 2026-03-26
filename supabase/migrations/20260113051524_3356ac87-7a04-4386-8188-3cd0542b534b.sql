-- Create storage bucket for project documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-documents', 
  'project-documents', 
  false,
  52428800, -- 50MB limit
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'application/dwg', 'application/dxf', 'application/zip', 'application/x-zip-compressed']
);

-- Create document_type enum
CREATE TYPE public.document_type AS ENUM (
  'permit_drawing',
  'submittal_package', 
  'structural_calcs',
  'site_plan',
  'floor_plan',
  'elevation',
  'specification',
  'inspection_report',
  'correspondence',
  'other'
);

-- Create project_documents table
CREATE TABLE public.project_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  document_type public.document_type NOT NULL DEFAULT 'other',
  version INTEGER NOT NULL DEFAULT 1,
  parent_document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can manage documents for their own projects
CREATE POLICY "Users can view documents for their projects"
ON public.project_documents
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects 
    WHERE projects.id = project_documents.project_id 
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert documents for their projects"
ON public.project_documents
FOR INSERT
WITH CHECK (
  auth.uid() = user_id AND
  EXISTS (
    SELECT 1 FROM public.projects 
    WHERE projects.id = project_documents.project_id 
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update documents for their projects"
ON public.project_documents
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.projects 
    WHERE projects.id = project_documents.project_id 
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete documents for their projects"
ON public.project_documents
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects 
    WHERE projects.id = project_documents.project_id 
    AND projects.user_id = auth.uid()
  )
);

-- Storage policies for project-documents bucket
CREATE POLICY "Users can upload to their project folders"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'project-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their project documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'project-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their project documents"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'project-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their project documents"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'project-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Trigger for updated_at
CREATE TRIGGER update_project_documents_updated_at
BEFORE UPDATE ON public.project_documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();