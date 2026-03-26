import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { TemplateId } from "@/lib/responsePackageTemplates";

export interface ResponsePackageDraft {
  id: string;
  project_id: string;
  round_number: number;
  round_label: string | null;
  status: "draft" | "submitted" | "superseded";
  template: TemplateId;
  municipality_address: string | null;
  custom_notes: string | null;
  exported_pdf_url: string | null;
  comment_snapshot: Record<string, string> | null;
  created_by: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftUpdatePayload {
  template?: TemplateId;
  municipality_address?: string | null;
  custom_notes?: string | null;
  round_label?: string | null;
  status?: "draft" | "submitted" | "superseded";
  exported_pdf_url?: string | null;
  comment_snapshot?: Record<string, string> | null;
  submitted_at?: string | null;
}

export function useResponsePackageDrafts(projectId: string | null) {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<ResponsePackageDraft[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDrafts = useCallback(async () => {
    if (!projectId) {
      setDrafts([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("response_package_drafts")
        .select("*")
        .eq("project_id", projectId)
        .order("round_number", { ascending: true });
      if (error) throw error;
      setDrafts((data ?? []) as ResponsePackageDraft[]);
    } catch (err) {
      console.error("Failed to fetch drafts:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const createDraft = useCallback(
    async (overrides?: Partial<DraftUpdatePayload>): Promise<ResponsePackageDraft | null> => {
      if (!projectId || !user) return null;
      try {
        const maxRound = drafts.reduce((max, d) => Math.max(max, d.round_number), 0);
        const newRound = maxRound + 1;

        const { data, error } = await supabase
          .from("response_package_drafts")
          .insert({
            project_id: projectId,
            round_number: newRound,
            round_label: overrides?.round_label ?? `Review Round ${newRound}`,
            status: "draft",
            template: overrides?.template ?? "simple",
            municipality_address: overrides?.municipality_address ?? null,
            custom_notes: overrides?.custom_notes ?? null,
            created_by: user.id,
          })
          .select()
          .single();
        if (error) throw error;
        const draft = data as ResponsePackageDraft;
        setDrafts((prev) => [...prev, draft]);
        return draft;
      } catch (err) {
        console.error("Failed to create draft:", err);
        toast.error("Failed to create draft");
        return null;
      }
    },
    [projectId, user, drafts]
  );

  const updateDraft = useCallback(
    async (draftId: string, payload: DraftUpdatePayload): Promise<boolean> => {
      try {
        const updateData: Record<string, unknown> = { ...payload, updated_at: new Date().toISOString() };
        const { error } = await supabase
          .from("response_package_drafts")
          .update(updateData)
          .eq("id", draftId);
        if (error) throw error;
        setDrafts((prev) =>
          prev.map((d) => (d.id === draftId ? { ...d, ...payload, updated_at: new Date().toISOString() } : d))
        );
        return true;
      } catch (err) {
        console.error("Failed to update draft:", err);
        toast.error("Failed to update draft");
        return false;
      }
    },
    []
  );

  const supersedePreviousDrafts = useCallback(
    async (): Promise<boolean> => {
      if (!projectId) return false;
      try {
        const activeDrafts = drafts.filter((d) => d.status === "draft");
        for (const d of activeDrafts) {
          await supabase
            .from("response_package_drafts")
            .update({ status: "superseded", updated_at: new Date().toISOString() })
            .eq("id", d.id);
        }
        setDrafts((prev) =>
          prev.map((d) => (d.status === "draft" ? { ...d, status: "superseded" as const } : d))
        );
        return true;
      } catch (err) {
        console.error("Failed to supersede drafts:", err);
        return false;
      }
    },
    [projectId, drafts]
  );

  const startNewRound = useCallback(
    async (overrides?: Partial<DraftUpdatePayload>): Promise<ResponsePackageDraft | null> => {
      await supersedePreviousDrafts();
      return await createDraft(overrides);
    },
    [supersedePreviousDrafts, createDraft]
  );

  const markAsSubmitted = useCallback(
    async (draftId: string): Promise<boolean> => {
      return updateDraft(draftId, {
        status: "submitted",
        submitted_at: new Date().toISOString(),
      });
    },
    [updateDraft]
  );

  const saveCommentSnapshot = useCallback(
    async (
      draftId: string,
      comments: Array<{ id: string; response_text: string | null }>
    ): Promise<boolean> => {
      const snapshot: Record<string, string> = {};
      for (const c of comments) {
        snapshot[c.id] = c.response_text ?? "";
      }
      return updateDraft(draftId, { comment_snapshot: snapshot });
    },
    [updateDraft]
  );

  const currentDraft = drafts.find((d) => d.status === "draft") ?? null;

  return {
    drafts,
    loading,
    currentDraft,
    fetchDrafts,
    createDraft,
    updateDraft,
    startNewRound,
    markAsSubmitted,
    supersedePreviousDrafts,
    saveCommentSnapshot,
  };
}
