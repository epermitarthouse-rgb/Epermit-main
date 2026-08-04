/**
 * Permit Wizard filing shapes aligned with:
 * - supabase/migrations/20260307000003_permit_wizard_tables.sql
 * - supabase/migrations/20260307000004_multi_municipality_support.sql
 * - supabase/migrations/20260308000002_filing_form_enhancements.sql
 *
 * After those migrations are applied to Supabase, regenerate
 * src/integrations/supabase/types.ts (supabase gen types) and prefer that source.
 */

export type FilingStatus =
  | "preflight"
  | "awaiting_approval"
  | "approved"
  | "filing"
  | "submitted"
  | "failed"
  | "cancelled";

export type ApprovalDecision = "approved" | "rejected";

export interface PermitFiling {
  id: string;
  project_id: string | null;
  user_id: string | null;
  filing_status: FilingStatus;
  permit_type: string | null;
  permit_subtype: string | null;
  review_track: string | null;
  property_address: string | null;
  scope_of_work: string | null;
  construction_value: number | null;
  property_type: string | null;
  estimated_fee: number | null;
  application_id: string | null;
  confirmation_number: string | null;
  approval_package: Record<string, unknown> | null;
  approval_decision: ApprovalDecision | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  submitted_at: string | null;
  municipality: string | null;
  credential_id: string | null;
  square_footage: number | null;
  number_of_stories: number | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface PermitFilingInsert {
  project_id: string;
  user_id: string;
  filing_status?: FilingStatus;
  property_address?: string | null;
  scope_of_work?: string | null;
  construction_value?: number | null;
  property_type?: string | null;
  permit_type?: string | null;
  square_footage?: number | null;
  number_of_stories?: number | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  owner_email?: string | null;
  municipality?: string | null;
  credential_id?: string | null;
}
