import type {
  PepcoApplicationDetail,
  PepcoApplicationDetailDiscovery,
  PepcoDocument,
  PepcoDownloadedFile,
  PepcoMessage,
  PepcoProjectContact,
  PepcoProjectDetails,
  PepcoProjectOverview,
  PepcoProjectSummary,
  PepcoStatusChange,
} from "@/types/uci";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : v == null ? null : String(v);
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parsePepcoOverview(raw: unknown): PepcoProjectOverview | null {
  const o = asRecord(raw);
  if (!o) return null;
  return {
    projectName: str(o.projectName),
    propertyAddress: str(o.propertyAddress),
    jobId: str(o.jobId),
    statusName: str(o.statusName),
    actionRequired: bool(o.actionRequired),
  };
}

export function parsePepcoProjectSummary(raw: unknown): PepcoProjectSummary | null {
  const o = asRecord(raw);
  if (!o) return null;
  return {
    projectOwnerName: str(o.projectOwnerName),
    submitterName: str(o.submitterName),
    opco: str(o.opco),
    opcoContactName: str(o.opcoContactName),
    opcoContactEmail: str(o.opcoContactEmail),
    expectedInServiceByDate: str(o.expectedInServiceByDate),
  };
}

export function parsePepcoProjectDetails(raw: unknown): PepcoProjectDetails | null {
  const root = asRecord(raw);
  if (!root) return null;
  const appDetails = asRecord(root.applicationDetails) ?? root;
  const contactsRaw = Array.isArray(appDetails.projectContacts) ? appDetails.projectContacts : [];
  const contacts: PepcoProjectContact[] = contactsRaw.map((row) => {
    const c = asRecord(row) ?? {};
    return {
      contactType: str(c.contactType),
      customContactType: str(c.customContactType),
      primaryContact: bool(c.primaryContact),
      contactFullName: str(c.contactFullName),
      contactPreferredMethod: str(c.contactPreferredMethod),
      email: str(c.email),
      primaryPhone: str(c.primaryPhone),
      addressType: str(c.addressType),
    };
  });

  const billing = asRecord(appDetails.billing);
  const projectInformation = asRecord(appDetails.projectInformation);
  const electricServiceLoads = asRecord(appDetails.electricServiceLoads);

  return {
    applicationDetails: {
      projectContacts: contacts,
      billing: billing
        ? {
            constructionBillingAddress: billing.constructionBillingAddress,
            monthlyBillingAddress: billing.monthlyBillingAddress,
          }
        : undefined,
      projectInformation: projectInformation
        ? {
            siteDetails: asRecord(projectInformation.siteDetails) ?? undefined,
            estimatedDates: asRecord(projectInformation.estimatedDates) ?? undefined,
            siteOperationalDetails:
              asRecord(projectInformation.siteOperationalDetails) ?? undefined,
          }
        : undefined,
      electricServiceLoads: electricServiceLoads ?? undefined,
    },
  };
}

export function parsePepcoStatusChanges(raw: unknown): PepcoStatusChange[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = asRecord(row) ?? {};
    return {
      milestoneName: str(r.milestoneName),
      statusName: str(r.statusName),
      statusChangeDateTime: str(r.statusChangeDateTime),
    };
  });
}

export function parsePepcoMessages(raw: unknown): PepcoMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = asRecord(row) ?? {};
    return {
      statusChangeDisplayName: str(r.statusChangeDisplayName),
      senderMessage: str(r.senderMessage),
      isSPOC: r.isSPOC === true,
      isInternalUser: r.isInternalUser === true,
      receiverName: str(r.receiverName),
      receiverMessage: str(r.receiverMessage),
      messageDateTime: str(r.messageDateTime),
    };
  });
}

export function parsePepcoDocuments(raw: unknown): PepcoDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = asRecord(row) ?? {};
    return {
      documentName: str(r.documentName),
      documentType: str(r.documentType),
      documentStatus: str(r.documentStatus),
      documentUploadDateTime: str(r.documentUploadDateTime),
    };
  });
}

export function parsePepcoDownloadedFiles(raw: unknown): PepcoDownloadedFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = asRecord(row) ?? {};
    return {
      documentName: str(r.documentName),
      fileName: str(r.fileName),
      status: str(r.status),
      sizeBytes: num(r.sizeBytes),
      localPath: str(r.localPath),
      storagePath: str(r.storagePath),
      contentDisposition: str(r.contentDisposition),
      error: str(r.error),
    };
  });
}

