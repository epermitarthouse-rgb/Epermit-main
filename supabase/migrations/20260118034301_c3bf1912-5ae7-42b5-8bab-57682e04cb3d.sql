-- Add timezone column to scheduled_checklist_reports
ALTER TABLE public.scheduled_checklist_reports 
ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York';

-- Add comment for documentation
COMMENT ON COLUMN public.scheduled_checklist_reports.timezone IS 'IANA timezone identifier for when reports should be sent';