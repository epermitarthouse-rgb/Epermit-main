import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <>
      <section className="py-4 sm:py-6 md:py-8 lg:py-12 pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 lg:pl-6 lg:pr-8">
        <div className="w-full max-w-7xl ml-0 mr-auto">
          {/* Header */}
          <motion.div
            className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2 sm:gap-3">
                <FolderKanban className="h-6 w-6 sm:h-8 sm:w-8 text-accent" />
                Projects
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage your permit projects and track their status
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={fetchProjects} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <FeatureTooltip
                id="projects_new_button"
                title="Create Your First Project"
                description="Click here to start tracking a new permit project. You can add project details, upload documents, and monitor status."
                position="left"
              >
                <Button onClick={() => { handleCreateProject(); completeItem('create_project'); }} className="bg-accent hover:bg-accent/90">
                  <Plus className="mr-2 h-4 w-4" />
                  New Project
                </Button>
              </FeatureTooltip>
            </div>
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
              <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-sm font-medium text-muted-foreground border-b">
                <div className="col-span-4">Project</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Jurisdiction</div>
                <div className="col-span-2">Location</div>
                <div className="col-span-2">Updated</div>
              </div>

              {filteredProjects.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No projects found. Create your first project to get started.
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const statusConfig = PROJECT_STATUS_CONFIG[project.status];
                  return (
                    <motion.div
                      key={project.id}
                      variants={staggerItem}
                      className="grid grid-cols-12 gap-4 px-4 py-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => handleViewProject(project)}
                    >
                      <div className="col-span-12 md:col-span-4">
                        <p className="font-medium truncate">{project.name}</p>
                        {project.permit_number && (
                          <p className="text-xs text-muted-foreground">{project.permit_number}</p>
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
    </>
  );
}