export function parsePepcoApplicationDetail(raw: unknown): PepcoApplicationDetail | null {
  const o = asRecord(raw);
  if (!o || !str(o.applicationUuid)) return null;
  const errorsRaw = asRecord(o.errors);
  return {
    applicationUuid: String(o.applicationUuid),
    overview: parsePepcoOverview(o.overview),
    projectSummary: parsePepcoProjectSummary(o.projectSummary),
    projectDetails: parsePepcoProjectDetails(o.projectDetails),
    statusTracking: asRecord(o.statusTracking),
    statusChanges: parsePepcoStatusChanges(o.statusChanges),
    currentMilestone: str(o.currentMilestone),
    currentStatus: str(o.currentStatus),
    statusLastUpdatedAt: str(o.statusLastUpdatedAt),
    messageCount: num(o.messageCount) ?? undefined,
    latestMessageAt: str(o.latestMessageAt),
    messages: parsePepcoMessages(o.messages),
    documentCount: num(o.documentCount) ?? undefined,
    documents: parsePepcoDocuments(o.documents),
    downloadedFiles: parsePepcoDownloadedFiles(o.downloadedFiles),
    scrapedAt: str(o.scrapedAt) ?? undefined,
    scrapeStatus:
      o.scrapeStatus === "completed" || o.scrapeStatus === "partial" || o.scrapeStatus === "failed"
        ? o.scrapeStatus
        : undefined,
    errors: errorsRaw
      ? {
          overview: str(errorsRaw.overview),
          statusChanges: str(errorsRaw.statusChanges),
          messages: str(errorsRaw.messages),
          documents: str(errorsRaw.documents),
          downloads: Array.isArray(errorsRaw.downloads)
            ? (errorsRaw.downloads as Array<{ documentName?: string; error?: string }>)
            : [],
        }
      : undefined,
  };
}

export function parsePepcoApplicationDetailDiscovery(
  metadata: Record<string, unknown> | null | undefined,
): PepcoApplicationDetailDiscovery | null {
  if (!metadata) return null;
  const nested = asRecord(metadata.pepco_application_detail_discovery);
  if (!nested) return null;
  const appsRaw = Array.isArray(nested.applications) ? nested.applications : [];
  const applications = appsRaw
    .map((row) => parsePepcoApplicationDetail(row))
    .filter((a): a is PepcoApplicationDetail => a != null);
  return {
    lastStatus: str(nested.lastStatus),
    lastScrapedAt: str(nested.lastScrapedAt),
    applications,
  };
}

export function sortStatusChangesNewestFirst(rows: PepcoStatusChange[]): PepcoStatusChange[] {
  return [...rows].sort((a, b) => {
    const ta = a.statusChangeDateTime ? Date.parse(a.statusChangeDateTime) : 0;
    const tb = b.statusChangeDateTime ? Date.parse(b.statusChangeDateTime) : 0;
    return tb - ta;
  });
}

export function formatAddressBlock(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value.trim() || "—";
  const o = asRecord(value);
  if (!o) return String(value);
  const parts = [
    str(o.addressLine1) ?? str(o.line1),
    str(o.addressLine2) ?? str(o.line2),
    str(o.city),
    str(o.state),
    str(o.zipCode) ?? str(o.postalCode),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : JSON.stringify(o);
}

export function flattenProjectInformation(details: PepcoProjectDetails | null | undefined): Array<{
  label: string;
  value: string;
}> {
  const info = details?.applicationDetails?.projectInformation;
  if (!info) return [];

  const pick = (obj: Record<string, unknown> | undefined, keys: string[], label: string) => {
    if (!obj) return null;
    for (const k of keys) {
      const v = obj[k];
      if (v != null && String(v).trim()) return { label, value: String(v) };
    }
    return null;
  };

  const rows = [
    pick(info.siteDetails, ["squareFootage", "squareFootageArea", "totalSquareFootage"], "Square Footage"),
    pick(info.siteDetails, ["numberOfUnits", "units", "unitCount"], "Number of Units"),
    pick(info.estimatedDates, ["desiredStartServiceDate", "desiredServiceStartDate"], "Desired Start Service Date"),
    pick(info.estimatedDates, ["dateUtilityCanBeginWork", "utilityCanBeginWorkDate"], "Date Utility Can Begin Work"),
    pick(info.estimatedDates, ["dateOfGroundbreaking", "groundbreakingDate"], "Date of Groundbreaking"),
    pick(info.siteOperationalDetails, ["hoursOfOperation", "operatingHours"], "Hours of Operation"),
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return rows;
}

export function listElectricServiceLoads(
  loads: Record<string, unknown> | undefined,
): Array<{ label: string; enabled: boolean }> {
  if (!loads) return [];
  return Object.entries(loads).map(([key, value]) => ({
    label: key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()),
    enabled: value === true,
  }));
}

export function findDownloadForDocument(
  doc: PepcoDocument,
  downloaded: PepcoDownloadedFile[] | undefined,
): PepcoDownloadedFile | undefined {
  if (!downloaded?.length || !doc.documentName) return undefined;
  return downloaded.find(
    (f) => f.documentName === doc.documentName || f.fileName === doc.documentName,
  );
}

export const PEPCO_APP_DETAIL_PROGRESS_PLACEHOLDERS = [
  "Starting PEPCO application detail scrape",
  "Logging in to PEPCO portal…",
  "Fetching dashboard applications",
  "Fetching overview",
  "Fetching status history",
  "Fetching messages",
  "Fetching documents list",
] as const;
