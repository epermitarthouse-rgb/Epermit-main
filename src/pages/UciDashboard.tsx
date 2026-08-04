import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader, AlertBanner, MetricCard, Panel, ServicePill } from "@/components/design/ProductPrimitives";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useProjects } from "@/hooks/useProjects";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import {
  analyzeCoordinationLoadProfile,
  addCoordinationManualVerifiedValue,
  applyLifecycleProposal,
  analyzeCoordinationCos,
  buildCoordinationApplicationPackage,
  checkInCoordinationEquipment,
  classifyCoordinationCommunications,
  confirmApplicationPackageDocumentMapping,
  createCoordinationEquipment,
  extractCoordinationLoadCandidates,
  importCoordinationDocumentFindings,
  formatLoadCandidateExtractionError,
  formatUciUserError,
  getCoordinationDetail,
  getProjectPortfolioView,
  getProjectProviderSetup,
  getProjectProviderResolution,
  resolveProjectProviderResolution,
  confirmProjectProviderResolution,
  overrideProjectProviderResolution,
  initProjectCoordination,
  isUciSessionExpiredError,
  listApplicationPackageDocumentCandidates,
  listCoordinationSyncRuns,
  listProjectCoordination,
  listUciProviders,
  postPepcoDashboardDiscovery,
  postPepcoDiscovery,
  postPepcoApplicationDetailDiscovery,
  prepareCloseout,
  prepareMeterSet,
  rejectLifecycleProposal,
  removeApplicationPackageDocumentMapping,
  reclassifyCommunication,
  resolveCoordinationLoadCandidate,
  resumePepcoApplicationDetailDiscovery,
  resumePepcoDiscovery,
  reviewCoordinationApplication,
  submitCoordinationApplication,
  submitPepcoMfaCode,
  transitionCoordination,
  triggerCoordinationSync,
  upsertCoordinationCost,
  UCI_SESSION_EXPIRED_MESSAGE,
  UCI_SYNC_RUN_STORAGE_PREFIX,
} from "@/lib/uciApi";
import { getMicrosoftMailboxStatus } from "@/lib/microsoftMailboxApi";
import { toast } from "sonner";
import {
  ChevronRight,
  Info,
  Loader2,
  Plus,
  RadioTower,
  RefreshCw,
  Eye,
  AlertTriangle,
  Layers,
  ListChecks,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  logUciProjectDataEvent,
  shouldApplyProjectScopedResponse,
} from "@/lib/uciProjectScopedRequest";
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
  UciNormalizedSyncResult,
  UciProviderSetupAddressSource,
  UciProviderSetupResponse,
  UciProviderResolutionListResponse,
  UciRecordDetailResponse,
  UciPortfolioViewResponse,
  UciPortalSyncRun,
  UciPortalSyncResponse,
  UtilityProvider,
} from "@/types/uci";
import {
  normalizedSyncDrawerMessage,
  notifyNormalizedSyncResult,
  portalSyncResponseToNormalizedResult,
} from "@/lib/uciNormalizedSync";
import {
  getLifecycleProposalsFromMetadata,
  selectDisplayLifecycleProposal,
  computeLifecycleProposalChecksum,
  getProviderMappingFromMetadata,
} from "@/lib/uciLifecycleProposals";
import {
  CommunicationReclassifyRow,
  CosAnalysisPanel,
  CostsEquipmentWorkflowPanel,
  LifecycleProposalActions,
  MeterSetCloseoutPanel,
  ProviderMappingBanner,
  SyncRunsPanel,
  useSyncRunPolling,
} from "@/components/uci/UciD13WorkflowPanels";
import { LoadProfileWorkspace } from "@/components/uci/LoadProfileWorkspace";
import { UciDocumentCoveragePanel } from "@/components/uci/UciDocumentCoveragePanel";
import { UciComingSoonPanel } from "@/components/uci/UciComingSoonPanel";
import {
  getUciNavSection,
  isUciDrawerTab,
  UCI_DRAWER_TABS,
  type UciDrawerTab,
} from "@/lib/uciNavSections";
import {
  getLoadProfileDraftApplication,
} from "@/lib/uciLoadProfile";
import {
  applicationPackageStatusTone,
  canSubmitApplication,
  formatApplicationPackageStatus,
  formatDraftStatus,
  formatPackageDocumentSource,
  formatSuggestionConfidence,
  getApplicationPackageDraftApplication,
  parseApplicationPackageMetadata,
  parsePackageDocuments,
  type UciPackageDocumentCandidate,
  type UciPackageDocumentCandidatesResponse,
} from "@/lib/uciApplicationPrep";
import { UciSetupWorkflow } from "@/components/uci/UciSetupWorkflow";
import { UciProjectContextBar } from "@/components/uci/UciProjectContextBar";
import {
  buildInitializedSlugSet,
  countSelectedProviders,
  deriveAddressPresentation,
  getInitDisabledReasons,
  providerDisplayLabel as workflowProviderDisplayLabel,
} from "@/lib/uciSetupWorkflow";
import {
  classificationNeedsAttention,
  formatCommunicationClassification,
} from "@/lib/uciCommunicationClassifier";

const LIFECYCLE_OPTIONS: LifecycleState[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_UTILITY",
  "BLOCKED",
  "ESCALATED",
  "COMPLETED",
];

const STAGE_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

/** Pilot-card surface for UciSetupWorkflow (replaces editorial cream card). */
const UCI_SETUP_CARD_CLASS =
  "pilot-card border-border bg-card text-card-foreground shadow-sm";

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
        "shadow-sm !border-transparent !bg-muted !text-foreground dark:!bg-muted dark:!text-foreground",
      );
    case "IN_PROGRESS":
      return cn("!border-transparent !bg-teal !text-white shadow-sm dark:!bg-teal dark:!text-white");
    case "AWAITING_UTILITY":
      return cn(
        "!border-transparent !bg-primary/10 !font-semibold !text-foreground shadow-sm",
        "dark:!bg-gold dark:!text-foreground",
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
        "dark:!bg-card dark:!text-foreground",
      );
  }
}

/** Readable headings on card surfaces (overrides default `text-card-foreground`) */
const uciSectionTitleClass =
  "font-display text-2xl font-normal tracking-tight text-foreground !text-foreground";

/** Secondary line on card surfaces */
const uciMutedClass = "text-muted-foreground";

/** Detail sheet metadata labels (stage, dates, energization) — above body secondary tone */
const uciDetailLabelClass = "font-semibold text-foreground !text-foreground";

/** Detail sheet values beside labels */
const uciDetailValueClass = "font-medium text-foreground";

/** Force readable body cells (Table defaults use theme foreground / card-foreground) */
const uciTableCellClass =
  "!font-medium !text-foreground p-4 align-middle dark:!text-foreground";

const uciTableHeadClass =
  "!text-foreground h-12 px-4 text-left align-middle text-xs font-bold uppercase tracking-wider dark:!text-foreground";

const uciTableHeaderRowClass =
  "[&_tr]:border-border/50 [&_tr]:bg-muted/30 dark:[&_tr]:border-teal/20 dark:[&_tr]:bg-muted/55";

/** Unified subsection titles in sheet (Transitions, Manual update, child CardTitle) */
const uciSheetSectionTitleClass =
  "font-display text-base font-semibold capitalize tracking-tight !text-foreground dark:!text-foreground";

/** Inset panels: manual form wrapper only. */
const uciInsetPanelClass = cn(
  "overflow-hidden rounded-lg border shadow-sm",
  "border-teal/20 bg-card/90 ring-1 ring-border/40",
  "dark:border-teal/30 dark:bg-card/95 dark:ring-1 dark:ring-gold/20",
);

/** Transition history rows: light card in light mode, dark raised in dark mode */
const uciTransitionCardClass = cn(
  "overflow-hidden rounded-lg border p-3 text-xs shadow-sm",
  "border-border/60 bg-muted/40 text-foreground ring-1 ring-border/40",
  "dark:border-teal/35 dark:bg-card/95 dark:ring-gold/20",
);

/** Drawer read-only child sections: light card in light mode, dark navy in dark mode */
const uciDrawerChildCardClass = cn(
  "overflow-hidden rounded-xl border text-foreground shadow-sm",
  "border-border/60 bg-muted/30 ring-1 ring-border/30",
  "dark:border-teal/35 dark:bg-card/90 dark:ring-gold/25",
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
  "dark:border-teal/25 dark:bg-muted/50",
);

const uciDrawerChildCardTitleClass =
  "font-display text-base font-semibold capitalize tracking-tight text-foreground";

const uciDrawerChildEmptyClass = "text-sm text-muted-foreground";
const uciDrawerChildCountClass = "text-sm font-medium text-foreground";

const uciViewRowButtonClass = cn(
  "border-teal/35 bg-white/70 text-foreground shadow-sm",
  "hover:border-teal/55 hover:bg-teal/8 hover:text-teal dark:border-teal/40",
  "dark:bg-muted/45 dark:text-foreground dark:hover:bg-teal/15 dark:hover:text-foreground",
);

/** Toolbar/outline actions (Refresh + View row button family) */
const uciToolbarOutlineButtonClass = uciViewRowButtonClass;

/** Select + textarea in sheet manual form — match card surface (no bg-background seam). */
const uciSheetControlClass = cn(
  "border-border bg-background text-foreground",
  "dark:border-teal/25 dark:bg-card dark:text-foreground",
);

/** Manual stage update / compact section labels on inset panel (overrides sheet inherit). */
const uciManualFormTextClass = "text-foreground dark:text-foreground";

