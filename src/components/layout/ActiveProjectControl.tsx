import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Briefcase, ChevronDown, KeyRound } from "lucide-react";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/lib/supabase";
import { isProjectDoxUrl } from "@/lib/portalView";
import {
  DASHBOARD_SELECTED_PROJECT_QUERY_KEY,
  SIDEBAR_PORTAL_CREDENTIAL_QUERY_KEY,
} from "@/lib/portalMonitorScrapeOptions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { formFieldsFromSelectedProject } from "@/lib/quickScrapeFormState";
import { cn } from "@/lib/utils";

const PERMIT_NUMBER_STORAGE_KEY_PREFIX = "epermit:permitNumber";

const FIELD_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/25";

/**
 * Header project-context control (Lovable places project context in the header,
 * not a large pinned sidebar block). Carries the full PP permit#/credential/create
 * workflow that previously lived in AppSidebar — moved, not deleted.
 *
 * Project/credential pickers are collapsed inline dropdowns (not always-expanded
 * lists, and not portaled Radix Select). Nested Select/Popover Content portals
 * outside this Popover and race dismiss/focus, so option clicks never commit.
 */
export function ActiveProjectControl() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const selectedProject = useSelectedProjectOptional();
  const { projects, loading, updateProject, fetchProjects, createProject } =
    useProjects();
  const [open, setOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [credentialPickerOpen, setCredentialPickerOpen] = useState(false);
  const [credentialQuery, setCredentialQuery] = useState("");
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const credentialPickerRef = useRef<HTMLDivElement>(null);

  const [sidebarCredentials, setSidebarCredentials] = useState<
    {
      id: string;
      jurisdiction: string;
      portal_username: string;
      login_url?: string;
    }[]
  >([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>("");

  const fetchCredentials = useCallback(async () => {
    if (!user) {
      setSidebarCredentials([]);
      return;
    }
    const { data, error } = await supabase
      .from("portal_credentials")
      .select("id, jurisdiction, portal_username, login_url")
      .eq("user_id", user.id)
      .order("jurisdiction", { ascending: true });
    if (error) {
      console.error("[ActiveProjectControl] Failed to load portal credentials:", error);
      return;
    }
    setSidebarCredentials(data || []);
  }, [user]);

  useEffect(() => {
    void fetchCredentials();
  }, [fetchCredentials]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`portal_credentials_header_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "portal_credentials",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void fetchCredentials();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, fetchCredentials]);

  const detectPortalTypeFromUrl = (
    url?: string | null,
  ): "accela" | "projectdox" | "unknown" => {
    if (!url) return "unknown";
    if (isProjectDoxUrl(url)) return "projectdox";
    const lower = url.toLowerCase();
    if (lower.includes("accela.com")) return "accela";
    return "unknown";
  };

  const handleCredentialChange = useCallback(
    async (value: string) => {
      const credId = value === "__none__" ? null : value;
      const previousValue = selectedCredentialId;
      setSelectedCredentialId(credId ?? "");

      if (!selectedProject?.selectedProjectId || !user) return;

      const updated = await updateProject(selectedProject.selectedProjectId, {
        credential_id: credId,
      });

      if (!updated) {
        setSelectedCredentialId(previousValue);
        toast.error("Failed to update credential");
        return;
      }

      const projectId = selectedProject.selectedProjectId;

      // Optimistically sync dashboard scrape identity so Portal Monitor does not
      // keep a stale null credential_id after header bind.
      queryClient.setQueryData(
        [DASHBOARD_SELECTED_PROJECT_QUERY_KEY, projectId, user.id],
        (prev: {
          id: string;
          permit_number: string | null;
          jurisdiction: string | null;
          credential_id: string | null;
          portal_data: unknown;
        } | null | undefined) => {
          if (prev && prev.id === projectId) {
            return { ...prev, credential_id: credId };
          }
          return {
            id: projectId,
            permit_number: updated.permit_number ?? null,
            jurisdiction: updated.jurisdiction ?? null,
            credential_id: credId,
            portal_data: null,
          };
        },
      );

      const { data: proj } = await supabase
        .from("projects")
        .select("portal_data, portal_status, last_checked_at, credential_id")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();

      // Verify the bind actually landed in DB (source of truth for scrape).
      const persistedCredentialId =
        (proj?.credential_id as string | null | undefined) ?? null;
      if (persistedCredentialId !== credId) {
        console.error(
          "[ActiveProjectControl] credential_id mismatch after update",
          { projectId, expected: credId, actual: persistedCredentialId },
        );
        setSelectedCredentialId(previousValue);
        toast.error(
          "Credential did not save on this project. Try selecting it again.",
        );
        void queryClient.invalidateQueries({
          queryKey: [DASHBOARD_SELECTED_PROJECT_QUERY_KEY],
        });
        return;
      }

      const existingType =
        (proj?.portal_data as { portalType?: string } | null)?.portalType || "unknown";
      const newCred = sidebarCredentials.find((c) => c.id === credId);
      const expectedType = detectPortalTypeFromUrl(newCred?.login_url);

      const shouldClear =
        !!proj?.portal_data &&
        expectedType !== "unknown" &&
        existingType !== "unknown" &&
        existingType !== expectedType;

      if (shouldClear) {
        await supabase
          .from("projects")
          .update({
            portal_data: null,
            portal_status: null,
            last_checked_at: null,
          })
          .eq("id", projectId);
        queryClient.setQueryData(
          [DASHBOARD_SELECTED_PROJECT_QUERY_KEY, projectId, user.id],
          (prev: {
            id: string;
            permit_number: string | null;
            jurisdiction: string | null;
            credential_id: string | null;
            portal_data: unknown;
          } | null | undefined) =>
            prev && prev.id === projectId
              ? { ...prev, portal_data: null, credential_id: credId }
              : prev,
        );
      }

      // Ensure Portal Monitor scrape options resolve from the newly selected
      // credential immediately (do not wait for a scrape / remount).
      void queryClient.invalidateQueries({
        queryKey: [SIDEBAR_PORTAL_CREDENTIAL_QUERY_KEY],
      });
      void queryClient.invalidateQueries({
        queryKey: [DASHBOARD_SELECTED_PROJECT_QUERY_KEY],
      });

      fetchProjects();
    },
    [
      selectedProject?.selectedProjectId,
      user,
      updateProject,
      fetchProjects,
      selectedCredentialId,
      sidebarCredentials,
      queryClient,
    ],
  );

  const [permitNumber, setPermitNumber] = useState("");
  const [createNewProject, setCreateNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectJurisdiction, setNewProjectJurisdiction] = useState("");
  const [newProjectAddress, setNewProjectAddress] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const selectedProjectData = selectedProject?.selectedProjectId
    ? projects.find((p) => p.id === selectedProject.selectedProjectId)
    : null;

  const persistPermitNumber = useCallback(
    (value: string) => {
      if (!user) return;
      try {
        const key = `${PERMIT_NUMBER_STORAGE_KEY_PREFIX}:${user.id}`;
        const trimmed = value.trim();
        if (trimmed === "") localStorage.removeItem(key);
        else localStorage.setItem(key, trimmed);
      } catch {
        // ignore
      }
    },
    [user?.id],
  );

  // Draft permit only when no project is selected (create-project flow).
  // Never restore a user-scoped draft over a selected project's permit.
  useEffect(() => {
    if (!user) {
      setPermitNumber("");
      return;
    }
    if (selectedProject?.selectedProjectId) return;
    try {
      const key = `${PERMIT_NUMBER_STORAGE_KEY_PREFIX}:${user.id}`;
      const raw = localStorage.getItem(key);
      setPermitNumber(raw ?? "");
    } catch {
      setPermitNumber("");
    }
  }, [user?.id, selectedProject?.selectedProjectId]);

  const selectedProjectId = selectedProject?.selectedProjectId ?? null;
  const selectedProjectPermit = selectedProjectData?.permit_number ?? null;
  const selectedProjectCredentialId = selectedProjectData?.credential_id ?? null;
  const hasSelectedProjectRow = !!selectedProjectData;
  const syncedProjectIdRef = useRef<string | null>(null);

  // Selected project UUID is source of truth: on project change, sync permit +
  // credential together. Credential also tracks same-project DB updates.
  // Do not overwrite an in-progress permit edit when only credential refreshes.
  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedCredentialId("");
      syncedProjectIdRef.current = null;
      return;
    }
    if (loading || !hasSelectedProjectRow) return;
    const fields = formFieldsFromSelectedProject({
      id: selectedProjectId,
      permit_number: selectedProjectPermit,
      credential_id: selectedProjectCredentialId,
    });
    if (!fields) return;

    const projectChanged = syncedProjectIdRef.current !== selectedProjectId;
    syncedProjectIdRef.current = selectedProjectId;

    setSelectedCredentialId(fields.credentialId);
    if (projectChanged) {
      setPermitNumber(fields.permitNumber);
      persistPermitNumber(fields.permitNumber);
    }
  }, [
    selectedProjectId,
    selectedProjectPermit,
    selectedProjectCredentialId,
    hasSelectedProjectRow,
    loading,
    persistPermitNumber,
  ]);

  const handlePermitBlur = useCallback(async () => {
    const trimmed = permitNumber.trim();
    persistPermitNumber(trimmed);

    // Quick Scrape reads projects.permit_number — keep the header field in sync with DB.
    const projectId = selectedProject?.selectedProjectId;
    if (!projectId || !user) return;

    const current = String(
      projects.find((p) => p.id === projectId)?.permit_number ?? "",
    ).trim();
    if (current === trimmed) return;

    const updated = await updateProject(projectId, {
      permit_number: trimmed || null,
    });
    if (!updated) {
      toast.error("Failed to save permit / application number on the project.");
      return;
    }
    fetchProjects();
  }, [
    permitNumber,
    persistPermitNumber,
    selectedProject?.selectedProjectId,
    user,
    projects,
    updateProject,
    fetchProjects,
  ]);

  const handleSelectValueChange = useCallback(
    (v: string) => {
      if (!selectedProject) return;
      if (v === "__none__") {
        selectedProject.setSelectedProjectId(null);
      } else {
        selectedProject.setSelectedProjectId(v);
      }
      setProjectPickerOpen(false);
      setProjectQuery("");
    },
    [selectedProject],
  );

  useEffect(() => {
    if (!open) {
      setProjectPickerOpen(false);
      setProjectQuery("");
      setCredentialPickerOpen(false);
      setCredentialQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (!projectPickerOpen && !credentialPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        projectPickerOpen &&
        projectPickerRef.current &&
        !projectPickerRef.current.contains(target)
      ) {
        setProjectPickerOpen(false);
        setProjectQuery("");
      }
      if (
        credentialPickerOpen &&
        credentialPickerRef.current &&
        !credentialPickerRef.current.contains(target)
      ) {
        setCredentialPickerOpen(false);
        setCredentialQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [projectPickerOpen, credentialPickerOpen]);

  const handleCreateNewProject = useCallback(async () => {
    const trimmed = permitNumber.trim();
    if (!trimmed || !selectedProject || !user) {
      toast.error("Enter a permit number first");
      return;
    }
    setCreatingProject(true);
    try {
      const name = newProjectName.trim() || trimmed;
      const newProject = await createProject({
        name,
        permit_number: trimmed,
        jurisdiction: newProjectJurisdiction.trim() || undefined,
        address: newProjectAddress.trim() || undefined,
      });
      if (newProject) {
        selectedProject.setSelectedProjectId(newProject.id);
        setCreateNewProject(false);
        setNewProjectName("");
        setNewProjectJurisdiction("");
        setNewProjectAddress("");
        fetchProjects();
        toast.success("Project created and linked");
        setOpen(false);
      }
    } finally {
      setCreatingProject(false);
    }
  }, [
    permitNumber,
    newProjectName,
    newProjectJurisdiction,
    newProjectAddress,
    selectedProject,
    user,
    createProject,
    fetchProjects,
  ]);

  useEffect(() => {
    if (createNewProject && permitNumber.trim()) setNewProjectName(permitNumber.trim());
  }, [createNewProject, permitNumber]);

  if (!selectedProject || !user) return null;

  const triggerLabel = selectedProjectData
    ? selectedProjectData.name
    : permitNumber.trim()
      ? `Permit ${permitNumber.trim()}`
      : "Select project";

  const projectPickerDisabled = loading || projects.length === 0;
  const selectedProjectValue = selectedProject.selectedProjectId ?? "__none__";
  const selectedCredentialValue = selectedCredentialId || "__none__";
  const selectedCredential = sidebarCredentials.find(
    (c) => c.id === selectedCredentialId,
  );
  const credentialTriggerLabel = selectedCredential
    ? `${selectedCredential.jurisdiction}${
        selectedCredential.portal_username
          ? ` — ${selectedCredential.portal_username}`
          : ""
      }`
    : "None (select a credential)";

  const normalizedProjectQuery = projectQuery.trim().toLowerCase();
  const filteredProjects = normalizedProjectQuery
    ? projects.filter((p) => {
        const haystack = `${p.name} ${p.permit_number ?? ""}`.toLowerCase();
        return haystack.includes(normalizedProjectQuery);
      })
    : projects;

  const normalizedCredentialQuery = credentialQuery.trim().toLowerCase();
  const filteredCredentials = normalizedCredentialQuery
    ? sidebarCredentials.filter((c) => {
        const haystack =
          `${c.jurisdiction} ${c.portal_username ?? ""}`.toLowerCase();
        return haystack.includes(normalizedCredentialQuery);
      })
    : sidebarCredentials;

  const listItemClass = (active: boolean) =>
    cn(
      "flex w-full items-start px-3 py-2 text-left text-sm transition-colors",
      active
        ? "bg-accent text-accent-foreground"
        : "text-foreground hover:bg-muted/80",
    );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 max-w-[7.5rem] shrink items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left sm:max-w-[10rem] md:max-w-[12rem] xl:max-w-[16rem]"
          title={triggerLabel}
          data-testid="header-active-project"
        >
          <Briefcase className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {triggerLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="pilot-kicker">Active project</div>
        <div className="space-y-1">
          <Label htmlFor="header-permit-number" className="text-xs text-muted-foreground">
            Permit / Application # <span className="text-destructive">*</span>
          </Label>
          <Input
            id="header-permit-number"
            placeholder="e.g. B2508799"
            value={permitNumber}
            onChange={(e) => setPermitNumber(e.target.value)}
            onBlur={() => {
              void handlePermitBlur();
            }}
            className={FIELD_CLASS}
          />
          <p className="text-[10px] text-muted-foreground">
            Saved on the selected project for Quick Scrape.
          </p>
        </div>
        <div className="space-y-1" ref={projectPickerRef}>
          <Label className="text-xs text-muted-foreground">Project</Label>
          <button
            type="button"
            data-testid="header-project-select"
            aria-haspopup="listbox"
            aria-expanded={projectPickerOpen}
            disabled={projectPickerDisabled}
            onClick={() => {
              setCredentialPickerOpen(false);
              setProjectPickerOpen((prev) => !prev);
            }}
            className={cn(
              "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm outline-none transition-colors",
              "hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/25",
              projectPickerDisabled && "pointer-events-none opacity-50",
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {selectedProjectData?.name ?? "Select a project"}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                projectPickerOpen && "rotate-180",
              )}
            />
          </button>
          {projectPickerOpen ? (
            <div className="overflow-hidden rounded-md border border-input bg-background shadow-sm">
              <Input
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
                placeholder="Search projects…"
                className="h-9 rounded-none border-0 border-b border-input focus-visible:ring-0"
                autoFocus
                data-testid="header-project-search"
              />
              <div
                role="listbox"
                aria-label="Select a project"
                className="max-h-44 overflow-y-auto"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedProjectValue === "__none__"}
                  className={listItemClass(selectedProjectValue === "__none__")}
                  onClick={() => handleSelectValueChange("__none__")}
                >
                  Select a project
                </button>
                {filteredProjects.map((p) => {
                  const active = selectedProjectValue === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-testid={`header-project-option-${p.id}`}
                      title={p.name}
                      className={listItemClass(active)}
                      onClick={() => handleSelectValueChange(p.id)}
                    >
                      <span className="min-w-0 truncate">{p.name}</span>
                    </button>
                  );
                })}
                {filteredProjects.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No matching projects
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {sidebarCredentials.length > 0 && (
          <div className="space-y-1" ref={credentialPickerRef}>
            <Label className="flex items-center gap-1 text-xs text-muted-foreground">
              <KeyRound className="h-3 w-3 text-primary" />
              Portal Credential
            </Label>
            <button
              type="button"
              data-testid="select-header-credential"
              aria-haspopup="listbox"
              aria-expanded={credentialPickerOpen}
              onClick={() => {
                setProjectPickerOpen(false);
                setCredentialPickerOpen((prev) => !prev);
              }}
              className={cn(
                "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm outline-none transition-colors",
                "hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/25",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{credentialTriggerLabel}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  credentialPickerOpen && "rotate-180",
                )}
              />
            </button>
            {credentialPickerOpen ? (
              <div className="overflow-hidden rounded-md border border-input bg-background shadow-sm">
                <Input
                  value={credentialQuery}
                  onChange={(e) => setCredentialQuery(e.target.value)}
                  placeholder="Search credentials…"
                  className="h-9 rounded-none border-0 border-b border-input focus-visible:ring-0"
                  autoFocus
                />
                <div
                  role="listbox"
                  aria-label="Select credential"
                  className="max-h-40 overflow-y-auto"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedCredentialValue === "__none__"}
                    className={listItemClass(selectedCredentialValue === "__none__")}
                    onClick={() => {
                      void handleCredentialChange("__none__");
                      setCredentialPickerOpen(false);
                      setCredentialQuery("");
                    }}
                  >
                    None (select a credential)
                  </button>
                  {filteredCredentials.map((cred) => {
                    const active = selectedCredentialValue === cred.id;
                    const label = `${cred.jurisdiction}${
                      cred.portal_username ? ` — ${cred.portal_username}` : ""
                    }`;
                    return (
                      <button
                        key={cred.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        title={label}
                        className={listItemClass(active)}
                        onClick={() => {
                          void handleCredentialChange(cred.id);
                          setCredentialPickerOpen(false);
                          setCredentialQuery("");
                        }}
                      >
                        <span className="min-w-0 truncate">{label}</span>
                      </button>
                    );
                  })}
                  {filteredCredentials.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      No matching credentials
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
        {!selectedProject.selectedProjectId && permitNumber.trim() && (
          <p className="text-xs text-muted-foreground">
            Select a project above or create one below.
          </p>
        )}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="header-create-new-project"
            checked={createNewProject}
            onCheckedChange={(c) => setCreateNewProject(!!c)}
            disabled={!permitNumber.trim()}
          />
          <Label
            htmlFor="header-create-new-project"
            className="cursor-pointer text-xs font-normal text-muted-foreground"
          >
            Or create a new project for this permit
          </Label>
        </div>
        {createNewProject && (
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2">
            <Input
              placeholder="Project name (default: permit #)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              className={FIELD_CLASS}
            />
            <Input
              placeholder="Jurisdiction (optional)"
              value={newProjectJurisdiction}
              onChange={(e) => setNewProjectJurisdiction(e.target.value)}
              className={FIELD_CLASS}
            />
            <Input
              placeholder="Address (optional)"
              value={newProjectAddress}
              onChange={(e) => setNewProjectAddress(e.target.value)}
              className={FIELD_CLASS}
            />
            <Button
              size="sm"
              className="w-full"
              onClick={handleCreateNewProject}
              disabled={creatingProject || !permitNumber.trim()}
            >
              {creatingProject ? "Creating…" : "Create project"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
