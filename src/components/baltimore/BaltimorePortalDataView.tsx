import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { BaltimoreLayout } from "@/components/baltimore/BaltimoreLayout";
import {
  BaltimoreRecordTabBar,
  BALTIMORE_MINIMAL_SECTIONS_UI,
  type DetailPanel,
} from "@/components/baltimore/BaltimoreRecordTabBar";
import { BaltimoreDetailSection } from "@/components/baltimore/BaltimoreDetailSection";
import { BaltimoreInfoGrid } from "@/components/baltimore/BaltimoreInfoGrid";
import { BaltimorePanelTable } from "@/components/baltimore/BaltimorePanelTable";

/** Accela portal_data shape (same as AccelaProjectView). */
interface AccelaPortalData {
  portalType?: string;
  name?: string;
  projectNum?: string;
  description?: string;
  location?: string;
  dashboardStatus?: string;
  tabs?: {
    info?: {
      fields?: Record<string, string>;
      keyValues?: { key: string; value: string }[];
      tables?: { title?: string; headers?: string[]; rows?: Record<string, string>[] }[];
    };
    status?: { departments?: Array<{ name: string; status: string; date?: string; details?: string }> };
    relatedRecords?: { tables?: { rows?: Record<string, string>[] }[] };
    attachments?: { tables?: { rows?: Record<string, string>[] }[] };
    inspections?: { tables?: { rows?: Record<string, string>[] }[] };
    payments?: { tables?: { rows?: Record<string, string>[] }[] };
    reports?: {
      pdfs?: { fileName?: string; comments?: { text: string }[] }[];
      tables?: { rows?: Record<string, string>[] }[];
      planReviewSummary?: {
        reviewType?: string;
        totalNumberOfFiles?: string;
        timeElapsed?: string;
        prescreenReviewComments?: string;
        timeWithJurisdiction?: string;
        timeWithApplicant?: string;
        status?: string;
        currentNonCompletedTasks?: string;
        rawFields?: Record<string, string>;
      };
    };
  };
}

interface BaltimorePortalDataViewProps {
  portalData: AccelaPortalData;
  /** When provided, view is embedded in /portal-data for the selected record; Search Applications link is hidden. */
  projectId?: string | null;
  permitNumber?: string | null;
  credentialLoginUrl?: string | null;
}

