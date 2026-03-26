import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent } from '@/components/ui/card';

interface ChecklistQRCodeProps {
  projectId?: string;
  inspectionId?: string;
  checklistData?: {
    projectName: string;
    inspectionType: string;
    inspectionDate: string;
  };
  baseUrl?: string;
  size?: number;
  showLabel?: boolean;
}

export function ChecklistQRCode({
  projectId,
  inspectionId,
  checklistData,
  baseUrl,
  size = 100,
  showLabel = true,
}: ChecklistQRCodeProps) {
  // Generate a unique URL for this checklist
  const generateChecklistUrl = () => {
    const base = baseUrl || window.location.origin;
    
    // If we have a project/inspection ID, link directly to it
    if (projectId && inspectionId) {
      return `${base}/projects?project=${projectId}&inspection=${inspectionId}`;
    }
    
    // Otherwise, create a URL with encoded checklist info for reference
    if (checklistData) {
      const params = new URLSearchParams({
        project: checklistData.projectName || 'Inspection',
        type: checklistData.inspectionType || 'general',
        date: checklistData.inspectionDate || new Date().toISOString().split('T')[0],
      });
      return `${base}/projects?${params.toString()}`;
    }
    
    return `${base}/projects`;
  };

  const checklistUrl = generateChecklistUrl();

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-white p-2 rounded-lg border">
        <QRCodeSVG
          value={checklistUrl}
          size={size}
          level="M"
          includeMargin={false}
          bgColor="#ffffff"
          fgColor="#000000"
        />
      </div>
      {showLabel && (
        <div className="text-center">
          <p className="text-xs text-muted-foreground font-medium">
            Scan for Digital Version
          </p>
          <p className="text-[10px] text-muted-foreground/70 max-w-[120px] truncate">
            {checklistUrl}
          </p>
        </div>
      )}
    </div>
  );
}

// Compact version for inline use
export function InlineQRCode({
  url,
  size = 60,
}: {
  url: string;
  size?: number;
}) {
  return (
    <div className="inline-block bg-white p-1 rounded border">
      <QRCodeSVG
        value={url}
        size={size}
        level="L"
        includeMargin={false}
        bgColor="#ffffff"
        fgColor="#000000"
      />
    </div>
  );
}
