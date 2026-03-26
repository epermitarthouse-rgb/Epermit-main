import jsPDF from 'jspdf';
import { format } from 'date-fns';

interface ChecklistItem {
  id: string;
  category: string;
  item: string;
  requirement: string;
  checked: boolean;
  notes: string;
  status: 'pending' | 'pass' | 'fail' | 'na';
}

interface ChecklistFormData {
  projectName: string;
  projectAddress: string;
  inspectionType: string;
  inspectorName: string;
  permitNumber: string;
  inspectionDate: string;
  weather: string;
  temperature: string;
  generalNotes: string;
}

interface ChecklistPDFParams {
  formData: ChecklistFormData;
  checklistItems: ChecklistItem[];
  customItems: ChecklistItem[];
  inspectorSignedAt: string | null;
  contractorSignedAt: string | null;
}

const INSPECTION_TYPE_LABELS: Record<string, string> = {
  foundation: 'Foundation',
  framing: 'Framing',
  electrical_rough: 'Electrical Rough',
  electrical_final: 'Electrical Final',
  plumbing_rough: 'Plumbing Rough',
  plumbing_final: 'Plumbing Final',
  mechanical_rough: 'Mechanical Rough',
  mechanical_final: 'Mechanical Final',
  insulation: 'Insulation',
  drywall: 'Drywall',
  fire_safety: 'Fire Safety',
  final: 'Final',
  other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  pass: '✓ PASS',
  fail: '✗ FAIL',
  na: 'N/A',
  pending: '○ PENDING',
};

const STATUS_COLORS: Record<string, [number, number, number]> = {
  pass: [22, 163, 74],     // green
  fail: [220, 38, 38],     // red
  na: [113, 113, 122],     // gray
  pending: [202, 138, 4],  // yellow
};

function getInspectionTypeLabel(type: string): string {
  return INSPECTION_TYPE_LABELS[type] || type;
}

