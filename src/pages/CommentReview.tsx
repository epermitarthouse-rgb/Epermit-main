import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { isTaxonomyDiscipline } from "@/lib/commentDisciplineTaxonomy";
import { parsePgcRawRefDisplayText } from "@/lib/parsePgcRawRefDisplayText";
import { pdfFirstPageToImageFile } from "@/utils/pdfToImage";
import { toast } from "sonner";
import { FileImage, Loader2, CheckCircle2, Upload, ArrowLeft, RefreshCw } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Eyebrow, SectionTitle } from "@/components/ui/Typography";

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
  ingest_source: "raw_ref" | "fallback_llm" | null;
}

/** Non–raw_ref: single Comment cell = verbatim `original_text`. */
function portalCommentTableCellContent(row: ParsedCommentRow) {
  return row.original_text;
}

function portalRawRefCellDash(s: string | undefined | null): string {
  const t = s?.trim();
  return t ? t : "—";
}

/** Status: raw_ref = portal line from `original_text` blob (`status:`), not DB-normalized `row.status`. */
function portalStatusDisplayText(row: ParsedCommentRow): string {
  if (row.ingest_source !== "raw_ref") return row.status;
  const f = parsePgcRawRefDisplayText(row.original_text);
  const portal = f.statusInBlob?.trim();
  return portal || row.status;
}

/**
 * Discipline: raw_ref shows only LLM/taxonomy values from `discipline-classifier-agent` (see `TAXONOMY_DISCIPLINES`).
 * Reviewer/org strings are never taxonomy — hidden unless they match the classifier set (should not happen).
 */
