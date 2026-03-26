import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface MarkupData {
  x: number;
  y: number;
  width: number;
  height: number;
  deltaNumber?: number;
  label?: string;
}

export interface PlanMarkup {
  id: string;
  project_id: string;
  document_id: string | null;
  comment_id: string | null;
  page_number: number;
  markup_data: MarkupData;
  status: "pending" | "approved" | "rejected";
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export function usePlanMarkups(projectId: string | undefined, pageNumber?: number, documentId?: string) {
  const { user } = useAuth();
  const [markups, setMarkups] = useState<PlanMarkup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkups = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("plan_markups")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (documentId) {
        query = query.eq("document_id", documentId);
      }

      if (pageNumber !== undefined) {
        query = query.eq("page_number", pageNumber);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setMarkups((data as PlanMarkup[]) || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch markups");
    } finally {
      setLoading(false);
    }
  }, [projectId, pageNumber, documentId]);

  useEffect(() => {
    fetchMarkups();
  }, [fetchMarkups]);

  const addMarkup = useCallback(
    async (params: {
      documentId?: string;
      commentId?: string;
      pageNumber: number;
      markupData: MarkupData;
    }) => {
      if (!projectId || !user) return null;

      const row = {
        project_id: projectId,
        document_id: params.documentId || null,
        comment_id: params.commentId || null,
        page_number: params.pageNumber,
        markup_data: params.markupData,
        status: "pending" as const,
        created_by: user.id,
      };

      const { data, error: insertError } = await supabase
        .from("plan_markups")
        .insert(row)
        .select()
        .single();

      if (insertError) throw insertError;

      const newMarkup = data as PlanMarkup;
      setMarkups((prev) => [...prev, newMarkup]);
      return newMarkup;
    },
    [projectId, user]
  );

  const updateMarkup = useCallback(
    async (id: string, updates: Partial<Pick<PlanMarkup, "markup_data" | "status" | "comment_id">>) => {
      const { data, error: updateError } = await supabase
        .from("plan_markups")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (updateError) throw updateError;

      const updated = data as PlanMarkup;
      setMarkups((prev) => prev.map((m) => (m.id === id ? updated : m)));
      return updated;
    },
    []
  );

  const deleteMarkup = useCallback(
    async (id: string) => {
      const { error: deleteError } = await supabase
        .from("plan_markups")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;
      setMarkups((prev) => prev.filter((m) => m.id !== id));
    },
    []
  );

  const approveAll = useCallback(
    async () => {
      if (!projectId || !user) return;

      const { error: approveError } = await supabase
        .from("plan_markups")
        .update({
          status: "approved",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("project_id", projectId)
        .eq("status", "pending");

      if (approveError) throw approveError;

      setMarkups((prev) =>
        prev.map((m) =>
          m.status === "pending"
            ? {
                ...m,
                status: "approved" as const,
                approved_by: user.id,
                approved_at: new Date().toISOString(),
              }
            : m
        )
      );
    },
    [projectId, user]
  );

  const linkComment = useCallback(
    async (markupId: string, commentId: string) => {
      return updateMarkup(markupId, { comment_id: commentId });
    },
    [updateMarkup]
  );

  return {
    markups,
    loading,
    error,
    addMarkup,
    updateMarkup,
    deleteMarkup,
    approveAll,
    linkComment,
    refetch: fetchMarkups,
  };
}
