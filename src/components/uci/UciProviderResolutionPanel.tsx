import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";
import {
  filterProvidersForServiceType,
  findProviderById,
  formatConfidenceLabel,
  formatResolutionMethodLabel,
  formatResolutionStatusLabel,
  getProviderConfirmationSectionCopy,
  getResolutionUserMessage,
  isResolutionConfirmed,
  isSuccessfulTerritorySuggestion,
  needsOverrideReason,
} from "@/lib/uciProviderResolution";
import { formatUtilityTypeLabel } from "@/lib/uciSetupWorkflow";
import type {
  UciProviderResolutionListResponse,
  UciProviderSetupAddressSource,
  UtilityProvider,
} from "@/types/uci";
import { AlertTriangle, CheckCircle2, Loader2, MapPin, RefreshCw, Repeat2 } from "lucide-react";

type UciProviderResolutionPanelProps = {
  mutedClass: string;
  projectId: string | null;
  serviceTypes: string[];
  providers: UtilityProvider[];
  addressSourceAcknowledged: UciProviderSetupAddressSource | null;
  addressReady: boolean;
  resolutionState: UciProviderResolutionListResponse | null;
  resolutionLoading: boolean;
  resolutionActionLoading: boolean;
  coordinationRecordId?: string | null;
  getCoordinationRecordId?: (serviceType: string) => string | null;
  reassignmentLoading?: boolean;
  onResolve: (serviceType: string) => void;
  onConfirm: (params: { serviceType: string; providerId: string; notes?: string }) => void;
  onOverride: (params: {
    serviceType: string;
    providerId: string;
    overrideReason: string;
    notes?: string;
  }) => void;
  onReassign?: (params: {
    serviceType: string;
    providerId: string;
    reason: string;
    notes?: string;
  }) => void;
};

