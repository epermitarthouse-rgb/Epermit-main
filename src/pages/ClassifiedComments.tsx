import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { ArrowLeft, Loader2, RefreshCw, Wand2 } from "lucide-react";

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

  const runClassifier = useCallback(async () => {
    if (!projectId) return;
    setRunningClassifier(true);
    try {
      const { data, error } = await supabase.functions.invoke("discipline-classifier-agent", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const count = (data as { classified_count?: number })?.classified_count ?? 0;
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
      toast.success(`Classified ${count} comment(s)`);
      refetch();
    } catch (e) {
      console.error(e);
      toast.error("Classifier failed");
    } finally {
      setRunningClassifier(false);
    }
  }, [projectId, queryClient, refetch]);

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Classified Comments</h1>
              <p className="text-muted-foreground text-sm">
                Comments grouped by discipline for the selected project.
              </p>
            </div>
          </div>
          {projectId && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button size="sm" onClick={runClassifier} disabled={runningClassifier}>
                {runningClassifier ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
                Run classifier
              </Button>
            </div>
          )}
        </div>

        {!projectId ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Select a project in the sidebar to view classified comments.
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No parsed comments for this project. Load comments from the portal on the Comment Review page first.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {grouped.keys.map((discipline) => {
              const items = grouped.map.get(discipline)!;
              return (
                <Card key={discipline}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">
                      {discipline}
                      <span className="text-muted-foreground font-normal ml-2">({items.length})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {items.map((c) => (
                        <li
                          key={c.id}
                          className="text-sm text-muted-foreground border-l-2 border-muted pl-3 py-1"
                        >
                          {c.original_text}
                          {c.code_reference && (
                            <span className="text-muted-foreground/80 ml-2">({c.code_reference})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
