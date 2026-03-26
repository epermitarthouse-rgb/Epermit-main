import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalyticsSummary } from '@/types/analytics';
import { 
  FileCheck, 
  Clock, 
  DollarSign, 
  AlertTriangle, 
  TrendingUp, 
  FolderOpen 
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

  const cards = [
    {
      title: 'Total Projects',
      value: summary.totalProjects.toString(),
      subtitle: `${summary.activeProjects} active, ${summary.approvedProjects} approved`,
      icon: FolderOpen,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
    },
    {
      title: 'Avg Cycle Time',
      value: formatDays(summary.avgCycleTime),
      subtitle: 'From draft to approval',
      icon: Clock,
      color: 'text-amber-600',
      bgColor: 'bg-amber-100',
    },
    {
      title: 'Avg Review Time',
      value: formatDays(summary.avgSubmitToApproval),
      subtitle: 'Submit to approval',
      icon: TrendingUp,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-100',
    },
    {
      title: 'Total Permit Fees',
      value: formatCurrency(summary.totalPermitFees),
      subtitle: 'All projects',
      icon: DollarSign,
      color: 'text-green-600',
      bgColor: 'bg-green-100',
    },
    {
      title: 'Total Costs',
      value: formatCurrency(summary.totalCosts),
      subtitle: summary.avgCostPerPermit ? `Avg ${formatCurrency(summary.avgCostPerPermit)}/permit` : 'Per permit avg N/A',
      icon: FileCheck,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
    },
    {
      title: 'Total Rejections',
      value: summary.totalRejections.toString(),
      subtitle: 'Correction requests',
      icon: AlertTriangle,
      color: 'text-red-600',
      bgColor: 'bg-red-100',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <div className={`p-2 rounded-full ${card.bgColor}`}>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
