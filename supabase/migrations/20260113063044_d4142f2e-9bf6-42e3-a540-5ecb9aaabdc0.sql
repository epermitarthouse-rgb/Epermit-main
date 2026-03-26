-- Drop the view and recreate without SECURITY DEFINER
DROP VIEW IF EXISTS public.project_analytics;

-- Recreate as a regular view (will use invoker's RLS policies)
CREATE VIEW public.project_analytics AS
SELECT 
  p.id,
  p.name,
  p.user_id,
  p.status,
  p.jurisdiction,
  p.project_type,
  p.permit_fee,
  p.expeditor_cost,
  p.total_cost,
  p.rejection_count,
  p.rejection_reasons,
  p.created_at,
  p.submitted_at,
  p.approved_at,
  CASE 
    WHEN p.submitted_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (p.submitted_at - p.created_at)) / 86400 
    ELSE NULL 
  END AS draft_to_submit_days,
  CASE 
    WHEN p.approved_at IS NOT NULL AND p.submitted_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (p.approved_at - p.submitted_at)) / 86400 
    ELSE NULL 
  END AS submit_to_approval_days,
  CASE 
    WHEN p.approved_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (p.approved_at - p.created_at)) / 86400 
    ELSE NULL 
  END AS total_cycle_days,
  (SELECT COUNT(*) FROM inspections i WHERE i.project_id = p.id) AS inspection_count,
  (SELECT COUNT(*) FROM inspections i WHERE i.project_id = p.id AND i.status = 'failed') AS failed_inspection_count,
  (SELECT COUNT(*) FROM punch_list_items pl WHERE pl.project_id = p.id) AS punch_list_count,
  (SELECT COUNT(*) FROM punch_list_items pl WHERE pl.project_id = p.id AND pl.status IN ('open', 'in_progress')) AS open_punch_items,
  (SELECT COUNT(*) FROM project_documents pd WHERE pd.project_id = p.id) AS document_count
FROM projects p;

-- Set view to use invoker's security context
ALTER VIEW public.project_analytics SET (security_invoker = on);