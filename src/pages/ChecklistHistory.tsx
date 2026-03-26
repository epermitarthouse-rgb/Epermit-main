import { useState, useMemo } from 'react';
import { useSavedChecklists, SavedChecklist, SavedChecklistStatus } from '@/hooks/useSavedChecklists';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Filter,
  ClipboardList,
  Calendar,
  FileCheck,
  Clock,
  CheckCircle2,
  PenLine,
  Trash2,
  Copy,
  Eye,
  Download,
  AlertCircle,
  Building2,
  SlidersHorizontal,
  FileText,
  CheckSquare,
  Square,
  MinusSquare,
  X,
  Mail,
  Send,
  Loader2,
  CalendarDays,
  History,
  Palette,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { downloadChecklistPDF } from '@/lib/checklistPDF';
import { downloadCombinedChecklistPDF, generateCombinedChecklistPDFBase64 } from '@/lib/combinedChecklistPDF';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { ScheduledReportsManager } from '@/components/checklists/ScheduledReportsManager';
import { EmailBrandingDialog } from '@/components/checklists/EmailBrandingDialog';
import { EmailPreviewDialog } from '@/components/checklists/EmailPreviewDialog';

const statusConfig: Record<SavedChecklistStatus, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: PenLine },
  in_progress: { label: 'In Progress', color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400', icon: Clock },
  completed: { label: 'Completed', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', icon: CheckCircle2 },
  signed: { label: 'Signed', color: 'bg-green-500/10 text-green-600 dark:text-green-400', icon: FileCheck },
};

const inspectionTypes = [
  'All Types',
  'Foundation',
  'Framing',
  'Electrical Rough',
  'Electrical Final',
  'Plumbing Rough',
  'Plumbing Final',
  'Mechanical Rough',
  'Mechanical Final',
  'Insulation',
  'Drywall',
  'Fire Safety',
  'Final',
];

export default function ChecklistHistory() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { savedChecklists, loading, deleteChecklist, duplicateChecklist, deleteMultipleChecklists, updateMultipleChecklistsStatus } = useSavedChecklists();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('All Types');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'updated_at' | 'created_at' | 'name'>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [selectedChecklist, setSelectedChecklist] = useState<SavedChecklist | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateName, setDuplicateName] = useState('');

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [batchStatusDialogOpen, setBatchStatusDialogOpen] = useState(false);
  const [batchStatus, setBatchStatus] = useState<SavedChecklistStatus>('completed');

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailRecipientName, setEmailRecipientName] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailIntro, setEmailIntro] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailMode, setEmailMode] = useState<'all' | 'selected'>('all');
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [brandingDialogOpen, setBrandingDialogOpen] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState('history');

  // Get unique project names for filtering
  const projectNames = useMemo(() => {
    const names = new Set<string>();
    savedChecklists.forEach(c => {
      if (c.form_data.projectName) {
        names.add(c.form_data.projectName);
      }
    });
    return Array.from(names).sort();
  }, [savedChecklists]);

  // Filter and sort checklists
  const filteredChecklists = useMemo(() => {
    let result = [...savedChecklists];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.form_data.projectName?.toLowerCase().includes(query) ||
          c.form_data.projectAddress?.toLowerCase().includes(query) ||
          c.form_data.inspectorName?.toLowerCase().includes(query) ||
          c.form_data.permitNumber?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }

    // Type filter
    if (typeFilter !== 'All Types') {
      result = result.filter((c) => c.form_data.inspectionType === typeFilter);
    }

    // Project filter
    if (projectFilter !== 'all') {
      result = result.filter((c) => c.form_data.projectName === projectFilter);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'created_at':
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'updated_at':
        default:
          comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [savedChecklists, searchQuery, statusFilter, typeFilter, projectFilter, sortBy, sortOrder]);

  // Stats
  const stats = useMemo(() => {
    return {
      total: savedChecklists.length,
      draft: savedChecklists.filter((c) => c.status === 'draft').length,
      in_progress: savedChecklists.filter((c) => c.status === 'in_progress').length,
      completed: savedChecklists.filter((c) => c.status === 'completed').length,
      signed: savedChecklists.filter((c) => c.status === 'signed').length,
    };
  }, [savedChecklists]);

  const handleView = (checklist: SavedChecklist) => {
    setSelectedChecklist(checklist);
    setViewDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (selectedChecklist) {
      await deleteChecklist(selectedChecklist.id);
      setDeleteDialogOpen(false);
      setSelectedChecklist(null);
    }
  };

  const handleDuplicateConfirm = async () => {
    if (selectedChecklist && duplicateName.trim()) {
      await duplicateChecklist(selectedChecklist.id, duplicateName.trim());
      setDuplicateDialogOpen(false);
      setSelectedChecklist(null);
      setDuplicateName('');
    }
  };

  const handleDownloadPDF = (checklist: SavedChecklist) => {
    downloadChecklistPDF({
      formData: checklist.form_data,
      checklistItems: checklist.checklist_items,
      customItems: checklist.custom_items,
      inspectorSignedAt: checklist.inspector_signed_at,
      contractorSignedAt: checklist.contractor_signed_at,
    });
  };

  const handleExportCombinedPDF = () => {
    if (filteredChecklists.length === 0) {
      toast.error('No checklists to export');
      return;
    }
    
    const projectName = projectFilter !== 'all' ? projectFilter : 'All Projects';
    downloadCombinedChecklistPDF(filteredChecklists, projectName);
    toast.success(`Exported ${filteredChecklists.length} checklists to PDF`);
  };

  // Batch selection handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredChecklists.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredChecklists.map(c => c.id)));
    }
  };

  const toggleSelectItem = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    
    const success = await deleteMultipleChecklists(Array.from(selectedIds));
    if (success) {
      setSelectedIds(new Set());
      setBatchDeleteDialogOpen(false);
    }
  };

  const handleBatchStatusUpdate = async () => {
    if (selectedIds.size === 0) return;
    
    const success = await updateMultipleChecklistsStatus(Array.from(selectedIds), batchStatus);
    if (success) {
      setSelectedIds(new Set());
      setBatchStatusDialogOpen(false);
    }
  };

  const handleBatchExport = () => {
    const selectedChecklists = filteredChecklists.filter(c => selectedIds.has(c.id));
    if (selectedChecklists.length === 0) {
      toast.error('No checklists selected');
      return;
    }
    downloadCombinedChecklistPDF(selectedChecklists, 'Selected Checklists');
    toast.success(`Exported ${selectedChecklists.length} checklists to PDF`);
  };

  const handleEmailReport = async () => {
    if (!emailRecipient.trim()) {
      toast.error('Please enter a recipient email');
      return;
    }

    const checklistsToEmail = emailMode === 'selected' 
      ? filteredChecklists.filter(c => selectedIds.has(c.id))
      : filteredChecklists;

    if (checklistsToEmail.length === 0) {
      toast.error('No checklists to email');
      return;
    }

    setEmailSending(true);
    try {
      const projectName = projectFilter !== 'all' ? projectFilter : 'All Projects';
      const { base64, fileName } = generateCombinedChecklistPDFBase64(checklistsToEmail, projectName);

      const { data, error } = await supabase.functions.invoke('send-checklist-report', {
        body: {
          recipientEmail: emailRecipient.trim(),
          recipientName: emailRecipientName.trim(),
          projectName,
          checklistCount: checklistsToEmail.length,
          pdfBase64: base64,
          fileName,
          customSubject: emailSubject.trim() || undefined,
          customIntro: emailIntro.trim() || undefined,
        },
      });

      if (error) throw error;

      toast.success(`Report sent to ${emailRecipient}`);
      setEmailDialogOpen(false);
      setEmailRecipient('');
      setEmailRecipientName('');
      setEmailSubject('');
      setEmailIntro('');
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast.error(error.message || 'Failed to send email');
    } finally {
      setEmailSending(false);
    }
  };

  const openEmailDialog = (mode: 'all' | 'selected') => {
    setEmailMode(mode);
    setEmailDialogOpen(true);
  };

  const getEmailSummary = () => {
    const checklistsToEmail = emailMode === 'selected' 
      ? filteredChecklists.filter(c => selectedIds.has(c.id))
      : filteredChecklists;
    
    const stats = {
      completed: checklistsToEmail.filter(c => c.status === 'completed' || c.status === 'signed').length,
      inProgress: checklistsToEmail.filter(c => c.status === 'in_progress').length,
      pending: checklistsToEmail.filter(c => c.status === 'draft').length,
    };
    
    return {
      projectName: projectFilter !== 'all' ? projectFilter : 'All Projects',
      checklistCount: checklistsToEmail.length,
      stats,
    };
  };

  const handleShowPreview = () => {
    if (!emailRecipient.trim()) {
      toast.error('Please enter a recipient email first');
      return;
    }
    setPreviewDialogOpen(true);
  };

  const handleSendFromPreview = async () => {
    setPreviewDialogOpen(false);
    await handleEmailReport();
  };

  const isAllSelected = filteredChecklists.length > 0 && selectedIds.size === filteredChecklists.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < filteredChecklists.length;

  if (authLoading) {
    return (
      <div className="container mx-auto py-8 px-4">
          <Skeleton className="h-10 w-64 mb-8" />
          <div className="grid gap-4 md:grid-cols-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-12 w-full mb-4" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto py-16 px-4 text-center">
          <AlertCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-2">Sign In Required</h1>
          <p className="text-muted-foreground mb-6">
            Please sign in to view your checklist history.
          </p>
          <Button onClick={() => navigate('/auth')}>Sign In</Button>
        </div>
    );
  }

  return (
    <>
      <div className="w-full max-w-7xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-4 sm:py-6 md:py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-primary" />
            Checklist History
          </h1>
          <p className="text-muted-foreground mt-2">
            Browse and manage all your saved inspection checklists across projects.
          </p>
        </motion.div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
            <TabsTrigger value="scheduled" className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Scheduled Reports
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scheduled" className="mt-6">
            <ScheduledReportsManager />
          </TabsContent>

          <TabsContent value="history" className="mt-6">

        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid gap-4 md:grid-cols-5 mb-8"
        >
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'all' ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}
            onClick={() => setStatusFilter('all')}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
                <ClipboardList className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          {Object.entries(statusConfig).map(([status, config]) => {
            const StatusIcon = config.icon;
            return (
              <Card
                key={status}
                className={`cursor-pointer transition-all ${statusFilter === status ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}
                onClick={() => setStatusFilter(status)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{config.label}</p>
                      <p className="text-2xl font-bold">{stats[status as keyof typeof stats]}</p>
                    </div>
                    <StatusIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col md:flex-row gap-4 mb-6"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, project, address, inspector, or permit..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-full md:w-48">
              <Building2 className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projectNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full md:w-48">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Inspection Type" />
            </SelectTrigger>
            <SelectContent>
              {inspectionTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <SlidersHorizontal className="h-4 w-4 mr-2" />
                Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setSortBy('updated_at'); setSortOrder('desc'); }}>
                Recently Updated
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy('created_at'); setSortOrder('desc'); }}>
                Recently Created
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy('name'); setSortOrder('asc'); }}>
                Name (A-Z)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy('name'); setSortOrder('desc'); }}>
                Name (Z-A)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button 
            variant="default" 
            onClick={handleExportCombinedPDF}
            disabled={filteredChecklists.length === 0}
          >
            <FileText className="h-4 w-4 mr-2" />
            Export All ({filteredChecklists.length})
          </Button>
          <Button 
            variant="outline" 
            onClick={() => openEmailDialog('all')}
            disabled={filteredChecklists.length === 0}
          >
            <Mail className="h-4 w-4 mr-2" />
            Email Report
          </Button>
        </motion.div>

        {/* Batch Action Toolbar */}
        <AnimatePresence>
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-3 mb-4 p-3 bg-primary/5 border border-primary/20 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  {selectedIds.size} selected
                </span>
              </div>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={handleBatchExport}
              >
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <PenLine className="h-4 w-4 mr-1" />
                    Update Status
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => { setBatchStatus('draft'); setBatchStatusDialogOpen(true); }}>
                    <PenLine className="h-4 w-4 mr-2" />
                    Mark as Draft
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setBatchStatus('in_progress'); setBatchStatusDialogOpen(true); }}>
                    <Clock className="h-4 w-4 mr-2" />
                    Mark as In Progress
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setBatchStatus('completed'); setBatchStatusDialogOpen(true); }}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark as Completed
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setBatchStatus('signed'); setBatchStatusDialogOpen(true); }}>
                    <FileCheck className="h-4 w-4 mr-2" />
                    Mark as Signed
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEmailDialog('selected')}
              >
                <Mail className="h-4 w-4 mr-1" />
                Email
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setBatchDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
              >
                <X className="h-4 w-4" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results count with select all */}
        <div className="flex items-center gap-3 mb-4">
          {filteredChecklists.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isAllSelected ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : isSomeSelected ? (
                <MinusSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Select all
            </button>
          )}
          <p className="text-sm text-muted-foreground">
            Showing {filteredChecklists.length} of {savedChecklists.length} checklists
          </p>
        </div>

        {/* Checklists List */}
        <AnimatePresence mode="popLayout">
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : filteredChecklists.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16"
            >
              <ClipboardList className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">No Checklists Found</h2>
              <p className="text-muted-foreground">
                {searchQuery || statusFilter !== 'all' || typeFilter !== 'All Types'
                  ? 'Try adjusting your filters or search query.'
                  : 'Create your first inspection checklist to get started.'}
              </p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {filteredChecklists.map((checklist, index) => {
                const status = statusConfig[checklist.status];
                const StatusIcon = status.icon;
                const completedItems = checklist.checklist_items.filter((i) => i.status !== 'pending').length;
                const totalItems = checklist.checklist_items.length + checklist.custom_items.length;

                return (
                  <motion.div
                    key={checklist.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.05 }}
                    layout
                  >
                    <Card className={`hover:shadow-md transition-all ${selectedIds.has(checklist.id) ? 'ring-2 ring-primary' : ''}`}>
                      <CardContent className="p-4 md:p-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          {/* Checkbox */}
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={selectedIds.has(checklist.id)}
                              onCheckedChange={() => toggleSelectItem(checklist.id)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="font-semibold text-lg truncate">{checklist.name}</h3>
                                <Badge className={status.color}>
                                  <StatusIcon className="h-3 w-3 mr-1" />
                                  {status.label}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                {checklist.form_data.projectName && (
                                  <span className="flex items-center gap-1">
                                    <Building2 className="h-3 w-3" />
                                    {checklist.form_data.projectName}
                                  </span>
                                )}
                                {checklist.form_data.inspectionType && (
                                  <span className="flex items-center gap-1">
                                    <ClipboardList className="h-3 w-3" />
                                    {checklist.form_data.inspectionType}
                                  </span>
                                )}
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {format(new Date(checklist.updated_at), 'MMM d, yyyy')}
                                </span>
                              </div>
                              <div className="mt-2">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 bg-muted rounded-full h-2 max-w-xs">
                                    <div
                                      className="bg-primary rounded-full h-2 transition-all"
                                      style={{
                                        width: totalItems > 0 ? `${(completedItems / totalItems) * 100}%` : '0%',
                                      }}
                                    />
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    {completedItems}/{totalItems} items
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleView(checklist)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <SlidersHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleDownloadPDF(checklist)}>
                                  <Download className="h-4 w-4 mr-2" />
                                  Download PDF
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedChecklist(checklist);
                                    setDuplicateName(`${checklist.name} (Copy)`);
                                    setDuplicateDialogOpen(true);
                                  }}
                                >
                                  <Copy className="h-4 w-4 mr-2" />
                                  Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => {
                                    setSelectedChecklist(checklist);
                                    setDeleteDialogOpen(true);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </AnimatePresence>
          </TabsContent>
        </Tabs>
      </div>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedChecklist?.name}</DialogTitle>
            <DialogDescription>
              Checklist details and summary
            </DialogDescription>
          </DialogHeader>
          {selectedChecklist && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Project</Label>
                  <p className="font-medium">{selectedChecklist.form_data.projectName || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Address</Label>
                  <p className="font-medium">{selectedChecklist.form_data.projectAddress || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Inspection Type</Label>
                  <p className="font-medium">{selectedChecklist.form_data.inspectionType || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Inspector</Label>
                  <p className="font-medium">{selectedChecklist.form_data.inspectorName || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Permit Number</Label>
                  <p className="font-medium">{selectedChecklist.form_data.permitNumber || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Inspection Date</Label>
                  <p className="font-medium">{selectedChecklist.form_data.inspectionDate || 'N/A'}</p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Summary</Label>
                <div className="flex gap-4 mt-2">
                  <Badge variant="outline" className="bg-green-500/10 text-green-600">
                    ✓ {selectedChecklist.checklist_items.filter((i) => i.status === 'pass').length} Passed
                  </Badge>
                  <Badge variant="outline" className="bg-red-500/10 text-red-600">
                    ✗ {selectedChecklist.checklist_items.filter((i) => i.status === 'fail').length} Failed
                  </Badge>
                  <Badge variant="outline" className="bg-muted">
                    N/A {selectedChecklist.checklist_items.filter((i) => i.status === 'na').length}
                  </Badge>
                </div>
              </div>

              {selectedChecklist.form_data.generalNotes && (
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="mt-1 text-sm">{selectedChecklist.form_data.generalNotes}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Inspector Signature</Label>
                  {selectedChecklist.inspector_signature ? (
                    <div className="mt-1">
                      <img
                        src={selectedChecklist.inspector_signature}
                        alt="Inspector Signature"
                        className="h-16 border rounded"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Signed: {selectedChecklist.inspector_signed_at
                          ? format(new Date(selectedChecklist.inspector_signed_at), 'MMM d, yyyy h:mm a')
                          : 'N/A'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Not signed</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Contractor Signature</Label>
                  {selectedChecklist.contractor_signature ? (
                    <div className="mt-1">
                      <img
                        src={selectedChecklist.contractor_signature}
                        alt="Contractor Signature"
                        className="h-16 border rounded"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Signed: {selectedChecklist.contractor_signed_at
                          ? format(new Date(selectedChecklist.contractor_signed_at), 'MMM d, yyyy h:mm a')
                          : 'N/A'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Not signed</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
            {selectedChecklist && (
              <Button onClick={() => handleDownloadPDF(selectedChecklist)}>
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Checklist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedChecklist?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate Checklist</DialogTitle>
            <DialogDescription>
              Create a copy of this checklist with a new name.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="duplicate-name">New Checklist Name</Label>
            <Input
              id="duplicate-name"
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              placeholder="Enter name for the copy"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDuplicateConfirm} disabled={!duplicateName.trim()}>
              <Copy className="h-4 w-4 mr-2" />
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Delete Confirmation */}
      <AlertDialog open={batchDeleteDialogOpen} onOpenChange={setBatchDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Checklists</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.size} selected checklists? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchDelete} className="bg-destructive text-destructive-foreground">
              Delete {selectedIds.size} Checklists
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Status Update Confirmation */}
      <AlertDialog open={batchStatusDialogOpen} onOpenChange={setBatchStatusDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Status</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to update {selectedIds.size} checklists to "{statusConfig[batchStatus].label}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchStatusUpdate}>
              Update {selectedIds.size} Checklists
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Email Report Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Email Checklists Report
            </DialogTitle>
            <DialogDescription>
              Send a PDF report of {emailMode === 'selected' ? selectedIds.size : filteredChecklists.length} checklists to an email address.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email-recipient">Recipient Email *</Label>
              <Input
                id="email-recipient"
                type="email"
                value={emailRecipient}
                onChange={(e) => setEmailRecipient(e.target.value)}
                placeholder="name@example.com"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="email-name">Recipient Name (optional)</Label>
              <Input
                id="email-name"
                value={emailRecipientName}
                onChange={(e) => setEmailRecipientName(e.target.value)}
                placeholder="John Doe"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="email-subject">Custom Subject (optional)</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Leave empty for default subject"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="email-intro">Custom Message (optional)</Label>
              <Textarea
                id="email-intro"
                value={emailIntro}
                onChange={(e) => setEmailIntro(e.target.value)}
                placeholder="Add a personalized message to the email..."
                rows={3}
                className="mt-2"
              />
            </div>
            <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
              <p className="font-medium mb-1">Report will include:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>{emailMode === 'selected' ? selectedIds.size : filteredChecklists.length} checklists</li>
                <li>Project: {projectFilter !== 'all' ? projectFilter : 'All Projects'}</li>
                <li>Overall statistics and summaries</li>
              </ul>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="ghost" 
              onClick={() => setBrandingDialogOpen(true)} 
              disabled={emailSending}
              className="sm:mr-auto"
            >
              <Palette className="h-4 w-4 mr-2" />
              Branding
            </Button>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)} disabled={emailSending}>
              Cancel
            </Button>
            <Button 
              variant="secondary"
              onClick={handleShowPreview}
              disabled={!emailRecipient.trim() || emailSending}
            >
              <Eye className="h-4 w-4 mr-2" />
              Preview
            </Button>
            <Button 
              onClick={handleEmailReport} 
              disabled={!emailRecipient.trim() || emailSending}
            >
              {emailSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Preview Dialog */}
      <EmailPreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        recipientEmail={emailRecipient}
        recipientName={emailRecipientName}
        subject={emailSubject || `Inspection Checklists Report - ${getEmailSummary().projectName}`}
        intro={emailIntro}
        summary={getEmailSummary()}
        onSend={handleSendFromPreview}
        sending={emailSending}
      />

      {/* Email Branding Dialog */}
      <EmailBrandingDialog
        open={brandingDialogOpen}
        onOpenChange={setBrandingDialogOpen}
      />
    </>
  );
}
