import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { ArrowLeft, Database, Layers, Loader2, RefreshCw } from "lucide-react";
import { MetricCard, PageHeader, Panel } from "@/components/design/ProductPrimitives";

interface ParsedCommentRow {
  id: string;
  original_text: string;
  discipline: string | null;
  code_reference: string | null;
  status: string;
}

export default function ClassifiedComments() {
  const { user, loading: authLoading } = useAuth();
  const { selectedProjectId } = useSelectedProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projectId = selectedProjectId;
  const [runningClassifier, setRunningClassifier] = useState(false);

  const fetchComments = useCallback(async (): Promise<ParsedCommentRow[]> => {
    if (!projectId) return [];
    const { data, error } = await supabase
      .from("parsed_comments")
      .select("id, original_text, discipline, code_reference, status")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Failed to load comments");
      return [];
    }
    return (data as ParsedCommentRow[]) || [];
  }, [projectId]);

  const { data: comments = [], isLoading, refetch } = useQuery({
    queryKey: ["parsed_comments", projectId],
    queryFn: fetchComments,
    enabled: !!projectId,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ParsedCommentRow[]>();
    for (const c of comments) {
      const key = c.discipline?.trim() || "Unclassified";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "Unclassified") return 1;
      if (b === "Unclassified") return -1;
      return a.localeCompare(b);
    });
    return { keys, map };
  }, [comments]);

  /** Re-runs the discipline model on every parsed row for the project (not the incremental “unclassified only” path). */
  const refreshClassifications = useCallback(async () => {
    if (!projectId) return;
    setRunningClassifier(true);
    try {
      const { count: totalInDb, error: countErr } = await supabase
        .from("parsed_comments")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);

      if (countErr) throw countErr;
      const loaded = totalInDb ?? 0;
      toast.info(
        loaded > 0
          ? `Loaded ${loaded} parsed comment(s) for this project. Sending all to the discipline classifier…`
          : "No parsed comments in the database for this project yet.",
      );
      if (loaded === 0) {
        return;
      }

      const { data, error } = await supabase.functions.invoke("discipline-classifier-agent", {
        body: { project_id: projectId, reclassify_all: true },
      });
      if (error) throw error;

      const payload = data as {
        code?: number;
        message?: string;
        classified_count?: number;
        rows_sent?: number;
        parsed_comments_total?: number;
      };
      if (payload?.code != null && payload.code >= 400) {
        throw new Error(payload.message ?? `Classifier returned ${payload.code}`);
      }

      const rowsSent = payload?.rows_sent ?? 0;
      const updated = payload?.classified_count ?? 0;
      const total = payload?.parsed_comments_total ?? loaded;

      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      await refetch();

      toast.success(
        `Discipline classifier: updated ${updated} row(s) (processed ${rowsSent} of ${total} parsed comment(s) in project).`,
      );
    } catch (e) {
      console.error("[ClassifiedComments] discipline-classifier-agent", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Classifier failed: ${msg}`);
    } finally {
      setRunningClassifier(false);
    }
  }, [projectId, queryClient, refetch]);

  const reloadListOnly = useCallback(async () => {
    if (!projectId) return;
    const { count, error } = await supabase
      .from("parsed_comments")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (error) {
      toast.error(`Could not load comment count: ${error.message}`);
      return;
    }
    await refetch();
    toast.info(`Reloaded list: ${count ?? 0} parsed comment(s) for this project.`);
  }, [projectId, refetch]);

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground hover:text-foreground"
        onClick={() => navigate("/dashboard")}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Dashboard
      </Button>

      <PageHeader
        eyebrow="Discipline View"
        title="Classified Comments"
        body="Comments grouped by discipline for the selected project."
        action={
          projectId ? (
            <>
              <button
                type="button"
                className="pilot-button-ghost"
                onClick={() => void reloadListOnly()}
                disabled={runningClassifier || isLoading}
              >
                <Database className="h-4 w-4" />
                Reload list
              </button>
              <button
                type="button"
                className="pilot-button-primary"
                onClick={() => void refreshClassifications()}
                disabled={runningClassifier}
              >
                {runningClassifier ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Refresh classifications
              </button>
            </>
          ) : null
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Disciplines" value={grouped.keys.length} icon={Layers} />
        <MetricCard label="Total comments" value={comments.length} icon={Database} />
        <MetricCard
          label="Unclassified"
          value={grouped.map.get("Unclassified")?.length ?? 0}
        />
      </div>

      {!projectId ? (
        <Panel>
          <p className="py-10 text-center text-muted-foreground">
            Select a project in the sidebar to view classified comments.
          </p>
        </Panel>
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : comments.length === 0 ? (
        <Panel>
          <p className="py-8 text-center text-muted-foreground">
            No parsed comments for this project. Load comments from the portal on the Comment Review page first.
          </p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {grouped.keys.map((discipline) => {
            const items = grouped.map.get(discipline)!;
            return (
              <Panel
                key={discipline}
                title={discipline}
                eyebrow={`${items.length} comment${items.length === 1 ? "" : "s"}`}
              >
                <ul className="space-y-2">
                  {items.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-r-md border-l-2 border-primary/40 bg-muted/30 py-1.5 pl-3 text-sm text-muted-foreground"
                    >
                      <span className="text-foreground">{c.original_text}</span>
                      {c.code_reference && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">({c.code_reference})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
