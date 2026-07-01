import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import type { ReviewTimerHandle } from "@/components/shadow/ReviewTimer";
import { supabase } from "@/lib/supabase";
import { isTaxonomyDiscipline } from "@/lib/commentDisciplineTaxonomy";
import { parsePgcRawRefDisplayText } from "@/lib/parsePgcRawRefDisplayText";
import { pdfFirstPageToImageFile } from "@/utils/pdfToImage";
import {
  COMMENT_LETTER_SUPPORTED_FORMATS_HINT,
  isSpreadsheetFile,
} from "@/utils/extractDocumentText";
import { formatCommentLetterSaveError, type ProjectDocument, type ProjectDocumentUploadSubstep } from "@/types/document";
import {
  isManualCommentLetter,
  type ManualLetterCommentScope,
} from "@/lib/commentReviewManualLetter";
import {
  createPendingUploadFile,
  validateCommentLetterFile,
  type PendingUploadFile,
} from "@/lib/commentReviewBatchUpload";
import {
  logCommentBatch,
  processOneCommentReviewFile,
} from "@/lib/commentReviewBatchProcess";
import {
  auditOrphanedManualLetterComments,
  deleteManualLetterCommentsForDocument,
  deleteOrphanedManualLetterComments,
  fetchCommentReviewParsedComments,
  countManualLetterCommentsForDocument,
  uploadRowRequiresSourceDocument,
  type CommentReviewParsedCommentRow,
} from "@/lib/commentReviewParsedComments";
import {
  COMMENT_REVIEW_DISCIPLINES,
  createPastedSingleCommentRow,
  markRowsAsParsed,
  savedCommentToUploadRow,
  type ParsedRow,
} from "@/lib/commentReviewUploadRow";
import {
  CommentReviewInputPanel,
  type CommentInputMethod,
} from "@/components/comment-review/CommentReviewInputPanel";
import { CommentReviewExtractedPanel } from "@/components/comment-review/CommentReviewExtractedPanel";
import { ManualCommentFormDialog } from "@/components/comment-review/ManualCommentFormDialog";
import { toast } from "sonner";
import { Loader2, ArrowLeft, RefreshCw } from "lucide-react";
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

interface ParserSummary {
  total: number;
  by_section: Record<string, number>;
  by_discipline: Record<string, number>;
}

interface ParsedCommentRow extends CommentReviewParsedCommentRow {}

