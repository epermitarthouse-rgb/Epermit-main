-- Add project_id to portal_credentials to link each credential to exactly one project
ALTER TABLE public.portal_credentials
ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX idx_portal_credentials_project_id ON public.portal_credentials(project_id);
