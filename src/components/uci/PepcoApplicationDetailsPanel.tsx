import type { ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  findDownloadForDocument,
  flattenProjectInformation,
  formatAddressBlock,
  listElectricServiceLoads,
  sortStatusChangesNewestFirst,
} from "@/lib/pepcoApplicationDetailUi";
import type { PepcoApplicationDetail, PepcoApplicationDetailDiscovery } from "@/types/uci";
import { AlertTriangle } from "lucide-react";

type PepcoApplicationDetailsPanelProps = {
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

function hasSectionErrors(app: PepcoApplicationDetail): boolean {
  const e = app.errors;
  if (!e) return app.scrapeStatus === "partial";
  return Boolean(e.overview || e.statusChanges || e.messages || e.documents || e.downloads?.length);
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
  formatWhen,
  mutedClass,
  tableHeadClass,
  tableCellClass,
  tableHeaderRowClass,
}: {
  app: PepcoApplicationDetail;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  tableHeadClass: string;
  tableCellClass: string;
  tableHeaderRowClass: string;
}) {
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

  return (
    <div className="space-y-4 rounded-lg border border-cream-sunken/60 bg-cream-raised/40 p-3 dark:border-teal/25 dark:bg-obsidian/30">
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

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{overview?.projectName ?? "PEPCO application"}</p>
          {app.scrapeStatus ? (
            <Badge variant={app.scrapeStatus === "completed" ? "ai" : "secondary"}>{app.scrapeStatus}</Badge>
          ) : null}
        </div>
        <DetailField label="Job ID" value={overview?.jobId ?? app.applicationUuid} />
        <DetailField label="Address" value={overview?.propertyAddress} />
        <DetailField
          label="Current status"
          value={
            app.currentMilestone || app.currentStatus
              ? `${app.currentMilestone ?? "—"} / ${app.currentStatus ?? overview?.statusName ?? "—"}`
              : overview?.statusName
          }
        />
        <DetailField
          label="Last updated"
          value={formatWhen(app.statusLastUpdatedAt ?? null)}
        />
        <DetailField label="Action required" value={yesNo(overview?.actionRequired)} />
      </div>

      {summary ? (
        <div className="space-y-1 border-t border-cream-sunken/50 pt-3 dark:border-teal/20">
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

      <Accordion type="multiple" className="w-full">
        {contacts.length > 0 ? (
          <AccordionItem value="contacts">
            <AccordionTrigger className="py-2 text-xs font-semibold">Project contacts</AccordionTrigger>
            <AccordionContent>
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
          <AccordionItem value="billing">
            <AccordionTrigger className="py-2 text-xs font-semibold">Billing address</AccordionTrigger>
            <AccordionContent className="space-y-2 text-xs">
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
          <AccordionItem value="project-info">
            <AccordionTrigger className="py-2 text-xs font-semibold">Project information</AccordionTrigger>
            <AccordionContent className="space-y-1">
              {projectInfoRows.map((row) => (
                <DetailField key={row.label} label={row.label} value={row.value} className={mutedClass} />
              ))}
            </AccordionContent>
          </AccordionItem>
        ) : null}

        {electricLoads.length > 0 ? (
          <AccordionItem value="loads">
            <AccordionTrigger className="py-2 text-xs font-semibold">Electric service loads</AccordionTrigger>
            <AccordionContent className="flex flex-wrap gap-2">
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
                    <TableCell className={cn(tableCellClass, "font-mono text-[11px]")}>
                      {row.statusChangeDateTime ?? "—"}
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
          3. Documents (listed metadata
          {downloaded.some((d) => d.status === "saved") ? " · downloaded copies available" : ""})
        </p>
        {documents.length === 0 ? (
          <p className={cn("text-xs", mutedClass)}>No PEPCO documents listed.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[720px] text-xs">
              <TableHeader className={tableHeaderRowClass}>
                <TableRow>
                  <TableHead className={tableHeadClass}>Document name</TableHead>
                  <TableHead className={tableHeadClass}>Type</TableHead>
                  <TableHead className={tableHeadClass}>Status</TableHead>
                  <TableHead className={tableHeadClass}>Uploaded</TableHead>
                  <TableHead className={tableHeadClass}>Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc, idx) => {
                  const dl = findDownloadForDocument(doc, downloaded);
                  let downloadLabel = "Listed only — not downloaded.";
                  if (dl?.status === "saved") {
                    const path = dl.storagePath ?? dl.localPath;
                    downloadLabel = path
                      ? `Downloaded · ${dl.sizeBytes ?? 0} bytes · ${path}`
                      : `Downloaded · ${dl.sizeBytes ?? 0} bytes`;
                  } else if (dl?.status === "failed") {
                    downloadLabel = dl.error ? `Failed: ${dl.error}` : "Download failed";
                  }
                  return (
                    <TableRow key={`${doc.documentName ?? idx}`}>
                      <TableCell className={cn(tableCellClass, "max-w-[240px] break-all")}>
                        {doc.documentName ?? "—"}
                      </TableCell>
                      <TableCell className={tableCellClass}>{doc.documentType ?? "—"}</TableCell>
                      <TableCell className={tableCellClass}>{doc.documentStatus ?? "—"}</TableCell>
                      <TableCell className={tableCellClass}>
                        {formatWhen(doc.documentUploadDateTime ?? null)}
                      </TableCell>
                      <TableCell className={cn(tableCellClass, "max-w-[280px] break-all text-[11px]")}>
                        {downloadLabel}
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
  );
}

export function PepcoApplicationDetailsPanel({
  discovery,
  formatWhen,
  mutedClass,
  sectionTitleClass,
  tableHeadClass,
  tableCellClass,
  tableHeaderRowClass,
}: PepcoApplicationDetailsPanelProps) {
  const apps = discovery?.applications ?? [];
  if (apps.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={sectionTitleClass}>PEPCO application details</p>
        {discovery?.lastScrapedAt ? (
          <p className={cn("text-[11px]", mutedClass)}>
            Scraped {formatWhen(discovery.lastScrapedAt)}
            {discovery.lastStatus ? ` · ${discovery.lastStatus}` : ""}
          </p>
        ) : null}
      </div>
      {apps.map((app) => (
        <PepcoApplicationDetailCard
          key={app.applicationUuid}
          app={app}
          formatWhen={formatWhen}
          mutedClass={mutedClass}
          tableHeadClass={tableHeadClass}
          tableCellClass={tableCellClass}
          tableHeaderRowClass={tableHeaderRowClass}
        />
      ))}
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
  if (lines.length === 0 && !busy) return null;
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
        {lines.map((line, idx) => (
          <li
            key={`${idx}-${line}`}
            className={cn(
              "leading-snug",
              busy && idx === lines.length - 1 ? "font-medium text-teal dark:text-teal-soft" : "",
            )}
          >
            {line}
            {busy && idx === lines.length - 1 ? (
              <span className="ml-1 inline-block animate-pulse">…</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
