import { supabase } from "@/lib/supabase";
import type { DripCampaignRow } from "./dripCampaignStats";

export type DripCampaignFetchState =
  | { status: "loading" }
  | { status: "ready"; campaigns: DripCampaignRow[] }
  | { status: "error"; message: string };

export function isDripCampaignFetchError(state: DripCampaignFetchState): boolean {
  return state.status === "error";
}

export function isDripCampaignEmpty(state: DripCampaignFetchState): boolean {
  return state.status === "ready" && state.campaigns.length === 0;
}

export async function fetchAdminDripCampaigns(): Promise<DripCampaignRow[]> {
  const { data, error } = await supabase.functions.invoke("admin-drip-campaigns", {
    body: { action: "list" },
  });

  if (error) {
    throw error;
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  return (data?.campaigns ?? []) as DripCampaignRow[];
}

export interface ProcessDripEmailsResult {
  success?: boolean;
  emailsSent?: number;
  campaignsCompleted?: number;
  totalCampaigns?: number;
  error?: string;
}

export async function invokeProcessDripEmails(): Promise<ProcessDripEmailsResult> {
  const { data, error } = await supabase.functions.invoke("process-drip-emails");

  if (error) {
    throw error;
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  return data as ProcessDripEmailsResult;
}
