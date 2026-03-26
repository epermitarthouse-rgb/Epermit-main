import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { JurisdictionMetrics } from '@/types/analytics';

interface JurisdictionTableProps {
  metrics: JurisdictionMetrics[];
}

export function JurisdictionTable({ metrics }: JurisdictionTableProps) {
  const formatDays = (days: number | null) => {
    if (days === null) return '-';
    return `${days.toFixed(1)}d`;
  };

  const getApprovalRateColor = (rate: number) => {
    if (rate >= 80) return 'text-emerald-600';
    if (rate >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  if (metrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cycle Time by Jurisdiction</CardTitle>
          <CardDescription>Average processing times and approval rates</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No jurisdiction data available yet. Add projects with jurisdictions to see metrics.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycle Time by Jurisdiction</CardTitle>
        <CardDescription>Average processing times and approval rates by jurisdiction</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6 pb-6">
        <div className="overflow-x-auto">
          <Table className="min-w-[500px]">
          <TableHeader>
            <TableRow>
              <TableHead>Jurisdiction</TableHead>
              <TableHead className="text-center">Projects</TableHead>
              <TableHead className="text-center">Avg Cycle</TableHead>
              <TableHead className="text-center">Avg Review</TableHead>
              <TableHead className="text-center">Rejections</TableHead>
              <TableHead>Approval Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.slice(0, 10).map((metric) => (
              <TableRow key={metric.jurisdiction}>
                <TableCell className="font-medium">{metric.jurisdiction}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline">{metric.projectCount}</Badge>
                </TableCell>
                <TableCell className="text-center">{formatDays(metric.avgCycleTime)}</TableCell>
                <TableCell className="text-center">{formatDays(metric.avgSubmitToApproval)}</TableCell>
                <TableCell className="text-center">
                  {metric.rejectionCount > 0 ? (
                    <Badge variant="destructive">{metric.rejectionCount}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
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
