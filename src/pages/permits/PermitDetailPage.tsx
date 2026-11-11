import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { AlertBanner } from "@/components/design/ProductPrimitives";
import { LocalInspectionBanner } from "@/components/permits/LocalInspectionBanner";
import { PermitJsonExportButton } from "@/components/permits/PermitExportButtons";
import { PermitQueueDetailView } from "@/components/permits/PermitQueueDetailView";
import { ReportContentBody } from "@/components/permits/PermitSectionViews";
import { PermitProjectLinksPanel } from "@/components/permits/ProjectPermitLinkPanel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useToast } from "@/hooks/use-toast";
import {
  createPermitObjectSignedUrl,
  listReportContentVersions,
  loadPermitDetail,
  loadReportContent,
} from "@/lib/centralPermits";
import { PERMIT_QUEUE_PATH } from "@/lib/permitQueue";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Opens a stored object through a short-lived signed URL. The tab is opened before the request so
 * the browser treats it as a user action; it is closed again if no URL is issued.
 */
function useOpenPermitObject() {
  const { toast } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const open = async (path: string, key: string = path) => {
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to open stored files.", variant: "destructive" });
      return;
    }
    tab.opener = null;
    setBusyKey(key);
    try {
      tab.location.href = await createPermitObjectSignedUrl(path);
    } catch (e) {
      tab.close();
      toast({ title: "Could not open the stored copy", description: errorText(e), variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  };
  return { open, busyKey };
}

function ReportViewer({ permitId, report, onOpenFile }: { permitId: string; report: Row; onOpenFile: (path: string) => void }) {
  const contentId = str(report.latest_content_id);
  const reportKey = str(report.report_key);
  const content = useQuery({
    queryKey: ["central-permits", "report-content", contentId],
    queryFn: () => loadReportContent(contentId),
    enabled: !!contentId,
    staleTime: Infinity,
  });
  const versions = useQuery({
    queryKey: ["central-permits", "report-versions", permitId, reportKey],
    queryFn: () => listReportContentVersions(permitId, reportKey),
    enabled: !!reportKey,
    staleTime: Infinity,
  });
  if (content.isLoading) {
    return (
      <div className="flex justify-center py-6 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading report…
      </div>
    );
  }
  if (content.error) return <AlertBanner tone="bad" title="Could not load the report" detail={errorText(content.error)} />;
  return <ReportContentBody report={report} content={content.data ?? null} versions={versions.data ?? []} onOpenFile={onOpenFile} />;
}

/** Permit Queue detail page (D-064). Read-only; no portal credential is needed to view. */
export default function PermitDetailPage() {
  const { permitId = "" } = useParams();
  const { user } = useAuth();
  const { isAdmin } = useRequireAdmin();
  const { open, busyKey } = useOpenPermitObject();
  const [selectedReport, setSelectedReport] = useState<Row | null>(null);
  const result = useQuery({
    queryKey: ["central-permits", "detail", permitId],
    queryFn: () => loadPermitDetail(permitId),
    enabled: !!user && !!permitId,
  });

  const back = (
    <Button asChild variant="ghost" size="sm">
      <Link to={PERMIT_QUEUE_PATH}><ArrowLeft className="mr-2 h-4 w-4" />Permit Queue</Link>
    </Button>
  );

  if (result.isLoading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading permit…
      </div>
    );
  }
  if (result.error) {
    return (
      <div className="space-y-4">
        {back}
        <AlertBanner tone="bad" title="Could not load permit" detail={errorText(result.error)} />
      </div>
    );
  }
  const d = result.data;
  if (!d) {
    return (
      <div className="space-y-4">
        {back}
        <AlertBanner tone="default" title="Permit not found" detail="It does not exist, or you have not been granted access to it." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {back}
      <LocalInspectionBanner />
      <PermitQueueDetailView
        detail={d}
        isAdmin={isAdmin}
        actions={<PermitJsonExportButton permitId={permitId} />}
        linksPanel={<PermitProjectLinksPanel permitId={permitId} />}
        onViewDocument={(doc) => void open(str(doc.storage_path), str(doc.id))}
        busyDocumentId={busyKey}
        selectedReportKey={selectedReport ? str(selectedReport.report_key) : null}
        onViewReport={(r) => setSelectedReport((cur) => (cur && str(cur.report_key) === str(r.report_key) ? null : r))}
        reportViewer={selectedReport ? <ReportViewer permitId={permitId} report={selectedReport} onOpenFile={(path) => void open(path)} /> : null}
      />
    </div>
  );
}
