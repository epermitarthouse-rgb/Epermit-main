import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { JurisdictionMetrics } from '@/types/analytics';
import { cn } from '@/lib/utils';
import { DATA_INTELLIGENCE_PANEL } from '@/components/layout/editorialPageChrome';

interface JurisdictionTableProps {
  metrics: JurisdictionMetrics[];
}

const panel = cn(DATA_INTELLIGENCE_PANEL);

export function JurisdictionTable({ metrics }: JurisdictionTableProps) {
  const formatDays = (days: number | null) => {
    if (days === null) return '-';
    return `${days.toFixed(1)}d`;
  };

  const getApprovalRateColor = (rate: number) => {
    if (rate >= 80) return 'text-emerald-400';
    if (rate >= 50) return 'text-amber-300';
    return 'text-red-400';
  };

  if (metrics.length === 0) {
    return (
      <Card className={panel}>
        <CardHeader>
          <CardTitle className="text-ink-primary-dark">Cycle Time by Jurisdiction</CardTitle>
          <CardDescription className="text-ink-secondary-dark">
            Average processing times and approval rates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-ink-tertiary-dark">
            No jurisdiction data available yet. Add projects with jurisdictions to see metrics.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={panel}>
      <CardHeader>
        <CardTitle className="text-ink-primary-dark">Cycle Time by Jurisdiction</CardTitle>
        <CardDescription className="text-ink-secondary-dark">
          Average processing times and approval rates by jurisdiction
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-6 sm:px-6">
        <div className="overflow-x-auto">
          <Table className="min-w-[500px] [&_.border-b]:border-teal/10 [&_thead_tr]:border-teal/20">
          <TableHeader>
            <TableRow className="border-teal/15 hover:bg-transparent">
              <TableHead className="text-ink-secondary-dark">Jurisdiction</TableHead>
              <TableHead className="text-center text-ink-secondary-dark">Projects</TableHead>
              <TableHead className="text-center text-ink-secondary-dark">Avg Cycle</TableHead>
              <TableHead className="text-center text-ink-secondary-dark">Avg Review</TableHead>
              <TableHead className="text-center text-ink-secondary-dark">Rejections</TableHead>
              <TableHead className="text-ink-secondary-dark">Approval Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.slice(0, 10).map((metric) => (
              <TableRow key={metric.jurisdiction} className="border-teal/10 hover:bg-teal/[0.04]">
                <TableCell className="font-medium text-ink-primary-dark">{metric.jurisdiction}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="border-teal/30 text-ink-secondary-dark">
                    {metric.projectCount}
                  </Badge>
                </TableCell>
                <TableCell className="text-center text-ink-primary-dark">{formatDays(metric.avgCycleTime)}</TableCell>
                <TableCell className="text-center text-ink-primary-dark">{formatDays(metric.avgSubmitToApproval)}</TableCell>
                <TableCell className="text-center">
                  {metric.rejectionCount > 0 ? (
                    <Badge variant="destructive">{metric.rejectionCount}</Badge>
                  ) : (
                    <span className="text-ink-tertiary-dark">0</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={metric.approvalRate} className="h-2 w-16" />
                    <span className={`text-sm font-medium ${getApprovalRateColor(metric.approvalRate)}`}>
                      {metric.approvalRate.toFixed(0)}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}
