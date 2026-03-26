import jsPDF from 'jspdf';
import { format } from 'date-fns';

interface ComplianceIssue {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'advisory';
  codeReference: string;
  codeYear: string;
  location: string;
  suggestedFix: string;
}

interface AnalysisSummary {
  totalIssues: number;
  critical: number;
  warnings: number;
  advisory: number;
  overallScore: number;
}

interface IssueResponse {
  status: 'accepted' | 'modified' | 'rejected';
  originalFix: string;
  modifiedResponse?: string;
}

interface ExportOptions {
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  summary: AnalysisSummary;
  issues: ComplianceIssue[];
  responses: Record<string, IssueResponse>;
  jurisdictionNotes: string;
  projectName?: string;
}

const JURISDICTION_LABELS: Record<string, string> = {
  'general': 'International Building Code (IBC)',
  'dc': 'Washington D.C. (12A DCMR)',
  'california': 'California Building Code (CBC)',
  'florida': 'Florida Building Code',
  'texas': 'Texas Building Code',
  'new-york': 'New York City Building Code',
  'chicago': 'Chicago Building Code',
};

const PROJECT_TYPE_LABELS: Record<string, string> = {
  'commercial': 'Commercial',
  'residential': 'Residential',
  'mixed-use': 'Mixed Use',
  'industrial': 'Industrial',
  'healthcare': 'Healthcare',
  'education': 'Educational',
};

const SEVERITY_COLORS: Record<string, [number, number, number]> = {
  critical: [220, 38, 38], // red
  warning: [217, 119, 6], // amber
  advisory: [37, 99, 235], // blue
};

/** Sanitizes values for jsPDF.text - handles null/undefined and converts numbers to strings */
function safeText(text: unknown): string {
  if (text === null || text === undefined) return 'N/A';
  if (typeof text === 'number') return String(text);
  if (typeof text === 'string') return text;
  return String(text);
}

