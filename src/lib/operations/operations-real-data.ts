/**
 * Real / partial Operations Board data from PermitPilot projects + UCI costs.
 * Never fabricates Monday line items, team/progress, or invoice/payment enums.
 */

import { supabase } from "@/lib/supabase";
import type { CoordinationCost } from "@/types/uci";
import { formatAddress, numOrNull } from "./operations-format";
import type {
  OperationsProjectHeader,
  OperationsRealBundle,
  RealQbMilestone,
  RealReimbursableSummaryRow,
} from "./operations-types";

type ProjectRow = {
  id: string;
  name: string;
  permit_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  jurisdiction: string | null;
  client_name: string | null;
  client_email: string | null;
  service_type: string | null;
  contract_value: number | null;
  reimbursement_amount: number | null;
  reimbursement_description: string | null;
  permit_fee: number | null;
  expeditor_cost: number | null;
  total_cost: number | null;
  qb_invoice_id_m1: string | null;
  qb_invoice_id_m2: string | null;
  qb_invoice_id_m3: string | null;
  m1_triggered: boolean | null;
  m2_triggered: boolean | null;
  m3_triggered: boolean | null;
  m1_triggered_at: string | null;
  m2_triggered_at: string | null;
  m3_triggered_at: string | null;
};

const PROJECT_SELECT = [
  "id",
  "name",
  "permit_number",
  "address",
  "city",
  "state",
  "zip_code",
  "jurisdiction",
  "client_name",
  "client_email",
  "service_type",
  "contract_value",
  "reimbursement_amount",
  "reimbursement_description",
  "permit_fee",
  "expeditor_cost",
  "total_cost",
  "qb_invoice_id_m1",
  "qb_invoice_id_m2",
  "qb_invoice_id_m3",
  "m1_triggered",
  "m2_triggered",
  "m3_triggered",
  "m1_triggered_at",
  "m2_triggered_at",
  "m3_triggered_at",
].join(",");

function buildQbMilestones(row: ProjectRow): RealQbMilestone[] {
  return [
    {
      key: "m1",
      label: "Milestone 1",
      triggered: Boolean(row.m1_triggered),
      triggeredAt: row.m1_triggered_at,
      invoiceId: row.qb_invoice_id_m1,
    },
    {
      key: "m2",
      label: "Milestone 2",
      triggered: Boolean(row.m2_triggered),
      triggeredAt: row.m2_triggered_at,
      invoiceId: row.qb_invoice_id_m2,
    },
    {
      key: "m3",
      label: "Milestone 3",
      triggered: Boolean(row.m3_triggered),
      triggeredAt: row.m3_triggered_at,
      invoiceId: row.qb_invoice_id_m3,
    },
  ];
}

export function mapProjectHeader(row: ProjectRow): OperationsProjectHeader {
  return {
    id: row.id,
    name: row.name,
    permitNumber: row.permit_number,
    addressLine: formatAddress(row),
    jurisdiction: row.jurisdiction,
    clientName: row.client_name,
    clientEmail: row.client_email,
    serviceType: row.service_type,
    contractValue: numOrNull(row.contract_value),
    reimbursementAmount: numOrNull(row.reimbursement_amount),
    reimbursementDescription: row.reimbursement_description,
    permitFee: numOrNull(row.permit_fee),
    expeditorCost: numOrNull(row.expeditor_cost),
    totalCost: numOrNull(row.total_cost),
    qbMilestones: buildQbMilestones(row),
  };
}

/**
 * Project-level finance scalars as honest summary rows.
 * Does not invent Monday columns (team, progress, Paid by GC, etc.).
 */
export function buildProjectSummaryRows(
  header: OperationsProjectHeader,
): RealReimbursableSummaryRow[] {
  const rows: RealReimbursableSummaryRow[] = [];
  if (header.reimbursementAmount != null) {
    rows.push({
      id: `${header.id}:reimbursement`,
      kind: "project_reimbursement",
      label: "Project reimbursement",
      description: header.reimbursementDescription,
      amount: header.reimbursementAmount,
      permitNumber: header.permitNumber,
      invoiceRef: null,
      paidAt: null,
      billedAt: null,
      sourceTable: "projects",
    });
  }
  if (header.permitFee != null) {
    rows.push({
      id: `${header.id}:permit_fee`,
      kind: "permit_fee",
      label: "Permit fee",
      description: "Project-level permit fee scalar",
      amount: header.permitFee,
      permitNumber: header.permitNumber,
      invoiceRef: null,
      paidAt: null,
      billedAt: null,
      sourceTable: "projects",
    });
  }
  if (header.expeditorCost != null) {
    rows.push({
      id: `${header.id}:expeditor_cost`,
      kind: "expeditor_cost",
      label: "Expeditor cost",
      description: "Project-level expeditor cost scalar",
      amount: header.expeditorCost,
      permitNumber: header.permitNumber,
      invoiceRef: null,
      paidAt: null,
      billedAt: null,
      sourceTable: "projects",
    });
  }
  return rows;
}

