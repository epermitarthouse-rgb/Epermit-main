import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Filter,
  FolderKanban,
  LayoutGrid,
  List,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertBanner,
  MetricCard,
  PageHeader,
  Panel,
  ProgressLine,
  ServicePill,
  StatusPill,
} from "@/components/design/ProductPrimitives";
import { useAuth } from "@/hooks/useAuth";
import {
  useProjects,
  type CreateProjectData,
  type UpdateProjectData,
} from "@/hooks/useProjects";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import {
  PROJECT_STATUS_CONFIG,
  STATUS_ORDER,
  type Project,
  type ProjectStatus,
} from "@/types/project";
import { KanbanColumn } from "@/components/projects/KanbanColumn";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { ProjectDetailDialog } from "@/components/projects/ProjectDetailDialog";
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog";
import { FeatureTooltip } from "@/components/onboarding/FeatureTooltip";
import { useGettingStarted } from "@/hooks/useGettingStarted";
import { staggerContainer, staggerItem } from "@/components/animations/variants";
import { EmptyState } from "@/components/design/EmptyState";
import { cn } from "@/lib/utils";

type FilterKey =
  | "all"
  | "action"
  | "in_review"
  | "corrections"
  | "approved"
  | "draft";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All projects" },
  { key: "action", label: "Action needed" },
  { key: "in_review", label: "In review" },
  { key: "corrections", label: "Corrections" },
  { key: "draft", label: "Draft" },
  { key: "approved", label: "Approved" },
];

function statusTone(status: ProjectStatus): "default" | "good" | "warn" | "bad" {
  if (status === "approved") return "good";
  if (status === "corrections") return "bad";
  if (status === "in_review" || status === "submitted") return "warn";
  return "default";
}

function progressForStatus(status: ProjectStatus): number {
  const idx = STATUS_ORDER.indexOf(status);
  if (idx < 0) return 10;
  return Math.round(((idx + 1) / STATUS_ORDER.length) * 100);
}

