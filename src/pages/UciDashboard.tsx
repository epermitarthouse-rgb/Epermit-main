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
import { Input } from "@/components/ui/input";
import { useProjects } from "@/hooks/useProjects";
import {
  getCoordinationDetail,
  initProjectCoordination,
  listProjectCoordination,
  listUciProviders,
  postPepcoDashboardDiscovery,
  postPepcoDiscovery,
  resumePepcoDiscovery,
  submitPepcoMfaCode,
  transitionCoordination,
} from "@/lib/uciApi";
import { getMicrosoftMailboxStatus } from "@/lib/microsoftMailboxApi";
import { toast } from "sonner";
import {
  Info,
  Loader2,
  RadioTower,
  RefreshCw,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CoordinationRecord,
  LifecycleState,
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

/** Manual stage update card only: ink labels/title on cream panel (overrides sheet inherit). */
const uciManualFormTextClass = "text-foreground dark:text-foreground";
const uciManualFormTitleClass = cn(
  "mb-3 font-display text-base font-semibold tracking-tight",
  uciManualFormTextClass,
);

export default function UciDashboard() {
  const { projects, loading: projectsLoading } = useProjects();

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

  const [pepcoDiscoveryBusy, setPepcoDiscoveryBusy] = useState(false);
  const [pepcoDiscoveryMsg, setPepcoDiscoveryMsg] = useState<string | null>(null);
  const [pepcoDashboardBusy, setPepcoDashboardBusy] = useState(false);
  const [pepcoDashboardMsg, setPepcoDashboardMsg] = useState<string | null>(null);
  const [pepcoCodeModalOpen, setPepcoCodeModalOpen] = useState(false);
  const [pepcoCodeModalError, setPepcoCodeModalError] = useState<string | null>(null);
  const [pepcoCodeSubmitBusy, setPepcoCodeSubmitBusy] = useState(false);
  const [pepcoDashboardMfaSessionId, setPepcoDashboardMfaSessionId] = useState<string | null>(null);
  const [pepcoDashboardMfaCaptureIds, setPepcoDashboardMfaCaptureIds] = useState(false);
  const pepcoCodeInputRef = useRef<HTMLInputElement>(null);
  const [pepcoPendingSessionId, setPepcoPendingSessionId] = useState<string | null>(null);
  const [pepcoResumeBusy, setPepcoResumeBusy] = useState(false);
  const [pepcoAutoEmailMfa, setPepcoAutoEmailMfa] = useState(false);

  const loadProviders = useCallback(async () => {
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
      toast.error(e instanceof Error ? e.message : "Failed to load providers");
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const refreshCoordination = useCallback(async () => {
    if (!projectId) {
      setRecords([]);
      return;
    }
    setRecordsLoading(true);
    try {
      const res = await listProjectCoordination(projectId);
      setRecords(res.records ?? []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load coordination");
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshCoordination();
  }, [refreshCoordination]);

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

    return {
      status,
      lastAt,
      cardsFound,
      applicationIdsFound,
      cards,
    };
  }, [detailRecord?.metadata]);

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
    const raw = pepcoCodeInputRef.current?.value ?? "";
    const code = raw.trim().replace(/\s+/g, "");
    if (!/^\d{4,8}$/.test(code)) {
      setPepcoCodeModalError("Enter a numeric code (4–8 digits).");
      return;
    }
    setPepcoCodeSubmitBusy(true);
    setPepcoCodeModalError(null);
    try {
      const out = await submitPepcoMfaCode(detailId, {
        session_id: pepcoDashboardMfaSessionId,
        code,
        continue_action: "discover_dashboard",
        capture_application_ids: pepcoDashboardMfaCaptureIds,
      });
      if (pepcoCodeInputRef.current) pepcoCodeInputRef.current.value = "";

      if (out.status === "completed") {
        setPepcoCodeModalOpen(false);
        setPepcoDashboardMfaSessionId(null);
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
      } else if (
        out.status === "human_required" &&
        "reason" in out &&
        out.reason === "mfa_email_code_input_required"
      ) {
        setPepcoCodeModalError(
          typeof out.message === "string"
            ? out.message
            : "That code was not accepted. Try again with the latest code.",
        );
        if ("session_id" in out && typeof out.session_id === "string") {
          setPepcoDashboardMfaSessionId(out.session_id);
        }
      } else if (out.status === "failed") {
        setPepcoCodeModalOpen(false);
        setPepcoDashboardMfaSessionId(null);
        toast.error(out.message || "Verification failed");
        setPepcoDashboardMsg(out.message || "Discovery session ended.");
      } else {
        toast.message("Unexpected response after submitting code.");
      }

      const d = await getCoordinationDetail(detailId);
      setDetail(d);
      await refreshCoordination();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Submit code failed";
      setPepcoCodeModalError(msg);
      toast.error(msg);
    } finally {
      setPepcoCodeSubmitBusy(false);
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
            "w-full overflow-y-auto sm:max-w-lg",
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
              <div
                className={cn(
                  "space-y-1.5 rounded-lg border border-cream-sunken/50 bg-cream-raised/40 p-3 text-sm",
                  "dark:border-teal/20 dark:bg-obsidian/30",
                )}
              >
                <p className="text-ink-primary-light dark:text-foreground">
                  <span className={uciDetailLabelClass}>Stage / state:</span>{" "}
                  <span className={uciDetailValueClass}>
                    {detailRecord.current_stage} ·{" "}
                    {formatLifecycleState(detailRecord.current_stage_state)}
                  </span>
                </p>
                <p className="text-ink-primary-light dark:text-foreground">
                  <span className={uciDetailLabelClass}>Application submitted:</span>{" "}
                  <span className={uciDetailValueClass}>{formatWhen(detailRecord.application_submitted_at)}</span>
                </p>
                <p className="text-ink-primary-light dark:text-foreground">
                  <span className={uciDetailLabelClass}>Acknowledgment received:</span>{" "}
                  <span className={uciDetailValueClass}>{formatWhen(detailRecord.acknowledgment_received_at)}</span>
                </p>
                <p className="text-ink-primary-light dark:text-foreground">
                  <span className={uciDetailLabelClass}>Class of service issued:</span>{" "}
                  <span className={uciDetailValueClass}>{formatWhen(detailRecord.class_of_service_issued_at)}</span>
                </p>
                <p className="text-ink-primary-light dark:text-foreground">
                  <span className={uciDetailLabelClass}>Energization target:</span>{" "}
                  <span className={uciDetailValueClass}>{formatDateOnly(detailRecord.energization_target_date)}</span>
                </p>
                <p className="text-ink-primary-light dark:text-foreground">
                  <span className={uciDetailLabelClass}>Energization actual:</span>{" "}
                  <span className={uciDetailValueClass}>{formatDateOnly(detailRecord.energization_actual_date)}</span>
                </p>
                {detailRecord.last_error ? (
                  <p className="text-destructive">
                    <span className="font-medium">Last error:</span> {detailRecord.last_error}
                  </p>
                ) : null}
              </div>

              {isPepcoCoordination ? (
                <div
                  className={cn(
                    "rounded-lg border border-teal/25 bg-cream-raised/60 p-3 dark:border-teal/35 dark:bg-obsidian/40",
                  )}
                >
                  <p className={cn("mb-2 text-sm font-semibold", uciManualFormTextClass)}>
                    PEPCO portal
                  </p>
                  <div className="mb-3 flex items-start gap-2">
                    <Checkbox
                      id={`pepco-auto-email-${detailId ?? "row"}`}
                      checked={pepcoAutoEmailMfa}
                      onCheckedChange={(c) => setPepcoAutoEmailMfa(Boolean(c))}
                      disabled={
                        pepcoDiscoveryBusy ||
                        pepcoResumeBusy ||
                        pepcoDashboardBusy ||
                        detailLoading
                      }
                      className={cn(
                        "mt-1 shrink-0 border-gold/50 dark:border-cream/35",
                        "data-[state=checked]:border-teal data-[state=checked]:bg-teal data-[state=checked]:text-white",
                        "dark:data-[state=checked]:border-teal-soft dark:data-[state=checked]:bg-teal",
                      )}
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor={`pepco-auto-email-${detailId ?? "row"}`} className={uciManualFormTextClass}>
                        Auto-fetch email MFA code
                      </Label>
                      <p className={cn("text-[11px] leading-snug", uciMutedClass)}>
                        Requires a connected Microsoft mailbox in Settings. Leave off for manual MFA only.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={uciToolbarOutlineButtonClass}
                      disabled={
                        pepcoDiscoveryBusy || pepcoDashboardBusy || detailLoading
                      }
                      aria-busy={pepcoDiscoveryBusy}
                      onClick={() => void handlePepcoDiscovery()}
                    >
                      {pepcoDiscoveryBusy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Run PEPCO Login Check
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={uciToolbarOutlineButtonClass}
                      disabled={
                        pepcoResumeBusy ||
                        pepcoDashboardBusy ||
                        detailLoading ||
                        !pepcoPendingSessionId
                      }
                      aria-busy={pepcoResumeBusy}
                      onClick={() => void handlePepcoResume()}
                    >
                      {pepcoResumeBusy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Resume PEPCO Login
                    </Button>
                  </div>
                  {pepcoDiscoveryMsg ? (
                    <p className={cn("mt-2 text-xs leading-snug", uciMutedClass)}>{pepcoDiscoveryMsg}</p>
                  ) : null}

                  <hr className="my-4 border-cream-sunken/60 dark:border-teal/25" />

                  <p className={cn("mb-2 text-sm font-semibold", uciManualFormTextClass)}>
                    PEPCO dashboard (read-only discovery)
                  </p>
                  <p className={cn("mb-3 text-[11px] leading-snug", uciMutedClass)}>
                    Extracts dashboard cards after login/MFA. Optional second pass clicks each card only to read the
                    application ID from the URL (no overview data). Reuses the MFA options above.
                  </p>

                  <div className="mb-3 space-y-1 text-xs leading-snug">
                    <p className={uciManualFormTextClass}>
                      <span className="font-medium">Last discovery:</span>{" "}
                      {pepcoDashboardFromMetadata?.lastAt
                        ? formatWhen(pepcoDashboardFromMetadata.lastAt)
                        : "—"}
                    </p>
                    <p className={uciManualFormTextClass}>
                      <span className="font-medium">Stored status:</span>{" "}
                      {pepcoDashboardFromMetadata?.status ?? "—"}
                      {typeof pepcoDashboardFromMetadata?.cardsFound === "number" ? (
                        <>
                          {" "}
                          · {pepcoDashboardFromMetadata.cardsFound} card
                          {pepcoDashboardFromMetadata.cardsFound === 1 ? "" : "s"}
                        </>
                      ) : null}
                      {typeof pepcoDashboardFromMetadata?.applicationIdsFound === "number" &&
                      pepcoDashboardFromMetadata.applicationIdsFound > 0 ? (
                        <>
                          {" "}
                          · {pepcoDashboardFromMetadata.applicationIdsFound} application ID
                          {pepcoDashboardFromMetadata.applicationIdsFound === 1 ? "" : "s"}
                        </>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={uciToolbarOutlineButtonClass}
                      disabled={
                        pepcoDashboardBusy ||
                        pepcoDiscoveryBusy ||
                        pepcoResumeBusy ||
                        detailLoading
                      }
                      aria-busy={pepcoDashboardBusy}
                      onClick={() => void handlePepcoDashboardDiscover(false)}
                    >
                      {pepcoDashboardBusy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Discover PEPCO Dashboard
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={uciToolbarOutlineButtonClass}
                      disabled={
                        pepcoDashboardBusy ||
                        pepcoDiscoveryBusy ||
                        pepcoResumeBusy ||
                        detailLoading
                      }
                      aria-busy={pepcoDashboardBusy}
                      onClick={() => void handlePepcoDashboardDiscover(true)}
                    >
                      Discover + Capture Application IDs
                    </Button>
                  </div>
                  {pepcoDashboardMsg ? (
                    <p className={cn("mt-2 text-xs leading-snug", uciMutedClass)}>{pepcoDashboardMsg}</p>
                  ) : null}

                  {pepcoDashboardFromMetadata && pepcoDashboardFromMetadata.cards.length > 0 ? (
                    <div className="mt-4 overflow-x-auto rounded-md border border-cream-sunken/60 dark:border-teal/25">
                      <Table className="min-w-[480px] text-xs">
                        <TableHeader className={uciTableHeaderRowClass}>
                          <TableRow className="border-cream-sunken/40 dark:border-teal/15">
                            <TableHead className={uciTableHeadClass}>Title</TableHead>
                            <TableHead className={uciTableHeadClass}>Address</TableHead>
                            <TableHead className={uciTableHeadClass}>Status</TableHead>
                            <TableHead className={uciTableHeadClass}>Job ID</TableHead>
                            <TableHead className={uciTableHeadClass}>Application ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pepcoDashboardFromMetadata.cards.map((c, idx) => (
                            <TableRow
                              key={`${String(c.jobId ?? "")}-${String(c.applicationId ?? "")}-${idx}`}
                              className="border-cream-sunken/35 dark:border-teal/12"
                            >
                              <TableCell className={uciTableCellClass}>{c.title ?? "—"}</TableCell>
                              <TableCell className={uciTableCellClass}>{c.address ?? "—"}</TableCell>
                              <TableCell className={uciTableCellClass}>{c.status ?? "—"}</TableCell>
                              <TableCell className={cn(uciTableCellClass, "font-mono text-[11px]")}>
                                {c.jobId ?? "—"}
                              </TableCell>
                              <TableCell className={cn(uciTableCellClass, "max-w-[200px] break-all font-mono text-[11px]")}>
                                {c.applicationId
                                  ? c.applicationId
                                  : c.applicationIdError
                                    ? `— (${c.applicationIdError})`
                                    : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div>
                <h4 className={cn("mb-2", uciSheetSectionTitleClass)}>Transitions</h4>
                <div className="space-y-2">
                  {(detail.transitions ?? []).length === 0 ? (
                    <p className="text-sm font-medium text-ink-primary-light/90 dark:text-foreground/90">None yet.</p>
                  ) : (
                    (detail.transitions ?? []).map((t) => (
                      <div
                        key={t.id}
                        className={uciTransitionCardClass}
                      >
                        <p className="font-mono text-[11px] font-semibold text-foreground">
                          Stage {t.from_stage ?? "—"} / {t.from_state ?? "—"} → {t.to_stage} /{" "}
                          {t.to_state}
                        </p>
                        <p className="mt-0.5 font-medium text-foreground">
                          {t.triggered_by_type ?? "—"}
                          {t.reason ? ` · ${t.reason}` : ""}
                        </p>
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {formatWhen(t.created_at)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {(
                ["applications", "costs", "equipment", "milestones", "communications_recent"] as const
              ).map((key) => {
                const label =
                  key === "communications_recent" ? "Recent communications (5)" : key.replace(/_/g, " ");
                const rows = detail[key] as unknown[];
                return (
                  <Card key={key} className={uciDrawerChildCardClass}>
                    <CardHeader className={uciDrawerChildCardHeaderClass}>
                      <CardTitle className={uciDrawerChildCardTitleClass}>{label}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 py-4">
                      {rows.length === 0 ? (
                        <p className={uciDrawerChildEmptyClass}>No entries.</p>
                      ) : (
                        <p className={uciDrawerChildCountClass}>
                          {rows.length} row(s)
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              <div className={cn(uciInsetPanelClass, "p-4", uciManualFormTextClass)}>
                <h4 className={uciManualFormTitleClass}>Manual stage update</h4>
                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <Label htmlFor="uci-to-stage" className={uciManualFormTextClass}>
                      To stage (1–10)
                    </Label>
                    <Select value={toStage} onValueChange={setToStage}>
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
                    <Label htmlFor="uci-to-state" className={uciManualFormTextClass}>
                      To state
                    </Label>
                    <Select
                      value={toState}
                      onValueChange={(v) => setToState(v as LifecycleState)}
                    >
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
                    <Label htmlFor="uci-reason" className={uciManualFormTextClass}>
                      Reason (required)
                    </Label>
                    <Textarea
                      id="uci-reason"
                      placeholder="Why is the stage changing?"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      className={uciSheetControlClass}
                    />
                  </div>
                  <Button
                    type="button"
                    className="bg-teal hover:bg-teal/90 text-white"
                    disabled={transitionSaving}
                    aria-busy={transitionSaving}
                    onClick={() => void handleTransition()}
                  >
                    {transitionSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Update stage
                  </Button>
                </div>
              </div>
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
              A verification code was sent to the PEPCO mailbox. Paste it here and PermitPilot will
              continue the dashboard discovery.
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
              disabled={pepcoCodeSubmitBusy || !pepcoDashboardMfaSessionId}
              aria-busy={pepcoCodeSubmitBusy}
              onClick={() => void handleSubmitPepcoDashboardCode()}
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
