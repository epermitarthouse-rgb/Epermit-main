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
    const storagePathRaw = str(r.storagePath);
    const storagePath =
      storagePathRaw && !storagePathRaw.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(storagePathRaw)
        ? storagePathRaw
        : null;
    return {
      documentName: str(r.documentName),
      fileName: str(r.fileName),
      status: str(r.status),
      sizeBytes: num(r.sizeBytes),
      storagePath,
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

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const INTERNAL_PROGRESS_PATTERNS =
  /url=|https?:\/\/|getsession|token found|token length|dashboardshell|mfainputvisible|rejectionlanguage|username field populated|password field populated|b2c form|landed url|after submit|mfa human_required|error_code=|diagnostics|\[pepco\]|contactmethodvisible|sendcodevisible|codeinputvisible|filled username via|filled password|clicked submit-style|csrf_token|selfasserted|combinedsigninandsignup/i;

function safeFailureMessage(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "Application detail scrape failed";
  if (INTERNAL_PROGRESS_PATTERNS.test(trimmed)) return "Application detail scrape failed";
  const withoutPrefix = trimmed.replace(/^\[[^\]]+\]\s*/g, "").slice(0, 160);
  return withoutPrefix || "Application detail scrape failed";
}

/**
 * Map verbose backend progress lines to concise user-facing milestones.
 */
export function mapPepcoAppDetailProgressLine(line: string): string | null {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (/starting pepco application detail|starting pepco login/i.test(lower)) {
    return "Starting PEPCO login";
  }
  if (
    /username field populated|password field populated|b2c form ready|clicked submit|filled password|pepco login submitted/i.test(
      lower,
    )
  ) {
    return "PEPCO login submitted";
  }
  if (
    /verification code required|pepco verification code required|mfa email|mfa_email_code|enter the pepco verification|verification code input ready|clicked email contact|send code after email|select email in the pepco browser/i.test(
      lower,
    )
  ) {
    return "Verification code required";
  }
  if (
    /mfa code accepted|verification code accepted|entered verification code|post-otp verification|submitting pepco verification code/i.test(
      lower,
    )
  ) {
    return "Verification code accepted";
  }
  if (
    /dashboard url reached|pepco dashboard|landing on siup|overview api ready|checking overview api readiness/i.test(
      lower,
    )
  ) {
    return "PEPCO dashboard reached";
  }
  if (/found \d+ application|loading application|using \d+ application uuid|fetching overview for/i.test(lower)) {
    return "Loading application";
  }
  if (/fetching overview/i.test(lower) && !/api readiness|getsession/i.test(lower)) {
    return "Fetching project overview";
  }
  if (/fetching status history/i.test(lower)) return "Fetching status history";
  if (/fetching messages/i.test(lower)) return "Fetching messages";
  if (/fetching documents list|fetching documents(?! list)/i.test(lower) && !/downloading/i.test(lower)) {
    return "Fetching documents";
  }
  if (/downloading documents|saved document /i.test(lower)) return "Downloading documents";
  if (/saving pepco application detail|persist pepco application detail/i.test(lower)) {
    return "Saving PEPCO application details";
  }
  if (/completed \(|completed —|status: completed|applications_scraped/i.test(lower)) {
    return "Completed";
  }
  if (/status: failed|login failed|scrape failed|application detail scrape failed|^failed:/i.test(lower)) {
    return lower.startsWith("failed:")
      ? `Failed: ${safeFailureMessage(raw.replace(/^failed:\s*/i, ""))}`
      : `Failed: ${safeFailureMessage(raw)}`;
  }
  if (/resuming pepco application detail|resuming application detail scrape/i.test(lower)) {
    return "Verification code accepted";
  }

  if (INTERNAL_PROGRESS_PATTERNS.test(raw)) return null;
  if (/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i.test(raw)) return null;

  return null;
}

/** Keep the latest deduplicated milestone labels for UI display. */
export function normalizePepcoAppDetailProgress(rawLines: string[]): string[] {
  const out: string[] = [];
  for (const line of rawLines) {
    const mapped = mapPepcoAppDetailProgressLine(line);
    if (!mapped) continue;
    if (out[out.length - 1] === mapped) continue;
    out.push(mapped);
  }
  return out.slice(-12);
}

export const PEPCO_APP_DETAIL_PROGRESS_START = "Starting PEPCO login";