export function UciProviderResolutionPanel({
  mutedClass,
  projectId,
  serviceTypes,
  providers,
  addressSourceAcknowledged,
  addressReady,
  resolutionState,
  resolutionLoading,
  resolutionActionLoading,
  coordinationRecordId,
  getCoordinationRecordId,
  reassignmentLoading = false,
  onResolve,
  onConfirm,
  onOverride,
  onReassign,
}: UciProviderResolutionPanelProps) {
  const availableServiceTypes = useMemo(() => {
    const fromCatalog = [...new Set(serviceTypes.map((type) => type.trim().toLowerCase()).filter(Boolean))];
    return fromCatalog.length ? fromCatalog : ["electric"];
  }, [serviceTypes]);

  const [activeServiceType, setActiveServiceType] = useState(availableServiceTypes[0] ?? "electric");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState("");
  const [notes, setNotes] = useState("");
  const [reassignmentMode, setReassignmentMode] = useState(false);
  const [reassignmentReason, setReassignmentReason] = useState("");
  const [confirmReassignmentOpen, setConfirmReassignmentOpen] = useState(false);

  const activeResolution = resolutionState?.resolutions?.[activeServiceType] ?? null;
  const serviceProviders = useMemo(
    () => filterProvidersForServiceType(providers, activeServiceType),
    [providers, activeServiceType],
  );

  const confirmedProvider = findProviderById(
    providers,
    activeResolution?.confirmed_provider_id ?? selectedProviderId,
  );
  const suggestedProvider = findProviderById(providers, activeResolution?.suggested_provider_id);
  const overrideRequired = needsOverrideReason(activeResolution, selectedProviderId);
  const confirmed = isResolutionConfirmed(activeResolution);
  const hasAuthoritativeSuggestion = isSuccessfulTerritorySuggestion(activeResolution);
  const confirmationCopy = getProviderConfirmationSectionCopy(activeResolution);
  const activeCoordinationRecordId =
    getCoordinationRecordId?.(activeServiceType) ?? coordinationRecordId ?? null;
  const reassignmentTarget = findProviderById(providers, selectedProviderId);
  const canReassign =
    Boolean(onReassign && activeCoordinationRecordId && confirmedProvider && reassignmentMode);

  useEffect(() => {
    setReassignmentMode(false);
    setReassignmentReason("");
    setConfirmReassignmentOpen(false);
  }, [activeServiceType, activeResolution?.confirmed_provider_id]);

  useEffect(() => {
    if (confirmed) return;
    if (hasAuthoritativeSuggestion && activeResolution?.suggested_provider_id) {
      setSelectedProviderId(activeResolution.suggested_provider_id);
      return;
    }
    if (!hasAuthoritativeSuggestion) {
      setSelectedProviderId("");
      setOverrideReason("");
    }
  }, [
    activeResolution?.suggested_provider_id,
    activeResolution?.status,
    activeServiceType,
    confirmed,
    hasAuthoritativeSuggestion,
  ]);

  const handleSubmit = () => {
    if (!selectedProviderId) return;
    if (overrideRequired) {
      if (!overrideReason.trim()) return;
      onOverride({
        serviceType: activeServiceType,
        providerId: selectedProviderId,
        overrideReason: overrideReason.trim(),
        notes: notes.trim() || undefined,
      });
      return;
    }
    onConfirm({
      serviceType: activeServiceType,
      providerId: selectedProviderId,
      notes: notes.trim() || undefined,
    });
  };

  const handleReassignRequest = () => {
    if (!selectedProviderId || !reassignmentReason.trim()) return;
    setConfirmReassignmentOpen(true);
  };

  const handleReassignConfirm = () => {
    if (!selectedProviderId || !reassignmentReason.trim() || !onReassign) return;
    onReassign({
      serviceType: activeServiceType,
      providerId: selectedProviderId,
      reason: reassignmentReason.trim(),
      notes: notes.trim() || undefined,
    });
    setConfirmReassignmentOpen(false);
    setReassignmentMode(false);
    setReassignmentReason("");
    setNotes("");
  };

  if (!projectId) return null;

  return (
    <section className="space-y-4" data-testid="uci-step-provider-resolution">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-teal/35 bg-cream-raised text-sm font-semibold text-teal dark:bg-obsidian-raised">
          2b
        </div>
        <h3 className="text-base font-semibold text-ink-primary-light dark:text-foreground">
          Utility provider mapping
        </h3>
      </div>

      <div className="space-y-4 rounded-xl border border-cream-sunken/90 bg-cream/50 p-4 dark:border-teal/25 dark:bg-obsidian/35">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid max-w-xs gap-2">
            <Label>Service type</Label>
            <Select value={activeServiceType} onValueChange={setActiveServiceType}>
              <SelectTrigger data-testid="uci-resolution-service-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableServiceTypes.map((serviceType) => (
                  <SelectItem key={serviceType} value={serviceType}>
                    {formatUtilityTypeLabel(serviceType)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!addressReady || resolutionActionLoading || reassignmentLoading}
            onClick={() => onResolve(activeServiceType)}
            data-testid="uci-resolution-resolve-button"
          >
            {resolutionActionLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Run territory check
          </Button>
        </div>

        {resolutionLoading ? (
          <div className="flex items-center gap-2 text-sm" data-testid="uci-resolution-loading">
            <Loader2 className="h-4 w-4 animate-spin text-teal" />
            Loading provider mapping status…
          </div>
        ) : (
          <>
            <div
              className="rounded-lg border border-teal/20 bg-teal/[0.04] px-3 py-3 text-sm dark:bg-teal/[0.08]"
              data-testid="uci-resolution-status-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <MapPin className="h-4 w-4 text-teal" />
                <span className="font-medium text-ink-primary-light dark:text-foreground">
                  {resolutionState?.address_context?.formatted ??
                    activeResolution?.address?.formatted ??
                    "Project address pending"}
                </span>
                {activeResolution ? (
                  <Badge variant="outline">{formatResolutionStatusLabel(activeResolution.status)}</Badge>
                ) : (
                  <Badge variant="mutedLight">Not checked</Badge>
                )}
              </div>
              <p className={cn("mt-2 text-sm", mutedClass)} data-testid="uci-resolution-user-message">
                {getResolutionUserMessage(activeResolution)}
              </p>
              {activeResolution ? (
                <dl className={cn("mt-3 grid gap-2 text-xs sm:grid-cols-2", mutedClass)}>
                  <div>
                    <dt className="font-medium text-ink-primary-light dark:text-foreground">Confidence</dt>
                    <dd>{formatConfidenceLabel(activeResolution.confidence)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink-primary-light dark:text-foreground">Method</dt>
                    <dd>{formatResolutionMethodLabel(activeResolution.resolution_method)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink-primary-light dark:text-foreground">Data source</dt>
                    <dd>
                      {activeResolution.source?.name ?? "—"}
                      {activeResolution.source?.dataset_vintage
                        ? ` (${activeResolution.source.dataset_vintage})`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink-primary-light dark:text-foreground">
                      Address source
                    </dt>
                    <dd>{activeResolution.address?.source ?? addressSourceAcknowledged ?? "—"}</dd>
                  </div>
                </dl>
              ) : null}
            </div>

            {activeResolution?.boundary_risk ? (
              <div
                className="flex items-start gap-3 rounded-lg border border-amber-300/70 bg-amber-50/80 px-3 py-3 text-sm dark:border-amber-500/35 dark:bg-amber-950/20"
                data-testid="uci-resolution-boundary-warning"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                <p>This project is near a utility territory boundary. Human confirmation is required.</p>
              </div>
            ) : null}

            {suggestedProvider ? (
              <div
                className="rounded-lg border border-teal/30 bg-teal/[0.06] px-3 py-3 text-sm dark:bg-teal/[0.12]"
                data-testid="uci-resolution-suggested-provider"
              >
                <p className="font-medium text-ink-primary-light dark:text-foreground">
                  Suggested electric provider: {suggestedProvider.display_name ?? suggestedProvider.name}
                </p>
                <p className={cn("mt-1 text-xs", mutedClass)}>
                  Matched using the EIA electric service-territory map.
                  {activeResolution?.source?.dataset_vintage
                    ? ` Data vintage: ${activeResolution.source.dataset_vintage}.`
                    : ""}
                </p>
                <p className={cn("mt-1 text-xs", mutedClass)}>
                  Confidence: {formatConfidenceLabel(activeResolution?.confidence)} · Method:{" "}
                  {formatResolutionMethodLabel(activeResolution?.resolution_method)}
                </p>
              </div>
            ) : null}

            {activeResolution?.candidates?.length ? (
              <div className="space-y-2" data-testid="uci-resolution-candidates">
                <p className="text-sm font-medium text-ink-primary-light dark:text-foreground">
                  Alternative candidates
                </p>
                <ul className={cn("space-y-1 text-sm", mutedClass)}>
                  {activeResolution.candidates.map((candidate) => (
                    <li key={candidate.provider_id}>
                      {candidate.display_name} · {candidate.match_reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {confirmed && confirmedProvider && !reassignmentMode ? (
              <div
                className="space-y-3 rounded-lg border border-teal/30 bg-teal/[0.06] px-3 py-3 text-sm dark:bg-teal/[0.12]"
                data-testid="uci-resolution-confirmed"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-primary-light dark:text-foreground">
                      Confirmed: {confirmedProvider.display_name ?? confirmedProvider.name}
                    </p>
                    {activeResolution?.override_reason ? (
                      <p className={cn("mt-1 text-xs", mutedClass)}>
                        Override reason: {activeResolution.override_reason}
                      </p>
                    ) : null}
                    <p className={cn("mt-1 text-xs", mutedClass)}>
                      Provider mapping status only. Lifecycle stage and state are shown on the coordination
                      record.
                    </p>
                  </div>
                </div>
                {onReassign && activeCoordinationRecordId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={reassignmentLoading}
                    onClick={() => {
                      setReassignmentMode(true);
                      setSelectedProviderId("");
                      setReassignmentReason("");
                    }}
                    data-testid="uci-resolution-change-provider-button"
                  >
                    <Repeat2 className="mr-2 h-4 w-4" />
                    Change provider
                  </Button>
                ) : null}
              </div>
            ) : reassignmentMode && confirmedProvider ? (
              <div
                className="space-y-3 rounded-lg border border-dashed border-amber-300/70 bg-amber-50/50 px-3 py-3 dark:border-amber-500/35 dark:bg-amber-950/15"
                data-testid="uci-resolution-reassign-form"
              >
                <p className="text-sm font-medium text-ink-primary-light dark:text-foreground">
                  Reassign provider
                </p>
                <p className={cn("text-xs", mutedClass)}>
                  Currently assigned to {confirmedProvider.display_name ?? confirmedProvider.name}. Project
                  documents and Stage 2 engineering data stay intact. Provider-specific application drafts and
                  portal sync artifacts for the previous provider will be cleared and rebuilt for the new
                  provider.
                </p>
                <div className="grid max-w-md gap-2">
                  <Label htmlFor="uci-resolution-reassign-provider">New provider</Label>
                  <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                    <SelectTrigger
                      id="uci-resolution-reassign-provider"
                      data-testid="uci-resolution-reassign-provider-select"
                    >
                      <SelectValue placeholder="Choose a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {serviceProviders
                        .filter((provider) => provider.id !== confirmedProvider.id)
                        .map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.display_name ?? provider.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="uci-resolution-reassign-reason">Reason for change (required)</Label>
                  <Textarea
                    id="uci-resolution-reassign-reason"
                    value={reassignmentReason}
                    onChange={(event) => setReassignmentReason(event.target.value)}
                    placeholder="Explain why the assigned provider is being changed"
                    data-testid="uci-resolution-reassign-reason"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="uci-resolution-reassign-notes">Notes (optional)</Label>
                  <Textarea
                    id="uci-resolution-reassign-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional context for the audit trail"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={reassignmentLoading}
                    onClick={() => {
                      setReassignmentMode(false);
                      setSelectedProviderId("");
                      setReassignmentReason("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="bg-teal hover:bg-teal/90 text-white"
                    disabled={
                      !selectedProviderId ||
                      !reassignmentReason.trim() ||
                      reassignmentLoading ||
                      selectedProviderId === confirmedProvider.id
                    }
                    onClick={handleReassignRequest}
                    data-testid="uci-resolution-reassign-submit-button"
                  >
                    {reassignmentLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Review reassignment
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="space-y-3 rounded-lg border border-dashed border-teal/25 px-3 py-3"
                data-testid={
                  hasAuthoritativeSuggestion
                    ? "uci-resolution-confirm-override"
                    : "uci-resolution-manual-fallback"
                }
              >
                <p className="text-sm font-medium text-ink-primary-light dark:text-foreground">
                  {confirmationCopy.title}
                </p>
                <p className={cn("text-xs", mutedClass)}>{confirmationCopy.description}</p>
                <div className="grid max-w-md gap-2">
                  <Label htmlFor="uci-resolution-provider">Provider</Label>
                  <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                    <SelectTrigger id="uci-resolution-provider" data-testid="uci-resolution-provider-select">
                      <SelectValue placeholder="Choose a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {serviceProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.display_name ?? provider.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {overrideRequired ? (
                  <div className="grid gap-2">
                    <Label htmlFor="uci-resolution-override-reason">Override reason (required)</Label>
                    <Textarea
                      id="uci-resolution-override-reason"
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      placeholder="Explain why the suggested provider was not selected"
                      data-testid="uci-resolution-override-reason"
                    />
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="uci-resolution-notes">Notes (optional)</Label>
                  <Textarea
                    id="uci-resolution-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional context for the audit trail"
                  />
                </div>
                <Button
                  type="button"
                  className="bg-teal hover:bg-teal/90 text-white"
                  disabled={
                    !selectedProviderId ||
                    resolutionActionLoading ||
                    (overrideRequired && !overrideReason.trim())
                  }
                  onClick={handleSubmit}
                  data-testid="uci-resolution-confirm-button"
                >
                  {resolutionActionLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {overrideRequired ? "Confirm override" : confirmationCopy.primaryCta}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <AlertDialog open={confirmReassignmentOpen} onOpenChange={setConfirmReassignmentOpen}>
        <AlertDialogContent data-testid="uci-resolution-reassign-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm provider reassignment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Change {formatUtilityTypeLabel(activeServiceType)} provider from{" "}
                  <span className="font-medium text-foreground">
                    {confirmedProvider?.display_name ?? confirmedProvider?.name}
                  </span>{" "}
                  to{" "}
                  <span className="font-medium text-foreground">
                    {reassignmentTarget?.display_name ?? reassignmentTarget?.name ?? "the selected provider"}
                  </span>
                  ?
                </p>
                <p>
                  Project documents and generic Stage 2 engineering data will be preserved. Provider-specific
                  application drafts, portal sync data, and submission state for the previous provider will be
                  removed and regenerated for the new provider.
                </p>
                <p className="font-medium text-foreground">Reason: {reassignmentReason.trim()}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reassignmentLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canReassign || reassignmentLoading}
              onClick={(event) => {
                event.preventDefault();
                handleReassignConfirm();
              }}
              data-testid="uci-resolution-reassign-confirm-button"
            >
              {reassignmentLoading ? "Reassigning…" : "Reassign provider"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
