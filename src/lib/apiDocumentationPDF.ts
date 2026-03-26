import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { apiEndpoints, categoryLabels, APIEndpoint } from './apiDocumentationData';

// Colors (RGB values for jsPDF)
const COLORS = {
  primary: [34, 197, 94] as [number, number, number],    // Green-500
  secondary: [71, 85, 105] as [number, number, number],  // Slate-500
  text: [15, 23, 42] as [number, number, number],        // Slate-900
  muted: [100, 116, 139] as [number, number, number],    // Slate-500
  accent: [59, 130, 246] as [number, number, number],    // Blue-500
  background: [248, 250, 252] as [number, number, number], // Slate-50
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 20;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export interface APIDocPDFResult {
  fileName: string;
  generatedAt: string;
  endpointCount: number;
  categoryCount: number;
}

export const exportAPIDocumentationPDF = async (): Promise<APIDocPDFResult> => {
  const doc = new jsPDF();
  let currentY = MARGIN;
  let pageNumber = 1;

  // Helper functions
  const setFont = (style: 'normal' | 'bold' | 'italic' = 'normal', size: number = 10) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  };

  const setColor = (color: [number, number, number]) => {
    doc.setTextColor(color[0], color[1], color[2]);
  };

  const addPage = () => {
    doc.addPage();
    pageNumber++;
    currentY = MARGIN;
  };

  const checkSpace = (needed: number) => {
    if (currentY + needed > PAGE_HEIGHT - MARGIN) {
      addPage();
    }
  };

  const addSectionTitle = (title: string) => {
    checkSpace(25);
    setFont('bold', 16);
    setColor(COLORS.text);
    doc.text(title, MARGIN, currentY);
    currentY += 8;
    // Underline
    doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, currentY, MARGIN + 50, currentY);
    currentY += 10;
  };

  const addSubsectionTitle = (title: string) => {
    checkSpace(15);
    setFont('bold', 12);
    setColor(COLORS.secondary);
    doc.text(title, MARGIN, currentY);
    currentY += 8;
  };

  const addText = (text: string, indent: number = 0) => {
    checkSpace(8);
    setFont('normal', 10);
    setColor(COLORS.text);
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent);
    doc.text(lines, MARGIN + indent, currentY);
    currentY += lines.length * 5 + 2;
  };

  const addCodeBlock = (code: string, indent: number = 0) => {
    const lines = code.split('\n');
    const lineHeight = 4;
    const padding = 3;
    const blockHeight = lines.length * lineHeight + padding * 2;
    
    checkSpace(blockHeight + 5);
    
    // Background
    doc.setFillColor(30, 41, 59); // Slate-800
    doc.roundedRect(MARGIN + indent, currentY - 2, CONTENT_WIDTH - indent, blockHeight, 2, 2, 'F');
    
    // Code text
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(226, 232, 240); // Slate-200
    
    lines.forEach((line, i) => {
      const truncatedLine = line.length > 80 ? line.substring(0, 77) + '...' : line;
      doc.text(truncatedLine, MARGIN + indent + padding, currentY + padding + i * lineHeight);
    });
    
    currentY += blockHeight + 5;
  };

  const addBadge = (text: string, color: [number, number, number], x: number, y: number) => {
    setFont('bold', 8);
    const textWidth = doc.getTextWidth(text);
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(x, y - 3.5, textWidth + 6, 5, 1, 1, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(text, x + 3, y);
  };

  // ========== COVER PAGE ==========
  // Background accent
  doc.setFillColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
  doc.rect(0, 0, PAGE_WIDTH, 80, 'F');

  // Title
  setFont('bold', 32);
  doc.setTextColor(255, 255, 255);
  doc.text('API Documentation', MARGIN, 45);

  setFont('normal', 14);
  doc.text('Edge Functions Reference Guide', MARGIN, 55);

  // Stats box
  currentY = 100;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(MARGIN, currentY, CONTENT_WIDTH, 50, 3, 3, 'F');

  setFont('bold', 12);
  setColor(COLORS.text);
  doc.text('Documentation Overview', MARGIN + 10, currentY + 12);

  const protectedCount = apiEndpoints.filter(e => e.authRequired).length;
  const publicCount = apiEndpoints.filter(e => !e.authRequired).length;

  setFont('normal', 10);
  setColor(COLORS.muted);
  doc.text(`Total Endpoints: ${apiEndpoints.length}`, MARGIN + 10, currentY + 25);
  doc.text(`Protected Endpoints: ${protectedCount}`, MARGIN + 10, currentY + 33);
  doc.text(`Public Endpoints: ${publicCount}`, MARGIN + 10, currentY + 41);
  doc.text(`Categories: ${Object.keys(categoryLabels).length}`, MARGIN + 80, currentY + 25);

  // Generation info
  currentY = 170;
  setFont('normal', 10);
  setColor(COLORS.muted);
  doc.text(`Generated: ${format(new Date(), 'MMMM d, yyyy \'at\' h:mm a')}`, MARGIN, currentY);
  currentY += 8;
  doc.text(`Base URL: https://lsdkbdbzgohblonzgwhr.supabase.co`, MARGIN, currentY);

  // ========== TABLE OF CONTENTS ==========
  addPage();
  addSectionTitle('Table of Contents');

  const categories = [...new Set(apiEndpoints.map(e => e.category))];
  let tocY = currentY;

  setFont('normal', 10);
  setColor(COLORS.text);
  doc.text('1. Overview', MARGIN, tocY);
  tocY += 7;
  doc.text('2. Authentication', MARGIN, tocY);
  tocY += 7;
  doc.text('3. Error Handling', MARGIN, tocY);
  tocY += 7;

  categories.forEach((category, index) => {
    doc.text(`${index + 4}. ${categoryLabels[category]?.label || category}`, MARGIN, tocY);
    tocY += 7;
  });

  currentY = tocY + 10;

  // ========== OVERVIEW ==========
  addPage();
  addSectionTitle('1. Overview');
  addText('This document provides comprehensive documentation for all available API endpoints (Edge Functions) in the PermitPilot platform. Each endpoint includes authentication requirements, request/response schemas, and example payloads.');
  currentY += 5;

  addSubsectionTitle('Base URL');
  addCodeBlock('https://lsdkbdbzgohblonzgwhr.supabase.co');

  addSubsectionTitle('Request Headers');
  addText('All requests must include the following headers:');
  addCodeBlock(`Content-Type: application/json
apikey: YOUR_ANON_KEY
Authorization: Bearer YOUR_JWT_TOKEN  // For protected endpoints`);

  // ========== AUTHENTICATION ==========
  addPage();
  addSectionTitle('2. Authentication');
  addText('Protected endpoints require a valid JWT token in the Authorization header. Tokens are obtained through the Supabase authentication flow.');
  currentY += 5;

  addSubsectionTitle('Obtaining a Token');
  addCodeBlock(`// Using Supabase client
const { data } = await supabase.auth.getSession();
const token = data.session?.access_token;`);

  addSubsectionTitle('Token Usage');
  addCodeBlock(`Authorization: Bearer eyJhbGciOiJIUzI1NiIs...`);

  // ========== ERROR HANDLING ==========
  addSectionTitle('3. Error Handling');
  addText('All endpoints return errors in a consistent format:');
  addCodeBlock(`{
  "error": "Error message description"
}`);

  addText('Common HTTP status codes:');
  currentY += 2;
  addText('• 200 - Success', 5);
  addText('• 400 - Bad Request (invalid parameters)', 5);
  addText('• 401 - Unauthorized (missing or invalid token)', 5);
  addText('• 403 - Forbidden (insufficient permissions)', 5);
  addText('• 404 - Not Found', 5);
  addText('• 500 - Internal Server Error', 5);

  // ========== ENDPOINTS BY CATEGORY ==========
  categories.forEach((category, catIndex) => {
    addPage();
    addSectionTitle(`${catIndex + 4}. ${categoryLabels[category]?.label || category}`);
    
    if (categoryLabels[category]?.description) {
      addText(categoryLabels[category].description);
      currentY += 5;
    }

    const categoryEndpoints = apiEndpoints.filter(e => e.category === category);

    categoryEndpoints.forEach((endpoint, endIndex) => {
      checkSpace(60);
      
      // Endpoint header
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(MARGIN, currentY - 2, CONTENT_WIDTH, 12, 2, 2, 'F');
      
      // Method badge
      const methodColors: Record<string, [number, number, number]> = {
        GET: [59, 130, 246],     // Blue
        POST: [34, 197, 94],    // Green
        PUT: [234, 179, 8],     // Yellow
        DELETE: [239, 68, 68],  // Red
      };
      addBadge(endpoint.method, methodColors[endpoint.method] || COLORS.secondary, MARGIN + 3, currentY + 5);
      
      // Path
      setFont('bold', 10);
      setColor(COLORS.text);
      doc.setFont('courier', 'bold');
      doc.text(endpoint.path, MARGIN + 20, currentY + 5);
      
      // Auth indicator
      if (endpoint.authRequired) {
        addBadge('AUTH', [234, 179, 8], MARGIN + CONTENT_WIDTH - 20, currentY + 5);
      }
      
      currentY += 15;
      
      // Name and description
      setFont('bold', 11);
      setColor(COLORS.text);
      doc.text(endpoint.name, MARGIN, currentY);
      currentY += 6;
      
      setFont('normal', 9);
      setColor(COLORS.muted);
      const descLines = doc.splitTextToSize(endpoint.description, CONTENT_WIDTH);
      doc.text(descLines, MARGIN, currentY);
      currentY += descLines.length * 4 + 5;

      // Request body
      if (endpoint.requestBody && endpoint.requestBody.fields.length > 0) {
        checkSpace(30);
        setFont('bold', 9);
        setColor(COLORS.secondary);
        doc.text('Request Body:', MARGIN, currentY);
        currentY += 5;

        endpoint.requestBody.fields.forEach(field => {
          checkSpace(8);
          setFont('normal', 8);
          setColor(COLORS.text);
          doc.setFont('courier', 'normal');
          doc.text(`• ${field.name}`, MARGIN + 5, currentY);
          doc.setFont('helvetica', 'normal');
          setColor(COLORS.muted);
          const fieldDesc = `(${field.type}${field.required ? ', required' : ''}) - ${field.description}`;
          const truncatedDesc = fieldDesc.length > 60 ? fieldDesc.substring(0, 57) + '...' : fieldDesc;
          doc.text(truncatedDesc, MARGIN + 40, currentY);
          currentY += 5;
        });

        currentY += 3;
        setFont('bold', 8);
        setColor(COLORS.secondary);
        doc.text('Example:', MARGIN, currentY);
        currentY += 4;
        addCodeBlock(JSON.stringify(endpoint.requestBody.example, null, 2), 0);
      }

      // Response body
      checkSpace(25);
      setFont('bold', 9);
      setColor(COLORS.secondary);
      doc.text('Response (200 OK):', MARGIN, currentY);
      currentY += 5;

      endpoint.responseBody.fields.slice(0, 4).forEach(field => {
        checkSpace(8);
        setFont('normal', 8);
        setColor(COLORS.text);
        doc.setFont('courier', 'normal');
        doc.text(`• ${field.name}`, MARGIN + 5, currentY);
        doc.setFont('helvetica', 'normal');
        setColor(COLORS.muted);
        const fieldDesc = `(${field.type}) - ${field.description}`;
        const truncatedDesc = fieldDesc.length > 60 ? fieldDesc.substring(0, 57) + '...' : fieldDesc;
        doc.text(truncatedDesc, MARGIN + 40, currentY);
        currentY += 5;
      });

      currentY += 3;
      setFont('bold', 8);
      setColor(COLORS.secondary);
      doc.text('Example Response:', MARGIN, currentY);
      currentY += 4;
      addCodeBlock(JSON.stringify(endpoint.responseBody.example, null, 2), 0);

      // Error responses
      if (endpoint.errorResponses && endpoint.errorResponses.length > 0) {
        checkSpace(15);
        setFont('bold', 9);
        setColor(COLORS.secondary);
        doc.text('Error Responses:', MARGIN, currentY);
        currentY += 5;

        endpoint.errorResponses.slice(0, 3).forEach(err => {
          checkSpace(6);
          setFont('normal', 8);
          setColor([239, 68, 68]); // Red
          doc.text(`${err.status}`, MARGIN + 5, currentY);
          setColor(COLORS.muted);
          doc.text(err.message, MARGIN + 20, currentY);
          currentY += 5;
        });
      }

      // Notes
      if (endpoint.notes && endpoint.notes.length > 0) {
        checkSpace(15);
        setFont('italic', 8);
        setColor(COLORS.muted);
        endpoint.notes.forEach(note => {
          doc.text(`ℹ ${note}`, MARGIN, currentY);
          currentY += 4;
        });
      }

      currentY += 10;
    });
  });

  // ========== ADD PAGE NUMBERS ==========
  const totalPages = pageNumber;
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    setFont('normal', 8);
    setColor(COLORS.muted);
    doc.text(`Page ${i} of ${totalPages}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 10, { align: 'center' });
    doc.text('PermitPilot API Documentation', MARGIN, PAGE_HEIGHT - 10);
  }

  // Generate filename and save
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  const fileName = `api-documentation-${dateStr}.pdf`;
  doc.save(fileName);

  return {
    fileName,
    generatedAt: format(new Date(), 'MMMM d, yyyy \'at\' h:mm a'),
    endpointCount: apiEndpoints.length,
    categoryCount: Object.keys(categoryLabels).length,
  };
};
