import { useMemo, useState } from "react";
import { TenantContextBadge } from "@/components/uci/TenantContextBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  buildInitializedSlugSet,
  countSelectedProviders,
  deriveAddressPresentation,
  filterProvidersForPicker,
  formatAddressSourceLabel,
  formatProjectAddressLine,
  formatUtilityTypeLabel,
  getInitDisabledReasons,
  groupProvidersByUtilityType,
  getSupportedUtilityTypes,
  hasConfirmableAddress,
  providerDisplayLabel,
  sortProvidersForPicker,
} from "@/lib/uciSetupWorkflow";
import type { UciUtilityType } from "@/lib/uciUtilityTypes";
import type { Project } from "@/types/project";
import type {
  UciProviderSetupAddressSource,
  UciProviderSetupResponse,
  UciProviderResolutionListResponse,
  UtilityProvider,
} from "@/types/uci";
import { UciProviderResolutionPanel } from "@/components/uci/UciProviderResolutionPanel";
import { PERMITPILOT_DEMO_TENANT_ID } from "@/types/uci";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  Plus,
  Search,
} from "lucide-react";

const uciSectionTitleClass =
  "font-display text-2xl font-normal tracking-tight text-foreground !text-foreground";

type UciSetupWorkflowProps = {
  editorialCardClass: string;
  mutedClass: string;
  projects: Project[];
  projectsLoading: boolean;
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  tenantScopeId: string | null;
  providers: UtilityProvider[];
  providersLoading: boolean;
  providersLoadError: string | null;
  onRetryProviders: () => void;
  providerSetup: UciProviderSetupResponse | null;
  providerSetupLoading: boolean;
  providerResolution: UciProviderResolutionListResponse | null;
  providerResolutionLoading: boolean;
  providerResolutionActionLoading: boolean;
  onResolveProviderMapping: (serviceType: string) => void;
  onConfirmProviderMapping: (params: {
    serviceType: string;
    providerId: string;
    notes?: string;
  }) => void;
  onOverrideProviderMapping: (params: {
    serviceType: string;
    providerId: string;
    overrideReason: string;
    notes?: string;
  }) => void;
  onReassignProviderMapping?: (params: {
    serviceType: string;
    providerId: string;
    reason: string;
    notes?: string;
  }) => void;
  getCoordinationRecordIdForServiceType?: (serviceType: string) => string | null;
  providerReassignmentLoading?: boolean;
  providerUtilityFilter: string;
  onProviderUtilityFilterChange: (value: string) => void;
  providerCatalogTypes: string[];
  initPick: Record<string, boolean>;
  onInitPickChange: (slug: string, checked: boolean) => void;
  onClearSelectedProviders: () => void;
  onCreateProvider: (input: { name: string; utilityType: UciUtilityType }) => Promise<void>;
  providerCreating: boolean;
  addressSourceAcknowledged: UciProviderSetupAddressSource | null;
  onAddressSourceAcknowledged: (source: UciProviderSetupAddressSource) => void;
  unresolvedUtilityTypes: string[];
  onToggleUnresolvedUtilityType: (utilityType: string, checked: boolean) => void;
  uncoveredUtilityTypes: string[];
  providerSetupConfirmed: boolean;
  confirmedProviderIds: ReadonlySet<string>;
  onProviderSetupConfirmedChange: (checked: boolean) => void;
  initDisabledReasons: string[];
  initting: boolean;
  onInitialize: () => void;
  hasExistingRecords: boolean;
  setupExpanded: boolean;
  onSetupExpandedChange: (expanded: boolean) => void;
  formatAutomationLabel: (status: string | undefined) => string;
};

function StepHeading({
  step,
  title,
  complete,
}: {
  step: number;
  title: string;
  complete?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          complete
            ? "bg-teal text-white"
            : "border border-teal/35 bg-cream-raised text-teal dark:bg-obsidian-raised",
        )}
      >
        {complete ? <CheckCircle2 className="h-4 w-4" /> : step}
      </div>
      <h3 className="text-base font-semibold text-ink-primary-light dark:text-foreground">{title}</h3>
    </div>
  );
}

