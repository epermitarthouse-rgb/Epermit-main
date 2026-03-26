import { useState } from 'react';
import { Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import type { 
  AnalyticsSummary, 
  JurisdictionMetrics, 
  ProjectTypeMetrics, 
  RejectionTrend 
} from '@/types/analytics';
import type { DateRange } from './DateRangeFilter';

interface AnalyticsExportProps {
  summary: AnalyticsSummary;
  jurisdictionMetrics: JurisdictionMetrics[];
  projectTypeMetrics: ProjectTypeMetrics[];
  rejectionTrends: RejectionTrend[];
  dateRange: DateRange;
}

export function AnalyticsExport({
  summary,
  jurisdictionMetrics,
  projectTypeMetrics,
  rejectionTrends,
  dateRange,
}: AnalyticsExportProps) {
  const [exporting, setExporting] = useState(false);

  const getDateRangeLabel = () => {
    if (!dateRange.from && !dateRange.to) return 'All Time';
    if (dateRange.from && dateRange.to) {
      return `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`;
    }
    return 'Custom Range';
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  const formatDays = (value: number | null) => {
    if (value === null) return 'N/A';
    return `${Math.round(value)} days`;
  };

  const exportToPDF = async () => {
    setExporting(true);
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      let yPos = 20;

      // Title
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('Permit Analytics Report', pageWidth / 2, yPos, { align: 'center' });
      yPos += 10;

      // Date range
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Period: ${getDateRangeLabel()}`, pageWidth / 2, yPos, { align: 'center' });
      doc.text(`Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}`, pageWidth / 2, yPos + 5, { align: 'center' });
      yPos += 20;

      // Summary Section
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Summary', 14, yPos);
      yPos += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const summaryData = [
        ['Total Projects', summary.totalProjects.toString()],
        ['Active Projects', summary.activeProjects.toString()],
        ['Approved Projects', summary.approvedProjects.toString()],
        ['Avg Cycle Time', formatDays(summary.avgCycleTime)],
        ['Total Permit Fees', formatCurrency(summary.totalPermitFees)],
        ['Total Expeditor Costs', formatCurrency(summary.totalExpeditorCosts)],
        ['Total Costs', formatCurrency(summary.totalCosts)],
        ['Total Rejections', summary.totalRejections.toString()],
      ];

      summaryData.forEach(([label, value]) => {
        doc.text(`${label}: ${value}`, 14, yPos);
        yPos += 6;
      });
      yPos += 10;

      // Jurisdiction Metrics
      if (jurisdictionMetrics.length > 0) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Jurisdiction Performance', 14, yPos);
        yPos += 8;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Jurisdiction', 14, yPos);
        doc.text('Projects', 80, yPos);
        doc.text('Avg Cycle', 110, yPos);
        doc.text('Approval Rate', 145, yPos);
        doc.text('Rejections', 180, yPos);
        yPos += 6;

        doc.setFont('helvetica', 'normal');
        jurisdictionMetrics.slice(0, 10).forEach(m => {
          if (yPos > 270) {
            doc.addPage();
            yPos = 20;
          }
          doc.text(m.jurisdiction.substring(0, 25), 14, yPos);
          doc.text(m.projectCount.toString(), 80, yPos);
          doc.text(formatDays(m.avgCycleTime), 110, yPos);
          doc.text(formatPercent(m.approvalRate), 145, yPos);
          doc.text(m.rejectionCount.toString(), 180, yPos);
          yPos += 5;
        });
        yPos += 10;
      }

      // Project Type Metrics
      if (projectTypeMetrics.length > 0) {
        if (yPos > 240) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Project Type Breakdown', 14, yPos);
        yPos += 8;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Type', 14, yPos);
        doc.text('Count', 80, yPos);
        doc.text('Avg Cycle', 110, yPos);
        doc.text('Approval Rate', 145, yPos);
        doc.text('Total Cost', 180, yPos);
        yPos += 6;

        doc.setFont('helvetica', 'normal');
        projectTypeMetrics.forEach(m => {
          if (yPos > 270) {
            doc.addPage();
            yPos = 20;
          }
          const typeLabel = m.projectType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          doc.text(typeLabel.substring(0, 25), 14, yPos);
          doc.text(m.count.toString(), 80, yPos);
          doc.text(formatDays(m.avgCycleTime), 110, yPos);
          doc.text(formatPercent(m.approvalRate), 145, yPos);
          doc.text(formatCurrency(m.totalCost), 180, yPos);
          yPos += 5;
        });
        yPos += 10;
      }

      // Rejection Trends
      if (rejectionTrends.length > 0) {
        if (yPos > 240) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Top Rejection Reasons', 14, yPos);
        yPos += 8;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Reason', 14, yPos);
        doc.text('Count', 140, yPos);
        doc.text('Percentage', 170, yPos);
        yPos += 6;

        doc.setFont('helvetica', 'normal');
        rejectionTrends.slice(0, 10).forEach(r => {
          if (yPos > 270) {
            doc.addPage();
            yPos = 20;
          }
          doc.text(r.reason.substring(0, 50), 14, yPos);
          doc.text(r.count.toString(), 140, yPos);
          doc.text(formatPercent(r.percentage), 170, yPos);
          yPos += 5;
        });
      }

      // Save the PDF
      const fileName = `permit-analytics-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
      doc.save(fileName);
      toast.success('PDF report downloaded successfully');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF report');
    } finally {
      setExporting(false);
    }
  };

  const exportToCSV = () => {
    setExporting(true);
    try {
      const rows: string[][] = [];

      // Header
      rows.push(['Permit Analytics Report']);
      rows.push([`Period: ${getDateRangeLabel()}`]);
      rows.push([`Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}`]);
      rows.push([]);

      // Summary
      rows.push(['SUMMARY']);
      rows.push(['Metric', 'Value']);
      rows.push(['Total Projects', summary.totalProjects.toString()]);
      rows.push(['Active Projects', summary.activeProjects.toString()]);
      rows.push(['Approved Projects', summary.approvedProjects.toString()]);
      rows.push(['Avg Cycle Time (days)', summary.avgCycleTime?.toFixed(1) || 'N/A']);
      rows.push(['Total Permit Fees', summary.totalPermitFees.toString()]);
      rows.push(['Total Expeditor Costs', summary.totalExpeditorCosts.toString()]);
      rows.push(['Total Costs', summary.totalCosts.toString()]);
      rows.push(['Total Rejections', summary.totalRejections.toString()]);
      rows.push([]);

      // Jurisdiction Metrics
      if (jurisdictionMetrics.length > 0) {
        rows.push(['JURISDICTION PERFORMANCE']);
        rows.push(['Jurisdiction', 'Projects', 'Avg Cycle Time (days)', 'Approval Rate (%)', 'Rejections']);
        jurisdictionMetrics.forEach(m => {
          rows.push([
            m.jurisdiction,
            m.projectCount.toString(),
            m.avgCycleTime?.toFixed(1) || 'N/A',
            m.approvalRate.toFixed(1),
            m.rejectionCount.toString(),
          ]);
        });
        rows.push([]);
      }

      // Project Type Metrics
      if (projectTypeMetrics.length > 0) {
        rows.push(['PROJECT TYPE BREAKDOWN']);
        rows.push(['Type', 'Count', 'Avg Cycle Time (days)', 'Approval Rate (%)', 'Total Cost']);
        projectTypeMetrics.forEach(m => {
          rows.push([
            m.projectType.replace(/_/g, ' '),
            m.count.toString(),
            m.avgCycleTime?.toFixed(1) || 'N/A',
            m.approvalRate.toFixed(1),
            m.totalCost.toString(),
          ]);
        });
        rows.push([]);
      }

      // Rejection Trends
      if (rejectionTrends.length > 0) {
        rows.push(['REJECTION REASONS']);
        rows.push(['Reason', 'Count', 'Percentage (%)']);
        rejectionTrends.forEach(r => {
          rows.push([r.reason, r.count.toString(), r.percentage.toFixed(1)]);
        });
      }

      // Convert to CSV string
      const csvContent = rows
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      // Download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `permit-analytics-${format(new Date(), 'yyyy-MM-dd')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('CSV report downloaded successfully');
    } catch (error) {
      console.error('Error generating CSV:', error);
      toast.error('Failed to generate CSV report');
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={exporting}>
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportToPDF} disabled={exporting}>
          <FileText className="mr-2 h-4 w-4" />
          Download PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportToCSV} disabled={exporting}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Download CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
