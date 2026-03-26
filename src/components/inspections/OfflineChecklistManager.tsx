import { useState } from 'react';
import { format } from 'date-fns';
import { 
  CloudOff, 
  Cloud, 
  RefreshCw, 
  Trash2, 
  FolderOpen, 
  Download,
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  RotateCcw,
  GitMerge,
  Settings2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useOfflineStorage, OfflineChecklist } from '@/hooks/useOfflineStorage';
import { toast } from 'sonner';
import type { ConflictResolutionStrategy } from '@/lib/offlineSyncService';

interface OfflineChecklistManagerProps {
  onLoadChecklist?: (checklist: OfflineChecklist) => void;
  compact?: boolean;
}

export function OfflineChecklistManager({ 
  onLoadChecklist,
  compact = false
}: OfflineChecklistManagerProps) {
  const {
    isOnline,
    isDBReady,
    savedChecklists,
    pendingSyncCount,
    isSyncing,
    syncProgress,
    conflicts,
    conflictResolutionStrategy,
    setConflictResolutionStrategy,
    deleteChecklist,
    syncPendingItems,
    resolveConflict,
    retryFailedItems,
    clearAllData,
  } = useOfflineStorage();

  const [managerOpen, setManagerOpen] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState<string | null>(null);

  const handleSync = async () => {
    await syncPendingItems();
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteChecklist(id);
      toast.success('Checklist deleted');
    } catch (error) {
      toast.error('Failed to delete checklist');
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAllData();
      toast.success('All offline data cleared');
    } catch (error) {
      toast.error('Failed to clear data');
    }
  };

  const handleLoad = (checklist: OfflineChecklist) => {
    onLoadChecklist?.(checklist);
    setManagerOpen(false);
    toast.success('Checklist loaded from offline storage');
  };

  const handleResolveConflict = async (
    checklistId: string, 
    resolution: 'keep-local' | 'keep-server' | 'merge'
  ) => {
    await resolveConflict(checklistId, resolution);
    setSelectedConflict(null);
    setConflictDialogOpen(false);
  };

  const getSyncStatusIcon = (status: OfflineChecklist['syncStatus']) => {
    switch (status) {
      case 'synced':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'syncing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'conflict':
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSyncStatusText = (status: OfflineChecklist['syncStatus']) => {
    switch (status) {
      case 'synced':
        return 'Synced';
      case 'pending':
        return 'Pending sync';
      case 'syncing':
        return 'Syncing...';
      case 'conflict':
        return 'Conflict';
      case 'error':
        return 'Sync error';
      default:
        return 'Unknown';
    }
  };

  const conflictingChecklists = savedChecklists.filter(c => c.syncStatus === 'conflict');
  const failedChecklists = savedChecklists.filter(c => c.syncStatus === 'error');

  if (!isDBReady) {
    return null;
  }

  // Compact inline indicator
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div 
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
            isOnline 
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
          )}
        >
          {isOnline ? (
            <>
              <Cloud className="h-3 w-3" />
              Online
            </>
          ) : (
            <>
              <CloudOff className="h-3 w-3" />
              Offline
            </>
          )}
        </div>

        {/* Sync progress indicator */}
        {isSyncing && syncProgress.total > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{syncProgress.current}/{syncProgress.total}</span>
          </div>
        )}

        {/* Conflict indicator */}
        {conflictingChecklists.length > 0 && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 gap-1 text-orange-600"
            onClick={() => setConflictDialogOpen(true)}
          >
            <AlertTriangle className="h-3 w-3" />
            {conflictingChecklists.length} conflicts
          </Button>
        )}

        {savedChecklists.length > 0 && (
          <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1">
                <Download className="h-3 w-3" />
                {savedChecklists.length} saved
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Offline Checklists</DialogTitle>
                <DialogDescription>
                  Load previously saved checklists from offline storage.
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-2 p-1">
                  {savedChecklists.map((checklist) => (
                    <div
                      key={checklist.id}
                      className={cn(
                        "flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors",
                        checklist.syncStatus === 'conflict' && "border-orange-500/50 bg-orange-50/50 dark:bg-orange-900/10"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {checklist.formData.projectName || 'Untitled Checklist'}
                          </span>
                          <div className="flex items-center gap-1">
                            {getSyncStatusIcon(checklist.syncStatus)}
                            <span className="text-xs text-muted-foreground">
                              {getSyncStatusText(checklist.syncStatus)}
                            </span>
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          {checklist.formData.inspectionType && (
                            <span className="capitalize">
                              {checklist.formData.inspectionType.replace(/_/g, ' ')} •{' '}
                            </span>
                          )}
                          {checklist.checklistItems.length + checklist.customItems.length} items •{' '}
                          Saved {format(new Date(checklist.savedAt), 'MMM d, h:mm a')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {checklist.syncStatus === 'conflict' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-orange-600"
                            onClick={() => {
                              setSelectedConflict(checklist.id);
                              setConflictDialogOpen(true);
                            }}
                          >
                            <GitMerge className="h-4 w-4 mr-1" />
                            Resolve
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => handleLoad(checklist)}
                        >
                          <FolderOpen className="h-4 w-4 mr-1" />
                          Load
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete checklist?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete this offline checklist. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(checklist.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        )}

        {/* Conflict Resolution Dialog */}
        <ConflictResolutionDialog
          open={conflictDialogOpen}
          onOpenChange={setConflictDialogOpen}
          checklists={conflictingChecklists}
          selectedId={selectedConflict}
          onResolve={handleResolveConflict}
        />
      </div>
    );
  }

  // Full manager view
  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-3">
          <div 
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium",
              isOnline 
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
            )}
          >
            {isOnline ? (
              <>
                <Cloud className="h-4 w-4" />
                Online
              </>
            ) : (
              <>
                <CloudOff className="h-4 w-4" />
                Offline Mode
              </>
            )}
          </div>
          
          {pendingSyncCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {pendingSyncCount} pending sync
            </Badge>
          )}

          {conflictingChecklists.length > 0 && (
            <Badge variant="outline" className="gap-1 text-orange-600 border-orange-300">
              <AlertTriangle className="h-3 w-3" />
              {conflictingChecklists.length} conflicts
            </Badge>
          )}
          
          <span className="text-sm text-muted-foreground">
            {savedChecklists.length} checklist{savedChecklists.length !== 1 ? 's' : ''} saved locally
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Sync settings */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings2 className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="space-y-3">
                <div className="font-medium text-sm">Sync Settings</div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">
                    Conflict Resolution Strategy
                  </label>
                  <Select
                    value={conflictResolutionStrategy}
                    onValueChange={(v) => setConflictResolutionStrategy(v as ConflictResolutionStrategy)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="merge">Auto-merge (recommended)</SelectItem>
                      <SelectItem value="local-wins">Keep local changes</SelectItem>
                      <SelectItem value="server-wins">Keep server changes</SelectItem>
                      <SelectItem value="manual">Ask every time</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {conflictResolutionStrategy === 'merge' && 'Automatically combines changes from both versions'}
                    {conflictResolutionStrategy === 'local-wins' && 'Your local changes will overwrite server data'}
                    {conflictResolutionStrategy === 'server-wins' && 'Server data will overwrite your local changes'}
                    {conflictResolutionStrategy === 'manual' && 'You will be prompted to resolve each conflict'}
                  </p>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Sync progress */}
          {isSyncing && syncProgress.total > 0 && (
            <div className="flex items-center gap-2 min-w-[120px]">
              <Progress 
                value={(syncProgress.current / syncProgress.total) * 100} 
                className="h-2"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {syncProgress.current}/{syncProgress.total}
              </span>
            </div>
          )}

          {failedChecklists.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={retryFailedItems}
              className="gap-1 text-red-600"
            >
              <RotateCcw className="h-4 w-4" />
              Retry Failed
            </Button>
          )}

          {conflictingChecklists.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConflictDialogOpen(true)}
              className="gap-1 text-orange-600"
            >
              <GitMerge className="h-4 w-4" />
              Resolve Conflicts
            </Button>
          )}

          {pendingSyncCount > 0 && isOnline && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={isSyncing}
              className="gap-1"
            >
              <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          )}
          
          {savedChecklists.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 text-destructive">
                  <Trash2 className="h-4 w-4" />
                  Clear All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all offline data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all locally saved checklists and pending sync items. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearAll} className="bg-destructive text-destructive-foreground">
                    Clear All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Saved checklists list */}
      {savedChecklists.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <CloudOff className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No checklists saved offline yet</p>
          <p className="text-sm mt-1">
            Save checklists to access them without internet connection
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {savedChecklists.map((checklist) => (
            <div
              key={checklist.id}
              className={cn(
                "flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors",
                checklist.syncStatus === 'conflict' && "border-orange-500/50 bg-orange-50/50 dark:bg-orange-900/10",
                checklist.syncStatus === 'error' && "border-red-500/50 bg-red-50/50 dark:bg-red-900/10"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">
                    {checklist.formData.projectName || 'Untitled Checklist'}
                  </span>
                  <Badge 
                    variant={checklist.syncStatus === 'synced' ? 'default' : 'outline'}
                    className={cn(
                      "gap-1",
                      checklist.syncStatus === 'conflict' && "border-orange-300 text-orange-600",
                      checklist.syncStatus === 'error' && "border-red-300 text-red-600"
                    )}
                  >
                    {getSyncStatusIcon(checklist.syncStatus)}
                    {getSyncStatusText(checklist.syncStatus)}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  <span>{checklist.formData.projectAddress || 'No address'}</span>
                  {checklist.formData.inspectionType && (
                    <span className="ml-2 capitalize">
                      • {checklist.formData.inspectionType.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {checklist.checklistItems.length + checklist.customItems.length} items •{' '}
                  Saved {format(new Date(checklist.savedAt), 'MMM d, yyyy h:mm a')}
                  {checklist.lastModified !== checklist.savedAt && (
                    <span> • Modified {format(new Date(checklist.lastModified), 'h:mm a')}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {checklist.syncStatus === 'conflict' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-orange-600"
                    onClick={() => {
                      setSelectedConflict(checklist.id);
                      setConflictDialogOpen(true);
                    }}
                  >
                    <GitMerge className="h-4 w-4 mr-1" />
                    Resolve
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => handleLoad(checklist)}
                >
                  <FolderOpen className="h-4 w-4 mr-1" />
                  Load
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete checklist?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this offline checklist. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(checklist.id)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Conflict Resolution Dialog */}
      <ConflictResolutionDialog
        open={conflictDialogOpen}
        onOpenChange={setConflictDialogOpen}
        checklists={conflictingChecklists}
        selectedId={selectedConflict}
        onResolve={handleResolveConflict}
      />
    </div>
  );
}

// Conflict Resolution Dialog Component
function ConflictResolutionDialog({
  open,
  onOpenChange,
  checklists,
  selectedId,
  onResolve,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklists: OfflineChecklist[];
  selectedId: string | null;
  onResolve: (id: string, resolution: 'keep-local' | 'keep-server' | 'merge') => void;
}) {
  const selectedChecklist = selectedId 
    ? checklists.find(c => c.id === selectedId) 
    : checklists[0];

  if (!selectedChecklist) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Resolve Sync Conflict
          </DialogTitle>
          <DialogDescription>
            This checklist was modified both locally and on the server. Choose how to resolve the conflict.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Local Version */}
            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <CloudOff className="h-4 w-4" />
                Your Local Version
              </div>
              <div className="text-sm text-muted-foreground">
                <p><strong>Project:</strong> {selectedChecklist.formData.projectName}</p>
                <p><strong>Items:</strong> {selectedChecklist.checklistItems.length + selectedChecklist.customItems.length}</p>
                <p><strong>Modified:</strong> {format(new Date(selectedChecklist.lastModified), 'MMM d, h:mm a')}</p>
              </div>
            </div>

            {/* Server Version */}
            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <Cloud className="h-4 w-4" />
                Server Version
              </div>
              <div className="text-sm text-muted-foreground">
                {selectedChecklist.conflictData ? (
                  <>
                    <p><strong>Project:</strong> {selectedChecklist.conflictData.form_data?.projectName || 'N/A'}</p>
                    <p><strong>Items:</strong> {(selectedChecklist.conflictData.checklist_items?.length || 0) + (selectedChecklist.conflictData.custom_items?.length || 0)}</p>
                    <p><strong>Modified:</strong> {selectedChecklist.conflictData.updated_at ? format(new Date(selectedChecklist.conflictData.updated_at), 'MMM d, h:mm a') : 'N/A'}</p>
                  </>
                ) : (
                  <p className="italic">Server data not available</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Choose resolution:</p>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                className="h-auto py-3 flex-col gap-1"
                onClick={() => onResolve(selectedChecklist.id, 'keep-local')}
              >
                <CloudOff className="h-5 w-5" />
                <span className="text-sm">Keep Local</span>
                <span className="text-xs text-muted-foreground">Use your version</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-3 flex-col gap-1"
                onClick={() => onResolve(selectedChecklist.id, 'keep-server')}
              >
                <Cloud className="h-5 w-5" />
                <span className="text-sm">Keep Server</span>
                <span className="text-xs text-muted-foreground">Use server version</span>
              </Button>
              <Button
                variant="default"
                className="h-auto py-3 flex-col gap-1"
                onClick={() => onResolve(selectedChecklist.id, 'merge')}
              >
                <GitMerge className="h-5 w-5" />
                <span className="text-sm">Merge Both</span>
                <span className="text-xs text-primary-foreground/80">Combine changes</span>
              </Button>
            </div>
          </div>
        </div>

        {checklists.length > 1 && (
          <DialogFooter className="text-sm text-muted-foreground">
            {checklists.length - 1} more conflict{checklists.length > 2 ? 's' : ''} to resolve
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
