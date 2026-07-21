import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useProjects, CreateProjectData, UpdateProjectData } from '@/hooks/useProjects';
import { useSelectedProject } from '@/contexts/SelectedProjectContext';
import { Project, ProjectStatus, STATUS_ORDER, PROJECT_STATUS_CONFIG } from '@/types/project';
import { KanbanColumn } from '@/components/projects/KanbanColumn';
import { ProjectFormDialog } from '@/components/projects/ProjectFormDialog';
import { ProjectDetailDialog } from '@/components/projects/ProjectDetailDialog';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { 
  Plus, 
  Search, 
  LayoutGrid, 
  List,
  FolderKanban,
  RefreshCw
} from 'lucide-react';
import { staggerContainer, staggerItem } from '@/components/animations/variants';
import { FeatureTooltip } from '@/components/onboarding/FeatureTooltip';
import { useGettingStarted } from '@/hooks/useGettingStarted';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

/** Toolbar segmented control: inactive = navy-deep on cream track; active = navy-deep pill + white text. */
const PROJECTS_VIEW_TAB_CLASSES =
  'gap-2 px-4 font-tight font-medium transition-colors rounded-md text-navy-deep/80 hover:bg-cream-raised/90 hover:text-navy-deep data-[state=active]:bg-navy-deep data-[state=active]:font-semibold data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:hover:bg-navy-deep data-[state=active]:hover:text-white [&_svg]:shrink-0 [&_svg]:text-current';

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
    getProjectsByStatus 
  } = useProjects();
  const { setSelectedProjectId } = useSelectedProject();

  // View state
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog states
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Drag and drop state
  const [draggedProject, setDraggedProject] = useState<Project | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<ProjectStatus | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  /** Keep dialogs aligned with canonical rows after refetches (e.g. billing reset in Supabase). */
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

  // Filter projects by search
  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.jurisdiction?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.city?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.permit_number?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getFilteredProjectsByStatus = (status: ProjectStatus) => {
    return filteredProjects.filter(p => p.status === status);
  };

  // Handlers
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

  // Drag and drop handlers
  const handleDragStart = (project: Project) => {
    setDraggedProject(project);
  };

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
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <EditorialPageHeader
        eyebrow="PORTFOLIO"
        title={
          <span className="inline-flex flex-wrap items-center gap-2 sm:gap-3">
            <FolderKanban className="h-7 w-7 shrink-0 text-gold-deep sm:h-9 sm:w-9" />
            <span>Projects</span>
          </span>
        }
        description="Manage your permit projects and track their status."
      />

      <section className="py-4 pb-10 sm:py-5 md:pb-12">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 md:px-8">
          {/* Toolbar — single cohesive row */}
          <motion.div
            className="mb-5 flex flex-col gap-4 rounded-2xl border border-cream-sunken bg-card p-4 shadow-sm ring-1 ring-navy-deep/10 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:p-4 md:p-5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <div className="relative min-w-0 flex-1 sm:max-w-md md:max-w-lg">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/55" />
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-cream-sunken bg-cream-raised pl-9 font-sans text-navy-deep shadow-inner placeholder:text-navy/55 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
              />
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <Badge
                variant="outline"
                className="border-white/20 bg-white/10 px-3 py-1 font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white shadow-none"
              >
                {filteredProjects.length} {filteredProjects.length === 1 ? 'project' : 'projects'}
              </Badge>

              <Tabs value={view} onValueChange={(v) => setView(v as 'kanban' | 'list')} className="w-full sm:w-auto">
                <TabsList className="grid h-10 w-full grid-cols-2 gap-1 rounded-lg border border-cream-sunken bg-cream-sunken p-1 sm:inline-grid sm:w-auto">
                  <TabsTrigger value="kanban" className={PROJECTS_VIEW_TAB_CLASSES}>
                    <LayoutGrid className="h-4 w-4" />
                    Kanban
                  </TabsTrigger>
                  <TabsTrigger value="list" className={PROJECTS_VIEW_TAB_CLASSES}>
                    <List className="h-4 w-4" />
                    List
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <Button
                variant="outlineGold"
                size="icon"
                className="shrink-0 border-cream-sunken bg-cream-raised text-gold-deep hover:bg-cream-raised hover:text-gold focus-visible:ring-2 focus-visible:ring-primary/20 disabled:border-cream-sunken disabled:text-navy/50 disabled:opacity-[0.88]"
                onClick={fetchProjects}
                disabled={loading}
                aria-label="Refresh projects"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>

              <FeatureTooltip
                id="projects_new_button"
                title="Create Your First Project"
                description="Click here to start tracking a new permit project. You can add project details, upload documents, and monitor status."
                position="left"
              >
                <Button
                  variant="gold"
                  className="min-w-[10rem] shrink-0 shadow-cream sm:min-w-0"
                  onClick={() => {
                    handleCreateProject();
                    completeItem('create_project');
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New Project
                </Button>
              </FeatureTooltip>
            </div>
          </motion.div>

          {/* Content */}
          {loading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {STATUS_ORDER.map((status) => (
                <div key={status} className="space-y-4">
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-32 w-full rounded-lg" />
                  <Skeleton className="h-32 w-full rounded-lg" />
                </div>
              ))}
            </div>
          ) : view === 'kanban' ? (
            <motion.div
              className="-mx-1 flex min-w-0 gap-3 overflow-x-auto overscroll-x-contain pb-3 pt-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 sm:overflow-visible sm:rounded-2xl sm:border sm:border-cream-sunken sm:bg-gradient-to-b sm:from-card sm:to-cream-raised sm:p-4 sm:shadow-sm sm:ring-1 sm:ring-navy-deep/10"
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
                    projects={getFilteredProjectsByStatus(status)}
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
              {/* List Header */}
              <div className="hidden md:grid grid-cols-12 gap-4 rounded-t-xl border-b border-cream-sunken bg-cream-raised px-4 py-3 font-tight text-[11px] font-semibold uppercase tracking-[0.12em] text-navy/72">
                <div className="col-span-4">Project</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Jurisdiction</div>
                <div className="col-span-2">Location</div>
                <div className="col-span-2">Updated</div>
              </div>

              {filteredProjects.length === 0 ? (
                <Card className="rounded-xl border-dashed border-navy-deep/20 bg-card shadow-sm md:rounded-b-xl md:rounded-t-none">
                  <CardContent className="space-y-2 py-14 text-center">
                    {searchQuery.trim() ? (
                      <>
                        <p className="font-medium text-navy-deep">No projects match your search</p>
                        <p className="text-sm leading-relaxed text-navy/70">
                          Try another term or clear the search.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-navy-deep">No projects yet</p>
                        <p className="text-sm leading-relaxed text-navy/70">
                          Create your first project to get started.
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
              ) : (
                filteredProjects.map((project) => {
                  const statusConfig = PROJECT_STATUS_CONFIG[project.status];
                  return (
                    <motion.div
                      key={project.id}
                      variants={staggerItem}
                      className="grid cursor-pointer grid-cols-12 gap-4 rounded-xl border border-border bg-card px-4 py-3.5 text-foreground shadow-sm transition-[background-color,border-color,box-shadow] hover:border-primary/40 hover:bg-muted/50 hover:shadow-md dark:border-navy-line/35 dark:bg-navy-deep dark:text-white dark:ring-1 dark:ring-white/10 dark:hover:bg-navy"
                      onClick={() => handleViewProject(project)}
                    >
                      <div className="col-span-12 md:col-span-4">
                        <p className="truncate font-semibold text-foreground dark:text-white">{project.name}</p>
                        {project.permit_number ? (
                          <p className="mt-0.5 font-mono text-xs tabular-nums tracking-tight text-muted-foreground dark:text-white/70">
                            {project.permit_number}
                          </p>
                        ) : null}
                      </div>
                      <div className="col-span-6 md:col-span-2">
                        <Badge className={`${statusConfig.bgColor} ${statusConfig.color} border-0 font-tight`}>
                          {statusConfig.label}
                        </Badge>
                      </div>
                      <div className="col-span-6 md:col-span-2 truncate text-sm text-muted-foreground dark:text-white/70">
                        {project.jurisdiction || '—'}
                      </div>
                      <div className="col-span-6 md:col-span-2 truncate text-sm text-muted-foreground dark:text-white/70">
                        {[project.city, project.state].filter(Boolean).join(', ') || '—'}
                      </div>
                      <div className="col-span-6 md:col-span-2 font-mono text-sm tabular-nums text-muted-foreground dark:text-white/70">
                        {new Date(project.updated_at).toLocaleDateString()}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </motion.div>
          )}
        </div>
      </section>

      {/* Dialogs */}
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
