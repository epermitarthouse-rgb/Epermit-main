import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2,
  Clock,
  FileText,
  ClipboardList,
  Link2,
  DollarSign,
  AlertCircle,
  ExternalLink,
  XCircle,
  FileSearch,
  CalendarCheck,
} from "lucide-react";

interface AccelaDepartment {
  name: string;
  status: string;
  statusIcon: string;
  date: string;
  details: string;
}

interface AccelaAttachment {
  name: string;
  record_id: string;
  record_type: string;
  entity_type: string;
  type: string;
  size: string;
  latest_update: string;
  viewUrl?: string;
  downloadStatus?: string;
  downloadError?: string;
}

interface AccelaInspectionRow {
  type: string;
  status: string;
  date: string;
  inspector: string;
  result: string;
  category?: string;
}

interface AccelaRelatedRecord {
  record_number: string;
  record_type: string;
  status: string;
  project_name: string;
  date: string;
}

interface AccelaPaymentRow {
  [key: string]: string;
}

interface AccelaTableBlock {
  title: string;
  headers: string[];
  rows: Record<string, string>[];
}

interface AccelaPortalData {
  portalType: string;
  name: string;
  projectNum: string;
  description: string;
  location: string;
  dashboardStatus: string;
  tabs: {
    info?: {
      fields?: {
        record_number?: string;
        record_type?: string;
        record_status?: string;
        expiration_date?: string;
        [key: string]: string | undefined;
      };
      keyValues?: { key: string; value: string }[];
      tables?: AccelaTableBlock[];
      screenshot?: string;
    };
    status?: {
      departments?: AccelaDepartment[];
      tables?: AccelaTableBlock[];
    };
    reports?: {
      pdfs?: {
        fileName: string;
        text?: string;
        screenshot?: string;
        source?: string;
        comments?: { text: string; status?: string }[];
      }[];
      keyValues?: { key: string; value: string }[];
      tables?: AccelaTableBlock[];
    };
    attachments?: {
      tables?: AccelaTableBlock[];
    };
    inspections?: {
      tables?: AccelaTableBlock[];
    };
    payments?: {
      tables?: AccelaTableBlock[];
    };
    relatedRecords?: {
      tables?: AccelaTableBlock[];
    };
    [key: string]: unknown;
  };
}

