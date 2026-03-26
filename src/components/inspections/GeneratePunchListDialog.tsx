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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { PunchListPriority, PUNCH_LIST_PRIORITY_CONFIG, Inspection, INSPECTION_TYPE_LABELS } from '@/types/inspection';

interface PunchListItem {
  title: string;
  description: string;
  location: string;
  priority: PunchListPriority;
}

interface GeneratePunchListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspection: Inspection | null;
  onGenerate: (items: PunchListItem[]) => Promise<void>;
  generating: boolean;
}

export function GeneratePunchListDialog({
  open,
  onOpenChange,
  inspection,
  onGenerate,
  generating,
}: GeneratePunchListDialogProps) {
  const [items, setItems] = useState<PunchListItem[]>([
    { title: '', description: '', location: '', priority: 'medium' },
  ]);

  const addItem = () => {
    setItems(prev => [...prev, { title: '', description: '', location: '', priority: 'medium' }]);
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof PunchListItem, value: string) => {
    setItems(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const handleSubmit = async () => {
    const validItems = items.filter(item => item.title.trim());
    if (validItems.length === 0) {
      onOpenChange(false);
      return;
    }

    await onGenerate(validItems);

    // Reset form
    setItems([{ title: '', description: '', location: '', priority: 'medium' }]);
    onOpenChange(false);
  };

  const handleSkip = () => {
    setItems([{ title: '', description: '', location: '', priority: 'medium' }]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Generate Punch List
          </DialogTitle>
          <DialogDescription>
            {inspection && (
              <>
                Add punch list items for issues found during the {INSPECTION_TYPE_LABELS[inspection.inspection_type]} inspection.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={index} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Issue #{index + 1}
                </span>
                {items.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(index)}
                    className="h-8 w-8 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <Label>Title *</Label>
                <Input
                  placeholder="Brief description of the issue"
                  value={item.title}
                  onChange={(e) => updateItem(index, 'title', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Input
                    placeholder="Where is the issue?"
                    value={item.location}
                    onChange={(e) => updateItem(index, 'location', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select
                    value={item.priority}
                    onValueChange={(v) => updateItem(index, 'priority', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PUNCH_LIST_PRIORITY_CONFIG).map(([value, config]) => (
                        <SelectItem key={value} value={value}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Detailed description of what needs to be fixed..."
                  value={item.description}
                  onChange={(e) => updateItem(index, 'description', e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          ))}

          <Button variant="outline" onClick={addItem} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Add Another Issue
          </Button>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={handleSkip} className="sm:mr-auto">
            Skip for Now
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={generating || !items.some(i => i.title.trim())}
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              `Create ${items.filter(i => i.title.trim()).length} Items`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
