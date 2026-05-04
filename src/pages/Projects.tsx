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

export default function Projects() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { completeItem } = useGettingStarted();
  const {
    projects, 
    loading, 
    fetchProjects, 
    createProject, 
    updateProject, 
    deleteProject,
    getProjectsByStatus 
  } = useProjects();

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
    setFormDialogOpen(true);
  };

  const handleViewProject = (project: Project) => {
    setSelectedProject(project);
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
        await createProject(data as CreateProjectData);
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
    <div className="min-h-screen bg-cream text-ink-primary-light">
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

      <section className="py-4 pb-12 sm:py-6 md:py-8">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
          <motion.div
            className="mb-6 flex flex-wrap items-center justify-end gap-2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
              <Button variant="outlineGold" size="icon" onClick={fetchProjects} disabled={loading} aria-label="Refresh projects">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <FeatureTooltip
                id="projects_new_button"
                title="Create Your First Project"
                description="Click here to start tracking a new permit project. You can add project details, upload documents, and monitor status."
                position="left"
              >
                <Button variant="gold" onClick={() => { handleCreateProject(); completeItem('create_project'); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Project
                </Button>
              </FeatureTooltip>
          </motion.div>

          {/* Toolbar */}
          <motion.div
            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">{filteredProjects.length} projects</Badge>
              </div>
              <Tabs value={view} onValueChange={(v) => setView(v as 'kanban' | 'list')}>
                <TabsList>
                  <TabsTrigger value="kanban">
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    Kanban
                  </TabsTrigger>
                  <TabsTrigger value="list">
                    <List className="h-4 w-4 mr-2" />
                    List
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </motion.div>

          {/* Content */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
              className="flex overflow-x-auto gap-4 pb-2 -mx-3 sm:mx-0 sm:grid sm:grid-cols-3 lg:grid-cols-5 sm:overflow-visible min-w-0"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {STATUS_ORDER.map((status) => (
                <motion.div key={status} variants={staggerItem} className="flex-shrink-0 w-[280px] sm:w-auto sm:min-w-0">
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
              <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 text-sm font-medium text-muted-foreground border-b border-border bg-muted/30 rounded-t-lg">
                <div className="col-span-4">Project</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Jurisdiction</div>
                <div className="col-span-2">Location</div>
                <div className="col-span-2">Updated</div>
              </div>

              {filteredProjects.length === 0 ? (
                <Card className="border-dashed border-border bg-muted/15">
                  <CardContent className="py-14 text-center text-muted-foreground space-y-1">
                    {searchQuery.trim() ? (
                      <>
                        <p className="font-medium text-foreground">No projects match your search</p>
                        <p className="text-sm">Try another term or clear the search.</p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">No projects yet</p>
                        <p className="text-sm">Create your first project to get started.</p>
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
                      className="grid grid-cols-12 gap-4 px-4 py-3.5 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/25 cursor-pointer transition-[background-color,border-color,box-shadow]"
                      onClick={() => handleViewProject(project)}
                    >
                      <div className="col-span-12 md:col-span-4">
                        <p className="font-medium truncate">{project.name}</p>
                        {project.permit_number && (
                          <p className="text-xs text-muted-foreground font-mono-data tracking-tight">{project.permit_number}</p>
                        )}
                      </div>
                      <div className="col-span-6 md:col-span-2">
                        <Badge className={`${statusConfig.bgColor} ${statusConfig.color} border-0`}>
                          {statusConfig.label}
                        </Badge>
                      </div>
                      <div className="col-span-6 md:col-span-2 text-sm text-muted-foreground truncate">
                        {project.jurisdiction || '-'}
                      </div>
                      <div className="col-span-6 md:col-span-2 text-sm text-muted-foreground truncate">
                        {[project.city, project.state].filter(Boolean).join(', ') || '-'}
                      </div>
                      <div className="col-span-6 md:col-span-2 text-sm text-muted-foreground">
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