function getStatusBadgeStyle(status: string): { className: string } {
  const s = status.toLowerCase();
  if (s.includes("expired"))
    return { className: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
  if (s.includes("approved") || s.includes("issued") || s.includes("active"))
    return {
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    };
  if (s.includes("closed"))
    return { className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" };
  if (
    s.includes("pending") ||
    s.includes("review") ||
    s.includes("in progress")
  )
    return { className: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  if (s.includes("denied") || s.includes("rejected"))
    return { className: "bg-red-500/20 text-red-400 border-red-500/30" };
  return { className: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30" };
}

interface AccelaProjectViewProps {
  portalData: AccelaPortalData;
}

export default function AccelaProjectView({
  portalData,
}: AccelaProjectViewProps) {
  const [activeTab, setActiveTab] = useState("info");

  const header = portalData.tabs?.info?.fields || {};
  const recordNumber =
    header.record_number || portalData.name || portalData.projectNum;
  const recordType = header.record_type || portalData.description || "";
  const recordStatus = (
    header.record_status ||
    portalData.dashboardStatus ||
    ""
  )
    .replace(/^Record Status:\s*/i, "")
    .trim();

  const expirationDate = (header.expiration_date || "")
    .replace(/^Expiration Date:\s*/i, "")
    .trim();

  const departments: AccelaDepartment[] =
    portalData.tabs?.status?.departments || [];

  const allAttachmentTables = portalData.tabs?.attachments?.tables || [];
  const attachmentRows: AccelaAttachment[] = allAttachmentTables
    .flatMap((t) => (Array.isArray(t.rows) ? t.rows : []))
    .filter(
      (r): r is AccelaAttachment =>
        typeof r === "object" && r !== null && "name" in r,
    );

  const inspectionTables = (portalData.tabs?.inspections?.tables || []).filter(
    (t) => Array.isArray(t.rows),
  );

  const allRelatedTables = portalData.tabs?.relatedRecords?.tables || [];
  const relatedRecordRows: AccelaRelatedRecord[] = allRelatedTables
    .flatMap((t) => (Array.isArray(t.rows) ? t.rows : []))
    .filter(
      (r): r is AccelaRelatedRecord => typeof r === "object" && r !== null,
    );

  const paymentTables = (portalData.tabs?.payments?.tables || []).filter((t) =>
    Array.isArray(t.rows),
  );

  const planReviewPdf = portalData.tabs?.reports?.pdfs?.find((p) =>
    p.fileName?.includes("Plan Review"),
  );

  const infoKeyValues = portalData.tabs?.info?.keyValues || [];

  const completedCount = departments.filter(
    (d) => d.statusIcon === "complete",
  ).length;
  const pendingCount = departments.filter(
    (d) => d.statusIcon !== "complete",
  ).length;

  return (
    <div className="space-y-4" data-testid="accela-project-view">
      <Card className="border-[#1A3055] bg-[#091428]">
        <CardContent className="pt-5 pb-4 px-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Accela Record
              </p>
              <h2
                className="text-lg font-semibold text-[#F0F6FF] truncate"
                data-testid="text-record-number"
              >
                {recordNumber}
              </h2>
              {recordType && (
                <p
                  className="text-sm text-muted-foreground mt-0.5"
                  data-testid="text-record-type"
                >
                  {recordType}
                </p>
              )}
              {portalData.location && (
                <p className="text-xs text-muted-foreground mt-1">
                  {portalData.location}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
              {recordStatus && (
                <Badge
                  variant="outline"
                  className={`text-sm px-3 py-1 ${getStatusBadgeStyle(recordStatus).className}`}
                  data-testid="badge-record-status"
                >
                  {recordStatus}
                </Badge>
              )}
              {expirationDate && (
                <Badge
                  variant="outline"
                  className={`text-sm px-3 py-1 ${
                    recordStatus.toLowerCase().includes("expired")
                      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                      : "bg-[#0D1E38] text-muted-foreground border-[#1A3055]"
                  }`}
                  data-testid="badge-expiration-date"
                >
                  Exp: {expirationDate}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col lg:flex-row gap-4">
        {departments.length > 0 && (
          <Card className="border-[#1A3055] bg-[#091428] lg:w-80 flex-shrink-0">
            <CardHeader className="pb-3 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-[#F0F6FF] flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                Processing Status
                <span className="ml-auto text-xs text-muted-foreground font-normal">
                  {completedCount}/{departments.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div
                className="max-h-[520px] overflow-y-auto pr-1 space-y-0"
                data-testid="timeline-processing-status"
              >
                {departments.map((dept, idx) => {
                  const isComplete = dept.statusIcon === "complete";
                  const isLast = idx === departments.length - 1;
                  return (
                    <div
                      key={idx}
                      className="flex gap-3 relative"
                      data-testid={`timeline-step-${idx}`}
                    >
                      <div className="flex flex-col items-center flex-shrink-0 w-6">
                        <div
                          className={`rounded-full p-0.5 ${isComplete ? "text-emerald-400" : "text-zinc-500"}`}
                        >
                          {isComplete ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Clock className="h-4 w-4" />
                          )}
                        </div>
                        {!isLast && (
                          <div
                            className={`w-px flex-1 min-h-[16px] ${
                              isComplete ? "bg-emerald-500/30" : "bg-zinc-700"
                            }`}
                          />
                        )}
                      </div>
                      <div className="pb-3 min-w-0 flex-1">
                        <p
                          className={`text-xs leading-tight ${isComplete ? "text-[#F0F6FF]" : "text-zinc-500"}`}
                        >
                          {dept.name}
                        </p>
                        {dept.date && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {dept.date}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex-1 min-w-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-[#0D1E38] border border-[#1A3055] mb-3">
              <TabsTrigger
                value="info"
                className="gap-1.5 text-xs"
                data-testid="tab-info"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Info
                {infoKeyValues.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ({infoKeyValues.length})
                  </span>
                )}
              </TabsTrigger>

              <TabsTrigger
                value="files"
                className="gap-1.5 text-xs"
                data-testid="tab-files"
              >
                <FileText className="h-3.5 w-3.5" />
                Files
                {attachmentRows.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ({attachmentRows.length})
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="inspections"
                className="gap-1.5 text-xs"
                data-testid="tab-inspections"
              >
                <CalendarCheck className="h-3.5 w-3.5" />
                Inspections
              </TabsTrigger>
              <TabsTrigger
                value="links"
                className="gap-1.5 text-xs"
                data-testid="tab-links"
              >
                <Link2 className="h-3.5 w-3.5" />
                Links
                {relatedRecordRows.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ({relatedRecordRows.length})
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="planReview"
                className="gap-1.5 text-xs"
                data-testid="tab-plan-review"
              >
                <FileSearch className="h-3.5 w-3.5" />
                Plan Review
              </TabsTrigger>
              <TabsTrigger
                value="payments"
                className="gap-1.5 text-xs"
                data-testid="tab-payments"
              >
                <DollarSign className="h-3.5 w-3.5" />
                Payments
              </TabsTrigger>
            </TabsList>
            <TabsContent value="info">
              <Card className="border-[#1A3055] bg-[#091428]">
                <CardContent className="p-4">
                  {infoKeyValues.length > 0 ? (
                    <div
                      className="grid grid-cols-1 md:grid-cols-2 gap-3"
                      data-testid="info-fields"
                    >
                      {infoKeyValues.map((kv, i) => (
                        <div
                          key={i}
                          className="rounded-md border border-[#1A3055] bg-[#0D1E38] px-3 py-2"
                          data-testid={`info-field-${i}`}
                        >
                          <div className="text-xs text-muted-foreground mb-1">
                            {kv.key}
                          </div>
                          <div className="text-sm text-[#F0F6FF] break-words">
                            {kv.value || "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={ClipboardList}
                      message="No record details available"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="files">
              <Card className="border-[#1A3055] bg-[#091428]">
                <CardContent className="p-0">
                  {attachmentRows.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-[#1A3055] hover:bg-transparent">
                          <TableHead className="text-xs text-muted-foreground">
                            Name
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Type
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Size
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Updated
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground w-20">
                            Status
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attachmentRows.map((att, idx) => (
                          <TableRow
                            key={idx}
                            className="border-[#1A3055]"
                            data-testid={`file-row-${idx}`}
                          >
                            <TableCell className="max-w-[300px]">
                              {att.viewUrl ? (
                                <a
                                  href={att.viewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 text-sm"
                                  data-testid={`link-file-${idx}`}
                                >
                                  <span className="truncate">{att.name}</span>
                                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                </a>
                              ) : (
                                <span className="text-sm text-[#F0F6FF] truncate block">
                                  {att.name}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {att.type || att.entity_type || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {att.size || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {att.latest_update || "—"}
                            </TableCell>
                            <TableCell>
                              {att.downloadStatus === "failed" ? (
                                <Badge
                                  variant="outline"
                                  className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]"
                                  data-testid={`badge-file-failed-${idx}`}
                                >
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Failed
                                </Badge>
                              ) : att.viewUrl ? (
                                <Badge
                                  variant="outline"
                                  className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]"
                                >
                                  Saved
                                </Badge>
                              ) : (
                                <span className="text-xs text-zinc-600">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <EmptyState
                      icon={FileText}
                      message="No attachments found"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="inspections">
              <Card className="border-[#1A3055] bg-[#091428]">
                <CardContent className="p-0">
                  {inspectionTables.length > 0 &&
                  inspectionTables.some((t) => t.rows.length > 0) ? (
                    <div className="divide-y divide-[#1A3055]">
                      {inspectionTables.map((table, tIdx) => (
                        <div key={tIdx}>
                          <div className="px-4 py-2 bg-[#0D1E38]">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {table.title}
                            </p>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow className="border-[#1A3055] hover:bg-transparent">
                                <TableHead className="text-xs text-muted-foreground">
                                  Type
                                </TableHead>
                                <TableHead className="text-xs text-muted-foreground">
                                  Status
                                </TableHead>
                                <TableHead className="text-xs text-muted-foreground">
                                  Date
                                </TableHead>
                                <TableHead className="text-xs text-muted-foreground">
                                  Inspector
                                </TableHead>
                                <TableHead className="text-xs text-muted-foreground">
                                  Result
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {table.rows.map((row, rIdx) => {
                                const r = row as unknown as AccelaInspectionRow;
                                return (
                                  <TableRow
                                    key={rIdx}
                                    className="border-[#1A3055]"
                                    data-testid={`inspection-row-${tIdx}-${rIdx}`}
                                  >
                                    <TableCell className="text-sm text-[#F0F6FF]">
                                      {r.type || row["Type"] || "—"}
                                    </TableCell>
                                    <TableCell>
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] ${getStatusBadgeStyle(r.status || row["Status"] || "").className}`}
                                      >
                                        {r.status || row["Status"] || "—"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                      {r.date || row["Date"] || "—"}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {r.inspector || row["Inspector"] || "—"}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {r.result || row["Result"] || "—"}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={CalendarCheck}
                      message="No inspections scheduled"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="links">
              <Card className="border-[#1A3055] bg-[#091428]">
                <CardContent className="p-0">
                  {relatedRecordRows.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-[#1A3055] hover:bg-transparent">
                          <TableHead className="text-xs text-muted-foreground">
                            Record Number
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Type
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Status
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Project
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Date
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {relatedRecordRows.map((rec, idx) => (
                          <TableRow
                            key={idx}
                            className="border-[#1A3055]"
                            data-testid={`related-record-${idx}`}
                          >
                            <TableCell className="text-sm text-blue-400 font-mono">
                              {rec.record_number || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {rec.record_type || "—"}
                            </TableCell>
                            <TableCell>
                              {rec.status ? (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${getStatusBadgeStyle(rec.status).className}`}
                                >
                                  {rec.status}
                                </Badge>
                              ) : (
                                <span className="text-xs text-zinc-600">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {rec.project_name || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {rec.date || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <EmptyState
                      icon={Link2}
                      message="No related records found"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="planReview">
              <Card className="border-[#1A3055] bg-[#091428]">
                <CardContent className="p-4">
                  {planReviewPdf?.text ? (
                    <div
                      className="space-y-3"
                      data-testid="plan-review-content"
                    >
                      {planReviewPdf.text
                        .split("\n")
                        .filter(Boolean)
                        .map((line, i) => {
                          const colonIdx = line.indexOf(":");
                          if (colonIdx > 0 && colonIdx < 40) {
                            const label = line.substring(0, colonIdx).trim();
                            const value = line.substring(colonIdx + 1).trim();
                            const isStatus = label.toLowerCase() === "status";

                            return (
                              <div
                                key={i}
                                className="flex items-baseline gap-2"
                                data-testid={`plan-review-field-${i}`}
                              >
                                <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[140px]">
                                  {label}:
                                </span>
                                {isStatus ? (
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${getStatusBadgeStyle(value).className}`}
                                  >
                                    {value}
                                  </Badge>
                                ) : (
                                  <span className="text-sm text-[#F0F6FF]">
                                    {value}
                                  </span>
                                )}
                              </div>
                            );
                          }

                          return (
                            <p key={i} className="text-sm text-[#F0F6FF]">
                              {line}
                            </p>
                          );
                        })}
                    </div>
                  ) : (
                    <EmptyState
                      icon={FileSearch}
                      message="No plan review data available"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payments">
              <Card className="border-[#1A3055] bg-[#091428]">
                <CardContent className="p-0">
                  {paymentTables.length > 0 &&
                  paymentTables.some((t) => t.rows.length > 0) ? (
                    <div className="divide-y divide-[#1A3055]">
                      {paymentTables.map((table, tIdx) => (
                        <div key={tIdx}>
                          <Table>
                            <TableHeader>
                              <TableRow className="border-[#1A3055] hover:bg-transparent">
                                {table.headers.map((h, hIdx) => (
                                  <TableHead
                                    key={hIdx}
                                    className="text-xs text-muted-foreground"
                                  >
                                    {h}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {table.rows.map((row, rIdx) => (
                                <TableRow
                                  key={rIdx}
                                  className="border-[#1A3055]"
                                  data-testid={`payment-row-${rIdx}`}
                                >
                                  {table.headers.map((h, hIdx) => {
                                    const val =
                                      (row as Record<string, string>)[h] ||
                                      (row as Record<string, string>)[
                                        h.toLowerCase()
                                      ] ||
                                      Object.values(row)[hIdx] ||
                                      "—";
                                    return (
                                      <TableCell
                                        key={hIdx}
                                        className="text-sm text-[#F0F6FF]"
                                      >
                                        {val}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={DollarSign}
                      message="No payment records found"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: typeof FileText;
  message: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 text-center"
      data-testid="empty-state"
    >
      <div className="rounded-full bg-[#0D1E38] p-4 mb-3">
        <Icon className="h-8 w-8 text-zinc-600" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
