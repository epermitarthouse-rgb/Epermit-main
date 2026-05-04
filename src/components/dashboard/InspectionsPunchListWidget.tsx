import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabase";
import { format, isAfter, isBefore, addDays } from "date-fns";
import { 
  ClipboardCheck, 
  AlertTriangle, 
  Calendar, 
  MapPin, 
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import {
  INSPECTION_STATUS_CONFIG,
  INSPECTION_TYPE_LABELS,
  PUNCH_LIST_PRIORITY_CONFIG,
  type InspectionStatus,
  type InspectionType,
  type PunchListPriority,
} from "@/types/inspection";

interface InspectionWithProject {
  id: string;
  inspection_type: InspectionType;
  status: InspectionStatus;
  scheduled_date: string;
  project_id: string;
  projects: {
    name: string;
  };
}

interface PunchListWithProject {
  id: string;
  title: string;
  priority: PunchListPriority;
  status: string;
  due_date: string | null;
  location: string | null;
  project_id: string;
  projects: {
    name: string;
  };
}

export function InspectionsPunchListWidget() {
  const [inspections, setInspections] = useState<InspectionWithProject[]>([]);
  const [punchListItems, setPunchListItems] = useState<PunchListWithProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    
    const today = new Date().toISOString();
    const nextWeek = addDays(new Date(), 7).toISOString();

    // Fetch upcoming inspections (scheduled within next 7 days or overdue)
    const { data: inspectionsData } = await supabase
      .from("inspections")
      .select(`
        id,
        inspection_type,
        status,
        scheduled_date,
        project_id,
        projects!inner (name)
      `)
      .in("status", ["scheduled", "in_progress"])
      .lte("scheduled_date", nextWeek)
      .order("scheduled_date", { ascending: true })
      .limit(5);

    // Fetch open punch list items
    const { data: punchListData } = await supabase
      .from("punch_list_items")
      .select(`
        id,
        title,
        priority,
        status,
        due_date,
        location,
        project_id,
        projects!inner (name)
      `)
      .in("status", ["open", "in_progress"])
      .order("priority", { ascending: false })
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(5);

    if (inspectionsData) {
      setInspections(inspectionsData as unknown as InspectionWithProject[]);
    }
    if (punchListData) {
      setPunchListItems(punchListData as unknown as PunchListWithProject[]);
    }

    setLoading(false);
  };

  const isOverdue = (dateStr: string) => {
    return isBefore(new Date(dateStr), new Date());
  };

  const isUpcoming = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    return isAfter(date, now) && isBefore(date, addDays(now, 2));
  };

  const upcomingCount = inspections.filter(i => !isOverdue(i.scheduled_date)).length;
  const overdueInspections = inspections.filter(i => isOverdue(i.scheduled_date)).length;
  const openPunchItems = punchListItems.length;
  const criticalItems = punchListItems.filter(p => p.priority === "critical" || p.priority === "high").length;

  if (loading) {
    return (
      <Card className="rounded-2xl border border-[hsl(219_22%_87%)] bg-gradient-to-b from-[hsl(219_20%_96%)] to-cream-raised text-ink-primary-light shadow-cream dark:border-[hsl(219_22%_87%)] dark:bg-gradient-to-b dark:from-[hsl(219_20%_96%)] dark:to-cream-raised dark:text-ink-primary-light">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasNoData = inspections.length === 0 && punchListItems.length === 0;

  if (hasNoData) {
    return (
      <Card className="rounded-2xl border border-[hsl(219_22%_87%)] bg-gradient-to-b from-[hsl(219_20%_96%)] to-cream-raised/98 text-ink-primary-light shadow-inner dark:border-[hsl(219_22%_87%)] dark:bg-gradient-to-b dark:from-[hsl(219_20%_96%)] dark:to-cream-raised dark:text-ink-primary-light">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <ClipboardCheck className="mb-4 h-12 w-12 text-ink-tertiary-light/80" />
          <h3 className="mb-2 font-serif font-normal text-lg text-ink-primary-light">No inspections or punch list items</h3>
          <p className="mb-4 text-sm text-ink-secondary-light">
            Schedule inspections and create punch list items from your projects
          </p>
          <Button asChild size="sm">
            <Link to="/projects">View Projects</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col rounded-2xl border border-[hsl(219_22%_87%)] bg-gradient-to-b from-[hsl(219_20%_97%)] via-cream-raised to-cream-raised text-ink-primary-light shadow-cream hover:border-gold/20 dark:border-[hsl(219_22%_87%)] dark:bg-gradient-to-b dark:from-[hsl(219_20%_97%)] dark:via-cream-raised dark:to-cream-raised dark:text-ink-primary-light">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 flex-wrap font-serif font-normal tracking-tight text-ink-primary-light">
              <ClipboardCheck className="h-5 w-5 shrink-0 text-gold-deep" />
              Inspections & Punch List
            </CardTitle>
            <CardDescription className="text-ink-secondary-light">Upcoming tasks across all projects</CardDescription>
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap">
            {overdueInspections > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" />
                {overdueInspections} overdue
              </Badge>
            )}
            {criticalItems > 0 && (
              <Badge variant="outline" className="gap-1 border-gold/40 bg-gold-soft/50 text-gold-deep">
                <AlertTriangle className="h-3 w-3" />
                {criticalItems} critical
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        <Tabs defaultValue="inspections" className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-2 gap-0.5 rounded-lg border border-cream-sunken/80 bg-cream-sunken/45 p-1 text-ink-secondary-light">
            <TabsTrigger
              value="inspections"
              className="gap-2 data-[state=active]:bg-cream data-[state=active]:text-ink-primary-light data-[state=active]:shadow-sm"
            >
              <Calendar className="h-4 w-4" />
              Inspections
              {upcomingCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-5 border border-cream-sunken bg-cream px-1.5 text-xs text-ink-primary-light"
                >
                  {upcomingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="punchlist"
              className="gap-2 data-[state=active]:bg-cream data-[state=active]:text-ink-primary-light data-[state=active]:shadow-sm"
            >
              <AlertTriangle className="h-4 w-4" />
              Punch List
              {openPunchItems > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-5 border border-cream-sunken bg-cream px-1.5 text-xs text-ink-primary-light"
                >
                  {openPunchItems}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inspections" className="space-y-3 mt-0">
            {inspections.length === 0 ? (
              <div className="py-6 text-center text-sm text-ink-secondary-light">
                No upcoming inspections scheduled
              </div>
            ) : (
              <>
                {inspections.map((inspection) => {
                  const statusConfig = INSPECTION_STATUS_CONFIG[inspection.status];
                  const overdue = isOverdue(inspection.scheduled_date);
                  const upcoming = isUpcoming(inspection.scheduled_date);
                  
                  return (
                    <div
                      key={inspection.id}
                      className={`flex items-center justify-between p-3 rounded-lg border border-cream-sunken/60 transition-colors ${
                        overdue
                          ? "bg-destructive/5 border-destructive/30"
                          : upcoming
                            ? "bg-amber-500/[0.07] border-amber-500/35"
                            : "bg-cream-sunken/35 hover:bg-cream-sunken/55"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          overdue 
                            ? "bg-destructive/20 text-destructive" 
                            : "bg-teal/12 text-teal"
                        }`}>
                          {overdue ? (
                            <AlertCircle className="h-5 w-5" />
                          ) : (
                            <Calendar className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-primary-light">
                            {INSPECTION_TYPE_LABELS[inspection.inspection_type]}
                          </p>
                          <p className="truncate text-xs text-ink-secondary-light">
                            {inspection.projects.name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <p className={`text-xs font-medium ${overdue ? "text-destructive" : "text-ink-secondary-light"}`}>
                            {overdue ? "Overdue" : format(new Date(inspection.scheduled_date), "MMM d")}
                          </p>
                          <Badge className={`text-xs ${statusConfig.bgColor} ${statusConfig.color} border-0`}>
                            {statusConfig.label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full text-ink-secondary-light hover:bg-cream-sunken/50 hover:text-ink-primary-light"
                >
                  <Link to="/projects" className="gap-2">
                    View all inspections
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="punchlist" className="space-y-3 mt-0">
            {punchListItems.length === 0 ? (
              <div className="py-6 text-center text-sm text-ink-secondary-light">
                No open punch list items
              </div>
            ) : (
              <>
                {punchListItems.map((item) => {
                  const priorityConfig = PUNCH_LIST_PRIORITY_CONFIG[item.priority];
                  const overdue = item.due_date && isOverdue(item.due_date);
                  
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between p-3 rounded-lg border border-cream-sunken/60 transition-colors ${
                        overdue
                          ? "bg-destructive/5 border-destructive/30"
                          : item.priority === "critical" || item.priority === "high"
                            ? "bg-orange-500/[0.07] border-orange-500/35"
                            : "bg-cream-sunken/35 hover:bg-cream-sunken/55"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          item.priority === "critical" 
                            ? "bg-red-500/20 text-red-600" 
                            : item.priority === "high"
                              ? "bg-orange-500/20 text-orange-600"
                              : "bg-cream-sunken text-ink-tertiary-light"
                        }`}>
                          {item.status === "in_progress" ? (
                            <Clock className="h-5 w-5" />
                          ) : (
                            <AlertTriangle className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-primary-light">{item.title}</p>
                          <div className="flex items-center gap-2 text-xs text-ink-secondary-light">
                            <span className="truncate">{item.projects.name}</span>
                            {item.location && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1 truncate">
                                  <MapPin className="h-3 w-3" />
                                  {item.location}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          {item.due_date && (
                          <p className={`text-xs font-medium ${item.due_date && overdue ? "text-destructive" : "text-ink-secondary-light"}`}>
                              {overdue ? "Overdue" : format(new Date(item.due_date), "MMM d")}
                            </p>
                          )}
                          <Badge className={`text-xs ${priorityConfig.bgColor} ${priorityConfig.color} border-0`}>
                            {priorityConfig.label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full text-ink-secondary-light hover:bg-cream-sunken/50 hover:text-ink-primary-light"
                >
                  <Link to="/projects" className="gap-2">
                    View all punch list items
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