export function exportComplianceReportPDF(options: ExportOptions): void {
  const {
    jurisdiction,
    projectType,
    codeYear,
    summary,
    issues,
    responses,
    jurisdictionNotes,
    projectName,
  } = options;

  // Validate required data
  if (!summary || !issues) {
    throw new Error('Invalid export data: summary and issues are required');
  }

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Helper functions
  const addPage = () => {
    doc.addPage();
    y = margin;
  };

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      addPage();
    }
  };

  const drawLine = (startY: number) => {
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, startY, pageWidth - margin, startY);
  };

  // ==================== COVER PAGE ====================
  
  // Header background
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 60, 'F');
  
  // Logo/Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('COMPLIANCE ANALYSIS REPORT', margin, 35);
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('Building Code Compliance Assessment', margin, 48);
  
  y = 80;
  
  // Project Info Box
  doc.setFillColor(248, 250, 252); // slate-50
  doc.roundedRect(margin, y, contentWidth, 55, 3, 3, 'F');
  
  doc.setTextColor(100, 116, 139); // slate-500
  doc.setFontSize(10);
  doc.text('PROJECT INFORMATION', margin + 10, y + 12);
  
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(safeText(projectName) || 'Unnamed Project', margin + 10, y + 25);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Jurisdiction: ${safeText(JURISDICTION_LABELS[jurisdiction] || jurisdiction)}`, margin + 10, y + 38);
  doc.text(`Project Type: ${safeText(PROJECT_TYPE_LABELS[projectType] || projectType)}`, margin + 10, y + 48);
  doc.text(`Code Year: ${safeText(codeYear)}`, pageWidth / 2, y + 38);
  doc.text(`Generated: ${format(new Date(), 'MMMM d, yyyy')}`, pageWidth / 2, y + 48);
  
  y += 75;
  
  // ==================== SUMMARY SECTION ====================
  
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary', margin, y);
  y += 10;
  drawLine(y);
  y += 15;
  
  // Score indicator
  const overallScore = summary.overallScore ?? 0;
  const scoreColor = overallScore >= 80 
    ? [16, 185, 129] // emerald
    : overallScore >= 60 
      ? [245, 158, 11] // amber
      : [239, 68, 68]; // red
  
  doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
  doc.circle(margin + 25, y + 15, 20, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(`${overallScore}%`, margin + 25, y + 18, { align: 'center' });
  
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Compliance Score', margin + 25, y + 38, { align: 'center' });
  
  // Summary stats
  const statsX = margin + 70;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Issues Breakdown', statsX, y + 5);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  
  // Total
  doc.text(`Total Issues Found: ${safeText(summary.totalIssues)}`, statsX, y + 18);
  
  // Critical
  doc.setFillColor(220, 38, 38);
  doc.circle(statsX + 2, y + 28, 3, 'F');
  doc.setTextColor(220, 38, 38);
  doc.text(`Critical: ${safeText(summary.critical)}`, statsX + 10, y + 30);
  
  // Warnings
  doc.setFillColor(217, 119, 6);
  doc.circle(statsX + 60, y + 28, 3, 'F');
  doc.setTextColor(217, 119, 6);
  doc.text(`Warnings: ${safeText(summary.warnings)}`, statsX + 68, y + 30);
  
  // Advisory
  doc.setFillColor(37, 99, 235);
  doc.circle(statsX + 2, y + 40, 3, 'F');
  doc.setTextColor(37, 99, 235);
  doc.text(`Advisory: ${safeText(summary.advisory)}`, statsX + 10, y + 42);
  
  y += 60;
  
  // ==================== SEVERITY CHART ====================
  
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Issue Distribution', margin, y);
  y += 12;
  
  const chartWidth = contentWidth - 40;
  const chartHeight = 20;
  const total = summary.totalIssues || 1;
  
  // Background
  doc.setFillColor(229, 231, 235);
  doc.roundedRect(margin, y, chartWidth, chartHeight, 3, 3, 'F');
  
  // Critical bar
  const criticalWidth = (summary.critical / total) * chartWidth;
  if (criticalWidth > 0) {
    doc.setFillColor(220, 38, 38);
    doc.roundedRect(margin, y, criticalWidth, chartHeight, 3, 3, 'F');
  }
  
  // Warning bar
  const warningWidth = (summary.warnings / total) * chartWidth;
  if (warningWidth > 0) {
    doc.setFillColor(217, 119, 6);
    doc.rect(margin + criticalWidth, y, warningWidth, chartHeight, 'F');
  }
  
  // Advisory bar
  const advisoryWidth = (summary.advisory / total) * chartWidth;
  if (advisoryWidth > 0) {
    doc.setFillColor(37, 99, 235);
    doc.roundedRect(margin + criticalWidth + warningWidth, y, advisoryWidth, chartHeight, 0, 0, 'F');
  }
  
  y += 35;
  
  // ==================== JURISDICTION NOTES ====================
  
  if (jurisdictionNotes && String(jurisdictionNotes).trim()) {
    checkPageBreak(50);
    
    doc.setFillColor(254, 243, 199); // amber-100
    doc.roundedRect(margin, y, contentWidth, 30, 3, 3, 'F');
    
    doc.setTextColor(146, 64, 14); // amber-800
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Jurisdiction-Specific Notes', margin + 10, y + 12);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const noteLines = doc.splitTextToSize(safeText(jurisdictionNotes), contentWidth - 20);
    doc.text(noteLines.slice(0, 2).map(safeText), margin + 10, y + 22);
    
    y += 40;
  }
  
  // ==================== DETAILED FINDINGS ====================
  
  addPage();
  
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Detailed Findings', margin, y);
  y += 10;
  drawLine(y);
  y += 15;
  
  // Group issues by category
  const issuesByCategory = issues.reduce((acc, issue) => {
    const cat = safeText(issue.category) || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(issue);
    return acc;
  }, {} as Record<string, ComplianceIssue[]>);
  
  Object.entries(issuesByCategory).forEach(([category, categoryIssues]) => {
    checkPageBreak(40);
    
    // Category header
    doc.setFillColor(241, 245, 249); // slate-100
    doc.roundedRect(margin, y, contentWidth, 12, 2, 2, 'F');
    doc.setTextColor(71, 85, 105); // slate-600
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`${safeText(category)} (${categoryIssues.length} issue${categoryIssues.length !== 1 ? 's' : ''})`, margin + 5, y + 8);
    y += 18;
    
    categoryIssues.forEach((issue) => {
      checkPageBreak(60);
      
      const response = responses[issue.id];
      const severity = safeText(issue.severity) || 'advisory';
      const severityColor = SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS] ?? SEVERITY_COLORS.advisory;
      
      // Issue card
      doc.setDrawColor(severityColor[0], severityColor[1], severityColor[2]);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, y, contentWidth, 50, 3, 3, 'S');
      
      // Severity badge
      doc.setFillColor(severityColor[0], severityColor[1], severityColor[2]);
      doc.roundedRect(margin + 5, y + 5, 50, 10, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(safeText(issue.severity).toUpperCase(), margin + 30, y + 11, { align: 'center' });
      
      // Issue title
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      doc.text(safeText(issue.title), margin + 60, y + 11);
      
      // Code reference
      doc.setFillColor(219, 234, 254); // blue-100
      doc.roundedRect(pageWidth - margin - 55, y + 3, 50, 12, 2, 2, 'F');
      doc.setTextColor(30, 64, 175); // blue-800
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(safeText(issue.codeReference), pageWidth - margin - 30, y + 10, { align: 'center' });
      
      // Description
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(9);
      const descLines = doc.splitTextToSize(safeText(issue.description), contentWidth - 15);
      doc.text(descLines.slice(0, 2).map(safeText), margin + 5, y + 24);
      
      // Location
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8);
      doc.text(`Location: ${safeText(issue.location)}`, margin + 5, y + 38);
      
      // Resolution status
      if (response) {
        const statusColor = response.status === 'accepted' 
          ? [16, 185, 129] 
          : response.status === 'modified'
            ? [37, 99, 235]
            : [156, 163, 175];
        doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
        doc.circle(pageWidth - margin - 10, y + 44, 4, 'F');
        doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
        doc.setFontSize(7);
        doc.text(
          safeText(response.status === 'accepted' ? 'RESOLVED' : response.status === 'modified' ? 'MODIFIED' : 'N/A'),
          pageWidth - margin - 18,
          y + 46
        );
      }
      
      y += 55;
    });
    
    y += 5;
  });
  
  // ==================== CODE CITATIONS ====================
  
  addPage();
  
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Code Citations Reference', margin, y);
  y += 10;
  drawLine(y);
  y += 15;
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(
    'The following building code sections were referenced in this compliance analysis:',
    margin,
    y
  );
  y += 12;
  
  // Unique code references
  const codeRefs = [...new Set(issues.map(i => safeText(i.codeReference)))].filter(Boolean).sort();
  
  codeRefs.forEach((ref) => {
    checkPageBreak(12);
    
    const safeRef = safeText(ref);
    const issuesWithRef = issues.filter(i => safeText(i.codeReference) === safeRef);
    const severity = issuesWithRef[0]?.severity || 'advisory';
    const severityColor = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.advisory;
    
    doc.setFillColor(severityColor[0], severityColor[1], severityColor[2]);
    doc.circle(margin + 3, y + 2, 2, 'F');
    
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(safeRef, margin + 10, y + 4);
    
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(` — ${issuesWithRef.length} finding${issuesWithRef.length !== 1 ? 's' : ''}`, margin + 10 + doc.getTextWidth(safeRef), y + 4);
    
    y += 10;
  });
  
  // ==================== FOOTER ====================
  
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    
    // Footer line
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
    
    // Footer text
    doc.setTextColor(156, 163, 175);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Generated by AI Compliance Analyzer • ${format(new Date(), 'MMM d, yyyy h:mm a')}`,
      margin,
      pageHeight - 8
    );
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 8,
      { align: 'right' }
    );
  }
  
  // Save the PDF - use blob download for better browser compatibility
  const filename = `compliance-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch {
    // Fallback to native save if blob fails
    doc.save(filename);
  }
}
