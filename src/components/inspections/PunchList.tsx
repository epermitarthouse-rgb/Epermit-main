import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  MoreVertical,
  Trash2,
  MapPin,
  Calendar,
  CheckCircle,
  Circle,
} from 'lucide-react';
import { format } from 'date-fns';
import { 
  PunchListItem, 
  PunchListStatus,
  PUNCH_LIST_STATUS_CONFIG, 
  PUNCH_LIST_PRIORITY_CONFIG 
} from '@/types/inspection';

interface PunchListProps {
  items: PunchListItem[];
  onUpdateStatus: (id: string, status: PunchListStatus) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
}

export function PunchList({
  items,
  onUpdateStatus,
  onDelete,
}: PunchListProps) {
  const [deleteItem, setDeleteItem] = useState<PunchListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteItem) return;
    setDeleting(true);
    await onDelete(deleteItem.id);
    setDeleting(false);
    setDeleteItem(null);
  };

  const handleStatusChange = async (item: PunchListItem, newStatus: PunchListStatus) => {
    await onUpdateStatus(item.id, newStatus);
  };

  const openItems = items.filter(i => i.status === 'open');
  const inProgressItems = items.filter(i => i.status === 'in_progress');
  const resolvedItems = items.filter(i => i.status === 'resolved' || i.status === 'verified');

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50 text-emerald-500" />
        <p className="font-medium">No punch list items</p>
        <p className="text-sm">Issues from failed inspections will appear here</p>
      </div>
    );
  }

  const renderItem = (item: PunchListItem) => {
    const statusConfig = PUNCH_LIST_STATUS_CONFIG[item.status];
    const priorityConfig = PUNCH_LIST_PRIORITY_CONFIG[item.priority];
    const isResolved = item.status === 'resolved' || item.status === 'verified';

    return (
      <div
        key={item.id}
        className={`flex items-start gap-3 py-3 px-2 rounded-lg transition-colors ${
          isResolved ? 'opacity-60' : 'hover:bg-muted/50'
        }`}
      >
        <Checkbox
          checked={isResolved}
          onCheckedChange={(checked) => 
            handleStatusChange(item, checked ? 'resolved' : 'open')
          }
          className="mt-1"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-medium ${isResolved ? 'line-through' : ''}`}>
              {item.title}
            </p>
            <Badge className={`${priorityConfig.bgColor} ${priorityConfig.color} border-0 text-xs`}>
              {priorityConfig.label}
            </Badge>
          </div>
          {item.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {item.description}
            </p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            {item.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {item.location}
              </span>
            )}
            {item.due_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Due {format(new Date(item.due_date), 'MMM d')}
              </span>
            )}
            {item.assigned_to && (
              <span>Assigned to: {item.assigned_to}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={item.status}
            onValueChange={(v) => handleStatusChange(item, v as PunchListStatus)}
          >
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PUNCH_LIST_STATUS_CONFIG).map(([value, config]) => (
                <SelectItem key={value} value={value}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteItem(item)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-4">
        {/* Summary */}
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <Circle className="h-3 w-3 text-red-500 fill-red-500" />
            {openItems.length} Open
          </span>
          <span className="flex items-center gap-1">
            <Circle className="h-3 w-3 text-amber-500 fill-amber-500" />
            {inProgressItems.length} In Progress
          </span>
          <span className="flex items-center gap-1">
            <Circle className="h-3 w-3 text-emerald-500 fill-emerald-500" />
            {resolvedItems.length} Resolved
          </span>
        </div>

        {/* Open Items */}
        {openItems.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Open Issues
            </h4>
            <div className="divide-y">
              {openItems.map(renderItem)}
            </div>
          </div>
        )}

        {/* In Progress Items */}
        {inProgressItems.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              In Progress
            </h4>
            <div className="divide-y">
              {inProgressItems.map(renderItem)}
            </div>
          </div>
        )}

        {/* Resolved Items */}
        {resolvedItems.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Resolved
            </h4>
            <div className="divide-y">
              {resolvedItems.map(renderItem)}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Punch List Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteItem?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
