import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import { useProjectDocuments } from "@/hooks/useProjectDocuments";
import { ReviewTimer, type ReviewTimerHandle } from "@/components/shadow/ReviewTimer";
import { supabase } from "@/lib/supabase";
import { isTaxonomyDiscipline } from "@/lib/commentDisciplineTaxonomy";
import { parsePgcRawRefDisplayText } from "@/lib/parsePgcRawRefDisplayText";
import { pdfFirstPageToImageFile } from "@/utils/pdfToImage";
import {
  COMMENT_LETTER_SUPPORTED_FORMATS_HINT,
  extractDocumentForCommentParse,
  fileToBase64,
  isLegacyDocFile,
  LEGACY_DOC_ERROR_MESSAGE,
} from "@/utils/extractDocumentText";
import { formatCommentLetterSaveError, type ProjectDocument } from "@/types/document";
import {
  isManualCommentLetter,
  type ManualLetterCommentScope,
} from "@/lib/commentReviewManualLetter";
import { toast } from "sonner";
import { FileImage, Loader2, CheckCircle2, Upload, ArrowLeft, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Section } from "@/components/ui/Section";
import { Eyebrow, SectionTitle } from "@/components/ui/Typography";

const DISCIPLINES = ["Architecture", "MEP", "Structural", "Zoning", "Fire", "DOEE", "Energy"] as const;

interface ParserSummary {
  total: number;
  by_section: Record<string, number>;
  by_discipline: Record<string, number>;
}

export interface ParsedRow {
  original_text: string;
  discipline: string;
  code_reference: string | null;
  reviewer_name?: string | null;
  comment_number?: string | null;
  previous_comment_text?: string | null;
  existing_response_text?: string | null;
  code_references?: string[];
  source_page?: number | null;
  source_file?: string | null;
  confidence?: number;
}

interface ParsedCommentRow {
  id: string;
  project_id: string;
  original_text: string;
  discipline: string | null;
  code_reference: string | null;
  status: string;
  page_number: number | null;
  ingest_source: "raw_ref" | "fallback_llm" | "manual_letter" | null;
  source_document_id?: string | null;
  previous_comment_text?: string | null;
  reviewer_name?: string | null;
  comment_number?: string | null;
}

type ConfirmDialogState =
  | { kind: "deleteLetter"; alsoDeleteComments: boolean }
  | { kind: "clearSaved" }
  | { kind: "approveAll"; conflict: "same_source" | "other_letters" | "none" }
  | { kind: "newUpload"; file: File }
  | null;

function formatLetterDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Non–raw_ref: single Comment cell = verbatim `original_text`. */
function portalCommentTableCellContent(row: ParsedCommentRow) {
  return row.original_text;
}

