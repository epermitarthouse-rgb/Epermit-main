-- Phase 4: Portal Scraper Agent
-- Add login_url to portal_credentials and portal_status tracking to projects

-- Add login_url to portal_credentials with a sensible default for DC Accela/ProjectDox
ALTER TABLE public.portal_credentials
ADD COLUMN login_url TEXT NOT NULL DEFAULT 'https://washington-dc-us.avolvecloud.com/User/Index';

-- Track latest portal status and when it was last checked on the project
ALTER TABLE public.projects
ADD COLUMN portal_status TEXT,
ADD COLUMN last_checked_at TIMESTAMPTZ;

