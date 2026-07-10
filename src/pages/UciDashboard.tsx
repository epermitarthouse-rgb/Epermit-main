import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { EDITORIAL_FORM_CARD } from "@/components/layout/editorialPageChrome";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useProjects } from "@/hooks/useProjects";
import { useAuth } from "@/hooks/useAuth";
import {
  formatUciUserError,
  getCoordinationDetail,
  initProjectCoordination,
  isUciSessionExpiredError,
  listProjectCoordination,
  listUciProviders,
  postPepcoDashboardDiscovery,
  postPepcoDiscovery,
  postPepcoApplicationDetailDiscovery,
  resumePepcoApplicationDetailDiscovery,
  resumePepcoDiscovery,
  submitPepcoMfaCode,
  transitionCoordination,
  triggerCoordinationSync,
  UCI_SESSION_EXPIRED_MESSAGE,
} from "@/lib/uciApi";
import { getMicrosoftMailboxStatus } from "@/lib/microsoftMailboxApi";
import { toast } from "sonner";
import {
  ChevronRight,
  Info,
  Loader2,
  RadioTower,
  RefreshCw,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PepcoSelectedProjectDetailTabs } from "@/components/uci/PepcoApplicationDetailsPanel";
import { PepcoProjectList } from "@/components/uci/PepcoProjectList";
import {
  PepcoDeveloperTools,
  PepcoPortalHeaderSection,
} from "@/components/uci/PepcoPortalDrawerSection";
import {
  buildPepcoMergedProjects,
  PEPCO_APP_DETAIL_PROGRESS_START,
  parsePepcoApplicationDetailDiscovery,
  pickDefaultPepcoProjectKey,
  type PepcoMergedProject,
} from "@/lib/pepcoApplicationDetailUi";
import type {
  CoordinationApplication,
  CoordinationCommunication,
  CoordinationMilestone,
  CoordinationRecord,
  LifecycleState,
  UciPepcoApplicationDetailDiscoveryResponse,
  UciPepcoDashboardCardMeta,
  UtilityProvider,
  UciRecordDetailResponse,
} from "@/types/uci";

const LIFECYCLE_OPTIONS: LifecycleState[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_UTILITY",
  "BLOCKED",
  "ESCALATED",
  "COMPLETED",
];

const STAGE_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

function getEmbeddedProvider(record: CoordinationRecord): UtilityProvider | null {
  const u = record.utility_providers;
  if (Array.isArray(u)) return (u[0] as UtilityProvider) ?? null;
  return (u as UtilityProvider | null | undefined) ?? null;
}

function formatAutomationLabel(status: string | undefined): string {
  const s = String(status ?? "").toLowerCase();
  if (s === "placeholder") return "Not automated yet";
  return status || "Unknown";
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString();
}

/** Display-only labels for lifecycle enums (API values unchanged elsewhere). */
function formatLifecycleState(state: string | undefined): string {
  const map: Record<LifecycleState, string> = {
    NOT_STARTED: "Not started",
    IN_PROGRESS: "In progress",
    AWAITING_UTILITY: "Awaiting utility",
    BLOCKED: "Blocked",
    ESCALATED: "Escalated",
    COMPLETED: "Completed",
  };
  return (state && map[state as LifecycleState]) || state || "—";
}

/** Theme-token state badges for table (solid fills, no outline fight). */
function uciLifecycleStateBadgeClass(state: string | undefined): string {
  switch (state as LifecycleState) {
    case "NOT_STARTED":
      return cn(
        "shadow-sm !border-transparent !bg-muted !text-foreground dark:!bg-obsidian dark:!text-foreground",
      );
    case "IN_PROGRESS":
      return cn("!border-transparent !bg-teal !text-white shadow-sm dark:!bg-teal dark:!text-white");
    case "AWAITING_UTILITY":
      return cn(
        "!border-transparent !bg-gold-soft !font-semibold !text-ink-primary-light shadow-sm",
        "dark:!bg-gold dark:!text-ink-primary-light",
      );
    case "BLOCKED":
      return cn("!border-transparent !bg-destructive !text-destructive-foreground shadow-sm");
    case "ESCALATED":
      return cn("!border-transparent !bg-warning !text-warning-foreground shadow-sm");
    case "COMPLETED":
      return cn("!border-transparent !bg-success !text-success-foreground shadow-sm");
    default:
      return cn(
        "shadow-sm !border-transparent !bg-muted !text-foreground",
        "dark:!bg-obsidian-raised dark:!text-foreground",
      );
  }
}

/** Readable headings on cream / editorial cards (overrides default `text-card-foreground`) */
const uciSectionTitleClass =
  "font-display text-2xl font-normal tracking-tight text-foreground !text-foreground";

/** Secondary line on cream surfaces */
const uciMutedClass = "text-ink-secondary-light";

/** Detail sheet metadata labels (stage, dates, energization) — above body secondary tone */
const uciDetailLabelClass = "font-semibold text-foreground !text-foreground";

/** Detail sheet values beside labels */
const uciDetailValueClass = "font-medium text-foreground";

/** Force readable body cells on cream (Table defaults use theme foreground / card-foreground) */
const uciTableCellClass =
  "!font-medium !text-foreground p-4 align-middle dark:!text-foreground";

const uciTableHeadClass =
  "!text-foreground h-12 px-4 text-left align-middle text-xs font-bold uppercase tracking-wider dark:!text-foreground";

const uciTableHeaderRowClass =
  "[&_tr]:border-cream-sunken/50 [&_tr]:bg-cream-sunken/30 dark:[&_tr]:border-teal/20 dark:[&_tr]:bg-obsidian/55";

/** Unified subsection titles in sheet (Transitions, Manual update, child CardTitle) */
const uciSheetSectionTitleClass =
  "font-display text-base font-semibold capitalize tracking-tight !text-foreground dark:!text-foreground";

/** Inset panels: manual form wrapper only (cream in light, obsidian in dark). */
const uciInsetPanelClass = cn(
  "overflow-hidden rounded-lg border shadow-sm",
  "border-teal/20 bg-cream-raised/90 ring-1 ring-cream-sunken/40",
  "dark:border-teal/30 dark:bg-obsidian-strong/95 dark:ring-1 dark:ring-gold/20",
);

/** Transition history rows: light card in light mode, dark raised in dark mode */
const uciTransitionCardClass = cn(
  "overflow-hidden rounded-lg border p-3 text-xs shadow-sm",
  "border-border/60 bg-muted/40 text-foreground ring-1 ring-border/40",
  "dark:border-teal/35 dark:bg-obsidian-strong/95 dark:ring-gold/20",
);

/** Drawer read-only child sections: light card in light mode, dark navy in dark mode */
const uciDrawerChildCardClass = cn(
  "overflow-hidden rounded-xl border text-foreground shadow-sm",
  "border-border/60 bg-muted/30 ring-1 ring-border/30",
  "dark:border-teal/35 dark:bg-obsidian-strong/90 dark:ring-gold/25",
);

/**
 * Selected PEPCO project detail tabs wrapper: a low-opacity tint of the
 * app's existing orange brand accent (same token used for gold/orange
 * borders elsewhere), replacing the neutral grey card background so this
 * container stands out. Overrides only the border/background/ring color
 * utilities of `uciDrawerChildCardClass` — radius, spacing, and shadow are
 * unchanged.
 */
const uciPepcoDetailTabsWrapperClass = cn(
  "border-orange/25 bg-orange/[0.06] ring-orange/20",
  "dark:border-orange/30 dark:bg-orange/10 dark:ring-orange/25",
);

const uciDrawerChildCardHeaderClass = cn(
  "border-b border-border/40 bg-muted/20 px-4 py-3",
  "dark:border-teal/25 dark:bg-obsidian/50",
);

const uciDrawerChildCardTitleClass =
  "font-display text-base font-semibold capitalize tracking-tight text-foreground";

const uciDrawerChildEmptyClass = "text-sm text-muted-foreground";
const uciDrawerChildCountClass = "text-sm font-medium text-foreground";

const uciViewRowButtonClass = cn(
  "border-teal/35 bg-white/70 text-ink-primary-light shadow-sm",
  "hover:border-teal/55 hover:bg-teal/8 hover:text-teal dark:border-teal/40",
  "dark:bg-obsidian/45 dark:text-foreground dark:hover:bg-teal/15 dark:hover:text-foreground",
);

/** Toolbar/outline actions (Refresh + View row button family) */
const uciToolbarOutlineButtonClass = uciViewRowButtonClass;

/** Select + textarea in sheet manual form — match card surface (no bg-background seam). */
const uciSheetControlClass = cn(
  "border-cream-sunken bg-cream text-ink-primary-light",
  "dark:border-teal/25 dark:bg-obsidian-raised dark:text-foreground",
);

/** Manual stage update / compact section labels on cream panel (overrides sheet inherit). */
const uciManualFormTextClass = "text-foreground dark:text-foreground";

