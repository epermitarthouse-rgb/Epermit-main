import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar, Loader2 } from 'lucide-react';
import { InspectionType, INSPECTION_TYPE_OPTIONS } from '@/types/inspection';

interface ScheduleInspectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (data: {
    inspection_type: InspectionType;
    scheduled_date: string;
    inspector_name?: string;
    inspector_notes?: string;
  }) => Promise<void>;
  scheduling: boolean;
}

export function ScheduleInspectionDialog({
  open,
  onOpenChange,
  onSchedule,
  scheduling,
}: ScheduleInspectionDialogProps) {
  const [inspectionType, setInspectionType] = useState<InspectionType>('other');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('09:00');
  const [inspectorName, setInspectorName] = useState('');
  const [inspectorNotes, setInspectorNotes] = useState('');

  const handleSubmit = async () => {
    if (!scheduledDate) return;

    const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();

    await onSchedule({
      inspection_type: inspectionType,
      scheduled_date: scheduledDateTime,
      inspector_name: inspectorName || undefined,
      inspector_notes: inspectorNotes || undefined,
    });

    // Reset form
    setInspectionType('other');
    setScheduledDate('');
    setScheduledTime('09:00');
    setInspectorName('');
    setInspectorNotes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Schedule Inspection
          </DialogTitle>
          <DialogDescription>
            Schedule a new inspection for this project
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inspection-type">Inspection Type</Label>
            <Select value={inspectionType} onValueChange={(v) => setInspectionType(v as InspectionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSPECTION_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scheduled-date">Date</Label>
              <Input
                id="scheduled-date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scheduled-time">Time</Label>
              <Input
                id="scheduled-time"
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inspector-name">Inspector Name (optional)</Label>
            <Input
              id="inspector-name"
              placeholder="John Smith"
              value={inspectorName}
              onChange={(e) => setInspectorName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inspector-notes">Notes (optional)</Label>
            <Textarea
              id="inspector-notes"
              placeholder="Any preparation notes..."
              value={inspectorNotes}
              onChange={(e) => setInspectorNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!scheduledDate || scheduling}>
            {scheduling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scheduling...
              </>
            ) : (
              'Schedule Inspection'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