export function BaltimorePortalDataView({
  portalData,
  projectId = null,
  permitNumber = null,
  credentialLoginUrl = null,
}: BaltimorePortalDataViewProps) {
  const [activePanel, setActivePanel] = useState<DetailPanel>("record_details");

  const showFullSections = !BALTIMORE_MINIMAL_SECTIONS_UI;

  const isEmbeddedInPortalData = projectId != null;
  const header = portalData.tabs?.info?.fields ?? {};
  const recordNumber = (header.record_number || portalData.name || portalData.projectNum) ?? "";
  const recordType = (header.record_type || portalData.description) ?? "";
  const recordStatus = ((header.record_status || portalData.dashboardStatus) ?? "").replace(/^Record Status:\s*/i, "").trim();
  const expirationDate = (header.expiration_date ?? "").replace(/^Expiration Date:\s*/i, "").trim();

  const infoKeyValues = portalData.tabs?.info?.keyValues ?? [];
  const infoTables = portalData.tabs?.info?.tables ?? [];
  const departments = showFullSections
    ? (portalData.tabs?.status?.departments ?? [])
    : [];
  const relatedTables = showFullSections
    ? (portalData.tabs?.relatedRecords?.tables ?? [])
    : [];
  const relatedRows = relatedTables.flatMap((t) => t.rows ?? []);
  const attachmentTables = portalData.tabs?.attachments?.tables ?? [];
  const attachmentRows = attachmentTables.flatMap((t) => t.rows ?? []);

  /** Supabase URL: backend uses `viewUrl`; some paths use `publicUrl`. */
  const attachmentFileUrl = (row: Record<string, string>) =>
    (row.viewUrl || row.publicUrl || "").trim();

  const successfulDownloadAttachments = useMemo(() => {
    return attachmentRows.filter((raw) => {
      const row = raw as Record<string, string>;
      const status = (row.downloadStatus ?? "").toLowerCase();
      const isSuccess = status === "uploaded" || status === "success";
      const url = attachmentFileUrl(row);
      return isSuccess && url.length > 0;
    }) as Record<string, string>[];
  }, [attachmentRows]);
  const inspectionTables = showFullSections
    ? (portalData.tabs?.inspections?.tables ?? [])
    : [];
  const inspectionRows = inspectionTables.flatMap((t) => t.rows ?? []);
  const paymentTables = showFullSections
    ? (portalData.tabs?.payments?.tables ?? [])
    : [];
  const paymentRows = paymentTables.flatMap((t) => t.rows ?? []);
  const planReviewPdfs = showFullSections
    ? (portalData.tabs?.reports?.pdfs ?? [])
    : [];
  const planReviewComments = planReviewPdfs.flatMap((p) => p.comments ?? []);
  const planReviewSummary = showFullSections
    ? portalData.tabs?.reports?.planReviewSummary
    : undefined;
  const planReviewRawFields = planReviewSummary?.rawFields ?? {};

  const recordDetailRows = infoTables.find((t) => /record detail/i.test(t.title ?? ""))?.rows ?? infoTables[0]?.rows ?? [];
  const recordDetailItems: Array<[string, string]> = recordDetailRows.length
    ? recordDetailRows.map((r) => [(r.key ?? r.Field ?? ""), (r.value ?? r.Value ?? "")]).filter(([k]) => k)
    : infoKeyValues.map((kv) => [kv.key, kv.value]);

  useEffect(() => {
    if (!BALTIMORE_MINIMAL_SECTIONS_UI) return;
    if (activePanel !== "record_details" && activePanel !== "attachments") {
      setActivePanel("record_details");
    }
  }, [activePanel]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log("[BaltimorePortalDataView] binding", {
      projectId,
      permitNumber,
      credentialLoginUrl: credentialLoginUrl ? "(set)" : null,
      baltimoreMode: isEmbeddedInPortalData ? "embedded" : "standalone",
      portalDataKeys: {
        name: portalData.name ?? null,
        projectNum: portalData.projectNum ?? null,
        portalType: portalData.portalType ?? null,
        infoFields: portalData.tabs?.info?.fields ? Object.keys(portalData.tabs.info.fields) : [],
        statusDepartments: portalData.tabs?.status?.departments?.length ?? 0,
        planReviewComments: planReviewComments.length,
      },
    });
  }, [projectId, permitNumber, credentialLoginUrl, isEmbeddedInPortalData, portalData.name, portalData.projectNum, portalData.portalType, portalData.tabs?.info?.fields, portalData.tabs?.status?.departments?.length, planReviewComments.length]);

  return (
    <BaltimoreLayout
      activeModule="permits"
      permitsSubActive={isEmbeddedInPortalData ? null : "search"}
      showSearchApplicationsLink={!isEmbeddedInPortalData}
    >
      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground">Record Number</p>
              <p className="text-base font-semibold text-primary">{recordNumber || "—"}</p>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                {recordType && (
                  <span>
                    <span className="text-muted-foreground">Type: </span>
                    <span className="font-medium">{recordType}</span>
                  </span>
                )}
                {recordStatus && (
                  <span>
                    <span className="text-muted-foreground">Status: </span>
                    <span className="font-medium">{recordStatus}</span>
                  </span>
                )}
                {expirationDate && (
                  <span>
                    <span className="text-muted-foreground">Expiration: </span>
                    {expirationDate}
                  </span>
                )}
              </div>
              {portalData.location && (
                <p className="text-xs text-muted-foreground mt-1">{portalData.location}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <BaltimoreRecordTabBar
            activePanel={activePanel}
            onPanelChange={setActivePanel}
            minimalSections={BALTIMORE_MINIMAL_SECTIONS_UI}
          />
          <CardContent className="min-h-[200px] pt-6">
            {activePanel === "record_details" && (
              <BaltimoreDetailSection title="Record Details">
                {recordDetailItems.length > 0 ? (
                  <BaltimoreInfoGrid items={recordDetailItems} />
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">No record details available.</p>
                )}
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "processing_status" && (
              <BaltimoreDetailSection title="Processing Status">
                <BaltimorePanelTable
                  columns={[
                    { key: "name", header: "Department / Step", render: (r) => r.name ?? "" },
                    { key: "status", header: "Status", render: (r) => r.status ?? "" },
                    { key: "date", header: "Date", render: (r) => r.date ?? "" },
                  ]}
                  data={departments as Record<string, unknown>[]}
                  emptyMessage="No processing status data."
                />
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "related_records" && (
              <BaltimoreDetailSection title="Related Records">
                <BaltimorePanelTable
                  columns={[
                    { key: "record_number", header: "Record", render: (r) => (r as Record<string, string>).record_number ?? "" },
                    { key: "record_type", header: "Type", render: (r) => (r as Record<string, string>).record_type ?? "" },
                    { key: "status", header: "Status", render: (r) => (r as Record<string, string>).status ?? "" },
                  ]}
                  data={relatedRows as Record<string, unknown>[]}
                  emptyMessage="No related records."
                />
              </BaltimoreDetailSection>
            )}

            {activePanel === "attachments" && (
              <BaltimoreDetailSection title="Attachments">
                {successfulDownloadAttachments.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No downloadable attachments yet
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3 pt-1">
                    {successfulDownloadAttachments.map((row, i) => {
                      const name =
                        row.name?.trim() || row.file_name?.trim() || "Attachment";
                      const href = attachmentFileUrl(row);
                      return (
                        <li key={`${href}-${i}`}>
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-full items-start gap-2 rounded-md text-sm font-medium text-primary transition-colors hover:text-primary/90 hover:underline"
                          >
                            <span className="select-none leading-6" aria-hidden>
                              📄
                            </span>
                            <span className="min-w-0 break-all leading-6">
                              {name}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "inspections" && (
              <BaltimoreDetailSection title="Inspections">
                <BaltimorePanelTable
                  columns={[
                    { key: "type", header: "Type", render: (r) => (r as Record<string, string>).type ?? "" },
                    { key: "status", header: "Status", render: (r) => (r as Record<string, string>).status ?? "" },
                    { key: "date", header: "Date", render: (r) => (r as Record<string, string>).date ?? "" },
                  ]}
                  data={inspectionRows as Record<string, unknown>[]}
                  emptyMessage="No inspections."
                />
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "fees" && (
              <BaltimoreDetailSection title="Fees">
                <BaltimorePanelTable
                  columns={[
                    { key: "description", header: "Description", render: (r) => (r as Record<string, string>).description ?? "" },
                    { key: "amount", header: "Amount", render: (r) => (r as Record<string, string>).amount ?? "" },
                    { key: "status", header: "Status", render: (r) => (r as Record<string, string>).status ?? "" },
                  ]}
                  data={paymentRows as Record<string, unknown>[]}
                  emptyMessage="No fee records."
                />
              </BaltimoreDetailSection>
            )}

            {showFullSections && activePanel === "plan_review" && (
              <BaltimoreDetailSection title="Plan Review">
                {Object.keys(planReviewRawFields).length > 0 ? (
                  <div className="space-y-3 text-sm">
                    {Object.entries(planReviewRawFields).map(([label, value]) => (
                      <div key={label} className="flex flex-wrap gap-2 border-b border-border/60 pb-2 last:border-0">
                        <span className="text-muted-foreground shrink-0">{label}</span>
                        <span className="font-medium">{value || "—"}</span>
                      </div>
                    ))}
                  </div>
                ) : planReviewComments.length > 0 ? (
                  <ul className="space-y-3 text-sm">
                    {planReviewComments.map((c, i) => {
                      const item = c as { comment?: string; text?: string; reviewer?: string; department?: string; date?: string };
                      const text = item.comment ?? item.text ?? "";
                      const hasMeta = item.reviewer || item.department || item.date;
                      return (
                        <li key={i} className="text-foreground border-b border-border/60 pb-2 last:border-0 last:pb-0">
                          {hasMeta && (
                            <p className="text-xs text-muted-foreground mb-1">
                              {[item.reviewer, item.department, item.date].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          <span>{text}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">No plan review data.</p>
                )}
              </BaltimoreDetailSection>
            )}
          </CardContent>
        </Card>
      </div>
    </BaltimoreLayout>
  );
}
