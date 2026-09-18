import { supabase } from "@/lib/supabase";
import { isValidSubscriptionJurisdictionId } from "@/lib/jurisdictionSubscriptionIntegrity";

export interface JurisdictionSubscriptionInput {
  id: string;
  name: string;
  state: string;
}

export function assertCatalogJurisdictionId(id: string): void {
  if (!isValidSubscriptionJurisdictionId(id)) {
    throw new Error("Subscriptions require a live jurisdiction catalog UUID.");
  }
}

export async function fetchUserSubscriptionIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("jurisdiction_subscriptions")
    .select("jurisdiction_id")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => row.jurisdiction_id);
}

export async function subscribeToJurisdiction(
  userId: string,
  jurisdiction: JurisdictionSubscriptionInput,
): Promise<void> {
  assertCatalogJurisdictionId(jurisdiction.id);

  const { error } = await supabase.from("jurisdiction_subscriptions").insert({
    user_id: userId,
    jurisdiction_id: jurisdiction.id,
    jurisdiction_name: jurisdiction.name,
    jurisdiction_state: jurisdiction.state,
  });

  if (error) {
    throw error;
  }
}

export async function unsubscribeFromJurisdiction(
  userId: string,
  jurisdictionId: string,
): Promise<void> {
  assertCatalogJurisdictionId(jurisdictionId);

  const { error } = await supabase
    .from("jurisdiction_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("jurisdiction_id", jurisdictionId);

  if (error) {
    throw error;
  }
}
