import { useMemo, useState, type ReactNode } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { downloadPepcoApplicationDocument } from "@/lib/uciApi";
import {
  findDownloadForDocument,
  flattenProjectInformation,
  formatAddressBlock,
  formatFileSize,
  listElectricServiceLoads,
  normalizePepcoAppDetailProgress,
  sortStatusChangesNewestFirst,
} from "@/lib/pepcoApplicationDetailUi";
import type { PepcoApplicationDetail, PepcoApplicationDetailDiscovery } from "@/types/uci";
import { AlertTriangle, Building2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

type PepcoApplicationDetailsPanelProps = {
  coordinationId: string | null;
  discovery: PepcoApplicationDetailDiscovery | null;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  sectionTitleClass: string;
  tableHeadClass: string;
  tableCellClass: string;
  tableHeaderRowClass: string;
};

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

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

function pickMostRecentlyScrapedUuid(apps: PepcoApplicationDetail[]): string | undefined {
  if (apps.length === 0) return undefined;
  const sorted = [...apps].sort((a, b) => {
    const ta = a.scrapedAt ? Date.parse(a.scrapedAt) : 0;
    const tb = b.scrapedAt ? Date.parse(b.scrapedAt) : 0;
    return tb - ta;
  });
  return sorted[0]?.applicationUuid;
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

function PepcoApplicationDetailCard({
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
  const overview = app.overview;
  const summary = app.projectSummary;
  const details = app.projectDetails;
  const contacts = details?.applicationDetails?.projectContacts ?? [];
  const billing = details?.applicationDetails?.billing;
  const projectInfoRows = flattenProjectInformation(details);
  const electricLoads = listElectricServiceLoads(details?.applicationDetails?.electricServiceLoads);
  const statusRows = sortStatusChangesNewestFirst(app.statusChanges ?? []);
  const messages = app.messages ?? [];
  const documents = app.documents ?? [];
  const downloaded = app.downloadedFiles ?? [];
  const partial = hasSectionErrors(app);
  const projectName = overview?.projectName ?? "PEPCO application";
  const jobId = overview?.jobId ?? app.applicationUuid;
  const address = overview?.propertyAddress;
  const portalStatus = portalStatusLabel(app);
  const statusUpdateCount = statusRows.length;
  const messageCount = messages.length;
  const documentCount = documents.length;

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
    <AccordionItem
      value={app.applicationUuid}
      className="mb-3 overflow-hidden rounded-lg border border-cream-sunken/60 bg-cream-raised/50 shadow-sm dark:border-teal/25 dark:bg-obsidian/40"
    >
      <AccordionTrigger
        className={cn(
          "border-b border-cream-sunken/40 px-4 py-3 hover:bg-cream-sunken/25 hover:no-underline",
          "dark:border-teal/15 dark:hover:bg-teal/10",
          "[&[data-state=open]]:border-b [&[data-state=open]]:bg-cream-sunken/15 dark:[&[data-state=open]]:bg-teal/10",
        )}
      >
        <div className="flex w-full flex-col gap-3 pr-2 text-left sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <Building2 className="mt-1 h-4 w-4 shrink-0 text-teal dark:text-teal-soft" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold leading-snug text-foreground">{projectName}</p>
              <p className={cn("mt-0.5 text-xs leading-snug", mutedClass)}>
                <span className="font-mono">{jobId}</span>
                {address ? <> · {address}</> : null}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{portalStatus}</Badge>
                {app.scrapeStatus ? (
                  <Badge variant={app.scrapeStatus === "completed" ? "ai" : "secondary"}>
                    {app.scrapeStatus}
                  </Badge>
                ) : null}
                {overview?.actionRequired === true ? (
                  <Badge variant="destructive">Action required</Badge>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {statusUpdateCount > 0 ? (
                  <Badge variant="outline">{countLabel(statusUpdateCount, "status update", "status updates")}</Badge>
                ) : null}
                {messageCount > 0 ? (
                  <Badge variant="outline">{countLabel(messageCount, "message", "messages")}</Badge>
                ) : null}
                {documentCount > 0 ? (
                  <Badge variant="outline">{countLabel(documentCount, "document", "documents")}</Badge>
                ) : null}
              </div>
              <p className={cn("mt-2 text-[11px] sm:hidden", mutedClass)}>
                Last updated {formatWhen(app.statusLastUpdatedAt ?? app.scrapedAt ?? null)}
              </p>
            </div>
          </div>
          <div className={cn("shrink-0 text-[11px] leading-snug sm:text-right", mutedClass)}>
            <p className="hidden sm:block">Last scraped</p>
            <p className="hidden font-medium text-foreground sm:block">
              {formatWhen(app.scrapedAt ?? null)}
            </p>
            <p className="mt-1 hidden sm:block">Portal updated {formatWhen(app.statusLastUpdatedAt ?? null)}</p>
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-4 pb-4 pt-3">
        <div className="space-y-4">
          {partial ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Some PEPCO sections could not be fetched. See details below.
                {app.errors?.overview ? ` Overview: ${app.errors.overview}.` : ""}
                {app.errors?.statusChanges ? ` Status: ${app.errors.statusChanges}.` : ""}
                {app.errors?.messages ? ` Messages: ${app.errors.messages}.` : ""}
                {app.errors?.documents ? ` Documents: ${app.errors.documents}.` : ""}
              </span>
            </div>
          ) : null}

          {summary ? (
            <div className="space-y-1 rounded-md border border-cream-sunken/50 bg-cream/40 p-3 dark:border-teal/15 dark:bg-obsidian/20">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Project summary</p>
              <DetailField label="Project owner" value={summary.projectOwnerName} className={mutedClass} />
              <DetailField label="Submitter" value={summary.submitterName} className={mutedClass} />
              <DetailField label="PEPCO contact" value={summary.opcoContactName} className={mutedClass} />
              <DetailField label="PEPCO contact email" value={summary.opcoContactEmail} className={mutedClass} />
              <DetailField
                label="Expected in-service date"
                value={formatWhen(summary.expectedInServiceByDate ?? null)}
                className={mutedClass}
              />
            </div>
          ) : null}

          <Accordion type="multiple" className="w-full rounded-md border border-cream-sunken/50 dark:border-teal/15">
            {contacts.length > 0 ? (
              <AccordionItem value="contacts" className="border-cream-sunken/40 dark:border-teal/12">
                <AccordionTrigger className="px-3 py-2 text-xs font-semibold hover:no-underline">
                  Project contacts
                </AccordionTrigger>
                <AccordionContent className="px-3">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[640px] text-xs">
                      <TableHeader className={tableHeaderRowClass}>
                        <TableRow>
                          <TableHead className={tableHeadClass}>Contact type</TableHead>
                          <TableHead className={tableHeadClass}>Custom type</TableHead>
                          <TableHead className={tableHeadClass}>Full name</TableHead>
                          <TableHead className={tableHeadClass}>Preferred method</TableHead>
                          <TableHead className={tableHeadClass}>Email</TableHead>
                          <TableHead className={tableHeadClass}>Phone</TableHead>
                          <TableHead className={tableHeadClass}>Address type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contacts.map((c, idx) => (
                          <TableRow key={`${c.contactFullName ?? ""}-${idx}`}>
                            <TableCell className={tableCellClass}>{c.contactType ?? "—"}</TableCell>
                            <TableCell className={tableCellClass}>{c.customContactType ?? "—"}</TableCell>
                            <TableCell className={tableCellClass}>{c.contactFullName ?? "—"}</TableCell>
                            <TableCell className={tableCellClass}>{c.contactPreferredMethod ?? "—"}</TableCell>
                            <TableCell className={tableCellClass}>{c.email ?? "—"}</TableCell>
                            <TableCell className={tableCellClass}>{c.primaryPhone ?? "—"}</TableCell>
                            <TableCell className={tableCellClass}>{c.addressType ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {billing ? (
              <AccordionItem value="billing" className="border-cream-sunken/40 dark:border-teal/12">
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
              <AccordionItem value="project-info" className="border-cream-sunken/40 dark:border-teal/12">
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
              <AccordionItem value="loads" className="border-cream-sunken/40 dark:border-teal/12">
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

          <div className="space-y-2 border-t border-cream-sunken/50 pt-3 dark:border-teal/20">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Status history</p>
            {statusRows.length === 0 ? (
              <p className={cn("text-xs", mutedClass)}>No status history found.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[520px] text-xs">
                  <TableHeader className={tableHeaderRowClass}>
                    <TableRow>
                      <TableHead className={tableHeadClass}>Milestone</TableHead>
                      <TableHead className={tableHeadClass}>Status</TableHead>
                      <TableHead className={tableHeadClass}>Date/time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statusRows.map((row, idx) => (
                      <TableRow key={`${row.statusChangeDateTime ?? idx}`}>
                        <TableCell className={tableCellClass}>{row.milestoneName ?? "—"}</TableCell>
                        <TableCell className={tableCellClass}>{row.statusName ?? "—"}</TableCell>
                        <TableCell className={cn(tableCellClass, "min-w-[140px] whitespace-normal")}>
                          {formatWhen(row.statusChangeDateTime ?? null)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-cream-sunken/50 pt-3 dark:border-teal/20">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Messages</p>
            {messages.length === 0 ? (
              <p className={cn("text-xs", mutedClass)}>No PEPCO messages found.</p>
            ) : (
              <div className="space-y-3">
                {messages.map((m, idx) => (
                  <div
                    key={`${m.messageDateTime ?? idx}`}
                    className="rounded-md border border-cream-sunken/50 p-2 text-xs dark:border-teal/15"
                  >
                    <p className="font-medium">{formatWhen(m.messageDateTime ?? null)}</p>
                    <p className={mutedClass}>
                      Receiver: {m.receiverName ?? "—"}
                      {m.statusChangeDisplayName ? ` · ${m.statusChangeDisplayName}` : ""}
                    </p>
                    {m.senderMessage ? <p className="mt-1 whitespace-pre-wrap">{m.senderMessage}</p> : null}
                    {m.receiverMessage ? (
                      <p className="mt-1 whitespace-pre-wrap opacity-90">{m.receiverMessage}</p>
                    ) : null}
                    <p className={cn("mt-1", mutedClass)}>
                      Internal user: {yesNo(m.isInternalUser)} · SPOC: {yesNo(m.isSPOC)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-cream-sunken/50 pt-3 dark:border-teal/20">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
              Documents ({documents.length}
              {downloaded.some((d) => d.status === "saved") ? " · downloaded copies available" : ""})
            </p>
            {documents.length === 0 ? (
              <p className={cn("text-xs", mutedClass)}>No PEPCO documents listed.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[760px] text-xs">
                  <TableHeader className={tableHeaderRowClass}>
                    <TableRow>
                      <TableHead className={cn(tableHeadClass, "min-w-[220px]")}>Document</TableHead>
                      <TableHead className={cn(tableHeadClass, "min-w-[120px]")}>Category</TableHead>
                      <TableHead className={cn(tableHeadClass, "min-w-[130px]")}>Uploaded</TableHead>
                      <TableHead className={cn(tableHeadClass, "min-w-[110px]")}>Status</TableHead>
                      <TableHead className={cn(tableHeadClass, "min-w-[110px]")}>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc, idx) => {
                      const dl = findDownloadForDocument(doc, downloaded);
                      const isDownloaded = dl?.status === "saved";
                      const docName = doc.documentName ?? "—";
                      const downloadKey = `${app.applicationUuid}-${idx}`;
                      const busy = downloadingKey === downloadKey;
                      return (
                        <TableRow key={`${doc.documentName ?? idx}`}>
                          <TableCell className={cn(tableCellClass, "max-w-[320px] align-top")}>
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="line-clamp-3 break-words font-medium leading-snug">{docName}</p>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-sm break-words">
                                  {docName}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            {isDownloaded ? (
                              <p className={cn("mt-1 text-[11px]", mutedClass)}>
                                {formatFileSize(dl?.sizeBytes)}
                              </p>
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
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1.5 text-[11px]"
                                disabled={!coordinationId || busy}
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
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[11px]"
                                disabled
                              >
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
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function PepcoApplicationDetailsPanel({
  coordinationId,
  discovery,
  formatWhen,
  mutedClass,
  sectionTitleClass,
  tableHeadClass,
  tableCellClass,
  tableHeaderRowClass,
}: PepcoApplicationDetailsPanelProps) {
  const apps = discovery?.applications ?? [];
  const defaultOpenUuid = useMemo(() => pickMostRecentlyScrapedUuid(apps), [apps]);
  const accordionKey = `${coordinationId ?? "none"}:${apps.map((a) => a.applicationUuid).join(",")}`;

  return (
    <div className="mt-4 space-y-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn(sectionTitleClass, "text-base")}>PEPCO Project Details</p>
          {apps.length > 0 ? (
            <Badge variant="secondary">
              {apps.length} project{apps.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
        <p className={cn("text-xs leading-snug", mutedClass)}>
          Review portal status, contacts, messages, documents, and activity for each discovered PEPCO project.
        </p>
        {discovery?.lastScrapedAt ? (
          <p className={cn("text-[11px]", mutedClass)}>
            Last scrape run {formatWhen(discovery.lastScrapedAt)}
            {discovery.lastStatus ? ` · ${discovery.lastStatus}` : ""}
          </p>
        ) : null}
      </div>

      {apps.length === 0 ? (
        <p className={cn("rounded-md border border-cream-sunken/60 px-3 py-3 text-xs", mutedClass)}>
          No PEPCO project details have been scraped yet. Select Scrape Details from a discovered project above.
        </p>
      ) : (
        <Accordion
          key={accordionKey}
          type="single"
          collapsible
          defaultValue={defaultOpenUuid}
          className="space-y-0"
        >
          {apps.map((app) => (
            <PepcoApplicationDetailCard
              key={app.applicationUuid}
              app={app}
              coordinationId={coordinationId}
              formatWhen={formatWhen}
              mutedClass={mutedClass}
              tableHeadClass={tableHeadClass}
              tableCellClass={tableCellClass}
              tableHeaderRowClass={tableHeaderRowClass}
            />
          ))}
        </Accordion>
      )}
    </div>
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