export function generateChecklistPDF(params: ChecklistPDFParams): string {
  const { formData, checklistItems, customItems, inspectorSignedAt, contractorSignedAt } = params;
  const allItems = [...checklistItems, ...customItems];
  
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);
  let yPos = margin;

  // Helper functions
  const addNewPageIfNeeded = (requiredSpace: number) => {
    if (yPos + requiredSpace > pageHeight - margin) {
      pdf.addPage();
      yPos = margin;
      return true;
    }
    return false;
  };

  const drawHorizontalLine = (y: number, color: [number, number, number] = [226, 232, 240]) => {
    pdf.setDrawColor(...color);
    pdf.setLineWidth(0.3);
    pdf.line(margin, y, pageWidth - margin, y);
  };

  // Calculate summary
  const summary = {
    total: allItems.length,
    passed: allItems.filter(i => i.status === 'pass').length,
    failed: allItems.filter(i => i.status === 'fail').length,
    na: allItems.filter(i => i.status === 'na').length,
    pending: allItems.filter(i => i.status === 'pending').length,
  };

  // Determine overall status
  let overallStatus = 'PASSED';
  let statusColor: [number, number, number] = [22, 163, 74];
  if (summary.failed > 0) {
    overallStatus = 'FAILED - Corrections Required';
    statusColor = [220, 38, 38];
  } else if (summary.pending > 0) {
    overallStatus = 'INCOMPLETE - Items Pending Review';
    statusColor = [202, 138, 4];
  }

  // ===== HEADER =====
  pdf.setFillColor(30, 41, 59);
  pdf.rect(0, 0, pageWidth, 40, 'F');
  
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text('Inspection Checklist', margin, 20);
  
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`Generated: ${format(new Date(), 'MMMM d, yyyy h:mm a')}`, margin, 30);
  
  yPos = 50;

  // ===== STATUS BANNER =====
  pdf.setFillColor(...statusColor);
  pdf.rect(margin, yPos, contentWidth, 12, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text(overallStatus, pageWidth / 2, yPos + 8, { align: 'center' });
  
  yPos += 20;

  // ===== PROJECT DETAILS =====
  pdf.setTextColor(30, 41, 59);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('Project Details', margin, yPos);
  yPos += 3;
  drawHorizontalLine(yPos);
  yPos += 8;

  pdf.setFontSize(10);
  const projectDetails = [
    ['Project Name:', formData.projectName || 'N/A'],
    ['Address:', formData.projectAddress || 'N/A'],
    ['Permit Number:', formData.permitNumber || 'N/A'],
    ['Inspection Type:', getInspectionTypeLabel(formData.inspectionType)],
    ['Inspection Date:', formData.inspectionDate || 'N/A'],
    ['Inspector:', formData.inspectorName || 'N/A'],
  ];

  if (formData.weather || formData.temperature) {
    projectDetails.push(['Weather:', `${formData.weather || ''} ${formData.temperature ? `(${formData.temperature})` : ''}`]);
  }

  projectDetails.forEach(([label, value]) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 116, 139);
    pdf.text(label, margin, yPos);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text(value, margin + 40, yPos);
    yPos += 6;
  });

  yPos += 8;

  // ===== SUMMARY =====
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('Checklist Summary', margin, yPos);
  yPos += 3;
  drawHorizontalLine(yPos);
  yPos += 8;

  const summaryBoxWidth = (contentWidth - 15) / 4;
  const summaryBoxHeight = 20;
  const summaryItems = [
    { label: 'PASSED', value: summary.passed, color: [240, 253, 244] as [number, number, number], textColor: [22, 163, 74] as [number, number, number] },
    { label: 'FAILED', value: summary.failed, color: [254, 242, 242] as [number, number, number], textColor: [220, 38, 38] as [number, number, number] },
    { label: 'PENDING', value: summary.pending, color: [254, 252, 232] as [number, number, number], textColor: [202, 138, 4] as [number, number, number] },
    { label: 'N/A', value: summary.na, color: [244, 244, 245] as [number, number, number], textColor: [113, 113, 122] as [number, number, number] },
  ];

  summaryItems.forEach((item, index) => {
    const x = margin + (index * (summaryBoxWidth + 5));
    pdf.setFillColor(...item.color);
    pdf.roundedRect(x, yPos, summaryBoxWidth, summaryBoxHeight, 2, 2, 'F');
    
    pdf.setTextColor(...item.textColor);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(item.value.toString(), x + summaryBoxWidth / 2, yPos + 10, { align: 'center' });
    
    pdf.setFontSize(8);
    pdf.text(item.label, x + summaryBoxWidth / 2, yPos + 16, { align: 'center' });
  });

  yPos += summaryBoxHeight + 5;
  pdf.setTextColor(100, 116, 139);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`Total Items: ${summary.total}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 12;

  // ===== CHECKLIST ITEMS BY CATEGORY =====
  const itemsByCategory = allItems.reduce((acc, item) => {
    const cat = item.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);

  Object.entries(itemsByCategory).forEach(([category, items]) => {
    addNewPageIfNeeded(30);
    
    pdf.setTextColor(30, 41, 59);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(category, margin, yPos);
    yPos += 3;
    drawHorizontalLine(yPos);
    yPos += 6;

    items.forEach((item) => {
      addNewPageIfNeeded(20);
      
      // Status badge
      const [r, g, b] = STATUS_COLORS[item.status];
      pdf.setFillColor(r, g, b);
      pdf.roundedRect(margin, yPos - 3, 18, 5, 1, 1, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(6);
      pdf.setFont('helvetica', 'bold');
      const statusText = item.status.toUpperCase();
      pdf.text(statusText, margin + 9, yPos, { align: 'center' });
      
      // Item text
      pdf.setTextColor(30, 41, 59);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      const itemText = pdf.splitTextToSize(item.item, contentWidth - 25);
      pdf.text(itemText, margin + 22, yPos);
      yPos += itemText.length * 4 + 2;
      
      // Requirement
      pdf.setTextColor(100, 116, 139);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      const reqText = pdf.splitTextToSize(`Requirement: ${item.requirement}`, contentWidth - 22);
      pdf.text(reqText, margin + 22, yPos);
      yPos += reqText.length * 3.5;
      
      // Notes if any
      if (item.notes) {
        pdf.setTextColor(71, 85, 105);
        pdf.setFont('helvetica', 'italic');
        const notesText = pdf.splitTextToSize(`Notes: ${item.notes}`, contentWidth - 22);
        pdf.text(notesText, margin + 22, yPos);
        yPos += notesText.length * 3.5;
      }
      
      yPos += 4;
    });
    
    yPos += 4;
  });

  // ===== GENERAL NOTES =====
  if (formData.generalNotes) {
    addNewPageIfNeeded(30);
    
    pdf.setTextColor(30, 41, 59);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('General Notes', margin, yPos);
    yPos += 3;
    drawHorizontalLine(yPos);
    yPos += 8;
    
    pdf.setTextColor(51, 65, 85);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const notesLines = pdf.splitTextToSize(formData.generalNotes, contentWidth);
    pdf.text(notesLines, margin, yPos);
    yPos += notesLines.length * 5 + 8;
  }

  // ===== SIGNATURES =====
  addNewPageIfNeeded(50);
  
  pdf.setTextColor(30, 41, 59);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('Signatures', margin, yPos);
  yPos += 3;
  drawHorizontalLine(yPos);
  yPos += 8;

  const sigBoxWidth = (contentWidth - 10) / 2;
  const sigBoxHeight = 25;

  // Inspector signature box
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(margin, yPos, sigBoxWidth, sigBoxHeight, 2, 2, 'FD');
  
  pdf.setTextColor(22, 163, 74);
  pdf.setFontSize(12);
  pdf.text('✓', margin + 5, yPos + 10);
  
  pdf.setTextColor(30, 41, 59);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('Inspector', margin + 12, yPos + 10);
  
  pdf.setTextColor(100, 116, 139);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Signed: ${inspectorSignedAt || 'Not signed'}`, margin + 5, yPos + 18);

  // Contractor signature box
  const contractorBoxX = margin + sigBoxWidth + 10;
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(contractorBoxX, yPos, sigBoxWidth, sigBoxHeight, 2, 2, 'FD');
  
  pdf.setTextColor(22, 163, 74);
  pdf.setFontSize(12);
  pdf.text('✓', contractorBoxX + 5, yPos + 10);
  
  pdf.setTextColor(30, 41, 59);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('Contractor/Owner', contractorBoxX + 12, yPos + 10);
  
  pdf.setTextColor(100, 116, 139);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Signed: ${contractorSignedAt || 'Not signed'}`, contractorBoxX + 5, yPos + 18);

  yPos += sigBoxHeight + 15;

  // ===== FOOTER =====
  const footerY = pageHeight - 15;
  pdf.setTextColor(148, 163, 184);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Generated by PermitFlow', pageWidth / 2, footerY, { align: 'center' });
  pdf.text(`© ${new Date().getFullYear()} PermitFlow. All rights reserved.`, pageWidth / 2, footerY + 4, { align: 'center' });

  // Return base64 encoded PDF
  return pdf.output('datauristring').split(',')[1];
}

export function downloadChecklistPDF(params: ChecklistPDFParams, filename?: string) {
  const { formData } = params;
  const pdf = new jsPDF('p', 'mm', 'a4');
  
  // We need to regenerate the PDF for download (can't reuse base64)
  const base64 = generateChecklistPDF(params);
  
  // Convert base64 back to blob and download
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: 'application/pdf' });
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `inspection-checklist-${formData.projectName || 'unknown'}-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
