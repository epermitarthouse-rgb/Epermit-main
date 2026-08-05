
CREATE TYPE public.access_audit_event AS ENUM ('sign_in','sign_in_failed','sign_out','access_denied');

CREATE TABLE public.access_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  event_type public.access_audit_event NOT NULL,
  role_at_event text,
  path text,
  reason text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_audit_log_created_at_idx ON public.access_audit_log (created_at DESC);
CREATE INDEX access_audit_log_event_type_idx ON public.access_audit_log (event_type);
CREATE INDEX access_audit_log_email_idx ON public.access_audit_log (lower(email));

GRANT SELECT, INSERT ON public.access_audit_log TO authenticated;
GRANT INSERT ON public.access_audit_log TO anon;
GRANT ALL ON public.access_audit_log TO service_role;

ALTER TABLE public.access_audit_log ENABLE ROW LEVEL SECURITY;

-- Anyone may append allowed event types; auth'd users must match their own user_id if provided.
CREATE POLICY "Anon can log failed sign-ins"
  ON public.access_audit_log FOR INSERT TO anon
  WITH CHECK (event_type = 'sign_in_failed' AND user_id IS NULL);

CREATE POLICY "Authenticated can log their own events"
  ON public.access_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    event_type IN ('sign_in','sign_in_failed','sign_out','access_denied')
    AND (user_id IS NULL OR user_id = auth.uid())
  );

CREATE POLICY "Admins can read the audit log"
  ON public.access_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
