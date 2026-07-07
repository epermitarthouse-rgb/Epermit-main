import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  downloadPepcoApplicationDocument,
  openPepcoApplicationDocumentView,
  pepcoDocumentViewErrorMessage,
} from "@/lib/uciApi";
import {
  buildPepcoMilestoneTrackingGroups,
  findDownloadForDocument,
  flattenProjectInformation,
  formatAddressBlock,
  formatFileSize,
  listElectricServiceLoads,
  normalizePepcoAppDetailProgress,
  parsePepcoMessageBodySegments,
  sortMessagesNewestFirst,
  sortStatusChangesNewestFirst,
} from "@/lib/pepcoApplicationDetailUi";
import type { PepcoApplicationDetail, PepcoMessage } from "@/types/uci";
import {
  AlertTriangle,
  Check,
  Circle,
  Download,
  Eye,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

type PepcoDetailTab = "overview" | "status" | "messages" | "documents";

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function hasSectionErrors(app: PepcoApplicationDetail): boolean {
  const e = app.errors;
  if (!e) return app.scrapeStatus === "partial";
  return Boolean(e.overview || e.statusChanges || e.messages || e.documents || e.downloads?.length);
}

function portalStatusLabel(app: PepcoApplicationDetail): string {
  if (app.currentStatus) return app.currentStatus;
  if (app.overview?.statusName) return app.overview.statusName;
  if (app.currentMilestone) return app.currentMilestone;
  return "—";
}

function DetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-xs leading-snug", className)}>
      <span className="font-medium">{label}:</span> {value ?? "—"}
    </p>
  );
}

function ReadOnlyNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

function ActionRequiredBanner({
  statusLabel,
  supportingText,
  onViewDetails,
}: {
  statusLabel: string;
  supportingText?: string | null;
  onViewDetails: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Action required: {statusLabel}
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {supportingText?.trim() ||
              "Review the latest PEPCO message or status update for required next steps."}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 border-destructive/30 text-xs"
        onClick={onViewDetails}
      >
        View details
      </Button>
    </div>
  );
}