type ConfirmDialogState =
  | { kind: "deleteLetter" }
  | { kind: "clearSaved" }
  | { kind: "approveAll"; conflict: "same_source" | "other_letters" | "none" }
  | { kind: "newUpload"; file: File }
  | { kind: "newBatchUpload"; files: File[] }
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
  const { uploadDocumentWithResult, getDownloadUrl, documents, fetchDocuments } =
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
  const [pendingUploadFiles, setPendingUploadFiles] = useState<PendingUploadFile[]>([]);
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
  const [commentFormOpen, setCommentFormOpen] = useState(false);
  const [commentFormMode, setCommentFormMode] = useState<"add" | "edit">("add");
  const [editingRow, setEditingRow] = useState<ParsedRow | null>(null);
  const [commentInputMethod, setCommentInputMethod] = useState<CommentInputMethod>("upload");
  const reviewListClearedRef = useRef(false);
  const reviewListHydratedForRef = useRef<string | null>(null);
  const batchProcessingRef = useRef(false);
  const batchInFlightRef = useRef<Set<string>>(new Set());
  const orphanCleanupProjectRef = useRef<string | null>(null);
  const timerRef = useRef<ReviewTimerHandle>(null);

  const disciplineOptions = useMemo(() => {
    const fromRows = uploadRows.map((r) => r.discipline).filter(Boolean);
    return [...new Set([...COMMENT_REVIEW_DISCIPLINES, ...fromRows])];
  }, [uploadRows]);

  const fetchComments = useCallback(async (): Promise<ParsedCommentRow[]> => {
    if (!projectId) return [];
    try {
      return await fetchCommentReviewParsedComments(projectId);
    } catch (error) {
      console.error("[CommentReview] failed to load comments", error);
      toast.error("Failed to load comments");
      return [];
    }
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

  useEffect(() => {
    if (!projectId) {
      orphanCleanupProjectRef.current = null;
      return;
    }
    if (orphanCleanupProjectRef.current === projectId) return;
    orphanCleanupProjectRef.current = projectId;

    void (async () => {
      try {
        const audit = await auditOrphanedManualLetterComments(projectId);
        if (audit.orphanedRows.length === 0) {
          console.info("[comment-review] orphan audit", {
            projectId,
            orphanedCount: 0,
            validManualLetterDocumentIds: audit.validManualLetterDocumentIds,
          });
          return;
        }

        const sourceDocumentIdsInvolved = [
          ...new Set(
            audit.orphanedRows
              .map((row) => row.source_document_id)
              .filter((value): value is string => Boolean(value)),
          ),
        ];

        console.info("[comment-review] orphan audit", {
          projectId,
          orphanedCount: audit.orphanedRows.length,
          validManualLetterDocumentIds: audit.validManualLetterDocumentIds,
          sourceDocumentIdsInvolved,
          orphanIds: audit.orphanedRows.map((row) => row.id),
          reasons: audit.orphanedRows.reduce<Record<string, number>>((acc, row) => {
            acc[row.reason] = (acc[row.reason] ?? 0) + 1;
            return acc;
          }, {}),
        });

        const deleted = await deleteOrphanedManualLetterComments(
          projectId,
          audit.orphanedRows.map((row) => row.id),
        );

        console.info("[comment-review] orphan cleanup complete", {
          projectId,
          deleted,
          sourceDocumentIdsInvolved,
        });

        queryClient.setQueryData<ParsedCommentRow[]>(
          ["parsed_comments", projectId],
          (existing) =>
            (existing ?? []).filter(
              (row) => !audit.orphanedRows.some((orphan) => orphan.id === row.id),
            ),
        );
        await queryClient.invalidateQueries({ queryKey: ["parsed_comments", projectId] });
        await refetchComments();
      } catch (error) {
        console.error("[comment-review] orphan cleanup failed", error);
      }
    })();
  }, [projectId, queryClient, refetchComments]);

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

  const pendingBatchCount = pendingUploadFiles.filter(
    (item) => item.status === "pending" || item.status === "failed",
  ).length;
  const canParseLetter = Boolean(
    projectId &&
      (originalUploadFile ||
        sourceDocumentId ||
        pendingBatchCount > 0),
  );
  const parseButtonLabel =
    pendingBatchCount > 1
      ? `Parse ${pendingBatchCount} files`
      : pendingBatchCount === 1
        ? uploadRows.length > 0
          ? "Parse file"
          : "Parse comments"
        : uploadRows.length > 0
          ? "Re-parse document"
          : "Parse comments";

  const savedCommentsForSelectedLetter = useMemo(
    () =>
      portalComments.filter(
        (row) =>
          row.ingest_source === "manual_letter" &&
          row.source_document_id === sourceDocumentId,
      ),
    [portalComments, sourceDocumentId],
  );

  useEffect(() => {
    reviewListClearedRef.current = false;
    reviewListHydratedForRef.current = null;
  }, [sourceDocumentId]);

  useEffect(() => {
    if (!sourceDocumentId || parsing || parseAttempted) return;
    if (reviewListClearedRef.current) return;
    if (uploadRows.length > 0) return;
    if (reviewListHydratedForRef.current === sourceDocumentId) return;
    if (savedCommentsForSelectedLetter.length === 0) return;

    setUploadRows(savedCommentsForSelectedLetter.map(savedCommentToUploadRow));
    reviewListHydratedForRef.current = sourceDocumentId;
  }, [
    sourceDocumentId,
    parsing,
    parseAttempted,
    uploadRows.length,
    savedCommentsForSelectedLetter,
  ]);

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
    const { data: projectRow } = await supabase
      .from("projects")
      .select("portal_data_hash")
      .eq("id", projectId)
      .maybeSingle();
    const portalDataHash = (projectRow?.portal_data_hash as string | undefined) ?? undefined;
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
            ...(portalDataHash ? { portal_data_hash: portalDataHash } : {}),
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
      setPendingUploadFiles([]);
      setNewUploadReplaceProject(false);
      resetExtractedParseState();
      setImagePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    },
    [resetExtractedParseState],
  );

  const removePendingFile = useCallback((id: string) => {
    setPendingUploadFiles((prev) => prev.filter((item) => item.id !== id));
  }, []);

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

  const ingestSelectedFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const validated = files.map((file) => ({
        file,
        validation: validateCommentLetterFile(file),
      }));
      const invalid = validated.filter((entry) => !entry.validation.valid);
      const valid = validated.filter((entry) => entry.validation.valid).map((entry) => entry.file);

      if (invalid.length > 0) {
        const invalidNames = invalid.map((entry) => entry.file.name).join(", ");
        const firstError =
          invalid[0].validation.valid === false ? invalid[0].validation.error : "Invalid file";
        setFileSelectionError(
          invalid.length === 1
            ? firstError
            : `${invalid.length} file(s) rejected (${invalidNames}). ${firstError}`,
        );
        if (valid.length === 0) {
          toast.error(firstError);
          return;
        }
        toast.warning(`${invalid.length} file(s) skipped due to unsupported format.`);
      } else {
        setFileSelectionError(null);
      }

      if (valid.length === 0) return;

      if (projectManualLetterCount > 0) {
        setPendingConfirm({
          kind: valid.length === 1 ? "newUpload" : "newBatchUpload",
          ...(valid.length === 1 ? { file: valid[0] } : { files: valid }),
        });
        return;
      }

      setPendingUploadFiles((prev) => {
        const existingKeys = new Set(
          prev.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`),
        );
        const next = [...prev];
        for (const file of valid) {
          const key = `${file.name}:${file.size}:${file.lastModified}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          next.push(createPendingUploadFile(file));
        }
        return next;
      });
    },
    [projectManualLetterCount],
  );

  const appendFilesToPendingBatch = useCallback((files: File[]) => {
    setPendingUploadFiles((prev) => {
      const existingKeys = new Set(
        prev.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`),
      );
      const next = [...prev];
      for (const file of files) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        next.push(createPendingUploadFile(file));
      }
      return next;
    });
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length === 0) return;
      ingestSelectedFiles(files);
    },
    [ingestSelectedFiles],
  );

  const handleFilesDropped = useCallback(
    (files: File[]) => {
      ingestSelectedFiles(files);
    },
    [ingestSelectedFiles],
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
  }, [projectId, user, originalUploadFile, sourceDocumentId, uploadDocumentWithResult]);

  const invokeCommentParser = useCallback(
    async (
      invokeBody: Record<string, unknown>,
    ): Promise<{
      comments: Array<Omit<ParsedRow, "row_source" | "_clientId">>;
      parse_method?: string;
      parser_summary?: ParserSummary;
    }> => {
      const { data, error } = await supabase.functions.invoke("parse-manual-comment-letter", {
        body: invokeBody,
      });
      if (error) throw error;

      const payload = data as {
        comments?: Array<Omit<ParsedRow, "row_source" | "_clientId">>;
        parse_method?: string;
        parser_summary?: ParserSummary;
        error?: string;
      } | null;

      if (payload?.error) throw new Error(payload.error);

      return {
        comments: Array.isArray(payload?.comments) ? payload.comments : [],
        parse_method: payload?.parse_method,
        parser_summary: payload?.parser_summary ?? undefined,
      };
    },
    [],
  );

  const persistCommentLetterForFile = useCallback(
    async (
      file: File,
      signal?: AbortSignal,
    ): Promise<{
      docId: string | null;
      error?: string;
      uploadSubstep?: ProjectDocumentUploadSubstep;
    }> => {
      if (!projectId || !user) {
        return { docId: null, error: "Missing project or user" };
      }

      const result = await uploadDocumentWithResult({
        file,
        document_type: "correspondence",
        description: "Manual comment letter upload (Comment Review)",
        suppressToasts: true,
        signal,
      });

      if (result.document?.id) {
        return { docId: result.document.id };
      }

      return {
        docId: null,
        error: formatCommentLetterSaveError(result),
        uploadSubstep: result.hungSubstep ?? result.substep,
      };
    },
    [projectId, user, uploadDocumentWithResult],
  );

  const runParse = useCallback(async () => {
    if (batchProcessingRef.current) return;
    if (!projectId) {
      toast.error("Select a project in the sidebar before parsing");
      return;
    }

    let queue = pendingUploadFiles.filter(
      (item) =>
        (item.status === "pending" || item.status === "failed") &&
        !batchInFlightRef.current.has(item.id),
    );

    let logKind: "batch" | "saved-letter" = "batch";
    let existingDocumentId: string | null = null;
    let reparseSeedRow: PendingUploadFile | null = null;

    if (queue.length === 0 && sourceDocumentId) {
      const letterFile = await loadCommentLetterFile();
      if (!letterFile) {
        toast.error("Select or upload a comment letter first");
        return;
      }

      reparseSeedRow = {
        ...createPendingUploadFile(letterFile),
        sourceDocumentId,
      };
      setPendingUploadFiles([reparseSeedRow]);
      setUploadRows([]);
      queue = [reparseSeedRow];
      logKind = "saved-letter";
      existingDocumentId = sourceDocumentId;
    }

    if (queue.length === 0) {
      toast.error("Select or upload a comment letter first");
      return;
    }

    const batchJobId = crypto.randomUUID();
    batchProcessingRef.current = true;
    setParsing(true);
    setParseStatus(null);

    if (logKind === "batch") {
      logCommentBatch(batchJobId, "batch started", { fileCount: queue.length });
    }

    let successCount = 0;
    let failCount = 0;
    let totalComments = 0;
    let lastSuccessfulDocId: string | null = null;

    const onStageUpdate = (id: string, patch: Partial<PendingUploadFile>) => {
      setPendingUploadFiles((prev) => {
        const base = prev.length > 0 ? prev : reparseSeedRow ? [reparseSeedRow] : prev;
        return base.map((item) => (item.id === id ? { ...item, ...patch } : item));
      });
    };

    try {
      for (const item of queue) {
        if (batchInFlightRef.current.has(item.id)) continue;
        batchInFlightRef.current.add(item.id);

        try {
          const result = await processOneCommentReviewFile({
            jobId: batchJobId,
            fileRow: item,
            projectId,
            onStageUpdate,
            persistCommentLetterForFile,
            invokeCommentParser,
            appendRows: (rows) => {
              setUploadRows((prev) => [...prev, ...rows]);
            },
            existingDocumentId: existingDocumentId ?? item.sourceDocumentId ?? null,
            logKind,
          });

          if (result.success) {
            successCount += 1;
            totalComments += result.commentCount;
            if (result.sourceDocumentId) {
              lastSuccessfulDocId = result.sourceDocumentId;
            }
            if (result.parserSummary) {
              setParserSummary(result.parserSummary);
            }
            if (result.parseMethod) {
              setLastParseMethod(result.parseMethod);
            }
          } else {
            failCount += 1;
          }
        } finally {
          batchInFlightRef.current.delete(item.id);
        }
      }

      if (successCount > 0 && lastSuccessfulDocId) {
        setSourceDocumentId(lastSuccessfulDocId);
        await fetchDocuments();
      }

      setParseAttempted(true);
      setParseStatus(
        failCount > 0
          ? `${successCount} complete, ${failCount} failed (${totalComments} comments parsed)`
          : `${successCount} file${successCount !== 1 ? "s" : ""} complete · ${totalComments} comment${totalComments !== 1 ? "s" : ""}`,
      );

      if (successCount > 0) {
        toast.success(
          `Parsed ${totalComments} comment${totalComments !== 1 ? "s" : ""} from ${successCount} file${successCount !== 1 ? "s" : ""}`,
        );
      }
      if (failCount > 0) {
        toast.error(`${failCount} file${failCount !== 1 ? "s" : ""} failed`);
      }
    } finally {
      batchInFlightRef.current.clear();
      batchProcessingRef.current = false;
      setParsing(false);
      if (logKind === "batch") {
        logCommentBatch(batchJobId, "batch finished", {
          successCount,
          failCount,
          totalComments,
        });
      }
    }
  }, [
    pendingUploadFiles,
    projectId,
    persistCommentLetterForFile,
    invokeCommentParser,
    fetchDocuments,
    loadCommentLetterFile,
    sourceDocumentId,
  ]);

  const handleParsePastedComments = useCallback(
    async ({
      text,
      sourceLabel,
      discipline,
    }: {
      text: string;
      sourceLabel: string;
      discipline: string;
    }) => {
      if (!projectId) {
        toast.error("Select a project in the sidebar before parsing");
        return;
      }
      setParsing(true);
      try {
        const { comments, parse_method, parser_summary } = await invokeCommentParser({
          fullText: text,
          sourceFileName: sourceLabel,
          pages: [{ pageNumber: 1, text }],
        });

        const parsedRows = markRowsAsParsed(comments, { sourceLabel }).map((row) => ({
          ...row,
          discipline: row.discipline?.trim() || discipline || "Architecture",
        }));

        setUploadRows((prev) => [...prev, ...parsedRows]);
        if (parser_summary) {
          setParserSummary(parser_summary);
        }
        setLastParseMethod(parse_method ?? "pasted_text");
        setParseStatus(`Pasted ${parsedRows.length} comment${parsedRows.length !== 1 ? "s" : ""}`);
        toast.success(
          parsedRows.length > 0
            ? `Parsed ${parsedRows.length} comment${parsedRows.length === 1 ? "" : "s"} from paste`
            : "No comments found in pasted text",
        );
      } catch (err: unknown) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Failed to parse pasted comments");
      } finally {
        setParsing(false);
      }
    },
    [projectId, invokeCommentParser],
  );

  const handleAddPastedSingleComment = useCallback(
    ({
      text,
      sourceLabel,
      discipline,
    }: {
      text: string;
      sourceLabel: string;
      discipline: string;
    }) => {
      const row = createPastedSingleCommentRow({ text, sourceLabel, discipline });
      setUploadRows((prev) => [...prev, row]);
      toast.success("Comment added to review list");
    },
    [],
  );

  const openAddCommentForm = useCallback(() => {
    setCommentFormMode("add");
    setEditingRow(null);
    setCommentFormOpen(true);
  }, []);

  const openEditCommentForm = useCallback((row: ParsedRow) => {
    setCommentFormMode("edit");
    setEditingRow(row);
    setCommentFormOpen(true);
  }, []);

  const handleSaveCommentFromDialog = useCallback((row: ParsedRow, mode: "add" | "edit") => {
    if (mode === "add") {
      setUploadRows((prev) => [...prev, row]);
      toast.success("Comment added to review list");
      return;
    }
    setUploadRows((prev) =>
      prev.map((existing) => (existing._clientId === row._clientId ? row : existing)),
    );
    toast.success("Comment updated");
  }, []);

  const removeUploadRow = useCallback((clientId: string) => {
    setUploadRows((prev) => prev.filter((row) => row._clientId !== clientId));
    toast.info("Comment removed from review list");
  }, []);

  const clearExtractedRows = useCallback(() => {
    reviewListClearedRef.current = true;
    reviewListHydratedForRef.current = null;
    setUploadRows([]);
    setParserSummary(null);
    setParseStatus(null);
    setLastParseMethod(null);
    setParseAttempted(false);
    toast.info("Cleared review list");
  }, []);

  const deleteManualLetterComments = useCallback(
    async (scope: ManualLetterCommentScope, docId?: string | null): Promise<number> => {
      if (!projectId) return 0;
      if (scope === "source_document" && docId) {
        return deleteManualLetterCommentsForDocument(projectId, docId);
      }

      const { error, count } = await supabase
        .from("parsed_comments")
        .delete({ count: "exact" })
        .eq("project_id", projectId)
        .eq("ingest_source", "manual_letter");
      if (error) throw error;
      return count ?? 0;
    },
    [projectId],
  );

  const insertApprovedRows = useCallback(async () => {
    if (!projectId) return 0;
    const toInsert = uploadRows.map((row) => ({
      project_id: projectId,
      original_text: row.original_text,
      discipline: row.discipline,
      code_reference: row.code_reference || null,
      status: "Approved",
      page_number: row.source_page ?? null,
      ingest_source: "manual_letter" as const,
      reviewer_name: row.reviewer_name ?? null,
      comment_number: row.comment_number ?? null,
      previous_comment_text: row.previous_comment_text ?? null,
      existing_response_text: row.existing_response_text ?? null,
      code_references:
        row.code_references && row.code_references.length > 0
          ? JSON.stringify(row.code_references)
          : null,
      confidence: typeof row.confidence === "number" ? row.confidence : null,
      source_document_id: row._sourceDocumentId ?? null,
    }));
    const { error } = await supabase.from("parsed_comments").insert(toInsert);
    if (error) throw error;
    return toInsert.length;
  }, [projectId, uploadRows]);

  const executeApproveAll = useCallback(
    async (options: { replaceScope: ManualLetterCommentScope | "none" }) => {
      if (!user || !projectId || uploadRows.length === 0) return;
      setSaving(true);
      if (timerRef.current?.isRunning()) {
        await timerRef.current.stopAndSave();
      }
      try {
        const rowsMissingSourceDocument = uploadRows.filter(
          (row) => uploadRowRequiresSourceDocument(row) && !row._sourceDocumentId,
        );
        if (rowsMissingSourceDocument.length > 0) {
          toast.error(
            `${rowsMissingSourceDocument.length} parsed comment${rowsMissingSourceDocument.length !== 1 ? "s" : ""} from uploaded files are missing a source document link. Re-parse the letter and try again.`,
          );
          return;
        }

        let docId: string | null = sourceDocumentId;
        if (!docId) {
          docId = uploadRows.find((row) => row._sourceDocumentId)?._sourceDocumentId ?? null;
        }
        if (!docId && originalUploadFile) {
          const saveResult = await persistCommentLetter();
          if (!saveResult.docId) {
            toast.error(saveResult.error ?? "Failed to save comment letter to project documents");
            return;
          }
          docId = saveResult.docId;
          setSourceDocumentId(docId);
          await fetchDocuments();
        }

        if (newUploadReplaceProject) {
          const removed = await deleteManualLetterComments("project_manual");
          if (removed > 0) {
            toast.info(`Removed ${removed} existing manual-letter comment${removed === 1 ? "" : "s"} from this project`);
          }
          setNewUploadReplaceProject(false);
        } else if (options.replaceScope === "source_document") {
          if (!docId) {
            toast.error("Select the source comment letter before replacing saved comments");
            return;
          }
          await deleteManualLetterComments("source_document", docId);
        } else if (options.replaceScope === "project_manual") {
          await deleteManualLetterComments("project_manual");
        }

        const inserted = await insertApprovedRows();
        if (import.meta.env.DEV) {
          console.info("[CommentReview] Approved rows saved to parsed_comments", {
            projectId,
            inserted,
            sourceDocumentId: docId,
            manualRows: uploadRows.filter((r) => r.row_source === "manual").length,
            rows: uploadRows.map((r) => ({
              row_source: r.row_source,
              original_text: r.original_text?.slice(0, 60),
              discipline: r.discipline,
            })),
          });
        }
        toast.success(`Saved ${inserted} comment${inserted === 1 ? "" : "s"} to this project`);
        reviewListClearedRef.current = false;
        reviewListHydratedForRef.current = null;
        resetExtractedParseState();
        await queryClient.invalidateQueries({ queryKey: ["parsed_comments", projectId] });
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
      uploadRows,
      sourceDocumentId,
      originalUploadFile,
      persistCommentLetter,
      fetchDocuments,
      newUploadReplaceProject,
      deleteManualLetterComments,
      insertApprovedRows,
      resetExtractedParseState,
      queryClient,
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

  const deleteUploadedLetter = useCallback(async () => {
      const deletedDocId = sourceDocumentId;

      if (!deletedDocId) {
        setOriginalUploadFile(null);
        setPendingUploadFiles([]);
        resetExtractedParseState();
        setImagePreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        return;
      }

      if (!projectId) {
        throw new Error("Select a project before deleting the letter");
      }

      const { data: doc, error: fetchError } = await supabase
        .from("project_documents")
        .select("*")
        .eq("id", deletedDocId)
        .maybeSingle();
      if (fetchError) {
        throw new Error(`Failed to load letter metadata: ${fetchError.message}`);
      }

      let removedCount = 0;
      try {
        removedCount = await deleteManualLetterCommentsForDocument(projectId, deletedDocId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Failed to delete parsed comments: ${message}`);
      }

      const remainingLinkedComments = await countManualLetterCommentsForDocument(
        projectId,
        deletedDocId,
      );
      if (remainingLinkedComments > 0) {
        throw new Error(
          `Failed to delete all parsed comments for this letter (${remainingLinkedComments} remaining)`,
        );
      }

      if (doc) {
        const { error: storageError } = await supabase.storage
          .from("project-documents")
          .remove([doc.file_path]);
        if (storageError) {
          throw new Error(`Failed to delete letter file from storage: ${storageError.message}`);
        }

        const { error: dbError } = await supabase
          .from("project_documents")
          .delete()
          .eq("id", deletedDocId);
        if (dbError) {
          throw new Error(`Failed to delete letter record: ${dbError.message}`);
        }
      }

      queryClient.setQueryData<ParsedCommentRow[]>(
        ["parsed_comments", projectId],
        (existing) =>
          (existing ?? []).filter(
            (row) =>
              !(
                row.ingest_source === "manual_letter" &&
                row.source_document_id === deletedDocId
              ),
          ),
      );
      await queryClient.invalidateQueries({ queryKey: ["parsed_comments", projectId] });

      setUploadRows((prev) => prev.filter((row) => row._sourceDocumentId !== deletedDocId));
      setPendingUploadFiles((prev) =>
        prev.filter((item) => item.sourceDocumentId !== deletedDocId),
      );

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

      toast.success(
        removedCount > 0
          ? `Deleted letter and ${removedCount} parsed comment${removedCount === 1 ? "" : "s"}`
          : "Deleted uploaded comment letter",
      );
    },
    [
      sourceDocumentId,
      projectId,
      fetchDocuments,
      refetchComments,
      resetExtractedParseState,
      queryClient,
    ],
  );

  const executeConfirmAction = useCallback(
    async (action: ConfirmDialogState) => {
      if (!action) return;
      try {
        if (action.kind === "deleteLetter") {
          await deleteUploadedLetter();
        } else if (action.kind === "clearSaved") {
          await clearSavedManualLetterComments();
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
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm dark:border-obsidian-raised dark:bg-obsidian dark:shadow-inner">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/50 px-4 py-3 sm:px-5 dark:border-obsidian-raised dark:bg-obsidian-raised">
                <div className="min-w-0">
                  <SectionTitle className="!text-xl sm:!text-2xl text-foreground dark:text-ink-primary-dark">
                    {savedCommentsTitle}
                  </SectionTitle>
                  <p className="text-sm text-muted-foreground mt-1 dark:text-ink-secondary-dark">
                    {savedCommentsSubtitle}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground dark:text-ink-tertiary-dark">
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
                        <TableRow className="border-0 border-border bg-muted/60 hover:bg-muted/80 dark:border-obsidian-raised dark:bg-obsidian-raised dark:hover:bg-obsidian-raised">
                          <TableHead className="table-head-sticky w-[48px] min-w-[44px] whitespace-nowrap px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">REF #</TableHead>
                          <TableHead className="table-head-sticky w-[56px] min-w-[48px] whitespace-nowrap px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">CYCLE</TableHead>
                          <TableHead className="table-head-sticky min-w-[140px] max-w-[200px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">REVIEWED BY</TableHead>
                          <TableHead className="table-head-sticky min-w-[88px] w-[100px] whitespace-nowrap px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">TYPE</TableHead>
                          <TableHead className="table-head-sticky min-w-[120px] max-w-[160px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">FILENAME</TableHead>
                          <TableHead className="table-head-sticky min-w-[240px] max-w-[480px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">DISCUSSION</TableHead>
                          <TableHead className="table-head-sticky w-[100px] min-w-[88px] whitespace-nowrap px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">STATUS</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {renderedSavedComments.map((row) => {
                          const f = parsePgcRawRefDisplayText(row.original_text);
                          return (
                            <TableRow
                              key={row.id}
                              className="border-t border-border bg-transparent text-foreground transition-colors hover:bg-muted/40 dark:border-obsidian-raised dark:bg-obsidian-sunken/40 dark:text-ink-primary-dark dark:hover:bg-obsidian-raised/35"
                            >
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top font-mono-data tabular-nums text-muted-foreground dark:text-ink-secondary-dark">
                                {portalRawRefCellDash(f.ref)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top font-mono-data tabular-nums text-muted-foreground dark:text-ink-secondary-dark">
                                {portalRawRefCellDash(f.cycle)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top whitespace-pre-wrap break-words text-foreground dark:text-ink-primary-dark">
                                {portalRawRefCellDash(f.reviewedBy)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top whitespace-pre-wrap text-foreground dark:text-ink-primary-dark">
                                {portalRawRefCellDash(f.type)}
                              </TableCell>
                              <TableCell
                                className="px-4 py-2.5 sm:px-5 text-sm align-top whitespace-pre-wrap break-all text-foreground dark:text-ink-primary-dark"
                                title={f.filename ?? undefined}
                              >
                                {portalRawRefCellDash(f.filename)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm align-top text-foreground whitespace-pre-wrap break-words max-w-[480px] dark:text-ink-primary-dark">
                                {f.discussion}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 sm:px-5 text-sm whitespace-nowrap align-top text-foreground dark:text-ink-primary-dark">
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
                        <TableRow className="border-0 border-border bg-muted/60 hover:bg-muted/80 dark:border-obsidian-raised dark:bg-obsidian-raised dark:hover:bg-obsidian-raised">
                          <TableHead className="table-head-sticky min-w-[220px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">Comment</TableHead>
                          <TableHead className="table-head-sticky w-[140px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">Discipline</TableHead>
                          <TableHead className="table-head-sticky w-[120px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">Code ref.</TableHead>
                          <TableHead className="table-head-sticky w-[100px] px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground sm:px-5 sm:py-3.5 dark:text-ink-tertiary-dark">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {renderedSavedComments.map((row) => (
                          <TableRow
                            key={row.id}
                            className="border-t border-border bg-transparent text-foreground transition-colors hover:bg-muted/40 dark:border-obsidian-raised dark:bg-obsidian-sunken/40 dark:text-ink-primary-dark dark:hover:bg-obsidian-raised/35"
                          >
                            <TableCell className="px-4 py-2.5 sm:px-5 text-sm text-foreground align-top max-w-[480px] whitespace-pre-wrap dark:text-ink-primary-dark">
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
                                      <p className="mt-1.5 text-muted-foreground whitespace-pre-wrap dark:text-ink-secondary-dark">
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
                            <TableCell className="px-4 py-2.5 sm:px-5 text-muted-foreground dark:text-ink-secondary-dark">
                              {renderSource === "manual_letter"
                                ? (row.discipline ?? "—")
                                : portalDisciplineDisplayText(row)}
                            </TableCell>
                            <TableCell className="px-4 py-2.5 sm:px-5 font-mono-data text-xs align-top text-muted-foreground dark:text-ink-secondary-dark">{row.code_reference ?? "—"}</TableCell>
                            <TableCell className="px-4 py-2.5 sm:px-5 text-foreground dark:text-ink-primary-dark">{portalStatusDisplayText(row)}</TableCell>
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
          <Accordion
            type="single"
            collapsible
            defaultValue="add-comments"
            className="w-full rounded-xl border border-cream-sunken bg-cream-raised shadow-cream dark:border-obsidian-raised dark:bg-obsidian/30"
          >
            <AccordionItem value="add-comments" className="border-border px-1">
              <AccordionTrigger className="text-sm font-medium hover:no-underline">
                Add comments
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 gap-5 pt-1 lg:grid-cols-2 lg:gap-6">
                  <Card className="border-border/50 shadow-none dark:bg-obsidian/20">
                    <CardContent className="pt-5">
                      <CommentReviewInputPanel
                        inputMethod={commentInputMethod}
                        onInputMethodChange={setCommentInputMethod}
                        supportedFormatsHint={COMMENT_LETTER_SUPPORTED_FORMATS_HINT}
                        commentLetters={commentLetters}
                        selectedLetter={selectedLetter}
                        sourceDocumentId={sourceDocumentId}
                        onSelectLetter={handleSelectLetter}
                        savedManualLetterCount={savedManualLetterCount}
                        imagePreview={imagePreview}
                        originalUploadFile={originalUploadFile}
                        pendingUploadFiles={pendingUploadFiles}
                        onRemovePendingFile={removePendingFile}
                        fileInputRef={fileInputRef}
                        onFileChange={handleFileChange}
                        onFilesDropped={handleFilesDropped}
                        fileSelectionError={fileSelectionError}
                        isSpreadsheetFile={isSpreadsheetFile}
                        formatLetterDate={formatLetterDate}
                        parseStatus={parseStatus}
                        lastParseMethod={lastParseMethod}
                        parserSummary={parserSummary}
                        uploadRowsCount={uploadRows.length}
                        parsing={parsing}
                        saving={saving}
                        canParseLetter={canParseLetter}
                        parseButtonLabel={parseButtonLabel}
                        onParseDocument={() => void runParse()}
                        onClearSaved={() => setPendingConfirm({ kind: "clearSaved" })}
                        onDeleteLetter={() => setPendingConfirm({ kind: "deleteLetter" })}
                        disciplineOptions={disciplineOptions}
                        onParsePasted={handleParsePastedComments}
                        onAddPastedSingle={handleAddPastedSingleComment}
                      />
                    </CardContent>
                  </Card>
                  <CommentReviewExtractedPanel
                    projectId={projectId}
                    uploadRows={uploadRows}
                    savedManualLetterCount={savedManualLetterCount}
                    saving={saving}
                    parsing={parsing}
                    timerRef={timerRef}
                    onApproveAll={requestApproveAll}
                    onAddComment={openAddCommentForm}
                    onClearReviewList={clearExtractedRows}
                    onEditRow={openEditCommentForm}
                    onDeleteRow={removeUploadRow}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>

      <ManualCommentFormDialog
        open={commentFormOpen}
        onOpenChange={(open) => {
          setCommentFormOpen(open);
          if (!open) setEditingRow(null);
        }}
        mode={commentFormMode}
        initialRow={editingRow}
        disciplineOptions={disciplineOptions}
        onSave={handleSaveCommentFromDialog}
      />

      <AlertDialog open={pendingConfirm != null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingConfirm?.kind === "deleteLetter"
                ? "Delete this letter and its parsed comments?"
                : pendingConfirm?.kind === "clearSaved"
                  ? "Clear saved comments from this letter?"
                  : pendingConfirm?.kind === "approveAll"
                    ? "Save parsed comments"
                    : pendingConfirm?.kind === "newUpload"
                      ? "Saved manual-letter comments already exist"
                      : pendingConfirm?.kind === "newBatchUpload"
                        ? "Add more comment letter files?"
                        : "Confirm action"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {pendingConfirm?.kind === "deleteLetter" ? (
                  <p>
                    This removes the uploaded letter, its storage file, and only the parsed comments
                    linked to this letter&apos;s source document. Portal comments and comments from
                    other documents are not affected.
                  </p>
                ) : pendingConfirm?.kind === "approveAll" ? (
                  <p>
                    {pendingConfirm.conflict === "same_source"
                      ? `This letter already has ${savedManualLetterCount} saved comment${savedManualLetterCount !== 1 ? "s" : ""}. Append keeps them and adds ${uploadRows.length} new row${uploadRows.length !== 1 ? "s" : ""}. Replace removes the saved comments for this letter first.`
                      : pendingConfirm.conflict === "other_letters"
                        ? `This project has ${otherManualLetterCount} saved manual-letter comment${otherManualLetterCount !== 1 ? "s" : ""} from other uploaded letters. Append keeps all existing saved comments. Replace removes all manual-letter comments for this project first.`
                        : `Replace removes all ${projectManualLetterCount} existing manual-letter comment${projectManualLetterCount !== 1 ? "s" : ""} before saving the current parse.`}
                  </p>
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
                ) : pendingConfirm?.kind === "newBatchUpload" ? (
                  <p>
                    Saved manual-letter comments already exist for this project ({projectManualLetterCount} total).
                    New files will be parsed and added to the review list without removing existing saved comments.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {pendingConfirm?.kind === "deleteLetter" ? (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  const action = pendingConfirm;
                  setPendingConfirm(null);
                  void executeConfirmAction(action);
                }}
              >
                Delete letter and comments
              </AlertDialogAction>
            ) : pendingConfirm?.kind === "approveAll" ? (
              <>
                <Button
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    const conflict = pendingConfirm.conflict;
                    setPendingConfirm(null);
                    if (conflict === "same_source") {
                      void executeApproveAll({ replaceScope: "source_document" });
                    } else {
                      void executeApproveAll({ replaceScope: "project_manual" });
                    }
                  }}
                >
                  Replace saved comments
                </Button>
                <AlertDialogAction asChild>
                  <Button
                    variant="gold"
                    onClick={() => {
                      setPendingConfirm(null);
                      void executeApproveAll({ replaceScope: "none" });
                    }}
                  >
                    Append new comments
                  </Button>
                </AlertDialogAction>
              </>
            ) : pendingConfirm?.kind === "newUpload" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const file = pendingConfirm.file;
                    setPendingConfirm(null);
                    setNewUploadReplaceProject(false);
                    appendFilesToPendingBatch([file]);
                  }}
                >
                  Keep existing, parse for review
                </Button>
                <AlertDialogAction
                  onClick={() => {
                    const file = pendingConfirm.file;
                    setPendingConfirm(null);
                    setNewUploadReplaceProject(true);
                    appendFilesToPendingBatch([file]);
                  }}
                >
                  Replace on Approve All
                </AlertDialogAction>
              </>
            ) : pendingConfirm?.kind === "newBatchUpload" ? (
              <AlertDialogAction
                onClick={() => {
                  const files = pendingConfirm.files;
                  setPendingConfirm(null);
                  appendFilesToPendingBatch(files);
                }}
              >
                Add files to batch
              </AlertDialogAction>
            ) : pendingConfirm?.kind === "clearSaved" ? (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  const action = pendingConfirm;
                  setPendingConfirm(null);
                  void executeConfirmAction(action);
                }}
              >
                Clear saved comments
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
