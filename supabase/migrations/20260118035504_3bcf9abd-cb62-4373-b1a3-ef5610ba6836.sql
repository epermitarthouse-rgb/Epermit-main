-- Add include_pdf_attachment column to scheduled_checklist_reports
ALTER TABLE public.scheduled_checklist_reports
ADD COLUMN include_pdf_attachment BOOLEAN DEFAULT false;