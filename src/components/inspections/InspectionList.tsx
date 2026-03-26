import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Calendar,
  Clock,
  MoreVertical,
  Trash2,
  PlayCircle,
  ClipboardCheck,
  User,
} from 'lucide-react';
import { format, isPast, isToday } from 'date-fns';
import { Inspection, INSPECTION_TYPE_LABELS, INSPECTION_STATUS_CONFIG } from '@/types/inspection';

interface InspectionListProps {
  inspections: Inspection[];
  onRecordResult: (inspection: Inspection) => void;
  onDelete: (id: string) => Promise<boolean>;
}

export function InspectionList({
  inspections,
  onRecordResult,
  onDelete,
}: InspectionListProps) {
  const [deleteInspection, setDeleteInspection] = useState<Inspection | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteInspection) return;
    setDeleting(true);
    await onDelete(deleteInspection.id);
    setDeleting(false);
    setDeleteInspection(null);
  };

  const getDateStatus = (date: string, status: string) => {
    if (status !== 'scheduled') return null;
    const d = new Date(date);
    if (isToday(d)) return { label: 'Today', className: 'text-amber-600' };
    if (isPast(d)) return { label: 'Overdue', className: 'text-red-600' };
    return null;
  };

  if (inspections.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="font-medium">No inspections scheduled</p>
        <p className="text-sm">Schedule your first inspection to get started</p>
      </div>
    );
  }

  return (
    <>
      <div className="divide-y">
        {inspections.map((inspection) => {
          const statusConfig = INSPECTION_STATUS_CONFIG[inspection.status];
          const dateStatus = getDateStatus(inspection.scheduled_date, inspection.status);
          const canRecord = ['scheduled', 'in_progress'].includes(inspection.status);

          return (
            <div
              key={inspection.id}
              className="flex items-center gap-3 py-3 px-2 hover:bg-muted/50 rounded-lg transition-colors"
            >
              <div className={`p-2 rounded-lg ${statusConfig.bgColor}`}>
                <Calendar className={`h-5 w-5 ${statusConfig.color}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {INSPECTION_TYPE_LABELS[inspection.inspection_type]}
                  </p>
                  <Badge className={`${statusConfig.bgColor} ${statusConfig.color} border-0`}>
                    {statusConfig.label}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(inspection.scheduled_date), 'MMM d, yyyy h:mm a')}
                  </span>
                  {dateStatus && (
                    <span className={`font-medium ${dateStatus.className}`}>
                      {dateStatus.label}
                    </span>
                  )}
                  {inspection.inspector_name && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {inspection.inspector_name}
                    </span>
                  )}
                </div>
                {inspection.result_notes && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {inspection.result_notes}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1">
                {canRecord && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRecordResult(inspection)}
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Record Result
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canRecord && (
                      <DropdownMenuItem onClick={() => onRecordResult(inspection)}>
                        <ClipboardCheck className="mr-2 h-4 w-4" />
                        Record Result
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteInspection(inspection)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!deleteInspection} onOpenChange={(open) => !open && setDeleteInspection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Inspection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this {deleteInspection && INSPECTION_TYPE_LABELS[deleteInspection.inspection_type]} inspection?
              This action cannot be undone.
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