export default function UciDashboard() {
  const { projects, loading: projectsLoading } = useProjects();
  const { user, loading: authLoading } = useAuth();
  /**
   * The app-wide active-project selection (header ActiveProjectControl,
   * persisted across pages via localStorage/URL). Used only to seed the
   * initial value below so landing on /uci with an already-selected
   * project immediately shows the hub for that project, instead of
   * forcing re-selection inside the UCI setup form. UCI keeps its own
   * local projectId afterward (see the generation/reset effect below) —
   * this is a one-way hydration + best-effort outward sync, not a full
   * state merge, to avoid disturbing the existing project-switch-safety
   * logic already built around local state.
   */
  const globalSelectedProject = useSelectedProjectOptional();

  const [providers, setProviders] = useState<UtilityProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersLoadError, setProvidersLoadError] = useState<string | null>(null);
  const [tenantScopeId, setTenantScopeId] = useState<string | null>(null);
  const [projectId, setProjectIdState] = useState<string | null>(
    () => globalSelectedProject?.selectedProjectId ?? null,
  );
  const setProjectId = useCallback(
    (id: string | null) => {
      setProjectIdState(id);
      globalSelectedProject?.setSelectedProjectId(id);
    },
    [globalSelectedProject],
  );
  const [records, setRecords] = useState<CoordinationRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [initPick, setInitPick] = useState<Record<string, boolean>>({});
  const [initting, setInitting] = useState(false);
  const [providerSetup, setProviderSetup] = useState<UciProviderSetupResponse | null>(null);
  const [providerSetupLoading, setProviderSetupLoading] = useState(false);
  const [providerResolution, setProviderResolution] = useState<UciProviderResolutionListResponse | null>(
    null,
  );
  const [providerResolutionLoading, setProviderResolutionLoading] = useState(false);
  const [providerResolutionActionLoading, setProviderResolutionActionLoading] = useState(false);
  const [providerSetupConfirmed, setProviderSetupConfirmed] = useState(false);
  const [addressSourceAcknowledged, setAddressSourceAcknowledged] =
    useState<UciProviderSetupAddressSource | null>(null);
  const [unresolvedUtilityTypes, setUnresolvedUtilityTypes] = useState<string[]>([]);
  const [providerUtilityFilter, setProviderUtilityFilter] = useState<string>("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [drawerTab, setDrawerTab] = useState<UciDrawerTab>("overview");
  const navigate = useNavigate();
  const [setupSectionExpanded, setSetupSectionExpanded] = useState(true);
  const [projectSwitchConfirmOpen, setProjectSwitchConfirmOpen] = useState(false);
  const projectDataGenerationRef = useRef(0);
  const currentProjectIdRef = useRef<string | null>(null);
  /** Blocks ?coordination= hydration briefly after an intentional drawer close (URL update race). */
  const suppressCoordinationHydrationRef = useRef(false);
  const sectionParam = searchParams.get("section");
  const coordinationParam = searchParams.get("coordination");
  const tabParam = searchParams.get("tab");
  const activeNavSection = getUciNavSection(sectionParam);

  const shouldApplyProjectResponse = useCallback(
    (generation: number, requestedProjectId: string | null) =>
      shouldApplyProjectScopedResponse(
        generation,
        requestedProjectId,
        projectDataGenerationRef.current,
        currentProjectIdRef.current,
      ),
    [],
  );

  const providerCatalogTypes = useMemo(() => {
    const types = new Set(
      providers
        .map((p) => p.utility_type?.trim().toLowerCase())
        .filter(Boolean) as string[],
    );
    return [...types].sort();
  }, [providers]);

  const providerDisplayLabel = useCallback(
    (provider: UtilityProvider) => workflowProviderDisplayLabel(provider),
    [],
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UciRecordDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [toStage, setToStage] = useState<string>("1");
  const [toState, setToState] = useState<LifecycleState>("IN_PROGRESS");
  const [reason, setReason] = useState("");
  const [transitionSaving, setTransitionSaving] = useState(false);
  const [loadProfileBusy, setLoadProfileBusy] = useState(false);
  const [loadCandidateBusy, setLoadCandidateBusy] = useState(false);
  const [importFindingsBusy, setImportFindingsBusy] = useState(false);
  const [loadCandidateResolveBusy, setLoadCandidateResolveBusy] = useState<string | null>(null);
  const [manualVerifyBusy, setManualVerifyBusy] = useState(false);
  const [applicationPrepBusy, setApplicationPrepBusy] = useState(false);
  const [applicationReviewBusy, setApplicationReviewBusy] = useState(false);
  const [applicationReviewNotes, setApplicationReviewNotes] = useState("");
  const [applicationSubmitBusy, setApplicationSubmitBusy] = useState(false);
  const [classifyCommsBusy, setClassifyCommsBusy] = useState(false);
  const [reclassifyCommId, setReclassifyCommId] = useState<string | null>(null);
  const [lifecycleProposalBusy, setLifecycleProposalBusy] = useState(false);
  const [cosBusy, setCosBusy] = useState(false);
  const [cosError, setCosError] = useState<string | null>(null);
  const [agentOpsBusy, setAgentOpsBusy] = useState(false);
  const [agentOpsError, setAgentOpsError] = useState<string | null>(null);
  const [meterSetBusy, setMeterSetBusy] = useState(false);
  const [closeoutBusy, setCloseoutBusy] = useState(false);
  const [portfolio, setPortfolio] = useState<UciPortfolioViewResponse | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [normalizedSyncBusy, setNormalizedSyncBusy] = useState(false);
  const [pepcoLastNormalizedSync, setPepcoLastNormalizedSync] = useState<UciNormalizedSyncResult | null>(
    null,
  );

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
    setProvidersLoadError(null);
    try {
      const res = await listUciProviders(projectId ?? undefined);
      setProviders(res.providers ?? []);
      setTenantScopeId(res.tenant_id ?? null);
      setInitPick((prev) => {
        const next: Record<string, boolean> = { ...prev };
        for (const p of res.providers ?? []) {
          if (next[p.slug] === undefined) next[p.slug] = false;
        }
        return next;
      });
    } catch (e: unknown) {
      const message = formatUciUserError(e, "Failed to load providers");
      setProvidersLoadError(message);
      setProviders([]);
      toast.error(message);
    } finally {
      setProvidersLoading(false);
    }
  }, [authLoading, user?.id, projectId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) {
      setProvidersLoading(false);
      return;
    }
    void loadProviders();
  }, [authLoading, user?.id, loadProviders]);

  /**
   * Project/tenant safety: increment generation and clear transient UI state when
   * the selected project changes. Must be declared before project-scoped loaders
   * so load effects capture the current generation (not one that is immediately invalidated).
   */
  useEffect(() => {
    currentProjectIdRef.current = projectId;
    projectDataGenerationRef.current += 1;
    const generation = projectDataGenerationRef.current;
    logUciProjectDataEvent("generation_created", { projectId, generation });
    logUciProjectDataEvent("project_selected", { projectId, generation });

    setDetailOpen(false);
    setDetailId(null);
    setDetail(null);
    setDrawerTab("overview");
    setSearchParams(
      (prev) => {
        if (!prev.get("coordination") && !prev.get("tab")) return prev;
        const next = new URLSearchParams(prev);
        next.delete("coordination");
        next.delete("tab");
        return next;
      },
      { replace: true },
    );
    setInitPick({});
    setProviderSetupConfirmed(false);
    setAddressSourceAcknowledged(null);
    setUnresolvedUtilityTypes([]);
    setProviderUtilityFilter("all");
    setProviderResolution(null);
    setProviderSetup(null);
    setPortfolio(null);
    setSetupSectionExpanded(true);
    setReason("");
    setApplicationReviewNotes("");
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
    setPepcoLastNormalizedSync(null);

    if (projectId) {
      setProviderSetupLoading(true);
      setProviderResolutionLoading(true);
      setRecordsLoading(true);
    } else {
      setProviderSetupLoading(false);
      setProviderResolutionLoading(false);
      setRecordsLoading(false);
      setRecords([]);
    }
  }, [projectId]);

  const refreshCoordination = useCallback(async () => {
    if (authLoading || !user?.id) return;
    if (!projectId) {
      setRecords([]);
      setRecordsLoading(false);
      return;
    }
    const generation = projectDataGenerationRef.current;
    const requestedProjectId = projectId;
    setRecordsLoading(true);
    logUciProjectDataEvent("request_started", {
      projectId: requestedProjectId,
      generation,
      requestType: "coordination_records",
    });
    try {
      const res = await listProjectCoordination(requestedProjectId);
      if (!shouldApplyProjectResponse(generation, requestedProjectId)) {
        logUciProjectDataEvent("response_ignored_stale", {
          projectId: requestedProjectId,
          generation,
          requestType: "coordination_records",
        });
        return;
      }
      setRecords(res.records ?? []);
      logUciProjectDataEvent("request_completed", {
        projectId: requestedProjectId,
        generation,
        requestType: "coordination_records",
      });
    } catch (e: unknown) {
      if (!shouldApplyProjectResponse(generation, requestedProjectId)) {
        logUciProjectDataEvent("response_ignored_stale", {
          projectId: requestedProjectId,
          generation,
          requestType: "coordination_records",
        });
        return;
      }
      logUciProjectDataEvent("request_failed", {
        projectId: requestedProjectId,
        generation,
        requestType: "coordination_records",
        message: e instanceof Error ? e.message : String(e),
      });
      toast.error(formatUciUserError(e, "Failed to load coordination"));
      setRecords([]);
    } finally {
      if (shouldApplyProjectResponse(generation, requestedProjectId)) {
        setRecordsLoading(false);
        logUciProjectDataEvent("loading_cleared", {
          projectId: requestedProjectId,
          generation,
          requestType: "coordination_records",
        });
      }
    }
  }, [authLoading, user?.id, projectId, shouldApplyProjectResponse]);

  useEffect(() => {
    if (authLoading || !user?.id) return;
    void refreshCoordination();
  }, [authLoading, user?.id, refreshCoordination]);

  useEffect(() => {
    if (!projectId) {
      setSetupSectionExpanded(true);
      return;
    }
    setSetupSectionExpanded(records.length === 0);
  }, [projectId, records.length]);

  const addressPresentation = useMemo(
    () => deriveAddressPresentation(providerSetup, providerSetupLoading, addressSourceAcknowledged),
    [providerSetup, providerSetupLoading, addressSourceAcknowledged],
  );

  const initDisabledReasons = useMemo(
    () =>
      getInitDisabledReasons({
        projectSelected: Boolean(projectId),
        providerSetupLoading,
        providersLoading,
        initting,
        addressPresentation,
        addressSourceAcknowledged,
        providerSetupConfirmed,
        selectedProviderCount: countSelectedProviders(initPick),
      }),
    [
      projectId,
      providerSetupLoading,
      providersLoading,
      initting,
      addressPresentation,
      addressSourceAcknowledged,
      providerSetupConfirmed,
      initPick,
    ],
  );

  const handleProviderPickChange = useCallback(
    (slug: string, checked: boolean) => {
      if (providerSetup && buildInitializedSlugSet(providerSetup).has(slug)) return;
      setInitPick((prev) => ({ ...prev, [slug]: checked }));
    },
    [providerSetup],
  );

  const handleClearSelectedProviders = useCallback(() => {
    setInitPick((prev) => {
      const next = { ...prev };
      for (const slug of Object.keys(next)) next[slug] = false;
      return next;
    });
  }, []);

  const uciSelectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );

  const hasUnsavedUciSetupChanges = useMemo(() => {
    if (!projectId) return false;
    if (providerSetupConfirmed) return true;
    if (countSelectedProviders(initPick) > 0) return true;
    if (detailOpen && reason.trim()) return true;
    if (detailOpen && applicationReviewNotes.trim()) return true;
    return false;
  }, [projectId, providerSetupConfirmed, initPick, detailOpen, reason, applicationReviewNotes]);

  const performProjectChangeReset = useCallback(() => {
    setProjectSwitchConfirmOpen(false);
    setProjectId(null);
  }, [setProjectId]);

  const handleChangeProjectRequest = useCallback(() => {
    if (hasUnsavedUciSetupChanges) {
      setProjectSwitchConfirmOpen(true);
      return;
    }
    performProjectChangeReset();
  }, [hasUnsavedUciSetupChanges, performProjectChangeReset]);

  const loadProviderSetup = useCallback(async () => {
    if (authLoading || !user?.id || !projectId) {
      setProviderSetup(null);
      setProviderResolution(null);
      setProviderSetupConfirmed(false);
      setAddressSourceAcknowledged(null);
      setUnresolvedUtilityTypes([]);
      setProviderSetupLoading(false);
      return;
    }
    const generation = projectDataGenerationRef.current;
    const requestedProjectId = projectId;
    setProviderSetupLoading(true);
    logUciProjectDataEvent("request_started", {
      projectId: requestedProjectId,
      generation,
      requestType: "provider_setup",
    });
    try {
      const setup = await getProjectProviderSetup(requestedProjectId);
      if (!shouldApplyProjectResponse(generation, requestedProjectId)) {
        logUciProjectDataEvent("response_ignored_stale", {
          projectId: requestedProjectId,
          generation,
          requestType: "provider_setup",
        });
        return;
      }
      setProviderSetup(setup);
      setProviderSetupConfirmed(false);
      const hasAddress = Boolean(
        setup.structured?.formatted?.trim() ||
          setup.scraped_location?.formatted?.trim() ||
          setup.address?.formatted?.trim(),
      );
      setAddressSourceAcknowledged(hasAddress ? setup.recommended_address_source : null);
      setUnresolvedUtilityTypes([]);
      setInitPick((prev) => {
        const next = { ...prev };
        for (const item of setup.providers ?? []) {
          if (item.already_initialized) next[item.slug] = false;
        }
        return next;
      });
      logUciProjectDataEvent("request_completed", {
        projectId: requestedProjectId,
        generation,
        requestType: "provider_setup",
      });
    } catch (e: unknown) {
      if (!shouldApplyProjectResponse(generation, requestedProjectId)) {
        logUciProjectDataEvent("response_ignored_stale", {
          projectId: requestedProjectId,
          generation,
          requestType: "provider_setup",
        });
        return;
      }
      logUciProjectDataEvent("request_failed", {
        projectId: requestedProjectId,
        generation,
        requestType: "provider_setup",
        message: e instanceof Error ? e.message : String(e),
      });
      setProviderSetup(null);
      setAddressSourceAcknowledged(null);
      toast.error(formatUciUserError(e, "Failed to load provider setup guidance"));
    } finally {
      if (shouldApplyProjectResponse(generation, requestedProjectId)) {
        setProviderSetupLoading(false);
        logUciProjectDataEvent("loading_cleared", {
          projectId: requestedProjectId,
          generation,
          requestType: "provider_setup",
        });
      }
    }
  }, [authLoading, user?.id, projectId, shouldApplyProjectResponse]);

  const loadProviderResolution = useCallback(async () => {
    if (authLoading || !user?.id || !projectId) {
      setProviderResolution(null);
      setProviderResolutionLoading(false);
      return;
    }
    const generation = projectDataGenerationRef.current;
    const requestedProjectId = projectId;
    setProviderResolutionLoading(true);
    logUciProjectDataEvent("request_started", {
      projectId: requestedProjectId,
      generation,
      requestType: "provider_resolution",
    });
    try {
      const resolution = await getProjectProviderResolution(requestedProjectId);
      if (!shouldApplyProjectResponse(generation, requestedProjectId)) {
        logUciProjectDataEvent("response_ignored_stale", {
          projectId: requestedProjectId,
          generation,
          requestType: "provider_resolution",
        });
        return;
      }
      setProviderResolution(resolution);
      logUciProjectDataEvent("request_completed", {
        projectId: requestedProjectId,
        generation,
        requestType: "provider_resolution",
      });
    } catch (e: unknown) {
      if (!shouldApplyProjectResponse(generation, requestedProjectId)) {
        logUciProjectDataEvent("response_ignored_stale", {
          projectId: requestedProjectId,
          generation,
          requestType: "provider_resolution",
        });
        return;
      }
      logUciProjectDataEvent("request_failed", {
        projectId: requestedProjectId,
        generation,
        requestType: "provider_resolution",
        message: e instanceof Error ? e.message : String(e),
      });
      setProviderResolution(null);
      toast.error(formatUciUserError(e, "Failed to load provider mapping status"));
    } finally {
      if (shouldApplyProjectResponse(generation, requestedProjectId)) {
        setProviderResolutionLoading(false);
        logUciProjectDataEvent("loading_cleared", {
          projectId: requestedProjectId,
          generation,
          requestType: "provider_resolution",
        });
      }
    }
  }, [authLoading, user?.id, projectId, shouldApplyProjectResponse]);

  const handleResolveProviderMapping = useCallback(
    async (serviceType: string) => {
      if (!projectId) return;
      setProviderResolutionActionLoading(true);
      try {
        const result = await resolveProjectProviderResolution(projectId, {
          serviceType,
          addressSourceAcknowledged: addressSourceAcknowledged ?? undefined,
        });
        if (result.project_id !== projectId) return;
        setProviderResolution((prev) => ({
          project_id: result.project_id,
          resolver_version: result.resolution.resolver_version ?? prev?.resolver_version ?? "d2.2-v1",
          territory_data_available: prev?.territory_data_available ?? { electric: false, gas: false },
          address_context: prev?.address_context ?? {
            formatted: result.resolution.address.formatted,
            source: result.resolution.address.source,
            address_mismatch: false,
          },
          resolutions: {
            ...(prev?.resolutions ?? {}),
            [result.service_type]: result.resolution,
          },
          user_messages: prev?.user_messages ?? {
            territory_unavailable:
              "Automatic territory matching is not available yet. Select and confirm the utility serving this project.",
          },
        }));
      } catch (e: unknown) {
        toast.error(formatUciUserError(e, "Failed to run provider territory check"));
      } finally {
        setProviderResolutionActionLoading(false);
      }
    },
    [projectId, addressSourceAcknowledged],
  );

  const handleConfirmProviderMapping = useCallback(
    async (params: { serviceType: string; providerId: string; notes?: string }) => {
      if (!projectId) return;
      setProviderResolutionActionLoading(true);
      try {
        const result = await confirmProjectProviderResolution(projectId, params);
        if (result.project_id !== projectId) return;
        setProviderResolution((prev) => ({
          project_id: result.project_id,
          resolver_version: result.resolution.resolver_version ?? prev?.resolver_version ?? "d2.2-v1",
          territory_data_available: prev?.territory_data_available ?? { electric: false, gas: false },
          address_context: prev?.address_context ?? {
            formatted: result.resolution.address.formatted,
            source: result.resolution.address.source,
            address_mismatch: false,
          },
          resolutions: {
            ...(prev?.resolutions ?? {}),
            [result.service_type]: result.resolution,
          },
          user_messages: prev?.user_messages ?? {
            territory_unavailable:
              "Automatic territory matching is not available yet. Select and confirm the utility serving this project.",
          },
        }));
        toast.success("Utility provider confirmed.");
      } catch (e: unknown) {
        toast.error(formatUciUserError(e, "Failed to confirm provider"));
      } finally {
        setProviderResolutionActionLoading(false);
      }
    },
    [projectId],
  );

  const handleOverrideProviderMapping = useCallback(
    async (params: {
      serviceType: string;
      providerId: string;
      overrideReason: string;
      notes?: string;
    }) => {
      if (!projectId) return;
      setProviderResolutionActionLoading(true);
      try {
        const result = await overrideProjectProviderResolution(projectId, params);
        if (result.project_id !== projectId) return;
        setProviderResolution((prev) => ({
          project_id: result.project_id,
          resolver_version: result.resolution.resolver_version ?? prev?.resolver_version ?? "d2.2-v1",
          territory_data_available: prev?.territory_data_available ?? { electric: false, gas: false },
          address_context: prev?.address_context ?? {
            formatted: result.resolution.address.formatted,
            source: result.resolution.address.source,
            address_mismatch: false,
          },
          resolutions: {
            ...(prev?.resolutions ?? {}),
            [result.service_type]: result.resolution,
          },
          user_messages: prev?.user_messages ?? {
            territory_unavailable:
              "Automatic territory matching is not available yet. Select and confirm the utility serving this project.",
          },
        }));
        toast.success("Provider override recorded.");
      } catch (e: unknown) {
        toast.error(formatUciUserError(e, "Failed to override provider"));
      } finally {
        setProviderResolutionActionLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (authLoading || !user?.id) return;
    void loadProviderSetup();
  }, [authLoading, user?.id, loadProviderSetup]);

  useEffect(() => {
    if (authLoading || !user?.id) return;
    void loadProviderResolution();
  }, [authLoading, user?.id, loadProviderResolution]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        let changed = false;
        if (prev.get("coordination") !== id) {
          next.set("coordination", id);
          changed = true;
        }
        // Preserve an explicit ?tab= deep link; otherwise mirror the preferred tab
        // (e.g. Submissions → application-prep set by section navigation).
        if (!prev.get("tab") && drawerTab) {
          next.set("tab", drawerTab);
          changed = true;
        }
        return changed ? next : prev;
      },
      { replace: true },
    );
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
    setPepcoLastNormalizedSync(null);
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

  const handleLoadProfileAnalyze = async () => {
    if (!detailId) return;
    setLoadProfileBusy(true);
    try {
      await analyzeCoordinationLoadProfile(detailId);
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      toast.success("Load profile analysis saved — review missing inputs before relying on any values");
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Load profile analysis failed"));
    } finally {
      setLoadProfileBusy(false);
    }
  };

  const handleLoadCandidateExtract = async (externalApplicationId: string, refresh = false) => {
    if (!detailId || !externalApplicationId) return;
    setLoadCandidateBusy(true);
    try {
      const result = await extractCoordinationLoadCandidates(detailId, {
        external_application_id: externalApplicationId,
        refresh,
      });
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      if (result.extraction_status === "partial") {
        const failedCount = result.failed_documents?.length ?? result.documents_failed ?? 0;
        toast.warning(
          `Partial extraction — ${result.candidates_produced ?? result.candidates.length} candidate(s); ${failedCount} source issue(s)`,
        );
      } else {
        toast.success("Connected load candidates extracted — review evidence before approving");
      }
    } catch (e: unknown) {
      toast.error(formatLoadCandidateExtractionError(e, "Connected load extraction failed"));
    } finally {
      setLoadCandidateBusy(false);
    }
  };

  const handleImportDocumentFindings = async (externalApplicationId: string, refresh = false) => {
    if (!detailId || !externalApplicationId) return;
    setImportFindingsBusy(true);
    try {
      const result = await importCoordinationDocumentFindings(detailId, {
        external_application_id: externalApplicationId,
        refresh,
      });
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      if (result.status === "partial") {
        toast.warning(
          `Partial import — ${result.candidates_created} created, ${result.findings_skipped} skipped, ${result.failed_findings.length} failed`,
        );
      } else {
        toast.success(
          `Imported ${result.candidates_created} candidate(s) from document findings — review in queue`,
        );
      }
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Document findings import failed"));
    } finally {
      setImportFindingsBusy(false);
    }
  };

  const handleLoadCandidateResolve = async (
    candidateId: string,
    action: "approve" | "edit_approve" | "reject" | "keep_unresolved",
    opts?: { edited_value?: string; edited_unit?: string; review_note?: string },
  ) => {
    if (!detailId) return;
    setLoadCandidateResolveBusy(candidateId);
    try {
      await resolveCoordinationLoadCandidate(detailId, {
        candidate_id: candidateId,
        action,
        ...opts,
      });
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      toast.success(
        action === "approve" || action === "edit_approve"
          ? "Value approved into verified load profile"
          : action === "reject"
            ? "Candidate rejected"
            : "Candidate left unresolved",
      );
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to resolve candidate"));
    } finally {
      setLoadCandidateResolveBusy(null);
    }
  };

  const handleManualVerifiedValue = async (
    payload: import("@/lib/uciLoadProfileWorkspace").ManualVerifiedInputPayload & {
      review_note: string;
    },
  ) => {
    if (!detailId) return;
    setManualVerifyBusy(true);
    try {
      await addCoordinationManualVerifiedValue(detailId, payload);
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      toast.success("Manual verified input saved");
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to save manual verified input"));
    } finally {
      setManualVerifyBusy(false);
    }
  };

  const handleApplicationPackageBuild = async (externalApplicationId?: string | null) => {
    if (!detailId) return;
    setApplicationPrepBusy(true);
    try {
      await buildCoordinationApplicationPackage(detailId, {
        external_application_id: externalApplicationId || undefined,
      });
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      toast.success("Application package draft saved — review missing documents before submission");
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Application package build failed"));
    } finally {
      setApplicationPrepBusy(false);
    }
  };

  const handleApplicationReview = async (status: "reviewed" | "needs_changes") => {
    const packageApp = getApplicationPackageDraftApplication(detail?.applications);
    if (!packageApp) return;
    setApplicationReviewBusy(true);
    try {
      await reviewCoordinationApplication(packageApp.id, {
        status,
        notes: applicationReviewNotes.trim() || undefined,
      });
      const d = await getCoordinationDetail(detailId!);
      setDetail(d);
      toast.success(status === "reviewed" ? "Application marked reviewed" : "Changes requested");
      if (status === "needs_changes") {
        setApplicationReviewNotes("");
      }
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Application review failed"));
    } finally {
      setApplicationReviewBusy(false);
    }
  };

  const handleApplicationSubmit = async () => {
    const packageApp = getApplicationPackageDraftApplication(detail?.applications);
    if (!packageApp) return;
    setApplicationSubmitBusy(true);
    try {
      const result = await submitCoordinationApplication(packageApp.id);
      const d = await getCoordinationDetail(detailId!);
      setDetail(d);
      await refreshCoordination();
      if (result.status === "human_required" || result.dry_run) {
        toast.info(
          result.message ||
            "PEPCO dry-run complete — review fields and attachments before any live submission.",
        );
      } else if (result.status === "confirmed") {
        toast.success("Submission confirmed — await utility acknowledgment");
      } else {
        toast.success("Submission recorded — await utility confirmation");
      }
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Application submission failed"));
    } finally {
      setApplicationSubmitBusy(false);
    }
  };

  const handleClassifyCommunications = async () => {
    if (!detailId) return;
    setClassifyCommsBusy(true);
    try {
      const result = await classifyCoordinationCommunications(detailId);
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      toast.success(
        `Classified ${result.classified_count} communication(s) — ${result.skipped_count} skipped`,
      );
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Communication classification failed"));
    } finally {
      setClassifyCommsBusy(false);
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
      const durable = summary as UciPortalSyncResponse & {
        mode?: string;
        job?: { id?: string };
      };
      if (durable.mode === "durable" && durable.job?.id) {
        sessionStorage.setItem(`${UCI_SYNC_RUN_STORAGE_PREFIX}${detailId}`, String(durable.job.id));
        toast.message("Portal sync queued — tracking durable job status.");
        await syncRunsRefresh();
        return;
      }
      const normalizedResult = portalSyncResponseToNormalizedResult(summary);
      setPepcoLastNormalizedSync(normalizedResult);
      toast.success(
        `Normalized sync complete — apps +${summary.applications.inserted}/${summary.applications.updated}, comms +${summary.communications.inserted}, events +${summary.milestones.inserted}`,
      );
      if (summary.warnings.length) {
        toast.message(summary.warnings[0]);
      }
      notifyNormalizedSyncResult(normalizedResult, toast);
      const d = await getCoordinationDetail(detailId);
      setDetail(d);
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Normalized sync failed"));
    } finally {
      setNormalizedSyncBusy(false);
    }
  };

  const reloadDetail = async () => {
    if (!detailId) return;
    const d = await getCoordinationDetail(detailId);
    setDetail(d);
    await refreshCoordination();
  };

  const handleApplyLifecycleProposal = async () => {
    if (!detailId || !displayLifecycleProposal || !lifecycleProposalsPayload?.last_evaluated_at) return;
    setLifecycleProposalBusy(true);
    try {
      const checksum = await computeLifecycleProposalChecksum(
        displayLifecycleProposal,
        lifecycleProposalsPayload.last_evaluated_at,
      );
      await applyLifecycleProposal(detailId, {
        external_application_id: displayLifecycleProposal.external_application_id,
        proposal_checksum: checksum,
      });
      toast.success("Lifecycle proposal applied");
      await reloadDetail();
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to apply lifecycle proposal"));
    } finally {
      setLifecycleProposalBusy(false);
    }
  };

  const handleRejectLifecycleProposal = async () => {
    if (!detailId || !displayLifecycleProposal || !lifecycleProposalsPayload?.last_evaluated_at) return;
    setLifecycleProposalBusy(true);
    try {
      const checksum = await computeLifecycleProposalChecksum(
        displayLifecycleProposal,
        lifecycleProposalsPayload.last_evaluated_at,
      );
      await rejectLifecycleProposal(detailId, {
        external_application_id: displayLifecycleProposal.external_application_id,
        proposal_checksum: checksum,
        reason: "Rejected from UCI dashboard",
      });
      toast.message("Lifecycle proposal rejected");
      await reloadDetail();
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to reject lifecycle proposal"));
    } finally {
      setLifecycleProposalBusy(false);
    }
  };

  const handleCosAnalyze = async () => {
    if (!detailId) return;
    setCosBusy(true);
    setCosError(null);
    try {
      await analyzeCoordinationCos(detailId);
      toast.success("COS analysis complete");
      await reloadDetail();
    } catch (e: unknown) {
      const msg = formatUciUserError(e, "COS analysis failed");
      setCosError(msg);
      toast.error(msg);
    } finally {
      setCosBusy(false);
    }
  };

  const handleSaveCost = async (payload: {
    cost_type: string;
    estimated_amount?: string;
    actual_amount?: string;
  }) => {
    if (!detailId) return;
    setAgentOpsBusy(true);
    setAgentOpsError(null);
    try {
      await upsertCoordinationCost(detailId, payload);
      toast.success("Cost saved");
      await reloadDetail();
    } catch (e: unknown) {
      const msg = formatUciUserError(e, "Failed to save cost");
      setAgentOpsError(msg);
      toast.error(msg);
    } finally {
      setAgentOpsBusy(false);
    }
  };

  const handleCreateEquipment = async (payload: {
    equipment_type: string;
    initial_eta?: string;
  }) => {
    if (!detailId) return;
    setAgentOpsBusy(true);
    setAgentOpsError(null);
    try {
      await createCoordinationEquipment(detailId, payload);
      toast.success("Equipment added");
      await reloadDetail();
    } catch (e: unknown) {
      const msg = formatUciUserError(e, "Failed to add equipment");
      setAgentOpsError(msg);
      toast.error(msg);
    } finally {
      setAgentOpsBusy(false);
    }
  };

  const handleCheckInEquipment = async (
    equipmentId: string,
    payload: { current_eta?: string },
  ) => {
    setAgentOpsBusy(true);
    setAgentOpsError(null);
    try {
      const result = await checkInCoordinationEquipment(equipmentId, payload);
      toast.success(result.slip_alert ? "Check-in recorded — ETA slip >2 weeks" : "Check-in recorded");
      await reloadDetail();
    } catch (e: unknown) {
      const msg = formatUciUserError(e, "Equipment check-in failed");
      setAgentOpsError(msg);
      toast.error(msg);
    } finally {
      setAgentOpsBusy(false);
    }
  };

  const handlePrepareMeterSet = async (scheduledDate?: string) => {
    if (!detailId) return;
    setMeterSetBusy(true);
    setAgentOpsError(null);
    try {
      await prepareMeterSet(detailId, scheduledDate ? { scheduled_date: scheduledDate } : undefined);
      toast.success("Meter set checklist prepared");
      await reloadDetail();
    } catch (e: unknown) {
      const msg = formatUciUserError(e, "Meter set preparation failed");
      setAgentOpsError(msg);
      toast.error(msg);
    } finally {
      setMeterSetBusy(false);
    }
  };

  const handlePrepareCloseout = async () => {
    if (!detailId) return;
    setCloseoutBusy(true);
    setAgentOpsError(null);
    try {
      await prepareCloseout(detailId);
      toast.success("Closeout checklist prepared");
      await reloadDetail();
    } catch (e: unknown) {
      const msg = formatUciUserError(e, "Closeout preparation failed");
      setAgentOpsError(msg);
      toast.error(msg);
    } finally {
      setCloseoutBusy(false);
    }
  };

  const handleReclassifyCommunication = async (communicationId: string, classification: string) => {
    setReclassifyCommId(communicationId);
    try {
      await reclassifyCommunication(communicationId, { classification });
      toast.success("Communication reclassified");
      await reloadDetail();
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Reclassification failed"));
    } finally {
      setReclassifyCommId(null);
    }
  };

  const handleInit = async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    if (!providerSetupConfirmed) {
      toast.error("Confirm your provider selections before initializing");
      return;
    }
    if (!addressSourceAcknowledged) {
      toast.error("Acknowledge the project address source before initializing");
      return;
    }
    const initializedSlugs = buildInitializedSlugSet(providerSetup);
    const slugs = providers
      .filter((p) => initPick[p.slug] && !initializedSlugs.has(p.slug))
      .map((p) => p.slug);
    if (slugs.length === 0) {
      toast.error("Select at least one provider to initialize");
      return;
    }
    setInitting(true);
    try {
      const out = await initProjectCoordination(projectId, slugs, {
        confirmed: true,
        address_source_acknowledged: addressSourceAcknowledged,
        unresolved_utility_types: unresolvedUtilityTypes,
      });
      toast.success(
        `Created ${out.created?.length ?? 0} record(s); ${out.already_existed?.length ?? 0} already existed`,
      );
      setRecords(out.records ?? []);
      setSetupSectionExpanded(false);
      await loadProviderSetup();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Initialize failed");
    } finally {
      setInitting(false);
    }
  };

  const toggleUnresolvedUtilityType = (utilityType: string, checked: boolean) => {
    const normalized = utilityType.trim().toLowerCase();
    if (!normalized) return;
    setUnresolvedUtilityTypes((prev) => {
      if (checked) return prev.includes(normalized) ? prev : [...prev, normalized];
      return prev.filter((entry) => entry !== normalized);
    });
  };

  const uncoveredUtilityTypes = useMemo(() => {
    const initializedSlugs = buildInitializedSlugSet(providerSetup);
    const selectedTypes = new Set(
      providers
        .filter((provider) => initPick[provider.slug] && !initializedSlugs.has(provider.slug))
        .map((provider) => provider.utility_type?.trim().toLowerCase() ?? "")
        .filter(Boolean),
    );
    const catalogTypes = providerSetup?.utility_types_in_catalog ?? [];
    return catalogTypes.filter((utilityType) => !selectedTypes.has(utilityType));
  }, [providers, initPick, providerSetup?.utility_types_in_catalog, providerSetup]);

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

  const lifecycleProposalsPayload = useMemo(() => {
    const m =
      detailRecord?.metadata &&
      typeof detailRecord.metadata === "object" &&
      detailRecord.metadata !== null &&
      !Array.isArray(detailRecord.metadata)
        ? (detailRecord.metadata as Record<string, unknown>)
        : null;
    return getLifecycleProposalsFromMetadata(m);
  }, [detailRecord?.metadata]);

  const displayLifecycleProposal = useMemo(
    () => selectDisplayLifecycleProposal(lifecycleProposalsPayload),
    [lifecycleProposalsPayload],
  );

  const providerMappingMetadata = useMemo(
    () => getProviderMappingFromMetadata(detailRecord?.metadata ?? null),
    [detailRecord?.metadata],
  );

  const syncRunPollFn = useCallback(async (coordinationId: string) => {
    const result = await listCoordinationSyncRuns(coordinationId, { limit: 8 });
    return { runs: result.runs, activeRun: result.activeRun };
  }, []);

  const { runs: syncRuns, activeRun: activeSyncRun, loading: syncRunsLoading, refresh: syncRunsRefresh } =
    useSyncRunPolling(detailId, syncRunPollFn, () => {
      if (detailId) {
        void getCoordinationDetail(detailId).then(setDetail);
      }
    });

  useEffect(() => {
    if (!projectId) {
      setPortfolio(null);
      return;
    }
    let cancelled = false;
    setPortfolioLoading(true);
    void getProjectPortfolioView(projectId)
      .then((view) => {
        if (!cancelled) setPortfolio(view);
      })
      .catch(() => {
        if (!cancelled) setPortfolio(null);
      })
      .finally(() => {
        if (!cancelled) setPortfolioLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, records.length]);

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

  const resolvePortalDocumentIndex = useCallback(
    (fileName: string): number | null => {
      const docs = selectedPepcoProject?.app?.documents ?? [];
      const normalized = fileName.trim().toLowerCase();
      const idx = docs.findIndex((d) => {
        const name = String(d.documentName ?? "").trim().toLowerCase();
        return name === normalized || normalized.includes(name) || name.includes(normalized);
      });
      return idx >= 0 ? idx : null;
    },
    [selectedPepcoProject?.app?.documents],
  );

  const loadProfilePackageContext = useMemo(() => {
    const packageApp = getApplicationPackageDraftApplication(detail?.applications);
    const packageMeta = parseApplicationPackageMetadata(packageApp);
    return {
      packageStatus: packageMeta?.package_status ?? null,
      hasProjectAddress: Boolean(packageMeta?.project_address?.formatted),
      packageDocumentsComplete: (packageMeta?.missing_documents?.length ?? 0) === 0,
    };
  }, [detail?.applications]);

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
      if ("normalized_sync" in out && out.normalized_sync) {
        setPepcoLastNormalizedSync(out.normalized_sync);
        notifyNormalizedSyncResult(out.normalized_sync, toast);
      }
      const syncMsg =
        "normalized_sync" in out && out.normalized_sync
          ? normalizedSyncDrawerMessage(out.normalized_sync)
          : null;
      setPepcoAppDetailMsg(syncMsg ?? `Status: ${out.status}`);
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

  /** Real-data KPI + stage rail derived from portfolio/records — presentation only, no invented metrics. */
  const uciCoordinationRecordCount = portfolio?.coordination_record_count ?? records.length;
  const uciNeedsAttentionCount = portfolio?.needs_attention_communication_count ?? 0;
  const uciMappedProviderCount = useMemo(() => {
    const names = new Set<string>();
    for (const r of records) {
      const prov = getEmbeddedProvider(r);
      if (prov) names.add(providerDisplayLabel(prov));
    }
    return names.size;
  }, [records, providerDisplayLabel]);
  const uciStageSummary = useMemo(() => portfolio?.stage_summary ?? {}, [portfolio]);
  const uciFurthestStage = useMemo(() => {
    const activeStages = STAGE_OPTIONS.filter((s) => (uciStageSummary[String(s)] ?? 0) > 0);
    return activeStages.length > 0 ? Math.max(...activeStages) : null;
  }, [uciStageSummary]);
  const uciAttentionRecords = useMemo(
    () => (portfolio?.records ?? []).filter((r) => r.needs_attention_count > 0),
    [portfolio],
  );

  const handleDetailOpenChange = useCallback(
    (open: boolean) => {
      setDetailOpen(open);
      if (!open) {
        // Clear selected coordination detail so section effects / URL hydration
        // cannot immediately reopen the drawer. Do not touch the global project.
        suppressCoordinationHydrationRef.current = true;
        setDetailId(null);
        setDetail(null);
        setSearchParams(
          (prev) => {
            if (!prev.get("coordination") && !prev.get("tab")) return prev;
            const next = new URLSearchParams(prev);
            next.delete("coordination");
            next.delete("tab");
            return next;
          },
          { replace: true },
        );
      }
    },
    [setSearchParams],
  );

  const updateDrawerTab = useCallback(
    (tab: UciDrawerTab) => {
      setDrawerTab(tab);
      setSearchParams(
        (prev) => {
          if (prev.get("tab") === tab) return prev;
          const next = new URLSearchParams(prev);
          next.set("tab", tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (!coordinationParam) {
      suppressCoordinationHydrationRef.current = false;
      return;
    }
    if (suppressCoordinationHydrationRef.current) return;
    if (coordinationParam !== detailId) {
      void openDetail(coordinationParam);
    }
    // openDetail is intentionally stable enough for deep-link hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deep-link on coordination query only
  }, [coordinationParam, detailId]);

  useEffect(() => {
    if (isUciDrawerTab(tabParam)) {
      setDrawerTab(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    if (!isPepcoCoordination && drawerTab === "portal-sync") {
      setDrawerTab("overview");
    }
  }, [isPepcoCoordination, drawerTab]);

  useEffect(() => {
    const section = getUciNavSection(sectionParam);
    if (!section) return;

    if (section.target.kind === "external") {
      navigate(section.target.href);
      return;
    }

    if (section.target.kind === "coming-soon") {
      requestAnimationFrame(() => {
        document
          .getElementById(`uci-coming-soon-${section.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }

    if (section.target.kind === "hub") {
      const anchor = section.target.anchor ?? "uci-hub";
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }

    if (section.target.kind === "drawer-tab") {
      // Prefer the mapped drawer tab for the next explicit open / deep link.
      // Never auto-select a record or force the sheet open — that requires
      // row click or an explicit ?coordination= deep link.
      // Only apply when `sectionParam` changes — not on every URL rewrite.
      // react-router's `setSearchParams` is recreated whenever searchParams
      // change; depending on it here re-forced Submissions → application-prep
      // after every in-drawer tab click and stuck the sheet on Application prep.
      const tab = section.target.tab;
      setDrawerTab(tab);

      if (detailOpen) {
        // Drawer already open: switch tab in place (and mirror into URL).
        setSearchParams(
          (prev) => {
            if (prev.get("tab") === tab) return prev;
            const next = new URLSearchParams(prev);
            next.set("tab", tab);
            return next;
          },
          { replace: true },
        );
        return;
      }

      // Drawer closed: do not write ?tab= / reopen via URL — openDetail will
      // persist tab when the user explicitly selects a record.
      requestAnimationFrame(() => {
        document
          .getElementById("uci-records-table")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    // Intentionally omit setSearchParams / detailOpen from deps:
    // - setSearchParams identity changes on every query update (RR 6)
    // - detailOpen flips are handled by openDetail mirroring drawerTab
    // Re-run only when the section deep-link itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- section deep-link orchestration
  }, [sectionParam, navigate]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Utility Coordination Intelligence"
        title="Utility Coordination"
        body="Track utility provider coordination, lifecycle stages, and project readiness. Live data from uciApi — no mock submissions."
        action={
          <div className="flex flex-wrap gap-2">
            <ServicePill kind="utility">Utility coordination</ServicePill>
            <ServicePill kind="permit">Permit expediting</ServicePill>
          </div>
        }
      />

      <section className="space-y-6 px-0">
        <div id="uci-hub" className="mx-auto w-full max-w-6xl space-y-6">
          <AlertBanner
            tone="info"
            title="PEPCO read-only portal sync is available"
            detail={
              <ul className={cn("mt-1 list-disc pl-5 text-xs", uciMutedClass)}>
                <li>PEPCO portal discovery and refresh: available (read-only)</li>
                <li>Application submission automation: not enabled</li>
                <li>Manual coordination tracking: available</li>
              </ul>
            }
          />

          {uciSelectedProject ? (
            <UciProjectContextBar
              project={uciSelectedProject}
              mutedClass={uciMutedClass}
              onChangeProject={handleChangeProjectRequest}
            />
          ) : null}

          {activeNavSection?.support === "mock" ? (
            <UciComingSoonPanel section={activeNavSection} />
          ) : null}
          {activeNavSection?.support === "partial" ? (
            <AlertBanner
              tone="warn"
              title="Partial connection"
              detail={activeNavSection.note}
            />
          ) : null}

          {/*
            Lovable-style hub is the PRIMARY view regardless of project-selection
            or data-load state. The old step-by-step setup form (UciSetupWorkflow,
            rendered further below via #uci-setup-workflow) is secondary: reachable
            from the "Setup" hub tile, never the sole/first thing rendered.
          */}
          {!projectId ? (
            <AlertBanner
              tone="default"
              title="No project selected yet"
              detail="Select a project to load its coordination records, stage progress, and attention queue. Use the “Setup” tile below or the project picker in the header to choose one."
            />
          ) : null}

          {/* KPI row — real portfolio/records rollups, never invented percentages */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Coordination records"
              value={!projectId || portfolioLoading ? "—" : uciCoordinationRecordCount}
              icon={Layers}
              detail="Per-utility coordination rows for this project"
            />
            <MetricCard
              label="Needs attention"
              value={!projectId || portfolioLoading ? "—" : uciNeedsAttentionCount}
              icon={AlertTriangle}
              detail={uciNeedsAttentionCount > 0 ? "Communications flagged for review" : "Nothing flagged right now"}
            />
            <MetricCard
              label="Providers mapped"
              value={!projectId ? "—" : uciMappedProviderCount}
              icon={RadioTower}
              detail="Unique utility providers coordinated"
            />
            <MetricCard
              label="Furthest stage"
              value={uciFurthestStage ? `${uciFurthestStage} / ${STAGE_OPTIONS.length}` : "—"}
              icon={Zap}
              detail="Highest lifecycle stage reached across records"
            />
          </div>

          {/*
            Coordination modules — Lovable-style hub tile grid, but wired to
            REAL PP capabilities only. Lovable's mock hub tiles (Conflict
            Hunter, Easement/ROW, Provider Map, Miss Utility, Long-Lead,
            Predictive Impact) have no PP equivalent yet and are
            intentionally NOT shipped here — no fake modules/links. Always
            rendered as the primary view — never gated on project selection
            or provider/record load state.
          */}
          <Panel eyebrow="UCI Hub" title="Coordination modules">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <button
                type="button"
                onClick={() =>
                  document.getElementById("uci-stage-rail")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="group flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
              >
                <Zap className="mt-0.5 h-4 w-4 text-primary" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground group-hover:text-primary">Lifecycle stages</div>
                  <div className="text-[11px] text-muted-foreground">
                    {uciFurthestStage ? `Stage ${uciFurthestStage} of ${STAGE_OPTIONS.length}` : "10-stage tracker"}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() =>
                  document.getElementById("uci-records-table")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="group flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
              >
                <Layers className="mt-0.5 h-4 w-4 text-primary" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground group-hover:text-primary">Coordination records</div>
                  <div className="text-[11px] text-muted-foreground">
                    {projectId ? `${uciCoordinationRecordCount} record(s) this project` : "Select a project"}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() =>
                  document.getElementById("uci-attention-queue")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className={cn(
                  "group flex items-start gap-3 rounded-lg border p-3 text-left transition-all",
                  uciNeedsAttentionCount > 0
                    ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                    : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5",
                )}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 text-primary" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground group-hover:text-primary">Attention queue</div>
                  <div className="text-[11px] text-muted-foreground">{uciNeedsAttentionCount} flagged communication(s)</div>
                </div>
              </button>
              <button
                type="button"
                disabled={records.length === 0}
                onClick={() => {
                  const target = uciAttentionRecords[0]?.id ?? records[0]?.id;
                  if (target) void openDetail(target);
                }}
                className="group flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RadioTower className="mt-0.5 h-4 w-4 text-primary" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground group-hover:text-primary">Provider detail</div>
                  <div className="text-[11px] text-muted-foreground">
                    Load profile · UCI builder · COS · meter-set
                  </div>
                </div>
              </button>
              <button
                type="button"
                data-testid="uci-hub-tile-setup"
                onClick={() => {
                  setSetupSectionExpanded(true);
                  document.getElementById("uci-setup-workflow")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="group flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
              >
                <Plus className="mt-0.5 h-4 w-4 text-primary" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground group-hover:text-primary">Setup</div>
                  <div className="text-[11px] text-muted-foreground">
                    {projectId ? "Add another utility" : "Select a project & map providers"}
                  </div>
                </div>
              </button>
            </div>
          </Panel>

          {/* Stage progress rail — presentational, driven by real stage_summary counts */}
          <Panel eyebrow="Lifecycle" title="Stage progress" id="uci-stage-rail">
            {portfolioLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-teal" />
              </div>
            ) : (
              <div className="flex items-start gap-1 overflow-x-auto pb-1">
                {STAGE_OPTIONS.map((stage) => {
                  const count = uciStageSummary[String(stage)] ?? 0;
                  const isFurthest = uciFurthestStage === stage;
                  return (
                    <div key={stage} className="flex min-w-[64px] flex-1 flex-col items-center gap-1.5">
                      <div
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-data font-bold",
                          count > 0
                            ? isFurthest
                              ? "border-primary bg-primary/20 text-primary"
                              : "border-teal bg-teal/15 text-teal"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {stage}
                      </div>
                      <span className={cn("text-[10px] font-medium", count > 0 ? "text-foreground" : "text-muted-foreground")}>
                        {count > 0 ? `${count} rec.` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Records table (main) + attention queue (secondary) */}
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Panel
              id="uci-records-table"
              eyebrow="Utility coordination"
              title="Coordination records"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={uciToolbarOutlineButtonClass}
                  onClick={() => void refreshCoordination()}
                  disabled={!projectId}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              }
            >
              {!projectId ? (
                <p className={cn("py-8 text-center text-sm", uciMutedClass)} data-testid="uci-records-no-project">
                  Select a project above to view its coordination records.
                </p>
              ) : recordsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-teal" />
                </div>
              ) : records.length === 0 ? (
                <p className={cn("py-8 text-center text-sm", uciMutedClass)}>
                  No utility coordination records yet. Use the “Setup” tile above to initialize providers.
                </p>
              ) : (
                <Table
                  wrapperClassName="rounded-lg border border-border/50 bg-card/80 shadow-inner dark:border-teal/25 dark:bg-muted/40"
                  className="bg-background/40 text-foreground dark:bg-transparent"
                >
                  <TableHeader className={uciTableHeaderRowClass}>
                    <TableRow className="border-border/40 transition-colors hover:bg-muted/25 dark:border-teal/15 dark:hover:bg-muted/65">
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
                          className="border-border/35 bg-background/30 transition-colors hover:bg-primary/10 dark:border-teal/12 dark:bg-card/45 dark:hover:bg-teal/6"
                        >
                          <TableCell className={cn(uciTableCellClass, "!font-semibold")}>
                            <div className="space-y-1">
                              <span>{prov ? providerDisplayLabel(prov) : "—"}</span>
                              {getProviderMappingFromMetadata(r.metadata)?.confirmed_at ? (
                                <Badge variant="outline" className="text-[10px]">
                                  Mapping confirmed
                                </Badge>
                              ) : null}
                            </div>
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
                          <TableCell className={cn(uciTableCellClass, "!text-foreground/95", "!font-normal", "text-xs dark:!text-foreground/95")}>
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
            </Panel>

            <aside className="space-y-4 lg:self-start">
              <Panel id="uci-attention-queue" eyebrow="Attention queue" title="Needs attention">
                {!projectId ? (
                  <p className={cn("text-xs", uciMutedClass)}>Select a project to see flagged communications.</p>
                ) : portfolioLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-teal" />
                  </div>
                ) : uciAttentionRecords.length === 0 ? (
                  <p className={cn("text-xs", uciMutedClass)}>
                    No coordination records are currently flagged for attention.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {uciAttentionRecords.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {r.utility_type ?? "Utility"} · Stage {r.current_stage}
                          </p>
                          <p className={cn("truncate", uciMutedClass)}>
                            {r.needs_attention_count} flagged · {formatLifecycleState(r.current_stage_state)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => void openDetail(r.id)}
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          View
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel eyebrow="Rollup" title="Stage distribution">
                <ul className="space-y-1.5 text-xs">
                  {STAGE_OPTIONS.filter((s) => (uciStageSummary[String(s)] ?? 0) > 0).length === 0 ? (
                    <li className={uciMutedClass}>No stage activity recorded yet.</li>
                  ) : (
                    STAGE_OPTIONS.filter((s) => (uciStageSummary[String(s)] ?? 0) > 0).map((stage) => (
                      <li key={stage} className="flex items-center justify-between">
                        <span className={uciMutedClass}>Stage {stage}</span>
                        <span className="font-data font-semibold text-foreground">
                          {uciStageSummary[String(stage)]}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </Panel>
            </aside>
          </div>

          {/*
            Old step-by-step setup form — SECONDARY panel, reachable via the
            "Setup" hub tile above. Never rendered as the page's sole/primary
            content (see hub block above, which always renders first).
          */}
          <div id="uci-setup-workflow" className="space-y-6">
            <UciSetupWorkflow
              editorialCardClass={UCI_SETUP_CARD_CLASS}
              mutedClass={uciMutedClass}
              projects={projects}
              projectsLoading={projectsLoading}
              projectId={projectId}
              onProjectChange={setProjectId}
              tenantScopeId={tenantScopeId}
              providers={providers}
              providersLoading={providersLoading}
              providersLoadError={providersLoadError}
              onRetryProviders={() => void loadProviders()}
              providerSetup={providerSetup}
              providerSetupLoading={providerSetupLoading}
              providerResolution={providerResolution}
              providerResolutionLoading={providerResolutionLoading}
              providerResolutionActionLoading={providerResolutionActionLoading}
              onResolveProviderMapping={(serviceType) => void handleResolveProviderMapping(serviceType)}
              onConfirmProviderMapping={(params) => void handleConfirmProviderMapping(params)}
              onOverrideProviderMapping={(params) => void handleOverrideProviderMapping(params)}
              providerUtilityFilter={providerUtilityFilter}
              onProviderUtilityFilterChange={setProviderUtilityFilter}
              providerCatalogTypes={providerCatalogTypes}
              initPick={initPick}
              onInitPickChange={handleProviderPickChange}
              onClearSelectedProviders={handleClearSelectedProviders}
              addressSourceAcknowledged={addressSourceAcknowledged}
              onAddressSourceAcknowledged={setAddressSourceAcknowledged}
              unresolvedUtilityTypes={unresolvedUtilityTypes}
              onToggleUnresolvedUtilityType={toggleUnresolvedUtilityType}
              uncoveredUtilityTypes={uncoveredUtilityTypes}
              providerSetupConfirmed={providerSetupConfirmed}
              onProviderSetupConfirmedChange={setProviderSetupConfirmed}
              initDisabledReasons={initDisabledReasons}
              initting={initting}
              onInitialize={() => void handleInit()}
              hasExistingRecords={Boolean(projectId && records.length > 0)}
              setupExpanded={setupSectionExpanded}
              onSetupExpandedChange={setSetupSectionExpanded}
              formatAutomationLabel={formatAutomationLabel}
            />
          </div>
        </div>
      </section>

      <Sheet open={detailOpen} onOpenChange={handleDetailOpenChange}>
        <SheetContent
          overlayClassName="bg-black/45 dark:bg-black/50"
          className={cn(
            "flex w-full max-w-[100vw] flex-col overflow-y-auto sm:max-w-[88vw] lg:max-w-[78vw] xl:max-w-[1280px]",
            "border-border bg-background text-foreground shadow-2xl",
            "ring-1 ring-border/70 dark:ring-teal/25",
            "dark:border-border dark:bg-card dark:text-foreground",
          )}
        >
          <SheetHeader className="text-left sm:text-left">
            <SheetTitle className="text-foreground">Coordination detail</SheetTitle>
            <SheetDescription className="text-muted-foreground">
              {detailProvider?.name ?? "Record"} · child sections are read-only; counts reflect loaded data.
            </SheetDescription>
          </SheetHeader>

          {uciSelectedProject ? (
            <UciProjectContextBar
              project={uciSelectedProject}
              mutedClass={uciMutedClass}
              onChangeProject={handleChangeProjectRequest}
              compact
              className="mt-4"
            />
          ) : null}

          {detailLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-foreground" />
            </div>
          ) : detail && detailRecord ? (
            <div className="mt-6 space-y-6 pb-10">
              <div>
                <p className={cn("mb-1.5 text-xs font-semibold uppercase tracking-wide", uciMutedClass)}>
                  Coordination status
                </p>
                <div
                  className={cn(
                    "grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-xs",
                    "sm:flex sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-1",
                    "dark:border-teal/20 dark:bg-muted/30",
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

              <Tabs
                value={drawerTab}
                onValueChange={(v) => {
                  if (isUciDrawerTab(v)) updateDrawerTab(v);
                }}
                className="mt-4"
              >
                <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
                  {UCI_DRAWER_TABS.filter((t) => !t.pepcoOnly || isPepcoCoordination).map((t) => (
                    <TabsTrigger key={t.id} value={t.id} className="text-xs sm:text-sm">
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="overview" className="mt-4 space-y-4">
                  {providerMappingMetadata ? (
                    <ProviderMappingBanner mapping={providerMappingMetadata} mutedClass={uciMutedClass} />
                  ) : null}
                  {displayLifecycleProposal ? (
                    <div
                      className={cn(
                        "rounded-md border px-3 py-2 text-xs",
                        displayLifecycleProposal.blocked_reason
                          ? "border-amber-500/40 bg-amber-500/5 text-foreground"
                          : displayLifecycleProposal.applied
                            ? "border-border/50 bg-muted/15 text-muted-foreground"
                            : "border-teal/40 bg-card/40 text-foreground dark:bg-muted/35",
                      )}
                    >
                      <p className="font-medium">
                        Portal lifecycle suggestion
                        {displayLifecycleProposal.applied ? " (applied)" : ""}
                      </p>
                      <p className={cn("mt-0.5", uciMutedClass)}>
                        Stage {displayLifecycleProposal.proposed_stage} ·{" "}
                        {formatLifecycleState(displayLifecycleProposal.proposed_state)} ·{" "}
                        {displayLifecycleProposal.source_status}
                      </p>
                      <p className={cn("mt-0.5", uciMutedClass)}>
                        {displayLifecycleProposal.reason}
                        {displayLifecycleProposal.blocked_reason
                          ? ` · Blocked: ${displayLifecycleProposal.blocked_reason}`
                          : ""}
                      </p>
                      <p className={cn("mt-1 italic", uciMutedClass)}>
                        Open the Lifecycle tab to apply or reject this proposal.
                      </p>
                    </div>
                  ) : (
                    <p className={cn("text-xs", uciMutedClass)}>
                      No lifecycle proposal for this record. Use the other tabs for portal sync,
                      documents, and application prep.
                    </p>
                  )}
                  {!isPepcoCoordination && detailId ? (
                    <SyncRunsPanel
                      coordinationId={detailId}
                      runs={syncRuns}
                      activeRun={activeSyncRun}
                      loading={syncRunsLoading}
                      onRefresh={() => void syncRunsRefresh()}
                      mutedClass={uciMutedClass}
                      sectionTitleClass={uciSheetSectionTitleClass}
                      toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                      formatWhen={formatWhen}
                    />
                  ) : null}
                </TabsContent>

                <TabsContent value="portal-sync" className="mt-4 space-y-4">
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
                        pepcoLastNormalizedSync={pepcoLastNormalizedSync}
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

                  {detailId ? (
                    <SyncRunsPanel
                      coordinationId={detailId}
                      runs={syncRuns}
                      activeRun={activeSyncRun}
                      loading={syncRunsLoading}
                      onRefresh={() => void syncRunsRefresh()}
                      mutedClass={uciMutedClass}
                      sectionTitleClass={uciSheetSectionTitleClass}
                      toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                      formatWhen={formatWhen}
                    />
                  ) : null}
                </TabsContent>

                <TabsContent value="applications" className="mt-4 space-y-4">
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

                  {!isPepcoCoordination ? (
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
                  ) : null}
                </TabsContent>

                <TabsContent value="communications" className="mt-4 space-y-4">
                  <Card className={uciDrawerChildCardClass}>
                    <CardHeader className={uciDrawerChildCardHeaderClass}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <CardTitle className={uciDrawerChildCardTitleClass}>Communications</CardTitle>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={uciToolbarOutlineButtonClass}
                          disabled={classifyCommsBusy}
                          onClick={() => void handleClassifyCommunications()}
                        >
                          {classifyCommsBusy ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Classify messages
                        </Button>
                      </div>
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
                                {comm.classification ? (
                                  <Badge variant="outline" className="capitalize text-[10px]">
                                    {formatCommunicationClassification(comm.classification)}
                                  </Badge>
                                ) : null}
                                {classificationNeedsAttention(
                                  comm.classification,
                                  comm.classification_confidence != null
                                    ? Number(comm.classification_confidence)
                                    : null,
                                  comm.needs_human_attention,
                                ) ? (
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
                              <CommunicationReclassifyRow
                                comm={comm}
                                busy={reclassifyCommId === comm.id}
                                onReclassify={(id, classification) =>
                                  void handleReclassifyCommunication(id, classification)
                                }
                                mutedClass={uciMutedClass}
                                toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="documents" className="mt-4 space-y-4">
                  <UciDocumentCoveragePanel
                    coordinationId={detailId ?? ""}
                    externalApplicationId={selectedPepcoProject?.applicationId ?? null}
                    externalApplicationTitle={selectedPepcoProject?.title ?? null}
                    mutedClass={uciMutedClass}
                    toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                    resolvePortalDocumentIndex={resolvePortalDocumentIndex}
                  />
                </TabsContent>

                <TabsContent value="load-profile" className="mt-4 space-y-4">
                  <LoadProfileWorkspace
                    applications={(detail.applications ?? []) as CoordinationApplication[]}
                    utilityType={detailRecord.utility_type}
                    selectedPepcoApplicationId={selectedPepcoProject?.applicationId ?? null}
                    selectedPepcoApplicationTitle={selectedPepcoProject?.title ?? null}
                    formatWhen={formatWhen}
                    mutedClass={uciMutedClass}
                    toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                    analyzeBusy={loadProfileBusy}
                    candidateBusy={loadCandidateBusy}
                    candidateResolveBusy={loadCandidateResolveBusy}
                    manualVerifyBusy={manualVerifyBusy}
                    importFindingsBusy={importFindingsBusy}
                    packageStatus={loadProfilePackageContext.packageStatus}
                    hasProjectAddress={loadProfilePackageContext.hasProjectAddress}
                    packageDocumentsComplete={loadProfilePackageContext.packageDocumentsComplete}
                    onAnalyze={() => void handleLoadProfileAnalyze()}
                    onExtractCandidates={(refresh) =>
                      void handleLoadCandidateExtract(selectedPepcoProject?.applicationId ?? "", refresh)
                    }
                    onImportDocumentFindings={(refresh) =>
                      void handleImportDocumentFindings(selectedPepcoProject?.applicationId ?? "", refresh)
                    }
                    onResolveCandidate={(candidateId, action, opts) =>
                      void handleLoadCandidateResolve(candidateId, action, opts)
                    }
                    onManualVerify={(payload) => void handleManualVerifiedValue(payload)}
                  />
                </TabsContent>

                <TabsContent value="application-prep" className="mt-4 space-y-4">
                  <ApplicationPrepSection
                    coordinationId={detailId ?? ""}
                    selectedPepcoApplicationId={selectedPepcoProject?.applicationId ?? null}
                    selectedPepcoApplicationTitle={selectedPepcoProject?.title ?? null}
                    applications={(detail.applications ?? []) as CoordinationApplication[]}
                    formatWhen={formatWhen}
                    mutedClass={uciMutedClass}
                    sectionTitleClass={uciSheetSectionTitleClass}
                    toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                    prepBusy={applicationPrepBusy}
                    reviewBusy={applicationReviewBusy}
                    submitBusy={applicationSubmitBusy}
                    reviewNotes={applicationReviewNotes}
                    onReviewNotesChange={setApplicationReviewNotes}
                    onBuild={(externalApplicationId) =>
                      void handleApplicationPackageBuild(externalApplicationId)
                    }
                    onReview={(status) => void handleApplicationReview(status)}
                    onSubmit={() => void handleApplicationSubmit()}
                    onRefreshDetail={async () => {
                      if (!detailId) return;
                      const d = await getCoordinationDetail(detailId);
                      setDetail(d);
                    }}
                  />
                </TabsContent>

                <TabsContent value="lifecycle" className="mt-4 space-y-4">
                  <LifecycleSection
                    transitions={detail.transitions ?? []}
                    lifecycleProposals={lifecycleProposalsPayload}
                    displayLifecycleProposal={displayLifecycleProposal}
                    lifecycleProposalBusy={lifecycleProposalBusy}
                    onApplyLifecycleProposal={() => void handleApplyLifecycleProposal()}
                    onRejectLifecycleProposal={() => void handleRejectLifecycleProposal()}
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
                </TabsContent>

                <TabsContent value="cos" className="mt-4 space-y-4">
                  <CosAnalysisPanel
                    coordinationId={detailId ?? ""}
                    metadata={(detailRecord?.metadata ?? {}) as Record<string, unknown>}
                    busy={cosBusy}
                    error={cosError}
                    onAnalyze={() => void handleCosAnalyze()}
                    mutedClass={uciMutedClass}
                    sectionTitleClass={uciSheetSectionTitleClass}
                    toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                    formatWhen={formatWhen}
                  />
                </TabsContent>

                <TabsContent value="costs" className="mt-4 space-y-4">
                  <CostsEquipmentWorkflowPanel
                    costs={(detail.costs ?? []) as import("@/types/uci").CoordinationCost[]}
                    equipment={(detail.equipment ?? []) as import("@/types/uci").CoordinationEquipment[]}
                    busy={agentOpsBusy}
                    error={agentOpsError}
                    onSaveCost={(payload) => void handleSaveCost(payload)}
                    onCreateEquipment={(payload) => void handleCreateEquipment(payload)}
                    onCheckInEquipment={(id, payload) => void handleCheckInEquipment(id, payload)}
                    mutedClass={uciMutedClass}
                    sectionTitleClass={uciSheetSectionTitleClass}
                    toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                    formatWhen={formatWhen}
                  />

                  <MeterSetCloseoutPanel
                    recordMetadata={(detailRecord?.metadata ?? {}) as Record<string, unknown>}
                    meterBusy={meterSetBusy}
                    closeoutBusy={closeoutBusy}
                    error={agentOpsError}
                    onPrepareMeterSet={(date) => void handlePrepareMeterSet(date)}
                    onPrepareCloseout={() => void handlePrepareCloseout()}
                    mutedClass={uciMutedClass}
                    sectionTitleClass={uciSheetSectionTitleClass}
                    toolbarOutlineButtonClass={uciToolbarOutlineButtonClass}
                    formatWhen={formatWhen}
                  />
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <p className="mt-6 text-sm font-medium text-foreground">
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
            "border-border bg-background text-foreground",
            "dark:border-teal/25 dark:bg-card dark:text-foreground",
          )}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Enter PEPCO verification code
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
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

      <AlertDialog open={projectSwitchConfirmOpen} onOpenChange={setProjectSwitchConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change UCI project?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved setup changes for this project. Switching projects will discard those
              unsaved selections, but saved coordination records will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay on project</AlertDialogCancel>
            <AlertDialogAction onClick={performProjectChangeReset}>Change project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  "dark:border-teal/20 dark:bg-muted/35",
);
const uciSystemDataGroupHeaderClass = cn(
  "border-b border-border/30 bg-muted/10 px-2.5 py-1",
  "dark:border-teal/15 dark:bg-muted/45",
);
const uciSystemDataRowClass = cn(
  "rounded-md border border-border/40 bg-background/50 p-2 text-xs",
  "dark:border-teal/15 dark:bg-muted/25",
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
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-foreground">{comm.raw_subject || "(no subject)"}</p>
        {comm.classification ? (
          <Badge variant="outline" className="text-[10px] capitalize">
            {formatCommunicationClassification(comm.classification)}
          </Badge>
        ) : null}
        {classificationNeedsAttention(
          comm.classification,
          comm.classification_confidence != null ? Number(comm.classification_confidence) : null,
          comm.needs_human_attention,
        ) ? (
          <Badge variant="destructive" className="text-[10px]">
            Needs attention
          </Badge>
        ) : null}
      </div>
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
 * D3 application preparation — human-confirmed document mapping and package review.
 */
function ApplicationPrepSection({
  coordinationId,
  selectedPepcoApplicationId,
  selectedPepcoApplicationTitle,
  applications,
  formatWhen,
  mutedClass,
  sectionTitleClass,
  toolbarOutlineButtonClass,
  prepBusy,
  reviewBusy,
  submitBusy,
  reviewNotes,
  onReviewNotesChange,
  onBuild,
  onReview,
  onSubmit,
  onRefreshDetail,
}: {
  coordinationId: string;
  selectedPepcoApplicationId: string | null;
  selectedPepcoApplicationTitle?: string | null;
  applications: CoordinationApplication[];
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  sectionTitleClass: string;
  toolbarOutlineButtonClass: string;
  prepBusy: boolean;
  reviewBusy: boolean;
  submitBusy: boolean;
  reviewNotes: string;
  onReviewNotesChange: (value: string) => void;
  onBuild: (externalApplicationId?: string | null) => void;
  onReview: (status: "reviewed" | "needs_changes") => void;
  onSubmit: () => void;
  onRefreshDetail: () => Promise<void>;
}) {
  const loadProfileDraft = getLoadProfileDraftApplication(applications);
  const packageApp = getApplicationPackageDraftApplication(applications);
  const packageMeta = parseApplicationPackageMetadata(packageApp);
  const packageDocs = parsePackageDocuments(packageApp?.package_documents);
  const tone = applicationPackageStatusTone(packageMeta?.package_status);
  const submitReady = canSubmitApplication(packageApp?.draft_status);

  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesScopeError, setCandidatesScopeError] = useState<string | null>(null);
  const [candidatesPayload, setCandidatesPayload] =
    useState<UciPackageDocumentCandidatesResponse | null>(null);
  const [mappingBusySlot, setMappingBusySlot] = useState<string | null>(null);
  const [selectedCandidateBySlot, setSelectedCandidateBySlot] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    setSelectedCandidateBySlot({});
  }, [selectedPepcoApplicationId]);

  useEffect(() => {
    if (!candidatesPayload) return;
    const validCandidateIds = new Set(
      candidatesPayload.candidates.map((candidate) => candidate.candidate_id),
    );
    setSelectedCandidateBySlot((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [slotKey, candidateId] of Object.entries(prev)) {
        if (candidateId && !validCandidateIds.has(candidateId)) {
          next[slotKey] = "";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [candidatesPayload]);

  const loadCandidates = useCallback(async () => {
    if (!coordinationId || !packageApp) {
      setCandidatesPayload(null);
      return;
    }
    if (!selectedPepcoApplicationId) {
      setCandidatesPayload(null);
      setCandidatesError(null);
      setCandidatesScopeError(
        "Select a PEPCO portal project above before mapping package documents.",
      );
      return;
    }
    setCandidatesLoading(true);
    setCandidatesError(null);
    setCandidatesScopeError(null);
    try {
      const payload = await listApplicationPackageDocumentCandidates(coordinationId, {
        external_application_id: selectedPepcoApplicationId,
      });
      setCandidatesPayload(payload);
    } catch (e: unknown) {
      const message = formatUciUserError(e, "Failed to load document candidates");
      setCandidatesError(message);
      setCandidatesPayload(null);
    } finally {
      setCandidatesLoading(false);
    }
  }, [coordinationId, packageApp?.id, selectedPepcoApplicationId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates, packageApp?.package_documents, packageApp?.id]);

  const handleConfirmMapping = async (slotKey: string) => {
    if (!packageApp) return;
    const candidateId = selectedCandidateBySlot[slotKey];
    if (!candidateId) {
      toast.error("Select a suggested document before confirming");
      return;
    }
    setMappingBusySlot(slotKey);
    try {
      await confirmApplicationPackageDocumentMapping(packageApp.id, {
        slot_key: slotKey,
        candidate_id: candidateId,
        external_application_id: selectedPepcoApplicationId || undefined,
      });
      setSelectedCandidateBySlot((prev) => {
        const next = { ...prev };
        delete next[slotKey];
        return next;
      });
      await onRefreshDetail();
      await loadCandidates();
      toast.success("Document mapping confirmed — slot marked attached after human review");
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to confirm document mapping"));
    } finally {
      setMappingBusySlot(null);
    }
  };

  const handleRemoveMapping = async (slotKey: string) => {
    if (!packageApp) return;
    setMappingBusySlot(slotKey);
    try {
      await removeApplicationPackageDocumentMapping(packageApp.id, { slot_key: slotKey });
      await onRefreshDetail();
      await loadCandidates();
      toast.success("Document mapping removed");
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to remove document mapping"));
    } finally {
      setMappingBusySlot(null);
    }
  };

  const slotCandidates = useCallback(
    (slotKey: string): UciPackageDocumentCandidate[] => {
      if (!candidatesPayload) return [];
      const suggested = candidatesPayload.suggestions_by_slot[slotKey] ?? [];
      const other = candidatesPayload.candidates.filter(
        (c) => c.suggested_package_slot !== slotKey,
      );
      const merged = [...suggested];
      for (const candidate of other) {
        if (!merged.some((m) => m.candidate_id === candidate.candidate_id)) {
          merged.push(candidate);
        }
      }
      return merged;
    },
    [candidatesPayload],
  );

  const statusBadgeVariant =
    tone === "blocked"
      ? "destructive"
      : tone === "warning"
        ? "destructive"
        : tone === "info"
          ? "secondary"
          : "outline";

  return (
    <Card className={uciDrawerChildCardClass}>
      <CardHeader className={uciDrawerChildCardHeaderClass}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className={uciDrawerChildCardTitleClass}>Application preparation</CardTitle>
            <CardDescription className={cn("text-[11px]", mutedClass)}>
              Agent 3 package draft — confirm PEPCO or uploaded documents per required slot. Filename
              suggestions are not verified attachments.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={toolbarOutlineButtonClass}
            disabled={prepBusy || !loadProfileDraft || !selectedPepcoApplicationId}
            onClick={() => onBuild(selectedPepcoApplicationId)}
          >
            {prepBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {packageApp ? "Rebuild package" : "Prepare application draft"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 py-4 space-y-3">
        {!loadProfileDraft ? (
          <p className={uciDrawerChildEmptyClass}>
            Run load profile analysis first — D3 depends on the D2.1 load_summary draft.
          </p>
        ) : !packageApp ? (
          <p className={uciDrawerChildEmptyClass}>
            No application package yet. Prepare a draft to inventory required documents and fields from
            the PEPCO template manifest.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBadgeVariant}>
                {formatApplicationPackageStatus(packageMeta?.package_status)}
              </Badge>
              <Badge variant="outline">{formatDraftStatus(packageApp.draft_status)}</Badge>
              {packageMeta?.requires_human_review ? (
                <Badge variant="mutedLight">Human review required</Badge>
              ) : null}
            </div>

            {packageMeta?.package_status === "incomplete" ? (
              <p className={cn("text-sm text-amber-800 dark:text-amber-200", mutedClass)}>
                Package is incomplete — missing documents or verified load data. Review gaps before
                submission.
              </p>
            ) : null}

            <div className="space-y-3 rounded-md border border-border/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn("text-xs font-medium uppercase tracking-wide", mutedClass)}>
                  Document mapping (human confirmation required)
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={candidatesLoading}
                  onClick={() => void loadCandidates()}
                >
                  {candidatesLoading ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-3 w-3" />
                  )}
                  Refresh candidates
                </Button>
              </div>

              {candidatesScopeError ? (
                <p className={cn("text-xs text-amber-800 dark:text-amber-200", mutedClass)}>
                  {candidatesScopeError}
                </p>
              ) : null}

              {candidatesError ? (
                <p className={cn("text-xs text-destructive", mutedClass)}>{candidatesError}</p>
              ) : null}

              {packageDocs.map((slot) => {
                const slotKey = slot.key;
                const attached = slot.status === "attached";
                const candidates = slotCandidates(slotKey);
                const suggested = candidatesPayload?.suggestions_by_slot[slotKey] ?? [];
                const slotSelection = selectedCandidateBySlot[slotKey] ?? "";

                return (
                  <div
                    key={slotKey}
                    className="space-y-2 rounded-md border border-border/40 bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={attached ? "secondary" : "outline"}>
                        {attached ? "Attached" : "Missing"}
                      </Badge>
                      <span className="text-sm font-medium text-foreground">
                        {slot.label || slotKey.replace(/_/g, " ")}
                      </span>
                    </div>

                    {attached ? (
                      <div className={cn("space-y-1 text-xs", mutedClass)}>
                        <p>
                          Confirmed: <span className="text-foreground">{slot.file_name}</span>
                        </p>
                        <p>
                          Source: {formatPackageDocumentSource(slot.source)}
                          {slot.user_confirmed ? " — human confirmed" : ""}
                        </p>
                        {slot.confirmed_at ? (
                          <p>Confirmed {formatWhen(slot.confirmed_at)}</p>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn("mt-1", toolbarOutlineButtonClass)}
                          disabled={mappingBusySlot === slotKey}
                          onClick={() => void handleRemoveMapping(slotKey)}
                        >
                          {mappingBusySlot === slotKey ? (
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          ) : null}
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {suggested.length > 0 ? (
                          <div className={cn("space-y-1 text-xs", mutedClass)}>
                            <p className="font-medium text-foreground">Suggested (not verified)</p>
                            {suggested.map((candidate) => (
                              <p key={candidate.candidate_id}>
                                {candidate.file_name} —{" "}
                                {formatSuggestionConfidence(candidate.confidence)}
                                {candidate.suggestion_reason ? ` — ${candidate.suggestion_reason}` : ""}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className={cn("text-xs", mutedClass)}>
                            No filename/metadata suggestion for this slot.
                          </p>
                        )}

                        {candidates.length > 0 ? (
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[12rem] flex-1">
                              <Label
                                htmlFor={`doc-candidate-${slotKey}`}
                                className="text-xs text-muted-foreground"
                              >
                                Choose document
                              </Label>
                              <Select
                                value={slotSelection || undefined}
                                onValueChange={(value) =>
                                  setSelectedCandidateBySlot((prev) => ({
                                    ...prev,
                                    [slotKey]: value,
                                  }))
                                }
                              >
                                <SelectTrigger
                                  id={`doc-candidate-${slotKey}`}
                                  className="mt-1 h-8 text-xs"
                                >
                                  <SelectValue placeholder="Select a document" />
                                </SelectTrigger>
                                <SelectContent>
                                  {candidates.map((candidate) => (
                                    <SelectItem
                                      key={candidate.candidate_id}
                                      value={candidate.candidate_id}
                                    >
                                      {candidate.file_name} (
                                      {formatPackageDocumentSource(
                                        candidate.source_type === "pepco_portal"
                                          ? "pepco_portal"
                                          : "project_documents",
                                      )}
                                      )
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              disabled={mappingBusySlot === slotKey || !slotSelection}
                              onClick={() => void handleConfirmMapping(slotKey)}
                            >
                              {mappingBusySlot === slotKey ? (
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                              ) : null}
                              Confirm
                            </Button>
                          </div>
                        ) : candidatesLoading ? (
                          <p className={cn("text-xs", mutedClass)}>Loading candidates…</p>
                        ) : (
                          <p className={cn("text-xs", mutedClass)}>
                            No PEPCO or uploaded candidates available for this slot.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <p className={cn("text-xs font-medium uppercase tracking-wide", mutedClass)}>
                Package documents ({packageDocs.length})
              </p>
              <ul className={cn("mt-1 space-y-1 text-sm", mutedClass)}>
                {packageDocs.map((doc) => (
                  <li key={doc.key} className="flex flex-wrap items-center gap-2">
                    <Badge variant={doc.status === "attached" ? "secondary" : "outline"}>
                      {doc.status === "attached" ? "Attached" : "Missing"}
                    </Badge>
                    <span className="font-medium text-foreground">{doc.label || doc.key}</span>
                    {doc.file_name ? <span className="text-xs">({doc.file_name})</span> : null}
                    {doc.source ? (
                      <span className="text-xs">
                        [{formatPackageDocumentSource(doc.source)}]
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            {(packageMeta?.missing_documents?.length ?? 0) > 0 ? (
              <div>
                <p className={cn("text-xs font-medium uppercase tracking-wide", mutedClass)}>
                  Missing documents
                </p>
                <ul className={cn("mt-1 list-disc space-y-0.5 pl-5 text-sm", mutedClass)}>
                  {packageMeta?.missing_documents?.map((item) => (
                    <li key={item}>{item.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!selectedPepcoApplicationId ? (
              <p className={cn("text-xs text-amber-800 dark:text-amber-200", mutedClass)}>
                Select a PEPCO portal project above before rebuilding the application package.
              </p>
            ) : null}

            <div className="space-y-1 rounded-md border border-border/50 bg-muted/10 p-3">
              <p className={cn("text-xs font-medium uppercase tracking-wide", mutedClass)}>
                Project address
              </p>
              {packageMeta?.project_address?.formatted ? (
                <p className="text-sm text-foreground">{packageMeta.project_address.formatted}</p>
              ) : (
                <p className={cn("text-sm", mutedClass)}>
                  No resolved project address in the current package snapshot.
                </p>
              )}
              <p className={cn("text-xs", mutedClass)}>
                Source: {packageMeta?.project_address?.source?.replace(/_/g, " ") ?? "none"}
                {packageMeta?.project_address?.fallback_used ? " (fallback)" : ""}
              </p>
              {selectedPepcoApplicationTitle ? (
                <p className={cn("text-xs", mutedClass)}>
                  Selected PEPCO application: {selectedPepcoApplicationTitle}
                </p>
              ) : null}
              {packageMeta?.address_review_required ? (
                <p className={cn("text-xs font-medium text-amber-800 dark:text-amber-200", mutedClass)}>
                  Human address confirmation required before submission.
                </p>
              ) : null}
              {packageMeta?.address_mismatch && packageMeta?.mismatch_warning ? (
                <p className={cn("text-xs font-medium text-amber-800 dark:text-amber-200", mutedClass)}>
                  {packageMeta.mismatch_warning}
                </p>
              ) : null}
            </div>

            {(packageMeta?.missing_fields?.length ?? 0) > 0 ? (
              <div>
                <p className={cn("text-xs font-medium uppercase tracking-wide", mutedClass)}>
                  Missing fields
                </p>
                <ul className={cn("mt-1 list-disc space-y-0.5 pl-5 text-sm", mutedClass)}>
                  {packageMeta?.missing_fields?.map((item) => (
                    <li key={item}>
                      {item === "project_address_review"
                        ? "Project address source review required (structured vs scraped mismatch)"
                        : item.replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className={cn("text-xs", mutedClass)}>
              Load profile status: {packageMeta?.load_profile_analysis_status || "unknown"}
            </p>

            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <Label htmlFor="application-review-notes" className="text-xs">
                Review notes (optional)
              </Label>
              <Textarea
                id="application-review-notes"
                value={reviewNotes}
                onChange={(e) => onReviewNotesChange(e.target.value)}
                rows={2}
                className="text-sm"
                placeholder="Document review comments for the team"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={reviewBusy || packageApp.draft_status === "reviewed"}
                  onClick={() => onReview("reviewed")}
                >
                  {reviewBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Mark reviewed
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={toolbarOutlineButtonClass}
                  disabled={reviewBusy}
                  onClick={() => onReview("needs_changes")}
                >
                  Request changes
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={!submitReady || submitBusy || packageApp.draft_status === "submitted"}
                  onClick={onSubmit}
                >
                  {submitBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Submit to utility
                </Button>
              </div>
              {!submitReady ? (
                <p className={cn("text-xs", mutedClass)}>
                  Portal submission stays disabled until draft status is reviewed.
                </p>
              ) : packageApp.draft_status === "submitted" ? (
                <p className={cn("text-xs text-emerald-800 dark:text-emerald-200", mutedClass)}>
                  Submitted — confirmation captured. Await utility acknowledgment.
                </p>
              ) : (
                <p className={cn("text-xs text-emerald-800 dark:text-emerald-200", mutedClass)}>
                  Reviewed — submit runs PEPCO validation dry-run (no live portal submit by default) or
                  sends email for other utilities when mailbox is connected.
                </p>
              )}
            </div>

            <p className={cn("text-xs tabular-nums", mutedClass)}>
              Package built {formatWhen(packageApp.updated_at)}
              {packageApp.reviewed_at ? ` · Reviewed ${formatWhen(packageApp.reviewed_at)}` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
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
  lifecycleProposals,
  displayLifecycleProposal,
  lifecycleProposalBusy,
  onApplyLifecycleProposal,
  onRejectLifecycleProposal,
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
  lifecycleProposals: ReturnType<typeof getLifecycleProposalsFromMetadata>;
  displayLifecycleProposal: ReturnType<typeof selectDisplayLifecycleProposal>;
  lifecycleProposalBusy: boolean;
  onApplyLifecycleProposal: () => void;
  onRejectLifecycleProposal: () => void;
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
        {displayLifecycleProposal ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              displayLifecycleProposal.blocked_reason
                ? "border-amber-500/40 bg-amber-500/5 text-foreground"
                : displayLifecycleProposal.applied
                  ? "border-border/50 bg-muted/15 text-muted-foreground"
                  : "border-teal/40 bg-card/40 text-foreground dark:bg-muted/35",
            )}
          >
            <p className="font-medium">
              Portal lifecycle suggestion
              {displayLifecycleProposal.applied ? " (applied)" : ""}
            </p>
            <p className={cn("mt-0.5", mutedClass)}>
              Stage {displayLifecycleProposal.proposed_stage} ·{" "}
              {formatLifecycleState(displayLifecycleProposal.proposed_state)} ·{" "}
              {displayLifecycleProposal.source_status}
            </p>
            <p className={cn("mt-0.5", mutedClass)}>
              {displayLifecycleProposal.reason}
              {displayLifecycleProposal.blocked_reason
                ? ` · Blocked: ${displayLifecycleProposal.blocked_reason}`
                : ""}
              {lifecycleProposals?.last_evaluated_at
                ? ` · ${formatWhen(lifecycleProposals.last_evaluated_at)}`
                : ""}
            </p>
            {lifecycleProposals?.auto_apply_enabled ? (
              <p className={cn("mt-0.5 italic", mutedClass)}>Auto-apply enabled on server.</p>
            ) : (
              <p className={cn("mt-0.5 italic", mutedClass)}>
                Proposal only — set UCI_AUTO_STAGE_TRANSITIONS=true to auto-apply.
              </p>
            )}
            {displayLifecycleProposal && lifecycleProposals ? (
              <LifecycleProposalActions
                proposal={displayLifecycleProposal}
                lifecycleProposals={lifecycleProposals}
                busy={lifecycleProposalBusy}
                onApply={onApplyLifecycleProposal}
                onReject={onRejectLifecycleProposal}
                formatLifecycleState={formatLifecycleState}
                mutedClass={mutedClass}
              />
            ) : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          {transitions.length === 0 ? (
            <p className="text-sm font-medium text-foreground/90">
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
                      : "border-l-teal/50 bg-card/40 text-foreground dark:bg-muted/35",
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
