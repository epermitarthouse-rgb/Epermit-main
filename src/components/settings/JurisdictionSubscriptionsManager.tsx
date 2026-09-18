import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { JurisdictionLookup } from "@/components/projects/JurisdictionLookup";
import {
  subscribeToJurisdiction,
  unsubscribeFromJurisdiction,
} from "@/lib/jurisdictionSubscribe";
import { supabase } from "@/lib/supabase";

interface SubscriptionRow {
  jurisdiction_id: string;
  jurisdiction_name: string;
  jurisdiction_state: string;
}

export function JurisdictionSubscriptionsManager() {
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [subscriptionIds, setSubscriptionIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [lookupValue, setLookupValue] = useState("");

  const loadSubscriptions = useCallback(async () => {
    if (!user) {
      setSubscriptions([]);
      setSubscriptionIds([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("jurisdiction_subscriptions")
        .select("jurisdiction_id, jurisdiction_name, jurisdiction_state")
        .eq("user_id", user.id)
        .order("jurisdiction_name");

      if (error) throw error;

      const rows = (data ?? []) as SubscriptionRow[];
      setSubscriptions(rows);
      setSubscriptionIds(rows.map((r) => r.jurisdiction_id));
    } catch (error) {
      console.error("Error loading subscriptions:", error);
      toast.error("Failed to load jurisdiction subscriptions");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  const handleSubscribe = async (jurisdiction: {
    id: string;
    name: string;
    state: string;
  }) => {
    if (!user) {
      toast.error("Sign in to subscribe to jurisdiction updates");
      return;
    }

    if (subscriptionIds.includes(jurisdiction.id)) {
      return;
    }

    setActionId(jurisdiction.id);
    try {
      await subscribeToJurisdiction(user.id, jurisdiction);
      setSubscriptionIds((prev) => [...prev, jurisdiction.id]);
      setSubscriptions((prev) => [
        ...prev,
        {
          jurisdiction_id: jurisdiction.id,
          jurisdiction_name: jurisdiction.name,
          jurisdiction_state: jurisdiction.state,
        },
      ].sort((a, b) => a.jurisdiction_name.localeCompare(b.jurisdiction_name)));
      setLookupValue("");
      toast.success(`Subscribed to ${jurisdiction.name}`);
    } catch (error) {
      console.error("Subscribe error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to subscribe",
      );
    } finally {
      setActionId(null);
    }
  };

  const handleUnsubscribe = async (jurisdictionId: string, name: string) => {
    if (!user) return;

    setActionId(jurisdictionId);
    try {
      await unsubscribeFromJurisdiction(user.id, jurisdictionId);
      setSubscriptionIds((prev) => prev.filter((id) => id !== jurisdictionId));
      setSubscriptions((prev) => prev.filter((s) => s.jurisdiction_id !== jurisdictionId));
      toast.success(`Unsubscribed from ${name}`);
    } catch (error) {
      console.error("Unsubscribe error:", error);
      toast.error("Failed to unsubscribe");
    } finally {
      setActionId(null);
    }
  };

  if (!user) {
    return (
      <p className="text-sm text-muted-foreground">
        Sign in to manage jurisdiction code update subscriptions.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Subscribe to building code updates for jurisdictions in the live catalog (UUID-backed).
        </p>
        <JurisdictionLookup
          value={lookupValue}
          onChange={setLookupValue}
          onSelect={(jurisdiction) => {
            if (jurisdiction) {
              void handleSubscribe(jurisdiction);
            }
          }}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading subscriptions…
        </div>
      ) : subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No jurisdiction subscriptions yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {subscriptions.map((sub) => (
            <li
              key={sub.jurisdiction_id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{sub.jurisdiction_name}</p>
                <Badge variant="outline" className="mt-1 text-xs">
                  {sub.jurisdiction_state}
                </Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionId === sub.jurisdiction_id}
                onClick={() =>
                  void handleUnsubscribe(sub.jurisdiction_id, sub.jurisdiction_name)
                }
              >
                {actionId === sub.jurisdiction_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <BellOff className="mr-1 h-3 w-3" />
                    Unsubscribe
                  </>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {subscriptions.length > 0 ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Bell className="h-3 w-3" />
          {subscriptions.length} active subscription{subscriptions.length !== 1 ? "s" : ""}
        </p>
      ) : null}
    </div>
  );
}
