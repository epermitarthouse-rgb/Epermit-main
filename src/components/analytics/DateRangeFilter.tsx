import { useState } from 'react';
import { format, subDays, subMonths, subYears, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

export type PresetRange = 'last30days' | 'lastQuarter' | 'lastYear' | 'allTime' | 'custom';

interface DateRangeFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  presetRange: PresetRange;
  onPresetChange: (preset: PresetRange) => void;
}

const presetOptions = [
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'lastQuarter', label: 'Last Quarter' },
  { value: 'lastYear', label: 'Last Year' },
  { value: 'allTime', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

export function getPresetDateRange(preset: PresetRange): DateRange {
  const now = new Date();
  
  switch (preset) {
    case 'last30days':
      return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
    case 'lastQuarter':
      return { from: startOfDay(subMonths(now, 3)), to: endOfDay(now) };
    case 'lastYear':
      return { from: startOfDay(subYears(now, 1)), to: endOfDay(now) };
    case 'allTime':
      return { from: undefined, to: undefined };
    case 'custom':
    default:
      return { from: undefined, to: undefined };
  }
}

export function DateRangeFilter({
  dateRange,
  onDateRangeChange,
  presetRange,
  onPresetChange,
}: DateRangeFilterProps) {
  const [isFromOpen, setIsFromOpen] = useState(false);
  const [isToOpen, setIsToOpen] = useState(false);

  const handlePresetChange = (value: string) => {
    const preset = value as PresetRange;
    onPresetChange(preset);
    
    if (preset !== 'custom') {
      onDateRangeChange(getPresetDateRange(preset));
    }
  };

  const handleFromDateChange = (date: Date | undefined) => {
    onPresetChange('custom');
    onDateRangeChange({ ...dateRange, from: date ? startOfDay(date) : undefined });
    setIsFromOpen(false);
  };

  const handleToDateChange = (date: Date | undefined) => {
    onPresetChange('custom');
    onDateRangeChange({ ...dateRange, to: date ? endOfDay(date) : undefined });
    setIsToOpen(false);
  };

  const getDisplayLabel = () => {
    if (presetRange === 'allTime') return 'All Time';
    if (presetRange === 'custom' && dateRange.from && dateRange.to) {
      return `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`;
    }
    const preset = presetOptions.find(p => p.value === presetRange);
    return preset?.label || 'Select Range';
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={presetRange} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Select range" />
        </SelectTrigger>
        <SelectContent>
          {presetOptions.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {presetRange === 'custom' && (
        <div className="flex items-center gap-2">
          <Popover open={isFromOpen} onOpenChange={setIsFromOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'w-[140px] justify-start text-left font-normal',
                  !dateRange.from && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.from ? format(dateRange.from, 'MMM d, yyyy') : 'From'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateRange.from}
                onSelect={handleFromDateChange}
                initialFocus
                className="p-3 pointer-events-auto"
                disabled={(date) => dateRange.to ? date > dateRange.to : false}
              />
            </PopoverContent>
          </Popover>

          <span className="text-muted-foreground">to</span>

          <Popover open={isToOpen} onOpenChange={setIsToOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'w-[140px] justify-start text-left font-normal',
                  !dateRange.to && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.to ? format(dateRange.to, 'MMM d, yyyy') : 'To'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateRange.to}
                onSelect={handleToDateChange}
                initialFocus
                className="p-3 pointer-events-auto"
                disabled={(date) => dateRange.from ? date < dateRange.from : false}
              />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {presetRange !== 'custom' && presetRange !== 'allTime' && (
        <span className="text-sm text-muted-foreground">
          {dateRange.from && dateRange.to && (
            <>
              {format(dateRange.from, 'MMM d, yyyy')} - {format(dateRange.to, 'MMM d, yyyy')}
            </>
          )}
        </span>
      )}
    </div>
  );
}
