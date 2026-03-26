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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Inspection, InspectionStatus, INSPECTION_TYPE_LABELS, INSPECTION_STATUS_CONFIG } from '@/types/inspection';
import { format } from 'date-fns';

interface RecordInspectionResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspection: Inspection | null;
  onRecord: (id: string, data: {
    status: InspectionStatus;
    result_notes?: string;
  }) => Promise<void>;
  onGeneratePunchList: () => void;
  recording: boolean;
}

export function RecordInspectionResultDialog({
  open,
  onOpenChange,
  inspection,
  onRecord,
  onGeneratePunchList,
  recording,
}: RecordInspectionResultDialogProps) {
  const [status, setStatus] = useState<InspectionStatus>('passed');
  const [resultNotes, setResultNotes] = useState('');

  if (!inspection) return null;

  const handleSubmit = async () => {
    await onRecord(inspection.id, {
      status,
      result_notes: resultNotes || undefined,
    });

    // If failed or conditional, prompt to generate punch list
    if (status === 'failed' || status === 'conditional') {
      onGeneratePunchList();
    }

    // Reset form
    setStatus('passed');
    setResultNotes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Inspection Result</DialogTitle>
          <DialogDescription>
            {INSPECTION_TYPE_LABELS[inspection.inspection_type]} - {format(new Date(inspection.scheduled_date), 'MMM d, yyyy h:mm a')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Result</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={status === 'passed' ? 'default' : 'outline'}
                className={status === 'passed' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                onClick={() => setStatus('passed')}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Passed
              </Button>
              <Button
                type="button"
                variant={status === 'conditional' ? 'default' : 'outline'}
                className={status === 'conditional' ? 'bg-orange-600 hover:bg-orange-700' : ''}
                onClick={() => setStatus('conditional')}
              >
                <AlertCircle className="mr-2 h-4 w-4" />
                Conditional
              </Button>
              <Button
                type="button"
                variant={status === 'failed' ? 'default' : 'outline'}
                className={status === 'failed' ? 'bg-red-600 hover:bg-red-700' : ''}
                onClick={() => setStatus('failed')}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Failed
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="result-notes">Inspector Comments</Label>
            <Textarea
              id="result-notes"
              placeholder="Notes from the inspection..."
              value={resultNotes}
              onChange={(e) => setResultNotes(e.target.value)}
              rows={4}
            />
          </div>

          {(status === 'failed' || status === 'conditional') && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-sm text-amber-800">
                After recording this result, you'll be prompted to create punch list items for any issues found.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={recording}>
            {recording ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Recording...
              </>
            ) : (
              'Record Result'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