function ProviderDirectoryReference({
  providers,
  providersLoading,
  providersLoadError,
  onRetryProviders,
  mutedClass,
  formatAutomationLabel,
}: {
  providers: UtilityProvider[];
  providersLoading: boolean;
  providersLoadError: string | null;
  onRetryProviders: () => void;
  mutedClass: string;
  formatAutomationLabel: (status: string | undefined) => string;
}) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => sortProvidersForPicker(providers), [providers]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-dashed border-teal/25 bg-cream/40 dark:bg-obsidian/20">
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              data-testid="uci-provider-directory-toggle"
            >
              <div>
                <CardTitle className="text-lg font-medium text-ink-primary-light dark:text-foreground">
                  Provider directory
                </CardTitle>
                <CardDescription className={cn(mutedClass, "opacity-100")}>
                  Reference list of available utilities, legal names, and automation status.
                </CardDescription>
              </div>
              {open ? (
                <ChevronDown className="h-5 w-5 shrink-0 text-teal" />
              ) : (
                <ChevronRight className="h-5 w-5 shrink-0 text-teal" />
              )}
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {providersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-teal" />
              </div>
            ) : providersLoadError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
                <p className="font-medium">Provider directory could not be loaded.</p>
                <p className={cn("mt-1", mutedClass)}>{providersLoadError}</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetryProviders}>
                  Retry
                </Button>
              </div>
            ) : (
              <div className="grid max-h-[420px] gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {sorted.map((provider) => (
                  <div
                    key={provider.id}
                    className="rounded-lg border border-cream-sunken/90 bg-cream-raised/70 px-3 py-2.5 text-sm dark:border-teal/20 dark:bg-obsidian/50"
                  >
                    <p className="font-medium text-ink-primary-light dark:text-foreground">
                      {providerDisplayLabel(provider)}
                    </p>
                    <p className={cn("text-xs", mutedClass)}>
                      {formatUtilityTypeLabel(provider.utility_type)}
                      {provider.canonical_name ? ` · ${provider.canonical_name}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {provider.cet_relationship ? <Badge variant="brand">CET partner</Badge> : null}
                      <Badge variant="mutedLight">{formatAutomationLabel(provider.automation_status)}</Badge>
                      {provider.primary_portal_type ? (
                        <Badge variant="outline">{provider.primary_portal_type}</Badge>
                      ) : null}
                      {provider.is_active ? (
                        <Badge variant="ai">Active</Badge>
                      ) : (
                        <Badge variant="destructive">Inactive</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function UciSetupWorkflow({
  editorialCardClass,
  mutedClass,
  projects,
  projectsLoading,
  projectId,
  onProjectChange,
  tenantScopeId,
  providers,
  providersLoading,
  providersLoadError,
  onRetryProviders,
  providerSetup,
  providerSetupLoading,
  providerResolution,
  providerResolutionLoading,
  providerResolutionActionLoading,
  onResolveProviderMapping,
  onConfirmProviderMapping,
  onOverrideProviderMapping,
  onReassignProviderMapping,
  getCoordinationRecordIdForServiceType,
  providerReassignmentLoading = false,
  providerUtilityFilter,
  onProviderUtilityFilterChange,
  providerCatalogTypes,
  initPick,
  onInitPickChange,
  onClearSelectedProviders,
  onCreateProvider,
  providerCreating,
  addressSourceAcknowledged,
  onAddressSourceAcknowledged,
  unresolvedUtilityTypes,
  onToggleUnresolvedUtilityType,
  uncoveredUtilityTypes,
  providerSetupConfirmed,
  confirmedProviderIds,
  onProviderSetupConfirmedChange,
  initDisabledReasons,
  initting,
  onInitialize,
  hasExistingRecords,
  setupExpanded,
  onSetupExpandedChange,
  formatAutomationLabel,
}: UciSetupWorkflowProps) {
  const [providerSearchQuery, setProviderSearchQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createProviderOpen, setCreateProviderOpen] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderUtilityType, setNewProviderUtilityType] =
    useState<UciUtilityType>("electric");
  const supportedUtilityTypes = useMemo(
    () => getSupportedUtilityTypes(providerCatalogTypes),
    [providerCatalogTypes],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );

  const initializedSlugs = useMemo(
    () => buildInitializedSlugSet(providerSetup),
    [providerSetup],
  );

  const selectableProviders = useMemo(
    () => providers.filter((provider) => !initializedSlugs.has(provider.slug)),
    [providers, initializedSlugs],
  );

  const pickerProviders = useMemo(
    () =>
      filterProvidersForPicker(selectableProviders, {
        utilityTypeFilter: providerUtilityFilter,
        searchQuery: providerSearchQuery,
      }),
    [selectableProviders, providerUtilityFilter, providerSearchQuery],
  );

  const selectedProviders = useMemo(
    () =>
      sortProvidersForPicker(
        providers.filter((provider) => initPick[provider.slug] && !initializedSlugs.has(provider.slug)),
      ),
    [providers, initPick, initializedSlugs],
  );

  const selectedGroups = useMemo(
    () => groupProvidersByUtilityType(selectedProviders),
    [selectedProviders],
  );

  const addressPresentation = useMemo(
    () => deriveAddressPresentation(providerSetup, providerSetupLoading, addressSourceAcknowledged),
    [providerSetup, providerSetupLoading, addressSourceAcknowledged],
  );

  const projectAddressLine = selectedProject ? formatProjectAddressLine(selectedProject) : null;
  const initReady = initDisabledReasons.length === 0;
  const allSelectedProvidersConfirmed =
    selectedProviders.length > 0 &&
    selectedProviders.every((provider) => confirmedProviderIds.has(provider.id));

  const workflowBody = (
    <div className="space-y-8">
      <section className="space-y-4" data-testid="uci-step-project">
        <StepHeading step={1} title="Select project" complete={Boolean(projectId)} />
        <div className="space-y-3 rounded-xl border border-cream-sunken/90 bg-cream/50 p-4 dark:border-teal/25 dark:bg-obsidian/35">
          {tenantScopeId ? (
            <TenantContextBadge
              isDemo={tenantScopeId === PERMITPILOT_DEMO_TENANT_ID}
              tenantName={selectedProject?.name ?? "Workspace"}
            />
          ) : null}
          <div className="grid max-w-xl gap-2">
            <Label className="text-ink-primary-light">Project</Label>
            <Select
              value={projectId ?? ""}
              onValueChange={(value) => onProjectChange(value || null)}
              disabled={projectsLoading}
            >
              <SelectTrigger data-testid="uci-project-select">
                <SelectValue placeholder={projectsLoading ? "Loading projects…" : "Choose a project"} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                    {project.jurisdiction ? ` · ${project.jurisdiction}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProject ? (
            <div className="rounded-lg border border-teal/20 bg-teal/[0.04] px-3 py-3 text-sm dark:bg-teal/[0.08]">
              <p className="font-semibold text-ink-primary-light dark:text-foreground">{selectedProject.name}</p>
              {selectedProject.permit_number ? (
                <p className={cn("mt-1", mutedClass)}>Permit: {selectedProject.permit_number}</p>
              ) : null}
              {projectAddressLine ? (
                <p className={cn("mt-1", mutedClass)}>{projectAddressLine}</p>
              ) : (
                <p className={cn("mt-1", mutedClass)}>No project street address on file yet.</p>
              )}
              {selectedProject.jurisdiction ? (
                <p className={cn("mt-1 text-xs", mutedClass)}>Jurisdiction: {selectedProject.jurisdiction}</p>
              ) : null}
            </div>
          ) : (
            <p className={cn("text-sm", mutedClass)} data-testid="uci-no-project-empty">
              Choose a project to begin utility coordination setup.
            </p>
          )}
        </div>
      </section>

      {projectId ? (
        <>
          <section className="space-y-4" data-testid="uci-step-address">
            <StepHeading
              step={2}
              title="Confirm project address"
              complete={hasConfirmableAddress(addressPresentation) && Boolean(addressSourceAcknowledged)}
            />
            <div className="rounded-xl border border-cream-sunken/90 bg-cream/50 p-4 dark:border-teal/25 dark:bg-obsidian/35">
              {addressPresentation.mode === "loading" ? (
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-teal" />
                  Loading project address context…
                </div>
              ) : addressPresentation.mode === "missing" ? (
                <div
                  className="flex items-start gap-3 rounded-lg border border-amber-300/70 bg-amber-50/80 px-3 py-3 text-sm dark:border-amber-500/35 dark:bg-amber-950/20"
                  data-testid="uci-address-missing"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                  <p className="text-ink-primary-light dark:text-foreground">
                    Project address is missing. Add or confirm the address before selecting utility providers.
                  </p>
                </div>
              ) : addressPresentation.mode === "choose_source" ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-ink-primary-light dark:text-foreground">
                        Two addresses are on file. Choose which one applies to this project.
                      </p>
                      {addressPresentation.mismatchWarning ? (
                        <p className={cn("text-xs", mutedClass)}>{addressPresentation.mismatchWarning}</p>
                      ) : null}
                    </div>
                  </div>
                  {(providerSetup?.available_address_sources ?? [])
                    .filter((source) => source !== "none")
                    .map((source) => (
                      <label
                        key={source}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5 text-sm",
                          addressSourceAcknowledged === source
                            ? "border-teal/50 bg-teal/[0.08]"
                            : "border-cream-sunken/90 dark:border-teal/25",
                        )}
                      >
                        <input
                          type="radio"
                          name="uci-address-source"
                          className="mt-1"
                          checked={addressSourceAcknowledged === source}
                          onChange={() => onAddressSourceAcknowledged(source)}
                        />
                        <span>
                          <span className="block font-medium">{formatAddressSourceLabel(source)}</span>
                          <span className={cn("text-xs", mutedClass)}>
                            {source === "structured"
                              ? addressPresentation.structuredFormatted
                              : addressPresentation.scrapedFormatted}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              ) : (
                <div className="space-y-2" data-testid="uci-address-single">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary-light">
                    Active address
                  </p>
                  <p className="font-medium text-ink-primary-light dark:text-foreground">
                    {addressPresentation.activeFormatted}
                  </p>
                  <p className={cn("text-xs", mutedClass)}>
                    Source: {addressPresentation.activeSourceLabel}
                  </p>
                  {addressPresentation.structuredFormatted &&
                  addressPresentation.scrapedFormatted &&
                  addressPresentation.structuredFormatted !== addressPresentation.scrapedFormatted ? (
                    <p className={cn("text-xs", mutedClass)}>
                      Structured: {addressPresentation.structuredFormatted}
                      <br />
                      Scraped: {addressPresentation.scrapedFormatted}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <UciProviderResolutionPanel
            mutedClass={mutedClass}
            projectId={projectId}
            serviceTypes={providerCatalogTypes}
            providers={providers}
            addressSourceAcknowledged={addressSourceAcknowledged}
            addressReady={hasConfirmableAddress(addressPresentation) && Boolean(addressSourceAcknowledged)}
            resolutionState={providerResolution}
            resolutionLoading={providerResolutionLoading}
            resolutionActionLoading={providerResolutionActionLoading}
            getCoordinationRecordId={getCoordinationRecordIdForServiceType}
            reassignmentLoading={providerReassignmentLoading}
            onResolve={onResolveProviderMapping}
            onConfirm={onConfirmProviderMapping}
            onOverride={onOverrideProviderMapping}
            onReassign={onReassignProviderMapping}
          />

          <section className="space-y-4" data-testid="uci-step-providers">
            <StepHeading step={3} title="Select utility providers" complete={selectedProviders.length > 0} />
            <div className="space-y-4 rounded-xl border border-cream-sunken/90 bg-cream/50 p-4 dark:border-teal/25 dark:bg-obsidian/35">
              <p className={cn("text-sm", mutedClass)}>
                Search and add the utilities serving this project. CET partners appear first.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="grid flex-1 gap-2 sm:min-w-[220px]">
                  <Label htmlFor="uci-provider-search">Search providers</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="uci-provider-search"
                      value={providerSearchQuery}
                      onChange={(event) => setProviderSearchQuery(event.target.value)}
                      placeholder="Search by name, legal name, or type"
                      className="pl-9"
                      data-testid="uci-provider-search"
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:w-[180px]">
                  <Label>Utility type</Label>
                  <Select value={providerUtilityFilter} onValueChange={onProviderUtilityFilterChange}>
                    <SelectTrigger data-testid="uci-provider-type-filter">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {supportedUtilityTypes.map((utilityType) => (
                        <SelectItem key={utilityType} value={utilityType}>
                          {formatUtilityTypeLabel(utilityType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="justify-start" data-testid="uci-add-provider-trigger">
                    <Plus className="mr-2 h-4 w-4" />
                    Add utility provider
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(100vw-2rem,420px)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search providers…"
                      value={providerSearchQuery}
                      onValueChange={setProviderSearchQuery}
                    />
                    <CommandList>
                      <CommandEmpty>No matching providers.</CommandEmpty>
                      {groupProvidersByUtilityType(pickerProviders).map((group) => (
                        <CommandGroup key={group.utilityType} heading={group.label}>
                          {group.providers.map((provider) => (
                            <CommandItem
                              key={provider.id}
                              value={provider.slug}
                              onSelect={() => {
                                onInitPickChange(provider.slug, true);
                                setPickerOpen(false);
                              }}
                            >
                              <div className="flex min-w-0 flex-col">
                                <span className="font-medium">{providerDisplayLabel(provider)}</span>
                                <span className="text-xs text-muted-foreground">
                                  {formatUtilityTypeLabel(provider.utility_type)}
                                  {provider.cet_relationship ? " · CET partner" : ""}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Collapsible open={createProviderOpen} onOpenChange={setCreateProviderOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="uci-create-provider-toggle"
                  >
                    Provider not listed? Create one
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 grid gap-3 rounded-lg border border-dashed border-teal/25 p-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                    <div className="grid gap-2">
                      <Label htmlFor="uci-new-provider-name">Provider name</Label>
                      <Input
                        id="uci-new-provider-name"
                        value={newProviderName}
                        onChange={(event) => setNewProviderName(event.target.value)}
                        placeholder="Enter the serving utility"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Utility type</Label>
                      <Select
                        value={newProviderUtilityType}
                        onValueChange={(value) =>
                          setNewProviderUtilityType(value as UciUtilityType)
                        }
                      >
                        <SelectTrigger data-testid="uci-new-provider-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {supportedUtilityTypes.map((utilityType) => (
                            <SelectItem key={utilityType} value={utilityType}>
                              {formatUtilityTypeLabel(utilityType)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      disabled={!newProviderName.trim() || providerCreating}
                      onClick={async () => {
                        await onCreateProvider({
                          name: newProviderName.trim(),
                          utilityType: newProviderUtilityType,
                        });
                        setNewProviderName("");
                        setCreateProviderOpen(false);
                      }}
                      data-testid="uci-create-provider-submit"
                    >
                      {providerCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Create
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {initializedSlugs.size > 0 ? (
                <div className="rounded-lg border border-cream-sunken/80 bg-cream/40 px-3 py-2 text-xs dark:border-teal/20 dark:bg-obsidian/30">
                  <p className="font-medium text-ink-primary-light dark:text-foreground">Already initialized</p>
                  <p className={cn("mt-1", mutedClass)}>
                    Providers with existing coordination records are hidden from selection.
                  </p>
                </div>
              ) : null}

              <div className="space-y-3" data-testid="uci-selected-providers">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-ink-primary-light">Selected providers</Label>
                  {selectedProviders.length > 0 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={onClearSelectedProviders}>
                      Clear selected
                    </Button>
                  ) : null}
                </div>
                {selectedProviders.length === 0 ? (
                  <p className={cn("rounded-lg border border-dashed px-3 py-4 text-sm", mutedClass)}>
                    No providers selected yet. Use search or “Add utility provider” to build your list.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedGroups.map((group) => (
                      <div key={group.utilityType} className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary-light">
                          {group.label}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {group.providers.map((provider) => (
                            <div
                              key={provider.id}
                              className="inline-flex items-center gap-2 rounded-full border border-teal/30 bg-teal/[0.06] px-3 py-1.5 text-sm dark:bg-teal/[0.12]"
                            >
                              <span className="font-medium">{providerDisplayLabel(provider)}</span>
                              {provider.cet_relationship ? (
                                <Badge variant="brand" className="text-[10px]">
                                  CET
                                </Badge>
                              ) : null}
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => onInitPickChange(provider.slug, false)}
                                aria-label={`Remove ${providerDisplayLabel(provider)}`}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {uncoveredUtilityTypes.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-cream-sunken/90 bg-cream/40 p-3 dark:border-teal/25 dark:bg-obsidian/30">
                  <Label className="text-ink-primary-light">
                    Utility types without a selected provider (optional)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {uncoveredUtilityTypes.map((utilityType) => {
                      const marked = unresolvedUtilityTypes.includes(utilityType);
                      return (
                        <label
                          key={utilityType}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-cream-sunken/90 px-2.5 py-1.5 text-xs dark:border-teal/25"
                        >
                          <Checkbox
                            checked={marked}
                            onCheckedChange={(checked) =>
                              onToggleUnresolvedUtilityType(utilityType, Boolean(checked))
                            }
                          />
                          <span>{formatUtilityTypeLabel(utilityType)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-4" data-testid="uci-step-confirm">
            <StepHeading
              step={4}
              title="Confirm selections"
              complete={providerSetupConfirmed && selectedProviders.length > 0}
            />
            <div className="space-y-4 rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-950/15">
              <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
                Electric territory suggestions use available service-territory data. Other supported utility
                types remain manual until authoritative territory datasets are available.
              </p>
              {providerSetup?.territory_matching_message ? (
                <p className={cn("text-xs", mutedClass)}>{providerSetup.territory_matching_message}</p>
              ) : null}
              {allSelectedProvidersConfirmed ? (
                <div
                  className="flex items-start gap-3 rounded-lg border border-teal/25 bg-white/70 px-3 py-3 text-sm dark:border-teal/35 dark:bg-obsidian/40"
                  data-testid="uci-provider-confirmation-carried-forward"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
                  <span className="text-ink-primary-light dark:text-foreground">
                    Provider confirmation carried forward. Choose scopes, then initialize coordination records.
                  </span>
                </div>
              ) : (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-teal/25 bg-white/70 px-3 py-3 text-sm dark:border-teal/35 dark:bg-obsidian/40">
                  <Checkbox
                    checked={providerSetupConfirmed}
                    disabled={providerSetupLoading || addressPresentation.mode === "missing"}
                    onCheckedChange={(checked) => onProviderSetupConfirmedChange(Boolean(checked))}
                    className="mt-0.5 shrink-0"
                    data-testid="uci-provider-confirm-checkbox"
                  />
                  <span className="text-ink-primary-light dark:text-foreground">
                    I confirm the additional manual provider selections and scopes for this project.
                  </span>
                </label>
              )}
              <div className="space-y-2">
                <Button
                  className="bg-teal hover:bg-teal/90 text-white"
                  disabled={!initReady}
                  onClick={onInitialize}
                  data-testid="uci-init-button"
                >
                  {initting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Initialize coordination
                </Button>
                {!initReady ? (
                  <ul className={cn("list-disc space-y-1 pl-5 text-xs", mutedClass)} data-testid="uci-init-disabled-reasons">
                    {initDisabledReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className={cn(editorialCardClass, "text-ink-primary-light")}>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className={uciSectionTitleClass}>Set up utility coordination</CardTitle>
              <CardDescription className={cn(mutedClass, "opacity-100")}>
                Select and confirm the utilities serving this project.
              </CardDescription>
            </div>
            {hasExistingRecords ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSetupExpandedChange(!setupExpanded)}
                data-testid="uci-setup-toggle"
              >
                {setupExpanded ? "Hide setup" : "Add another utility"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        {(!hasExistingRecords || setupExpanded) && <CardContent>{workflowBody}</CardContent>}
        {hasExistingRecords && !setupExpanded ? (
          <CardContent>
            <p className={cn("text-sm", mutedClass)}>
              Coordination is already initialized for this project. Use “Add another utility” to select more
              providers.
            </p>
          </CardContent>
        ) : null}
      </Card>

      {projectId ? (
        <ProviderDirectoryReference
          providers={providers}
          providersLoading={providersLoading}
          providersLoadError={providersLoadError}
          onRetryProviders={onRetryProviders}
          mutedClass={mutedClass}
          formatAutomationLabel={formatAutomationLabel}
        />
      ) : null}
    </div>
  );
}
