import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PepcoApplicationDetailDiscovery } from "@/types/uci";
import { ChevronDown, ChevronRight, Info, Loader2, RefreshCw } from "lucide-react";
import { PepcoApplicationDetailProgressLog } from "@/components/uci/PepcoApplicationDetailsPanel";

type PepcoDashboardMetadata = {
  lastAt: string | null;
  status: string | null;
  cardsFound: number | null;
  applicationIdsFound: number | null;
  discoverySource: string | null;
  listApiWarning: string | null;
};

type OperationSummary = {
  label: string;
  detail?: string | null;
  tone: "muted" | "running" | "warning" | "success" | "destructive";
};

export type PepcoPortalHeaderSectionProps = {
  detailId: string | null;
  detailLoading: boolean;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  sectionTitleClass: string;
  pepcoDownloadDocuments: boolean;
  onPepcoDownloadDocumentsChange: (value: boolean) => void;
  pepcoDiscoveryBusy: boolean;
  pepcoResumeBusy: boolean;
  pepcoDashboardBusy: boolean;
  pepcoAppDetailBusy: boolean;
  pepcoAppDetailResumeBusy: boolean;
  pepcoCodeSubmitBusy: boolean;
  pepcoCodeModalOpen: boolean;
  normalizedSyncBusy: boolean;
  pepcoPendingSessionId: string | null;
  pepcoAppDetailPendingSessionId: string | null;
  pepcoAppDetailMfaSessionId: string | null;
  pepcoDiscoveryMsg: string | null;
  pepcoDashboardMsg: string | null;
  pepcoAppDetailMsg: string | null;
  pepcoDashboardFromMetadata: PepcoDashboardMetadata | null;
  pepcoApplicationDetailDiscovery: PepcoApplicationDetailDiscovery | null;
  hasPepcoDashboardCards: boolean;
  hasPepcoApplicationDetails: boolean;
  onLoginCheck: () => void;
  onDiscoverDashboard: () => void;
  onResumeInterrupted: () => void;
  onNormalizedSync: () => void;
};

function operationSummaryToneClass(tone: OperationSummary["tone"]): string {
  switch (tone) {
    case "running":
      return "border-primary/30 bg-primary/10 text-foreground";
    case "warning":
      return "border-warning/40 bg-warning/10 text-foreground";
    case "success":
      return "border-success/30 bg-success/10 text-foreground";
    case "destructive":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-border/60 bg-muted/30 text-muted-foreground";
  }
}

function connectionBadgeVariant(
  label: string,
): "secondary" | "ai" | "destructive" | "outline" {
  if (label === "Connected") return "ai";
  if (label === "Verification required" || label === "Needs login") return "destructive";
  return "secondary";
}

/**
 * Only returns a status callout for states that need attention (running,
 * verification required, failed). The idle/ready state has no callout —
 * the compact instruction row below covers that case without duplication.
 */
function buildOperationSummary(props: PepcoPortalHeaderSectionProps): OperationSummary | null {
  const anyBusy =
    props.pepcoDiscoveryBusy ||
    props.pepcoResumeBusy ||
    props.pepcoDashboardBusy ||
    props.pepcoAppDetailBusy ||
    props.pepcoAppDetailResumeBusy ||
    props.pepcoCodeSubmitBusy ||
    props.normalizedSyncBusy;

  if (props.pepcoCodeModalOpen || props.pepcoAppDetailMfaSessionId) {
    return {
      label: "Verification required",
      detail: "Enter the PEPCO verification code to continue.",
      tone: "warning",
    };
  }

  if (anyBusy) {
    return {
      label: "Running",
      detail: "A PEPCO portal operation is in progress.",
      tone: "running",
    };
  }

  const failMsg =
    [props.pepcoDiscoveryMsg, props.pepcoDashboardMsg].find((msg) =>
      /fail|error|expired|rejected/i.test(String(msg || "")),
    ) ?? null;

  if (failMsg) {
    return { label: "Failed", detail: failMsg, tone: "destructive" };
  }

  return null;
}

function buildConnectionLabel(props: PepcoPortalHeaderSectionProps): string {
  if (props.pepcoCodeModalOpen || props.pepcoAppDetailMfaSessionId) return "Verification required";
  if (props.pepcoPendingSessionId && !props.hasPepcoDashboardCards) return "Needs login";
  if (props.hasPepcoDashboardCards) return "Connected";
  return "Not synced";
}