export default function Projects() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { completeItem } = useGettingStarted();
  const {
    projects,
    loading,
    fetchProjects,
    refreshProjectById,
    createProject,
    updateProject,
    deleteProject,
  } = useProjects();
  const { setSelectedProjectId } = useSelectedProject();

  const [view, setView] = useState<"cards" | "kanban" | "list">("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [draggedProject, setDraggedProject] = useState<Project | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<ProjectStatus | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    const selectedId = selectedProject?.id;
    if (!selectedId) return;

    const canonical = projects.find((p) => p.id === selectedId);
    if (!canonical) {
      setSelectedProject(null);
      setDetailDialogOpen(false);
      setFormDialogOpen(false);
      setDeleteDialogOpen(false);
      return;
    }

    setSelectedProject((prev) => {
      if (prev?.id !== selectedId) return prev;
      return canonical;
    });
  }, [projects, selectedProject?.id]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return projects.filter((p) => {
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.jurisdiction?.toLowerCase().includes(q) ||
        p.city?.toLowerCase().includes(q) ||
        p.permit_number?.toLowerCase().includes(q) ||
        p.client_name?.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (filter === "all") return true;
      if (filter === "action") {
        return p.status === "corrections" || p.status === "submitted";
      }
      return p.status === filter;
    });
  }, [projects, searchQuery, filter]);

  const metrics = useMemo(() => {
    const corrections = projects.filter((p) => p.status === "corrections").length;
    const inFlight = projects.filter(
      (p) => p.status === "in_review" || p.status === "submitted",
    ).length;
    const withPortal = projects.filter((p) => !!p.portal_data || !!p.portal_status).length;
    return {
      total: projects.length,
      inFlight,
      withPortal,
      corrections,
    };
  }, [projects]);

  const handleCreateProject = () => {
    setSelectedProject(null);
    setFormDialogOpen(true);
  };

  const handleEditProject = (project: Project) => {
    setSelectedProject(project);
    setSelectedProjectId(project.id);
    setFormDialogOpen(true);
  };

  const handleViewProject = (project: Project) => {
    setSelectedProject(project);
    setSelectedProjectId(project.id);
    setDetailDialogOpen(true);
  };

  const handleDeleteClick = (project: Project) => {
    setSelectedProject(project);
    setDeleteDialogOpen(true);
  };

  const handleFormSubmit = async (data: CreateProjectData | UpdateProjectData) => {
    setFormLoading(true);
    try {
      if (selectedProject) {
        await updateProject(selectedProject.id, data);
      } else {
        const created = await createProject(data as CreateProjectData);
        if (created) {
          setSelectedProjectId(created.id);
          setSelectedProject(created);
        }
      }
      setFormDialogOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedProject) return;
    setDeleteLoading(true);
    try {
      await deleteProject(selectedProject.id);
      setDeleteDialogOpen(false);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleStatusChange = async (project: Project, newStatus: ProjectStatus) => {
    await updateProject(project.id, { status: newStatus });
  };

  const handleDragStart = (project: Project) => setDraggedProject(project);
  const handleDragEnd = () => {
    setDraggedProject(null);
    setDragOverStatus(null);
  };
  const handleDrop = async (status: ProjectStatus) => {
    if (draggedProject && draggedProject.status !== status) {
      await handleStatusChange(draggedProject, status);
    }
    setDraggedProject(null);
    setDragOverStatus(null);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Client workspace"
        title="Projects across permit expediting and utility coordination."
        body="Each project shows status, jurisdiction, portal linkage, and ownership so you can see what is moving and what is stalled."
        action={
          <FeatureTooltip
            id="projects_new_button"
            title="Create Your First Project"
            description="Click here to start tracking a new permit project. You can add project details, upload documents, and monitor status."
            position="left"
          >
            <button
              type="button"
              className="pilot-button-primary"
              onClick={() => {
                handleCreateProject();
                completeItem("create_project");
              }}
            >
              <Plus className="h-4 w-4" /> New Project
            </button>
          </FeatureTooltip>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Active projects"
          value={`${metrics.total}`}
          hint="Shared client workspace"
        />
        <MetricCard
          label="In flight"
          value={`${metrics.inFlight}`}
          hint="Submitted or in review"
          icon={ShieldAlert}
        />
        <MetricCard
          label="Portal-linked"
          value={`${metrics.withPortal}`}
          hint="Harvest / portal data present"
          icon={Wrench}
        />
        <MetricCard
          label="Corrections"
          value={`${metrics.corrections}`}
          hint="Needs operator action"
          icon={RadioTower}
        />
      </div>

      <AlertBanner
        tone="info"
        title="Projects carry permit and utility workflows"
        detail="Use Portal Harvest, Response Matrix, Permit Filing, and Utility Coordination from the shell — selecting a project here sets the active workspace."
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                "pilot-button-ghost py-2",
                filter === item.key && "border-primary bg-primary/10 text-primary",
              )}
              onClick={() => setFilter(item.key)}
            >
              <Filter className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Badge variant="outline" className="font-mono text-[11px] tabular-nums">
            {filteredProjects.length}{" "}
            {filteredProjects.length === 1 ? "project" : "projects"}
          </Badge>
          <Tabs
            value={view}
            onValueChange={(v) => setView(v as "cards" | "kanban" | "list")}
          >
            <TabsList className="h-10">
              <TabsTrigger value="cards" className="gap-1.5">
                <FolderKanban className="h-4 w-4" />
                Cards
              </TabsTrigger>
              <TabsTrigger value="kanban" className="gap-1.5">
                <LayoutGrid className="h-4 w-4" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-1.5">
                <List className="h-4 w-4" />
                List
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchProjects}
            disabled={loading}
            aria-label="Refresh projects"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      ) : view === "cards" ? (
        filteredProjects.length === 0 ? (
          <Panel>
            <EmptyState
              icon={FolderKanban}
              title={
                searchQuery.trim() || filter !== "all"
                  ? "No projects match your filters"
                  : "No projects yet"
              }
              body={
                searchQuery.trim() || filter !== "all"
                  ? "Try another filter or clear search."
                  : "Create your first project to get started."
              }
              action={
                !searchQuery.trim() && filter === "all" ? (
                  <Button onClick={handleCreateProject}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Project
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredProjects.map((project) => {
              const progress = progressForStatus(project.status);
              return (
                <Panel
                  key={project.id}
                  className="cursor-pointer transition-colors hover:border-primary"
                  onClick={() => handleViewProject(project)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="pilot-kicker">
                        {project.permit_number || project.id.slice(0, 8)}
                      </div>
                      <h2 className="mt-2 font-display text-2xl font-semibold text-foreground md:text-3xl">
                        {project.name}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[project.address, project.city, project.state]
                          .filter(Boolean)
                          .join(", ") || "Address not set"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusPill tone={statusTone(project.status)}>
                        {PROJECT_STATUS_CONFIG[project.status].label}
                      </StatusPill>
                      {project.portal_status ? (
                        <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-data text-[10px] uppercase tracking-wider text-muted-foreground">
                          {project.portal_status}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <ServicePill kind="permit">Permit expediting</ServicePill>
                    {project.service_type ? (
                      <ServicePill kind="utility">{project.service_type}</ServicePill>
                    ) : (
                      <ServicePill kind="utility">Utility coordination</ServicePill>
                    )}
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <Meta label="Client" value={project.client_name || "—"} />
                    <Meta label="Jurisdiction" value={project.jurisdiction || "—"} />
                    <Meta
                      label="Updated"
                      value={new Date(project.updated_at).toLocaleDateString()}
                    />
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{PROJECT_STATUS_CONFIG[project.status].label}</span>
                      <span>{progress}% pipeline</span>
                    </div>
                    <ProgressLine value={progress} />
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-4">
                    <div className="text-sm text-muted-foreground">
                      {project.deadline ? (
                        <>
                          Deadline:{" "}
                          <span className="text-foreground">
                            {new Date(project.deadline).toLocaleDateString()}
                          </span>
                        </>
                      ) : (
                        <span>No deadline set</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="pilot-button-ghost py-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditProject(project);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="pilot-button-ghost py-2 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(project);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>
        )
      ) : view === "kanban" ? (
        <motion.div
          className="-mx-1 flex min-w-0 gap-3 overflow-x-auto overscroll-x-contain pb-3 pt-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible lg:grid-cols-5"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {STATUS_ORDER.map((status) => (
            <motion.div
              key={status}
              variants={staggerItem}
              className="w-[min(280px,calc(100vw-3rem))] shrink-0 sm:w-auto sm:min-w-0 sm:self-start"
            >
              <KanbanColumn
                status={status}
                projects={filteredProjects.filter((p) => p.status === status)}
                onEdit={handleEditProject}
                onDelete={handleDeleteClick}
                onStatusChange={handleStatusChange}
                onView={handleViewProject}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                isDragOver={dragOverStatus === status}
              />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <motion.div
          className="space-y-2"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <div className="hidden grid-cols-12 gap-4 border-b border-border px-4 py-3 font-tight text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:grid">
            <div className="col-span-4">Project</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Jurisdiction</div>
            <div className="col-span-2">Location</div>
            <div className="col-span-2">Updated</div>
          </div>

          {filteredProjects.length === 0 ? (
            <Panel>
              <EmptyState
                icon={FolderKanban}
                title={
                  searchQuery.trim() || filter !== "all"
                    ? "No projects match your filters"
                    : "No projects yet"
                }
                body={
                  searchQuery.trim() || filter !== "all"
                    ? "Try another filter or clear search."
                    : "Create your first project to get started."
                }
                action={
                  !searchQuery.trim() && filter === "all" ? (
                    <Button onClick={handleCreateProject}>
                      <Plus className="mr-2 h-4 w-4" />
                      New Project
                    </Button>
                  ) : undefined
                }
              />
            </Panel>
          ) : (
            filteredProjects.map((project) => (
              <motion.div
                key={project.id}
                variants={staggerItem}
                className="grid cursor-pointer grid-cols-12 gap-4 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
                onClick={() => handleViewProject(project)}
              >
                <div className="col-span-12 md:col-span-4">
                  <p className="truncate font-semibold">{project.name}</p>
                  {project.permit_number ? (
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {project.permit_number}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-6 md:col-span-2">
                  <StatusPill tone={statusTone(project.status)}>
                    {PROJECT_STATUS_CONFIG[project.status].label}
                  </StatusPill>
                </div>
                <div className="col-span-6 truncate text-sm text-muted-foreground md:col-span-2">
                  {project.jurisdiction || "—"}
                </div>
                <div className="col-span-6 truncate text-sm text-muted-foreground md:col-span-2">
                  {[project.city, project.state].filter(Boolean).join(", ") || "—"}
                </div>
                <div className="col-span-6 font-mono text-sm tabular-nums text-muted-foreground md:col-span-2">
                  {new Date(project.updated_at).toLocaleDateString()}
                </div>
              </motion.div>
            ))
          )}
        </motion.div>
      )}

      <ProjectFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        project={selectedProject}
        onSubmit={handleFormSubmit}
        loading={formLoading}
      />

      <ProjectDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        project={selectedProject}
        onEdit={handleEditProject}
        onProjectBillingRefresh={async () => {
          if (!selectedProject) return;
          await refreshProjectById(selectedProject.id);
        }}
      />

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        project={selectedProject}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
      />
    </div>
  );
}

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="pilot-kicker">{label}</div>
    <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
  </div>
);
