-- Allow Railway service-role backend to call admin overview metrics RPC.
-- Express admin routes still enforce platform admin JWT before invoking RPC.

CREATE OR REPLACE FUNCTION public.admin_overview_metrics()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_require_backend_caller();

  RETURN jsonb_build_object(
    'total_users', (SELECT COUNT(*) FROM public.profiles),
    'active_users', (
      SELECT COUNT(*) FROM public.profiles p WHERE p.access_status = 'active'
    ),
    'deactivated_users', (
      SELECT COUNT(*) FROM public.profiles p WHERE p.access_status = 'deactivated'
    ),
    'platform_admins', (
      SELECT COUNT(DISTINCT ur.user_id)::INTEGER
      FROM public.user_roles ur
      WHERE ur.role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
    ),
    'audit_events_24h', (
      SELECT COUNT(*)
      FROM public.platform_audit_events e
      WHERE e.created_at >= now() - INTERVAL '24 hours'
    ),
    'governance_enforce_mode', public._governance_enforce_mode(),
    'pending_invitations_30d', (
      SELECT COUNT(*)
      FROM public.project_invitations pi
      WHERE pi.status = 'pending'
        AND pi.created_at < now() - INTERVAL '30 days'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_overview_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_overview_metrics() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_overview_metrics() IS
  'Admin overview KPIs; callable by platform admin JWT or service_role backend (Express verifies admin first).';
