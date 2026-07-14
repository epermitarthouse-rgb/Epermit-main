-- Production-grade project team invitation and membership flow.
-- Tokens stored as SHA-256 hashes; raw tokens returned only once from SECURITY DEFINER RPCs.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Schema hardening
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_invitations
  ADD COLUMN IF NOT EXISTS token_hash TEXT,
  ADD COLUMN IF NOT EXISTS accepted_by UUID,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill hashes from legacy UUID tokens before dropping the raw column.
UPDATE public.project_invitations
SET token_hash = encode(extensions.digest(token::text, 'sha256'), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

ALTER TABLE public.project_invitations
  DROP CONSTRAINT IF EXISTS project_invitations_project_id_email_status_key;

ALTER TABLE public.project_invitations
  DROP CONSTRAINT IF EXISTS project_invitations_status_check;

ALTER TABLE public.project_invitations
  ADD CONSTRAINT project_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked'));

DROP INDEX IF EXISTS public.idx_project_invitations_pending_email;
CREATE UNIQUE INDEX idx_project_invitations_pending_email
  ON public.project_invitations (project_id, lower(email))
  WHERE status = 'pending';

DROP INDEX IF EXISTS public.idx_project_invitations_token_hash;
CREATE UNIQUE INDEX idx_project_invitations_token_hash
  ON public.project_invitations (token_hash)
  WHERE token_hash IS NOT NULL;

ALTER TABLE public.project_invitations
  DROP COLUMN IF EXISTS token;

ALTER TABLE public.project_invitations
  ALTER COLUMN token_hash SET NOT NULL;

CREATE TRIGGER update_project_invitations_updated_at
BEFORE UPDATE ON public.project_invitations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._project_invitation_token_hash(p_token TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public._normalize_invite_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(p_email))
$$;

-- ---------------------------------------------------------------------------
-- Create invitation (owner/admin only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_project_team_invitation(
  p_project_id UUID,
  p_email TEXT,
  p_role public.team_role DEFAULT 'viewer'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := public._normalize_invite_email(p_email);
  v_token TEXT;
  v_hash TEXT;
  v_inv_id UUID;
  v_expires TIMESTAMPTZ;
  v_owner_id UUID;
  v_invitee_uid UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_project_admin_access(v_uid, p_project_id) THEN
    RAISE EXCEPTION 'Not authorized to invite team members' USING ERRCODE = '42501';
  END IF;

  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot invite as owner' USING ERRCODE = '22023';
  END IF;

  IF v_email IS NULL OR v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;

  SELECT user_id INTO v_owner_id FROM public.projects WHERE id = p_project_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_invitee_uid FROM auth.users WHERE lower(email) = v_email;

  IF v_invitee_uid IS NOT NULL AND v_invitee_uid = v_owner_id THEN
    RAISE EXCEPTION 'Project owner is already a member' USING ERRCODE = '23505';
  END IF;

  IF v_invitee_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.project_team_members
    WHERE project_id = p_project_id AND user_id = v_invitee_uid
  ) THEN
    RAISE EXCEPTION 'User is already a team member' USING ERRCODE = '23505';
  END IF;

  -- Revoke any existing pending invite for the same email (idempotent replace).
  UPDATE public.project_invitations
  SET status = 'revoked', revoked_at = now(), updated_at = now()
  WHERE project_id = p_project_id
    AND lower(email) = v_email
    AND status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := public._project_invitation_token_hash(v_token);
  v_expires := now() + INTERVAL '7 days';

  INSERT INTO public.project_invitations (
    project_id, email, role, invited_by, token_hash, status, expires_at
  ) VALUES (
    p_project_id, v_email, p_role, v_uid, v_hash, 'pending', v_expires
  )
  RETURNING id INTO v_inv_id;

  RETURN jsonb_build_object(
    'invitation_id', v_inv_id,
    'accept_token', v_token,
    'email', v_email,
    'role', p_role::text,
    'expires_at', v_expires,
    'replaced_pending', true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Preview invitation (public, token-only lookup — no raw IDs in response)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_project_team_invitation(p_accept_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
  v_inv public.project_invitations%ROWTYPE;
  v_project_name TEXT;
  v_inviter_name TEXT;
BEGIN
  IF p_accept_token IS NULL OR length(trim(p_accept_token)) < 16 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_token');
  END IF;

  v_hash := public._project_invitation_token_hash(p_accept_token);

  SELECT * INTO v_inv
  FROM public.project_invitations
  WHERE token_hash = v_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF v_inv.status = 'pending' AND v_inv.expires_at < now() THEN
    UPDATE public.project_invitations
    SET status = 'expired', updated_at = now()
    WHERE id = v_inv.id AND status = 'pending';
    v_inv.status := 'expired';
  END IF;

  SELECT name INTO v_project_name FROM public.projects WHERE id = v_inv.project_id;

  IF v_project_name IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'project_missing');
  END IF;

  SELECT COALESCE(full_name, 'A team member') INTO v_inviter_name
  FROM public.profiles
  WHERE user_id = v_inv.invited_by;

  RETURN jsonb_build_object(
    'valid', v_inv.status = 'pending',
    'status', v_inv.status,
    'project_name', v_project_name,
    'role', v_inv.role::text,
    'invited_email', v_inv.email,
    'inviter_name', v_inviter_name,
    'expires_at', v_inv.expires_at,
    'is_expired', v_inv.status = 'expired' OR (v_inv.status = 'pending' AND v_inv.expires_at < now())
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Accept invitation (atomic membership + status update)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_project_team_invitation(p_accept_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user_email TEXT;
  v_hash TEXT;
  v_inv public.project_invitations%ROWTYPE;
  v_already_member BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_accept_token IS NULL OR length(trim(p_accept_token)) < 16 THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023';
  END IF;

  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_uid;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User email not found' USING ERRCODE = 'P0002';
  END IF;

  v_hash := public._project_invitation_token_hash(p_accept_token);

  SELECT * INTO v_inv
  FROM public.project_invitations
  WHERE token_hash = v_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending' USING ERRCODE = '23505';
  END IF;

  IF v_inv.expires_at < now() THEN
    UPDATE public.project_invitations
    SET status = 'expired', updated_at = now()
    WHERE id = v_inv.id;
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '23505';
  END IF;

  IF lower(v_inv.email) <> v_user_email THEN
    RAISE EXCEPTION 'Signed-in email does not match invitation' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_inv.project_id) THEN
    RAISE EXCEPTION 'Project no longer exists' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_team_members
    WHERE project_id = v_inv.project_id AND user_id = v_uid
  ) THEN
    v_already_member := true;
  ELSE
    INSERT INTO public.project_team_members (project_id, user_id, role, added_by)
    VALUES (v_inv.project_id, v_uid, v_inv.role, v_inv.invited_by);
  END IF;

  UPDATE public.project_invitations
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by = v_uid,
      updated_at = now()
  WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'project_id', v_inv.project_id,
    'role', v_inv.role::text,
    'already_member', v_already_member
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Decline invitation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.decline_project_team_invitation(p_accept_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user_email TEXT;
  v_hash TEXT;
  v_inv public.project_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  v_hash := public._project_invitation_token_hash(p_accept_token);

  SELECT * INTO v_inv
  FROM public.project_invitations
  WHERE token_hash = v_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending' USING ERRCODE = '23505';
  END IF;

  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_uid;

  IF lower(v_inv.email) <> v_user_email THEN
    RAISE EXCEPTION 'Signed-in email does not match invitation' USING ERRCODE = '42501';
  END IF;

  UPDATE public.project_invitations
  SET status = 'declined', updated_at = now()
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('declined', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Revoke invitation (admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_project_team_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv public.project_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv
  FROM public.project_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_project_admin_access(v_uid, v_inv.project_id) THEN
    RAISE EXCEPTION 'Not authorized to revoke invitations' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending invitations can be revoked' USING ERRCODE = '23505';
  END IF;

  UPDATE public.project_invitations
  SET status = 'revoked', revoked_at = now(), updated_at = now()
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('revoked', true, 'invitation_id', v_inv.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Resend invitation — rotates token, enforces cooldown
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resend_project_team_invitation(
  p_invitation_id UUID,
  p_cooldown_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv public.project_invitations%ROWTYPE;
  v_token TEXT;
  v_hash TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv
  FROM public.project_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_project_admin_access(v_uid, v_inv.project_id) THEN
    RAISE EXCEPTION 'Not authorized to resend invitations' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending invitations can be resent' USING ERRCODE = '23505';
  END IF;

  IF v_inv.last_sent_at IS NOT NULL
     AND v_inv.last_sent_at > now() - (p_cooldown_seconds * interval '1 second') THEN
    RAISE EXCEPTION 'Resend cooldown active' USING ERRCODE = '23505';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := public._project_invitation_token_hash(v_token);
  v_expires := now() + INTERVAL '7 days';

  UPDATE public.project_invitations
  SET token_hash = v_hash,
      expires_at = v_expires,
      updated_at = now()
  WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'invitation_id', v_inv.id,
    'accept_token', v_token,
    'email', v_inv.email,
    'role', v_inv.role::text,
    'expires_at', v_expires
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Mark email sent (called by edge function after Resend succeeds)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_project_invitation_email_sent(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_project_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.project_invitations
  WHERE id = p_invitation_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_project_admin_access(v_uid, v_project_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.project_invitations
  SET last_sent_at = now(), updated_at = now()
  WHERE id = p_invitation_id;

  RETURN jsonb_build_object('marked', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._project_invitation_token_hash(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._normalize_invite_email(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.preview_project_team_invitation(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_team_invitation(UUID, TEXT, public.team_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_project_team_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_project_team_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_project_team_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_project_team_invitation(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_project_invitation_email_sent(UUID) TO authenticated;
