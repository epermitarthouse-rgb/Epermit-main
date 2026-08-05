import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type {
  CommentType,
  CompletionChecks,
  ImplementationStatus,
  ReplicationComment,
  ReplicationItemOverlay,
  VerificationStatus,
} from "@/types/architectureReplication";

type PersistenceMode = "loading" | "available" | "unavailable";

function isMissingRelationError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || "").toLowerCase();
  const code = String((err as { code?: string })?.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

export function useArchitectureReplicationOverlay() {
  const { user } = useAuth();
  const [mode, setMode] = useState<PersistenceMode>("loading");
  const [items, setItems] = useState<Record<string, ReplicationItemOverlay>>({});
  const [comments, setComments] = useState<ReplicationComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [itemsRes, commentsRes] = await Promise.all([
        supabase.from("architecture_replication_items").select("*"),
        supabase
          .from("architecture_replication_comments")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);

      if (itemsRes.error) {
        if (isMissingRelationError(itemsRes.error)) {
          setMode("unavailable");
          setItems({});
          setComments([]);
          return;
        }
        throw itemsRes.error;
      }
      if (commentsRes.error) {
        if (isMissingRelationError(commentsRes.error)) {
          setMode("unavailable");
          setItems({});
          setComments([]);
          return;
        }
        throw commentsRes.error;
      }

      const map: Record<string, ReplicationItemOverlay> = {};
      let newest: string | null = null;
      for (const row of itemsRes.data || []) {
        const overlay: ReplicationItemOverlay = {
          matrix_row_id: row.matrix_row_id,
          implementation_status: row.implementation_status,
          verification_status: row.verification_status,
          assigned_owner: row.assigned_owner,
          is_blocked: !!row.is_blocked,
          blocker_description: row.blocker_description,
          implementation_commit: row.implementation_commit,
          preview_url: row.preview_url,
          test_evidence: row.test_evidence,
          last_tested_at: row.last_tested_at,
          client_approved_at: row.client_approved_at,
          client_feedback: row.client_feedback,
          completion_checks: (row.completion_checks || {}) as CompletionChecks,
          updated_at: row.updated_at,
          updated_by: row.updated_by,
        };
        map[overlay.matrix_row_id] = overlay;
        if (overlay.updated_at && (!newest || overlay.updated_at > newest)) {
          newest = overlay.updated_at;
        }
      }
      setItems(map);
      setComments((commentsRes.data || []) as ReplicationComment[]);
      setLastUpdatedAt(newest);
      setMode("available");
    } catch (e) {
      console.error("architecture replication overlay load failed", e);
      setError(e instanceof Error ? e.message : "Failed to load checklist overlay");
      setMode("unavailable");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsertItem = useCallback(
    async (
      matrixRowId: string,
      patch: Partial<ReplicationItemOverlay>,
    ): Promise<{ ok: boolean; message?: string }> => {
      if (mode !== "available") {
        return {
          ok: false,
          message: "Persistence unavailable — apply the architecture_replication migration first.",
        };
      }
      const current = items[matrixRowId];
      const next = {
        matrix_row_id: matrixRowId,
        implementation_status:
          patch.implementation_status ??
          current?.implementation_status ??
          ("Audited" as ImplementationStatus),
        verification_status:
          patch.verification_status ??
          current?.verification_status ??
          ("Not tested" as VerificationStatus),
        assigned_owner:
          patch.assigned_owner !== undefined
            ? patch.assigned_owner
            : current?.assigned_owner ?? null,
        is_blocked:
          patch.is_blocked !== undefined ? patch.is_blocked : current?.is_blocked ?? false,
        blocker_description:
          patch.blocker_description !== undefined
            ? patch.blocker_description
            : current?.blocker_description ?? null,
        implementation_commit:
          patch.implementation_commit !== undefined
            ? patch.implementation_commit
            : current?.implementation_commit ?? null,
        preview_url:
          patch.preview_url !== undefined ? patch.preview_url : current?.preview_url ?? null,
        test_evidence:
          patch.test_evidence !== undefined
            ? patch.test_evidence
            : current?.test_evidence ?? null,
        last_tested_at:
          patch.last_tested_at !== undefined
            ? patch.last_tested_at
            : current?.last_tested_at ?? null,
        client_approved_at:
          patch.client_approved_at !== undefined
            ? patch.client_approved_at
            : current?.client_approved_at ?? null,
        client_feedback:
          patch.client_feedback !== undefined
            ? patch.client_feedback
            : current?.client_feedback ?? null,
        completion_checks:
          patch.completion_checks !== undefined
            ? patch.completion_checks
            : current?.completion_checks ?? {},
        updated_by: user?.id ?? null,
      };

      const { error: upsertError } = await supabase
        .from("architecture_replication_items")
        .upsert(next, { onConflict: "matrix_row_id" });

      if (upsertError) {
        if (isMissingRelationError(upsertError)) {
          setMode("unavailable");
          return {
            ok: false,
            message: "Persistence unavailable — migration not applied.",
          };
        }
        return { ok: false, message: upsertError.message };
      }
      await refresh();
      return { ok: true };
    },
    [items, mode, refresh, user?.id],
  );

  const addComment = useCallback(
    async (
      matrixRowId: string,
      commentType: CommentType,
      commentText: string,
    ): Promise<{ ok: boolean; message?: string }> => {
      if (mode !== "available") {
        return {
          ok: false,
          message: "Persistence unavailable — apply the architecture_replication migration first.",
        };
      }
      const text = commentText.trim();
      if (!text) return { ok: false, message: "Comment text is required." };

      const { error: insertError } = await supabase
        .from("architecture_replication_comments")
        .insert({
          matrix_row_id: matrixRowId,
          comment_type: commentType,
          comment_text: text,
          created_by: user?.id ?? null,
        });

      if (insertError) {
        if (isMissingRelationError(insertError)) {
          setMode("unavailable");
          return {
            ok: false,
            message: "Persistence unavailable — migration not applied.",
          };
        }
        return { ok: false, message: insertError.message };
      }
      await refresh();
      return { ok: true };
    },
    [mode, refresh, user?.id],
  );

  const commentsByRow = useMemo(() => {
    const map: Record<string, ReplicationComment[]> = {};
    for (const c of comments) {
      (map[c.matrix_row_id] ||= []).push(c);
    }
    return map;
  }, [comments]);

  return {
    mode,
    items,
    comments,
    commentsByRow,
    error,
    lastUpdatedAt,
    refresh,
    upsertItem,
    addComment,
    persistenceEnabled: mode === "available",
  };
}
