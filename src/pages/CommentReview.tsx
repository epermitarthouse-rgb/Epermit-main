import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { ReviewTimer, type ReviewTimerHandle } from "@/components/shadow/ReviewTimer";
import { supabase } from "@/lib/supabase";
import { pdfFirstPageToImageFile } from "@/utils/pdfToImage";
import { toast } from "sonner";
import { FileImage, Loader2, CheckCircle2, Upload, ArrowLeft, RefreshCw } from "lucide-react";

const DISCIPLINES = ["Architecture", "MEP", "Structural", "Zoning", "Fire"] as const;

export interface ParsedRow {
  original_text: string;
  discipline: string;
  code_reference: string | null;
}

interface ParsedCommentRow {
  id: string;
  project_id: string;
  original_text: string;
  discipline: string | null;
  code_reference: string | null;
  status: string;
  page_number: number | null;
}

export default function CommentReview() {
  const { user, loading: authLoading } = useAuth();
  const { projects } = useProjects();
  const { selectedProjectId } = useSelectedProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const projectId = selectedProjectId;

  const [loadingFromPortal, setLoadingFromPortal] = useState(false);
  const [noCommentsInPortal, setNoCommentsInPortal] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadRows, setUploadRows] = useState<ParsedRow[]>([]);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReviewTimerHandle>(null);

  const fetchComments = useCallback(async (): Promise<ParsedCommentRow[]> => {
    if (!projectId) return [];
    const { data, error } = await supabase
      .from("parsed_comments")
      .select("id, project_id, original_text, discipline, code_reference, status, page_number")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Failed to load comments");
      return [];
    }
    return (data as ParsedCommentRow[]) || [];
  }, [projectId]);

  const { data: portalComments = [], isLoading: commentsLoading, refetch: refetchComments } = useQuery({
    queryKey: ["parsed_comments", projectId],
    queryFn: fetchComments,
    enabled: !!projectId,
  });

  const loadFromPortal = useCallback(async () => {
    if (!projectId || !user?.id) return;
    setLoadingFromPortal(true);
    setNoCommentsInPortal(false);
    const pollIntervalMs = 2500;
    const maxRounds = 60;
    let cursor: { pdfIndex: number } | undefined;
    let round = 0;
    try {
      while (round < maxRounds) {
        const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", {
          body: { project_id: projectId, ...(cursor && { cursor }) },
        });
        if (error) {
          toast.error("Pipeline failed");
          break;
        }
        const cp = data?.comment_parser;
        if (cp?.reason === "no_comments_in_portal") {
          setNoCommentsInPortal(true);
          await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
          break;
        }
        if (cp?.done === true && !cp?.error) {
          await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
          toast.success("Comments loaded from portal");
          break;
        }
        if (cp?.error === "timeout" || (cp?.next_cursor != null && !cp?.done)) {
          cursor = cp?.error === "timeout" ? undefined : cp.next_cursor;
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          round++;
          continue;
        }
        break;
      }
    } catch (e) {
      console.warn(e);
      toast.error("Failed to load from portal");
    } finally {
      setLoadingFromPortal(false);
    }
  }, [projectId, user?.id, queryClient]);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImageFile(file);
      if (file.type.startsWith("image/")) {
        setImagePreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(file);
        });
        return;
      }
      if (file.type === "application/pdf") {
        try {
          const imageFile = await pdfFirstPageToImageFile(file);
          setImagePreview((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(imageFile);
          });
          setImageFile(imageFile);
        } catch (err) {
          toast.error("Failed to convert PDF to image");
          setImagePreview(null);
          setImageFile(null);
        }
        return;
      }
      setImagePreview(null);
    },
    []
  );

  const runParse = useCallback(async () => {
    if (!imageFile) {
      toast.error("Upload an image or PDF first");
      return;
    }
    setParsing(true);
    try {
      let base64: string;
      let imageType: string;
      if (imageFile.type === "application/pdf") {
        const img = await pdfFirstPageToImageFile(imageFile);
        base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => {
            const data = (r.result as string).split(",")[1];
            resolve(data ?? "");
          };
          r.onerror = reject;
          r.readAsDataURL(img);
        });
        imageType = "image/png";
      } else {
        base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => {
            const data = (r.result as string).split(",")[1];
            resolve(data ?? "");
          };
          r.onerror = reject;
          r.readAsDataURL(imageFile);
        });
        imageType = imageFile.type;
      }
      const { data, error } = await supabase.functions.invoke("parse-permit-comments", {
        body: { imageBase64: base64, imageType, pageNumber: 1 },
      });
      if (error) throw error;
      const payload = data as { comments?: ParsedRow[]; page_number?: number } | null;
      const comments = Array.isArray(payload?.comments) ? payload.comments : [];
      setUploadRows(comments);
      if (typeof payload?.page_number === "number") setPageNumber(payload.page_number);
      toast.success(`Extracted ${comments.length} comments`);
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setParsing(false);
    }
  }, [imageFile]);

  const updateUploadRow = (index: number, field: keyof ParsedRow, value: string | null) => {
    setUploadRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value ?? r[field] } : r))
    );
  };

  const approveAll = useCallback(async () => {
    if (!user || !projectId) {
      toast.error("Select a project to save comments");
      return;
    }
    if (uploadRows.length === 0) {
      toast.error("No comments to save");
      return;
    }
    setSaving(true);
    if (timerRef.current?.isRunning()) {
      await timerRef.current.stopAndSave();
    }
    try {
      const toInsert = uploadRows.map((r) => ({
        project_id: projectId,
        original_text: r.original_text,
        discipline: r.discipline,
        code_reference: r.code_reference || null,
        status: "Approved",
        page_number: pageNumber,
      }));
      const { error } = await supabase.from("parsed_comments").insert(toInsert);
      if (error) throw error;
      toast.success(`Saved ${toInsert.length} comments`);
      setUploadRows([]);
      refetchComments();
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [user, projectId, uploadRows, pageNumber, refetchComments]);

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Comment Review</h1>
            <p className="text-muted-foreground text-sm">
              Comments from the portal report &quot;Plan Review - Review Comments&quot; for the selected project.
            </p>
          </div>
        </div>

        {!projectId ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Select a project in the sidebar to view and load comments from the portal.
            </CardContent>
          </Card>
        ) : commentsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : portalComments.length === 0 && !noCommentsInPortal ? (
          <Card>
            <CardHeader>
              <CardTitle>No comments loaded</CardTitle>
              <CardDescription>
                Load comments from the portal report &quot;Plan Review - Review Comments&quot; for this project.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={loadFromPortal} disabled={loadingFromPortal}>
                {loadingFromPortal ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {loadingFromPortal ? "Loading…" : "Load comments from portal"}
              </Button>
            </CardContent>
          </Card>
        ) : noCommentsInPortal && portalComments.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No comments found in the portal for this project. The &quot;Plan Review - Review Comments&quot; report may be empty or not yet available.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Portal comments</CardTitle>
                  <CardDescription>
                    {portalComments.length} comment{portalComments.length !== 1 ? "s" : ""} from the portal.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => { refetchComments(); }}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-auto max-h-[480px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Comment</TableHead>
                      <TableHead className="w-[140px]">Discipline</TableHead>
                      <TableHead className="w-[120px]">Code ref.</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {portalComments.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm text-muted-foreground align-top max-w-[400px]">
                          {row.original_text}
                        </TableCell>
                        <TableCell>{row.discipline ?? "—"}</TableCell>
                        <TableCell>{row.code_reference ?? "—"}</TableCell>
                        <TableCell>{row.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {projectId && (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="upload">
              <AccordionTrigger>Optional: Upload a document to parse</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Letter / Document</CardTitle>
                      <CardDescription>
                        Upload an image or PDF of a permit comment letter. Then click Parse to extract comments and save to this project.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center min-h-[200px] bg-muted/30">
                        {imagePreview ? (
                          <img
                            src={imagePreview}
                            alt="Letter preview"
                            className="max-h-[240px] w-auto object-contain rounded border"
                          />
                        ) : (
                          <Upload className="h-10 w-10 text-muted-foreground mb-2" />
                        )}
                        <Input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={handleFileChange}
                          className="mt-2 max-w-xs"
                        />
                      </div>
                      <Button onClick={runParse} disabled={parsing || !imageFile} className="w-full" size="sm">
                        {parsing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        {parsing ? "Parsing…" : "Parse comments with AI"}
                      </Button>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">Extracted comments</CardTitle>
                          <CardDescription>Edit then Approve All to save to the project.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <ReviewTimer ref={timerRef} projectId={projectId} commentCount={uploadRows.length} />
                          <Button
                            size="sm"
                            onClick={approveAll}
                            disabled={saving || uploadRows.length === 0}
                            className="bg-accent hover:bg-accent/90"
                          >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                            Approve All
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {uploadRows.length === 0 ? (
                        <p className="text-muted-foreground text-sm py-4">Upload a document and click Parse.</p>
                      ) : (
                        <div className="border rounded-md overflow-auto max-h-[280px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Comment</TableHead>
                                <TableHead className="w-[120px]">Discipline</TableHead>
                                <TableHead className="w-[100px]">Code ref.</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {uploadRows.map((row, i) => (
                                <TableRow key={i}>
                                  <TableCell>
                                    <Input
                                      value={row.original_text}
                                      onChange={(e) => updateUploadRow(i, "original_text", e.target.value)}
                                      className="min-w-[160px] text-sm"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Select
                                      value={row.discipline}
                                      onValueChange={(v) => updateUploadRow(i, "discipline", v)}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {DISCIPLINES.map((d) => (
                                          <SelectItem key={d} value={d}>
                                            {d}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={row.code_reference ?? ""}
                                      onChange={(e) => updateUploadRow(i, "code_reference", e.target.value || null)}
                                      placeholder="e.g. IBC 1004.3"
                                      className="h-8 text-sm"
                                    />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    </div>
  );
}