function StatusTrackingPanel({
  app,
  formatWhen,
  mutedClass,
}: {
  app: PepcoApplicationDetail;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
}) {
  const groups = useMemo(
    () =>
      buildPepcoMilestoneTrackingGroups(
        app.statusTracking,
        app.statusChanges ?? [],
        app.currentMilestone,
        app.currentStatus,
      ),
    [app.statusTracking, app.statusChanges, app.currentMilestone, app.currentStatus],
  );

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Status tracking
        </p>
        <p className={cn("mt-2 text-xs", mutedClass)}>No milestone tracking data is available.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Status tracking
      </p>
      <div className="mt-3 space-y-3">
        {groups.map((group) => (
          <div
            key={group.milestoneName}
            className={cn(
              "rounded-md border px-3 py-2",
              group.isCurrentMilestone
                ? "border-primary/30 bg-primary/5"
                : "border-border/50 bg-muted/20",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">{group.milestoneName}</p>
              {group.isCurrentMilestone ? (
                <Badge variant="secondary" className="text-[10px]">
                  Current
                </Badge>
              ) : null}
            </div>
            {group.statuses.length === 0 ? (
              <p className={cn("mt-1.5 text-[11px]", mutedClass)}>No statuses recorded.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {group.statuses.map((status) => (
                  <li key={`${group.milestoneName}-${status.statusName}`} className="flex items-start gap-2">
                    {status.isCurrent ? (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-primary text-primary" />
                    ) : status.isCompleted ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal dark:text-teal-soft" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-xs leading-snug",
                          status.isCurrent ? "font-semibold text-foreground" : "text-foreground/90",
                        )}
                      >
                        {status.statusName}
                      </p>
                      {status.lastUpdatedAt ? (
                        <p className={cn("text-[10px]", mutedClass)}>
                          {formatWhen(status.lastUpdatedAt)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({
  app,
  formatWhen,
  mutedClass,
  onSwitchTab,
}: {
  app: PepcoApplicationDetail;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  onSwitchTab: (tab: PepcoDetailTab) => void;
}) {
  const overview = app.overview;
  const summary = app.projectSummary;
  const details = app.projectDetails;
  const contacts = details?.applicationDetails?.projectContacts ?? [];
  const billing = details?.applicationDetails?.billing;
  const projectInfoRows = flattenProjectInformation(details);
  const electricLoads = listElectricServiceLoads(details?.applicationDetails?.electricServiceLoads);
  const partial = hasSectionErrors(app);
  const actionStatus = portalStatusLabel(app);
  const latestMessage = sortMessagesNewestFirst(app.messages ?? [])[0];

  return (
    <div className="space-y-4">
      {partial ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Some PEPCO sections could not be fetched.
            {app.errors?.overview ? ` Overview: ${app.errors.overview}.` : ""}
            {app.errors?.statusChanges ? ` Status: ${app.errors.statusChanges}.` : ""}
            {app.errors?.messages ? ` Messages: ${app.errors.messages}.` : ""}
            {app.errors?.documents ? ` Documents: ${app.errors.documents}.` : ""}
          </span>
        </div>
      ) : null}

      {overview?.actionRequired === true ? (
        <ActionRequiredBanner
          statusLabel={actionStatus}
          supportingText={
            latestMessage?.senderMessage ||
            latestMessage?.receiverMessage ||
            latestMessage?.statusChangeDisplayName
          }
          onViewDetails={() => onSwitchTab("messages")}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <StatusTrackingPanel app={app} formatWhen={formatWhen} mutedClass={mutedClass} />

        <div className="space-y-4">
          {summary ? (
            <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Project summary
              </p>
              <DetailField label="Project owner" value={summary.projectOwnerName} className={mutedClass} />
              <DetailField label="Submitter" value={summary.submitterName} className={mutedClass} />
              <DetailField label="PEPCO contact" value={summary.opcoContactName} className={mutedClass} />
              <DetailField
                label="PEPCO contact email"
                value={summary.opcoContactEmail}
                className={mutedClass}
              />
              <DetailField
                label="Expected in-service date"
                value={formatWhen(summary.expectedInServiceByDate ?? null)}
                className={mutedClass}
              />
            </div>
          ) : null}

          {(contacts.length > 0 || billing || projectInfoRows.length > 0 || electricLoads.length > 0) ? (
            <Accordion type="multiple" className="w-full rounded-lg border border-border/60 bg-card">
              {contacts.length > 0 ? (
                <AccordionItem value="contacts" className="border-border/50 px-1">
                  <AccordionTrigger className="px-3 py-2 text-xs font-semibold hover:no-underline">
                    Project contacts
                  </AccordionTrigger>
                  <AccordionContent className="px-3">
                    <div className="overflow-x-auto">
                      <Table className="min-w-[640px] text-xs">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Contact type</TableHead>
                            <TableHead>Custom type</TableHead>
                            <TableHead>Full name</TableHead>
                            <TableHead>Preferred method</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Address type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {contacts.map((c, idx) => (
                            <TableRow key={`${c.contactFullName ?? ""}-${idx}`}>
                              <TableCell>{c.contactType ?? "—"}</TableCell>
                              <TableCell>{c.customContactType ?? "—"}</TableCell>
                              <TableCell>{c.contactFullName ?? "—"}</TableCell>
                              <TableCell>{c.contactPreferredMethod ?? "—"}</TableCell>
                              <TableCell>{c.email ?? "—"}</TableCell>
                              <TableCell>{c.primaryPhone ?? "—"}</TableCell>
                              <TableCell>{c.addressType ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ) : null}

              {billing ? (
                <AccordionItem value="billing" className="border-border/50 px-1">
                  <AccordionTrigger className="px-3 py-2 text-xs font-semibold hover:no-underline">
                    Billing address
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 px-3 text-xs">
                    <DetailField
                      label="Construction billing"
                      value={formatAddressBlock(billing.constructionBillingAddress)}
                      className={mutedClass}
                    />
                    <DetailField
                      label="Monthly billing"
                      value={formatAddressBlock(billing.monthlyBillingAddress)}
                      className={mutedClass}
                    />
                  </AccordionContent>
                </AccordionItem>
              ) : null}

              {projectInfoRows.length > 0 ? (
                <AccordionItem value="project-info" className="border-border/50 px-1">
                  <AccordionTrigger className="px-3 py-2 text-xs font-semibold hover:no-underline">
                    Project information
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1 px-3">
                    {projectInfoRows.map((row) => (
                      <DetailField key={row.label} label={row.label} value={row.value} className={mutedClass} />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              ) : null}

              {electricLoads.length > 0 ? (
                <AccordionItem value="loads" className="border-border/50 px-1">
                  <AccordionTrigger className="px-3 py-2 text-xs font-semibold hover:no-underline">
                    Electric service loads
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-wrap gap-2 px-3">
                    {electricLoads.map((load) => (
                      <Badge key={load.label} variant={load.enabled ? "ai" : "secondary"}>
                        {load.label}: {load.enabled ? "Yes" : "No"}
                      </Badge>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              ) : null}
            </Accordion>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function messageSenderLabel(message: PepcoMessage): string {
  if (message.isSPOC) return message.receiverName?.trim() || "PEPCO contact";
  if (message.isInternalUser) return "Internal user";
  if (message.receiverName?.trim()) return message.receiverName;
  return "Project team";
}

function MessageBody({ body }: { body: string }) {
  const segments = useMemo(() => parsePepcoMessageBodySegments(body), [body]);
  return (
    <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-foreground/90">
      {segments.map((segment, idx) =>
        segment.type === "link" ? (
          <a
            key={idx}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-primary underline underline-offset-2"
          >
            {segment.label}
          </a>
        ) : (
          <span key={idx}>{segment.value}</span>
        ),
      )}
    </p>
  );
}

function MessageCard({
  message,
  formatWhen,
  mutedClass,
}: {
  message: PepcoMessage;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
}) {
  const inbound = message.isSPOC === true;
  const body = message.senderMessage?.trim() || message.receiverMessage?.trim() || null;

  return (
    <article
      className={cn(
        "rounded-lg border p-3 text-xs",
        inbound
          ? "border-primary/20 bg-primary/5"
          : "border-border/60 bg-muted/30",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{messageSenderLabel(message)}</p>
          <p className={cn("text-[11px]", mutedClass)}>{formatWhen(message.messageDateTime ?? null)}</p>
        </div>
        {message.statusChangeDisplayName ? (
          <Badge variant={inbound ? "secondary" : "outline"} className="shrink-0 text-[10px]">
            {message.statusChangeDisplayName}
          </Badge>
        ) : null}
      </div>
      {body ? (
        <MessageBody body={body} />
      ) : (
        <p className={cn("mt-2 italic", mutedClass)}>No message body provided.</p>
      )}
    </article>
  );
}

function StatusTab({
  statusRows,
  formatWhen,
  mutedClass,
  tableHeadClass,
  tableCellClass,
  tableHeaderRowClass,
}: {
  statusRows: ReturnType<typeof sortStatusChangesNewestFirst>;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  tableHeadClass: string;
  tableCellClass: string;
  tableHeaderRowClass: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Status Updates</h3>
        {statusRows.length > 0 ? (
          <Badge variant="outline" className="text-[10px]">
            {countLabel(statusRows.length, "update", "updates")}
          </Badge>
        ) : null}
      </div>
      {statusRows.length === 0 ? (
        <p className={cn("rounded-md border border-border/60 bg-muted/20 px-3 py-4 text-xs", mutedClass)}>
          No status updates are available for this project.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <Table className="min-w-[520px] text-xs">
            <TableHeader className={tableHeaderRowClass}>
              <TableRow>
                <TableHead className={tableHeadClass}>Milestone</TableHead>
                <TableHead className={tableHeadClass}>Status</TableHead>
                <TableHead className={tableHeadClass}>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statusRows.map((row, idx) => (
                <TableRow
                  key={`${row.statusChangeDateTime ?? idx}`}
                  className={idx % 2 === 1 ? "bg-muted/20" : undefined}
                >
                  <TableCell className={tableCellClass}>{row.milestoneName ?? "—"}</TableCell>
                  <TableCell className={tableCellClass}>{row.statusName ?? "—"}</TableCell>
                  <TableCell className={cn(tableCellClass, "min-w-[140px] whitespace-nowrap")}>
                    {formatWhen(row.statusChangeDateTime ?? null)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function MessagesTab({
  messages,
  contactName,
  formatWhen,
  mutedClass,
}: {
  messages: PepcoMessage[];
  contactName: string | null | undefined;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
}) {
  const sorted = useMemo(() => sortMessagesNewestFirst(messages), [messages]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Messages</h3>
        {contactName ? (
          <p className={cn("text-xs", mutedClass)}>
            PEPCO contact: <span className="font-medium text-foreground">{contactName}</span>
          </p>
        ) : null}
      </div>
      <ReadOnlyNotice>
        Messages are synchronized from the PEPCO portal. Reply functionality is not enabled.
      </ReadOnlyNotice>
      {sorted.length === 0 ? (
        <p className={cn("rounded-md border border-border/60 bg-muted/20 px-3 py-4 text-xs", mutedClass)}>
          No messages are available for this project.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((message, idx) => (
            <MessageCard
              key={`${message.messageDateTime ?? idx}`}
              message={message}
              formatWhen={formatWhen}
              mutedClass={mutedClass}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentsTab({
  app,
  coordinationId,
  formatWhen,
  mutedClass,
  tableHeadClass,
  tableCellClass,
  tableHeaderRowClass,
}: {
  app: PepcoApplicationDetail;
  coordinationId: string | null;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  tableHeadClass: string;
  tableCellClass: string;
  tableHeaderRowClass: string;
}) {
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  const documents = app.documents ?? [];
  const downloaded = app.downloadedFiles ?? [];

  const handleDocumentView = async (documentIndex: number) => {
    if (!coordinationId || !app.applicationUuid) return;
    const key = `${app.applicationUuid}-${documentIndex}`;
    const previewWindow = window.open("about:blank", "_blank");
    setViewingKey(key);
    try {
      const result = await openPepcoApplicationDocumentView(
        coordinationId,
        app.applicationUuid,
        documentIndex,
        previewWindow,
      );
      const message = pepcoDocumentViewErrorMessage(result);
      if (message) {
        toast.error(message);
      }
    } finally {
      setViewingKey(null);
    }
  };

  const handleDocumentDownload = async (documentIndex: number, suggestedFileName?: string | null) => {
    if (!coordinationId || !app.applicationUuid) return;
    const key = `${app.applicationUuid}-${documentIndex}`;
    setDownloadingKey(key);
    try {
      await downloadPepcoApplicationDocument(
        coordinationId,
        app.applicationUuid,
        documentIndex,
        suggestedFileName,
      );
    } catch {
      toast.error("The PEPCO document could not be downloaded.");
    } finally {
      setDownloadingKey(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Documents</h3>
        {documents.length > 0 ? (
          <Badge variant="outline" className="text-[10px]">
            {countLabel(documents.length, "document", "documents")}
          </Badge>
        ) : null}
      </div>
      <ReadOnlyNotice>
        Documents are synchronized from the PEPCO portal. Upload functionality is not enabled.
      </ReadOnlyNotice>
      {documents.length === 0 ? (
        <p className={cn("rounded-md border border-border/60 bg-muted/20 px-3 py-4 text-xs", mutedClass)}>
          No documents are available for this project.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <Table className="min-w-[760px] text-xs">
            <TableHeader className={tableHeaderRowClass}>
              <TableRow>
                <TableHead className={cn(tableHeadClass, "min-w-[220px]")}>Document</TableHead>
                <TableHead className={cn(tableHeadClass, "min-w-[120px]")}>Category</TableHead>
                <TableHead className={cn(tableHeadClass, "min-w-[130px]")}>Uploaded</TableHead>
                <TableHead className={cn(tableHeadClass, "min-w-[110px]")}>Status</TableHead>
                <TableHead className={cn(tableHeadClass, "min-w-[150px]")}>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc, idx) => {
                const dl = findDownloadForDocument(doc, downloaded);
                const isDownloaded = dl?.status === "saved";
                const docName = doc.documentName ?? "—";
                const downloadKey = `${app.applicationUuid}-${idx}`;
                const busy = downloadingKey === downloadKey;
                const viewing = viewingKey === downloadKey;
                const fileLabel = dl?.fileName ?? doc.documentName ?? "";
                const isPdf = /\.pdf$/i.test(fileLabel);
                const canView = isDownloaded && isPdf;
                return (
                  <TableRow key={`${doc.documentName ?? idx}`} className={idx % 2 === 1 ? "bg-muted/20" : undefined}>
                    <TableCell className={cn(tableCellClass, "max-w-[320px] align-top")}>
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="line-clamp-2 break-words font-medium leading-snug" title={docName}>
                              {docName}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm break-words">
                            {docName}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {isDownloaded ? (
                        <p className={cn("mt-1 text-[11px]", mutedClass)}>{formatFileSize(dl?.sizeBytes)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className={cn(tableCellClass, "whitespace-normal align-top")}>
                      {doc.documentType ?? "—"}
                    </TableCell>
                    <TableCell className={cn(tableCellClass, "whitespace-nowrap align-top")}>
                      {formatWhen(doc.documentUploadDateTime ?? null)}
                    </TableCell>
                    <TableCell className={cn(tableCellClass, "align-top")}>
                      {isDownloaded ? (
                        <Badge variant="ai">Downloaded</Badge>
                      ) : dl?.status === "failed" ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : (
                        <Badge variant="secondary">Listed only</Badge>
                      )}
                    </TableCell>
                    <TableCell className={cn(tableCellClass, "align-top")}>
                      {isDownloaded ? (
                        <div className="flex flex-wrap gap-1.5">
                          {canView ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 text-[11px]"
                              disabled={!coordinationId || viewing || busy}
                              aria-busy={viewing}
                              onClick={() => void handleDocumentView(idx)}
                            >
                              {viewing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                              View
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-[11px]"
                            disabled={!coordinationId || busy || viewing}
                            aria-busy={busy}
                            onClick={() => void handleDocumentDownload(idx, dl?.fileName ?? doc.documentName)}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            Download
                          </Button>
                        </div>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" disabled>
                          Not downloaded
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Detail tabs (Overview / Status / Messages / Documents) for exactly one
 * selected PEPCO project. The active tab resets to Overview whenever the
 * selected project changes, satisfying the "no stale content" requirement.
 */
export function PepcoSelectedProjectDetailTabs({
  app,
  coordinationId,
  formatWhen,
  mutedClass,
  tableHeadClass,
  tableCellClass,
  tableHeaderRowClass,
}: {
  app: PepcoApplicationDetail;
  coordinationId: string | null;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  tableHeadClass: string;
  tableCellClass: string;
  tableHeaderRowClass: string;
}) {
  const [activeTab, setActiveTab] = useState<PepcoDetailTab>("overview");

  useEffect(() => {
    setActiveTab("overview");
  }, [app.applicationUuid]);

  const summary = app.projectSummary;
  const statusRows = useMemo(
    () => sortStatusChangesNewestFirst(app.statusChanges ?? []),
    [app.statusChanges],
  );
  const messages = app.messages ?? [];
  const documents = app.documents ?? [];
  const statusUpdateCount = statusRows.length;
  const messageCount = messages.length;
  const documentCount = documents.length;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as PepcoDetailTab)}
      className="w-full"
    >
      <TabsList className="mb-3 h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg p-1 sm:flex-nowrap">
        <TabsTrigger value="overview" className="shrink-0 text-xs sm:text-sm">
          Overview
        </TabsTrigger>
        <TabsTrigger value="status" className="shrink-0 text-xs sm:text-sm">
          Status
          {statusUpdateCount > 0 ? (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
              {statusUpdateCount}
            </Badge>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="messages" className="shrink-0 text-xs sm:text-sm">
          Messages
          {messageCount > 0 ? (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
              {messageCount}
            </Badge>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="documents" className="shrink-0 text-xs sm:text-sm">
          Documents
          {documentCount > 0 ? (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
              {documentCount}
            </Badge>
          ) : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-0 focus-visible:outline-none">
        <OverviewTab app={app} formatWhen={formatWhen} mutedClass={mutedClass} onSwitchTab={setActiveTab} />
      </TabsContent>

      <TabsContent value="status" className="mt-0 focus-visible:outline-none">
        <StatusTab
          statusRows={statusRows}
          formatWhen={formatWhen}
          mutedClass={mutedClass}
          tableHeadClass={tableHeadClass}
          tableCellClass={tableCellClass}
          tableHeaderRowClass={tableHeaderRowClass}
        />
      </TabsContent>

      <TabsContent value="messages" className="mt-0 focus-visible:outline-none">
        <MessagesTab
          messages={messages}
          contactName={summary?.opcoContactName}
          formatWhen={formatWhen}
          mutedClass={mutedClass}
        />
      </TabsContent>

      <TabsContent value="documents" className="mt-0 focus-visible:outline-none">
        <DocumentsTab
          app={app}
          coordinationId={coordinationId}
          formatWhen={formatWhen}
          mutedClass={mutedClass}
          tableHeadClass={tableHeadClass}
          tableCellClass={tableCellClass}
          tableHeaderRowClass={tableHeaderRowClass}
        />
      </TabsContent>
    </Tabs>
  );
}

export function PepcoApplicationDetailProgressLog({
  lines,
  busy,
  mutedClass,
}: {
  lines: string[];
  busy: boolean;
  mutedClass: string;
}) {
  const milestones = normalizePepcoAppDetailProgress(lines);
  const showDevDetails = import.meta.env.DEV && lines.some((line) => normalizePepcoAppDetailProgress([line]).length === 0);

  if (milestones.length === 0 && !busy) return null;

  const displayLines =
    milestones.length > 0
      ? milestones
      : busy
        ? ["Starting PEPCO login"]
        : [];

  return (
    <div
      className={cn(
        "mt-3 rounded-md border border-teal/20 bg-cream-raised/50 px-3 py-2 dark:bg-obsidian/30",
      )}
      aria-live="polite"
    >
      <p className={cn("mb-2 text-[11px] font-semibold uppercase tracking-wide", mutedClass)}>
        Application detail progress
        {busy ? " · running…" : ""}
      </p>
      <ol className={cn("list-decimal space-y-1 pl-5 text-[11px]", mutedClass)}>
        {displayLines.map((line, idx) => (
          <li
            key={`${idx}-${line}`}
            className={cn(
              "leading-snug",
              busy && idx === displayLines.length - 1 ? "font-medium text-teal dark:text-teal-soft" : "",
            )}
          >
            {line}
            {busy && idx === displayLines.length - 1 ? (
              <span className="ml-1 inline-block animate-pulse">…</span>
            ) : null}
          </li>
        ))}
      </ol>
      {showDevDetails ? (
        <details className="mt-2 border-t border-teal/10 pt-2">
          <summary className={cn("cursor-pointer text-[10px] font-medium", mutedClass)}>
            Technical details (development only)
          </summary>
          <pre className={cn("mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px]", mutedClass)}>
            {lines.slice(-20).join("\n")}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
