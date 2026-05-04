import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalyticsSummary } from '@/types/analytics';
import { cn } from '@/lib/utils';
import { DATA_INTELLIGENCE_PANEL } from '@/components/layout/editorialPageChrome';
import { 
  FileCheck, 
  Clock, 
  DollarSign, 
  AlertTriangle, 
  TrendingUp, 
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';

interface AnalyticsSummaryCardsProps {
  summary: AnalyticsSummary;
}

export function AnalyticsSummaryCards({ summary }: AnalyticsSummaryCardsProps) {
  const formatDays = (days: number | null) => {
    if (days === null) return 'N/A';
    return `${days.toFixed(1)} days`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const toneIcon = {
    teal: 'border border-teal/25 bg-teal/15 text-teal',
    gold: 'border border-gold/30 bg-gold/10 text-gold',
    danger: 'border border-red-500/25 bg-red-500/10 text-red-400',
  };

  const cards: {
    title: string;
    value: string;
    subtitle: string;
    icon: LucideIcon;
    tone: keyof typeof toneIcon;
  }[] = [
    {
      title: 'Total Projects',
      value: summary.totalProjects.toString(),
      subtitle: `${summary.activeProjects} active, ${summary.approvedProjects} approved`,
      icon: FolderOpen,
      tone: 'teal',
    },
    {
      title: 'Avg Cycle Time',
      value: formatDays(summary.avgCycleTime),
      subtitle: 'From draft to approval',
      icon: Clock,
      tone: 'gold',
    },
    {
      title: 'Avg Review Time',
      value: formatDays(summary.avgSubmitToApproval),
      subtitle: 'Submit to approval',
      icon: TrendingUp,
      tone: 'teal',
    },
    {
      title: 'Total Permit Fees',
      value: formatCurrency(summary.totalPermitFees),
      subtitle: 'All projects',
      icon: DollarSign,
      tone: 'gold',
    },
    {
      title: 'Total Costs',
      value: formatCurrency(summary.totalCosts),
      subtitle: summary.avgCostPerPermit ? `Avg ${formatCurrency(summary.avgCostPerPermit)}/permit` : 'Per permit avg N/A',
      icon: FileCheck,
      tone: 'teal',
    },
    {
      title: 'Total Rejections',
      value: summary.totalRejections.toString(),
      subtitle: 'Correction requests',
      icon: AlertTriangle,
      tone: 'danger',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.title} className={cn(DATA_INTELLIGENCE_PANEL)}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-ink-secondary-dark">
              {card.title}
            </CardTitle>
            <div className={cn('rounded-full p-2', toneIcon[card.tone])}>
              <card.icon className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ink-primary-dark">{card.value}</div>
            <p className="mt-1 text-xs text-ink-tertiary-dark">{card.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
