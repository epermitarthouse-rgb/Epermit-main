-- Create storage bucket for inspection photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-photos', 'inspection-photos', true);

-- Create storage policies for inspection photos bucket
CREATE POLICY "Users can view inspection photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'inspection-photos');

CREATE POLICY "Authenticated users can upload inspection photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'inspection-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own inspection photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'inspection-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own inspection photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'inspection-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create table for inspection photo metadata
CREATE TABLE public.inspection_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE CASCADE,
  punch_list_item_id UUID REFERENCES public.punch_list_items(id) ON DELETE CASCADE,
  checklist_item_id TEXT,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  caption TEXT,
  location TEXT,
  taken_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inspection_photos ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view photos for their projects"
ON public.inspection_photos FOR SELECT
USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM public.projects 
    WHERE id = project_id AND user_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM public.project_team_members
    WHERE project_id = inspection_photos.project_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can upload photos"
ON public.inspection_photos FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own photos"
ON public.inspection_photos FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own photos"
ON public.inspection_photos FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_inspection_photos_updated_at
BEFORE UPDATE ON public.inspection_photos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_inspection_photos_project ON public.inspection_photos(project_id);
CREATE INDEX idx_inspection_photos_inspection ON public.inspection_photos(inspection_id);
CREATE INDEX idx_inspection_photos_punch_list ON public.inspection_photos(punch_list_item_id);
CREATE INDEX idx_inspection_photos_checklist_item ON public.inspection_photos(checklist_item_id);