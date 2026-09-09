-- UCI Graph inbound mailbox lease + cursor, plus cheap idempotency lookup support.
-- Prevents concurrent Railway instances from polling the same mailbox and
-- replaces the fixed 48-hour Graph replay with a failure-safe watermark.

ALTER TABLE public.uci_unmatched_inbound_messages
  ADD COLUMN IF NOT EXISTS last_match_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_rematch_at TIMESTAMPTZ;

COMMENT ON COLUMN public.uci_unmatched_inbound_messages.last_match_attempted_at IS
  'When matching last ran for this unmatched inbound. Used for backoff and data-change rematch.';
COMMENT ON COLUMN public.uci_unmatched_inbound_messages.next_rematch_at IS
  'Earliest automatic rematch time. Null legacy rows are scheduled, not rematched immediately.';

CREATE INDEX IF NOT EXISTS idx_uci_unmatched_inbound_rematch_due
  ON public.uci_unmatched_inbound_messages (mailbox_user_id, next_rematch_at)
  WHERE match_status = 'unmatched';

-- Existing unmatched rows: schedule backoff without rematching on first deploy.
UPDATE public.uci_unmatched_inbound_messages
SET
  last_match_attempted_at = COALESCE(last_match_attempted_at, updated_at, created_at, now()),
  next_rematch_at = COALESCE(next_rematch_at, now() + interval '6 hours')
WHERE match_status = 'unmatched'
  AND next_rematch_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_communications_idempotency_key
  ON public.coordination_communications (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_communications_inbound_echo_key
  ON public.coordination_communications ((agent_processed_metadata->'inbound_echo'->>'idempotency_key'))
  WHERE agent_processed_metadata->'inbound_echo'->>'idempotency_key' IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.uci_graph_inbound_mailbox_state (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  watermark_received_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_poll_started_at TIMESTAMPTZ,
  last_poll_finished_at TIMESTAMPTZ,
  last_cycle_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

COMMENT ON TABLE public.uci_graph_inbound_mailbox_state IS
  'Per-mailbox Graph inbound cursor and advisory lease. Service-role backend only.';

CREATE INDEX IF NOT EXISTS idx_uci_graph_inbound_mailbox_lease
  ON public.uci_graph_inbound_mailbox_state (lease_expires_at)
  WHERE lease_owner IS NOT NULL;

DROP TRIGGER IF EXISTS uci_graph_inbound_mailbox_state_updated_at
  ON public.uci_graph_inbound_mailbox_state;
CREATE TRIGGER uci_graph_inbound_mailbox_state_updated_at
  BEFORE UPDATE ON public.uci_graph_inbound_mailbox_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.uci_graph_inbound_mailbox_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.uci_graph_inbound_mailbox_state FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.uci_graph_inbound_mailbox_state TO service_role;

CREATE OR REPLACE FUNCTION public.claim_uci_graph_inbound_mailbox(
  p_user_id UUID,
  p_owner TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 120
)
RETURNS public.uci_graph_inbound_mailbox_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.uci_graph_inbound_mailbox_state;
  v_ttl INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'owner required';
  END IF;
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 120));

  INSERT INTO public.uci_graph_inbound_mailbox_state (
    user_id,
    lease_owner,
    lease_expires_at,
    last_poll_started_at
  )
  VALUES (
    p_user_id,
    trim(p_owner),
    now() + make_interval(secs => v_ttl),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    lease_owner = EXCLUDED.lease_owner,
    lease_expires_at = EXCLUDED.lease_expires_at,
    last_poll_started_at = now(),
    updated_at = now()
  WHERE
    uci_graph_inbound_mailbox_state.lease_expires_at IS NULL
    OR uci_graph_inbound_mailbox_state.lease_expires_at < now()
    OR uci_graph_inbound_mailbox_state.lease_owner = trim(p_owner)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_uci_graph_inbound_mailbox(
  p_user_id UUID,
  p_owner TEXT,
  p_watermark_received_at TIMESTAMPTZ DEFAULT NULL,
  p_metrics JSONB DEFAULT NULL
)
RETURNS public.uci_graph_inbound_mailbox_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.uci_graph_inbound_mailbox_state;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'owner required';
  END IF;

  UPDATE public.uci_graph_inbound_mailbox_state
  SET
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_poll_finished_at = now(),
    last_cycle_metrics = COALESCE(p_metrics, last_cycle_metrics),
    watermark_received_at = CASE
      WHEN p_watermark_received_at IS NULL THEN watermark_received_at
      WHEN watermark_received_at IS NULL THEN p_watermark_received_at
      WHEN p_watermark_received_at > watermark_received_at THEN p_watermark_received_at
      ELSE watermark_received_at
    END,
    updated_at = now()
  WHERE user_id = p_user_id
    AND (
      lease_owner = trim(p_owner)
      OR lease_expires_at IS NULL
      OR lease_expires_at < now()
    )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_uci_graph_inbound_mailbox(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_uci_graph_inbound_mailbox(UUID, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_uci_graph_inbound_mailbox(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_uci_graph_inbound_mailbox(UUID, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
