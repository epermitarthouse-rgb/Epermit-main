import { useCallback, useEffect, useState } from "react";
import { Briefcase, ChevronDown, KeyRound } from "lucide-react";
import { useSelectedProjectOptional } from "@/contexts/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/lib/supabase";
import { isProjectDoxUrl } from "@/lib/portalView";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const PERMIT_NUMBER_STORAGE_KEY_PREFIX = "epermit:permitNumber";

const FIELD_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/25";

/**
 * Header project-context control (Lovable places project context in the header,
 * not a large pinned sidebar block). Carries the full PP permit#/credential/create
 * workflow that previously lived in AppSidebar — moved, not deleted.
 */
export function ActiveProjectControl() {
  const { user } = useAuth();
  const selectedProject = useSelectedProjectOptional();
  const { projects, loading, updateProject, fetchProjects, createProject } =
    useProjects();
  const [open, setOpen] = useState(false);

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

  useEffect(() => {
    if (!selectedProject?.selectedProjectId) {
      setSelectedCredentialId("");
      return;
    }
    if (loading) return;
    const p = projects.find((pr) => pr.id === selectedProject.selectedProjectId);
    if (!p) return;
    const cid = p.credential_id;
    setSelectedCredentialId(cid ? String(cid) : "");
  }, [selectedProject?.selectedProjectId, projects, loading]);

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

      const { data: proj } = await supabase
        .from("projects")
        .select("portal_data, portal_status, last_checked_at")
        .eq("id", selectedProject.selectedProjectId)
        .eq("user_id", user.id)
        .maybeSingle();

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
          .eq("id", selectedProject.selectedProjectId);
      }

      fetchProjects();
    },
    [
      selectedProject?.selectedProjectId,
      user,
      updateProject,
      fetchProjects,
      selectedCredentialId,
      sidebarCredentials,
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

  useEffect(() => {
    if (!user) {
      setPermitNumber("");
      return;
    }
    try {
      const key = `${PERMIT_NUMBER_STORAGE_KEY_PREFIX}:${user.id}`;
      const raw = localStorage.getItem(key);
      setPermitNumber(raw ?? "");
    } catch {
      setPermitNumber("");
    }
  }, [user?.id]);

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

  useEffect(() => {
    if (!selectedProjectData) return;
    const projectPermit = String(selectedProjectData.permit_number ?? "").trim();
    if (projectPermit && !permitNumber.trim()) {
      setPermitNumber(projectPermit);
      persistPermitNumber(projectPermit);
    }
  }, [selectedProjectData?.id, selectedProjectData?.permit_number]);

  const handleSelectValueChange = useCallback(
    (v: string) => {
      if (!selectedProject) return;
      if (v === "__none__") {
        selectedProject.setSelectedProjectId(null);
        return;
      }
      selectedProject.setSelectedProjectId(v);
    },
    [selectedProject],
  );

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex max-w-[150px] items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left sm:max-w-[200px] md:max-w-[260px]"
          title="Active project"
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
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Project</Label>
          <Select
            value={selectedProject.selectedProjectId ?? "__none__"}
            onValueChange={handleSelectValueChange}
            disabled={loading || (!permitNumber.trim() && projects.length === 0)}
          >
            <SelectTrigger className={FIELD_CLASS} data-testid="header-project-select">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Select a project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.permit_number ? ` · ${p.permit_number}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sidebarCredentials.length > 0 && (
          <div className="space-y-1">
            <Label className="flex items-center gap-1 text-xs text-muted-foreground">
              <KeyRound className="h-3 w-3 text-primary" />
              Portal Credential
            </Label>
            <Select value={selectedCredentialId || "__none__"} onValueChange={handleCredentialChange}>
              <SelectTrigger className={FIELD_CLASS} data-testid="select-header-credential">
                <SelectValue placeholder="Select credential" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (select a credential)</SelectItem>
                {sidebarCredentials.map((cred) => (
                  <SelectItem key={cred.id} value={cred.id}>
                    {cred.jurisdiction}
                    {cred.portal_username ? ` — ${cred.portal_username}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
