import { useMemo } from "react";
import { format, formatDistanceToNow, isToday, isYesterday, isSameDay } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  FolderPlus,
  Pencil,
  ArrowRightLeft,
  FileUp,
  FilePlus2,
  FileX,
  UserPlus,
  UserCheck,
  UserMinus,
  UserCog,
  CalendarPlus,
  CalendarCog,
  CheckCircle2,
  XCircle,
  CalendarX,
  ListPlus,
  ListTodo,
  ListCheck,
  BadgeCheck,
  MessageSquare,
  History,
} from "lucide-react";
import type { ProjectActivity, ActivityType } from "@/types/activity";
import { ACTIVITY_TYPE_CONFIG } from "@/types/activity";

interface ActivityTimelineProps {
  activities: ProjectActivity[];
  loading: boolean;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FolderPlus,
  Pencil,
  ArrowRightLeft,
  FileUp,
  FilePlus2,
  FileX,
  UserPlus,
  UserCheck,
  UserMinus,
  UserCog,
  CalendarPlus,
  CalendarCog,
  CheckCircle2,
  XCircle,
  CalendarX,
  ListPlus,
  ListTodo,
  ListCheck,
  BadgeCheck,
  MessageSquare,
};

export function ActivityTimeline({ activities, loading }: ActivityTimelineProps) {
  // Group activities by date
  const groupedActivities = useMemo(() => {
    const groups: { date: string; label: string; items: ProjectActivity[] }[] = [];
    let currentDate: Date | null = null;

    for (const activity of activities) {
      const activityDate = new Date(activity.created_at);
      
      if (!currentDate || !isSameDay(currentDate, activityDate)) {
        currentDate = activityDate;
        let label: string;
        
        if (isToday(activityDate)) {
          label = "Today";
        } else if (isYesterday(activityDate)) {
          label = "Yesterday";
        } else {
          label = format(activityDate, "EEEE, MMMM d");
        }

        groups.push({
          date: activityDate.toISOString(),
          label,
          items: [],
        });
      }

      groups[groups.length - 1].items.push(activity);
    }

    return groups;
  }, [activities]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <History className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="font-semibold mb-2">No activity yet</h3>
        <p className="text-muted-foreground text-sm max-w-[250px]">
          Activity will appear here as you and your team work on this project
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px] pr-4">
      <div className="space-y-6">
        {groupedActivities.map((group) => (
          <div key={group.date}>
            <div className="sticky top-0 bg-background/95 backdrop-blur py-2 z-10">
              <Badge variant="outline" className="font-normal text-xs">
                {group.label}
              </Badge>
            </div>
            <div className="relative ml-4 border-l-2 border-muted pl-4 space-y-4">
              {group.items.map((activity) => {
                const config = ACTIVITY_TYPE_CONFIG[activity.activity_type];
                const Icon = iconMap[config.icon] || History;

                return (
                  <div key={activity.id} className="relative">
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        "absolute -left-[25px] w-4 h-4 rounded-full border-2 border-background",
                        config.bgColor
                      )}
                    />
                    
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                          config.bgColor
                        )}
                      >
                        <Icon className={cn("h-4 w-4", config.color)} />
                      </div>
                      
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-sm font-medium leading-tight">
                          {activity.title}
                        </p>
                        {activity.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {activity.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
