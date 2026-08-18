import React, { useState } from "react";
import { Archive, ChevronDown, FileJson2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  downloadApplicationPackageExport,
  formatUciUserError,
  type UciPackageExportFormat,
} from "@/lib/uciApi";

interface PackageDownloadMenuProps {
  applicationId: string;
  syntheticTest?: boolean;
  className?: string;
  onSuccess?: (message: string) => void;
  onError?: (error: unknown) => void;
}

const FORMAT_LABELS: Record<UciPackageExportFormat, string> = {
  "summary.pdf": "Package Summary PDF",
  "complete.zip": "Complete ZIP",
  "structured-json": "Structured JSON",
};

export function PackageDownloadMenu({
  applicationId,
  syntheticTest = false,
  className,
  onSuccess,
  onError,
}: PackageDownloadMenuProps) {
  const [busyFormat, setBusyFormat] = useState<UciPackageExportFormat | null>(null);

  const download = async (format: UciPackageExportFormat) => {
    if (busyFormat) return;
    setBusyFormat(format);
    try {
      const result = await downloadApplicationPackageExport(applicationId, format);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      const message = `${FORMAT_LABELS[format]} downloaded`;
      if (onSuccess) onSuccess(message);
      else toast.success(message);
    } catch (error) {
      if (onError) onError(error);
      else toast.error(formatUciUserError(error, "Package download failed"));
    } finally {
      setBusyFormat(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={className} disabled={Boolean(busyFormat)}>
          {busyFormat ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
          Download package
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {syntheticTest ? (
          <>
            <DropdownMenuLabel className="text-amber-700 dark:text-amber-300">
              Synthetic/test package
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={() => void download("summary.pdf")}>
          <FileText className="mr-2 h-4 w-4" />
          <div>
            <div>Package Summary PDF</div>
            <div className="text-xs text-muted-foreground">Human-readable cover sheet and audit</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download("complete.zip")}>
          <Archive className="mr-2 h-4 w-4" />
          <div>
            <div>Complete ZIP</div>
            <div className="text-xs text-muted-foreground">Summary, manifest, and unchanged originals</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Advanced / structured
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void download("structured-json")}>
          <FileJson2 className="mr-2 h-4 w-4" />
          <div>
            <div>Structured JSON</div>
            <div className="text-xs text-muted-foreground">Internal record · not utility-submittable</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
