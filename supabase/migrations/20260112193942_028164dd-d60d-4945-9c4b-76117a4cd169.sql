-- Create email_branding_settings table for storing customizable email template settings
CREATE TABLE public.email_branding_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#0f766e',
  header_text TEXT NOT NULL DEFAULT 'PermitPilot',
  footer_text TEXT NOT NULL DEFAULT '© 2024 PermitPilot. All rights reserved.',
  unsubscribe_text TEXT NOT NULL DEFAULT 'Unsubscribe from these notifications',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_branding_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can view branding settings
CREATE POLICY "Admins can view branding settings"
ON public.email_branding_settings
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can insert branding settings
CREATE POLICY "Admins can insert branding settings"
ON public.email_branding_settings
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can update branding settings
CREATE POLICY "Admins can update branding settings"
ON public.email_branding_settings
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

-- Create trigger for updated_at
CREATE TRIGGER update_email_branding_settings_updated_at
BEFORE UPDATE ON public.email_branding_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings row
INSERT INTO public.email_branding_settings (header_text, footer_text, primary_color)
VALUES ('PermitPilot', '© 2024 PermitPilot. All rights reserved.', '#0f766e');