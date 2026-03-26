import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { 
  AlertTriangle, 
  Clock, 
  CalendarClock, 
  ChevronRight,
  Loader2,
  Bell,
  CheckCircle2
} from 'lucide-react';
import { format, differenceInDays, isPast, isToday, addDays, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface DeadlineItem {
  id: string;
  name: string;
  deadline: string;
  status: string;
  jurisdiction: string | null;
  daysUntil: number;
  isOverdue: boolean;
}

export function DeadlineAlertsWidget() {
  const { user } = useAuth();
  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchDeadlines = async () => {
      setLoading(true);
      
      // Fetch projects with deadlines that are not yet approved
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, deadline, status, jurisdiction')
        .not('deadline', 'is', null)
        .neq('status', 'approved')
        .order('deadline', { ascending: true });

      if (error) {
        console.error('Error fetching deadlines:', error);
        setLoading(false);
        return;
      }

      const now = new Date();
      const items: DeadlineItem[] = (data || []).map(project => {
        const deadlineDate = parseISO(project.deadline);
        const daysUntil = differenceInDays(deadlineDate, now);
        
        return {
          id: project.id,
          name: project.name,
          deadline: project.deadline,
          status: project.status,
          jurisdiction: project.jurisdiction,
          daysUntil,
          isOverdue: isPast(deadlineDate) && !isToday(deadlineDate),
        };
      });

      setDeadlines(items);
      setLoading(false);
    };

    fetchDeadlines();

    // Set up real-time subscription
    const channel = supabase
      .channel('deadline-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects' },
        () => fetchDeadlines()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const overdueItems = deadlines.filter(d => d.isOverdue);
  const urgentItems = deadlines.filter(d => !d.isOverdue && d.daysUntil <= 7 && d.daysUntil >= 0);
  const upcomingItems = deadlines.filter(d => !d.isOverdue && d.daysUntil > 7 && d.daysUntil <= 30);

  const getUrgencyBadge = (item: DeadlineItem) => {
    if (item.isOverdue) {
      return <Badge variant="destructive" className="text-xs">Overdue</Badge>;
    }
    if (item.daysUntil === 0) {
      return <Badge variant="destructive" className="text-xs">Due Today</Badge>;
    }
    if (item.daysUntil <= 3) {
      return <Badge className="bg-orange-500 text-white text-xs">{item.daysUntil}d left</Badge>;
    }
    if (item.daysUntil <= 7) {
      return <Badge className="bg-amber-500 text-white text-xs">{item.daysUntil}d left</Badge>;
    }
    return <Badge variant="secondary" className="text-xs">{item.daysUntil}d left</Badge>;
  };

  const renderDeadlineItem = (item: DeadlineItem) => (
    <Link
      key={item.id}
      to="/projects"
      className={cn(
        "flex items-center justify-between p-3 rounded-lg border transition-colors hover:bg-muted/50",
        item.isOverdue && "border-destructive/50 bg-destructive/5",
        !item.isOverdue && item.daysUntil <= 3 && "border-orange-500/50 bg-orange-500/5"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
          item.isOverdue ? "bg-destructive/20 text-destructive" : 
          item.daysUntil <= 3 ? "bg-orange-500/20 text-orange-600" :
          "bg-amber-500/20 text-amber-600"
        )}>
          {item.isOverdue ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            {format(parseISO(item.deadline), 'MMM d, yyyy')}
            {item.jurisdiction && ` • ${item.jurisdiction}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {getUrgencyBadge(item)}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Deadline Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const totalAlerts = overdueItems.length + urgentItems.length;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <CardTitle>Deadline Alerts</CardTitle>
            {totalAlerts > 0 && (
              <Badge variant="destructive" className="ml-2">
                {totalAlerts} {totalAlerts === 1 ? 'alert' : 'alerts'}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/projects">View All</Link>
          </Button>
        </div>
        <CardDescription>
          Upcoming permit deadlines and overdue items
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        {deadlines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" />
            <p className="font-medium">All caught up!</p>
            <p className="text-sm text-muted-foreground">No upcoming deadlines to worry about</p>
          </div>
        ) : (
          <Tabs defaultValue="overdue" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overdue" className="relative text-xs sm:text-sm">
                Overdue
                {overdueItems.length > 0 && (
                  <Badge variant="destructive" className="ml-1.5 h-5 w-5 p-0 text-xs justify-center">
                    {overdueItems.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="urgent">
                This Week
                {urgentItems.length > 0 && (
                  <Badge className="ml-1.5 h-5 w-5 p-0 text-xs justify-center bg-amber-500">
                    {urgentItems.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="upcoming" className="text-xs sm:text-sm">
                Upcoming
                {upcomingItems.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 w-5 p-0 text-xs justify-center">
                    {upcomingItems.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overdue" className="mt-4 space-y-2">
              {overdueItems.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  No overdue deadlines
                </p>
              ) : (
                overdueItems.slice(0, 5).map(renderDeadlineItem)
              )}
            </TabsContent>

            <TabsContent value="urgent" className="mt-4 space-y-2">
              {urgentItems.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  No deadlines this week
                </p>
              ) : (
                urgentItems.slice(0, 5).map(renderDeadlineItem)
              )}
            </TabsContent>

            <TabsContent value="upcoming" className="mt-4 space-y-2">
              {upcomingItems.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  No upcoming deadlines in the next 30 days
                </p>
              ) : (
                upcomingItems.slice(0, 5).map(renderDeadlineItem)
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
