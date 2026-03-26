import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import { mvpDocumentationData } from './mvpDocumentationData';

const COLORS = {
  primary: [30, 64, 175] as [number, number, number],
  secondary: [71, 85, 105] as [number, number, number],
  text: [15, 23, 42] as [number, number, number],
  lightText: [100, 116, 139] as [number, number, number],
  accent: [59, 130, 246] as [number, number, number],
  background: [248, 250, 252] as [number, number, number],
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 20;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

export const exportMVPDocumentationPDF = () => {
  const doc = new jsPDF();
  const data = mvpDocumentationData;
  let currentPage = 1;
  let currentY = MARGIN;

  const setFont = (style: 'normal' | 'bold' | 'italic', size: number) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
  };

  const setColor = (color: [number, number, number]) => {
    doc.setTextColor(color[0], color[1], color[2]);
  };

  const addPage = () => {
    doc.addPage();
    currentPage++;
    currentY = MARGIN;
  };

  const checkSpace = (needed: number) => {
    if (currentY + needed > PAGE_HEIGHT - MARGIN) {
      addPage();
      return true;
    }
    return false;
  };

  const addSectionTitle = (title: string, level: number = 1) => {
    const fontSize = level === 1 ? 16 : 12;
    const spacing = level === 1 ? 15 : 10;
    checkSpace(spacing + 15);
    currentY += spacing;
    setFont('bold', fontSize);
    setColor(level === 1 ? COLORS.primary : COLORS.text);
    doc.text(title, MARGIN, currentY);
    currentY += 8;
  };

  const addText = (text: string, indent: number = 0) => {
    checkSpace(15);
    setFont('normal', 10);
    setColor(COLORS.text);
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent);
    doc.text(lines, MARGIN + indent, currentY);
    currentY += lines.length * 5 + 3;
  };

  const addBullet = (text: string, indent: number = 0) => {
    checkSpace(10);
    setFont('normal', 9);
    setColor(COLORS.text);
    doc.text('•', MARGIN + indent, currentY);
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent - 8);
    doc.text(lines, MARGIN + indent + 6, currentY);
    currentY += lines.length * 4 + 2;
  };

  // Cover Page
  doc.setFillColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
  doc.rect(0, 0, PAGE_WIDTH, 90, 'F');
  setFont('bold', 28);
  doc.setTextColor(255, 255, 255);
  doc.text(data.appName, PAGE_WIDTH / 2, 45, { align: 'center' });
  setFont('normal', 12);
  doc.text(data.tagline, PAGE_WIDTH / 2, 60, { align: 'center' });
  setFont('bold', 20);
  setColor(COLORS.text);
  doc.text('MVP Technical Documentation', PAGE_WIDTH / 2, 120, { align: 'center' });
  setFont('normal', 11);
  setColor(COLORS.secondary);
  doc.text(`Version: ${data.version}`, PAGE_WIDTH / 2, 140, { align: 'center' });
  doc.text(`Generated: ${format(new Date(), 'MMMM d, yyyy')}`, PAGE_WIDTH / 2, 155, { align: 'center' });
  doc.text(`Live URL: ${data.liveUrl}`, PAGE_WIDTH / 2, 170, { align: 'center' });
  
  // Stats
  doc.setFillColor(COLORS.background[0], COLORS.background[1], COLORS.background[2]);
  doc.roundedRect(MARGIN + 10, 190, CONTENT_WIDTH - 20, 50, 3, 3, 'F');
  const stats = [
    { label: 'Tables', value: data.tables.length },
    { label: 'Functions', value: data.edgeFunctions.length },
    { label: 'Routes', value: data.routes.length },
    { label: 'Hooks', value: data.hooks.length },
  ];
  const colW = (CONTENT_WIDTH - 20) / 4;
  stats.forEach((s, i) => {
    const x = MARGIN + 10 + colW * i + colW / 2;
    setFont('bold', 18);
    setColor(COLORS.primary);
    doc.text(String(s.value), x, 212, { align: 'center' });
    setFont('normal', 9);
    setColor(COLORS.secondary);
    doc.text(s.label, x, 222, { align: 'center' });
  });

  addPage();

  // 1. Overview
  addSectionTitle('1. Application Overview');
  addText(`${data.appName} is a comprehensive permit management platform for architects, engineers, contractors, and permit expeditors.`);

  // 2. Tech Stack
  addSectionTitle('2. Technology Stack');
  data.techStack.forEach(cat => {
    addSectionTitle(cat.category, 2);
    cat.technologies.forEach(t => addBullet(t));
  });

  // 3. Routes
  addSectionTitle('3. Application Routes');
  addText(`${data.routes.length} routes (${data.routes.filter(r => !r.authRequired).length} public, ${data.routes.filter(r => r.authRequired).length} protected)`);
  data.routes.forEach(r => addBullet(`${r.path} - ${r.name}: ${r.description}`));

  // 4. Database
  addSectionTitle('4. Database Schema');
  addText(`${data.tables.length} PostgreSQL tables with Row-Level Security`);
  data.tables.forEach(t => {
    checkSpace(20);
    setFont('bold', 10);
    setColor(COLORS.accent);
    doc.text(t.name, MARGIN, currentY);
    setFont('normal', 9);
    setColor(COLORS.secondary);
    doc.text(` - ${t.description}`, MARGIN + doc.getTextWidth(t.name), currentY);
    currentY += 5;
    setFont('normal', 8);
    setColor(COLORS.text);
    doc.text(`Columns: ${t.columns.map(c => c.name).slice(0, 8).join(', ')}${t.columns.length > 8 ? '...' : ''}`, MARGIN + 5, currentY);
    currentY += 6;
  });

  // 5. Edge Functions
  addSectionTitle('5. Edge Functions');
  data.edgeFunctions.forEach(f => addBullet(`${f.name} (${f.method}) - ${f.description}`));

  // 6. Features
  addSectionTitle('6. Features');
  data.features.forEach(cat => {
    addSectionTitle(cat.category, 2);
    cat.features.forEach(f => addBullet(`${f.name}: ${f.description}`));
  });

  // 7. Subscriptions
  addSectionTitle('7. Subscription Tiers');
  data.subscriptionTiers.forEach(t => {
    addSectionTitle(`${t.name} - ${t.price}`, 2);
    t.features.forEach(f => addBullet(f));
  });

  // 8. Enums
  addSectionTitle('8. TypeScript Enums');
  data.enums.forEach(e => addBullet(`${e.name}: ${e.values.slice(0, 5).join(', ')}${e.values.length > 5 ? '...' : ''}`));

  // 9. Hooks
  addSectionTitle('9. Custom Hooks');
  data.hooks.forEach(h => addBullet(`${h.name}: ${h.description}`));

  // 10. Components
  addSectionTitle('10. Components');
  data.components.forEach(c => addBullet(`${c.category}: ${c.components.join(', ')}`));

  // 11. Security
  addSectionTitle('11. Security (RLS)');
  data.rlsPolicies.forEach(p => addBullet(`${p.name}: ${p.description}`));

  // Footers
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    setFont('normal', 8);
    setColor(COLORS.lightText);
    doc.text(`Page ${i} of ${total}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 8, { align: 'center' });
  }

  const fileName = `mvp-documentation-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
  doc.save(fileName);

  return { fileName, pageCount: total, tableCount: data.tables.length, functionCount: data.edgeFunctions.length, routeCount: data.routes.length };
};