function manualLetterCommentDisplay(row: ParsedCommentRow): string {
  const active = row.original_text?.trim() ?? "";
  const previous = row.previous_comment_text?.trim() ?? "";
  if (active && previous) return `${active}\n\n[Previous comment]\n${previous}`;
  if (previous) return previous;
  return active || "—";
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
  const { projectId, projectIdFromUrl } = useResolvedProjectId();
  const { uploadDocumentWithResult, deleteDocument, getDownloadUrl, documents, fetchDocuments } =
    useProjectDocuments(projectId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const activeProject = useMemo(
    () => (projectId ? projects.find((p) => p.id === projectId) ?? null : null),
    [projectId, projects],
  );

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
  /** Original file selected by the user — persisted to project_documents. */
  const [originalUploadFile, setOriginalUploadFile] = useState<File | null>(null);
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [uploadRows, setUploadRows] = useState<ParsedRow[]>([]);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [fileSelectionError, setFileSelectionError] = useState<string | null>(null);
  const [parserSummary, setParserSummary] = useState<ParserSummary | null>(null);
  const [lastParseMethod, setLastParseMethod] = useState<string | null>(null);
  const [parseAttempted, setParseAttempted] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmDialogState>(null);
  const [newUploadReplaceProject, setNewUploadReplaceProject] = useState(false);
  const initializedLetterProjectRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReviewTimerHandle>(null);

  const disciplineOptions = useMemo(() => {
    const fromRows = uploadRows.map((r) => r.discipline).filter(Boolean);
    return [...new Set([...DISCIPLINES, ...fromRows])];
  }, [uploadRows]);

  const fetchComments = useCallback(async (): Promise<ParsedCommentRow[]> => {
    if (!projectId) return [];
    const { data, error } = await supabase
      .from("parsed_comments")
      .select("id, project_id, original_text, discipline, code_reference, status, page_number, ingest_source, source_document_id, previous_comment_text, reviewer_name, comment_number")
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

  const savedManualLetterCount = useMemo(() => {
    if (!sourceDocumentId) return 0;
    return portalComments.filter(
      (row) =>
        row.ingest_source === "manual_letter" && row.source_document_id === sourceDocumentId,
    ).length;
  }, [portalComments, sourceDocumentId]);

  const projectManualLetterCount = useMemo(
    () => portalComments.filter((row) => row.ingest_source === "manual_letter").length,
    [portalComments],
  );

  const otherManualLetterCount = useMemo(
    () =>
      portalComments.filter(
        (row) =>
          row.ingest_source === "manual_letter" &&
          row.source_document_id &&
          row.source_document_id !== sourceDocumentId,
      ).length,
    [portalComments, sourceDocumentId],
  );

  const commentLetters = useMemo(
    () =>
      documents
        .filter(isManualCommentLetter)
        .sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [documents],
  );

  const selectedLetter = useMemo(
    () => commentLetters.find((doc) => doc.id === sourceDocumentId) ?? null,
    [commentLetters, sourceDocumentId],
  );

  const canParseLetter = Boolean(projectId && (originalUploadFile || sourceDocumentId));
  const parseButtonLabel = uploadRows.length > 0 ? "Re-parse document" : "Parse comments";

  useEffect(() => {
    if (!projectId) {
      initializedLetterProjectRef.current = null;
      return;
    }
    if (initializedLetterProjectRef.current === projectId) return;
    initializedLetterProjectRef.current = projectId;
    if (commentLetters.length > 0) {
      setSourceDocumentId(commentLetters[0].id);
    }
  }, [projectId, commentLetters]);

  useEffect(() => {
    if (!sourceDocumentId && commentLetters.length > 0) {
      setSourceDocumentId(commentLetters[0].id);
      return;
    }
    if (
      sourceDocumentId &&
      commentLetters.length > 0 &&
      !commentLetters.some((doc) => doc.id === sourceDocumentId)
    ) {
      setSourceDocumentId(commentLetters[0].id);
    }
  }, [commentLetters, sourceDocumentId]);

  const rawRefComments = useMemo(
    () => portalComments.filter((row) => row.ingest_source === "raw_ref"),
    [portalComments],
  );
  const manualLetterComments = useMemo(
    () => portalComments.filter((row) => row.ingest_source === "manual_letter"),
    [portalComments],
  );
  const fallbackLlmComments = useMemo(
    () => portalComments.filter((row) => row.ingest_source === "fallback_llm"),
    [portalComments],
  );
  const renderSource: "raw_ref" | "manual_letter" | "fallback_llm" | "none" = rawRefComments.length > 0
    ? "raw_ref"
    : manualLetterComments.length > 0
      ? "manual_letter"
      : fallbackLlmComments.length > 0
        ? "fallback_llm"
        : "none";
  const renderedSavedComments =
    renderSource === "raw_ref"
      ? rawRefComments
      : renderSource === "manual_letter"
        ? manualLetterComments
        : fallbackLlmComments;

  const savedCommentsTitle =
    renderSource === "raw_ref"
      ? "Portal comments"
      : renderSource === "manual_letter"
        ? "Manual uploaded comments"
        : renderSource === "fallback_llm"
          ? "Parsed comments"
          : "Comments";

  const savedCommentsSubtitle =
    renderSource === "raw_ref"
      ? `${renderedSavedComments.length} comment${renderedSavedComments.length !== 1 ? "s" : ""} from the portal.`
      : renderSource === "manual_letter"
        ? `${renderedSavedComments.length} comment${renderedSavedComments.length !== 1 ? "s" : ""} from uploaded comment letter(s).`
        : `${renderedSavedComments.length} parsed comment${renderedSavedComments.length !== 1 ? "s" : ""}.`;

  useEffect(() => {
    if (!projectId) return;
    console.log("[CommentReview] render-source resolution", {
      project_id: projectId,
      fetched_raw_ref_count: rawRefComments.length,
      fetched_manual_letter_count: manualLetterComments.length,
      fetched_fallback_count: fallbackLlmComments.length,
      final_render_source: renderSource,
      final_rendered_count: renderedSavedComments.length,
    });
  }, [projectId, rawRefComments.length, manualLetterComments.length, fallbackLlmComments.length, renderSource, renderedSavedComments.length]);

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
            (row) =>
              row.ingest_source === "fallback_llm" || row.ingest_source === "manual_letter",
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

  const resetExtractedParseState = useCallback(() => {
    setUploadRows([]);
    setParserSummary(null);
    setParseStatus(null);
    setLastParseMethod(null);
    setParseAttempted(false);
  }, []);

  const handleSelectLetter = useCallback(
    (docId: string) => {
      setSourceDocumentId(docId);
      setOriginalUploadFile(null);
      setNewUploadReplaceProject(false);
      resetExtractedParseState();
      setImagePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    },
    [resetExtractedParseState],
  );

  const applyNewUpload = useCallback(
    (file: File, replaceProjectOnApprove: boolean) => {
      setFileSelectionError(null);
      setOriginalUploadFile(file);
      setSourceDocumentId(null);
      setNewUploadReplaceProject(replaceProjectOnApprove);
      resetExtractedParseState();

      const lower = file.name.toLowerCase();
      if (file.type.startsWith("image/")) {
        setImagePreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(file);
        });
        return;
      }
      if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
        void pdfFirstPageToImageFile(file)
          .then((imageFile) => {
            setImagePreview((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return URL.createObjectURL(imageFile);
            });
          })
          .catch(() => {
            toast.error("Failed to preview PDF");
            setImagePreview(null);
            setOriginalUploadFile(null);
          });
        return;
      }
      setImagePreview(null);
    },
    [resetExtractedParseState],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      if (isLegacyDocFile(file) || file.type === "application/msword") {
        setFileSelectionError(LEGACY_DOC_ERROR_MESSAGE);
        setOriginalUploadFile(null);
        setSourceDocumentId(null);
        resetExtractedParseState();
        setImagePreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        toast.error(LEGACY_DOC_ERROR_MESSAGE);
        return;
      }

      if (projectManualLetterCount > 0) {
        setPendingConfirm({ kind: "newUpload", file });
        return;
      }

      applyNewUpload(file, false);
    },
    [applyNewUpload, projectManualLetterCount, resetExtractedParseState],
  );

  const loadCommentLetterFile = useCallback(async (): Promise<File | null> => {
    if (originalUploadFile) return originalUploadFile;
    if (!sourceDocumentId) return null;

    const { data: doc, error } = await supabase
      .from("project_documents")
      .select("id, file_name, file_path, file_type, document_type")
      .eq("id", sourceDocumentId)
      .maybeSingle();

    if (error || !doc) {
      console.error("[CommentReview] failed to load source document metadata", error);
      return null;
    }

    const signedUrl = await getDownloadUrl(doc as ProjectDocument);
    if (!signedUrl) return null;

    const response = await fetch(signedUrl);
    if (!response.ok) {
      console.error("[CommentReview] failed to download source document", response.status);
      return null;
    }

    const blob = await response.blob();
    const contentType =
      doc.file_type ||
      blob.type ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return new File([blob], doc.file_name, { type: contentType });
  }, [originalUploadFile, sourceDocumentId, getDownloadUrl]);

  const persistCommentLetter = useCallback(async (): Promise<{
    docId: string | null;
    error?: string;
  }> => {
    if (sourceDocumentId) return { docId: sourceDocumentId };
    if (!projectId || !user || !originalUploadFile) {
      return { docId: null, error: "Missing project, user, or file" };
    }

    const result = await uploadDocumentWithResult({
      file: originalUploadFile,
      document_type: "correspondence",
      description: "Manual comment letter upload (Comment Review)",
      suppressToasts: true,
    });

    if (result.document?.id) {
      setSourceDocumentId(result.document.id);
      await fetchDocuments();
      return { docId: result.document.id };
    }

    const message = formatCommentLetterSaveError(result);
    console.error('[CommentReview] comment letter save failed:', {
      step: result.step,
      error: result.error,
      fileName: originalUploadFile.name,
      fileType: originalUploadFile.type,
    });
    return { docId: null, error: message };
  }, [projectId, user, originalUploadFile, sourceDocumentId, uploadDocumentWithResult, fetchDocuments]);

  const runParse = useCallback(async () => {
    const letterFile = await loadCommentLetterFile();
    if (!letterFile) {
      toast.error("Select or upload a comment letter first");
      return;
    }
    if (!projectId) {
      toast.error("Select a project in the sidebar before parsing");
      return;
    }
    if (!originalUploadFile) {
      setOriginalUploadFile(letterFile);
    }
    setParsing(true);
    setParseStatus(uploadRows.length > 0 ? "Re-extracting text…" : "Extracting text…");
    setUploadRows([]);
    try {
      const { docId, error: saveError } = await persistCommentLetter();
      if (!docId) {
        toast.error(saveError ?? "Failed to save comment letter to project documents");
        return;
      }

      const extraction = await extractDocumentForCommentParse(letterFile);
      if (extraction.kind === "unsupported_doc") {
        toast.error(extraction.message);
        return;
      }

      setParseStatus(parseAttempted || uploadRows.length > 0 ? "Re-parsing comments…" : "Parsing comments…");

      let invokeBody: Record<string, unknown> = {
        sourceFileName: letterFile.name,
        sourceDocumentId: docId,
      };

      if (extraction.kind === "text") {
        invokeBody = {
          ...invokeBody,
          fullText: extraction.fullText,
          pages: extraction.pages,
        };
        if (extraction.sparsePageNumbers.length > 0) {
          toast.info(
            `${extraction.sparsePageNumbers.length} page(s) had little text; scanned-page OCR is not yet enabled.`,
          );
        }
      } else {
        const fileForVision =
          extraction.file.type === "application/pdf"
            ? await pdfFirstPageToImageFile(extraction.file)
            : extraction.file;
        invokeBody = {
          ...invokeBody,
          imageBase64: await fileToBase64(fileForVision),
          imageType: fileForVision.type,
          pageNumber: 1,
        };
      }

      const { data, error } = await supabase.functions.invoke("parse-manual-comment-letter", {
        body: invokeBody,
      });
      if (error) throw error;

      const payload = data as {
        comments?: ParsedRow[];
        parse_method?: string;
        comment_count?: number;
        parser_summary?: ParserSummary;
        error?: string;
      } | null;

      if (payload?.error) throw new Error(payload.error);

      const comments = Array.isArray(payload?.comments) ? payload.comments : [];
      const summary = payload?.parser_summary ?? null;
      if (summary) {
        console.log("[CommentReview] parser_summary", summary);
      }
      setUploadRows(comments);
      setParserSummary(summary);
      setLastParseMethod(payload?.parse_method ?? null);
      setParseAttempted(true);
      const summaryLine = summary
        ? Object.entries(summary.by_discipline)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : null;
      setParseStatus(
        summaryLine
          ? `Found ${comments.length} comments (${summaryLine})`
          : `Found ${comments.length} comment${comments.length !== 1 ? "s" : ""}`,
      );
      toast.success(
        parseAttempted ? `Re-parsed ${comments.length} comments` : `Extracted ${comments.length} comments`,
      );
    } catch (err: unknown) {
      console.error(err);
      setParseStatus(null);
      toast.error(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setParsing(false);
    }
  }, [
    loadCommentLetterFile,
    projectId,
    originalUploadFile,
    parseAttempted,
    uploadRows.length,
    persistCommentLetter,
  ]);

  const updateUploadRow = (index: number, field: keyof ParsedRow, value: string | null) => {
    setUploadRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value ?? r[field] } : r))
    );
  };

  const clearExtractedRows = useCallback(() => {
    setUploadRows([]);
    setParserSummary(null);
    setParseStatus(null);
    setLastParseMethod(null);
    setParseAttempted(false);
    toast.info("Cleared extracted comments from the review table");
  }, []);

  const deleteManualLetterComments = useCallback(
    async (scope: ManualLetterCommentScope, docId?: string | null): Promise<number> => {
      if (!projectId) return 0;
      let query = supabase
        .from("parsed_comments")
        .delete({ count: "exact" })
        .eq("project_id", projectId)
        .eq("ingest_source", "manual_letter");
      if (scope === "source_document" && docId) {
        query = query.eq("source_document_id", docId);
      }
      const { error, count } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    [projectId],
  );

  const insertApprovedRows = useCallback(
    async (docId: string) => {
      if (!projectId) return 0;
      const toInsert = uploadRows.map((r) => ({
        project_id: projectId,
        original_text: r.original_text,
        discipline: r.discipline,
        code_reference: r.code_reference || null,
        status: "Approved",
        page_number: r.source_page ?? null,
        ingest_source: "manual_letter" as const,
        reviewer_name: r.reviewer_name ?? null,
        comment_number: r.comment_number ?? null,
        previous_comment_text: r.previous_comment_text ?? null,
        existing_response_text: r.existing_response_text ?? null,
        code_references:
          r.code_references && r.code_references.length > 0
            ? JSON.stringify(r.code_references)
            : null,
        confidence: typeof r.confidence === "number" ? r.confidence : null,
        source_document_id: docId,
      }));
      const { error } = await supabase.from("parsed_comments").insert(toInsert);
      if (error) throw error;
      return toInsert.length;
    },
    [projectId, uploadRows],
  );

  const executeApproveAll = useCallback(
    async (options: { replaceScope: ManualLetterCommentScope | "none" }) => {
      if (!user || !projectId || uploadRows.length === 0) return;
      setSaving(true);
      if (timerRef.current?.isRunning()) {
        await timerRef.current.stopAndSave();
      }
      try {
        let docId = sourceDocumentId;
        if (!docId && originalUploadFile) {
          const saveResult = await persistCommentLetter();
          if (!saveResult.docId) {
            toast.error(saveResult.error ?? "Failed to save comment letter to project documents");
            return;
          }
          docId = saveResult.docId;
        }
        if (!docId) {
          toast.error("Missing source document for manual letter comments");
          return;
        }

        if (newUploadReplaceProject) {
          const removed = await deleteManualLetterComments("project_manual");
          if (removed > 0) {
            toast.info(`Removed ${removed} existing manual-letter comment${removed === 1 ? "" : "s"} from this project`);
          }
          setNewUploadReplaceProject(false);
        } else if (options.replaceScope === "source_document") {
          await deleteManualLetterComments("source_document", docId);
        } else if (options.replaceScope === "project_manual") {
          await deleteManualLetterComments("project_manual");
        }

        const inserted = await insertApprovedRows(docId);
        toast.success(`Saved ${inserted} comment${inserted === 1 ? "" : "s"}`);
        resetExtractedParseState();
        await refetchComments();
      } catch (err: unknown) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [
      user,
      projectId,
      uploadRows.length,
      sourceDocumentId,
      originalUploadFile,
      persistCommentLetter,
      newUploadReplaceProject,
      deleteManualLetterComments,
      insertApprovedRows,
      resetExtractedParseState,
      refetchComments,
    ],
  );

  const requestApproveAll = useCallback(() => {
    if (!user || !projectId) {
      toast.error("Select a project to save comments");
      return;
    }
    if (uploadRows.length === 0) {
      toast.error("No comments to save");
      return;
    }
    if (newUploadReplaceProject) {
      setPendingConfirm({ kind: "approveAll", conflict: "none" });
      return;
    }
    if (savedManualLetterCount > 0) {
      setPendingConfirm({ kind: "approveAll", conflict: "same_source" });
      return;
    }
    if (otherManualLetterCount > 0) {
      setPendingConfirm({ kind: "approveAll", conflict: "other_letters" });
      return;
    }
    void executeApproveAll({ replaceScope: "none" });
  }, [
    user,
    projectId,
    uploadRows.length,
    newUploadReplaceProject,
    savedManualLetterCount,
    otherManualLetterCount,
    executeApproveAll,
  ]);

  const clearSavedManualLetterComments = useCallback(async () => {
    if (!projectId || !sourceDocumentId) return;
    const count = await deleteManualLetterComments("source_document", sourceDocumentId);
    await refetchComments();
    toast.success(`Removed ${count} saved manual-letter comment${count === 1 ? "" : "s"}`);
  }, [projectId, sourceDocumentId, deleteManualLetterComments, refetchComments]);

  const deleteUploadedLetter = useCallback(
    async (alsoDeleteComments: boolean) => {
      const deletedDocId = sourceDocumentId;

      if (!deletedDocId) {
        setOriginalUploadFile(null);
        resetExtractedParseState();
        setImagePreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        return;
      }

      const { data: doc, error: fetchError } = await supabase
        .from("project_documents")
        .select("*")
        .eq("id", deletedDocId)
        .maybeSingle();
      if (fetchError) throw fetchError;

      if (alsoDeleteComments) {
        const count = await deleteManualLetterComments("source_document", deletedDocId);
        if (count > 0) {
          toast.info(`Removed ${count} saved comment${count === 1 ? "" : "s"} from this letter`);
        }
      }

      if (doc) {
        const deleted = await deleteDocument(doc as ProjectDocument);
        if (!deleted) throw new Error("Failed to delete uploaded letter");
      }

      await fetchDocuments();
      await refetchComments();

      setSourceDocumentId(null);
      setOriginalUploadFile(null);
      resetExtractedParseState();
      setNewUploadReplaceProject(false);
      setImagePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      toast.success("Deleted uploaded comment letter");
    },
    [
      sourceDocumentId,
      deleteManualLetterComments,
      deleteDocument,
      fetchDocuments,
      refetchComments,
      resetExtractedParseState,
    ],
  );

  const executeConfirmAction = useCallback(
    async (action: ConfirmDialogState) => {
      if (!action) return;
      try {
        if (action.kind === "deleteLetter") {
          await deleteUploadedLetter(action.alsoDeleteComments);
        } else if (action.kind === "clearSaved") {
          await clearSavedManualLetterComments();
        } else if (action.kind === "approveAll") {
          if (action.conflict === "same_source") {
            await executeApproveAll({ replaceScope: "source_document" });
          } else if (action.conflict === "none") {
            await executeApproveAll({ replaceScope: "none" });
          }
        }
      } catch (err: unknown) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    },
    [
      deleteUploadedLetter,
      clearSavedManualLetterComments,
      executeApproveAll,
      applyNewUpload,
    ],
  );

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
              <h1 className="mt-3 font-display text-4xl sm:text-5xl text-ink-primary-light leading-tight">
                Comment <em className="text-gold italic">Review</em>
              </h1>
              <p className="mt-3 text-ink-secondary-light max-w-2xl text-sm sm:text-base leading-relaxed">
                Review parsed jurisdiction comments, classifier outputs, statuses, disciplines, and applicant/reviewer discussion history.
              </p>
              <p className="text-sm text-ink-tertiary-light mt-2 max-w-2xl">
                Comments from the portal report &quot;Plan Review - Review Comments&quot; for the selected project.
              </p>
              {projectId ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-teal/40 bg-teal/10 text-teal font-normal"
                    data-testid="comment-review-active-project"
                  >
                    Active project: {activeProject?.name ?? projectId.slice(0, 8) + "…"}
                  </Badge>
                  {projectIdFromUrl && (
                    <span className="text-xs text-ink-tertiary-light">from URL</span>
                  )}
                </div>
              ) : (
                <p className="text-sm text-warning-foreground mt-3">
                  Select a project in the sidebar or open Comment Review with ?projectId=
                </p>
              )}
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
        ) : renderedSavedComments.length === 0 && !noCommentsInPortal ? (
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
        ) : noCommentsInPortal && renderedSavedComments.length === 0 ? (
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
                    {savedCommentsTitle}
                  </SectionTitle>
                  <p className="text-sm text-ink-secondary-dark mt-1">
                    {savedCommentsSubtitle}
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
                {renderSource === "raw_ref" ? (
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
                ) : null}
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
                        {renderedSavedComments.map((row) => {
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
                        {renderedSavedComments.map((row) => (
                          <TableRow
                            key={row.id}
                            className="border-t border-obsidian-raised bg-obsidian-sunken/40 text-ink-primary-dark hover:bg-obsidian-raised/35 transition-colors"
                          >
                            <TableCell className="px-4 py-2.5 sm:px-5 text-sm text-ink-primary-dark align-top max-w-[480px] whitespace-pre-wrap">
                              {renderSource === "manual_letter" ? (
                                <div className="space-y-2">
                                  {row.original_text?.trim() ? (
                                    <p>{row.original_text.trim()}</p>
                                  ) : null}
                                  {row.previous_comment_text?.trim() ? (
                                    <details open={!row.original_text?.trim()} className="text-xs">
                                      <summary className="cursor-pointer text-amber-600 dark:text-amber-400 font-medium">
                                        Previous comment
                                      </summary>
                                      <p className="mt-1.5 text-ink-secondary-dark whitespace-pre-wrap">
                                        {row.previous_comment_text.trim()}
                                      </p>
                                    </details>
                                  ) : null}
                                  {!row.original_text?.trim() && !row.previous_comment_text?.trim()
                                    ? "—"
                                    : null}
                                </div>
                              ) : (
                                portalCommentTableCellContent(row)
                              )}
                            </TableCell>
                            <TableCell className="px-4 py-2.5 sm:px-5 text-ink-secondary-dark">
                              {renderSource === "manual_letter"
                                ? (row.discipline ?? "—")
                                : portalDisciplineDisplayText(row)}
                            </TableCell>
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
                        Upload a permit comment letter for parsing. The parser reads the full document, extracts reviewer sections and Comment N blocks, then lets you review before saving.
                      </CardDescription>
                      <p className="text-xs text-muted-foreground mt-2">
                        {COMMENT_LETTER_SUPPORTED_FORMATS_HINT}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {commentLetters.length > 0 ? (
                        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <Label className="text-xs uppercase tracking-wide text-ink-tertiary-light">
                              Saved comment letter{commentLetters.length !== 1 ? "s" : ""}
                            </Label>
                            {commentLetters.length > 1 ? (
                              <Select
                                value={sourceDocumentId ?? undefined}
                                onValueChange={handleSelectLetter}
                              >
                                <SelectTrigger className="h-8 max-w-[240px]">
                                  <SelectValue placeholder="Select letter" />
                                </SelectTrigger>
                                <SelectContent>
                                  {commentLetters.map((letter) => (
                                    <SelectItem key={letter.id} value={letter.id}>
                                      {letter.file_name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : null}
                          </div>
                          {selectedLetter ? (
                            <div className="text-sm space-y-1">
                              <p className="font-medium text-ink-primary-light break-all">
                                {selectedLetter.file_name}
                              </p>
                              <p className="text-xs text-ink-secondary-light">
                                Uploaded {formatLetterDate(selectedLetter.created_at)}
                              </p>
                              <p className="text-xs font-mono-data text-ink-tertiary-light break-all">
                                Source document: {selectedLetter.id}
                              </p>
                              <p className="text-xs text-ink-secondary-light">
                                Saved manual-letter comments: {savedManualLetterCount}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-ink-tertiary-light">
                          No saved comment letters for this project yet. Upload a letter below.
                        </p>
                      )}

                      <div className="border-2 border-dashed border-gold/30 rounded-xl p-6 flex flex-col items-center justify-center min-h-[180px] bg-cream-sunken/40">
                        {imagePreview ? (
                          <img
                            src={imagePreview}
                            alt="Letter preview"
                            className="max-h-[240px] w-auto object-contain rounded border"
                          />
                        ) : originalUploadFile ? (
                          <div className="text-center space-y-2">
                            <FileImage className="h-10 w-10 text-teal mx-auto" />
                            <p className="text-sm font-medium text-ink-primary-light">{originalUploadFile.name}</p>
                            <p className="text-xs text-ink-tertiary-light">
                              {sourceDocumentId ? "New upload (not saved until parse)" : "Ready to parse"}
                            </p>
                          </div>
                        ) : selectedLetter ? (
                          <div className="text-center space-y-2">
                            <FileImage className="h-10 w-10 text-teal mx-auto" />
                            <p className="text-sm font-medium text-ink-primary-light">{selectedLetter.file_name}</p>
                            <p className="text-xs text-ink-tertiary-light">Saved letter selected</p>
                          </div>
                        ) : (
                          <Upload className="h-10 w-10 text-teal mb-2" />
                        )}
                        <Input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,.doc,application/msword"
                          onChange={handleFileChange}
                          className="mt-2 max-w-xs"
                        />
                      </div>
                      {fileSelectionError && (
                        <p className="text-sm text-amber-700 dark:text-amber-400" role="alert">
                          {fileSelectionError}
                        </p>
                      )}
                      {parseStatus && (
                        <p className="text-sm text-ink-secondary-light">
                          {parseStatus}
                          {lastParseMethod ? (
                            <span className="text-ink-tertiary-light"> · {lastParseMethod}</span>
                          ) : null}
                        </p>
                      )}
                      {parserSummary && parserSummary.total > 0 ? (
                        <div
                          className="text-xs rounded-md border border-border bg-muted/30 p-2 space-y-1"
                          role="status"
                          aria-label="Parser summary"
                        >
                          <p className="font-medium text-ink-primary-light">
                            Parser summary — {parserSummary.total} total
                          </p>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-ink-secondary-light font-mono-data">
                            {Object.entries(parserSummary.by_discipline).map(([discipline, count]) => (
                              <span key={discipline}>
                                {discipline}: {count}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : savedManualLetterCount > 0 && uploadRows.length === 0 ? (
                        <div className="text-xs rounded-md border border-border bg-muted/20 p-2">
                          <p className="font-medium text-ink-primary-light">
                            Saved from this letter — {savedManualLetterCount} comment
                            {savedManualLetterCount !== 1 ? "s" : ""}
                          </p>
                          <p className="text-ink-tertiary-light mt-1">
                            Re-parse to refresh extracted rows before approving replacements.
                          </p>
                        </div>
                      ) : null}
                      {savedManualLetterCount > 0 ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          {savedManualLetterCount} approved manual-letter comment
                          {savedManualLetterCount !== 1 ? "s" : ""} saved for this letter.
                          Approve All replaces them after confirmation; re-parse alone does not change saved rows.
                        </p>
                      ) : null}
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="gold"
                          onClick={() => void runParse()}
                          disabled={parsing || !canParseLetter}
                          className="w-full"
                          size="sm"
                        >
                          {parsing ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <RotateCcw className="h-4 w-4 mr-2" />
                          )}
                          {parsing ? "Parsing…" : parseButtonLabel}
                        </Button>
                        {(originalUploadFile || sourceDocumentId) ? (
                          <>
                            {savedManualLetterCount > 0 ? (
                              <Button
                                variant="outline"
                                onClick={() => setPendingConfirm({ kind: "clearSaved" })}
                                disabled={parsing || saving || !sourceDocumentId}
                                className="w-full"
                                size="sm"
                              >
                                Clear saved comments from this letter
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              onClick={() =>
                                setPendingConfirm({ kind: "deleteLetter", alsoDeleteComments: true })
                              }
                              disabled={parsing || saving}
                              className="w-full text-destructive hover:text-destructive"
                              size="sm"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete uploaded letter
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">Extracted comments</CardTitle>
                          <CardDescription>Edit then Approve All to save to the project.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          {uploadRows.length > 0 ? (
                            <Button variant="outline" size="sm" onClick={clearExtractedRows} disabled={saving || parsing}>
                              Clear extracted comments
                            </Button>
                          ) : null}
                          <ReviewTimer ref={timerRef} projectId={projectId} commentCount={uploadRows.length} />
                          <Button
                            variant="gold"
                            size="sm"
                            onClick={requestApproveAll}
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
                        <p className="text-muted-foreground text-sm py-4">
                          {selectedLetter || originalUploadFile
                            ? "Select a saved letter or upload a new one, then parse comments."
                            : "Upload a document and click Parse comments."}
                          {savedManualLetterCount > 0
                            ? ` ${savedManualLetterCount} comment${savedManualLetterCount !== 1 ? "s" : ""} already saved for the selected letter.`
                            : ""}
                        </p>
                      ) : (
                        <div className="border border-border rounded-lg overflow-auto max-h-[360px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="table-head-sticky w-[56px]">#</TableHead>
                                <TableHead className="table-head-sticky w-[100px]">Page</TableHead>
                                <TableHead className="table-head-sticky w-[120px]">Reviewer</TableHead>
                                <TableHead className="table-head-sticky min-w-[180px]">Comment</TableHead>
                                <TableHead className="table-head-sticky w-[120px]">Discipline</TableHead>
                                <TableHead className="table-head-sticky min-w-[120px]">Code refs</TableHead>
                                <TableHead className="table-head-sticky w-[100px]">Primary code</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {uploadRows.map((row, i) => (
                                <TableRow key={i}>
                                  <TableCell className="font-mono-data text-xs align-top">
                                    {row.comment_number ?? "—"}
                                  </TableCell>
                                  <TableCell className="font-mono-data text-xs align-top">
                                    {row.source_page ?? "—"}
                                  </TableCell>
                                  <TableCell className="text-xs align-top max-w-[120px]">
                                    <Input
                                      value={row.reviewer_name ?? ""}
                                      onChange={(e) => updateUploadRow(i, "reviewer_name", e.target.value || null)}
                                      placeholder="Reviewer"
                                      className="h-8 text-xs"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      value={row.original_text}
                                      onChange={(e) => updateUploadRow(i, "original_text", e.target.value)}
                                      className="min-w-[160px] text-sm"
                                      placeholder={row.previous_comment_text ? "Active comment (optional)" : "Comment text"}
                                    />
                                    {row.previous_comment_text ? (
                                      <details
                                        className="mt-1.5 text-xs group"
                                        open={!row.original_text?.trim() || row.original_text.trim().length < 40}
                                      >
                                        <summary className="cursor-pointer list-none text-amber-700 dark:text-amber-400 font-medium hover:underline">
                                          Previous comment (full reviewer text)
                                          <span className="text-ink-tertiary-light font-normal ml-1">
                                            ({row.previous_comment_text.length} chars)
                                          </span>
                                        </summary>
                                        <p className="mt-1.5 p-2 rounded border border-border/60 bg-muted/40 text-ink-secondary-light whitespace-pre-wrap max-h-48 overflow-y-auto">
                                          {row.previous_comment_text}
                                        </p>
                                      </details>
                                    ) : (
                                      <p className="text-[11px] text-ink-tertiary-light mt-1 line-clamp-3" title={row.original_text}>
                                        Preview: {row.original_text || "—"}
                                      </p>
                                    )}
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
                                        {disciplineOptions.map((d) => (
                                          <SelectItem key={d} value={d}>
                                            {d}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell className="text-xs align-top max-w-[160px]">
                                    {row.code_references && row.code_references.length > 0 ? (
                                      <p className="whitespace-pre-wrap break-words text-ink-secondary-light" title={row.code_references.join(", ")}>
                                        {row.code_references.join(", ")}
                                      </p>
                                    ) : (
                                      <span className="text-ink-tertiary-light">—</span>
                                    )}
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

      <AlertDialog open={pendingConfirm != null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingConfirm?.kind === "deleteLetter"
                ? "Delete uploaded comment letter?"
                : pendingConfirm?.kind === "clearSaved"
                  ? "Clear saved comments from this letter?"
                  : pendingConfirm?.kind === "newUpload"
                    ? "Saved manual-letter comments already exist"
                    : pendingConfirm?.conflict === "other_letters"
                      ? "Other manual letters have saved comments"
                      : pendingConfirm?.conflict === "same_source"
                        ? "Replace saved comments for this letter?"
                        : "Replace all manual-letter comments?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {pendingConfirm?.kind === "deleteLetter" ? (
                  <>
                    <p>
                      This removes the letter from project documents and clears the current parse review.
                      Portal comments are not affected.
                    </p>
                    {savedManualLetterCount > 0 ? (
                      <p>
                        {savedManualLetterCount} saved manual-letter comment
                        {savedManualLetterCount !== 1 ? "s" : ""} are linked to this letter.
                      </p>
                    ) : null}
                  </>
                ) : pendingConfirm?.kind === "clearSaved" ? (
                  <p>
                    Deletes {savedManualLetterCount} approved manual-letter comment
                    {savedManualLetterCount !== 1 ? "s" : ""} linked to this source document.
                    Portal comments and comments from other documents are not affected.
                  </p>
                ) : pendingConfirm?.kind === "newUpload" ? (
                  <p>
                    Saved manual-letter comments already exist for this project ({projectManualLetterCount} total).
                    Choose how to handle them before uploading the new letter.
                  </p>
                ) : pendingConfirm?.conflict === "other_letters" ? (
                  <p>
                    This project has {otherManualLetterCount} saved manual-letter comment
                    {otherManualLetterCount !== 1 ? "s" : ""} from other uploaded letters.
                    You can replace all manual-letter comments for this project or save this letter separately.
                  </p>
                ) : pendingConfirm?.conflict === "same_source" ? (
                  <p>
                    This letter already has {savedManualLetterCount} saved comment
                    {savedManualLetterCount !== 1 ? "s" : ""}. Replace them with the current{" "}
                    {uploadRows.length} parsed row{uploadRows.length !== 1 ? "s" : ""}?
                  </p>
                ) : (
                  <p>
                    Replace all {projectManualLetterCount} manual-letter comment
                    {projectManualLetterCount !== 1 ? "s" : ""} for this project with the current parse?
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {pendingConfirm?.kind === "deleteLetter" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const action = pendingConfirm;
                    setPendingConfirm(null);
                    void executeConfirmAction({ ...action, alsoDeleteComments: false });
                  }}
                >
                  Delete letter only
                </Button>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    const action = pendingConfirm;
                    setPendingConfirm(null);
                    void executeConfirmAction({ ...action, alsoDeleteComments: true });
                  }}
                >
                  Delete letter and saved comments
                </AlertDialogAction>
              </>
            ) : pendingConfirm?.kind === "newUpload" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const file = pendingConfirm.file;
                    setPendingConfirm(null);
                    applyNewUpload(file, false);
                  }}
                >
                  Keep existing, parse for review
                </Button>
                <AlertDialogAction
                  onClick={() => {
                    const file = pendingConfirm.file;
                    setPendingConfirm(null);
                    applyNewUpload(file, true);
                  }}
                >
                  Replace on Approve All
                </AlertDialogAction>
              </>
            ) : pendingConfirm?.conflict === "other_letters" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPendingConfirm(null);
                    void executeApproveAll({ replaceScope: "none" });
                  }}
                >
                  Save separately
                </Button>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    setPendingConfirm(null);
                    void executeApproveAll({ replaceScope: "project_manual" });
                  }}
                >
                  Replace all manual-letter comments
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                className={
                  pendingConfirm?.kind === "clearSaved" ||
                  pendingConfirm?.conflict === "same_source" ||
                  pendingConfirm?.conflict === "none"
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : undefined
                }
                onClick={() => {
                  const action = pendingConfirm;
                  setPendingConfirm(null);
                  void executeConfirmAction(action);
                }}
              >
                Confirm
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