export default function UciDashboard() {
  const { projects, loading: projectsLoading } = useProjects();
  const { user, loading: authLoading } = useAuth();

  const [providers, setProviders] = useState<UtilityProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [records, setRecords] = useState<CoordinationRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [initPick, setInitPick] = useState<Record<string, boolean>>({});
  const [initting, setInitting] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UciRecordDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [toStage, setToStage] = useState<string>("1");
  const [toState, setToState] = useState<LifecycleState>("IN_PROGRESS");
  const [reason, setReason] = useState("");
  const [transitionSaving, setTransitionSaving] = useState(false);
  const [normalizedSyncBusy, setNormalizedSyncBusy] = useState(false);

  const [pepcoDiscoveryBusy, setPepcoDiscoveryBusy] = useState(false);
  const [pepcoDiscoveryMsg, setPepcoDiscoveryMsg] = useState<string | null>(null);
  const [pepcoDashboardBusy, setPepcoDashboardBusy] = useState(false);
  const [pepcoDashboardMsg, setPepcoDashboardMsg] = useState<string | null>(null);
  const [pepcoCodeModalOpen, setPepcoCodeModalOpen] = useState(false);
  const [pepcoCodeModalError, setPepcoCodeModalError] = useState<string | null>(null);
  const [pepcoCodeSubmitBusy, setPepcoCodeSubmitBusy] = useState(false);
  const [pepcoDashboardMfaSessionId, setPepcoDashboardMfaSessionId] = useState<string | null>(null);
  const [pepcoAppDetailMfaSessionId, setPepcoAppDetailMfaSessionId] = useState<string | null>(null);
  const [pepcoCodeModalTarget, setPepcoCodeModalTarget] = useState<"dashboard" | "application_detail">(
    "dashboard",
  );
  const [pepcoDashboardMfaCaptureIds, setPepcoDashboardMfaCaptureIds] = useState(false);
  const pepcoCodeInputRef = useRef<HTMLInputElement>(null);
  const [pepcoPendingSessionId, setPepcoPendingSessionId] = useState<string | null>(null);
  const [pepcoResumeBusy, setPepcoResumeBusy] = useState(false);
  const [pepcoAutoEmailMfa, setPepcoAutoEmailMfa] = useState(false);
  const [pepcoAppDetailBusy, setPepcoAppDetailBusy] = useState(false);
  const [pepcoAppDetailMsg, setPepcoAppDetailMsg] = useState<string | null>(null);
  const [pepcoAppDetailProgress, setPepcoAppDetailProgress] = useState<string[]>([]);
  const [pepcoAppDetailPendingSessionId, setPepcoAppDetailPendingSessionId] = useState<string | null>(
    null,
  );
  const [pepcoAppDetailResumeBusy, setPepcoAppDetailResumeBusy] = useState(false);
  const [pepcoDownloadDocuments, setPepcoDownloadDocuments] = useState(false);
  const [pepcoSelectedProjectKey, setPepcoSelectedProjectKey] = useState<string | null>(null);
  const [pepcoRowScrapeBusyId, setPepcoRowScrapeBusyId] = useState<string | null>(null);
  const [pepcoRowScrapeStatus, setPepcoRowScrapeStatus] = useState<
    Record<string, { status: "ok" | "error"; message?: string }>
  >({});
  const [pepcoPendingAppDetailUuid, setPepcoPendingAppDetailUuid] = useState<string | null>(null);
  const pepcoPendingAppDetailUuidRef = useRef<string | null>(null);
  const [pepcoPendingAppDetailDownloadDocuments, setPepcoPendingAppDetailDownloadDocuments] =
    useState<boolean | null>(null);
  const pepcoPendingAppDetailDownloadDocumentsRef = useRef<boolean | null>(null);

  const resolvePendingRowDownloadDocuments = (): boolean => {
    if (pepcoPendingAppDetailDownloadDocumentsRef.current === true) return true;
    if (pepcoPendingAppDetailDownloadDocumentsRef.current === false) return false;
    if (pepcoPendingAppDetailDownloadDocuments === true) return true;
    if (pepcoPendingAppDetailDownloadDocuments === false) return false;
    return pepcoDownloadDocuments === true;
  };

  const resolvePendingRowApplicationUuid = (): string | null => {
    const fromRef = pepcoPendingAppDetailUuidRef.current?.trim();
    if (fromRef) return fromRef;
    const fromState = pepcoPendingAppDetailUuid?.trim();
    return fromState || null;
  };

  const setPendingAppDetailRunOptions = (applicationUuid: string, downloadDocuments: boolean) => {
    pepcoPendingAppDetailUuidRef.current = applicationUuid;
    pepcoPendingAppDetailDownloadDocumentsRef.current = downloadDocuments;
    setPepcoPendingAppDetailUuid(applicationUuid);
    setPepcoPendingAppDetailDownloadDocuments(downloadDocuments);
  };

  const clearPendingAppDetailRunOptions = () => {
    pepcoPendingAppDetailUuidRef.current = null;
    pepcoPendingAppDetailDownloadDocumentsRef.current = null;
    setPepcoPendingAppDetailUuid(null);
    setPepcoPendingAppDetailDownloadDocuments(null);
  };

  const pepcoMfaSubmitInFlightRef = useRef(false);

  const closePepcoMfaModal = () => {
    setPepcoCodeModalOpen(false);
    setPepcoCodeModalError(null);
    setPepcoCodeSubmitBusy(false);
    if (pepcoCodeInputRef.current) pepcoCodeInputRef.current.value = "";
  };

  const isPepcoMfaHumanRequired = (status: string | undefined): boolean => status === "human_required";

  const reopenPepcoMfaModalWithError = (message: string) => {
    setPepcoCodeModalError(message);
    setPepcoCodeModalOpen(true);
    setPepcoCodeSubmitBusy(false);
  };

  const refreshCoordinationDetailAfterPepcoWork = async (coordinationId: string) => {
    const d = await getCoordinationDetail(coordinationId);
    setDetail(d);
    await refreshCoordination();
  };

  const logPepcoRowScrapeRequest = (applicationUuid: string, downloadDocuments: boolean) => {
    if (!import.meta.env.DEV) return;
    console.log("[uci-pepco] row detail scrape request", {
      applicationUuid,
      download_documents: downloadDocuments,
    });
  };

  const appendPepcoAppDetailProgress = (line: string) => {
    setPepcoAppDetailProgress((prev) => [...prev, line]);
  };

  const loadProviders = useCallback(async () => {
    if (authLoading || !user?.id) return;
    setProvidersLoading(true);
    try {
      const res = await listUciProviders();
      setProviders(res.providers ?? []);
      setInitPick((prev) => {
        const next: Record<string, boolean> = { ...prev };
        for (const p of res.providers ?? []) {
          if (next[p.slug] === undefined) next[p.slug] = false;
        }
        return next;
      });
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to load providers"));
    } finally {
      setProvidersLoading(false);
    }
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) {
      setProvidersLoading(false);
      return;
    }
    void loadProviders();
  }, [authLoading, user?.id, loadProviders]);

  const refreshCoordination = useCallback(async () => {
    if (authLoading || !user?.id) return;
    if (!projectId) {
      setRecords([]);
      return;
    }
    setRecordsLoading(true);
    try {
      const res = await listProjectCoordination(projectId);
      setRecords(res.records ?? []);
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to load coordination"));
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [authLoading, user?.id, projectId]);

  useEffect(() => {
    if (authLoading || !user?.id) return;
    void refreshCoordination();
  }, [authLoading, user?.id, refreshCoordination]);

  /**
   * Project/tenant safety: when the active PermitPilot project changes, any
   * open coordination detail (and its PEPCO selection/progress state) may
   * belong to the previous project and must be cleared. Backend access
   * checks remain the source of truth; this only prevents stale UI state.
   */
  useEffect(() => {
    setDetailOpen(false);
    setDetailId(null);
    setDetail(null);
    setPepcoSelectedProjectKey(null);
    setPepcoRowScrapeStatus({});
    setPepcoAppDetailProgress([]);
    setPepcoAppDetailMsg(null);
    setPepcoDashboardMsg(null);
    setPepcoDiscoveryMsg(null);
    setPepcoPendingSessionId(null);
    setPepcoAppDetailPendingSessionId(null);
    setPepcoAppDetailMfaSessionId(null);
    setPepcoCodeModalOpen(false);
    clearPendingAppDetailRunOptions();
  }, [projectId]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailOpen(true);
    setDetailLoading(true);
    setReason("");
    setPepcoDiscoveryMsg(null);
    setPepcoDashboardMsg(null);
    setPepcoCodeModalOpen(false);
    setPepcoCodeModalError(null);
    setPepcoDashboardMfaSessionId(null);
    setPepcoDashboardMfaCaptureIds(false);
    if (pepcoCodeInputRef.current) pepcoCodeInputRef.current.value = "";
    setPepcoPendingSessionId(null);
    setPepcoAppDetailMsg(null);
    setPepcoAppDetailProgress([]);
    setPepcoAppDetailPendingSessionId(null);
    setPepcoSelectedProjectKey(null);
    setPepcoRowScrapeStatus({});
    clearPendingAppDetailRunOptions();
    try {
      const d = await getCoordinationDetail(id);
      setDetail(d);
      setToStage(String(d.record.current_stage ?? 1));
      setToState(d.record.current_stage_state as LifecycleState);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load detail");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleTransition = async () => {
    if (!detailId) return;
    if (!reason.trim()) {
      toast.error("Please enter a reason for this update");
      return;
    }
    setTransitionSaving(true);
    try {
      await transitionCoordination(detailId, {
        to_stage: Number(toStage),
        to_state: toState,
        reason: reason.trim(),
      });
      toast.success("Stage updated");
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      await refreshCoordination();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Transition failed");
    } finally {
      setTransitionSaving(false);
    }
  };

  const handleNormalizedSync = async () => {
    if (!detailId) return;
    setNormalizedSyncBusy(true);
    try {
      const summary = await triggerCoordinationSync(detailId);
      toast.success(
        `Normalized sync complete — apps +${summary.applications.inserted}/${summary.applications.updated}, comms +${summary.communications.inserted}, events +${summary.milestones.inserted}`,
      );
      if (summary.warnings.length) {
        toast.message(summary.warnings[0]);
      }
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Normalized sync failed");
    } finally {
      setNormalizedSyncBusy(false);
    }
  };

  const handleInit = async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    const slugs = providers
      .filter((p) => initPick[p.slug])
      .map((p) => p.slug);
    if (slugs.length === 0) {
      toast.error("Select at least one provider to initialize");
      return;
    }
    setInitting(true);
    try {
      const out = await initProjectCoordination(projectId, slugs);
      toast.success(
        `Created ${out.created?.length ?? 0} record(s); ${out.already_existed?.length ?? 0} already existed`,
      );
      setRecords(out.records ?? []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Initialize failed");
    } finally {
      setInitting(false);
    }
  };

  const toggleAllInit = (value: boolean) => {
    setInitPick((prev) => {
      const next = { ...prev };
      for (const p of providers) next[p.slug] = value;
      return next;
    });
  };

  const detailRecord = detail?.record;
  const detailProvider = detailRecord ? getEmbeddedProvider(detailRecord) : null;
  const isPepcoCoordination =
    String(detailProvider?.slug ?? "").toLowerCase() === "pepco";

  const pepcoDashboardFromMetadata = useMemo(() => {
    const m =
      detailRecord?.metadata &&
      typeof detailRecord.metadata === "object" &&
      detailRecord.metadata !== null &&
      !Array.isArray(detailRecord.metadata)
        ? (detailRecord.metadata as Record<string, unknown>)
        : null;
    if (!m) return null;
    const nested = m.pepco_dashboard_discovery;
    const nestedObj =
      nested && typeof nested === "object" && !Array.isArray(nested)
        ? (nested as Record<string, unknown>)
        : null;
    const cards = Array.isArray(nestedObj?.cards)
      ? (nestedObj!.cards as UciPepcoDashboardCardMeta[])
      : [];

    const status =
      typeof m.pepco_dashboard_discovery_status === "string"
        ? m.pepco_dashboard_discovery_status
        : typeof nestedObj?.status === "string"
          ? nestedObj.status
          : null;
    const lastAt =
      typeof m.pepco_dashboard_last_discovered_at === "string"
        ? m.pepco_dashboard_last_discovered_at
        : typeof nestedObj?.last_discovered_at === "string"
          ? nestedObj.last_discovered_at
          : null;
    const cardsFound =
      typeof m.pepco_dashboard_cards_found === "number"
        ? m.pepco_dashboard_cards_found
        : typeof nestedObj?.cards_found === "number"
          ? nestedObj.cards_found
          : cards.length;
    const applicationIdsFound =
      typeof m.pepco_dashboard_application_ids_found === "number"
        ? m.pepco_dashboard_application_ids_found
        : typeof nestedObj?.application_ids_found === "number"
          ? nestedObj.application_ids_found
          : 0;
    const discoverySource =
      typeof m.pepco_dashboard_discovery_source === "string"
        ? m.pepco_dashboard_discovery_source
        : typeof nestedObj?.source === "string"
          ? nestedObj.source
          : null;
    const listApiWarning =
      typeof m.pepco_dashboard_list_api_warning === "string"
        ? m.pepco_dashboard_list_api_warning
        : typeof nestedObj?.list_api_warning === "string"
          ? nestedObj.list_api_warning
          : null;

    return {
      status,
      lastAt,
      cardsFound,
      applicationIdsFound,
      discoverySource,
      listApiWarning,
      cards,
    };
  }, [detailRecord?.metadata]);

  const pepcoApplicationDetailDiscovery = useMemo(() => {
    const m =
      detailRecord?.metadata &&
      typeof detailRecord.metadata === "object" &&
      detailRecord.metadata !== null &&
      !Array.isArray(detailRecord.metadata)
        ? (detailRecord.metadata as Record<string, unknown>)
        : null;
    return parsePepcoApplicationDetailDiscovery(m);
  }, [detailRecord?.metadata]);

  const hasPepcoDashboardCards =
    (pepcoDashboardFromMetadata?.cards.length ?? 0) > 0 ||
    (pepcoDashboardFromMetadata?.cardsFound ?? 0) > 0;

  const hasPepcoApplicationDetails =
    (pepcoApplicationDetailDiscovery?.applications?.length ?? 0) > 0;

  const pepcoMergedProjects: PepcoMergedProject[] = useMemo(
    () =>
      buildPepcoMergedProjects(
        pepcoDashboardFromMetadata?.cards ?? [],
        pepcoApplicationDetailDiscovery?.applications ?? [],
        pepcoRowScrapeStatus,
      ),
    [pepcoDashboardFromMetadata?.cards, pepcoApplicationDetailDiscovery?.applications, pepcoRowScrapeStatus],
  );

  const selectedPepcoProject: PepcoMergedProject | null = useMemo(
    () => pepcoMergedProjects.find((p) => p.key === pepcoSelectedProjectKey) ?? null,
    [pepcoMergedProjects, pepcoSelectedProjectKey],
  );

  /** Auto-select the default project and drop selections that no longer exist. */
  useEffect(() => {
    if (!isPepcoCoordination) return;
    const stillExists = pepcoMergedProjects.some((p) => p.key === pepcoSelectedProjectKey);
    if (stillExists) return;
    setPepcoSelectedProjectKey(pickDefaultPepcoProjectKey(pepcoMergedProjects));
  }, [isPepcoCoordination, pepcoMergedProjects, pepcoSelectedProjectKey]);

  const handleSelectPepcoProject = (key: string) => {
    setPepcoSelectedProjectKey(key);
  };

  const handleScrapePepcoProject = (project: PepcoMergedProject) => {
    if (!project.applicationId) return;
    setPepcoSelectedProjectKey(project.key);
    void handlePepcoRowDetailScrape(project.applicationId);
  };

  const pepcoActivePendingProjectId = resolvePendingRowApplicationUuid();

  const isSelectedPepcoProjectBusy =
    Boolean(selectedPepcoProject) &&
    (pepcoRowScrapeBusyId === selectedPepcoProject?.applicationId ||
      ((pepcoAppDetailBusy || pepcoAppDetailResumeBusy || pepcoCodeSubmitBusy) &&
        Boolean(selectedPepcoProject?.applicationId) &&
        pepcoActivePendingProjectId === selectedPepcoProject?.applicationId));

  const isSelectedPepcoProjectAwaitingVerification =
    Boolean(selectedPepcoProject) &&
    pepcoCodeModalTarget === "application_detail" &&
    (pepcoCodeModalOpen || Boolean(pepcoAppDetailMfaSessionId)) &&
    Boolean(selectedPepcoProject?.applicationId) &&
    pepcoActivePendingProjectId === selectedPepcoProject?.applicationId;

  const selectedPepcoProjectRowStatus =
    selectedPepcoProject?.applicationId
      ? pepcoRowScrapeStatus[selectedPepcoProject.applicationId]
      : undefined;

  useEffect(() => {
    if (!detailOpen || !detailId || !isPepcoCoordination) return;
    let cancelled = false;
    void (async () => {
      try {
        const st = await getMicrosoftMailboxStatus();
        if (!cancelled) setPepcoAutoEmailMfa(Boolean(st.connected));
      } catch {
        if (!cancelled) setPepcoAutoEmailMfa(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailOpen, detailId, isPepcoCoordination]);

  const handlePepcoDiscovery = async () => {
    if (!detailId) return;
    setPepcoDiscoveryBusy(true);
    setPepcoDiscoveryMsg(null);
    setPepcoPendingSessionId(null);
    try {
      const out = await postPepcoDiscovery(detailId, {
        headed: true,
        auto_email_mfa: pepcoAutoEmailMfa,
      });
      if (out.status === "human_required") {
        toast.message(out.message || "Verification required");
        if (out.session_id) setPepcoPendingSessionId(out.session_id);
        setPepcoDiscoveryMsg(
          "PEPCO MFA required. Complete the email code in the opened browser, then click Resume.",
        );
      } else if (out.status === "completed") {
        setPepcoPendingSessionId(null);
        toast.success(
          `Login reached dashboard checkpoint (${out.checkpoint ?? "dashboard_ready"}).`,
        );
        setPepcoDiscoveryMsg(
          `Checkpoint: ${out.checkpoint ?? "dashboard_ready"}. URL reached without MFA prompt.`,
        );
      } else {
        setPepcoPendingSessionId(null);
        toast.error(out.message || "PEPCO login check failed");
        setPepcoDiscoveryMsg(out.message || "Login check failed.");
      }
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      await refreshCoordination();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "PEPCO discovery request failed";
      toast.error(msg);
      setPepcoDiscoveryMsg(msg);
    } finally {
      setPepcoDiscoveryBusy(false);
    }
  };

  const handlePepcoResume = async () => {
    if (!detailId || !pepcoPendingSessionId) return;
    setPepcoResumeBusy(true);
    try {
      const out = await resumePepcoDiscovery(detailId, {
        session_id: pepcoPendingSessionId,
      });
      if (out.status === "completed") {
        setPepcoPendingSessionId(null);
        toast.success("PEPCO dashboard reached.");
        setPepcoDiscoveryMsg("PEPCO dashboard reached.");
      } else if (out.status === "human_required") {
        toast.message(out.message || "Verification still required");
        setPepcoDiscoveryMsg(
          "PEPCO MFA required. Complete the email code in the opened browser, then click Resume.",
        );
        if (out.session_id) setPepcoPendingSessionId(out.session_id);
      } else {
        setPepcoPendingSessionId(null);
        toast.error(out.message || "Resume failed");
        setPepcoDiscoveryMsg(out.message || "Resume failed.");
      }
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      await refreshCoordination();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "PEPCO resume request failed";
      toast.error(msg);
      setPepcoDiscoveryMsg(msg);
    } finally {
      setPepcoResumeBusy(false);
    }
  };

  const handlePepcoDashboardDiscover = async (captureApplicationIds: boolean) => {
    if (!detailId) return;
    setPepcoDashboardBusy(true);
    setPepcoDashboardMsg(null);
    setPepcoCodeModalError(null);
    setPepcoCodeModalOpen(false);
    if (pepcoCodeInputRef.current) pepcoCodeInputRef.current.value = "";
    setPepcoPendingSessionId(null);
    try {
      const out = await postPepcoDashboardDiscovery(detailId, {
        headed: true,
        auto_email_mfa: pepcoAutoEmailMfa,
        capture_application_ids: captureApplicationIds,
      });
      if (out.status === "human_required") {
        if ("reason" in out && out.reason === "mfa_contact_method_selection_required") {
          setPepcoCodeModalOpen(false);
          if (pepcoCodeInputRef.current) pepcoCodeInputRef.current.value = "";
          toast.message(out.message || "Select Email in the PEPCO browser, then continue.");
          setPepcoDashboardMsg(
            typeof out.message === "string" && out.message.trim()
              ? out.message
              : "Select Email in the PEPCO browser, then continue.",
          );
        } else if (
          "reason" in out &&
          out.reason === "mfa_email_code_input_required" &&
          "session_id" in out &&
          typeof out.session_id === "string"
        ) {
          setPepcoCodeModalTarget("dashboard");
          setPepcoDashboardMfaSessionId(out.session_id);
          setPepcoDashboardMfaCaptureIds(
            "capture_application_ids" in out ? out.capture_application_ids === true : captureApplicationIds,
          );
          setPepcoCodeModalError(null);
          setPepcoCodeModalOpen(true);
          toast.message("Enter the PEPCO verification code in the dialog.");
          setPepcoDashboardMsg(
            out.message || "Enter the verification code sent to your PEPCO email.",
          );
        } else {
          toast.message(out.message || "Verification required");
          if (out.session_id) setPepcoPendingSessionId(out.session_id);
          setPepcoDashboardMsg(
            "PEPCO MFA required in the dashboard flow. Complete the email code in the opened browser, then click Resume PEPCO Login and run Discover PEPCO Dashboard again.",
          );
        }
      } else if (out.status === "completed") {
        setPepcoPendingSessionId(null);
        const cardsFound =
          "cards_found" in out && typeof out.cards_found === "number" ? out.cards_found : undefined;
        const idsFound =
          "application_ids_found" in out && typeof out.application_ids_found === "number"
            ? out.application_ids_found
            : undefined;
        const suffix =
          cardsFound !== undefined
            ? ` ${cardsFound} dashboard card${cardsFound === 1 ? "" : "s"} extracted.`
            : "";
        const ids =
          idsFound !== undefined ? ` Application IDs captured: ${idsFound}.` : "";
        toast.success(`PEPCO dashboard discovery completed.${suffix}${ids}`);
        setPepcoDashboardMsg(out.checkpoint ?? "completed");
      } else if (out.status === "failed") {
        setPepcoPendingSessionId(null);
        toast.error(out.message || "Dashboard discovery failed");
        setPepcoDashboardMsg(out.message || "Dashboard discovery failed.");
      } else {
        setPepcoPendingSessionId(null);
        toast.message("Dashboard discovery finished with an unexpected response.");
      }
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      await refreshCoordination();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "PEPCO dashboard discovery request failed";
      toast.error(msg);
      setPepcoDashboardMsg(msg);
    } finally {
      setPepcoDashboardBusy(false);
    }
  };

  const handleSubmitPepcoDashboardCode = async () => {
    if (!detailId || !pepcoDashboardMfaSessionId) return;
    if (pepcoCodeSubmitBusy || pepcoMfaSubmitInFlightRef.current) return;
    const raw = pepcoCodeInputRef.current?.value ?? "";
    const code = raw.trim().replace(/\s+/g, "");
    if (!/^\d{4,8}$/.test(code)) {
      setPepcoCodeModalError("Enter a numeric code (4–8 digits).");
      return;
    }
    const sessionId = pepcoDashboardMfaSessionId;
    const captureApplicationIds = pepcoDashboardMfaCaptureIds;
    pepcoMfaSubmitInFlightRef.current = true;
    setPepcoCodeSubmitBusy(true);
    setPepcoCodeModalError(null);
    closePepcoMfaModal();
    setPepcoDashboardBusy(true);
    try {
      const out = await submitPepcoMfaCode(detailId, {
        session_id: sessionId,
        code,
        continue_action: "discover_dashboard",
        capture_application_ids: captureApplicationIds,
      });
      if (import.meta.env.DEV) {
        console.log("[PEPCO MFA submit result]", out);
      }

      if (isPepcoMfaHumanRequired(out.status)) {
        const reason = "reason" in out ? String(out.reason || "") : "";
        if (reason === "mfa_email_code_input_required") {
          setPepcoCodeModalTarget("dashboard");
          if ("session_id" in out && typeof out.session_id === "string") {
            setPepcoDashboardMfaSessionId(out.session_id);
          } else {
            setPepcoDashboardMfaSessionId(sessionId);
          }
          reopenPepcoMfaModalWithError(
            typeof out.message === "string"
              ? out.message
              : "That code was not accepted. Try again with the latest code.",
          );
        } else {
          if ("session_id" in out && typeof out.session_id === "string") {
            setPepcoDashboardMfaSessionId(out.session_id);
          }
          toast.message(out.message || "Verification still required");
          setPepcoDashboardMsg(out.message || "Verification still required.");
        }
        return;
      }

      setPepcoDashboardMfaSessionId(null);
      if (out.status === "completed") {
        const cardsFound =
          "cards_found" in out && typeof out.cards_found === "number" ? out.cards_found : undefined;
        const idsFound =
          "application_ids_found" in out && typeof out.application_ids_found === "number"
            ? out.application_ids_found
            : undefined;
        const suffix =
          cardsFound !== undefined
            ? ` ${cardsFound} card${cardsFound === 1 ? "" : "s"} saved.`
            : "";
        const ids =
          idsFound !== undefined ? ` ${idsFound} application ID${idsFound === 1 ? "" : "s"} captured.` : "";
        toast.success(`Dashboard discovery completed.${suffix}${ids}`);
        setPepcoDashboardMsg("completed");
      } else if (out.status === "failed") {
        toast.error(out.message || "Verification failed");
        setPepcoDashboardMsg(out.message || "Discovery session ended.");
      } else {
        toast.message("Unexpected response after submitting code.");
      }

      void refreshCoordinationDetailAfterPepcoWork(detailId).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to refresh coordination detail";
        toast.error(msg);
      });
    } catch (e: unknown) {
      const msg = formatUciUserError(e, "Submit code failed");
      setPepcoCodeModalTarget("dashboard");
      setPepcoDashboardMfaSessionId(sessionId);
      reopenPepcoMfaModalWithError(
        isUciSessionExpiredError(e) ? UCI_SESSION_EXPIRED_MESSAGE : msg,
      );
      toast.error(isUciSessionExpiredError(e) ? UCI_SESSION_EXPIRED_MESSAGE : msg);
    } finally {
      pepcoMfaSubmitInFlightRef.current = false;
      setPepcoCodeSubmitBusy(false);
      setPepcoDashboardBusy(false);
    }
  };

  const isRecoverableAppDetailFailure = (
    out: UciPepcoApplicationDetailDiscoveryResponse,
  ): boolean => {
    return (
      out.status === "failed" &&
      "session_id" in out &&
      typeof out.session_id === "string" &&
      "error_code" in out &&
      (out.error_code === "DASHBOARD_API_NOT_READY" ||
        out.error_code === "SCRAPE_FAILED" ||
        out.error_code === "PEPCO_API_ERROR" ||
        out.error_code === "NO_APPLICATION_UUIDS" ||
        out.error_code === "PEPCO_BEARER_TOKEN_NOT_FOUND")
    );
  };

  const preserveRecoverableAppDetailSession = (
    out: UciPepcoApplicationDetailDiscoveryResponse,
  ): boolean => {
    if (!isRecoverableAppDetailFailure(out)) return false;
    setPepcoAppDetailPendingSessionId(out.session_id as string);
    setPepcoAppDetailMfaSessionId(out.session_id as string);
    setPepcoCodeModalOpen(false);
    return true;
  };

  const openAppDetailMfaModal = (sessionId: string, message?: string) => {
    setPepcoAppDetailMfaSessionId(sessionId);
    setPepcoAppDetailPendingSessionId(sessionId);
    setPepcoCodeModalTarget("application_detail");
    setPepcoCodeModalError(null);
    setPepcoCodeModalOpen(true);
    setPepcoAppDetailMsg(message || "PEPCO verification code required.");
    appendPepcoAppDetailProgress("Verification code required");
    toast.message("Enter the PEPCO verification code sent by email.");
  };

  const applyAppDetailResponse = async (
    out: UciPepcoApplicationDetailDiscoveryResponse,
    opts?: { suppressMfaModal?: boolean },
  ) => {
    if ("progress" in out && Array.isArray(out.progress) && out.progress.length > 0) {
      setPepcoAppDetailProgress(out.progress);
    }
    if (out.status === "human_required") {
      const reason = "reason" in out ? String(out.reason || "") : "";
      const sessionId =
        "session_id" in out && typeof out.session_id === "string" ? out.session_id : null;

      if (reason === "mfa_contact_method_selection_required") {
        if (sessionId) setPepcoAppDetailPendingSessionId(sessionId);
        toast.message(out.message || "Select Email in the PEPCO browser, then continue.");
        setPepcoAppDetailMsg(
          out.message || "Select Email in the PEPCO browser, then click Resume Application Detail Scrape.",
        );
      } else if (
        !opts?.suppressMfaModal &&
        sessionId &&
        (reason === "mfa_email_code_input_required" || reason === "mfa_email_code")
      ) {
        openAppDetailMfaModal(
          sessionId,
          out.message || "Enter the PEPCO verification code sent by email.",
        );
      } else {
        toast.message(out.message || "Verification required");
        if (sessionId) setPepcoAppDetailPendingSessionId(sessionId);
        setPepcoAppDetailMsg(
          out.message ||
            "PEPCO MFA required. Complete verification in the opened browser, then click Resume Application Detail Scrape.",
        );
      }
    } else if (out.status === "completed" || out.status === "partial") {
      setPepcoAppDetailPendingSessionId(null);
      setPepcoAppDetailMfaSessionId(null);
      clearPendingAppDetailRunOptions();
      setPepcoCodeModalOpen(false);
      const count =
        "applications_scraped" in out && typeof out.applications_scraped === "number"
          ? out.applications_scraped
          : undefined;
      toast.success(
        count !== undefined
          ? `PEPCO application detail scrape ${out.status} (${count} application${count === 1 ? "" : "s"}).`
          : `PEPCO application detail scrape ${out.status}.`,
      );
      setPepcoAppDetailMsg(`Status: ${out.status}`);
      if (pepcoPendingAppDetailUuid) {
        setPepcoRowScrapeStatus((prev) => ({
          ...prev,
          [pepcoPendingAppDetailUuid]: { status: "ok" },
        }));
      }
    } else if (out.status === "failed") {
      const recoverable = preserveRecoverableAppDetailSession(out);
      if (!recoverable) {
        setPepcoAppDetailPendingSessionId(null);
        setPepcoAppDetailMfaSessionId(null);
        clearPendingAppDetailRunOptions();
      }
      const failMsg =
        "message" in out && out.message
          ? out.message
          : "Application detail scrape failed";
      toast.error(failMsg);
      setPepcoAppDetailMsg(failMsg);
      if (pepcoPendingAppDetailUuid && !recoverable) {
        setPepcoRowScrapeStatus((prev) => ({
          ...prev,
          [pepcoPendingAppDetailUuid]: { status: "error", message: failMsg },
        }));
      }
    }
  };

  const handlePepcoRowDetailScrape = async (applicationId: string) => {
    if (!detailId || !applicationId.trim()) return;
    const uuid = applicationId.trim();
    const downloadDocumentsForRun = pepcoDownloadDocuments === true;
    if (
      pepcoRowScrapeBusyId === uuid ||
      pepcoAppDetailBusy ||
      pepcoAppDetailResumeBusy ||
      pepcoCodeSubmitBusy ||
      pepcoCodeModalOpen ||
      pepcoAppDetailPendingSessionId
    ) {
      toast.message(
        "PEPCO application detail scrape is already in progress. Enter the verification code or click Resume Application Detail Scrape.",
      );
      return;
    }
    if (import.meta.env.DEV) {
      console.log("[PEPCO row scrape]", {
        applicationId: uuid,
        checkboxState: pepcoDownloadDocuments,
      });
    }
    setPepcoRowScrapeBusyId(uuid);
    setPendingAppDetailRunOptions(uuid, downloadDocumentsForRun);
    setPepcoAppDetailBusy(true);
    setPepcoAppDetailMsg(null);
    setPepcoAppDetailPendingSessionId(null);
    setPepcoAppDetailMfaSessionId(null);
    setPepcoCodeModalOpen(false);
    if (pepcoCodeInputRef.current) pepcoCodeInputRef.current.value = "";
    setPepcoAppDetailProgress([PEPCO_APP_DETAIL_PROGRESS_START]);
    try {
      const out = await postPepcoApplicationDetailDiscovery(detailId, {
        headed: true,
        auto_email_mfa: pepcoAutoEmailMfa,
        download_documents: downloadDocumentsForRun,
        application_uuids: [uuid],
      });
      await applyAppDetailResponse(out);
      if (out.status === "completed" || out.status === "partial") {
        setPepcoRowScrapeStatus((prev) => ({ ...prev, [uuid]: { status: "ok" } }));
      } else if (out.status === "failed") {
        const failMsg =
          "message" in out && out.message ? out.message : "Application detail scrape failed";
        setPepcoRowScrapeStatus((prev) => ({
          ...prev,
          [uuid]: { status: "error", message: failMsg },
        }));
      }
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      await refreshCoordination();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "PEPCO application detail scrape failed";
      appendPepcoAppDetailProgress(`Failed: ${msg}`);
      toast.error(msg);
      setPepcoAppDetailMsg(msg);
      setPepcoRowScrapeStatus((prev) => ({
        ...prev,
        [uuid]: { status: "error", message: msg },
      }));
    } finally {
      setPepcoAppDetailBusy(false);
      setPepcoRowScrapeBusyId(null);
    }
  };

  const handlePepcoApplicationDetailResume = async () => {
    if (!detailId || !pepcoAppDetailPendingSessionId) return;
    const downloadDocuments = resolvePendingRowDownloadDocuments();
    const applicationUuid = resolvePendingRowApplicationUuid();
    logPepcoRowScrapeRequest(applicationUuid ?? "(unknown)", downloadDocuments);
    setPepcoAppDetailResumeBusy(true);
    appendPepcoAppDetailProgress("Resuming PEPCO application detail scrape");
    try {
      const out = await resumePepcoApplicationDetailDiscovery(detailId, {
        session_id: pepcoAppDetailPendingSessionId,
        download_documents: downloadDocuments,
        application_uuids: applicationUuid ? [applicationUuid] : undefined,
      });
      await applyAppDetailResponse(out);
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      await refreshCoordination();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "PEPCO application detail resume failed";
      appendPepcoAppDetailProgress(`Failed: ${msg}`);
      toast.error(msg);
      setPepcoAppDetailMsg(msg);
    } finally {
      setPepcoAppDetailResumeBusy(false);
    }
  };

  const handleSubmitPepcoApplicationDetailCode = async () => {
    if (!detailId || !pepcoAppDetailMfaSessionId) return;
    if (pepcoCodeSubmitBusy || pepcoMfaSubmitInFlightRef.current) return;
    const raw = pepcoCodeInputRef.current?.value ?? "";
    const code = raw.trim().replace(/\s+/g, "");
    if (!/^\d{4,8}$/.test(code)) {
      setPepcoCodeModalError("Enter a numeric code (4–8 digits).");
      return;
    }
    const sessionId = pepcoAppDetailMfaSessionId;
    const downloadDocuments = resolvePendingRowDownloadDocuments();
    const applicationUuid = resolvePendingRowApplicationUuid();
    if (!applicationUuid) {
      setPepcoCodeModalError("Missing selected project for this scrape. Start Scrape Details again.");
      return;
    }
    pepcoMfaSubmitInFlightRef.current = true;
    setPepcoCodeSubmitBusy(true);
    setPepcoCodeModalError(null);
    appendPepcoAppDetailProgress("Submitting PEPCO verification code");
    logPepcoRowScrapeRequest(applicationUuid, downloadDocuments);
    closePepcoMfaModal();
    setPepcoAppDetailBusy(true);
    try {
      const out = await resumePepcoApplicationDetailDiscovery(detailId, {
        session_id: sessionId,
        code,
        download_documents: downloadDocuments,
        application_uuids: [applicationUuid],
      });
      if (import.meta.env.DEV) {
        console.log("[PEPCO MFA submit result]", out);
      }

      if (isPepcoMfaHumanRequired(out.status)) {
        const reason = "reason" in out ? String(out.reason || "") : "";
        const nextSessionId =
          "session_id" in out && typeof out.session_id === "string" ? out.session_id : sessionId;
        setPepcoAppDetailMfaSessionId(nextSessionId);
        setPepcoAppDetailPendingSessionId(nextSessionId);
        if ("progress" in out && Array.isArray(out.progress)) {
          setPepcoAppDetailProgress(out.progress);
        }
        if (reason === "mfa_email_code_input_required" || reason === "mfa_email_code") {
          setPepcoCodeModalTarget("application_detail");
          reopenPepcoMfaModalWithError(
            typeof out.message === "string"
              ? out.message
              : "PEPCO verification code was rejected or expired. Request a new code and try again.",
          );
        } else {
          await applyAppDetailResponse(out);
        }
        return;
      }

      setPepcoAppDetailMfaSessionId(null);
      await applyAppDetailResponse(out, { suppressMfaModal: true });
      void refreshCoordinationDetailAfterPepcoWork(detailId).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to refresh coordination detail";
        toast.error(msg);
      });
    } catch (e: unknown) {
      const msg = formatUciUserError(
        e,
        "PEPCO verification code was rejected or expired. Request a new code and try again.",
      );
      setPepcoCodeModalTarget("application_detail");
      setPepcoAppDetailMfaSessionId(sessionId);
      setPepcoAppDetailPendingSessionId(sessionId);
      reopenPepcoMfaModalWithError(
        isUciSessionExpiredError(e) ? UCI_SESSION_EXPIRED_MESSAGE : msg,
      );
      toast.error(isUciSessionExpiredError(e) ? UCI_SESSION_EXPIRED_MESSAGE : msg);
    } finally {
      pepcoMfaSubmitInFlightRef.current = false;
      setPepcoCodeSubmitBusy(false);
      setPepcoAppDetailBusy(false);
    }
  };

  const handlePepcoResumeInterrupted = () => {
    if (pepcoAppDetailPendingSessionId) {
      void handlePepcoApplicationDetailResume();
      return;
    }
    if (pepcoPendingSessionId) {
      void handlePepcoResume();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <EditorialPageHeader
        eyebrow="UCI"
        title="Utility Coordination Intelligence"
        description="Track utility provider coordination, lifecycle stages, and project readiness."
        icon={RadioTower}
        iconClassName="text-teal"
        className="dark:bg-muted dark:text-foreground"
      />

      <section className="pb-12 pt-2 px-4 sm:px-6">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <div
            className={cn(
              EDITORIAL_FORM_CARD,
              "flex items-start gap-3 px-4 py-3 text-sm text-ink-secondary-light",
            )}
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
            <div className="text-ink-primary-light">
              <p className="font-medium text-ink-primary-light">
                Foundation mode: portal discovery and submission automation are not enabled yet.
              </p>
              <ul className={cn("mt-1 list-disc pl-5 text-xs", uciMutedClass)}>
                <li>Portal automation: Not started</li>
                <li>Submission automation: Not enabled</li>
                <li>Manual coordination tracking is available</li>
              </ul>
            </div>
          </div>

          {/* Providers */}
          <Card className={cn(EDITORIAL_FORM_CARD, "text-ink-primary-light")}>
            <CardHeader>
              <CardTitle className={uciSectionTitleClass}>Utility providers</CardTitle>
              <CardDescription className={cn(uciMutedClass, "opacity-100")}>
                Seeded catalog — automation status is informational only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {providersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-teal" />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {providers.map((p) => (
                    <div
                      key={p.id}
                      className={cn(
                        "rounded-xl border p-3.5 text-sm shadow-sm transition-shadow",
                        "border-cream-sunken/90 bg-cream-raised text-ink-primary-light",
                        "hover:shadow-md dark:border-teal/25 dark:bg-gradient-to-b dark:from-obsidian-raised dark:to-obsidian dark:text-foreground dark:shadow-inner",
                      )}
                    >
                      <p className="font-semibold !text-ink-primary-light dark:!text-foreground">{p.name}</p>
                      <p className={cn("text-xs", uciMutedClass, "dark:text-muted-foreground")}>
                        {p.utility_type}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant="mutedLight">{formatAutomationLabel(p.automation_status)}</Badge>
                        {p.primary_portal_type ? (
                          <Badge variant="brand" className="dark:border-cream/30 dark:text-foreground">
                            {p.primary_portal_type}
                          </Badge>
                        ) : null}
                        {p.is_active ? (
                          <Badge variant="ai">Active</Badge>
                        ) : (
                          <Badge variant="destructive" className="dark:text-foreground">
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Project */}
          <Card className={cn(EDITORIAL_FORM_CARD, "text-ink-primary-light")}>
            <CardHeader>
              <CardTitle className={uciSectionTitleClass}>Project</CardTitle>
              <CardDescription className={cn(uciMutedClass, "opacity-100")}>
                Coordination records are scoped per project (owner or team access).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid max-w-md gap-2">
                <Label className="text-ink-primary-light">Selected project</Label>
                <Select
                  value={projectId ?? ""}
                  onValueChange={(v) => setProjectId(v || null)}
                  disabled={projectsLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={projectsLoading ? "Loading projects…" : "Choose a project"} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.jurisdiction ? ` · ${p.jurisdiction}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedProject ? (
                <div className={cn("text-sm", uciMutedClass)}>
                  <p>
                    <span className="font-medium text-ink-primary-light">{selectedProject.name}</span>
                    {selectedProject.jurisdiction ? ` · ${selectedProject.jurisdiction}` : ""}
                  </p>
                  {selectedProject.permit_number ? (
                    <p className="font-medium text-ink-primary-light">
                      Permit: {selectedProject.permit_number}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Initialize */}
          <Card className={cn(EDITORIAL_FORM_CARD, "text-ink-primary-light")}>
            <CardHeader>
              <CardTitle className={uciSectionTitleClass}>Initialize coordination</CardTitle>
              <CardDescription className={cn(uciMutedClass, "opacity-100")}>
                Create utility coordination rows for the selected project. Safe to re-run: existing
                provider rows are not duplicated.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => toggleAllInit(true)}>
                  Select all
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => toggleAllInit(false)}>
                  Clear
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {providers.map((p) => {
                  const checked = Boolean(initPick[p.slug]);
                  return (
                  <label
                    key={p.id}
                    title={p.name}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-all",
                      "border-cream-sunken/90 bg-cream/80 text-ink-primary-light",
                      "hover:border-cream-sunken hover:bg-cream-raised/70",
                      "focus-within:outline-none focus-within:ring-2 focus-within:ring-teal/40",
                      checked &&
                        "border-teal/55 bg-teal/[0.09] shadow-sm ring-2 ring-teal/30 dark:border-teal/50 dark:bg-teal/[0.18] dark:ring-teal/35",
                      !checked &&
                        "dark:border-obsidian-strong/80 dark:bg-obsidian/50 dark:text-foreground dark:hover:border-teal/28 dark:hover:bg-obsidian-raised/65",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) =>
                        setInitPick((prev) => ({ ...prev, [p.slug]: Boolean(c) }))
                      }
                      className={cn(
                        "shrink-0 border-gold/50 dark:border-cream/35",
                        "data-[state=checked]:border-teal data-[state=checked]:bg-teal data-[state=checked]:text-white",
                        "dark:data-[state=checked]:border-teal-soft dark:data-[state=checked]:bg-teal",
                      )}
                    />
                    <span className="truncate font-medium !text-ink-primary-light dark:!text-foreground">{p.name}</span>
                  </label>
                  );
                })}
              </div>
              <Button
                className="bg-teal hover:bg-teal/90 text-white"
                disabled={!projectId || initting || providers.length === 0}
                onClick={() => void handleInit()}
              >
                {initting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Initialize coordination
              </Button>
            </CardContent>
          </Card>

          {/* Records table */}
          <Card
            className={cn(EDITORIAL_FORM_CARD, "text-ink-primary-light border-teal/30 shadow-sm dark:border-teal/35")}
          >
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className={uciSectionTitleClass}>Coordination records</CardTitle>
                <CardDescription className={cn(uciMutedClass, "opacity-100")}>
                  {projectId
                    ? "Per-utility coordination for the selected project."
                    : "Select a project to load records."}
                </CardDescription>
              </div>
              {projectId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={uciToolbarOutlineButtonClass}
                  onClick={() => void refreshCoordination()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {!projectId ? (
                <p className={cn("py-6 text-center text-sm", uciMutedClass)}>
                  Choose a project above.
                </p>
              ) : recordsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-teal" />
                </div>
              ) : records.length === 0 ? (
                <p className={cn("py-8 text-center text-sm", uciMutedClass)}>
                  No utility coordination records yet. Initialize providers to begin.
                </p>
              ) : (
                <Table
                  wrapperClassName="rounded-lg border border-cream-sunken/50 bg-cream-raised/80 shadow-inner dark:border-teal/25 dark:bg-obsidian/40"
                  className="bg-cream/40 text-ink-primary-light dark:bg-transparent"
                >
                    <TableHeader className={uciTableHeaderRowClass}>
                      <TableRow className="border-cream-sunken/40 transition-colors hover:bg-cream-sunken/25 dark:border-teal/15 dark:hover:bg-obsidian/65">
                        <TableHead className={uciTableHeadClass}>Provider</TableHead>
                        <TableHead className={uciTableHeadClass}>Type</TableHead>
                        <TableHead className={uciTableHeadClass}>Stage</TableHead>
                        <TableHead className={uciTableHeadClass}>State</TableHead>
                        <TableHead className={uciTableHeadClass}>Updated</TableHead>
                        <TableHead className={cn(uciTableHeadClass, "w-[100px]")} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map((r) => {
                        const prov = getEmbeddedProvider(r);
                        return (
                          <TableRow
                            key={r.id}
                            className="border-cream-sunken/35 bg-cream/30 transition-colors hover:bg-gold-soft/14 dark:border-teal/12 dark:bg-obsidian-raised/45 dark:hover:bg-teal/6"
                          >
                            <TableCell className={cn(uciTableCellClass, "!font-semibold")}>
                              {prov?.name ?? "—"}
                            </TableCell>
                            <TableCell className={uciTableCellClass}>
                              {prov?.utility_type ?? r.utility_type ?? "—"}
                            </TableCell>
                            <TableCell className={uciTableCellClass}>{r.current_stage}</TableCell>
                            <TableCell className={cn(uciTableCellClass, "max-w-[160px]")}>
                              <Badge
                                variant="secondary"
                                title={r.current_stage_state}
                                className={cn(
                                  "whitespace-nowrap rounded-md px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
                                  uciLifecycleStateBadgeClass(r.current_stage_state),
                                )}
                              >
                                {formatLifecycleState(r.current_stage_state)}
                              </Badge>
                            </TableCell>
                            <TableCell className={cn(uciTableCellClass, "!text-ink-primary-light/95", "!font-normal", "text-xs dark:!text-foreground/95")}>
                              {formatWhen(r.updated_at)}
                            </TableCell>
                            <TableCell className={uciTableCellClass}>
                              <Button
                                variant="outline"
                                size="sm"
                                className={uciViewRowButtonClass}
                                onClick={() => void openDetail(r.id)}
                              >
                                <Eye className="mr-1 h-4 w-4" />
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent
          overlayClassName="bg-black/45 dark:bg-black/50"
          className={cn(
            "flex w-full max-w-[100vw] flex-col overflow-y-auto sm:max-w-[88vw] lg:max-w-[78vw] xl:max-w-[1280px]",
            "border-cream-sunken bg-cream text-ink-primary-light shadow-2xl",
            "ring-1 ring-cream-sunken/70 dark:ring-teal/25",
            "dark:border-obsidian-strong dark:bg-obsidian-raised dark:text-foreground",
          )}
        >
          <SheetHeader className="text-left sm:text-left">
            <SheetTitle className="text-ink-primary-light dark:text-foreground">Coordination detail</SheetTitle>
            <SheetDescription className="text-ink-primary-light/85 dark:text-muted-foreground">
              {detailProvider?.name ?? "Record"} · child sections are read-only; counts reflect loaded data.
            </SheetDescription>
          </SheetHeader>

          {detailLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-ink-primary-light dark:text-foreground" />
            </div>
          ) : detail && detailRecord ? (
            <div className="mt-6 space-y-6 pb-10">
              <div>
                <p className={cn("mb-1.5 text-xs font-semibold uppercase tracking-wide", uciMutedClass)}>
                  Coordination status
                </p>
                <div
                  className={cn(
                    "grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-cream-sunken/50 bg-cream-raised/40 px-3 py-2 text-xs",
                    "sm:flex sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-1",
                    "dark:border-teal/20 dark:bg-obsidian/30",
                  )}
                >
                  <CoordinationStatusField
                    label="Stage"
                    value={String(detailRecord.current_stage)}
                    mutedClass={uciMutedClass}
                  />
                  <CoordinationStatusField
                    label="State"
                    value={formatLifecycleState(detailRecord.current_stage_state)}
                    mutedClass={uciMutedClass}
                  />
                  <CoordinationStatusField
                    label="Submitted"
                    value={formatDateOnly(detailRecord.application_submitted_at)}
                    mutedClass={uciMutedClass}
                    hideIfEmpty
                  />
                  <CoordinationStatusField
                    label="Acknowledged"
                    value={formatDateOnly(detailRecord.acknowledgment_received_at)}
                    mutedClass={uciMutedClass}
                    hideIfEmpty
                  />
                  <CoordinationStatusField
                    label="COS issued"
                    value={formatDateOnly(detailRecord.class_of_service_issued_at)}
                    mutedClass={uciMutedClass}
                    hideIfEmpty
                  />
                  <CoordinationStatusField
                    label="Energization target"
                    value={formatDateOnly(detailRecord.energization_target_date)}
                    mutedClass={uciMutedClass}
                    hideIfEmpty
                  />
                  {detailRecord.energization_actual_date ? (
                    <CoordinationStatusField
                      label="Energization actual"
                      value={formatDateOnly(detailRecord.energization_actual_date)}
                      mutedClass={uciMutedClass}
                    />
                  ) : null}
                </div>
                {detailRecord.last_error ? (
                  <p className="mt-1.5 text-xs text-destructive">
                    <span className="font-medium">Last error:</span> {detailRecord.last_error}
                  </p>
                ) : null}
              </div>

              {isPepcoCoordination ? (
                <div className="space-y-4">
                  <PepcoPortalHeaderSection
                    detailId={detailId}
                    detailLoading={detailLoading}
                    formatWhen={formatWhen}
                    mutedClass={uciMutedClass}
                    sectionTitleClass={uciManualFormTextClass}
                    pepcoDownloadDocuments={pepcoDownloadDocuments}
                    onPepcoDownloadDocumentsChange={setPepcoDownloadDocuments}
                    pepcoDiscoveryBusy={pepcoDiscoveryBusy}
                    pepcoResumeBusy={pepcoResumeBusy}
                    pepcoDashboardBusy={pepcoDashboardBusy}
                    pepcoAppDetailBusy={pepcoAppDetailBusy}
                    pepcoAppDetailResumeBusy={pepcoAppDetailResumeBusy}
                    pepcoCodeSubmitBusy={pepcoCodeSubmitBusy}
                    pepcoCodeModalOpen={pepcoCodeModalOpen}
                    normalizedSyncBusy={normalizedSyncBusy}
                    pepcoPendingSessionId={pepcoPendingSessionId}
                    pepcoAppDetailPendingSessionId={pepcoAppDetailPendingSessionId}
                    pepcoAppDetailMfaSessionId={pepcoAppDetailMfaSessionId}
                    pepcoDiscoveryMsg={pepcoDiscoveryMsg}
                    pepcoDashboardMsg={pepcoDashboardMsg}
                    pepcoAppDetailMsg={pepcoAppDetailMsg}
                    pepcoDashboardFromMetadata={pepcoDashboardFromMetadata}
                    pepcoApplicationDetailDiscovery={pepcoApplicationDetailDiscovery}
                    hasPepcoDashboardCards={hasPepcoDashboardCards}
                    hasPepcoApplicationDetails={hasPepcoApplicationDetails}
                    onLoginCheck={() => void handlePepcoDiscovery()}
                    onDiscoverDashboard={() => void handlePepcoDashboardDiscover(false)}
                    onResumeInterrupted={handlePepcoResumeInterrupted}
                    onNormalizedSync={() => void handleNormalizedSync()}
                  />

                  <PepcoProjectList
                    projects={pepcoMergedProjects}
                    selectedKey={pepcoSelectedProjectKey}
                    onSelect={handleSelectPepcoProject}
                    onScrapeProject={handleScrapePepcoProject}
                    rowBusyKey={pepcoRowScrapeBusyId}
                    disableScrape={
                      pepcoAppDetailBusy ||
                      pepcoAppDetailResumeBusy ||
                      pepcoCodeSubmitBusy ||
                      pepcoCodeModalOpen ||
                      Boolean(pepcoAppDetailPendingSessionId)
                    }
                    formatWhen={formatWhen}
                    mutedClass={uciMutedClass}
                    sectionTitleClass={uciManualFormTextClass}
                  />

                  {selectedPepcoProject ? (
                    <PepcoSelectedProjectProgress
                      isBusy={isSelectedPepcoProjectBusy}
                      isAwaitingVerification={isSelectedPepcoProjectAwaitingVerification}
                      rowStatus={selectedPepcoProjectRowStatus}
                      project={selectedPepcoProject}
                      mutedClass={uciMutedClass}
                    />
                  ) : null}

                  {!selectedPepcoProject ? (
                    <p className={cn("rounded-md border border-border/60 px-3 py-3 text-xs", uciMutedClass)}>
                      Select a PEPCO project to view its portal details.
                    </p>
                  ) : !selectedPepcoProject.app ? (
                    <div className={cn("rounded-md border border-border/60 px-3 py-4 text-xs", uciMutedClass)}>
                      <p>This project has not been synchronized yet.</p>
                      <p className="mt-1">
                        Use Scrape Details to load status, messages, and documents.
                      </p>
                    </div>
                  ) : (
                    <div className={cn(uciDrawerChildCardClass, uciPepcoDetailTabsWrapperClass, "p-4")}>
                      <PepcoSelectedProjectDetailTabs
                        app={selectedPepcoProject.app}
                        coordinationId={detailId}
                        formatWhen={formatWhen}
                        mutedClass={uciMutedClass}
                        tableHeadClass={uciTableHeadClass}
                        tableCellClass={uciTableCellClass}
                        tableHeaderRowClass={uciTableHeaderRowClass}
                      />
                    </div>
                  )}

                  <PepcoSystemDataSection
                    project={selectedPepcoProject}
                    applications={(detail.applications ?? []) as CoordinationApplication[]}
                    communications={(detail.communications_recent ?? []) as CoordinationCommunication[]}
                    milestones={(detail.milestones ?? []) as CoordinationMilestone[]}
                    formatWhen={formatWhen}
                    mutedClass={uciMutedClass}
                    toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                  />

                  <PepcoDeveloperTools
                    detailId={detailId}
                    mutedClass={uciMutedClass}
                    toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                    manualFormTextClass={uciManualFormTextClass}
                    pepcoAutoEmailMfa={pepcoAutoEmailMfa}
                    onPepcoAutoEmailMfaChange={setPepcoAutoEmailMfa}
                    globalBusy={
                      pepcoDiscoveryBusy ||
                      pepcoResumeBusy ||
                      pepcoDashboardBusy ||
                      pepcoAppDetailBusy ||
                      pepcoAppDetailResumeBusy ||
                      pepcoCodeSubmitBusy ||
                      normalizedSyncBusy ||
                      detailLoading
                    }
                    pepcoPendingSessionId={pepcoPendingSessionId}
                    pepcoAppDetailPendingSessionId={pepcoAppDetailPendingSessionId}
                    pepcoAppDetailMfaSessionId={pepcoAppDetailMfaSessionId}
                    pepcoResumeBusy={pepcoResumeBusy}
                    pepcoAppDetailResumeBusy={pepcoAppDetailResumeBusy}
                    pepcoAppDetailBusy={pepcoAppDetailBusy}
                    pepcoAppDetailProgress={pepcoAppDetailProgress}
                    pepcoDiscoveryMsg={pepcoDiscoveryMsg}
                    pepcoDashboardMsg={pepcoDashboardMsg}
                    pepcoAppDetailMsg={pepcoAppDetailMsg}
                    pepcoDashboardFromMetadata={pepcoDashboardFromMetadata}
                    onResumeLogin={() => void handlePepcoResume()}
                    onResumeApplicationDetail={() => void handlePepcoApplicationDetailResume()}
                  />
                </div>
              ) : null}

              <LifecycleSection
                transitions={detail.transitions ?? []}
                formatWhen={formatWhen}
                mutedClass={uciMutedClass}
                sectionTitleClass={uciSheetSectionTitleClass}
                toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                toStage={toStage}
                onToStageChange={setToStage}
                toState={toState}
                onToStateChange={setToState}
                reason={reason}
                onReasonChange={setReason}
                transitionSaving={transitionSaving}
                onSubmitTransition={() => void handleTransition()}
              />

              {!isPepcoCoordination ? (
                <>
                  <h4 className={cn(uciSheetSectionTitleClass, "mb-2")}>Normalized portal data</h4>

                  <Card className={uciDrawerChildCardClass}>
                    <CardHeader className={uciDrawerChildCardHeaderClass}>
                      <CardTitle className={uciDrawerChildCardTitleClass}>
                        Utility applications
                      </CardTitle>
                      <CardDescription className={cn("text-[11px]", uciMutedClass)}>
                        Provider-neutral rows from portal sync.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-4 py-4">
                      {(detail.applications ?? []).length === 0 ? (
                        <p className={uciDrawerChildEmptyClass}>
                          No normalized application rows yet. Run application detail scrape or re-sync.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {(detail.applications as CoordinationApplication[]).map((app) => (
                            <div key={app.id} className={uciTransitionCardClass}>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary">Read-only portal record</Badge>
                                {app.record_source === "agent_draft" ? (
                                  <Badge variant="outline">Agent draft</Badge>
                                ) : null}
                                {app.action_required ? (
                                  <Badge variant="destructive">Action required</Badge>
                                ) : null}
                              </div>
                              <p className="mt-2 font-medium text-foreground">
                                {app.portal_status || "Unknown status"}
                                {app.portal_milestone ? ` · ${app.portal_milestone}` : ""}
                              </p>
                              <p className={cn("mt-1 text-xs", uciMutedClass)}>
                                Provider {app.provider_slug || "—"} · Job {app.external_job_id || "—"}
                              </p>
                              <p className={cn("mt-1 font-mono text-[11px]", uciMutedClass)}>
                                {app.external_application_id || "—"}
                              </p>
                              <p className={cn("mt-1 text-xs tabular-nums", uciMutedClass)}>
                                Last synced {formatWhen(app.last_synced_at)} · Portal updated{" "}
                                {formatWhen(app.portal_last_updated_at)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className={uciDrawerChildCardClass}>
                    <CardHeader className={uciDrawerChildCardHeaderClass}>
                      <CardTitle className={uciDrawerChildCardTitleClass}>Communications</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 py-4">
                      {(detail.communications_recent ?? []).length === 0 ? (
                        <p className={uciDrawerChildEmptyClass}>No portal communications yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {(detail.communications_recent as CoordinationCommunication[]).map((comm) => (
                            <div key={comm.id} className={uciTransitionCardClass}>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{comm.direction || "—"}</Badge>
                                <Badge variant="secondary">{comm.channel || "message"}</Badge>
                                {comm.needs_human_attention ? (
                                  <Badge variant="destructive">Needs attention</Badge>
                                ) : null}
                              </div>
                              <p className="mt-2 font-medium text-foreground">
                                {comm.raw_subject || "(no subject)"}
                              </p>
                              {comm.raw_body ? (
                                <p className={cn("mt-1 text-sm", uciMutedClass)}>{comm.raw_body}</p>
                              ) : null}
                              <p className={cn("mt-1 text-xs tabular-nums", uciMutedClass)}>
                                {formatWhen(comm.message_timestamp || comm.created_at)}
                                {comm.sender ? ` · ${comm.sender}` : ""}
                                {comm.recipient ? ` → ${comm.recipient}` : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className={uciDrawerChildCardClass}>
                    <CardHeader className={uciDrawerChildCardHeaderClass}>
                      <CardTitle className={uciDrawerChildCardTitleClass}>
                        Portal status history
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 py-4">
                      {(() => {
                        const portalEvents = (detail.milestones as CoordinationMilestone[]).filter(
                          (m) => m.milestone_type === "portal_status_event",
                        );
                        if (portalEvents.length === 0) {
                          return (
                            <p className={uciDrawerChildEmptyClass}>
                              No portal status events yet.
                            </p>
                          );
                        }
                        return (
                          <div className="space-y-2">
                            {portalEvents.map((m) => (
                              <div key={m.id} className={uciTransitionCardClass}>
                                <p className="font-medium text-foreground">
                                  {m.portal_status || "—"}
                                  {m.portal_milestone ? ` · ${m.portal_milestone}` : ""}
                                </p>
                                <p className={cn("mt-1 text-xs tabular-nums", uciMutedClass)}>
                                  {formatWhen(m.occurred_at || m.actual_date)}
                                </p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </>
              ) : null}

              <CostsEquipmentSection
                costs={(detail.costs ?? []) as unknown[]}
                equipment={(detail.equipment ?? []) as unknown[]}
                childCardClass={uciDrawerChildCardClass}
                childCardHeaderClass={uciDrawerChildCardHeaderClass}
                childCardTitleClass={uciDrawerChildCardTitleClass}
                childCountClass={uciDrawerChildCountClass}
                mutedClass={uciMutedClass}
              />
            </div>
          ) : (
            <p className="mt-6 text-sm font-medium text-ink-primary-light dark:text-foreground">
              No detail loaded.
            </p>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={pepcoCodeModalOpen}
        onOpenChange={(open) => {
          setPepcoCodeModalOpen(open);
          if (!open) {
            setPepcoCodeModalError(null);
            if (pepcoCodeInputRef.current) pepcoCodeInputRef.current.value = "";
          }
        }}
      >
        <DialogContent
          className={cn(
            "border-cream-sunken bg-cream text-ink-primary-light",
            "dark:border-teal/25 dark:bg-obsidian-raised dark:text-foreground",
          )}
        >
          <DialogHeader>
            <DialogTitle className="text-ink-primary-light dark:text-foreground">
              Enter PEPCO verification code
            </DialogTitle>
            <DialogDescription className="text-ink-primary-light/85 dark:text-muted-foreground">
              {pepcoCodeModalTarget === "application_detail"
                ? "Enter the PEPCO verification code sent by email. PermitPilot will continue the application detail scrape."
                : "A verification code was sent to the PEPCO mailbox. Paste it here and PermitPilot will continue the dashboard discovery."}
            </DialogDescription>
          </DialogHeader>
          {pepcoCodeModalError ? (
            <p className="text-sm text-destructive">{pepcoCodeModalError}</p>
          ) : null}
          <Input
            ref={pepcoCodeInputRef}
            maxLength={8}
            inputMode="numeric"
            autoComplete="one-time-code"
            className={uciSheetControlClass}
            placeholder="Code from email"
            aria-label="PEPCO verification code"
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className={uciToolbarOutlineButtonClass}
              disabled={pepcoCodeSubmitBusy}
              onClick={() => setPepcoCodeModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-teal hover:bg-teal/90 text-white"
              disabled={
                pepcoCodeSubmitBusy ||
                (pepcoCodeModalTarget === "application_detail"
                  ? !pepcoAppDetailMfaSessionId
                  : !pepcoDashboardMfaSessionId)
              }
              aria-busy={pepcoCodeSubmitBusy}
              onClick={() =>
                void (pepcoCodeModalTarget === "application_detail"
                  ? handleSubmitPepcoApplicationDetailCode()
                  : handleSubmitPepcoDashboardCode())
              }
            >
              {pepcoCodeSubmitBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Submit Code &amp; Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CoordinationStatusField({
  label,
  value,
  mutedClass,
  hideIfEmpty,
}: {
  label: string;
  value: string;
  mutedClass: string;
  hideIfEmpty?: boolean;
}) {
  if (hideIfEmpty && (!value || value === "—")) return null;
  return (
    <div className="min-w-0">
      <p className={cn("text-[10px] uppercase tracking-wide", mutedClass)}>{label}</p>
      <p className="text-xs font-medium text-foreground">{value}</p>
    </div>
  );
}

/** Compact progress indicator for the currently selected PEPCO project only. */
function PepcoSelectedProjectProgress({
  isBusy,
  isAwaitingVerification,
  rowStatus,
  project,
  mutedClass,
}: {
  isBusy: boolean;
  isAwaitingVerification: boolean;
  rowStatus: { status: "ok" | "error"; message?: string } | undefined;
  project: PepcoMergedProject;
  mutedClass: string;
}) {
  const [showTechnical, setShowTechnical] = useState(false);

  if (isAwaitingVerification) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
        <p className="font-semibold">Verification required</p>
        <p className="mt-0.5 opacity-90">
          Enter the PEPCO verification code to continue syncing {project.title}.
        </p>
      </div>
    );
  }

  if (isBusy) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>Syncing {project.title}…</span>
      </div>
    );
  }

  if (rowStatus?.status === "error") {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <p className="font-semibold">Project sync failed</p>
        {rowStatus.message ? <p className="mt-0.5 opacity-90">{rowStatus.message}</p> : null}
      </div>
    );
  }

  if (!project.app) return null;

  return (
    <div className="text-xs text-foreground">
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-medium">
          Project sync {project.app.scrapeStatus === "partial" ? "partially completed" : "completed"}
        </span>
        <span className={mutedClass}>
          · {project.statusUpdateCount} status update{project.statusUpdateCount === 1 ? "" : "s"} ·{" "}
          {project.messageCount} message{project.messageCount === 1 ? "" : "s"} · {project.documentCount}{" "}
          document{project.documentCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className="text-[11px] font-medium text-muted-foreground underline underline-offset-2"
          onClick={() => setShowTechnical((v) => !v)}
        >
          {showTechnical ? "Hide technical details" : "View technical details"}
        </button>
      </p>
      {showTechnical ? (
        <div
          className={cn(
            "mt-1.5 space-y-0.5 rounded-md border border-border/40 bg-muted/15 px-2 py-1.5 font-mono text-[10px]",
            mutedClass,
          )}
        >
          <p>Application UUID: {project.applicationUuid ?? "—"}</p>
          <p>Scrape status: {project.app.scrapeStatus ?? "—"}</p>
          <p>Scraped at: {project.lastScrapedAt ?? "—"}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Compact card/row styling used only inside System Data (technical, collapsed content). */
const uciSystemDataGroupClass = cn(
  "overflow-hidden rounded-md border border-border/50 bg-muted/15",
  "dark:border-teal/20 dark:bg-obsidian/35",
);
const uciSystemDataGroupHeaderClass = cn(
  "border-b border-border/30 bg-muted/10 px-2.5 py-1",
  "dark:border-teal/15 dark:bg-obsidian/45",
);
const uciSystemDataRowClass = cn(
  "rounded-md border border-border/40 bg-background/50 p-2 text-xs",
  "dark:border-teal/15 dark:bg-obsidian/25",
);

const COMMUNICATION_PREVIEW_LIMIT = 160;

/** Communication row with a truncated body preview and an expand toggle for long text. */
function CommunicationPreviewRow({
  comm,
  formatWhen,
  mutedClass,
}: {
  comm: CoordinationCommunication;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = comm.raw_body?.trim() || null;
  const isLong = Boolean(body && body.length > COMMUNICATION_PREVIEW_LIMIT);

  return (
    <div className={uciSystemDataRowClass}>
      <p className="font-medium text-foreground">{comm.raw_subject || "(no subject)"}</p>
      <p className={cn("mt-0.5 text-[11px] tabular-nums", mutedClass)}>
        {formatWhen(comm.message_timestamp || comm.created_at)}
      </p>
      {body ? (
        <p className={cn("mt-1 leading-snug text-foreground/90", !expanded && "line-clamp-2")}>
          {body}
        </p>
      ) : null}
      {isLong ? (
        <button
          type="button"
          className="mt-1 text-[11px] font-medium text-primary underline underline-offset-2"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "View full message"}
        </button>
      ) : null}
    </div>
  );
}

/** Normalized rows filtered to the selected PEPCO project only; collapsed by default. */
function PepcoSystemDataSection({
  project,
  applications,
  communications,
  milestones,
  formatWhen,
  mutedClass,
  toolbarOutlineButtonClass,
}: {
  project: PepcoMergedProject | null;
  applications: CoordinationApplication[];
  communications: CoordinationCommunication[];
  milestones: CoordinationMilestone[];
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
}) {
  const [open, setOpen] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  const matchId = project?.applicationUuid ?? project?.applicationId ?? null;
  const filteredApplications = matchId
    ? applications.filter((a) => a.external_application_id === matchId)
    : [];
  const filteredCommunications = matchId
    ? communications.filter((c) => c.external_application_id === matchId)
    : [];
  const portalEvents = matchId
    ? milestones.filter(
        (m) => m.milestone_type === "portal_status_event" && m.external_application_id === matchId,
      )
    : [];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 w-full justify-between px-2", toolbarOutlineButtonClass)}
          aria-expanded={open}
        >
          <span className="text-sm font-semibold">System Data</span>
          <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {!project ? (
          <p className={cn("rounded-md border border-border/60 px-3 py-3 text-xs", mutedClass)}>
            Select a PEPCO project to view its normalized system data.
          </p>
        ) : (
          <>
            <div className={uciSystemDataGroupClass}>
              <div className={uciSystemDataGroupHeaderClass}>
                <p className="text-xs font-semibold text-foreground">Utility application</p>
              </div>
              <div className="p-2">
                {filteredApplications.length === 0 ? (
                  <p className={cn("px-1 py-1 text-xs", mutedClass)}>
                    No normalized application row yet for this project.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {filteredApplications.map((app) => (
                      <div key={app.id} className={uciSystemDataRowClass}>
                        <p className="font-medium text-foreground">
                          {app.portal_status || "Unknown status"}
                          {app.portal_milestone ? ` · ${app.portal_milestone}` : ""}
                        </p>
                        <p className={cn("mt-0.5 text-[11px] tabular-nums", mutedClass)}>
                          Last synced {formatWhen(app.last_synced_at)} · Portal updated{" "}
                          {formatWhen(app.portal_last_updated_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={uciSystemDataGroupClass}>
              <div className={uciSystemDataGroupHeaderClass}>
                <p className="text-xs font-semibold text-foreground">Communications</p>
              </div>
              <div className="p-2">
                {filteredCommunications.length === 0 ? (
                  <p className={cn("px-1 py-1 text-xs", mutedClass)}>
                    No portal communications yet for this project.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {filteredCommunications.map((comm) => (
                      <CommunicationPreviewRow
                        key={comm.id}
                        comm={comm}
                        formatWhen={formatWhen}
                        mutedClass={mutedClass}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={uciSystemDataGroupClass}>
              <div className={uciSystemDataGroupHeaderClass}>
                <p className="text-xs font-semibold text-foreground">Portal status events</p>
              </div>
              <div className="p-2">
                {portalEvents.length === 0 ? (
                  <p className={cn("px-1 py-1 text-xs", mutedClass)}>
                    No portal status events yet for this project.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {portalEvents.map((m) => (
                      <div key={m.id} className={uciSystemDataRowClass}>
                        <p className="font-medium text-foreground">
                          {m.portal_status || "—"}
                          {m.portal_milestone ? ` · ${m.portal_milestone}` : ""}
                        </p>
                        <p className={cn("mt-0.5 text-[11px] tabular-nums", mutedClass)}>
                          {formatWhen(m.occurred_at || m.actual_date)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              className="text-[11px] font-medium text-muted-foreground underline underline-offset-2"
              onClick={() => setShowTechnical((v) => !v)}
            >
              {showTechnical ? "Hide technical details" : "Technical details"}
            </button>
            {showTechnical ? (
              <div className="space-y-1 rounded-md border border-border/50 bg-background/50 p-2 font-mono text-[10px] text-muted-foreground">
                <p>Application UUID: {project.applicationUuid ?? "—"}</p>
                <p>Application ID: {project.applicationId ?? "—"}</p>
                <p>Coordination record ID: {filteredApplications[0]?.coordination_record_id ?? "—"}</p>
                <p>Project ID: {filteredApplications[0]?.project_id ?? "—"}</p>
              </div>
            ) : null}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Compact lifecycle timeline plus the manual stage-update form; collapsed by
 * default to keep the main workflow uncluttered. When opened, the transition
 * summary is shown directly; the manual update form stays nested under its
 * own "Update stage" toggle (collapsed by default) so it's never permanently
 * expanded.
 */
function LifecycleSection({
  transitions,
  formatWhen,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
  toStage,
  onToStageChange,
  toState,
  onToStateChange,
  reason,
  onReasonChange,
  transitionSaving,
  onSubmitTransition,
}: {
  transitions: Array<{
    id: string;
    from_stage: number | null;
    to_stage: number;
    to_state: LifecycleState;
    triggered_by_type: string | null;
    reason: string | null;
    created_at: string;
  }>;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  sectionTitleClass: string;
  toolbarOutlineButtonClass: string;
  toStage: string;
  onToStageChange: (value: string) => void;
  toState: LifecycleState;
  onToStateChange: (value: LifecycleState) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  transitionSaving: boolean;
  onSubmitTransition: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 w-full justify-between px-2", toolbarOutlineButtonClass)}
          aria-expanded={open}
        >
          <span className={sectionTitleClass}>Lifecycle</span>
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            {transitions.length} transition{transitions.length === 1 ? "" : "s"}
            <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} />
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        <div className="space-y-1.5">
          {transitions.length === 0 ? (
            <p className="text-sm font-medium text-ink-primary-light/90 dark:text-foreground/90">
              No transitions yet.
            </p>
          ) : (
            transitions.map((t) => {
              const isSystem = String(t.triggered_by_type ?? "").toLowerCase() === "system";
              return (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-md border-l-2 px-3 py-1.5 text-xs",
                    isSystem
                      ? "border-l-border/50 bg-muted/15 text-muted-foreground"
                      : "border-l-teal/50 bg-cream-raised/40 text-foreground dark:bg-obsidian/35",
                  )}
                >
                  <p className={cn("font-medium", isSystem ? "italic" : "")}>
                    Stage {t.from_stage ?? "—"} → {t.to_stage} · {formatLifecycleState(t.to_state)}
                  </p>
                  <p className={cn("mt-0.5", mutedClass)}>
                    {isSystem ? "System" : t.triggered_by_type ?? "User"}
                    {t.reason ? ` · ${t.reason}` : ""} · {formatWhen(t.created_at)}
                  </p>
                </div>
              );
            })
          )}
        </div>

        <Collapsible open={updateOpen} onOpenChange={setUpdateOpen}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("h-7 w-full justify-between px-2 text-xs", toolbarOutlineButtonClass)}
              aria-expanded={updateOpen}
            >
              <span>Update stage</span>
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", updateOpen && "rotate-90")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className={cn(uciInsetPanelClass, "mt-2 p-3", uciManualFormTextClass)}>
            <div className="grid gap-3">
              <div className="grid gap-1">
                <Label htmlFor="uci-to-stage" className={cn("text-xs", uciManualFormTextClass)}>
                  To stage (1–10)
                </Label>
                <Select value={toStage} onValueChange={onToStageChange}>
                  <SelectTrigger id="uci-to-stage" className={uciSheetControlClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="uci-to-state" className={cn("text-xs", uciManualFormTextClass)}>
                  To state
                </Label>
                <Select value={toState} onValueChange={(v) => onToStateChange(v as LifecycleState)}>
                  <SelectTrigger id="uci-to-state" className={uciSheetControlClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIFECYCLE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {formatLifecycleState(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="uci-reason" className={cn("text-xs", uciManualFormTextClass)}>
                  Reason (required)
                </Label>
                <Textarea
                  id="uci-reason"
                  placeholder="Why is the stage changing?"
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value)}
                  rows={3}
                  className={uciSheetControlClass}
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="bg-teal hover:bg-teal/90 text-white"
                disabled={transitionSaving}
                aria-busy={transitionSaving}
                onClick={onSubmitTransition}
              >
                {transitionSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Update stage
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Costs and equipment are consolidated: when both are empty they render as
 * one compact muted "Not available yet" section instead of two large empty
 * cards. Populated sections still render normally; the missing counterpart
 * is represented as a compact note rather than hidden entirely.
 */
function CostsEquipmentSection({
  costs,
  equipment,
  childCardClass,
  childCardHeaderClass,
  childCardTitleClass,
  childCountClass,
  mutedClass,
}: {
  costs: unknown[];
  equipment: unknown[];
  childCardClass: string;
  childCardHeaderClass: string;
  childCardTitleClass: string;
  childCountClass: string;
  mutedClass: string;
}) {
  const sections = [
    { key: "costs", label: "Costs", rows: costs },
    { key: "equipment", label: "Equipment", rows: equipment },
  ] as const;
  const hasAnyData = sections.some((s) => s.rows.length > 0);

  if (!hasAnyData) {
    return (
      <div className={cn("rounded-lg border border-border/50 bg-muted/15 px-3 py-3 text-xs", mutedClass)}>
        <p className="font-medium text-foreground">Not available yet</p>
        <p className="mt-0.5 leading-snug">
          Costs and equipment data have not been added for this coordination record.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sections.map((section) =>
        section.rows.length > 0 ? (
          <Card key={section.key} className={childCardClass}>
            <CardHeader className={childCardHeaderClass}>
              <CardTitle className={childCardTitleClass}>{section.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3">
              <p className={childCountClass}>{section.rows.length} row(s)</p>
            </CardContent>
          </Card>
        ) : (
          <p
            key={section.key}
            className={cn("rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-[11px]", mutedClass)}
          >
            {section.label}: Not available yet.
          </p>
        ),
      )}
    </div>
  );
}
