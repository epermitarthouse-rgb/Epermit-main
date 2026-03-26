import { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, isToday, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Inspection, INSPECTION_TYPE_LABELS, INSPECTION_STATUS_CONFIG } from '@/types/inspection';

interface InspectionCalendarProps {
  inspections: Inspection[];
  onReschedule: (inspectionId: string, newDate: Date) => Promise<void>;
  onInspectionClick?: (inspection: Inspection) => void;
}

export function InspectionCalendar({ inspections, onReschedule, onInspectionClick }: InspectionCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [draggedInspection, setDraggedInspection] = useState<Inspection | null>(null);
  const [dragOverDate, setDragOverDate] = useState<Date | null>(null);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  const inspectionsByDate = useMemo(() => {
    const map = new Map<string, Inspection[]>();
    inspections.forEach(inspection => {
      const dateKey = format(parseISO(inspection.scheduled_date), 'yyyy-MM-dd');
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(inspection);
    });
    return map;
  }, [inspections]);

  const handleDragStart = (e: React.DragEvent, inspection: Inspection) => {
    setDraggedInspection(inspection);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', inspection.id);
  };

  const handleDragEnd = () => {
    setDraggedInspection(null);
    setDragOverDate(null);
  };

  const handleDragOver = (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);
  };

  const handleDragLeave = () => {
    setDragOverDate(null);
  };

  const handleDrop = async (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    if (draggedInspection) {
      // Keep the original time, just change the date
      const originalDate = parseISO(draggedInspection.scheduled_date);
      const newDate = new Date(date);
      newDate.setHours(originalDate.getHours(), originalDate.getMinutes(), originalDate.getSeconds());
      await onReschedule(draggedInspection.id, newDate);
    }
    setDraggedInspection(null);
    setDragOverDate(null);
  };

  const getStatusColor = (status: string) => {
    const config = INSPECTION_STATUS_CONFIG[status as keyof typeof INSPECTION_STATUS_CONFIG];
    return config ? `${config.bgColor} ${config.color}` : 'bg-muted text-muted-foreground';
  };

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-4">
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {format(currentMonth, 'MMMM yyyy')}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentMonth(new Date())}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Drag instruction */}
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <GripVertical className="h-4 w-4" />
        Drag inspections to reschedule them
      </p>

      {/* Calendar Grid */}
      <div className="border rounded-lg overflow-hidden">
        {/* Week day headers */}
        <div className="grid grid-cols-7 bg-muted/50">
          {weekDays.map(day => (
            <div
              key={day}
              className="px-2 py-3 text-center text-sm font-medium text-muted-foreground border-b"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, index) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const dayInspections = inspectionsByDate.get(dateKey) || [];
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isDragOver = dragOverDate && isSameDay(day, dragOverDate);

            return (
              <div
                key={index}
                className={cn(
                  'min-h-[100px] border-b border-r p-1 transition-colors',
                  !isCurrentMonth && 'bg-muted/30',
                  isToday(day) && 'bg-primary/5',
                  isDragOver && 'bg-primary/20 ring-2 ring-primary ring-inset'
                )}
                onDragOver={(e) => handleDragOver(e, day)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, day)}
              >
                <div
                  className={cn(
                    'text-sm font-medium mb-1 px-1',
                    !isCurrentMonth && 'text-muted-foreground',
                    isToday(day) && 'text-primary'
                  )}
                >
                  {format(day, 'd')}
                </div>
                <div className="space-y-1">
                  {dayInspections.slice(0, 3).map(inspection => (
                    <TooltipProvider key={inspection.id}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            draggable
                            onDragStart={(e) => handleDragStart(e, inspection)}
                            onDragEnd={handleDragEnd}
                            onClick={() => onInspectionClick?.(inspection)}
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded cursor-grab active:cursor-grabbing truncate flex items-center gap-1',
                              getStatusColor(inspection.status),
                              draggedInspection?.id === inspection.id && 'opacity-50'
                            )}
                          >
                            <GripVertical className="h-3 w-3 flex-shrink-0 opacity-50" />
                            <span className="truncate">
                              {INSPECTION_TYPE_LABELS[inspection.inspection_type]}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[200px]">
                          <div className="space-y-1">
                            <p className="font-medium">
                              {INSPECTION_TYPE_LABELS[inspection.inspection_type]}
                            </p>
                            <Badge className={cn('text-xs', getStatusColor(inspection.status))}>
                              {INSPECTION_STATUS_CONFIG[inspection.status]?.label}
                            </Badge>
                            <p className="text-xs text-muted-foreground">
                              {format(parseISO(inspection.scheduled_date), 'h:mm a')}
                            </p>
                            {inspection.inspector_name && (
                              <p className="text-xs">
                                Inspector: {inspection.inspector_name}
                              </p>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                  {dayInspections.length > 3 && (
                    <div className="text-xs text-muted-foreground px-1.5">
                      +{dayInspections.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(INSPECTION_STATUS_CONFIG).map(([status, config]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={cn('w-3 h-3 rounded', config.bgColor)} />
            <span className="text-muted-foreground">{config.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