export function PepcoPortalHeaderSection(props: PepcoPortalHeaderSectionProps) {
  const operationSummary = useMemo(() => buildOperationSummary(props), [props]);
  const connectionLabel = useMemo(() => buildConnectionLabel(props), [props]);

  const globalBusy =
    props.pepcoDiscoveryBusy ||
    props.pepcoResumeBusy ||
    props.pepcoDashboardBusy ||
    props.pepcoAppDetailBusy ||
    props.pepcoAppDetailResumeBusy ||
    props.pepcoCodeSubmitBusy ||
    props.normalizedSyncBusy ||
    props.detailLoading;

  const hasResumableSession =
    Boolean(props.pepcoPendingSessionId) || Boolean(props.pepcoAppDetailPendingSessionId);

  const loginCheckDisabled = globalBusy || props.pepcoDashboardBusy;
  const discoverDisabled = globalBusy;
  const syncDisabled = !props.detailId || props.detailLoading || props.normalizedSyncBusy;
  const resumeInterruptedDisabled = globalBusy || !hasResumableSession;

  return (
    <div className="rounded-lg border border-teal/25 bg-cream-raised/60 p-2.5 dark:border-teal/35 dark:bg-obsidian/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("text-sm font-semibold", props.sectionTitleClass)}>PEPCO Portal</p>
            <Badge variant={connectionBadgeVariant(connectionLabel)}>{connectionLabel}</Badge>
            <Badge variant="secondary">Read-only</Badge>
          </div>
          <p className={cn("text-xs leading-snug", props.mutedClass)}>
            <span className="font-medium text-foreground">Last discovery:</span>{" "}
            {props.pepcoDashboardFromMetadata?.lastAt
              ? props.formatWhen(props.pepcoDashboardFromMetadata.lastAt)
              : "—"}
            {" · "}
            <span className="font-medium text-foreground">Last sync:</span>{" "}
            {props.pepcoApplicationDetailDiscovery?.lastScrapedAt
              ? props.formatWhen(props.pepcoApplicationDetailDiscovery.lastScrapedAt)
              : "—"}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              className="bg-teal text-white hover:bg-teal/90"
              disabled={props.detailLoading}
              aria-haspopup="menu"
              aria-label="PEPCO actions menu"
            >
              PEPCO Actions
              <ChevronDown className="ml-1.5 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Portal operations</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={loginCheckDisabled}
              title={loginCheckDisabled ? "Wait for the current operation to finish." : undefined}
              onSelect={() => props.onLoginCheck()}
            >
              {props.pepcoDiscoveryBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Check portal connection
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={discoverDisabled}
              title={discoverDisabled ? "Wait for the current operation to finish." : undefined}
              onSelect={() => props.onDiscoverDashboard()}
            >
              {props.pepcoDashboardBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Discover dashboard projects
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={syncDisabled}
              title={syncDisabled ? "Sync is unavailable while detail is loading." : undefined}
              onSelect={() => props.onNormalizedSync()}
            >
              {props.normalizedSyncBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Re-sync normalized data
            </DropdownMenuItem>
            {hasResumableSession ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={resumeInterruptedDisabled}
                  title={
                    resumeInterruptedDisabled
                      ? "Resume is unavailable while another operation is running."
                      : undefined
                  }
                  onSelect={() => props.onResumeInterrupted()}
                >
                  Resume interrupted operation
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {operationSummary ? (
        <div
          className={cn(
            "mt-2 rounded-md border px-3 py-1.5 text-xs",
            operationSummaryToneClass(operationSummary.tone),
          )}
          aria-live="polite"
        >
          <p className="font-semibold">{operationSummary.label}</p>
          {operationSummary.detail ? (
            <p className="mt-0.5 leading-snug opacity-90">{operationSummary.detail}</p>
          ) : null}
        </div>
      ) : (
        <p className={cn("mt-2 text-xs leading-snug", props.mutedClass)}>
          Discover the PEPCO dashboard, select a project, then use Scrape Details or Refresh
          Details.
        </p>
      )}

      {props.pepcoDashboardFromMetadata?.listApiWarning ? (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-foreground">
          {props.pepcoDashboardFromMetadata.listApiWarning}
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <Checkbox
          id={`pepco-download-docs-${props.detailId ?? "row"}`}
          checked={props.pepcoDownloadDocuments}
          onCheckedChange={(checked) => props.onPepcoDownloadDocumentsChange(checked === true)}
          disabled={globalBusy}
          className={cn(
            "shrink-0 border-gold/50 dark:border-cream/35",
            "data-[state=checked]:border-teal data-[state=checked]:bg-teal data-[state=checked]:text-white",
          )}
        />
        <Label
          htmlFor={`pepco-download-docs-${props.detailId ?? "row"}`}
          className={cn("text-xs font-normal text-foreground")}
        >
          Download documents during next project scrape
        </Label>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="About document download" className="text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              When enabled, listed portal documents are saved during Scrape Details or Refresh
              Details.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

export type PepcoDeveloperToolsProps = {
  detailId: string | null;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  manualFormTextClass: string;
  pepcoAutoEmailMfa: boolean;
  onPepcoAutoEmailMfaChange: (value: boolean) => void;
  globalBusy: boolean;
  pepcoPendingSessionId: string | null;
  pepcoAppDetailPendingSessionId: string | null;
  pepcoAppDetailMfaSessionId: string | null;
  pepcoResumeBusy: boolean;
  pepcoAppDetailResumeBusy: boolean;
  pepcoAppDetailBusy: boolean;
  pepcoAppDetailProgress: string[];
  pepcoDiscoveryMsg: string | null;
  pepcoDashboardMsg: string | null;
  pepcoAppDetailMsg: string | null;
  pepcoDashboardFromMetadata: PepcoDashboardMetadata | null;
  onResumeLogin: () => void;
  onResumeApplicationDetail: () => void;
};

/** Collapsed-by-default developer/diagnostic controls, hidden from the main workflow. */
export function PepcoDeveloperTools(props: PepcoDeveloperToolsProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 w-full justify-between px-2 text-xs", props.toolbarOutlineButtonClass)}
          aria-expanded={open}
        >
          <span>Developer tools</span>
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-4 rounded-md border border-border/60 bg-muted/20 p-3">
        <div className="space-y-3">
          <p className={cn("text-xs font-semibold uppercase tracking-wide", props.mutedClass)}>
            MFA and recovery
          </p>
          <div className="flex items-start gap-2">
            <Checkbox
              id={`pepco-auto-email-dev-${props.detailId ?? "row"}`}
              checked={props.pepcoAutoEmailMfa}
              onCheckedChange={(checked) => props.onPepcoAutoEmailMfaChange(checked === true)}
              disabled={props.globalBusy}
              className={cn(
                "mt-1 shrink-0 border-gold/50 dark:border-cream/35",
                "data-[state=checked]:border-teal data-[state=checked]:bg-teal data-[state=checked]:text-white",
              )}
            />
            <div className="space-y-0.5">
              <Label
                htmlFor={`pepco-auto-email-dev-${props.detailId ?? "row"}`}
                className={props.manualFormTextClass}
              >
                Auto-fetch email MFA code
              </Label>
              <p className={cn("text-[11px] leading-snug", props.mutedClass)}>
                Optional. Requires a connected Microsoft mailbox. Manual code entry through the
                verification modal remains the default fallback.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={props.toolbarOutlineButtonClass}
              disabled={props.globalBusy || !props.pepcoPendingSessionId}
              title={!props.pepcoPendingSessionId ? "No resumable PEPCO login session." : undefined}
              aria-busy={props.pepcoResumeBusy}
              onClick={() => props.onResumeLogin()}
            >
              {props.pepcoResumeBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Resume PEPCO login
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={props.toolbarOutlineButtonClass}
              disabled={props.globalBusy || !props.pepcoAppDetailPendingSessionId}
              title={
                !props.pepcoAppDetailPendingSessionId
                  ? "No resumable application detail session."
                  : undefined
              }
              aria-busy={props.pepcoAppDetailResumeBusy}
              onClick={() => props.onResumeApplicationDetail()}
            >
              {props.pepcoAppDetailResumeBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Resume application detail scrape
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className={cn("text-xs font-semibold uppercase tracking-wide", props.mutedClass)}>
            Technical progress
          </p>
          <PepcoApplicationDetailProgressLog
            lines={props.pepcoAppDetailProgress}
            busy={props.pepcoAppDetailBusy || props.pepcoAppDetailResumeBusy}
            mutedClass={props.mutedClass}
          />
          {props.pepcoDiscoveryMsg ? (
            <p className={cn("text-[11px] leading-snug", props.mutedClass)}>
              <span className="font-medium text-foreground">Login check:</span> {props.pepcoDiscoveryMsg}
            </p>
          ) : null}
          {props.pepcoDashboardMsg ? (
            <p className={cn("text-[11px] leading-snug", props.mutedClass)}>
              <span className="font-medium text-foreground">Dashboard:</span> {props.pepcoDashboardMsg}
            </p>
          ) : null}
          {props.pepcoAppDetailMsg ? (
            <p className={cn("text-[11px] leading-snug", props.mutedClass)}>
              <span className="font-medium text-foreground">Application detail:</span>{" "}
              {props.pepcoAppDetailMsg}
            </p>
          ) : null}
        </div>

        <div className="space-y-1 rounded-md border border-border/50 bg-background/50 p-2 font-mono text-[10px] text-muted-foreground">
          <p>Login session: {props.pepcoPendingSessionId ?? "—"}</p>
          <p>App detail session: {props.pepcoAppDetailPendingSessionId ?? "—"}</p>
          <p>MFA session: {props.pepcoAppDetailMfaSessionId ?? "—"}</p>
          <p>
            Dashboard status: {props.pepcoDashboardFromMetadata?.status ?? "—"}
            {typeof props.pepcoDashboardFromMetadata?.cardsFound === "number"
              ? ` · ${props.pepcoDashboardFromMetadata.cardsFound} cards`
              : ""}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