export function mapUtilityCostRows(
  costs: CoordinationCost[],
  permitNumber: string | null,
): RealReimbursableSummaryRow[] {
  return costs.map((c) => {
    const amount = numOrNull(c.actual_amount) ?? numOrNull(c.estimated_amount);
    return {
      id: c.id,
      kind: "utility_coordination" as const,
      label: c.cost_type?.trim() || "Utility cost",
      description: c.notes,
      amount,
      permitNumber,
      invoiceRef: c.quickbooks_invoice_id,
      paidAt: c.paid_at,
      billedAt: c.client_billed_at,
      sourceTable: "coordination_costs" as const,
    };
  });
}

export function sumRealAmounts(rows: RealReimbursableSummaryRow[]): number {
  return rows.reduce((acc, r) => acc + (r.amount ?? 0), 0);
}

export function countRealInvoiceRefs(
  header: OperationsProjectHeader,
  utilityRows: RealReimbursableSummaryRow[],
): number {
  const milestoneIds = header.qbMilestones.filter((m) => Boolean(m.invoiceId)).length;
  const uciIds = utilityRows.filter((r) => Boolean(r.invoiceRef)).length;
  return milestoneIds + uciIds;
}

export function buildOperationsRealBundle(
  header: OperationsProjectHeader,
  costs: CoordinationCost[],
): OperationsRealBundle {
  const summaryRows = buildProjectSummaryRows(header);
  const utilityCostRows = mapUtilityCostRows(costs, header.permitNumber);
  const all = [...summaryRows, ...utilityCostRows];
  const hasAny =
    summaryRows.length > 0 ||
    utilityCostRows.length > 0 ||
    header.contractValue != null ||
    header.clientName != null ||
    header.qbMilestones.some((m) => m.triggered || m.invoiceId);

  return {
    header,
    summaryRows,
    utilityCostRows,
    realTrackedAmount: sumRealAmounts(all),
    realTrackedCount: all.length,
    realInvoiceRefCount: countRealInvoiceRefs(header, utilityCostRows),
    dataSource: hasAny ? "partial" : "partial",
  };
}

export function filterRealRows(
  rows: RealReimbursableSummaryRow[],
  query: string,
): RealReimbursableSummaryRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.label.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q) ||
      (r.permitNumber ?? "").toLowerCase().includes(q) ||
      (r.invoiceRef ?? "").toLowerCase().includes(q) ||
      r.kind.toLowerCase().includes(q),
  );
}

export async function fetchOperationsProject(
  projectId: string,
): Promise<{ data: ProjectRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message || "Failed to load project" };
  }
  return { data: (data as ProjectRow | null) ?? null, error: null };
}

/**
 * coordination_costs is project-scoped with has_project_access RLS.
 * Not yet in generated FE Database types — query via untyped client.
 */
export async function fetchProjectCoordinationCosts(
  projectId: string,
): Promise<{ data: CoordinationCost[]; error: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  const { data, error } = await client
    .from("coordination_costs")
    .select(
      "id, coordination_record_id, project_id, cost_type, estimated_amount, estimated_at, actual_amount, actual_received_at, variance_pct, invoice_received_doc_ref, paid_at, payment_method, client_billed_at, quickbooks_invoice_id, notes, created_at, updated_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    // Table missing from types / RLS denial / undeployed — surface empty partial, not crash.
    return { data: [], error: error.message || "Failed to load utility costs" };
  }
  return { data: Array.isArray(data) ? (data as CoordinationCost[]) : [], error: null };
}

export async function loadOperationsRealBundle(
  projectId: string,
): Promise<{ bundle: OperationsRealBundle | null; error: string | null }> {
  const projectResult = await fetchOperationsProject(projectId);
  if (projectResult.error) {
    return { bundle: null, error: projectResult.error };
  }
  if (!projectResult.data) {
    return {
      bundle: null,
      error: "Project not found or you do not have access.",
    };
  }

  const costsResult = await fetchProjectCoordinationCosts(projectId);
  // Soft-fail UCI costs: still show project partial finance.
  const header = mapProjectHeader(projectResult.data);
  const bundle = buildOperationsRealBundle(header, costsResult.data);
  return {
    bundle,
    error: costsResult.error ? null : null, // costs error kept soft; UI can show empty utility section
  };
}