function portalDisciplineDisplayText(row: ParsedCommentRow): string {
  if (row.ingest_source !== "raw_ref") return row.discipline ?? "—";
  const d = row.discipline?.trim();
  if (d && isTaxonomyDiscipline(d)) return d;
  return "—";
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
  const [parserDetail, setParserDetail] = useState<{
    reason?: string;
    message?: string;
    parsed_count?: number;
    reconciliation?: {
      extracted_ref_count?: number;
      parsed_source_ref_count?: number;
      normalized_count?: number;
      deterministic_parsed_row_count?: number;
      fallback_parsed_row_count?: number;
      inserted_raw_ref_count?: number;
      inserted_fallback_count?: number;
      stored_raw_ref_count?: number;
      stored_fallback_count?: number;
      total_stored_count?: number;
      rendered_comment_count?: number;
      extracted_refs?: string[];
      parsed_refs?: string[];
      normalized_refs?: string[];
      rendered_refs?: string[];
      missing_refs?: string[];
      warning?: string | null;
    };
  } | null>(null);
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
      .select("id, project_id, original_text, discipline, code_reference, status, page_number, ingest_source")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Failed to load comments");
      return [];
    }
    return (data as ParsedCommentRow[]) || [];
  }, [projectId]);

  const extractRefFromOriginalText = useCallback((text: string): string | null => {
    const m = String(text ?? "").match(/(?:^|\n)\s*ref:\s*([0-9]{1,4})\b/i);
    return m?.[1] ?? null;
  }, []);

  const { data: portalComments = [], isLoading: commentsLoading, refetch: refetchComments } = useQuery({
    queryKey: ["parsed_comments", projectId],
    queryFn: fetchComments,
    enabled: !!projectId,
  });

  const rawRefComments = useMemo(
    () => portalComments.filter((row) => row.ingest_source === "raw_ref"),
    [portalComments],
  );
  const fallbackComments = useMemo(
    () => portalComments.filter((row) => row.ingest_source === "fallback_llm"),
    [portalComments],
  );
  const renderSource: "raw_ref" | "fallback_llm" | "none" = rawRefComments.length > 0
    ? "raw_ref"
    : fallbackComments.length > 0
      ? "fallback_llm"
      : "none";
  const renderedPortalComments = renderSource === "raw_ref" ? rawRefComments : fallbackComments;

  useEffect(() => {
    if (!projectId) return;
    console.log("[CommentReview] render-source resolution", {
      project_id: projectId,
      fetched_raw_ref_count: rawRefComments.length,
      fetched_fallback_count: fallbackComments.length,
      final_render_source: renderSource,
      final_rendered_count: renderedPortalComments.length,
    });
  }, [projectId, rawRefComments.length, fallbackComments.length, renderSource, renderedPortalComments.length]);

  const loadFromPortal = useCallback(async () => {
    if (!projectId || !user?.id) return;
    setLoadingFromPortal(true);
    setNoCommentsInPortal(false);
    setParserDetail(null);
    const pollIntervalMs = 2500;
    const maxRounds = 60;
    let cursor: { pdfIndex: number } | undefined;
    let round = 0;
    try {
      while (round < maxRounds) {
        const capturePipelineEvidence =
          typeof sessionStorage !== "undefined" &&
          sessionStorage.getItem("ep_capture_pipeline_evidence") === "1";
        const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", {
          body: {
            project_id: projectId,
            /** First round only: replace rows + clear cursor so re-parse is complete (continuation uses cursor). */
            ...(!cursor ? { full_refresh: true } : {}),
            ...(cursor && { cursor }),
            ...(capturePipelineEvidence
              ? { capture_pipeline_evidence: true }
              : {}),
          },
        });
        if (error) {
          toast.error("Pipeline failed");
          setParserDetail({ message: error.message || "Pipeline invoke failed" });
          break;
        }
        const cp = data?.comment_parser;
        if (cp?.reason === "no_comments_in_portal") {
          setNoCommentsInPortal(true);
          setParserDetail({
            reason: cp.reason,
            message: cp.message,
            parsed_count: cp.parsed_count,
          });
          await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
          break;
        }
        if (cp?.done === true && !cp?.error) {
          const refreshed = await refetchComments();
          const refreshedRows = Array.isArray(refreshed.data)
            ? refreshed.data
            : [];
          const refreshedRawRefRows = refreshedRows.filter(
            (row) => row.ingest_source === "raw_ref",
          );
          const refreshedFallbackRows = refreshedRows.filter(
            (row) => row.ingest_source === "fallback_llm",
          );
          const refreshedRenderSource: "raw_ref" | "fallback_llm" | "none" =
            refreshedRawRefRows.length > 0
              ? "raw_ref"
              : refreshedFallbackRows.length > 0
                ? "fallback_llm"
                : "none";
          const refreshedRenderedRows =
            refreshedRenderSource === "raw_ref"
              ? refreshedRawRefRows
              : refreshedFallbackRows;
          const renderedCommentCount = refreshedRenderedRows.length;
          const fetchedRawCount = refreshedRawRefRows.length;
          const fetchedFallbackCount = refreshedFallbackRows.length;
          const renderedRefs = refreshedRenderedRows.length > 0
            ? Array.from(
                new Set(
                  refreshedRenderedRows
                    .map((row) => extractRefFromOriginalText(row.original_text))
                    .filter((r): r is string => !!r),
                ),
              )
            : [];
          console.log("[CommentReview] fetch/render pipeline", {
            frontend_fetched_raw_count: fetchedRawCount,
            frontend_fetched_fallback_count: fetchedFallbackCount,
            final_render_source: refreshedRenderSource,
            final_rendered_count: renderedCommentCount,
          });
          const extractedRefCount = Number(
            cp?.reconciliation?.extracted_ref_count ?? 0,
          );
          const parsedSourceRefCount = Number(
            cp?.reconciliation?.parsed_source_ref_count ?? 0,
          );
          const normalizedCount = Number(
            cp?.reconciliation?.normalized_count ?? 0,
          );
          const deterministicParsedRowCount = Number(
            cp?.reconciliation?.deterministic_parsed_row_count ?? 0,
          );
          const fallbackParsedRowCount = Number(
            cp?.reconciliation?.fallback_parsed_row_count ?? 0,
          );
          const insertedRawRefCount = Number(
            cp?.reconciliation?.inserted_raw_ref_count ?? 0,
          );
          const insertedFallbackCount = Number(
            cp?.reconciliation?.inserted_fallback_count ?? 0,
          );
          const storedRawRefCount = Number(
            cp?.reconciliation?.stored_raw_ref_count ?? 0,
          );
          const storedFallbackCount = Number(
            cp?.reconciliation?.stored_fallback_count ?? 0,
          );
          const totalStoredCount = Number(
            cp?.reconciliation?.total_stored_count ?? 0,
          );
          const extractedRefs = Array.isArray(cp?.reconciliation?.extracted_refs)
            ? cp.reconciliation.extracted_refs
            : [];
          const parsedRefs = Array.isArray(cp?.reconciliation?.parsed_refs)
            ? cp.reconciliation.parsed_refs
            : [];
          const normalizedRefs = Array.isArray(cp?.reconciliation?.normalized_refs)
            ? cp.reconciliation.normalized_refs
            : [];
          const missingRefs = Array.isArray(cp?.reconciliation?.missing_refs)
            ? cp.reconciliation.missing_refs
            : [];
          const disappearedAfterParse = Array.isArray(cp?.reconciliation?.disappeared_after_parse)
            ? cp.reconciliation.disappeared_after_parse
            : [];
          const disappearedAfterNormalize = Array.isArray(cp?.reconciliation?.disappeared_after_normalize)
            ? cp.reconciliation.disappeared_after_normalize
            : [];
          const disappearedAfterStore = Array.isArray(cp?.reconciliation?.disappeared_after_store)
            ? cp.reconciliation.disappeared_after_store
            : [];
          const reconciliationWarningParts: string[] = [];
          if (
            Number.isFinite(extractedRefCount) &&
            Number.isFinite(parsedSourceRefCount) &&
            extractedRefCount !== parsedSourceRefCount
          ) {
            reconciliationWarningParts.push(
              `extracted_ref_count (${extractedRefCount}) != parsed_ref_count (${parsedSourceRefCount})`,
            );
          }
          if (
            Number.isFinite(parsedSourceRefCount) &&
            Number.isFinite(normalizedCount) &&
            parsedSourceRefCount !== normalizedCount
          ) {
            reconciliationWarningParts.push(
              `parsed_ref_count (${parsedSourceRefCount}) != normalized_count (${normalizedCount})`,
            );
          }
          if (
            Number.isFinite(normalizedCount) &&
            Number.isFinite(insertedRawRefCount) &&
            normalizedCount !== insertedRawRefCount
          ) {
            reconciliationWarningParts.push(
              `normalized_count (${normalizedCount}) != inserted_raw_ref_count (${insertedRawRefCount})`,
            );
          }
          if (
            Number.isFinite(totalStoredCount) &&
            totalStoredCount !== renderedCommentCount
          ) {
            reconciliationWarningParts.push(
              `total_stored_count (${totalStoredCount}) != rendered_comment_count (${renderedCommentCount})`,
            );
          }
          if (missingRefs.length > 0) {
            reconciliationWarningParts.push(
              `missing refs: ${missingRefs.join(", ")}`,
            );
          }
          if (disappearedAfterParse.length > 0) {
            reconciliationWarningParts.push(
              `disappeared_after_parse: ${disappearedAfterParse.join(", ")}`,
            );
          }
          if (disappearedAfterNormalize.length > 0) {
            reconciliationWarningParts.push(
              `disappeared_after_normalize: ${disappearedAfterNormalize.join(", ")}`,
            );
          }
          if (disappearedAfterStore.length > 0) {
            reconciliationWarningParts.push(
              `disappeared_after_store: ${disappearedAfterStore.join(", ")}`,
            );
          }
          if (reconciliationWarningParts.length > 0) {
            console.warn("[CommentReview] reconciliation mismatch", {
              extracted_ref_count: extractedRefCount,
              parsed_source_ref_count: parsedSourceRefCount,
              normalized_count: normalizedCount,
              deterministic_parsed_row_count: deterministicParsedRowCount,
              fallback_parsed_row_count: fallbackParsedRowCount,
              inserted_raw_ref_count: insertedRawRefCount,
              inserted_fallback_count: insertedFallbackCount,
              stored_raw_ref_count: storedRawRefCount,
              stored_fallback_count: storedFallbackCount,
              total_stored_count: totalStoredCount,
              rendered_comment_count: renderedCommentCount,
              extracted_refs: extractedRefs,
              parsed_refs: parsedRefs,
              normalized_refs: normalizedRefs,
              rendered_refs: renderedRefs,
              disappeared_after_parse: disappearedAfterParse,
              disappeared_after_normalize: disappearedAfterNormalize,
              disappeared_after_store: disappearedAfterStore,
              missing_refs: missingRefs,
              warning: reconciliationWarningParts.join(" | "),
            });
          }
          console.log("[CommentReview] ref stages", {
            extracted_refs: extractedRefs,
            parsed_refs: parsedRefs,
            normalized_refs: normalizedRefs,
            rendered_refs: renderedRefs,
            extracted_ref_count: extractedRefCount,
            parsed_ref_count: parsedSourceRefCount,
            normalized_count: normalizedCount,
            deterministic_parsed_row_count: deterministicParsedRowCount,
            fallback_parsed_row_count: fallbackParsedRowCount,
            inserted_raw_ref_count: insertedRawRefCount,
            inserted_fallback_count: insertedFallbackCount,
            stored_raw_ref_count: storedRawRefCount,
            stored_fallback_count: storedFallbackCount,
            total_stored_count: totalStoredCount,
            rendered_count: renderedCommentCount,
            disappeared_after_parse: disappearedAfterParse,
            disappeared_after_normalize: disappearedAfterNormalize,
            disappeared_after_store: disappearedAfterStore,
          });
          if (cp.pipeline_evidence != null) {
            console.info("[CommentReview pipeline_evidence]", cp.pipeline_evidence);
          }
          await queryClient.invalidateQueries({ queryKey: ["parsed_comments"] });
          const pc = typeof cp.parsed_count === "number" ? cp.parsed_count : 0;
          if (pc > 0) {
            toast.success(`Loaded ${pc} comment(s) from portal`);
          } else {
            setParserDetail({
              reason: cp.reason,
              message: cp.message,
              parsed_count: pc,
              reconciliation: {
                extracted_ref_count: extractedRefCount,
                parsed_source_ref_count: parsedSourceRefCount,
                normalized_count: normalizedCount,
                deterministic_parsed_row_count: deterministicParsedRowCount,
                fallback_parsed_row_count: fallbackParsedRowCount,
                inserted_raw_ref_count: insertedRawRefCount,
                inserted_fallback_count: insertedFallbackCount,
                stored_raw_ref_count: storedRawRefCount,
                stored_fallback_count: storedFallbackCount,
                total_stored_count: totalStoredCount,
                rendered_comment_count: renderedCommentCount,
                extracted_refs: extractedRefs,
                parsed_refs: parsedRefs,
                normalized_refs: normalizedRefs,
                rendered_refs: renderedRefs,
                missing_refs: missingRefs,
                warning:
                  reconciliationWarningParts.length > 0
                    ? reconciliationWarningParts.join(" | ")
                    : (cp?.reconciliation?.warning ?? null),
              },
            });
            toast.info(
              typeof cp.message === "string" && cp.message.length > 0
                ? cp.message
                : "Parser finished but no comments were saved.",
            );
          }
          if (pc > 0 && reconciliationWarningParts.length > 0) {
            setParserDetail({
              reason: cp.reason,
              message: reconciliationWarningParts.join(" | "),
              parsed_count: pc,
              reconciliation: {
                extracted_ref_count: extractedRefCount,
                parsed_source_ref_count: parsedSourceRefCount,
                normalized_count: normalizedCount,
                deterministic_parsed_row_count: deterministicParsedRowCount,
                fallback_parsed_row_count: fallbackParsedRowCount,
                inserted_raw_ref_count: insertedRawRefCount,
                inserted_fallback_count: insertedFallbackCount,
                stored_raw_ref_count: storedRawRefCount,
                stored_fallback_count: storedFallbackCount,
                total_stored_count: totalStoredCount,
                rendered_comment_count: renderedCommentCount,
                extracted_refs: extractedRefs,
                parsed_refs: parsedRefs,
                normalized_refs: normalizedRefs,
                rendered_refs: renderedRefs,
                missing_refs: missingRefs,
                warning: reconciliationWarningParts.join(" | "),
              },
            });
          }
          break;
        }
        if (cp?.error && cp.error !== "timeout") {
          setParserDetail({
            reason: cp.reason,
            message:
              typeof cp.message === "string" && cp.message.length > 0
                ? cp.message
                : String(cp.error),
          });
          toast.error(
            typeof cp.message === "string" && cp.message.length > 0
              ? cp.message
              : String(cp.error),
          );
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
  }, [extractRefFromOriginalText, projectId, user?.id, queryClient, refetchComments]);

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
        ingest_source: "fallback_llm" as const,
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
      <div className="min-h-[80vh] flex items-center justify-center bg-cream">
        <Loader2 className="h-8 w-8 animate-spin text-teal" />
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] bg-cream">
      <Section variant="cream" className="pt-10 pb-8 border-b border-cream-sunken">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="text-ink-secondary-light hover:text-ink-primary-light shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <Eyebrow>COMMENT REVIEW</Eyebrow>
              <h1 className="mt-3 font-serif text-4xl sm:text-5xl text-ink-primary-light leading-tight">
                Comment <em className="text-gold italic">Review</em>
              </h1>
              <p className="mt-3 text-ink-secondary-light max-w-2xl text-sm sm:text-base leading-relaxed">
                Review parsed jurisdiction comments, classifier outputs, statuses, disciplines, and applicant/reviewer discussion history.
              </p>
              <p className="text-sm text-ink-tertiary-light mt-2 max-w-2xl">
                Comments from the portal report &quot;Plan Review - Review Comments&quot; for the selected project.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-4 py-6">
        {!projectId ? (
          <Card className="border-dashed border-cream-sunken bg-cream-raised/80 shadow-cream">
            <CardContent className="py-10 text-center text-ink-secondary-light space-y-2">
              Select a project in the sidebar to view and load comments from the portal.
            </CardContent>
          </Card>
        ) : commentsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-teal" />
          </div>
        ) : renderedPortalComments.length === 0 && !noCommentsInPortal ? (
          <Card className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream">
            <CardHeader>
              <CardTitle>No comments loaded</CardTitle>
              <CardDescription className="space-y-2">
                <span>
                  Load comments from the portal report &quot;Plan Review - Review Comments&quot; for this project.
                </span>
                {(parserDetail?.message || parserDetail?.reason) && (
                  <p className="text-sm text-warning-foreground rounded-md border border-warning/35 bg-warning/10 px-3 py-2 whitespace-pre-wrap">
                    {parserDetail.message ||
                      (parserDetail.reason ? `Reason: ${parserDetail.reason}` : "")}
                  </p>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="gold" onClick={loadFromPortal} disabled={loadingFromPortal}>
                {loadingFromPortal ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {loadingFromPortal ? "Loading…" : "Load comments from portal"}
              </Button>
            </CardContent>
          </Card>
        ) : noCommentsInPortal && renderedPortalComments.length === 0 ? (
          <Card className="border-dashed border-cream-sunken bg-cream-raised/60 shadow-cream">
            <CardContent className="py-8 text-center text-ink-secondary-light space-y-2">
              <p>
                No comments found in the portal for this project. The &quot;Plan Review - Review Comments&quot; report may be empty or not yet available.
              </p>
              {parserDetail?.message && (
                <p className="text-sm text-warning-foreground whitespace-pre-wrap rounded-md border border-warning/25 bg-warning/8 px-3 py-2">
                  {parserDetail.message}
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream p-4 sm:p-5">
            <div className="overflow-hidden rounded-lg border border-obsidian-raised bg-obsidian shadow-inner">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-obsidian-raised bg-obsidian-raised px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <SectionTitle className="!text-xl sm:!text-2xl text-ink-primary-dark">
                    Portal comments
                  </SectionTitle>
                  <p className="text-sm text-ink-secondary-dark mt-1">
                    {renderedPortalComments.length} comment{renderedPortalComments.length !== 1 ? "s" : ""} from the portal.
                  </p>
                  <p className="mt-1 text-xs text-ink-tertiary-dark">
                    Render source: <span className="font-mono text-teal">{renderSource}</span>
                    {renderSource === "fallback_llm" ? " (fallback mode active)" : ""}
                  </p>
                  {parserDetail?.reconciliation?.warning && (
                    <p className="mt-2 text-xs text-warning-foreground rounded-md border border-warning/35 bg-warning/10 px-2 py-1.5 whitespace-pre-wrap">
                      {parserDetail.reconciliation.warning}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingFromPortal}
                  onClick={() => {
                    void loadFromPortal();
                  }}
                  className="shrink-0 border-teal/40 bg-teal/10 text-teal hover:bg-teal/15"
                >
                  {loadingFromPortal ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Reload from portal
                </Button>
              </div>
              <div className="max-h-[min(520px,70vh)] overflow-auto">
                <Table
                  wrapperClassName="rounded-none border-0 shadow-none bg-transparent dark:border-0"
                  className="min-w-[1000px] w-full"
                >
                  {renderSource === "raw_ref" ? (
                    <>
                      <TableHeader>
                        <TableRow className="border-obsidian-raised bg-obsidian-raised hover:bg-obsidian-raised border-0">
                          <TableHead className="table-head-sticky w-[48px] min-w-[44px] whitespace-nowrap px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">REF #</TableHead>
                          <TableHead className="table-head-sticky w-[56px] min-w-[48px] whitespace-nowrap px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">CYCLE</TableHead>
                          <TableHead className="table-head-sticky min-w-[140px] max-w-[200px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">REVIEWED BY</TableHead>
                          <TableHead className="table-head-sticky min-w-[88px] w-[100px] whitespace-nowrap px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">TYPE</TableHead>
                          <TableHead className="table-head-sticky min-w-[120px] max-w-[160px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">FILENAME</TableHead>
                          <TableHead className="table-head-sticky min-w-[240px] max-w-[480px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">DISCUSSION</TableHead>
                          <TableHead className="table-head-sticky w-[100px] min-w-[88px] whitespace-nowrap px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">STATUS</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {renderedPortalComments.map((row) => {
                          const f = parsePgcRawRefDisplayText(row.original_text);
                          return (
                            <TableRow
                              key={row.id}
                              className="border-t border-obsidian-raised bg-obsidian-sunken/40 text-ink-primary-dark hover:bg-obsidian-raised/35 transition-colors"
                            >
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top font-mono-data tabular-nums text-ink-secondary-dark">
                                {portalRawRefCellDash(f.ref)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top font-mono-data tabular-nums text-ink-secondary-dark">
                                {portalRawRefCellDash(f.cycle)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top whitespace-pre-wrap break-words text-ink-primary-dark">
                                {portalRawRefCellDash(f.reviewedBy)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top whitespace-pre-wrap text-ink-primary-dark">
                                {portalRawRefCellDash(f.type)}
                              </TableCell>
                              <TableCell
                                className="px-4 py-2.5 sm:px-5 text-sm align-top whitespace-pre-wrap break-all text-ink-primary-dark"
                                title={f.filename ?? undefined}
                              >
                                {portalRawRefCellDash(f.filename)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top text-ink-primary-dark whitespace-pre-wrap break-words max-w-[480px]">
                                {f.discussion}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm whitespace-nowrap align-top text-ink-primary-dark">
                                {portalStatusDisplayText(row)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </>
                  ) : (
                    <>
                      <TableHeader>
                        <TableRow className="border-obsidian-raised bg-obsidian-raised hover:bg-obsidian-raised border-0">
                          <TableHead className="table-head-sticky min-w-[220px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">Comment</TableHead>
                          <TableHead className="table-head-sticky w-[140px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">Discipline</TableHead>
                          <TableHead className="table-head-sticky w-[120px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">Code ref.</TableHead>
                          <TableHead className="table-head-sticky w-[100px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark sm:px-5 sm:py-3.5">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {renderedPortalComments.map((row) => (
                          <TableRow
                            key={row.id}
                            className="border-t border-obsidian-raised bg-obsidian-sunken/40 text-ink-primary-dark hover:bg-obsidian-raised/35 transition-colors"
                          >
                            <TableCell className="px-4 py-2.5 sm:px-5 text-sm text-ink-primary-dark align-top max-w-[400px]">
                              {portalCommentTableCellContent(row)}
                            </TableCell>
                            <TableCell className="px-4 py-2.5 sm:px-5 text-ink-secondary-dark">{portalDisciplineDisplayText(row)}</TableCell>
                            <TableCell className="px-4 py-2.5 sm:px-5 font-mono-data text-xs align-top text-ink-secondary-dark">{row.code_reference ?? "—"}</TableCell>
                            <TableCell className="px-4 py-2.5 sm:px-5 text-ink-primary-dark">{portalStatusDisplayText(row)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </>
                  )}
                </Table>
              </div>
            </div>
          </div>
        )}

        {projectId && (
          <Accordion type="single" collapsible className="w-full rounded-xl border border-cream-sunken bg-cream-raised shadow-cream">
            <AccordionItem value="upload" className="border-border px-1">
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
                      <div className="border-2 border-dashed border-gold/30 rounded-xl p-6 flex flex-col items-center justify-center min-h-[200px] bg-cream-sunken/40">
                        {imagePreview ? (
                          <img
                            src={imagePreview}
                            alt="Letter preview"
                            className="max-h-[240px] w-auto object-contain rounded border"
                          />
                        ) : (
                          <Upload className="h-10 w-10 text-teal mb-2" />
                        )}
                        <Input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={handleFileChange}
                          className="mt-2 max-w-xs"
                        />
                      </div>
                      <Button variant="gold" onClick={runParse} disabled={parsing || !imageFile} className="w-full" size="sm">
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
                            variant="gold"
                            size="sm"
                            onClick={approveAll}
                            disabled={saving || uploadRows.length === 0}
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
                        <div className="border border-border rounded-lg overflow-auto max-h-[280px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="table-head-sticky">Comment</TableHead>
                                <TableHead className="table-head-sticky w-[120px]">Discipline</TableHead>
                                <TableHead className="table-head-sticky w-[100px]">Code ref.</TableHead>
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
