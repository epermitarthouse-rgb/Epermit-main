const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { isScraperDebugArtifactsEnabled } = require("./artifacts/debug-artifacts");
const {
  resolveAccelaTenantProfile,
  ArlingtonAccelaProfile,
} = require("./accela-tenant-profiles");
const { mirrorSessionProgress } = require("./lib/session-progress");
const arlingtonOrchestration = require("./lib/arlington-orchestration.js");
const arlingtonDurableJob = require("./lib/arlington-durable-job.js");
const arlingtonJobStore = require("./lib/arlington-job-store.js");
const {
  normalizeArlingtonBaseProjectId,
  arlingtonProjectIdsMatch,
  arlingtonProjectInformationPreviewLooksLikeTabShellOnly,
  scoreArlingtonProjectInformationFrameCandidate,
  selectArlingtonProjectInformationFrameFromRanked,
  arlingtonProjectInformationValueLooksLikeAddressDropdownList,
  arlingtonProjectInformationFieldValueIsRejected,
  arlingtonProjectInformationExtractionIsWeak,
  arlingtonProjectInformationUnityTextExtractionIsValid,
  ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND,
} = require("./lib/arlington-project-information.js");
const {
  applyScrapeCanonicalAddressToPortalData,
  preservePermitPilotMetaOnPortalMerge,
} = require("./app/services/project-address.service.js");

function getAccelaDebugDir() {
  const dir = path.join(__dirname, "debug");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveCheckpointScreenshot(page, label) {
  if (!isScraperDebugArtifactsEnabled())
    return Promise.resolve();
  if (!page || typeof page.screenshot !== "function") return Promise.resolve();
  const dir = getAccelaDebugDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `${ts}_${label}.png`);
  return page.screenshot({ path: file, fullPage: true }).then(
    () => {
      console.log(`  [CHECKPOINT] Saved ${label} → ${path.basename(file)}`);
    },
    () => {},
  );
}

async function findFieldInFrames(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) return el;
  }
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    for (const sel of selectors) {
      try {
        const el = await frame.$(sel);
        if (el && (await el.isVisible().catch(() => false))) return el;
      } catch (_) {}
    }
  }
  return null;
}

async function waitForAccelaLoad(pageOrFrame, timeoutMs = 30000) {
  if (typeof pageOrFrame.waitForLoadState === "function") {
    await pageOrFrame
      .waitForLoadState("networkidle", { timeout: timeoutMs })
      .catch(() => {});
  }
  await pageOrFrame
    .waitForSelector(".aca_loading, .ACA_Loading, .loading-mask", {
      state: "detached",
      timeout: 10000,
    })
    .catch(() => {});
  if (typeof pageOrFrame.waitForTimeout === "function") {
    await pageOrFrame.waitForTimeout(1500);
  } else {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function clickAccelaLink(pageOrFrame, selectors, label) {
  for (const sel of selectors) {
    try {
      const link = await pageOrFrame.$(sel);
      if (link && (await link.isVisible().catch(() => false))) {
        console.log(`     Clicking "${label}" via ${sel}...`);
        await link.click({ force: true }).catch(async () => {
          await pageOrFrame.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) el.click();
          }, sel);
        });
        await waitForAccelaLoad(pageOrFrame);
        return true;
      }
    } catch (clickErr) {
      console.log(
        `     ⚠️ Click failed for "${label}" (${sel}): ${clickErr.message}`,
      );
    }
  }

  console.log(`     "${label}" link not found — skipping`);
  return false;
}

/** Scoped nav container in record detail frame (Accela tab/dropdown bar). */
const NAV_SCOPE_SELECTORS = [
  "#ctl00_PlaceHolderMain_TabDataList",
  '[id*="TabDataList"]',
  '[id*="TabContainer"]',
  ".aca_tab_list",
  "ul.aca_tabs",
];

function isBaltimorePortal(page) {
  return !!(page && page._isBaltimore);
}

function isFairfaxPortal(page) {
  return !!(page && page._isFairfax);
}

function isArlingtonPortal(page) {
  return !!(page && page._isArlington);
}

/**
 * True when a downloaded buffer looks like an HTML/ASP.NET error page, not a binary attachment.
 */
function isDownloadBufferLikelyHtmlError(buf) {
  if (!buf || buf.length === 0) return true;
  if (
    buf.length >= 4 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46
  ) {
    return false;
  }
  const head = buf
    .subarray(0, Math.min(600, buf.length))
    .toString("latin1")
    .trimStart();
  if (/^<!DOCTYPE\s+html/i.test(head)) return true;
  if (/^<\s*html[\s>]/i.test(head)) return true;
  if (
    /<head[\s>]/i.test(head) &&
    (/<title>/i.test(head) || /aspx/i.test(head))
  )
    return true;
  const low = head.toLowerCase();
  if (
    low.includes("runtime error") ||
    low.includes("exception details") ||
    low.includes("server error") ||
    low.includes("could not load") ||
    low.includes("session has expired")
  )
    return true;
  return false;
}

/** Log tag for iframe attachment downloads (shared Baltimore + Arlington path). */
function attachmentIframeDownloadLogTag(page) {
  return isArlingtonPortal(page) ? "[Arlington Attach]" : "[Baltimore Attach]";
}

function isFairfaxGarbageRow(row) {
  if (!row || typeof row !== "object") return false;
  const key = String(row.key || "").trim();
  const value = String(row.value || "").trim();
  if (!key || !value) return false;

  if (value === `${key}:`) return true;

  if (value.endsWith(":") && value.length < 40 && key.startsWith(value))
    return true;

  return false;
}

async function extractFairfaxRelatedContacts(page) {
  try {
    const extractionFrame = getExtractionContext(page);

    const contactResult = await extractionFrame.evaluate(() => {
      const results = [];
      const table = document.querySelector(
        "#ctl00_PlaceHolderMain_PermitDetailList1_RelatContactList",
      );
      if (!table)
        return {
          contacts: results,
          error: "RelatContactList table not found",
        };

      const roleHeaders = Array.from(table.querySelectorAll("h2"));

      for (const h2 of roleHeaders) {
        const headerText = (h2.textContent || "").trim();
        const roleName = headerText.replace(/\s+information\s*$/i, "").trim();
        if (!roleName) continue;

        const nextH2 = roleHeaders[roleHeaders.indexOf(h2) + 1] || null;

        const walker = document.createTreeWalker(
          table,
          NodeFilter.SHOW_ELEMENT,
          null,
        );
        let seenThis = false;
        let collectedText = "";
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node === h2) {
            seenThis = true;
            continue;
          }
          if (!seenThis) continue;
          if (nextH2 && node === nextH2) break;
          if (node.children.length === 0) {
            const txt = (node.textContent || "").replace(/\s+/g, " ").trim();
            if (txt) collectedText += " " + txt;
          }
        }
        collectedText = collectedText.replace(/\s+/g, " ").trim();
        if (!collectedText) continue;

        const contact = { role: roleName };

        const partyMatch = collectedText.match(
          /(Organization|Individual)\s+(.+?)\s+(?:United States|Primary Phone:)/,
        );
        if (partyMatch) {
          contact.partyType = partyMatch[1];
          contact.name = partyMatch[2].trim();
        }

        const phoneMatch = collectedText.match(
          /Primary Phone:\s*(\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4})/,
        );
        if (phoneMatch) contact.phone = phoneMatch[1].trim();

        const emailMatch = collectedText.match(
          /Email:\s*([^\s]+@[^\s]+?)(?:\s+(?:Mailing|License|Physical|$)|$)/,
        );
        if (emailMatch) contact.email = emailMatch[1].trim();

        const licenseMatch = collectedText.match(
          /License Number:\s*([^\s]+?)(?:\s+Company:|$)/,
        );
        if (licenseMatch) contact.license = licenseMatch[1].trim();

        const companyMatch = collectedText.match(
          /Company:\s*(.+?)(?:\s+(?:License|Physical|Mailing)|$)/,
        );
        if (companyMatch) contact.company = companyMatch[1].trim();

        if (contact.phone || contact.email) {
          results.push(contact);
        }
      }

      return { contacts: results, error: null };
    });

    if (contactResult.error) {
      console.log(
        `  [Fairfax] Related Contacts re-extract: ${contactResult.error}`,
      );
      return [];
    }
    console.log(
      `  [Fairfax] Related Contacts re-extract: ${contactResult.contacts.length} structured contacts parsed`,
    );
    return contactResult.contacts;
  } catch (err) {
    console.log(`  [Fairfax] Related Contacts re-extract error: ${err.message}`);
    return [];
  }
}

function isMinimalTabsPortal(page) {
  return (
    (page._isBaltimore && BALTIMORE_MINIMAL_PORTAL_TABS) ||
    (page._isFairfax && FAIRFAX_MINIMAL_PORTAL_TABS)
  );
}

/** When Arlington sends `tabs`, run legacy extra panels only for a full preset (matches old default scrape). */
function arlingtonRunsSupplementalAccordionPanels(arlingtonTabSet) {
  if (!(arlingtonTabSet instanceof Set) || arlingtonTabSet.size === 0)
    return true;
  return (
    arlingtonTabSet.has("info") &&
    arlingtonTabSet.has("attachments") &&
    arlingtonTabSet.has("plan_review")
  );
}

/**
 * Project Information–only scrape: splice new PI fields/docs into prior planReview.tabs
 * without replacing Plan Set, Review Results, or Approved Documents.
 * @param {Record<string, unknown>} priorPr
 * @param {Record<string, unknown>} scrapedPr
 * @returns {Record<string, unknown>}
 */
function mergeArlingtonSelectiveProjectInformationPlanReview(
  priorPr,
  scrapedPr,
  permitNumber,
) {
  /** @type {Record<string, unknown>} */
  let merged;
  try {
    merged = structuredCloneWorksSafe(priorPr);
  } catch (_) {
    merged = { ...(priorPr || {}) };
  }
  if (!merged || typeof merged !== "object") {
    merged = { ...(priorPr || {}) };
  }

  const priorTabs =
    merged.tabs && typeof merged.tabs === "object" && !Array.isArray(merged.tabs)
      ? /** @type {Record<string, unknown>} */ (merged.tabs)
      : {};
  const scrapedTabs =
    scrapedPr?.tabs &&
    typeof scrapedPr.tabs === "object" &&
    !Array.isArray(scrapedPr.tabs)
      ? /** @type {Record<string, unknown>} */ (scrapedPr.tabs)
      : null;
  const scrapedPi = scrapedTabs?.projectInformation;
  /** @type {{ label: string; value: string }[]} */
  let scrapedFields = [];
  if (scrapedPi && typeof scrapedPi === "object") {
    scrapedFields = Array.isArray(
      /** @type {Record<string, unknown>} */ (scrapedPi).fields,
    )
      ? /** @type {{ label: string; value: string }[]} */ (
          /** @type {Record<string, unknown>} */ (scrapedPi).fields
        )
      : [];
    const priorPi = priorTabs?.projectInformation;
    const priorFields = Array.isArray(
      /** @type {Record<string, unknown>} */ (priorPi || {})?.fields,
    )
      ? /** @type {{ label: string; value: string }[]} */ (
          /** @type {Record<string, unknown>} */ (priorPi).fields
        )
      : [];

    /** @type {Record<string, unknown>} */
    const nextTabs = { ...priorTabs };
    if (
      arlingtonProjectInformationExtractionIsWeak(scrapedFields, permitNumber)
    ) {
      console.log(
        "[Arlington][ProjectInfo] weak extraction rejected; preserving prior projectInformation",
      );
      if (priorPi && typeof priorPi === "object") {
        nextTabs.projectInformation = structuredCloneWorksSafe(priorPi) ?? priorPi;
      }
    } else {
      nextTabs.projectInformation = {
        ...(priorPi && typeof priorPi === "object" ? priorPi : {}),
        ...(structuredCloneWorksSafe(scrapedPi) ?? scrapedPi),
        fields: scrapedFields.map((f) => ({
          label: `${f.label || ""}`.trim(),
          value: `${f.value ?? ""}`.trim().slice(0, 2000),
        })),
        extractionStatus: "ok",
      };
    }
    merged.tabs = nextTabs;

    const ps =
      nextTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
    const rr = nextTabs?.reviewResultsAndMarkups?.documents;
    const ad = nextTabs?.approvedDocuments?.documents;
    console.log(
      `[Arlington][ProjectInfo] selective projectInformation merge applied preservedPlanSet=${Array.isArray(ps) ? ps.length : 0} preservedReviewResults=${Array.isArray(rr) ? rr.length : 0} preservedApproved=${Array.isArray(ad) ? ad.length : 0}`,
    );
    console.log(
      "[Arlington][ProjectInfo] projectInformation-only update: preserving all out-of-scope tabs",
    );
  }

  merged._arlingtonSelectiveScope = "projectInformation";
  merged._arlingtonSelectiveUpdate = true;
  const finalPiFields =
    merged.tabs &&
    typeof merged.tabs === "object" &&
    /** @type {Record<string, unknown>} */ (merged.tabs).projectInformation &&
    typeof /** @type {Record<string, unknown>} */ (merged.tabs).projectInformation ===
      "object"
      ? /** @type {{ label: string; value: string }[]} */ (
          /** @type {Record<string, unknown>} */ (
            /** @type {Record<string, unknown>} */ (merged.tabs).projectInformation
          ).fields
        )
      : scrapedFields;
  const validPi = !arlingtonProjectInformationExtractionIsWeak(
    Array.isArray(finalPiFields) ? finalPiFields : [],
    permitNumber,
  );
  merged._arlingtonProjectInformationPanelResolved =
    validPi && scrapedPr?._arlingtonProjectInformationPanelResolved === true;
  const getPi = (label) => {
    const f = (Array.isArray(finalPiFields) ? finalPiFields : []).find(
      (row) => `${row.label || ""}`.trim() === label,
    );
    return `${f?.value ?? ""}`.trim();
  };
  console.log(
    `[Arlington][ProjectInfo] final valid=${validPi} Project ID=${getPi("Project ID")} Accela CAP ID=${getPi("Accela CAP ID")} Address=${getPi("Address")} Review Type=${getPi("Review Type")}`,
  );

  if (typeof scrapedPr?.text === "string" && `${scrapedPr.text}`.trim()) {
    merged.text = scrapedPr.text;
  }
  if (scrapedPr?.screenshot != null) {
    merged.screenshot = scrapedPr.screenshot;
  }
  if (typeof scrapedPr?.used === "boolean") {
    merged.used = scrapedPr.used;
  }
  if (typeof scrapedPr?.shouldPersist === "boolean") {
    merged.shouldPersist = scrapedPr.shouldPersist;
  }
  if (scrapedPr?.scrapeStatus != null) {
    merged.scrapeStatus = scrapedPr.scrapeStatus;
  }
  if (scrapedPr?.jurisdiction != null) {
    merged.jurisdiction = scrapedPr.jurisdiction;
  }

  return merged;
}

/** Merge selective Review Results scrape into prior planReview (preserve Plan Set / Approved / Project Info). */
function mergeArlingtonSelectiveReviewResultsPlanReview(priorPr, scrapedPr) {
  /** @type {Record<string, unknown>} */
  let merged;
  try {
    merged = structuredCloneWorksSafe(priorPr);
  } catch (_) {
    merged = { ...(priorPr || {}) };
  }
  if (!merged || typeof merged !== "object") {
    merged = { ...(priorPr || {}) };
  }

  const len = (a) => (Array.isArray(a) ? a.length : 0);

  const priorTabs =
    merged.tabs && typeof merged.tabs === "object" && !Array.isArray(merged.tabs)
      ? /** @type {Record<string, unknown>} */ (merged.tabs)
      : {};
  const scrapedTabs =
    scrapedPr?.tabs &&
    typeof scrapedPr.tabs === "object" &&
    !Array.isArray(scrapedPr.tabs)
      ? /** @type {Record<string, unknown>} */ (scrapedPr.tabs)
      : null;

  const priorPlanSetCount = len(
    priorTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents,
  );
  const scrapedPlanSetCount = len(
    scrapedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents,
  );
  if (scrapedPlanSetCount === 0 && priorPlanSetCount > 0) {
    console.log(
      `[Arlington][PlanReview] selective reviewResults merge: preserving prior Plan Set Documents count=${priorPlanSetCount}`,
    );
  }

  const scrapedRr = scrapedTabs?.reviewResultsAndMarkups;
  if (scrapedRr && typeof scrapedRr === "object") {
    /** @type {Record<string, unknown>} */
    const nextTabs = { ...priorTabs };
    nextTabs.reviewResultsAndMarkups =
      structuredCloneWorksSafe(scrapedRr) ?? scrapedRr;
    merged.tabs = nextTabs;
  }

  if (typeof scrapedPr?.text === "string" && `${scrapedPr.text}`.trim()) {
    merged.text = scrapedPr.text;
  }
  if (scrapedPr?.screenshot != null) {
    merged.screenshot = scrapedPr.screenshot;
  }
  if (typeof scrapedPr?.used === "boolean") {
    merged.used = scrapedPr.used;
  }
  if (typeof scrapedPr?.shouldPersist === "boolean") {
    merged.shouldPersist = scrapedPr.shouldPersist;
  }
  if (scrapedPr?.scrapeStatus != null) {
    merged.scrapeStatus = scrapedPr.scrapeStatus;
  }
  if (scrapedPr?.jurisdiction != null) {
    merged.jurisdiction = scrapedPr.jurisdiction;
  }
  if (
    scrapedPr?.planReviewState &&
    typeof scrapedPr.planReviewState === "object"
  ) {
    merged.planReviewState = scrapedPr.planReviewState;
  }
  if (scrapedPr?._arlingtonSelectiveScope) {
    merged._arlingtonSelectiveScope = scrapedPr._arlingtonSelectiveScope;
    merged._arlingtonSelectiveUpdate =
      scrapedPr._arlingtonSelectiveUpdate === true;
  }
  if (typeof scrapedPr?._arlingtonReviewResultsPanelResolved === "boolean") {
    merged._arlingtonReviewResultsPanelResolved =
      scrapedPr._arlingtonReviewResultsPanelResolved;
  }

  const mergedTabs =
    merged.tabs && typeof merged.tabs === "object"
      ? /** @type {Record<string, unknown>} */ (merged.tabs)
      : {};
  console.log(
    `[Arlington][PlanReview] selective reviewResults merge applied reviewResults=${len(mergedTabs?.reviewResultsAndMarkups?.documents)} preservedPlanSet=${len(mergedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents)} preservedApproved=${len(mergedTabs?.approvedDocuments?.documents)} preservedProjectInfoFields=${len(mergedTabs?.projectInformation?.fields)}`,
  );

  return merged;
}

/**
 * @param {unknown} tabsLike
 * @returns {boolean}
 */
function arlingtonScrapedPlanReviewIsProjectInformationOnlyUpdate(
  tabsLike,
  /** @type {Record<string, unknown> | undefined} */ scrapedRec,
) {
  if (!scrapedRec) return false;
  if (
    scrapedRec._arlingtonSelectiveScope === "projectInformation" &&
    scrapedRec._arlingtonSelectiveUpdate === true
  ) {
    return true;
  }
  if (scrapedRec.shouldPersist !== true) return false;
  const piFields = /** @type {unknown} */ (
    tabsLike?.projectInformation?.fields
  );
  const piDocs = /** @type {unknown} */ (
    tabsLike?.projectInformation?.documents
  );
  const piFieldCount = Array.isArray(piFields) ? piFields.length : 0;
  const piDocCount = Array.isArray(piDocs) ? piDocs.length : 0;
  if (piFieldCount === 0 && piDocCount === 0) return false;
  return !arlingtonIntegratedTabsPlanSetValid(
    /** @type {Record<string, unknown>} */ (tabsLike),
  );
}

/**
 * Detects a successful Review Results-only selective scrape using the explicit
 * markers stamped by extractPlanReviewArlington (preferred), with a fallback to
 * planReviewState flags for older payloads.
 * @param {unknown} tabsLike
 * @param {Record<string, unknown> | undefined} scrapedRec
 * @returns {boolean}
 */
function arlingtonScrapedPlanReviewIsReviewResultsOnlyUpdate(
  tabsLike,
  scrapedRec,
) {
  if (!scrapedRec || scrapedRec.shouldPersist !== true) return false;

  if (
    scrapedRec._arlingtonSelectiveScope === "reviewResults" &&
    scrapedRec._arlingtonSelectiveUpdate === true &&
    scrapedRec._arlingtonReviewResultsPanelResolved === true
  ) {
    return true;
  }

  const st =
    scrapedRec.planReviewState &&
    typeof scrapedRec.planReviewState === "object"
      ? /** @type {Record<string, unknown>} */ (scrapedRec.planReviewState)
      : null;
  if (!st || st.reviewResultsPanelResolved !== true) return false;
  return !arlingtonIntegratedTabsPlanSetValid(
    /** @type {Record<string, unknown>} */ (tabsLike),
  );
}

/** @param {string | null | undefined} scope */
function arlingtonPlanReviewScopeUsesSecondaryShellReadiness(scope) {
  const s = `${scope || ""}`.trim();
  return (
    s === "reviewResults" ||
    s === "approvedDocuments" ||
    s === "projectInformation" ||
    s === "secondary"
  );
}

/**
 * Merge scraped Arlington slices into existing portal_data so partial modes do not wipe
 * tabs that were not part of this run.
 * @param {Record<string, unknown>} previousPortalData
 * @param {Record<string, unknown>} scrapedPortalData
 * @param {Set<string>} arlingtonTabSet
 */
function mergeArlingtonPartialPortalData(
  previousPortalData,
  scrapedPortalData,
  arlingtonTabSet,
) {
  if (!previousPortalData || typeof previousPortalData !== "object") {
    return scrapedPortalData;
  }
  if (
    scrapedPortalData == null ||
    typeof scrapedPortalData !== "object" ||
    !scrapedPortalData.tabs
  ) {
    return scrapedPortalData;
  }
  const prevTabs =
    previousPortalData.tabs &&
    typeof previousPortalData.tabs === "object" &&
    !Array.isArray(previousPortalData.tabs)
      ? { ...previousPortalData.tabs }
      : {};
  const nextTabs = { ...prevTabs };

  /** Never replace accordion panels from a narrowed Arlington run — scraped payload omits those extractions */
  const preserveWholeKeys = [
    "status",
    "reports",
    "inspections",
    "payments",
    "relatedRecords",
  ];
  for (const k of preserveWholeKeys) {
    if (prevTabs[k] != null && prevTabs[k] !== undefined) {
      nextTabs[k] = prevTabs[k];
    }
  }

  if (arlingtonTabSet.has("info")) {
    nextTabs.info = scrapedPortalData.tabs.info ?? prevTabs.info;
  }
  if (arlingtonTabSet.has("attachments")) {
    const scrapedAtt = scrapedPortalData.tabs.attachments;
    const priorAtt = prevTabs.attachments;
    if (priorAtt && scrapedAtt) {
      nextTabs.attachments = arlingtonMergeAttachmentsTabPayload(
        priorAtt,
        scrapedAtt,
      );
    } else if (scrapedAtt) {
      nextTabs.attachments = arlingtonMergeAttachmentsTabPayload(
        null,
        scrapedAtt,
      );
    } else {
      nextTabs.attachments = priorAtt;
    }
  }
  if (arlingtonTabSet.has("plan_review")) {
    const scrapedPr = scrapedPortalData.tabs?.planReview;
    const priorPr = prevTabs.planReview;

    /** @type {Record<string, unknown> | undefined} */
    const scrapedRec =
      scrapedPr && typeof scrapedPr === "object"
        ? /** @type {Record<string, unknown>} */ (scrapedPr)
        : undefined;

    const newExplorerTabs =
      scrapedRec?.tabs ?? scrapedRec?.arlingtonPlanReview?.tabs;
    const mergedEmptyExplore =
      arlingtonIntegratedPlanReviewIsEffectivelyEmpty(newExplorerTabs);

    const explicitFailPersist =
      typeof scrapedRec?.shouldPersist === "boolean" &&
      scrapedRec.shouldPersist === false;

    const preserveWeak =
      scrapedRec?.preservePreviousPlanReview === true && priorPr != null;

    const priorExplorerHasTabs =
      priorPr &&
      typeof priorPr === "object" &&
      /** @type {Record<string, unknown>} */ (priorPr).tabs &&
      typeof /** @type {Record<string, unknown>} */ (priorPr).tabs ===
        "object";

    const priorValidPersist =
      priorPr &&
      priorExplorerHasTabs &&
      arlingtonPortalDataHasValidPlanSet({
        tabs: {
          /** @type {Record<string, unknown>} */
          planReview: /** @type {Record<string, unknown>} */ (priorPr),
        },
      });

    const keepPrior =
      preserveWeak ||
      (!!priorValidPersist &&
        (explicitFailPersist || mergedEmptyExplore === true));

    const scrapedTabsForMerge =
      scrapedRec?.tabs && typeof scrapedRec.tabs === "object"
        ? /** @type {Record<string, unknown>} */ (scrapedRec.tabs)
        : newExplorerTabs && typeof newExplorerTabs === "object"
          ? /** @type {Record<string, unknown>} */ (newExplorerTabs)
          : null;

    const projectInformationOnlyMerge =
      priorPr != null &&
      scrapedPr != null &&
      scrapedTabsForMerge &&
      arlingtonScrapedPlanReviewIsProjectInformationOnlyUpdate(
        scrapedTabsForMerge,
        scrapedRec,
      );

    /** Marked selective RR runs must always merge into prior — never replace it wholesale. */
    const reviewResultsOnlyMerge =
      priorPr != null &&
      scrapedPr != null &&
      scrapedTabsForMerge &&
      arlingtonScrapedPlanReviewIsReviewResultsOnlyUpdate(
        scrapedTabsForMerge,
        scrapedRec,
      );

    if (projectInformationOnlyMerge) {
      nextTabs.planReview = mergeArlingtonSelectiveProjectInformationPlanReview(
        /** @type {Record<string, unknown>} */ (priorPr),
        /** @type {Record<string, unknown>} */ (scrapedPr),
        `${scrapedPortalData?.projectNum || scrapedPortalData?.name || ""}`.trim(),
      );
      console.log(
        "[Arlington][PlanReview] merged selective Project Information into existing planReview (preserved Plan Set / Review Results / Approved Documents)",
      );
    } else if (reviewResultsOnlyMerge) {
      nextTabs.planReview = mergeArlingtonSelectiveReviewResultsPlanReview(
        /** @type {Record<string, unknown>} */ (priorPr),
        /** @type {Record<string, unknown>} */ (scrapedPr),
      );
      console.log(
        "[Arlington][PlanReview] merged selective Review Results into existing planReview (preserved Plan Set / Approved Documents / Project Information)",
      );
    } else if (keepPrior && priorPr != null) {
      console.log(
        "[Arlington][PlanReview] ERMS unavailable; preserving existing Plan Review data",
      );
      if (explicitFailPersist) {
        console.log(
          "[Arlington][PlanReview] not overwriting existing planReview because shouldPersist=false",
        );
      } else if (mergedEmptyExplore && priorValidPersist) {
        console.log(
          "[Arlington][PlanReview] not overwriting existing planReview because scraped integrated tabs were empty",
        );
      }
      nextTabs.planReview = priorPr;
    } else {
      nextTabs.planReview = arlingtonMergePlanReviewTabPayload(
        priorPr,
        scrapedPr,
        `${scrapedPortalData?.projectNum || scrapedPortalData?.name || ""}`.trim(),
      );
    }
  }

  const out = {
    ...previousPortalData,
    portalType:
      scrapedPortalData.portalType || previousPortalData.portalType || "accela",
    schemaVersion: Math.max(
      Number(previousPortalData.schemaVersion) || 0,
      Number(scrapedPortalData.schemaVersion) || 0,
    ),
    tabs: nextTabs,
  };

  if (arlingtonTabSet.has("info")) {
    out.name = scrapedPortalData.name ?? previousPortalData.name;
    out.projectNum = scrapedPortalData.projectNum ?? previousPortalData.projectNum;
    out.description =
      scrapedPortalData.description ?? previousPortalData.description;
    out.dashboardStatus =
      scrapedPortalData.dashboardStatus ?? previousPortalData.dashboardStatus;
    out.location = scrapedPortalData.location ?? previousPortalData.location;
  } else {
    out.name = previousPortalData.name ?? scrapedPortalData.name;
    out.projectNum = previousPortalData.projectNum ?? scrapedPortalData.projectNum;
    out.description =
      previousPortalData.description ?? scrapedPortalData.description;
    out.dashboardStatus =
      previousPortalData.dashboardStatus ?? scrapedPortalData.dashboardStatus;
    out.location =
      previousPortalData.location ?? scrapedPortalData.location;
  }

  if (
    scrapedPortalData.planReviewLastError &&
    typeof scrapedPortalData.planReviewLastError === "object"
  ) {
    out.planReviewLastError = scrapedPortalData.planReviewLastError;
  }

  return out;
}

/** ── Arlington portal_data persistence: slim Plan Review tab to avoid Postgres/Supabase timeouts. ── */

const PLAN_REVIEW_COMMENT_MAX = 4000;
const PLAN_REVIEW_TOPIC_TEXT_MAX = 32000;
const PLAN_REVIEW_SCREENSHOT_STRING_MAX_CHARS = 24000;
const PLAN_REVIEW_DOWNLOAD_LINKS_MAX_ROWS = 80;
const PLAN_REVIEW_LARGE_PAYLOAD_FALLBACK_BYTES = 900000;

/** Arlington-only: allow long Plan Review downloads (secondaries + large PDFs). */
const ARLINGTON_PLAN_REVIEW_GLOBAL_TIMEOUT_MS = 20 * 60 * 1000;
/** ERMS `/PlanReviewIntegrated/Plan/DocumentStream` fetch + body read cap. */
const ERMS_DOCUMENT_STREAM_TIMEOUT_MS = 120000;
const ARLINGTON_PLAN_REVIEW_RESUME_RESERVE_FINAL_SAVE_MS = 120000;
/** Per-run download batch caps (download manager wrapper). */
const ARLINGTON_PLAN_REVIEW_MAX_TOTAL_DOWNLOADS_PER_RUN = 15;
const ARLINGTON_PLAN_REVIEW_MAX_PLAN_SET_DOWNLOADS_PER_RUN = 10;
const ARLINGTON_PLAN_REVIEW_MAX_SECONDARY_DOWNLOADS_PER_RUN = 10;
const ARLINGTON_PLAN_REVIEW_MAX_STREAM_TIMEOUTS_PER_RUN = 2;
const ARLINGTON_PLAN_REVIEW_MAX_HARD_DOWNLOAD_FAILURES_PER_RUN = 5;
const ARLINGTON_PLAN_REVIEW_MIN_REMAINING_BUDGET_MS = 120000;
/** Continue-download endpoint batch caps (slightly higher than normal scrape). */
const ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_TOTAL_DOWNLOADS_PER_RUN = 20;
const ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_PLAN_SET_DOWNLOADS_PER_RUN = 15;
const ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_SECONDARY_DOWNLOADS_PER_RUN = 10;
const ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_STREAM_TIMEOUTS_PER_RUN = 2;
const ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_HARD_DOWNLOAD_FAILURES_PER_RUN = 5;
const ARLINGTON_PLAN_REVIEW_CONTINUE_MIN_REMAINING_BUDGET_MS = 120000;
const ARLINGTON_PLAN_REVIEW_CONTINUE_WALL_MS = 18 * 60 * 1000;

/** Arlington Attachments: timeout-safe batch download lifecycle (mirrors Plan Review). */
const ARLINGTON_ATTACHMENTS_GLOBAL_TIMEOUT_MS = 20 * 60 * 1000;
const ARLINGTON_ATTACHMENTS_MAX_DOWNLOADS_PER_RUN = 15;
const ARLINGTON_ATTACHMENTS_CONTINUE_MAX_DOWNLOADS_PER_RUN = 20;
const ARLINGTON_ATTACHMENTS_MIN_REMAINING_BUDGET_MS = 120000;
const ARLINGTON_ATTACHMENTS_CONTINUE_WALL_MS = 18 * 60 * 1000;
const ARLINGTON_ATTACHMENTS_CHECKPOINT_EVERY_N = 5;
const ARLINGTON_ATTACHMENTS_RESUME_RESERVE_FINAL_SAVE_MS = 120000;

/** ERMS href fallbacks for secondary download-phase tab activation. */
const ARLINGTON_SECONDARY_TAB_DOWNLOAD_HINTS = {
  reviewResultsAndMarkups: {
    panelHref: "/PlanReviewIntegrated/Plan/ReviewDocuments",
    markerRxSource:
      "Comment Letters & Plan Mark-ups|Review Status|Plan Mark-ups|Review Results Letter",
  },
  approvedDocuments: {
    panelHref: "/PlanReviewIntegrated/Plan/ApprovedDocuments",
    markerRxSource: "File Actions|Document Date|Approved Plan Set|Review Results Letter",
  },
};

/** Bucket upload limit aligned with typical Supabase storage policy (avoid silent failures). */
const SUPABASE_STORAGE_OBJECT_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Resolved max upload size (bytes). Override with env `SUPABASE_STORAGE_OBJECT_MAX_BYTES`
 * after raising the Supabase bucket / global limit.
 * @returns {number}
 */
function getSupabaseStorageObjectMaxBytes() {
  const raw = process.env.SUPABASE_STORAGE_OBJECT_MAX_BYTES;
  if (raw != null && `${raw}`.trim() !== "") {
    const n = Number.parseInt(`${raw}`.replace(/_/g, "").trim(), 10);
    if (Number.isFinite(n) && n > 1024) return n;
  }
  return SUPABASE_STORAGE_OBJECT_MAX_BYTES;
}

/** @returns {boolean} */
function arlingtonEnvForceRetryOversizedPlanReviewDownloads() {
  const v =
    `${process.env.ARLINGTON_FORCE_RETRY_OVERSIZED_PLAN_REVIEW_DOWNLOADS || ""}`
      .trim()
      .toLowerCase();
  return v === "true" || v === "1";
}

/** @returns {number} */
function portalDataUtf8ByteLength(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? null), "utf8");
  } catch (_) {
    return 0;
  }
}

/** @returns {unknown} */
function compactPlanReviewCommentForDb(rawComment) {
  if (!rawComment || typeof rawComment !== "object") return rawComment;
  const c = /** @type {Record<string, unknown>} */ (rawComment);
  /** @type {Record<string, unknown>} */
  const raw =
    c.raw && typeof c.raw === "object"
      ? /** @type {Record<string, unknown>} */ (c.raw)
      : {};
  const reviewer =
    `${c.reviewer ?? raw.Reviewer ?? raw.reviewer ?? raw.reviewerName ?? raw.CreatedBy ?? raw.createdBy ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
  const out = {
    commentId: `${raw.CommentId ?? raw.commentId ?? raw.Id ?? raw.id ?? ""}`.slice(
      0,
      120,
    ),
    reviewGroup: `${raw.ReviewGroup ?? raw.reviewGroup ?? ""}`.slice(0, 200),
    reviewerName: reviewer.slice(0, 200),
    sheet: `${raw.Sheet ?? raw.sheet ?? ""}`.slice(0, 200),
    status: `${raw.Status ?? raw.status ?? ""}`.slice(0, 200),
    comment: `${c.text ?? raw.CommentText ?? raw.commentText ?? raw.Text ?? raw.text ?? ""}`
      .replace(/\s+/g, " ")
      .slice(0, PLAN_REVIEW_COMMENT_MAX),
  };
  return out;
}

const PLAN_REVIEW_DOC_DB_FIELDS = [
  "name",
  "filename",
  "documentType",
  "documentDate",
  "discipline",
  "sheetType",
  "revision",
  "status",
  "downloadStatus",
  "publicUrl",
  "downloadUrl",
  "storagePath",
  "sourceTab",
  "sourceSection",
  "sourceApi",
  "secondaryCrmDocHandle",
  "retryCount",
  "skipReason",
  "fileSizeBytes",
  "secondaryDomRowIndex",
  "downloaded",
  "saved",
];

/** @returns {Record<string, unknown>} */
function sanitizePlanReviewDocumentRowForDb(rawDoc) {
  if (!rawDoc || typeof rawDoc !== "object") return {};
  const d = /** @type {Record<string, unknown>} */ (rawDoc);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of PLAN_REVIEW_DOC_DB_FIELDS) {
    if (d[k] === undefined || d[k] === null) continue;
    if (typeof d[k] === "string" && !String(d[k]).trim()) continue;
    out[k] = d[k];
  }
  if (d.documentId != null && `${d.documentId}`.trim()) {
    out.documentId = d.documentId;
  }
  if (d.action && typeof d.action === "object") {
    const docIdInner = /** @type {Record<string, unknown>} */ (d.action)
      .documentId;
    if (docIdInner != null && `${docIdInner}`.trim())
      out.action = { documentId: docIdInner };
  }
  return out;
}

function sanitizeDocsArrayDocsOnly(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map((row) =>
    sanitizePlanReviewDocumentRowForDb(arlingtonNormalizePlanReviewDocRow(row)),
  );
}

/** Clone via JSON — drops functions/undefined (acceptable for portal_data blobs). */
function structuredCloneWorksSafe(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_) {
    return typeof obj === "object" && obj !== null
      ? { .../** @type {Record<string, unknown>} */ (obj) }
      : obj;
  }
}

function truncateMiddleIndicator(str, max) {
  if (typeof str !== "string") return str;
  if (str.length <= max) return str;
  return `${str.slice(0, Math.floor(max * 0.55))}\n…truncated ${str.length - max} chars…\n${str.slice(-Math.floor(max * 0.35))}`;
}

/** Recursive slim of `tabs.planReview.tabs` Arlington integrated shape. */
function sanitizeArlingtonIntegratedPlanReviewTabsObject(tabs) {
  if (!tabs || typeof tabs !== "object" || Array.isArray(tabs)) return tabs;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [tabKey, rawBucket] of Object.entries(tabs)) {
    if (!rawBucket || typeof rawBucket !== "object" || Array.isArray(rawBucket)) {
      out[tabKey] = rawBucket;
      continue;
    }
    /** @type {Record<string, unknown>} */
    const bucket = /** @type {Record<string, unknown>} */ (
      structuredCloneWorksSafe(rawBucket)
    );
    if (Array.isArray(bucket.documents))
      bucket.documents = sanitizeDocsArrayDocsOnly(bucket.documents);
    if (Array.isArray(bucket.comments))
      bucket.comments = bucket.comments.map(compactPlanReviewCommentForDb);
    if (bucket.sections && typeof bucket.sections === "object") {
      /** @type {Record<string, unknown>} */
      const secOut = {};
      for (const [sk, sv] of Object.entries(
        /** @type {Record<string, unknown>} */ (bucket.sections),
      )) {
        if (!sv || typeof sv !== "object" || Array.isArray(sv)) {
          secOut[sk] = sv;
          continue;
        }
        const section = /** @type {Record<string, unknown>} */ (
          structuredCloneWorksSafe(sv)
        );
        if (Array.isArray(section.documents)) {
          if (tabKey === "plansAndDocuments" && sk === "planSetDocuments") {
            arlingtonFinalizePlanSetDocumentsSink(section.documents, true);
          }
          section.documents = sanitizeDocsArrayDocsOnly(section.documents);
        }
        delete section.raw;
        delete section.rawPayload;
        secOut[sk] = section;
      }
      bucket.sections = secOut;
    }
    if (Array.isArray(bucket.fields)) {
      bucket.fields = bucket.fields.map((field) =>
        field && typeof field === "object"
          ? {
              label: String(field.label ?? "")
                .replace(/\s+/g, " ")
                .slice(0, 260),
              value: String(field.value ?? "")
                .replace(/\s+/g, " ")
                .slice(0, 2000),
            }
          : field,
      );
    }
    if (Array.isArray(bucket.requiredDocumentTypes)) {
      bucket.requiredDocumentTypes = bucket.requiredDocumentTypes.map(
        (req) =>
          req && typeof req === "object"
            ? {
                label: String(req.label ?? req.name ?? "").slice(0, 260),
                value:
                  `${req.description ?? req.value ?? ""}`.slice(0, 800) ||
                  undefined,
              }
            : req,
      );
    }
    delete bucket.downloadCandidates;
    delete bucket.tables;
    delete bucket.links;
    delete bucket.textPreview;
    delete bucket.text;
    delete bucket.data;
    delete bucket.rawPayload;
    delete bucket.raw;
    out[tabKey] = bucket;
  }
  return out;
}

function sanitizePlanReviewDownloadLinksForDb(links) {
  if (!Array.isArray(links)) return links;
  return links.slice(0, PLAN_REVIEW_DOWNLOAD_LINKS_MAX_ROWS).map((row) => {
    if (!row || typeof row !== "object") return row;
    const r = /** @type {Record<string, unknown>} */ (row);
    return {
      text: `${r.text ?? r.label ?? ""}`.replace(/\s+/g, " ").slice(0, 400),
      href: `${r.href ?? r.url ?? ""}`.slice(0, 2000),
    };
  });
}

/** Stable row key for Arlington Plan Review resume across runs. */
function arlingtonPlanReviewDocStableKey(doc) {
  if (!doc || typeof doc !== "object") return "";
  const d = /** @type {Record<string, unknown>} */ (doc);
  const sourceTab = `${d.sourceTab || ""}`.trim();
  let id = `${d.documentId ?? ""}`.trim();
  if (!id && d.action && typeof d.action === "object") {
    id = `${
      /** @type {Record<string, unknown>} */ (d.action).documentId ?? ""
    }`.trim();
  }
  const normalizedName = `${d.name || d.filename || ""}`
    .trim()
    .replace(/\s+/g, " ");
  const documentDate = `${d.documentDate || ""}`.trim();
  const rowIx =
    d.secondaryDomRowIndex != null && `${d.secondaryDomRowIndex}`.trim() !== ""
      ? `|r${String(d.secondaryDomRowIndex)}`
      : "";
  if (id) return `${sourceTab}|${id}|${documentDate}`;
  return `${sourceTab}|${normalizedName}|${documentDate}${rowIx}`;
}

/** @returns {Map<string, { publicUrl?: string; downloadUrl?: string; storagePath?: string; downloadStatus?: string }>} */
function arlingtonPriorPlanReviewDocUploadedByStableKey(portalPayload) {
  /** @type {Map<string, { publicUrl?: string; downloadUrl?: string; storagePath?: string; downloadStatus?: string }>} */
  const map = new Map();
  const pr = portalPayload?.tabs?.planReview;
  const buckets =
    pr && typeof pr === "object" && typeof pr.tabs === "object" && !Array.isArray(pr.tabs)
      ? pr.tabs
      : null;
  if (!buckets || typeof buckets !== "object") return map;

  const seen = /** @type {unknown[]} */ ([]);
  /** @param {unknown[]} docs */
  const walk = (docs) => {
    if (!Array.isArray(docs)) return;
    for (const row of docs) {
      seen.push(row);
    }
  };
  /** @type {Record<string, unknown>} */
  const b = buckets;
  const pad = /** @type {unknown} */ (b.plansAndDocuments);
  const padDoc =
    pad && typeof pad === "object" && !Array.isArray(pad) && pad !== null
      ? /** @type {Record<string, unknown>} */ (pad)
      : null;
  if (padDoc) {
    if (Array.isArray(padDoc.documents)) walk(padDoc.documents);
    const sections = padDoc.sections;
    if (sections && typeof sections === "object" && !Array.isArray(sections)) {
      for (const sk of Object.keys(sections)) {
        const sec = /** @type {Record<string, unknown>} */ (sections)[sk];
        if (
          sec &&
          typeof sec === "object" &&
          !Array.isArray(sec) &&
          Array.isArray(sec.documents)
        )
          walk(sec.documents);
      }
    }
  }
  const rrB = /** @type {unknown} */ (b.reviewResultsAndMarkups);
  const rrO =
    rrB && typeof rrB === "object" && !Array.isArray(rrB)
      ? /** @type {Record<string, unknown>} */ (rrB)
      : null;
  if (rrO && Array.isArray(rrO.documents)) walk(rrO.documents);
  const apB = /** @type {unknown} */ (b.approvedDocuments);
  const apO =
    apB && typeof apB === "object" && !Array.isArray(apB)
      ? /** @type {Record<string, unknown>} */ (apB)
      : null;
  if (apO && Array.isArray(apO.documents)) walk(apO.documents);
  const piB = /** @type {unknown} */ (b.projectInformation);
  const piO =
    piB && typeof piB === "object" && !Array.isArray(piB)
      ? /** @type {Record<string, unknown>} */ (piB)
      : null;
  if (piO && Array.isArray(piO.documents)) walk(piO.documents);

  for (const row of seen) {
    if (!row || typeof row !== "object") continue;
    const d = /** @type {Record<string, unknown>} */ (row);
    const pu = /^https?:\/\//i.test(`${d.publicUrl || ""}`)
      ? String(d.publicUrl)
      : "";
    const du = /^https?:\/\//i.test(`${d.downloadUrl || ""}`)
      ? String(d.downloadUrl)
      : "";
    const sp = `${d.storagePath || ""}`.trim();
    const ds = `${d.downloadStatus || ""}`.trim();

    const sk = arlingtonPlanReviewDocStableKey(d);
    if (!sk) continue;

    if (ds === "oversized_for_supabase") {
      map.set(sk, {
        downloadStatus: "oversized_for_supabase",
        fileSizeBytes: Number(d.fileSizeBytes) || 0,
        skipReason:
          `${d.skipReason || ""}`.trim() || "supabase_object_size_limit",
      });
      continue;
    }

    if ((!pu && !du && !sp) || !(ds === "uploaded" || ds.startsWith("aliased")))
      continue;
    if (!map.has(sk))
      map.set(sk, {
        publicUrl: pu || undefined,
        downloadUrl: du || undefined,
        storagePath: sp || undefined,
        downloadStatus: ds || undefined,
      });
  }
  return map;
}

/**
 * Restore upload fields from prior `portal_data` so we skip already-stored blobs.
 * @param {{ forceRetryOversized?: boolean; configuredMaxUploadBytes?: number }} [resumeOpts]
 * @returns {{ alreadyDownloaded: number; pending: number }}
 */
function arlingtonResumePlanReviewDownloadsFromPrior(
  integratedTabs,
  priorPortalData,
  logResume = false,
  resumeOpts,
  scopeRaw,
) {
  const forceRetry =
    resumeOpts && resumeOpts.forceRetryOversized === true;
  const configuredMaxUploadBytes =
    typeof resumeOpts?.configuredMaxUploadBytes === "number" &&
    Number.isFinite(resumeOpts.configuredMaxUploadBytes)
      ? resumeOpts.configuredMaxUploadBytes
      : getSupabaseStorageObjectMaxBytes();

  const priorMap = priorPortalData
    ? arlingtonPriorPlanReviewDocUploadedByStableKey({
        tabs: { planReview: priorPortalData?.tabs?.planReview },
      })
    : new Map();

  /** @param {unknown[]} docs */
  const applyDocs = (docs) => {
    let ad = 0;
    let pen = 0;
    if (!Array.isArray(docs)) return { ad: 0, pen: 0 };
    for (const row of docs) {
      if (!row || typeof row !== "object") continue;
      const d = /** @type {Record<string, unknown>} */ (row);
      const pu = /^https?:\/\//i.test(`${d.publicUrl || ""}`)
        ? String(d.publicUrl)
        : "";
      const du = /^https?:\/\//i.test(`${d.downloadUrl || ""}`)
        ? String(d.downloadUrl)
        : "";
      const sp = `${d.storagePath || ""}`.trim();
      const skResume = arlingtonPlanReviewDocStableKey(d);
      const prevResume = skResume ? priorMap.get(skResume) : null;
      const dsRow = `${d.downloadStatus || ""}`.trim();
      const skipReasonEff = `${d.skipReason || prevResume?.skipReason || ""}`.trim();
      let fileSizeBytes =
        Number(d.fileSizeBytes) || Number(prevResume?.fileSizeBytes) || 0;
      if (fileSizeBytes && !d.fileSizeBytes) d.fileSizeBytes = fileSizeBytes;

      const priorOversized =
        prevResume?.downloadStatus === "oversized_for_supabase";
      const rowOversized = dsRow === "oversized_for_supabase";
      const limitSkip =
        !skipReasonEff || skipReasonEff === "supabase_object_size_limit";
      const isOversizedState = rowOversized || priorOversized;
      const canRetryOversized =
        isOversizedState &&
        limitSkip &&
        (forceRetry ||
          (fileSizeBytes > 0 &&
            configuredMaxUploadBytes > fileSizeBytes));

      if (canRetryOversized) {
        const nameGuess =
          `${d.name || d.filename || ""}`.trim() || "(unnamed)";
        console.log(
          `[Arlington][PlanReview] retrying previously oversized file after storage limit increase name=${nameGuess} bytes=${fileSizeBytes}`,
        );
        d.status = "pending";
        d.downloadStatus = "pending_retry_after_storage_limit_increase";
        d.skipReason = "";
        delete d.failureReason;
        if (fileSizeBytes) d.fileSizeBytes = fileSizeBytes;
        pen++;
        continue;
      }

      if (prevResume && prevResume.downloadStatus === "oversized_for_supabase") {
        d.downloadStatus = "oversized_for_supabase";
        d.status = "pending";
        if (prevResume.fileSizeBytes)
          d.fileSizeBytes = prevResume.fileSizeBytes;
        d.skipReason =
          `${prevResume.skipReason || ""}`.trim() ||
          "supabase_object_size_limit";
        continue;
      }
      if (dsRow === "oversized_for_supabase") {
        continue;
      }
      if (pu || du || sp) {
        ad++;
        continue;
      }
      const prev = priorMap.get(skResume);
      if (prev && (prev.publicUrl || prev.downloadUrl || prev.storagePath)) {
        if (prev.publicUrl) {
          d.publicUrl = prev.publicUrl;
          d.downloadUrl = prev.publicUrl;
        }
        if (prev.downloadUrl) d.downloadUrl = prev.downloadUrl;
        if (prev.storagePath) d.storagePath = prev.storagePath;
        if (prev.downloadStatus)
          d.downloadStatus = prev.downloadStatus;
        d.status = "downloaded";
        ad++;
      } else pen++;
    }
    return { ad, pen };
  };

  let alreadyDownloaded = 0;
  let pending = 0;
  const bucketLists = scopeRaw
    ? arlingtonPlanReviewScopedDocBucketLists(integratedTabs, scopeRaw)
    : [
        integratedTabs?.plansAndDocuments?.sections?.planSetDocuments
          ?.documents,
        integratedTabs?.reviewResultsAndMarkups?.documents,
        integratedTabs?.approvedDocuments?.documents,
        integratedTabs?.projectInformation?.documents,
        integratedTabs?.plansAndDocuments?.documents,
      ].filter((x) => Array.isArray(x) && x.length);
  for (const docs of bucketLists) {
    const agg = applyDocs(/** @type {unknown[]} */ (docs));
    alreadyDownloaded += agg.ad;
    pending += agg.pen;
  }
  if (logResume && (alreadyDownloaded > 0 || pending > 0)) {
    const scopeNote = scopeRaw ? ` scope=${scopeRaw}` : "";
    console.log(
      `[Arlington][PlanReview] resume: alreadyDownloaded=${alreadyDownloaded} pending=${pending}${scopeNote}`,
    );
  }
  return { alreadyDownloaded, pending };
}

/** @returns {boolean} */
function arlingtonErmsSinkDocLooksUploadComplete(doc) {
  if (!doc || typeof doc !== "object") return false;
  const d = /** @type {Record<string, unknown>} */ (doc);
  const pu = /^https?:\/\//i.test(`${d.publicUrl || ""}`)
    ? String(d.publicUrl)
    : "";
  const du = /^https?:\/\//i.test(`${d.downloadUrl || ""}`)
    ? String(d.downloadUrl)
    : "";
  const sp = `${d.storagePath || ""}`.trim();
  const ds = `${d.downloadStatus || ""}`.trim();
  if (ds === "pending_retry_after_storage_limit_increase") return false;
  if (pu || du || sp) return true;
  return (
    ds === "uploaded" ||
    ds === "aliased_duplicate" ||
    ds === "aliased_attachment" ||
    ds === "aliased_plan_set" ||
    ds === "oversized_for_supabase"
  );
}

/** Row still needs a download attempt (includes metadata_only rows with ERMS ids). */
function arlingtonPlanReviewDocNeedsDownloadAttempt(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (arlingtonPlanReviewDocLooksDownloadComplete(doc)) return false;
  const d = /** @type {Record<string, unknown>} */ (doc);
  const ds = `${d.downloadStatus || ""}`.trim();
  if (
    ds === "failed_non_retryable" ||
    ds === "duplicate_skipped" ||
    ds === "already_downloaded" ||
    ds === "stale_removed"
  ) {
    return false;
  }
  if (ds === "oversized_for_supabase") return false;
  if (arlingtonPlanSetDocIsDeleteOnlyInactive(doc)) return false;
  return true;
}

/**
 * Document arrays included for a scrape/continue scope.
 * @param {Record<string, unknown>} integratedTabs
 * @param {string} [scopeRaw]
 * @returns {unknown[][]}
 */
function arlingtonPlanReviewScopedDocBucketLists(integratedTabs, scopeRaw) {
  const scope = scopeRaw
    ? arlingtonNormalizePlanReviewActionScope(scopeRaw)
    : "allPending";
  /** @type {unknown[][]} */
  const out = [];
  if (arlingtonPlanReviewScopeAllowsPlanSet(scope)) {
    const ps =
      integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
    if (Array.isArray(ps) && ps.length) out.push(ps);
    const flat = integratedTabs?.plansAndDocuments?.documents;
    if (Array.isArray(flat) && flat.length) out.push(flat);
  }
  if (arlingtonPlanReviewScopeAllowsSecondaryTab(scope, "reviewResultsAndMarkups")) {
    const rr = integratedTabs?.reviewResultsAndMarkups?.documents;
    if (Array.isArray(rr) && rr.length) out.push(rr);
  }
  if (arlingtonPlanReviewScopeAllowsSecondaryTab(scope, "approvedDocuments")) {
    const ad = integratedTabs?.approvedDocuments?.documents;
    if (Array.isArray(ad) && ad.length) out.push(ad);
  }
  if (arlingtonPlanReviewScopeAllowsSecondaryTab(scope, "projectInformation")) {
    const pi = integratedTabs?.projectInformation?.documents;
    if (Array.isArray(pi) && pi.length) out.push(pi);
  }
  return out;
}

function arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(
  integratedTabs,
  scopeRaw,
) {
  let incomplete = 0;
  const buckets = scopeRaw
    ? arlingtonPlanReviewScopedDocBucketLists(integratedTabs, scopeRaw)
    : [
        integratedTabs?.plansAndDocuments?.sections?.planSetDocuments
          ?.documents,
        integratedTabs?.plansAndDocuments?.documents,
        integratedTabs?.reviewResultsAndMarkups?.documents,
        integratedTabs?.approvedDocuments?.documents,
        integratedTabs?.projectInformation?.documents,
      ].filter((x) => Array.isArray(x) && x.length);
  for (const docs of buckets) {
    for (const doc of /** @type {unknown[]} */ (docs)) {
      if (arlingtonPlanReviewDocNeedsDownloadAttempt(doc)) incomplete++;
    }
  }
  return incomplete;
}

function arlingtonCountPlanReviewUploadedDocsAcrossIntegratedTabs(integratedTabs) {
  let n = 0;
  /** @param {unknown[]} docs */
  const walk = (docs) => {
    if (!Array.isArray(docs)) return;
    for (const doc of docs) {
      if (arlingtonPlanReviewDocLooksDownloadComplete(doc)) n++;
    }
  };
  const ps = integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  walk(Array.isArray(ps) ? ps : []);
  walk(
    Array.isArray(integratedTabs?.plansAndDocuments?.documents)
      ? integratedTabs.plansAndDocuments.documents
      : [],
  );
  walk(Array.isArray(integratedTabs?.reviewResultsAndMarkups?.documents) ? integratedTabs.reviewResultsAndMarkups.documents : []);
  walk(Array.isArray(integratedTabs?.approvedDocuments?.documents) ? integratedTabs.approvedDocuments.documents : []);
  walk(Array.isArray(integratedTabs?.projectInformation?.documents) ? integratedTabs.projectInformation.documents : []);
  return n;
}

/**
 * Near-global scrape deadline: pause remaining unfinished PDF fetches gracefully.
 */
function markArlingtonPlanReviewPendingTimeoutResumeIntegrated(integratedTabs) {
  /** @param {unknown[]} docs */
  const apply = (docs) => {
    if (!Array.isArray(docs)) return;
    for (const doc of docs) {
      if (!doc || typeof doc !== "object") continue;
      const d = /** @type {Record<string, unknown>} */ (doc);
      const ds = `${d.downloadStatus || ""}`.trim();
      if (
        ds === "metadata_only" ||
        ds === "pending_stream_timeout" ||
        d.status === "api_metadata"
      )
        continue;
      if (arlingtonErmsSinkDocLooksUploadComplete(d)) continue;
      d.downloadStatus = "pending_timeout_resume";
      d.status = "pending";
      d.skipReason = "will_resume_next_run";
    }
  };
  const ps = integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  apply(Array.isArray(ps) ? ps : []);
  apply(
    Array.isArray(integratedTabs?.plansAndDocuments?.documents)
      ? integratedTabs.plansAndDocuments.documents
      : [],
  );
  apply(Array.isArray(integratedTabs?.reviewResultsAndMarkups?.documents) ? integratedTabs.reviewResultsAndMarkups.documents : []);
  apply(Array.isArray(integratedTabs?.approvedDocuments?.documents) ? integratedTabs.approvedDocuments.documents : []);
  apply(Array.isArray(integratedTabs?.projectInformation?.documents) ? integratedTabs.projectInformation.documents : []);
}

/**
 * Persist `tabs.planReview` mid-scrape (Supabase) without touching other portal tabs.
 */
/**
 * Selective-scope checkpoint guard: copy prior out-of-scope integrated tab buckets
 * into the checkpoint slice so a reviewResults/approvedDocuments/projectInformation
 * scoped run never wipes Plan Set (or other untouched tabs) in the DB mid-run.
 * Mutates `sliceTabs` in place.
 * @param {Record<string, unknown>} sliceTabs — checkpoint integratedTabs clone
 * @param {Record<string, unknown>} priorPrTabs — prior portal_data.tabs.planReview.tabs
 * @param {string} selectiveScope
 */
function arlingtonPreserveOutOfScopePlanReviewTabsInSlice(
  sliceTabs,
  priorPrTabs,
  selectiveScope,
) {
  if (
    !sliceTabs ||
    typeof sliceTabs !== "object" ||
    !priorPrTabs ||
    typeof priorPrTabs !== "object"
  ) {
    return;
  }
  const scope = `${selectiveScope || ""}`.trim();
  if (!arlingtonPlanReviewScopeUsesSecondaryShellReadiness(scope)) return;

  const len = (a) => (Array.isArray(a) ? a.length : 0);

  const slicePlanSetCount = len(
    sliceTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents,
  );
  const priorPlanSetCount = len(
    priorPrTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents,
  );
  if (
    !arlingtonPlanReviewScopeAllowsPlanSet(scope) &&
    slicePlanSetCount === 0 &&
    priorPlanSetCount > 0 &&
    priorPrTabs.plansAndDocuments
  ) {
    sliceTabs.plansAndDocuments =
      structuredCloneWorksSafe(priorPrTabs.plansAndDocuments) ??
      priorPrTabs.plansAndDocuments;
    console.log(
      `[Arlington][PlanReview] selective ${scope} merge: preserving prior Plan Set Documents count=${priorPlanSetCount}`,
    );
  }

  const secondaryBuckets = [
    ["reviewResultsAndMarkups", "reviewResultsAndMarkups"],
    ["approvedDocuments", "approvedDocuments"],
    ["projectInformation", "projectInformation"],
  ];
  for (const [bucketKey, tabKey] of secondaryBuckets) {
    if (arlingtonPlanReviewScopeAllowsSecondaryTab(scope, tabKey)) continue;
    const prior = priorPrTabs[bucketKey];
    if (!prior || typeof prior !== "object") continue;
    const sliceDocs = len(sliceTabs?.[bucketKey]?.documents);
    const sliceFields =
      bucketKey === "projectInformation"
        ? len(sliceTabs?.[bucketKey]?.fields)
        : 0;
    const priorDocs = len(prior.documents);
    const priorFields =
      bucketKey === "projectInformation" ? len(prior.fields) : 0;
    if (sliceDocs === 0 && sliceFields === 0 && (priorDocs > 0 || priorFields > 0)) {
      sliceTabs[bucketKey] =
        structuredCloneWorksSafe(prior) ?? prior;
    }
  }
}

async function persistArlingtonPlanReviewCheckpoint({
  supabase,
  userId,
  supabaseProjectId,
  permitNumber,
  hashPortalData,
  planReviewTabPayload,
  selectiveScope,
}) {
  if (
    !supabase ||
    !userId ||
    typeof hashPortalData !== "function" ||
    !planReviewTabPayload ||
    typeof planReviewTabPayload !== "object"
  ) {
    return false;
  }

  const selectFields = "id, portal_data_hash, portal_data, permit_number, user_id";
  /** @type {{ id: string; portal_data?: Record<string, unknown>; portal_data_hash?: string; permit_number?: string; user_id?: string } | null} */
  let existingRow = null;
  if (supabaseProjectId) {
    const { data: rows } = await supabase
      .from("projects")
      .select(selectFields)
      .eq("id", supabaseProjectId)
      .limit(1);
    existingRow = rows && rows.length > 0 ? rows[0] : null;
  }
  if (!existingRow) {
    const { data: rows } = await supabase
      .from("projects")
      .select(selectFields)
      .eq("permit_number", permitNumber)
      .eq("user_id", userId);
    existingRow = rows && rows.length > 0 ? rows[0] : null;
  }
  if (!existingRow?.id) {
    console.warn(
      "[Arlington][PlanReview] checkpoint skipped — no projects row yet",
    );
    return false;
  }

  const priorPd =
    existingRow.portal_data && typeof existingRow.portal_data === "object"
      ? structuredCloneWorksSafe(existingRow.portal_data)
      : /** @type {Record<string, unknown>} */ ({});
  const priorTabs =
    priorPd.tabs && typeof priorPd.tabs === "object" && !Array.isArray(priorPd.tabs)
      ? /** @type {Record<string, unknown>} */ (priorPd.tabs)
      : {};

  if (arlingtonPlanReviewScopeUsesSecondaryShellReadiness(selectiveScope)) {
    const priorPrWrap = priorTabs.planReview;
    const priorPrTabs =
      priorPrWrap &&
      typeof priorPrWrap === "object" &&
      /** @type {Record<string, unknown>} */ (priorPrWrap).tabs &&
      typeof /** @type {Record<string, unknown>} */ (priorPrWrap).tabs ===
        "object"
        ? /** @type {Record<string, unknown>} */ (
            /** @type {Record<string, unknown>} */ (priorPrWrap).tabs
          )
        : null;
    const sliceTabs =
      planReviewTabPayload.tabs &&
      typeof planReviewTabPayload.tabs === "object"
        ? /** @type {Record<string, unknown>} */ (planReviewTabPayload.tabs)
        : null;
    if (priorPrTabs && sliceTabs) {
      arlingtonPreserveOutOfScopePlanReviewTabsInSlice(
        sliceTabs,
        priorPrTabs,
        `${selectiveScope}`.trim(),
      );
    }
  }

  /** @type {Record<string, unknown>} */
  const nextPd = {
    ...priorPd,
    portalType: priorPd.portalType || "accela",
    schemaVersion: Math.max(
      Number(priorPd.schemaVersion) || 0,
      2,
    ),
    tabs: {
      ...priorTabs,
      planReview: planReviewTabPayload,
    },
  };

  const finalizedPd = arlingtonFinalizePortalPayloadBeforeDbSave(
    nextPd,
    existingRow.portal_data,
    null,
  );

  let portalPayloadForDb = sanitizeArlingtonPortalDataTabsPlanReviewForDb(
    finalizedPd,
  );
  const arlingtonPlanReviewOnlyPersistSplice =
    portalDataUtf8ByteLength(portalPayloadForDb) >
    PLAN_REVIEW_LARGE_PAYLOAD_FALLBACK_BYTES;
  if (arlingtonPlanReviewOnlyPersistSplice) {
    const slimPr =
      portalPayloadForDb.tabs &&
      typeof portalPayloadForDb.tabs === "object" &&
      !Array.isArray(portalPayloadForDb.tabs)
        ? /** @type {Record<string, unknown>} */ (portalPayloadForDb.tabs)
            .planReview
        : null;
    portalPayloadForDb = portalDataArlingtonSpliceMinimalPlanReviewUpdate(
      existingRow.portal_data,
      slimPr ?? {},
    );
    portalPayloadForDb =
      sanitizeArlingtonPortalDataTabsPlanReviewForDb(portalPayloadForDb);
  }

  const prSectionState =
    planReviewTabPayload?.sectionState ||
    (planReviewTabPayload?.partialPendingDownloads ? "partial" : "downloading");
  portalPayloadForDb = arlingtonOrchestration.applyCheckpointVersionAndStates(
    portalPayloadForDb,
    existingRow.portal_data,
    {
      planReview: prSectionState,
      projectInformation:
        planReviewTabPayload?.tabs?.projectInformation?.sectionState,
    },
  );

  const newHash = hashPortalData(portalPayloadForDb);
  const { error } = await supabase
    .from("projects")
    .update({
      portal_data: portalPayloadForDb,
      portal_data_hash: newHash,
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", existingRow.id);
  if (error) {
    console.warn(
      `[Arlington][PlanReview] checkpoint Supabase error: ${error.message}`,
    );
    return false;
  }
  console.log(
    `[Arlington][PlanReview] checkpoint persisted checkpointVersion=${portalPayloadForDb.checkpointVersion}`,
  );
  return true;
}

/** @returns {unknown[]} */
function arlingtonPriorAttachmentRowsFromPortalData(priorPortalData) {
  const tabs = priorPortalData?.tabs;
  if (!tabs || typeof tabs !== "object") return [];
  const att = /** @type {Record<string, unknown>} */ (tabs).attachments;
  if (!att || typeof att !== "object") return [];
  const tables = /** @type {Record<string, unknown>} */ (att).tables;
  if (!Array.isArray(tables) || !tables[0]) return [];
  const rows = tables[0]?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** @returns {boolean} */
function arlingtonAttachmentLooksUploadComplete(att) {
  if (!att || typeof att !== "object") return false;
  const a = /** @type {Record<string, unknown>} */ (att);
  const ds = `${a.downloadStatus || ""}`.trim();
  if (ds === "pending_retry_after_storage_limit_increase") return false;
  const viewUrl = `${a.viewUrl || a.publicUrl || ""}`.trim();
  if (/^https?:\/\//i.test(viewUrl)) return true;
  if (`${a.storagePath || ""}`.trim()) return true;
  return ds === "uploaded" || ds === "success";
}

/** @returns {boolean} */
function arlingtonAttachmentNeedsDownloadAttempt(att) {
  if (!att || typeof att !== "object") return false;
  if (arlingtonAttachmentLooksUploadComplete(att)) return false;
  const d = /** @type {Record<string, unknown>} */ (att);
  const ds = `${d.downloadStatus || ""}`.trim();
  const err = `${d.downloadError || ""}`.trim();
  if (ds === "failed_non_retryable" || ds === "duplicate_skipped") {
    return false;
  }
  if (
    ds === "failed" &&
    err !== "link_not_found" &&
    err !== "page_not_resolved" &&
    err !== "click_no_download"
  ) {
    return false;
  }
  return true;
}

/** @param {unknown[]} attachments */
function arlingtonCountAttachmentQueueTotals(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  let alreadyDownloaded = 0;
  let pending = 0;
  for (const att of list) {
    if (arlingtonAttachmentLooksUploadComplete(att)) alreadyDownloaded++;
    else pending++;
  }
  return { total: list.length, alreadyDownloaded, pending };
}

/** @param {unknown[]} attachments @returns {Record<string, number>} */
function arlingtonAttachmentPendingByReason(attachments) {
  /** @type {Record<string, number>} */
  const by = {};
  for (const att of Array.isArray(attachments) ? attachments : []) {
    if (!arlingtonAttachmentNeedsDownloadAttempt(att)) continue;
    const d =
      att && typeof att === "object"
        ? /** @type {Record<string, unknown>} */ (att)
        : null;
    if (!d) continue;
    const key =
      `${d.downloadStatus || "pending_not_attempted"}`.trim() ||
      "pending_not_attempted";
    by[key] = (by[key] || 0) + 1;
  }
  return by;
}

/** @param {Record<string, unknown> | null | undefined} by */
function arlingtonAttachmentPendingCount(by) {
  if (!by || typeof by !== "object") return 0;
  return Object.values(by).reduce((s, n) => s + (Number(n) || 0), 0);
}

/** Stable merge key for attachment rows (filename + page + size/date). */
function arlingtonAttachmentStableKey(row) {
  if (!row || typeof row !== "object") return "";
  const r = /** @type {Record<string, unknown>} */ (row);
  const name = `${r.name || ""}`.trim();
  const pageNum = Number(r.pageNumber) || 0;
  const size = `${r.size || ""}`.trim();
  const date = `${r.latest_update || r.date || ""}`.trim();
  const recordId = `${r.record_id || ""}`.trim();
  if (name && pageNum > 0) return `p${pageNum}::${name}`;
  if (name && size && date) return `${name}::${size}::${date}`;
  if (name && recordId) return `${recordId}::${name}`;
  return name || recordId || "";
}

/** Normalize one attachment row for portal_data + UI (viewUrl/publicUrl/status flags). */
function arlingtonNormalizeAttachmentRow(row) {
  if (!row || typeof row !== "object") return row;
  const r = /** @type {Record<string, unknown>} */ ({ ...row });
  const urlCandidates = [
    r.viewUrl,
    r.publicUrl,
    r.downloadUrl,
    r.url,
    r.fileUrl,
  ]
    .map((u) => `${u ?? ""}`.trim())
    .filter(Boolean);
  let bestUrl = urlCandidates.find((u) => /^https?:\/\//i.test(u)) || "";
  if (!bestUrl && urlCandidates.length > 0) {
    bestUrl = urlCandidates[0];
  }
  const storagePath = `${r.storagePath || ""}`.trim();
  const hasStoredFile =
    (!!bestUrl && /^https?:\/\//i.test(bestUrl)) || !!storagePath;

  if (bestUrl) {
    if (!r.viewUrl) r.viewUrl = bestUrl;
    if (!r.publicUrl) r.publicUrl = bestUrl;
    if (!r.downloadUrl) r.downloadUrl = bestUrl;
  }

  if (hasStoredFile) {
    r.status = "saved";
    r.downloadStatus = "uploaded";
    r.downloaded = true;
    r.saved = true;
    delete r.downloadError;
    delete r.pendingReason;
  }

  if (!r.source) r.source = "attachments";
  return r;
}

/** @param {unknown[]} rows @param {{ logSummary?: boolean }} [opts] */
function arlingtonNormalizeAttachmentsForPortal(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  let saved = 0;
  let pending = 0;
  let failed = 0;
  const normalized = list.map((row) => {
    const n = arlingtonNormalizeAttachmentRow(row);
    const d = /** @type {Record<string, unknown>} */ (n);
    const ds = `${d.downloadStatus || ""}`.trim();
    if (arlingtonAttachmentLooksUploadComplete(n)) saved++;
    else if (ds === "failed" || ds === "failed_non_retryable") failed++;
    else pending++;
    return n;
  });
  if (opts.logSummary === true) {
    console.log(
      `[Arlington][Attachments] final normalized saved=${saved} pending=${pending} failed=${failed} total=${normalized.length}`,
    );
  }
  return normalized;
}

/**
 * Merge prior completed attachment fields into a fresh metadata/download row.
 * @param {Record<string, unknown>|null|undefined} prior
 * @param {Record<string, unknown>} scraped
 */
function arlingtonMergeAttachmentRowFields(prior, scraped) {
  const base =
    scraped && typeof scraped === "object"
      ? /** @type {Record<string, unknown>} */ ({ ...scraped })
      : /** @type {Record<string, unknown>} */ ({});
  if (!prior || typeof prior !== "object") {
    return arlingtonNormalizeAttachmentRow(base);
  }
  const p = /** @type {Record<string, unknown>} */ (prior);
  const out = { ...base };
  const preserveKeys = [
    "viewUrl",
    "publicUrl",
    "downloadUrl",
    "url",
    "fileUrl",
    "storagePath",
    "status",
    "downloadStatus",
    "downloaded",
    "saved",
    "pageNumber",
    "downloadAction",
  ];
  if (arlingtonAttachmentLooksUploadComplete(p)) {
    for (const k of preserveKeys) {
      const pv = p[k];
      const sv = out[k];
      if (
        pv != null &&
        `${pv}`.trim() !== "" &&
        (sv == null || `${sv}`.trim() === "")
      ) {
        out[k] = pv;
      }
    }
    if (p.pageNumber && !out.pageNumber) out.pageNumber = p.pageNumber;
    return arlingtonNormalizeAttachmentRow(out);
  }
  for (const k of preserveKeys) {
    const pv = p[k];
    const sv = out[k];
    if (
      pv != null &&
      `${pv}`.trim() !== "" &&
      (sv == null || `${sv}`.trim() === "")
    ) {
      out[k] = pv;
    }
  }
  return arlingtonNormalizeAttachmentRow(out);
}

/** @param {unknown[]} scanned @param {unknown[]} priorRows */
function arlingtonMergePriorAttachmentRows(scanned, priorRows) {
  /** @type {Map<string, Record<string, unknown>>} */
  const priorByKey = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const priorByName = new Map();
  for (const p of Array.isArray(priorRows) ? priorRows : []) {
    if (!p || typeof p !== "object") continue;
    const pr = /** @type {Record<string, unknown>} */ (p);
    const name = `${pr.name || ""}`.trim();
    const key = arlingtonAttachmentStableKey(pr);
    if (key) priorByKey.set(key, pr);
    if (name && !priorByName.has(name)) priorByName.set(name, pr);
  }
  return (Array.isArray(scanned) ? scanned : []).map((row) => {
    const r =
      row && typeof row === "object"
        ? /** @type {Record<string, unknown>} */ ({ ...row })
        : /** @type {Record<string, unknown>} */ ({ name: String(row || "") });
    r.source = "attachments";
    const key = arlingtonAttachmentStableKey(r);
    const prior =
      (key && priorByKey.get(key)) ||
      priorByName.get(`${r.name || ""}`.trim()) ||
      null;
    return arlingtonMergeAttachmentRowFields(prior, r);
  });
}

/**
 * Merge attachment tab payloads for partial scrape final save — never drop prior uploads.
 * @param {unknown} priorTab
 * @param {unknown} scrapedTab
 */
function arlingtonMergeAttachmentsTabPayload(priorTab, scrapedTab) {
  const priorRows = arlingtonPriorAttachmentRowsFromPortalData({
    tabs: { attachments: priorTab },
  });
  const scrapedRows = arlingtonPriorAttachmentRowsFromPortalData({
    tabs: { attachments: scrapedTab },
  });
  /** @type {Map<string, Record<string, unknown>>} */
  const priorByKey = new Map();
  for (const p of priorRows) {
    const k = arlingtonAttachmentStableKey(p);
    if (k) priorByKey.set(k, /** @type {Record<string, unknown>} */ (p));
  }

  /** @type {Record<string, unknown>[]} */
  const mergedRows = [];
  const seen = new Set();

  for (const row of scrapedRows) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const key = arlingtonAttachmentStableKey(r) || `${r.name || ""}`.trim();
    if (!key) continue;
    seen.add(key);
    mergedRows.push(
      arlingtonMergeAttachmentRowFields(priorByKey.get(key) || null, r),
    );
  }

  for (const [key, prior] of priorByKey.entries()) {
    if (seen.has(key)) continue;
    if (arlingtonAttachmentLooksUploadComplete(prior)) {
      mergedRows.push(arlingtonNormalizeAttachmentRow(prior));
      seen.add(key);
    }
  }

  const normalized = arlingtonNormalizeAttachmentsForPortal(mergedRows);
  const base =
    scrapedTab && typeof scrapedTab === "object"
      ? /** @type {Record<string, unknown>} */ ({ ...scrapedTab })
      : priorTab && typeof priorTab === "object"
        ? /** @type {Record<string, unknown>} */ ({ ...priorTab })
        : /** @type {Record<string, unknown>} */ ({});

  return {
    ...base,
    tables:
      normalized.length > 0
        ? [
            {
              title: "Attachments",
              headers: [
                "Name",
                "Record ID",
                "Record Type",
                "Entity Type",
                "Type",
                "Size",
                "Last Updated",
              ],
              rows: normalized,
            },
          ]
        : [],
    scrapeStatus:
      normalized.some((r) => !arlingtonAttachmentLooksUploadComplete(r)) &&
      normalized.length > 0
        ? "partial_pending_downloads"
        : normalized.length > 0
          ? "complete"
          : base.scrapeStatus,
    partialPendingDownloads: normalized.some(
      (r) => !arlingtonAttachmentLooksUploadComplete(r),
    ),
  };
}

/** True when a Plan Review doc row represents a stored/downloaded file (UI + resume aligned). */
function arlingtonPlanReviewDocLooksDownloadComplete(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (arlingtonErmsSinkDocLooksUploadComplete(doc)) return true;
  const d = /** @type {Record<string, unknown>} */ (doc);
  if (d.downloaded === true || d.saved === true) return true;
  const st = `${d.status || ""}`.trim().toLowerCase();
  if (st === "downloaded" || st === "saved") return true;
  const ds = `${d.downloadStatus || ""}`.trim();
  return ds === "uploaded";
}

/** Normalize one Plan Review document row before portal_data save / UI. */
function arlingtonNormalizePlanReviewDocRow(row) {
  if (!row || typeof row !== "object") return row;
  const r = /** @type {Record<string, unknown>} */ ({ ...row });
  const pu = /^https?:\/\//i.test(`${r.publicUrl || ""}`)
    ? String(r.publicUrl)
    : "";
  const du = /^https?:\/\//i.test(`${r.downloadUrl || ""}`)
    ? String(r.downloadUrl)
    : "";
  const sp = `${r.storagePath || ""}`.trim();
  const hasStoredFile = !!pu || !!du || !!sp;

  if (pu && !r.downloadUrl) r.downloadUrl = pu;
  if (du && !pu) r.publicUrl = du;

  if (hasStoredFile) {
    r.status = "downloaded";
    r.downloadStatus = "uploaded";
    r.downloaded = true;
    r.saved = true;
    delete r.failureReason;
  }

  return r;
}

/**
 * Merge prior completed Plan Review doc fields into a fresh metadata/download row.
 * Never let metadata-only scraped rows clobber prior uploaded fields.
 */
function arlingtonMergePlanReviewDocRowFields(prior, scraped) {
  const base =
    scraped && typeof scraped === "object"
      ? /** @type {Record<string, unknown>} */ ({ ...scraped })
      : /** @type {Record<string, unknown>} */ ({});
  if (!prior || typeof prior !== "object") {
    return arlingtonNormalizePlanReviewDocRow(base);
  }
  const p = /** @type {Record<string, unknown>} */ (prior);
  const out = { ...base };
  const preserveKeys = [
    "publicUrl",
    "downloadUrl",
    "storagePath",
    "status",
    "downloadStatus",
    "downloaded",
    "saved",
    "fileSizeBytes",
    "documentId",
    "action",
  ];
  const priorComplete = arlingtonPlanReviewDocLooksDownloadComplete(p);
  const scrapedComplete = arlingtonPlanReviewDocLooksDownloadComplete(out);

  if (priorComplete && !scrapedComplete) {
    for (const k of preserveKeys) {
      const pv = p[k];
      const sv = out[k];
      if (pv == null) continue;
      if (typeof pv === "string" && !pv.trim()) continue;
      if (
        sv == null ||
        (typeof sv === "string" && !`${sv}`.trim()) ||
        (k === "status" &&
          `${sv}`.trim() &&
          !arlingtonPlanReviewDocLooksDownloadComplete(out))
      ) {
        out[k] = pv;
      }
    }
  } else {
    for (const k of preserveKeys) {
      const pv = p[k];
      const sv = out[k];
      if (pv == null) continue;
      if (typeof pv === "string" && !pv.trim()) continue;
      if (sv == null || (typeof sv === "string" && !`${sv}`.trim())) {
        out[k] = pv;
      }
    }
  }

  return arlingtonNormalizePlanReviewDocRow(out);
}

/** @param {unknown[]} scraped @param {unknown[]} priorRows */
function arlingtonMergePlanReviewDocArrays(scraped, priorRows) {
  /** @type {Map<string, Record<string, unknown>>} */
  const priorByKey = new Map();
  for (const p of Array.isArray(priorRows) ? priorRows : []) {
    if (!p || typeof p !== "object") continue;
    const sk = arlingtonPlanReviewDocStableKey(p);
    if (sk) priorByKey.set(sk, /** @type {Record<string, unknown>} */ (p));
  }

  /** @type {Record<string, unknown>[]} */
  const merged = [];
  const seen = new Set();

  for (const row of Array.isArray(scraped) ? scraped : []) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const sk =
      arlingtonPlanReviewDocStableKey(r) ||
      `${r.name || r.filename || ""}`.trim() ||
      `__row_${merged.length}`;
    seen.add(sk);
    merged.push(arlingtonMergePlanReviewDocRowFields(priorByKey.get(sk) || null, r));
  }

  for (const [sk, prior] of priorByKey.entries()) {
    if (seen.has(sk)) continue;
    if (arlingtonPlanReviewDocLooksDownloadComplete(prior)) {
      merged.push(arlingtonNormalizePlanReviewDocRow(prior));
      seen.add(sk);
    }
  }

  return merged;
}

/** @param {unknown[] | undefined} docs */
function arlingtonCountNormalizedPlanReviewBucketDocs(docs) {
  const list = (Array.isArray(docs) ? docs : []).filter(
    (d) => !arlingtonPlanSetDocIsDeleteOnlyInactive(d),
  );
  let downloaded = 0;
  for (const d of list) {
    if (arlingtonPlanReviewDocLooksDownloadComplete(d)) downloaded++;
  }
  return {
    total: list.length,
    downloaded,
    pending: Math.max(0, list.length - downloaded),
  };
}

/**
 * Normalize + optionally merge prior integrated Plan Review tabs in place.
 * @param {Record<string, unknown>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} [priorIntegratedTabs]
 * @param {{ logSummary?: boolean }} [opts]
 */
function arlingtonNormalizePlanReviewIntegratedTabsForPortal(
  integratedTabs,
  priorIntegratedTabs,
  opts = {},
) {
  if (!integratedTabs || typeof integratedTabs !== "object") {
    return integratedTabs;
  }

  const permitNumber =
    opts && typeof opts === "object"
      ? `${opts.permitNumber || ""}`.trim()
      : "";

  const prior =
    priorIntegratedTabs && typeof priorIntegratedTabs === "object"
      ? priorIntegratedTabs
      : null;

  const mergeSectionDocs = (scrapedDocs, priorDocs) =>
    arlingtonMergePlanReviewDocArrays(
      Array.isArray(scrapedDocs) ? scrapedDocs : [],
      Array.isArray(priorDocs) ? priorDocs : [],
    );

  const pad = integratedTabs.plansAndDocuments;
  if (pad && typeof pad === "object" && !Array.isArray(pad)) {
    const sections = /** @type {Record<string, unknown>} */ (pad).sections;
    if (sections && typeof sections === "object" && !Array.isArray(sections)) {
      const psSec = /** @type {Record<string, unknown>} */ (sections)
        .planSetDocuments;
      if (psSec && typeof psSec === "object" && !Array.isArray(psSec)) {
        const priorPs =
          prior?.plansAndDocuments &&
          typeof prior.plansAndDocuments === "object" &&
          !Array.isArray(prior.plansAndDocuments) &&
          prior.plansAndDocuments.sections &&
          typeof prior.plansAndDocuments.sections === "object"
            ? /** @type {Record<string, unknown>} */ (
                prior.plansAndDocuments.sections
              ).planSetDocuments
            : null;
        const priorDocs =
          priorPs &&
          typeof priorPs === "object" &&
          !Array.isArray(priorPs) &&
          Array.isArray(priorPs.documents)
            ? priorPs.documents
            : [];
        /** @type {Record<string, unknown>} */ (psSec).documents =
          (() => {
            const scraped = Array.isArray(
              /** @type {Record<string, unknown>} */ (psSec).documents,
            )
              ? /** @type {Record<string, unknown>} */ (psSec).documents
              : [];
            if (scraped.length > 0) {
              const sink = [...scraped];
              arlingtonRebuildPlanSetSinkFromPortalCollection(sink, prior, {
                permitNumber,
              });
              return sink;
            }
            return mergeSectionDocs(scraped, priorDocs);
          })();
      }
    }
    if (Array.isArray(/** @type {Record<string, unknown>} */ (pad).documents)) {
      const priorFlat =
        prior?.plansAndDocuments &&
        typeof prior.plansAndDocuments === "object" &&
        !Array.isArray(prior.plansAndDocuments) &&
        Array.isArray(prior.plansAndDocuments.documents)
          ? prior.plansAndDocuments.documents
          : [];
      /** @type {Record<string, unknown>} */ (pad).documents = mergeSectionDocs(
        /** @type {Record<string, unknown>} */ (pad).documents,
        priorFlat,
      );
    }
  }

  for (const bucketKey of [
    "reviewResultsAndMarkups",
    "approvedDocuments",
    "projectInformation",
  ]) {
    const bucket = integratedTabs[bucketKey];
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
    const priorBucket = prior?.[bucketKey];
    const priorDocs =
      priorBucket &&
      typeof priorBucket === "object" &&
      !Array.isArray(priorBucket) &&
      Array.isArray(priorBucket.documents)
        ? priorBucket.documents
        : [];
    /** @type {Record<string, unknown>} */ (bucket).documents = mergeSectionDocs(
      /** @type {Record<string, unknown>} */ (bucket).documents,
      priorDocs,
    );
  }

  arlingtonFinalizePlanSetDocumentsSink(
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents,
    true,
  );

  if (opts.logSummary === true) {
    const ps =
      integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
    const rr = integratedTabs?.reviewResultsAndMarkups?.documents;
    const ad = integratedTabs?.approvedDocuments?.documents;
    const psC = arlingtonCountNormalizedPlanReviewBucketDocs(
      Array.isArray(ps) ? ps : [],
    );
    const rrC = arlingtonCountNormalizedPlanReviewBucketDocs(
      Array.isArray(rr) ? rr : [],
    );
    const adC = arlingtonCountNormalizedPlanReviewBucketDocs(
      Array.isArray(ad) ? ad : [],
    );
    console.log(
      `[Arlington][PlanReview] final normalized planSet downloaded=${psC.downloaded} pending=${psC.pending} total=${psC.total}`,
    );
    console.log(
      `[Arlington][PlanReview] final normalized reviewResults downloaded=${rrC.downloaded} pending=${rrC.pending} total=${rrC.total}`,
    );
    console.log(
      `[Arlington][PlanReview] final normalized approved downloaded=${adC.downloaded} pending=${adC.pending} total=${adC.total}`,
    );
  }

  return integratedTabs;
}

/**
 * Merge selective/full Plan Review tab payloads — preserve uploaded doc fields from prior.
 * @param {unknown} priorTab
 * @param {unknown} scrapedTab
 * @param {string} [permitNumber]
 */
function arlingtonMergePlanReviewTabPayload(priorTab, scrapedTab, permitNumber) {
  if (!scrapedTab || typeof scrapedTab !== "object") {
    return priorTab ?? scrapedTab;
  }
  const scrapedRec = /** @type {Record<string, unknown>} */ (scrapedTab);
  if (
    scrapedRec._arlingtonSelectiveScope === "projectInformation" &&
    scrapedRec._arlingtonSelectiveUpdate === true &&
    priorTab &&
    typeof priorTab === "object"
  ) {
    return mergeArlingtonSelectiveProjectInformationPlanReview(
      /** @type {Record<string, unknown>} */ (priorTab),
      scrapedRec,
      `${permitNumber || ""}`.trim(),
    );
  }
  if (!priorTab || typeof priorTab !== "object") {
    return scrapedRec;
  }

  const prior = /** @type {Record<string, unknown>} */ (priorTab);
  const scraped = /** @type {Record<string, unknown>} */ ({ ...scrapedRec });
  const priorTabs =
    prior.tabs && typeof prior.tabs === "object" && !Array.isArray(prior.tabs)
      ? /** @type {Record<string, unknown>} */ (prior.tabs)
      : null;
  const scrapedTabs =
    scraped.tabs && typeof scraped.tabs === "object" && !Array.isArray(scraped.tabs)
      ? /** @type {Record<string, unknown>} */ (scraped.tabs)
      : null;

  if (scrapedTabs) {
    scraped.tabs = arlingtonNormalizePlanReviewIntegratedTabsForPortal(
      structuredCloneWorksSafe(scrapedTabs) ?? scrapedTabs,
      priorTabs,
      { permitNumber: `${permitNumber || ""}`.trim() },
    );
    arlingtonMaybePreserveProjectInformationFieldsInIntegratedTabs(
      /** @type {Record<string, unknown>} */ (scraped.tabs),
      priorTabs,
      `${permitNumber || ""}`.trim(),
    );
  }

  return scraped;
}

/**
 * When scraped Project Information is weak, restore prior PI fields (never clobber good data).
 * @param {Record<string, unknown>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} priorTabs
 * @param {string} [permitNumber]
 */
function arlingtonMaybePreserveProjectInformationFieldsInIntegratedTabs(
  integratedTabs,
  priorTabs,
  permitNumber,
) {
  if (!integratedTabs || typeof integratedTabs !== "object") return;
  const pi = integratedTabs.projectInformation;
  const fields = pi && typeof pi === "object" ? pi.fields : null;
  const fieldArr = Array.isArray(fields) ? fields : [];
  if (!arlingtonProjectInformationExtractionIsWeak(fieldArr, permitNumber)) return;
  const priorPi = priorTabs?.projectInformation;
  const priorFields = Array.isArray(priorPi?.fields) ? priorPi.fields : [];
  const diagnostics = arlingtonOrchestration.buildProjectInfoDiagnostics({
    mode: integratedTabs?._arlingtonRecordMode,
    extractedKeys: fieldArr.map((f) => `${f.label || ""}`.trim()).filter(Boolean),
    fieldCount: fieldArr.length,
    missingRequiredFields: [
      "Project ID",
      "Plan Review Project Name",
      "Accela CAP ID",
      "Address",
      "Review Type",
    ].filter((label) => {
      const f = fieldArr.find((x) => `${x.label || ""}`.trim() === label);
      return !f || !`${f.value ?? ""}`.trim();
    }),
    rejectionReason: "weak_extraction_validation_failed",
  });
  if (pi && typeof pi === "object") {
    /** @type {Record<string, unknown>} */ (pi).sectionState = "weak_extraction";
    /** @type {Record<string, unknown>} */ (pi).diagnostics = diagnostics;
    /** @type {Record<string, unknown>} */ (pi).extractionStatus = "weak_failed";
  }
  if (priorFields.length === 0) {
    console.log(
      "[Arlington][ProjectInfo] weak extraction rejected; preserving prior projectInformation",
    );
    return;
  }
  /** @type {Record<string, unknown>} */ (integratedTabs).projectInformation = {
    ...(priorPi && typeof priorPi === "object" ? priorPi : {}),
    extractionStatus: "preserved_prior",
    sectionState: "weak_extraction",
    diagnostics,
  };
  console.log(
    "[Arlington][ProjectInfo] weak extraction rejected; preserving prior projectInformation",
  );
}

/**
 * Final Arlington portal_data merge/normalize before DB save — attachments + planReview counts + session status.
 * @param {Record<string, unknown>} portalPayload
 * @param {Record<string, unknown> | null | undefined} priorPortalData
 * @param {Record<string, unknown> | null | undefined} session
 */
function arlingtonFinalizePortalPayloadBeforeDbSave(
  portalPayload,
  priorPortalData,
  session,
) {
  if (!portalPayload || typeof portalPayload !== "object") return portalPayload;

  /** @type {Record<string, unknown>} */
  const out = { ...portalPayload };
  const tabs =
    out.tabs && typeof out.tabs === "object" && !Array.isArray(out.tabs)
      ? /** @type {Record<string, unknown>} */ ({ ...out.tabs })
      : null;
  if (!tabs) return out;

  const priorTabs =
    priorPortalData?.tabs &&
    typeof priorPortalData.tabs === "object" &&
    !Array.isArray(priorPortalData.tabs)
      ? /** @type {Record<string, unknown>} */ (priorPortalData.tabs)
      : null;

  if (tabs.attachments) {
    tabs.attachments = arlingtonMergeAttachmentsTabPayload(
      priorTabs?.attachments ?? null,
      tabs.attachments,
    );
  }

  if (tabs.planReview && typeof tabs.planReview === "object") {
    const permitNum = `${out.projectNum || out.name || ""}`.trim();
    tabs.planReview = arlingtonMergePlanReviewTabPayload(
      priorTabs?.planReview ?? null,
      tabs.planReview,
      permitNum,
    );
    const prWrap = /** @type {Record<string, unknown>} */ (tabs.planReview);
    const integrated =
      prWrap.tabs && typeof prWrap.tabs === "object" && !Array.isArray(prWrap.tabs)
        ? /** @type {Record<string, unknown>} */ (prWrap.tabs)
        : null;
    if (integrated) {
      const ps =
        integrated?.plansAndDocuments?.sections?.planSetDocuments?.documents;
      const rr = integrated?.reviewResultsAndMarkups?.documents;
      const ad = integrated?.approvedDocuments?.documents;
      const psC = arlingtonCountNormalizedPlanReviewBucketDocs(
        Array.isArray(ps) ? ps : [],
      );
      const rrC = arlingtonCountNormalizedPlanReviewBucketDocs(
        Array.isArray(rr) ? rr : [],
      );
      const adC = arlingtonCountNormalizedPlanReviewBucketDocs(
        Array.isArray(ad) ? ad : [],
      );
      console.log(
        `[Arlington][PlanReview] final active planSet downloaded=${psC.downloaded} pending=${psC.pending} total=${psC.total}`,
      );
      console.log(
        `[Arlington][PlanReview] final normalized reviewResults downloaded=${rrC.downloaded} pending=${rrC.pending} total=${rrC.total}`,
      );
      console.log(
        `[Arlington][PlanReview] final normalized approved downloaded=${adC.downloaded} pending=${adC.pending} total=${adC.total}`,
      );

      const planReviewPending = psC.pending + rrC.pending + adC.pending;
      const attRows = arlingtonPriorAttachmentRowsFromPortalData({ tabs });
      const attTotals = arlingtonCountAttachmentQueueTotals(attRows);
      const attPending = attTotals.pending;

      if (attPending === 0 && planReviewPending === 0) {
        delete prWrap.partialPendingDownloads;
        delete prWrap.scrapeStatus;
        if (tabs.attachments && typeof tabs.attachments === "object") {
          /** @type {Record<string, unknown>} */ (tabs.attachments).scrapeStatus =
            "complete";
          delete /** @type {Record<string, unknown>} */ (tabs.attachments)
            .partialPendingDownloads;
        }
      } else {
        prWrap.partialPendingDownloads = planReviewPending > 0;
        if (planReviewPending > 0) {
          prWrap.scrapeStatus = "partial_pending_downloads";
        }
      }

      let finalStatus = "complete";
      if (attPending > 0) {
        finalStatus = "partial_success_attachments_pending";
      } else if (planReviewPending > 0) {
        finalStatus = "partial_success_plan_review_pending";
      }

      console.log(
        `[Arlington][FinalStatus] attachmentsPending=${attPending} planSetPending=${psC.pending} reviewResultsPending=${rrC.pending} approvedPending=${adC.pending} final=${finalStatus}`,
      );

      if (session && typeof session === "object") {
        session.arlingtonAttachmentsPartialPending = attPending > 0;
        session.arlingtonPlanReviewPartialPendingDownloads =
          planReviewPending > 0;
        if (attPending === 0 && planReviewPending === 0) {
          session.arlingtonPlanReviewPartialPendingDownloads = false;
          session.arlingtonAttachmentsPartialPending = false;
        }
      }
    }
  }

  out.tabs = tabs;
  return out;
}

async function arlingtonFetchLatestPortalDataRow(
  supabase,
  userId,
  supabaseProjectId,
  permitNumber,
) {
  if (!supabase || !userId) return null;
  if (supabaseProjectId) {
    const { data: row } = await supabase
      .from("projects")
      .select("portal_data")
      .eq("id", supabaseProjectId)
      .maybeSingle();
    if (row?.portal_data) return row.portal_data;
  }
  const { data: rows } = await supabase
    .from("projects")
    .select("portal_data")
    .eq("permit_number", `${permitNumber || ""}`.trim())
    .eq("user_id", userId)
    .limit(1);
  return rows?.[0]?.portal_data ?? null;
}

function buildArlingtonAttachmentsCheckpointTabSlice({
  attachments,
  screenshotBase64,
  partialPendingDownloads,
  scrapeStatus,
  sectionState,
  rateLimitRetryAfter,
  logSummary = false,
}) {
  const rows = arlingtonNormalizeAttachmentsForPortal(
    Array.isArray(attachments) ? attachments : [],
    { logSummary },
  );
  return {
    tables:
      rows.length > 0
        ? [
            {
              title: "Attachments",
              headers: [
                "Name",
                "Record ID",
                "Record Type",
                "Entity Type",
                "Type",
                "Size",
                "Last Updated",
              ],
              rows,
            },
          ]
        : [],
    keyValues: [],
    screenshot: screenshotBase64,
    source: "attachments",
    jurisdiction: "arlington_county_va",
    ...(sectionState ? { sectionState } : {}),
    ...(rateLimitRetryAfter ? { rateLimitRetryAfter } : {}),
    ...(partialPendingDownloads ? { partialPendingDownloads: true } : {}),
    ...(scrapeStatus ? { scrapeStatus } : {}),
  };
}

async function persistArlingtonAttachmentsCheckpoint({
  supabase,
  userId,
  supabaseProjectId,
  permitNumber,
  hashPortalData,
  attachmentsTabPayload,
}) {
  if (
    !supabase ||
    !userId ||
    typeof hashPortalData !== "function" ||
    !attachmentsTabPayload ||
    typeof attachmentsTabPayload !== "object"
  ) {
    return false;
  }

  const selectFields = "id, portal_data_hash, portal_data, permit_number, user_id";
  /** @type {{ id: string; portal_data?: Record<string, unknown> } | null} */
  let existingRow = null;
  if (supabaseProjectId) {
    const { data: rows } = await supabase
      .from("projects")
      .select(selectFields)
      .eq("id", supabaseProjectId)
      .limit(1);
    existingRow = rows && rows.length > 0 ? rows[0] : null;
  }
  if (!existingRow) {
    const { data: rows } = await supabase
      .from("projects")
      .select(selectFields)
      .eq("permit_number", permitNumber)
      .eq("user_id", userId);
    existingRow = rows && rows.length > 0 ? rows[0] : null;
  }
  if (!existingRow?.id) {
    console.warn(
      "[Arlington][Attachments] checkpoint skipped — no projects row yet",
    );
    return false;
  }

  const priorPd =
    existingRow.portal_data && typeof existingRow.portal_data === "object"
      ? structuredCloneWorksSafe(existingRow.portal_data)
      : /** @type {Record<string, unknown>} */ ({});
  const priorTabs =
    priorPd.tabs && typeof priorPd.tabs === "object" && !Array.isArray(priorPd.tabs)
      ? /** @type {Record<string, unknown>} */ (priorPd.tabs)
      : {};

  /** @type {Record<string, unknown>} */
  const nextPd = arlingtonOrchestration.applyCheckpointVersionAndStates(
    {
      ...priorPd,
      portalType: priorPd.portalType || "accela",
      schemaVersion: Math.max(Number(priorPd.schemaVersion) || 0, 2),
      tabs: {
        ...priorTabs,
        attachments: attachmentsTabPayload,
      },
    },
    priorPd,
    {
      attachments:
        attachmentsTabPayload?.sectionState ||
        (attachmentsTabPayload?.partialPendingDownloads
          ? "partial"
          : "downloading"),
    },
  );

  const newHash = hashPortalData(nextPd);
  const { error } = await supabase
    .from("projects")
    .update({
      portal_data: nextPd,
      portal_data_hash: newHash,
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", existingRow.id);
  if (error) {
    console.warn(
      `[Arlington][Attachments] checkpoint Supabase error: ${error.message}`,
    );
    return false;
  }
  console.log(
    `[Arlington][Attachments] checkpoint persisted checkpointVersion=${nextPd.checkpointVersion}`,
  );
  return true;
}

/** @param {Record<string, unknown> | null | undefined} dc */
function arlingtonAttachmentMarkCheckpointSaved(dc) {
  if (!dc || typeof dc !== "object") return;
  dc.attachmentsCheckpointSaved = true;
  const session = dc._arlingtonSession;
  if (session && typeof session === "object") {
    /** @type {Record<string, unknown>} */ (session).arlingtonAttachmentsCheckpointSaved =
      true;
  }
}

/** Checkpoint payload merged into `portal_data.tabs.planReview` (integrated tabs normalized shape). */
function buildArlingtonPlanReviewCheckpointTabSlice({
  integratedTabs,
  screenshotBase64,
  combinedText,
  partialPendingDownloads,
  scrapeStatus,
}) {
  return {
    comments: [],
    text: `${combinedText || ""}`
      .replace(/\s+/g, " ")
      .slice(0, PLAN_REVIEW_TOPIC_TEXT_MAX),
    screenshot: screenshotBase64,
    planReviewSummary: null,
    downloadLinks: [],
    used: true,
    message: null,
    jurisdiction: "arlington_county_va",
    tabs: structuredCloneWorksSafe(integratedTabs),
    ...(partialPendingDownloads ? { partialPendingDownloads: true } : {}),
    ...(scrapeStatus ? { scrapeStatus } : {}),
  };
}

/**
 * Strip heavy ERMS/DOM debug from `portal_data.tabs.planReview` only (Arlington).
 * @returns {Record<string, unknown>}
 */
function sanitizeArlingtonPortalDataTabsPlanReviewForDb(portalPayload) {
  if (!portalPayload || typeof portalPayload !== "object") return portalPayload;
  const tabs = portalPayload.tabs;
  if (
    !tabs ||
    typeof tabs !== "object" ||
    !tabs.planReview ||
    typeof tabs.planReview !== "object"
  )
    return portalPayload;

  const planReview =
    structuredCloneWorksSafe(tabs.planReview) ||
    /** @type {Record<string, unknown>} */ ({});

  const outPr = {};

  /** @type {(keyof typeof planReview|string)[]} */
  const passKeys = [
    "used",
    "message",
    "source",
    "jurisdiction",
    "timeout",
    "tenantPlanReview",
    "preservePreviousPlanReview",
    "partialPendingDownloads",
    "scrapeStatus",
    "shouldPersist",
    "_arlingtonSelectiveScope",
    "_arlingtonSelectiveUpdate",
    "_arlingtonReviewResultsPanelResolved",
    "_arlingtonProjectInformationPanelResolved",
  ];
  for (const k of passKeys) {
    if (planReview[k] !== undefined) outPr[k] = planReview[k];
  }

  delete outPr.integratedTabs;
  delete outPr.legacyExplorerTabs;
  delete /** @type {Record<string, unknown>} */ (outPr).integratedDocCount;

  if (typeof planReview.text === "string")
    outPr.text = truncateMiddleIndicator(
      planReview.text.replace(/\s+/g, " "),
      PLAN_REVIEW_TOPIC_TEXT_MAX,
    ).slice(0, PLAN_REVIEW_TOPIC_TEXT_MAX);

  let shot =
    typeof planReview.screenshot === "string"
      ? planReview.screenshot
      : planReview.screenshot && typeof planReview.screenshot === "object"
        ? null
        : null;
  if (typeof shot === "string") {
    if (shot.startsWith("data:") || shot.length > PLAN_REVIEW_SCREENSHOT_STRING_MAX_CHARS)
      shot = null;
    if (shot) outPr.screenshot = shot;
  }

  const sum = planReview.planReviewSummary;
  if (sum != null) {
    if (typeof sum === "string") {
      outPr.planReviewSummary = sum.slice(0, 24000);
    } else if (typeof sum === "object") {
      try {
        const s = JSON.stringify(sum);
        if (s.length > 24000) {
          outPr.planReviewSummary = {
            _truncated: true,
            bytesApprox: s.length,
            excerpt: s.slice(0, 23800),
          };
        } else {
          outPr.planReviewSummary = structuredCloneWorksSafe(sum);
        }
      } catch (_) {
        /**/
      }
    } else outPr.planReviewSummary = sum;
  }

  if (Array.isArray(planReview.comments))
    outPr.comments = planReview.comments.map(compactPlanReviewCommentForDb);

  outPr.downloadLinks = sanitizePlanReviewDownloadLinksForDb(
    planReview.downloadLinks,
  );

  if (planReview.tabs && typeof planReview.tabs === "object")
    outPr.tabs = sanitizeArlingtonIntegratedPlanReviewTabsObject(
      structuredCloneWorksSafe(planReview.tabs),
    );

  const nextTabs = { ...portalPayload.tabs, planReview: outPr };
  return { ...portalPayload, tabs: nextTabs };
}

/**
 * If sanitization leaves the row huge, splice only sanitized Plan Review over existing DB blob.
 */
function portalDataArlingtonSpliceMinimalPlanReviewUpdate(
  previousPortalData,
  sanitizedPlanReviewSubset,
) {
  const permitNumber = `${previousPortalData?.projectNum || ""}`.trim();
  const priorPr =
    previousPortalData?.tabs?.planReview &&
    typeof previousPortalData.tabs.planReview === "object"
      ? /** @type {Record<string, unknown>} */ (
          previousPortalData.tabs.planReview
        )
      : null;
  let planReviewToWrite = sanitizedPlanReviewSubset;
  if (
    priorPr &&
    sanitizedPlanReviewSubset &&
    typeof sanitizedPlanReviewSubset === "object" &&
    sanitizedPlanReviewSubset._arlingtonSelectiveScope === "projectInformation" &&
    sanitizedPlanReviewSubset._arlingtonSelectiveUpdate === true
  ) {
    planReviewToWrite = mergeArlingtonSelectiveProjectInformationPlanReview(
      priorPr,
      /** @type {Record<string, unknown>} */ (sanitizedPlanReviewSubset),
      permitNumber,
    );
    console.log(
      "[Arlington][ProjectInfo] large-payload splice used selective projectInformation merge (preserved out-of-scope tabs)",
    );
  }

  if (
    !previousPortalData ||
    typeof previousPortalData !== "object" ||
    !previousPortalData.tabs
  ) {
    return {
      ...(typeof previousPortalData === "object" ? previousPortalData : {}),
      tabs: {
        ...(typeof previousPortalData?.tabs === "object"
          ? previousPortalData.tabs
          : {}),
        planReview: planReviewToWrite,
      },
    };
  }
  try {
    return {
      ...previousPortalData,
      tabs: {
        ...structuredCloneWorksSafe(previousPortalData.tabs),
        planReview: structuredCloneWorksSafe(planReviewToWrite),
      },
    };
  } catch (_) {
    return {
      ...previousPortalData,
      tabs: {
        ...(typeof previousPortalData.tabs === "object"
          ? previousPortalData.tabs
          : {}),
        planReview: planReviewToWrite,
      },
    };
  }
}

/** Child frames only (main frame excluded) for navigateToRecordInfoSection / navigateToPaymentsSection. */
function getAccelaChildFrames(page) {
  return page.frames().filter((f) => f !== page.mainFrame());
}

/**
 * Find first visible element matching any of the selectors in the given frame.
 */
async function findLinkInFrame(frame, selectors) {
  for (const sel of selectors) {
    try {
      const el = await frame.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return { el, sel };
    } catch (_) {}
  }
  return { el: null, sel: null };
}

/**
 * Find a visible anchor whose text content matches linkText (case-insensitive, trimmed), not by ID/class.
 * Search order: main page frame first, then each frame in the frames array.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame[]} frames - Frames to search after main (e.g. child frames except main)
 * @param {string} linkText - Exact text to match (after trim, case-insensitive)
 * @returns {Promise<{ element: import('playwright').ElementHandle, context: import('playwright').Page | import('playwright').Frame } | null>}
 */
async function findLinkInAnyContext(page, frames, linkText) {
  const target = (linkText || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!target) {
    console.log(`     [findLinkInAnyContext] empty linkText`);
    return null;
  }

  async function findVisibleMatchingLink(frameOrPage) {
    const links = await frameOrPage.$$("a");
    for (const el of links) {
      const raw = await el.textContent();
      const text = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text !== target) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      return el;
    }
    return null;
  }

  const mainFrame = page.mainFrame();
  try {
    const el = await findVisibleMatchingLink(mainFrame);
    if (el) {
      console.log(
        `     [findLinkInAnyContext] "${linkText}" found in main page (${mainFrame.url().substring(0, 80)}...)`,
      );
      return { element: el, context: page };
    }
  } catch (e) {
    console.log(`     [findLinkInAnyContext] main page search error: ${e.message}`);
  }

  const frameList = Array.isArray(frames) ? frames : [];
  for (let i = 0; i < frameList.length; i++) {
    const f = frameList[i];
    if (!f) continue;
    try {
      const el = await findVisibleMatchingLink(f);
      if (el) {
        console.log(
          `     [findLinkInAnyContext] "${linkText}" found in frames[${i}] (${f.url().substring(0, 80)}...)`,
        );
        return { element: el, context: f };
      }
    } catch (e) {
      console.log(`     [findLinkInAnyContext] frames[${i}] search error: ${e.message}`);
    }
  }

  console.log(`     [findLinkInAnyContext] "${linkText}" not found in any context`);
  return null;
}

/**
 * Clicks a link in the context of the frame/page that owns it, then waits for contentFrame to update.
 * @param {import('playwright').Page | import('playwright').Frame} context - Page or Frame where element lives
 * @param {import('playwright').ElementHandle} element
 * @param {import('playwright').Page | import('playwright').Frame} contentFrame - Panel/frame whose DOM should change
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<boolean>} true if content change detected, false on click failure or timeout
 */
async function clickAndWaitForContent(context, element, contentFrame, timeoutMs = 8000) {
  if (!element) {
    console.log(`     [clickAndWaitForContent] skipped: no element`);
    return false;
  }
  if (!contentFrame || typeof contentFrame.evaluate !== "function") {
    console.log(`     [clickAndWaitForContent] skipped: invalid contentFrame`);
    return false;
  }
  let priorLen = 0;
  try {
    priorLen = await contentFrame.evaluate(
      () => (document.body ? document.body.innerHTML.length : 0),
    );
  } catch (e) {
    console.log(`     [clickAndWaitForContent] could not read contentFrame: ${e.message}`);
    return false;
  }
  try {
    await element.click({ force: true });
  } catch (e) {
    console.log(`     [clickAndWaitForContent] click failed: ${e.message}`);
    return false;
  }
  const target = contentFrame;
  await target.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5000) }).catch(() => {});
  try {
    await target.waitForFunction(
      (prev) => {
        const len = document.body ? document.body.innerHTML.length : 0;
        return len !== prev;
      },
      priorLen,
      { timeout: timeoutMs },
    );
    console.log(`     [clickAndWaitForContent] success: content panel updated (contentFrame)`);
    return true;
  } catch (e) {
    console.log(`     [clickAndWaitForContent] timeout after ${timeoutMs}ms waiting for content change`);
    return false;
  }
}

const RECORD_INFO_SECTION_NAMES = [
  "Record Details",
  "Processing Status",
  "Related Records",
  "Attachments",
  "Inspections",
];

/**
 * Poll main frame + frames until any submenu label is visible as an anchor (exact text match, case-insensitive).
 * Uses short waitForSelector attempts per hint per context within an overall timeoutMs budget.
 */
async function waitForRecordInfoSubmenuAnchors(page, frames, timeoutMs = 5000) {
  const hints = [...RECORD_INFO_SECTION_NAMES];
  const contexts = [page.mainFrame(), ...(Array.isArray(frames) ? frames.filter(Boolean) : [])];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const ctx of contexts) {
      for (const hint of hints) {
        let baltimoreOnResponse = null;
        try {
          const safe = hint.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          await ctx.waitForSelector(`a:has-text("${safe}")`, {
            state: "visible",
            timeout: 400,
          });
          const el = await ctx.$(`a:has-text("${safe}")`);
          if (el && (await el.isVisible().catch(() => false))) {
            console.log(
              `     [Baltimore Nav] submenu visible (waitForSelector): ${hint}`,
            );
            return true;
          }
        } catch (_) {}
      }
    }
    await page.waitForTimeout(120);
  }
  console.log(
    `     [Baltimore Nav] submenu: no Record Info submenu anchor within ${timeoutMs}ms`,
  );
  return false;
}

/**
 * Poll until any of the given fee-related submenu labels is visible.
 */
async function waitForPaymentsSubmenuAnchors(page, frames, labels, timeoutMs = 5000) {
  const contexts = [page.mainFrame(), ...(Array.isArray(frames) ? frames.filter(Boolean) : [])];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const ctx of contexts) {
      for (const hint of labels) {
        try {
          const safe = hint.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          await ctx.waitForSelector(`a:has-text("${safe}")`, {
            state: "visible",
            timeout: 400,
          });
          const el = await ctx.$(`a:has-text("${safe}")`);
          if (el && (await el.isVisible().catch(() => false))) {
            console.log(
              `     [Baltimore Nav] Payments submenu visible (waitForSelector): ${hint}`,
            );
            return true;
          }
        } catch (_) {}
      }
    }
    await page.waitForTimeout(120);
  }
  console.log(
    `     [Baltimore Nav] Payments submenu: no matching anchor within ${timeoutMs}ms`,
  );
  return false;
}

/**
 * Baltimore: two-phase navigation for Record Info dropdown → submenu item → content panel.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame[]} frames - Child frames to search (after main); main is always searched first inside helpers
 * @param {import('playwright').Page | import('playwright').Frame} contentFrame - Panel whose DOM should update after submenu click
 * @param {"Record Details"|"Processing Status"|"Related Records"|"Attachments"|"Inspections"} sectionName
 * @returns {Promise<boolean>}
 */
async function navigateToRecordInfoSection(page, frames, contentFrame, sectionName) {
  if (!RECORD_INFO_SECTION_NAMES.includes(sectionName)) {
    console.log(
      `     [Baltimore Nav] navigateToRecordInfoSection: invalid sectionName "${sectionName}"`,
    );
    return false;
  }
  console.log(
    `     [Baltimore Nav] navigateToRecordInfoSection: start → "${sectionName}"`,
  );

  const step1 = await findLinkInAnyContext(page, frames, "Record Info");
  if (!step1) {
    console.log(
      `     [Baltimore Nav] step 1 failed: Record Info dropdown trigger not found`,
    );
    return false;
  }
  console.log(
    `     [Baltimore Nav] step 1: clicking Record Info dropdown trigger`,
  );
  try {
    await step1.element.click({ force: true });
  } catch (e) {
    console.log(`     [Baltimore Nav] step 1 click failed: ${e.message}`);
    return false;
  }

  const submenuOk = await waitForRecordInfoSubmenuAnchors(page, frames, 5000);
  if (!submenuOk) {
    console.log(
      `     [Baltimore Nav] step 1→2: submenu did not become visible in time`,
    );
    return false;
  }

  console.log(
    `     [Baltimore Nav] step 2: locating submenu item "${sectionName}"`,
  );
  const step2 = await findLinkInAnyContext(page, frames, sectionName);
  if (!step2) {
    console.log(
      `     [Baltimore Nav] step 2 failed: submenu item "${sectionName}" not found`,
    );
    return false;
  }

  console.log(
    `     [Baltimore Nav] step 2: clicking "${sectionName}" and waiting for content panel`,
  );
  const contentOk = await clickAndWaitForContent(
    step2.context,
    step2.element,
    contentFrame,
    8000,
  );
  if (contentOk) {
    console.log(
      `     [Baltimore Nav] navigateToRecordInfoSection: success → "${sectionName}"`,
    );
  } else {
    console.log(
      `     [Baltimore Nav] navigateToRecordInfoSection: content panel did not update after click`,
    );
  }
  return contentOk;
}

/**
 * Baltimore: Payments dropdown → Fees/Payments submenu → content panel.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame[]} frames
 * @param {import('playwright').Page | import('playwright').Frame} contentFrame
 * @returns {Promise<boolean>}
 */
async function navigateToPaymentsSection(page, frames, contentFrame) {
  console.log(`     [Baltimore Nav] navigateToPaymentsSection: start`);

  const step1 = await findLinkInAnyContext(page, frames, "Payments");
  if (!step1) {
    console.log(
      `     [Baltimore Nav] step 1 failed: Payments dropdown trigger not found`,
    );
    return false;
  }
  console.log(
    `     [Baltimore Nav] step 1: clicking Payments dropdown trigger`,
  );
  try {
    await step1.element.click({ force: true });
  } catch (e) {
    console.log(`     [Baltimore Nav] step 1 click failed: ${e.message}`);
    return false;
  }

  const feeSubmenuLabels = ["Fees / Payments", "Fees", "Payments", "Payment"];
  const submenuOk = await waitForPaymentsSubmenuAnchors(
    page,
    frames,
    feeSubmenuLabels,
    5000,
  );
  if (!submenuOk) {
    console.log(
      `     [Baltimore Nav] step 1→2: Payments submenu did not become visible in time`,
    );
    return false;
  }

  console.log(`     [Baltimore Nav] step 2: locating Fees / Payments submenu item`);
  let step2 = null;
  for (const label of feeSubmenuLabels) {
    step2 = await findLinkInAnyContext(page, frames, label);
    if (step2) break;
  }
  if (!step2) {
    console.log(
      `     [Baltimore Nav] step 2 failed: Fees / Payments submenu item not found`,
    );
    return false;
  }

  console.log(
    `     [Baltimore Nav] step 2: clicking Fees/Payments and waiting for content panel`,
  );
  const contentOk = await clickAndWaitForContent(
    step2.context,
    step2.element,
    contentFrame,
    8000,
  );
  if (contentOk) {
    console.log(`     [Baltimore Nav] navigateToPaymentsSection: success`);
  } else {
    console.log(
      `     [Baltimore Nav] navigateToPaymentsSection: content panel did not update after click`,
    );
  }
  return contentOk;
}

/**
 * Baltimore: Plan Review is a top-level tab on the main page (no Record Info dropdown).
 */
async function navigateToPlanReview(page, _contentFrame) {
  try {
    console.log("[Baltimore PlanReview Nav] looking for Plan Review tab");

    const found = await page.evaluate(() => {
      const links = [...document.querySelectorAll("a, li, span, div")];
      const el = links.find((node) => {
        const t = node.innerText ? node.innerText.trim() : "";
        return t === "Plan Review";
      });
      if (el) {
        el.click();
        return true;
      }
      return false;
    });

    if (!found) {
      console.log("[Baltimore PlanReview Nav] Plan Review tab not found");
      console.log("[Baltimore PlanReview Nav] No Plan Review tab on this record");
      return false;
    }

    await new Promise((r) => setTimeout(r, 3000));
    console.log("[Baltimore PlanReview Nav] clicked, waited 3s");
    return true;
  } catch (err) {
    console.log("[Baltimore PlanReview Nav] ERROR:", err.message);
    return false;
  }
}

/**
 * Wait for a submenu link to become visible in ctx or main page (Baltimore: submenu may render outside record frame).
 * submenuSelectors: array of selectors that indicate submenu is open (e.g. "Record Details", "Processing Status").
 * Returns { visibleInCtx, visibleInMain }.
 */
async function waitForSubmenuVisible(page, ctx, submenuSelectors, waitMs) {
  const deadline = Date.now() + (waitMs || 2000);
  let visibleInCtx = false;
  let visibleInMain = false;
  while (Date.now() < deadline) {
    for (const sel of submenuSelectors) {
      try {
        if (ctx && ctx !== page.mainFrame()) {
          const el = await ctx.$(sel);
          if (el && (await el.isVisible().catch(() => false))) {
            visibleInCtx = true;
            break;
          }
        }
      } catch (_) {}
    }
    if (visibleInCtx) break;
    try {
      const mainEl = await page.mainFrame().$(submenuSelectors[0]);
      if (mainEl && (await mainEl.isVisible().catch(() => false))) visibleInMain = true;
    } catch (_) {}
    if (visibleInMain) break;
    await page.waitForTimeout(200);
  }
  return { visibleInCtx, visibleInMain };
}

/**
 * Expand "Record Info" dropdown so sub-items (Record Details, Processing Status, etc.) become visible.
 * For Baltimore: longer wait and wait for submenu to appear in ctx or main page.
 */
async function expandRecordInfoDropdown(ctx, page) {
  const selectors = [
    '[id*="TabDataList"] a:has-text("Record Info")',
    '#ctl00_PlaceHolderMain_TabDataList a:has-text("Record Info")',
    'a:has-text("Record Info")',
    'a[id*="RecordInfo"]',
  ];
  for (const sel of selectors) {
    try {
      const el = await ctx.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        console.log(`     [panel] Record Info dropdown: clicking expand`);
        await el.click({ force: true }).catch(() => {});
        const waitMs = isBaltimorePortal(page) ? 1200 : 800;
        await page.waitForTimeout(waitMs);
        if (isBaltimorePortal(page)) {
          const submenuIndicators = [
            'a:has-text("Record Details")',
            'a:has-text("Processing Status")',
            'a:has-text("Related Records")',
            'a:has-text("Attachments")',
            'a:has-text("Inspections")',
          ];
          const { visibleInCtx, visibleInMain } = await waitForSubmenuVisible(
            page,
            ctx,
            submenuIndicators,
            3500,
          );
          if (visibleInCtx) console.log(`     [panel] Record Info submenu: visible in record frame`);
          else if (visibleInMain) console.log(`     [panel] Record Info submenu: visible in main page`);
          else console.log(`     [panel] Record Info submenu: not detected after wait (will try multi-context click)`);
        }
        return true;
      }
    } catch (_) {}
  }
  console.log(`     [panel] Record Info: expand link not found`);
  return false;
}

/**
 * Expand "Payments" dropdown so "Fees" sub-item becomes visible.
 * For Baltimore: longer wait and wait for submenu to appear.
 */
async function expandPaymentsDropdown(ctx, page) {
  const selectors = [
    '[id*="TabDataList"] a:has-text("Payments")',
    '#ctl00_PlaceHolderMain_TabDataList a:has-text("Payments")',
    'a:has-text("Payments")',
    'a[id*="Payment"]',
  ];
  for (const sel of selectors) {
    try {
      const el = await ctx.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        console.log(`     [panel] Payments dropdown: clicking expand`);
        await el.click({ force: true }).catch(() => {});
        const waitMs = isBaltimorePortal(page) ? 1200 : 800;
        await page.waitForTimeout(waitMs);
        if (isBaltimorePortal(page)) {
          const submenuIndicators = [
            'a:has-text("Fees")',
            'a:has-text("Payments")',
            'a:has-text("Payment")',
          ];
          const { visibleInCtx, visibleInMain } = await waitForSubmenuVisible(
            page,
            ctx,
            submenuIndicators,
            3500,
          );
          if (visibleInCtx) console.log(`     [panel] Payments submenu: visible in record frame`);
          else if (visibleInMain) console.log(`     [panel] Payments submenu: visible in main page`);
          else console.log(`     [panel] Payments submenu: not detected after wait (will try multi-context click)`);
        }
        return true;
      }
    } catch (_) {}
  }
  console.log(`     [panel] Payments: expand link not found`);
  return false;
}

/**
 * Find and return the first visible link matching selectors, searching ctx then (if Baltimore) main page and other frames.
 * Returns { link, frame, selectorUsed } or { link: null, frame: null, selectorUsed: null }.
 */
async function findPanelLinkMultiContext(ctx, page, selectors, label) {
  const { link, sel } = await findLinkInFrame(ctx, selectors);
  if (link) {
    console.log(`     [panel] "${label}": link found in record frame`);
    return { link, frame: ctx, selectorUsed: sel };
  }
  if (!isBaltimorePortal(page) && !isArlingtonPortal(page))
    return { link: null, frame: null, selectorUsed: null };
  const main = page.mainFrame();
  if (main && main !== ctx) {
    const mainResult = await findLinkInFrame(main, selectors);
    if (mainResult.el) {
      console.log(`     [panel] "${label}": link found in main page`);
      return { link: mainResult.el, frame: main, selectorUsed: mainResult.sel };
    }
  }
  for (const frame of page.frames()) {
    if (frame === ctx || frame === main) continue;
    try {
      const fr = await findLinkInFrame(frame, selectors);
      if (fr.el) {
        console.log(`     [panel] "${label}": link found in frame ${frame.url().substring(0, 50)}`);
        return { link: fr.el, frame, selectorUsed: fr.sel };
      }
    } catch (_) {}
  }
  console.log(`     [panel] "${label}": link not found in any context`);
  return { link: null, frame: null, selectorUsed: null };
}

/**
 * Click a tab/panel link, optionally after expanding Record Info or Payments dropdown.
 * For Baltimore: search for link in record frame, then main page, then other frames; use Baltimore-specific selectors when provided.
 * Returns { found, panelVisible }. Takes checkpoint screenshot when panelVisible and checkpointLabel is set.
 */
async function clickAccelaNavPanel(ctx, page, selectors, label, options = {}) {
  const { expandRecordInfoFirst, expandPaymentsFirst, checkpointLabel } = options;
  if (expandRecordInfoFirst) await expandRecordInfoDropdown(ctx, page);
  if (expandPaymentsFirst) await expandPaymentsDropdown(ctx, page);

  console.log(`     [panel] click start: ${label}`);
  const { link, frame, selectorUsed } = await findPanelLinkMultiContext(ctx, page, selectors, label);
  if (link && frame) {
    try {
      console.log(`     [panel] clicking "${label}"`);
      await link.click({ force: true }).catch(async () => {
        if (selectorUsed && !selectorUsed.includes(":has-text") && frame.evaluate) {
          await frame.evaluate((s) => {
            const el = document.querySelector(s);
            if (el) el.click();
          }, selectorUsed);
        }
      });
      await waitForAccelaLoad(page);
      await page.waitForTimeout(1200);
      if (isBaltimorePortal(page)) {
        await page.waitForTimeout(500);
        console.log(`     [panel] panel load confirmed (record frame): ${label}`);
      }
      if (checkpointLabel) {
        await saveCheckpointScreenshot(page, checkpointLabel);
        console.log(`     [panel] visible confirmation: ${label}`);
      }
      return { found: true, panelVisible: true };
    } catch (err) {
      console.log(`     [panel] click failed for "${label}": ${err.message}`);
    }
  }
  console.log(`     [panel] "${label}" link not found — skipping`);
  return { found: false, panelVisible: false };
}

async function dumpPageDiagnostics(page, label) {
  const url = page.url();
  const title = await page.title().catch(() => "(unknown)");
  const loginFormVisible = !!(await findFieldInFrames(page, [
    'input[type="password"]',
  ]));
  const logoutVisible = !!(await findFieldInFrames(page, [
    'a:has-text("Logout")',
    'a:has-text("Log Out")',
    'a:has-text("Sign Out")',
  ]));
  const welcomeVisible = !!(await findFieldInFrames(page, [
    "#ctl00_HeaderNavigation_lblWelcome",
    '[id*="lblWelcome"]',
  ]));
  const frames = page.frames();
  const frameInfo = frames.map(
    (f, i) => `${i}:${f.name() || "(unnamed)"}@${f.url().substring(0, 80)}`,
  );
  console.log(`  [DIAG:${label}] url=${url}`);
  console.log(`  [DIAG:${label}] title=${title}`);
  console.log(
    `  [DIAG:${label}] loginFormVisible=${loginFormVisible} logoutVisible=${logoutVisible} welcomeVisible=${welcomeVisible}`,
  );
  console.log(
    `  [DIAG:${label}] frames(${frames.length}): ${frameInfo.join(" | ")}`,
  );
}

async function findAuthLandmark(page) {
  if (isFairfaxPortal(page)) {
    const u = (page.url() || "").toLowerCase();
    if (u.includes("dashboard.aspx") || u.includes("myrecordscap.aspx")) {
      return true;
    }
    if (await findFieldInFrames(page, ['a:has-text("My Records")'])) {
      return true;
    }
    const frames = getAccelaChildFrames(page);
    const myRecordsHit = await findLinkInAnyContext(page, frames, "My Records");
    if (myRecordsHit) {
      return true;
    }
  }
  const selectors = [
    'a:has-text("Logout")',
    'a:has-text("Log Out")',
    'a:has-text("Sign Out")',
    "#ctl00_HeaderNavigation_lblWelcome",
    'a:has-text("My Account")',
    'a:has-text("My Records")',
    '[id*="lblWelcome"]',
  ];
  return !!(await findFieldInFrames(page, selectors));
}

async function findLoginFrame(page) {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const nameMatch = (frame.name() || "").toLowerCase().includes("login");
    const urlMatch = frame.url().toLowerCase().includes("login");
    if (nameMatch || urlMatch) {
      console.log(
        `  Found LoginFrame: name="${frame.name()}" url=${frame.url().substring(0, 100)}`,
      );
      return frame;
    }
  }
  return null;
}

async function findFieldInContext(context, selectors) {
  for (const sel of selectors) {
    try {
      const el = await context.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

async function dumpLoginFrameDiagnostics(frame, label) {
  if (!frame) {
    console.log(`  [DIAG:${label}] LoginFrame not available`);
    return;
  }
  const url = frame.url();
  const userStillVisible = !!(await findFieldInContext(frame, [
    'input[name*="txtUserId"]',
    'input[name*="UserName"]',
    'input[id*="UserId"]',
    'input[type="text"][id*="User"]',
    'input[type="email"]',
  ]));
  const passStillVisible = !!(await findFieldInContext(frame, [
    'input[type="password"]',
  ]));
  const btnDisabled = await frame
    .evaluate(() => {
      const btn = document.querySelector(
        'button[type="submit"], input[type="submit"], a[id*="btnLogin"]',
      );
      return btn
        ? btn.disabled || btn.getAttribute("disabled") !== null
        : "no_btn";
    })
    .catch(() => "eval_error");
  const errorText = await frame
    .evaluate(() => {
      const errorSels = [
        ".ACA_Error",
        ".error-message",
        '[id*="Error"]',
        '[id*="error"]',
        ".font11px",
        ".validation-summary-errors",
        '[class*="alert"]',
        '[class*="error"]',
      ];
      for (const sel of errorSels) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.textContent.trim())
          return el.textContent.trim().substring(0, 200);
      }
      return "";
    })
    .catch(() => "");
  console.log(`  [DIAG:${label}] LoginFrame url=${url}`);
  console.log(
    `  [DIAG:${label}] userFieldVisible=${userStillVisible} passFieldVisible=${passStillVisible} btnDisabled=${btnDisabled}`,
  );
  if (errorText) console.log(`  [DIAG:${label}] errorText="${errorText}"`);
}

async function accelaLogin(page, username, password, portalUrl) {
  const cleanUrl = portalUrl.replace(/\/$/, "").replace(/\/Login\.aspx$/i, "");
  const loginUrl = cleanUrl + "/Login.aspx";
  const isArlingtonLoginTenant =
    typeof portalUrl === "string" &&
    portalUrl.toUpperCase().includes("ARLINGTONCO");
  if (isArlingtonLoginTenant) {
    console.log(
      "  [Arlington][login] Shared Accela login — expecting ARLINGTONCO Dashboard or My Records after success",
    );
  }
  console.log(`  Navigating to Accela login: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3000);

  const loginFrame = await findLoginFrame(page);

  const contexts = loginFrame ? [loginFrame, page] : [page];
  console.log(
    `  Login context: ${loginFrame ? "LoginFrame (primary)" : "main page (no LoginFrame found)"}`,
  );

  const isFairfaxLoginPortal =
    typeof portalUrl === "string" &&
    portalUrl.toUpperCase().includes("FAIRFAX");

  const userSelectors = [
    ...(isFairfaxLoginPortal
      ? ["input#username", 'input[name="username"]']
      : []),
    "#ctl00_PlaceHolderMain_LoginBox_txtUserId",
    'input[name*="txtUserId"]',
    'input[name*="UserName"]',
    'input[name*="userName"]',
    'input[id*="UserId"]',
    'input[id*="userId"]',
    'input[type="text"][id*="User"]',
    'input[type="email"]',
  ];

  let userField = null;
  let activeContext = null;
  for (const ctx of contexts) {
    userField = await findFieldInContext(ctx, userSelectors);
    if (!userField) {
      const textInputs = await ctx.$$('input[type="text"]').catch(() => []);
      for (const inp of textInputs) {
        if (await inp.isVisible().catch(() => false)) {
          userField = inp;
          break;
        }
      }
    }
    if (userField) {
      activeContext = ctx;
      break;
    }
  }
  if (!userField) {
    await dumpPageDiagnostics(page, "NO_USER_FIELD");
    await dumpLoginFrameDiagnostics(loginFrame, "NO_USER_FIELD");
    throw new Error(
      "Cannot find Accela username field in LoginFrame or main page",
    );
  }
  console.log(
    `  Found username field in ${activeContext === loginFrame ? "LoginFrame" : "main page"}`,
  );
  await userField.fill(username);
  console.log("  Filled username");

  const passSelectors = [
    ...(isFairfaxLoginPortal
      ? ["input#passwordRequired", 'input[name="password"]']
      : []),
    "#ctl00_PlaceHolderMain_LoginBox_txtPassword",
    'input[name*="txtPassword"]',
    'input[name*="Password"]',
    'input[name*="password"]',
    'input[id*="Password"]',
    'input[id*="password"]',
    'input[type="password"]',
  ];

  const passField = await findFieldInContext(activeContext, passSelectors);
  if (!passField) {
    await dumpLoginFrameDiagnostics(loginFrame, "NO_PASS_FIELD");
    throw new Error("Cannot find Accela password field");
  }
  await passField.fill(password);
  console.log("  Filled password");

  const loginBtnSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_btnLogin",
    'input[name*="btnLogin"]',
    'a[id*="btnLogin"]',
    'a[id*="Login"]',
    'button:has-text("SIGN IN")',
    'button:has-text("Sign In")',
    'button:has-text("Log In")',
    'input[type="submit"]',
    'button[type="submit"]',
  ];

  let loginBtn = await findFieldInContext(activeContext, loginBtnSelectors);
  if (!loginBtn) {
    const allAnchors = await activeContext.$$("a").catch(() => []);
    for (const a of allAnchors) {
      const text = (await a.textContent().catch(() => "")).trim().toUpperCase();
      const visible = await a.isVisible().catch(() => false);
      if (
        visible &&
        (text === "SIGN IN" || text === "LOG IN" || text === "LOGIN")
      ) {
        loginBtn = a;
        break;
      }
    }
  }

  if (loginBtn) {
    console.log("  Clicking login button...");
    await loginBtn.click();
  } else {
    console.log("  No login button found, pressing Enter in active context");
    if (passField) await passField.press("Enter");
    else await page.keyboard.press("Enter");
  }

  console.log("  ⏳ Waiting for login to complete...");

  let loginSucceeded = false;

  for (let elapsed = 0; elapsed < 35000; elapsed += 2000) {
    await page.waitForTimeout(2000);

    if (loginFrame) {
      const frameStillExists = page.frames().some((f) => f === loginFrame);
      if (!frameStillExists) {
        console.log("  ✅ LoginFrame detached — login succeeded");
        loginSucceeded = true;
        break;
      }

      const loginFormGone = !(await findFieldInContext(loginFrame, [
        'input[type="password"]',
      ]));
      if (loginFormGone) {
        console.log(
          "  ✅ Login form disappeared from LoginFrame — login succeeded",
        );
        loginSucceeded = true;
        break;
      }
    }

    const authFound = await findAuthLandmark(page);
    if (authFound) {
      console.log("  ✅ Authenticated landmark found — login succeeded");
      loginSucceeded = true;
      break;
    }
  }

  if (loginSucceeded) {
    await page.waitForTimeout(2000);
    const url = page.url();
    console.log(`  ✅ Login confirmed. URL: ${url}`);
    if (isArlingtonLoginTenant) {
      const title = await page.title().catch(() => "");
      console.log(`  [Arlington][login] post-login document.title: ${title}`);
      if (/\/Dashboard\.aspx/i.test(url)) {
        console.log(
          "  [Arlington][login] Landed on Dashboard.aspx — scrape will open My Records if needed",
        );
      } else if (/\/MyRecordsCap\.aspx/i.test(url)) {
        console.log(
          "  [Arlington][login] Already on MyRecordsCap — list search can proceed",
        );
      }
    }
    await saveCheckpointScreenshot(page, "after_login");
    return url;
  }

  if (loginFrame) {
    const errorText = await loginFrame
      .evaluate(() => {
        const errorSels = [
          ".ACA_Error",
          ".error-message",
          '[id*="Error"]',
          '[id*="error"]',
          ".font11px",
          ".validation-summary-errors",
          '[class*="alert"]',
          '[class*="error"]',
        ];
        for (const sel of errorSels) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0 && el.textContent.trim())
            return el.textContent.trim().substring(0, 300);
        }
        return "";
      })
      .catch(() => "");

    if (errorText) {
      console.log(`  ❌ LoginFrame error: "${errorText}"`);
      await dumpLoginFrameDiagnostics(loginFrame, "LOGIN_ERROR");
      await dumpPageDiagnostics(page, "LOGIN_ERROR");
      if (isScraperDebugArtifactsEnabled()) {
        await page
          .screenshot({ path: "login_failed.png", fullPage: true })
          .catch(() => {});
      }
      throw new Error(`Accela login failed — portal error: ${errorText}`);
    }
  }

  await dumpLoginFrameDiagnostics(loginFrame, "LOGIN_TIMEOUT");
  await dumpPageDiagnostics(page, "LOGIN_TIMEOUT");
  if (isScraperDebugArtifactsEnabled()) {
    await page
      .screenshot({ path: "login_failed.png", fullPage: true })
      .catch(() => {});
  }
  throw new Error(
    "Accela login failed — timed out waiting for authenticated state (login form persisted in LoginFrame)",
  );
}

/** Max pages when walking Accela Citizen Access permit / record list pager ("Next >"). */
const MAX_ACCELA_PERMIT_LIST_PAGES = 150;

/**
 * @param {import('playwright').Page | import('playwright').Frame} frameOrPage
 */
async function accelaPermitListDocSignature(frameOrPage) {
  return frameOrPage
    .evaluate(() => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      const sels = [
        'table[id*="PermitList"] td a',
        'table[id*="Record"] td a',
        'table[id*="gdvPermitList"] td a',
        ".aca_grid_container td a",
        '[id*="gview_List"] td a',
      ];
      const keys = [];
      const seen = new Set();
      for (const sel of sels) {
        for (const a of document.querySelectorAll(sel)) {
          if (a.offsetWidth <= 0) continue;
          const t = norm(a.textContent);
          if (
            !t ||
            /^next\s*>?$/i.test(t) ||
            /^<\s*prev/i.test(t) ||
            /additional results/i.test(t)
          ) {
            continue;
          }
          const k = t.slice(0, 120);
          if (seen.has(k)) continue;
          seen.add(k);
          keys.push(k);
          if (keys.length >= 18) return keys.join("|");
        }
      }
      return keys.join("|");
    })
    .catch(() => "");
}

/**
 * Snapshot of visible permit-like row links across main document and all frames (stall detection).
 * @param {import('playwright').Page} page
 */
async function accelaPermitListCombinedSignature(page) {
  const parts = [await accelaPermitListDocSignature(page)];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    parts.push(await accelaPermitListDocSignature(frame));
  }
  return parts.join("||");
}

/**
 * Clicks the first visible Accela list "Next >" pager link (main or iframe). Returns true if the
 * grid signature changed afterward.
 * @param {import('playwright').Page} page
 */
async function tryClickAccelaPermitGridNext(page) {
  const sigBefore = await accelaPermitListCombinedSignature(page);
  const contexts = [
    ...page.frames().filter((f) => f !== page.mainFrame()),
    page,
  ];
  for (const ctx of contexts) {
    const clicked = await ctx
      .evaluate(() => {
        function norm(t) {
          return String(t || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
        const anchors = [...document.querySelectorAll("a")];
        const nextA = anchors.find((a) => {
          const t = norm(a.textContent);
          if (!/^Next\s*>$/i.test(t) && t !== "Next >") return false;
          const st = window.getComputedStyle(a);
          if (st.visibility === "hidden" || st.display === "none") return false;
          if (a.getAttribute("aria-disabled") === "true") return false;
          const cls = String(a.className || "").toLowerCase();
          if (cls.includes("disabled")) return false;
          return a.offsetWidth > 0 && a.offsetHeight > 0;
        });
        if (!nextA) return false;
        nextA.click();
        return true;
      })
      .catch(() => false);
    if (!clicked) continue;

    await waitForAccelaLoad(page);
    const extraMs = page._isBaltimore ? 800 : page._isArlington ? 600 : 400;
    await page.waitForTimeout(extraMs);

    const sigAfter = await accelaPermitListCombinedSignature(page);
    if (sigAfter === sigBefore) {
      console.log(
        "  [Accela search] Next > did not change list signature — treating as stalled",
      );
      return false;
    }
    console.log("  [Accela search] advanced permit list (Next >)");
    return true;
  }
  return false;
}

/**
 * @returns {Promise<{ foundLink: import('playwright').ElementHandle | import('playwright').Locator | null, foundFrame: import('playwright').Page | import('playwright').Frame | null, foundInfo: Record<string, unknown> }>}
 */
async function findPermitLinkInAccelaList(page, permitNumber) {
  const escapeRegex = (s) =>
    String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const arlingtonListSearch =
    !!page._isArlington ||
    /\/ARLINGTONCO\/Cap\/MyRecordsCap\.aspx/i.test(page.url() || "");

  if (arlingtonListSearch) {
    console.log(
      `[Arlington] findPermitLinkInAccelaList skipped — Arlington uses arlingtonSearchPermitStrictInMyRecords (strict exact + My Records pagination)`,
    );
    return { foundLink: null, foundFrame: null, foundInfo: {} };
  }

  if (page._isFairfax) {
    const tenantListLabel = "Fairfax";
    const methodMain = "fairfax-exact-main";
    const methodScan = "fairfax-exact-scan";
    try {
      const exactMainLocator = page
        .locator("a")
        .filter({
          hasText: new RegExp(`^\\s*${escapeRegex(permitNumber)}\\s*$`),
        });
      const exactMainCount = await exactMainLocator.count();
      if (exactMainCount > 0) {
        const first = exactMainLocator.first();
        const isVisible = await first.isVisible().catch(() => false);
        if (isVisible) {
          const href =
            (await first.getAttribute("href").catch(() => "")) || "";
          const textRaw = (await first.innerText().catch(() => permitNumber))
            .replace(/\s+/g, " ")
            .trim();
          console.log(
            `  [${tenantListLabel}] exact permit match found on main page: "${permitNumber}"`,
          );
          return {
            foundLink: first,
            foundFrame: page,
            foundInfo: {
              method: methodMain,
              text: textRaw || permitNumber,
              href,
              frameName: "main",
              frameUrl: page.url(),
            },
          };
        }
      }

      const mainExactHandle = await page.evaluateHandle((target) => {
        const anchors = Array.from(document.querySelectorAll("a"));
        return (
          anchors.find((a) => {
            const txt = (a.textContent || "").trim();
            return (
              txt === target && a.offsetWidth > 0 && a.offsetHeight > 0
            );
          }) || null
        );
      }, permitNumber);
      const mainExactElement = mainExactHandle.asElement();
      if (mainExactElement) {
        const href =
          (await mainExactElement.getAttribute("href").catch(() => "")) || "";
        const text = (await mainExactElement.innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .trim();
        console.log(
          `  [${tenantListLabel}] exact permit match found via main-page anchor scan: "${permitNumber}"`,
        );
        return {
          foundLink: mainExactElement,
          foundFrame: page,
          foundInfo: {
            method: methodScan,
            text: text || permitNumber,
            href,
            frameName: "main",
            frameUrl: page.url(),
          },
        };
      }
      await mainExactHandle.dispose().catch(() => {});

      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const frameExact = await frame.evaluate((target) => {
            const anchors = Array.from(document.querySelectorAll("a"));
            const match = anchors.find((a) => {
              const txt = (a.textContent || "").trim();
              return txt === target && a.offsetWidth > 0;
            });
            if (!match) return null;
            return {
              text: match.textContent.trim(),
              href: match.href || "",
            };
          }, permitNumber);
          if (frameExact) {
            console.log(
              `  [${tenantListLabel}] exact permit match found in frame: "${permitNumber}"`,
            );
            return {
              foundLink: null,
              foundFrame: frame,
              foundInfo: {
                method: "frame-evaluate",
                text: frameExact.text,
                href: frameExact.href,
                frameName: frame.name() || "(unnamed)",
                frameUrl: frame.url().substring(0, 100),
              },
            };
          }
        } catch {
          // Cross-origin or detached frame — ignore and continue
        }
      }

      console.log(
        `  [${tenantListLabel}] no exact permit match for "${permitNumber}", falling through to substring logic`,
      );
    } catch (err) {
      console.log(
        `  [${tenantListLabel}] exact-match step warning (falling through): ${err.message}`,
      );
    }
  }

  let foundLink = null;
  let foundFrame = null;
  let foundInfo = {};

  const permitLink = await page.$(`a:has-text("${permitNumber}")`);
  if (permitLink && (await permitLink.isVisible().catch(() => false))) {
    foundLink = permitLink;
    foundFrame = page;
    const href = (await permitLink.getAttribute("href").catch(() => "")) || "";
    const text = (await permitLink.innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();
    foundInfo = {
      method: "has-text",
      text,
      href,
      frameName: "main",
      frameUrl: page.url(),
    };
  }

  if (!foundLink) {
    const allLinks = await page.$$("a");
    for (const link of allLinks) {
      const text = (await link.innerText().catch(() => ""))
        .replace(/\s+/g, " ")
        .trim();
      if (text === permitNumber || text.includes(permitNumber)) {
        const visible = await link.isVisible().catch(() => false);
        if (visible) {
          const href = (await link.getAttribute("href").catch(() => "")) || "";
          foundLink = link;
          foundFrame = page;
          foundInfo = {
            method: "anchor-scan",
            text,
            href,
            frameName: "main",
            frameUrl: page.url(),
          };
          break;
        }
      }
    }
  }

  if (!foundLink) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const linkData = await frame
        .evaluate((target) => {
          const anchors = Array.from(document.querySelectorAll("a"));
          const match = anchors.find((a) => {
            const text = (a.textContent || "").replace(/\s+/g, " ").trim();
            return text.includes(target) && a.offsetWidth > 0;
          });
          if (match) {
            return {
              text: match.textContent.replace(/\s+/g, " ").trim(),
              href: match.href || "",
            };
          }
          return null;
        }, permitNumber)
        .catch(() => null);

      if (linkData) {
        foundFrame = frame;
        foundInfo = {
          method: "frame-evaluate",
          text: linkData.text,
          href: linkData.href,
          frameName: frame.name() || "(unnamed)",
          frameUrl: frame.url().substring(0, 100),
        };
        break;
      }
    }
  }

  return { foundLink, foundFrame, foundInfo };
}

/**
 * Baltimore post-login: Dashboard.aspx → My Records click → MyRecordsCap.aspx.
 * (Fairfax uses direct navigation; see fairfaxNavigateDashboardToMyRecordsCap.)
 */
function shouldUseAccelaDashboardMyRecordsNav(page) {
  if (!page) return false;
  if (
    !isBaltimorePortal(page) &&
    !isFairfaxPortal(page) &&
    !isArlingtonPortal(page)
  )
    return false;
  const u = page.url() || "";
  if (!/\/Dashboard\.aspx/i.test(u)) return false;
  if (/\/MyRecordsCap\.aspx/i.test(u)) return false;
  return true;
}

const FAIRFAX_MYRECORDS_TAB_QUERY =
  "TabName=Home&TabList=Home%7C0%7CBuilding%7C1%7CEnforcement%7C2%7CEnvHealth%7C3%7CFire%7C4%7CPlanning%7C5%7CSite%7C6%7CZoning%7C7%7CCurrentTabIndex%7C0";

function buildFairfaxMyRecordsCapUrl(page) {
  const raw = page.url() || "";
  try {
    const u = new URL(raw);
    const lower = u.pathname.toLowerCase();
    const marker = "/citizenaccess";
    const i = lower.indexOf(marker);
    const prefix =
      i >= 0 ? u.pathname.slice(0, i + marker.length) : "/CitizenAccess";
    return `${u.origin}${prefix}/Cap/MyRecordsCap.aspx?${FAIRFAX_MYRECORDS_TAB_QUERY}`;
  } catch {
    return null;
  }
}

/**
 * Fairfax: authenticated Dashboard → direct goto MyRecordsCap (click nav is unreliable).
 * Optional click fallback via accelaClickMyRecordsNavFromDashboard.
 * @returns {Promise<boolean>} true if final URL is MyRecordsCap.aspx
 */
async function fairfaxNavigateDashboardToMyRecordsCap(page) {
  if (/\/MyRecordsCap\.aspx/i.test(page.url() || "")) return true;
  if (!/\/Dashboard\.aspx/i.test(page.url() || "")) return false;

  const target = buildFairfaxMyRecordsCapUrl(page);
  if (!target) {
    console.log("[Fairfax] My Records direct navigation failed");
    return false;
  }
  console.log("[Fairfax] on Dashboard, navigating directly to My Records URL");
  let directLanded = false;
  try {
    await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForURL(/MyRecordsCap\.aspx/i, { timeout: 20000 }).catch(() => {});
    await waitForAccelaLoad(page);
    await page.waitForTimeout(1500);
    directLanded = /\/MyRecordsCap\.aspx/i.test(page.url() || "");
  } catch (e) {
    console.log(`[Fairfax] My Records direct goto error (${e.message})`);
  }
  if (directLanded) {
    console.log("[Fairfax] My Records direct navigation succeeded");
    return true;
  }
  console.log(
    "[Fairfax] direct navigate did not land on MyRecordsCap, trying click fallback",
  );
  await accelaClickMyRecordsNavFromDashboard(page);
  const ok = /\/MyRecordsCap\.aspx/i.test(page.url() || "");
  if (ok) {
    console.log("[Fairfax] My Records direct navigation succeeded");
  } else {
    console.log("[Fairfax] My Records direct navigation failed");
  }
  return ok;
}

/**
 * Arlington: Dashboard → direct goto MyRecordsCap with TabName=Home&TabList=Home (confirmed tenant path).
 * Falls back to accelaClickMyRecordsNavFromDashboard like other aca-prod tenants.
 * @returns {Promise<boolean>}
 */
async function arlingtonNavigateDashboardToMyRecordsCap(page) {
  if (/\/MyRecordsCap\.aspx/i.test(page.url() || "")) {
    console.log(
      `  [Arlington] already on My Records (${(page.url() || "").substring(0, 96)}…)`,
    );
    return true;
  }
  if (!/\/Dashboard\.aspx/i.test(page.url() || "")) return false;

  let target;
  try {
    const origin = new URL(page.url() || "").origin;
    target = `${origin}${ArlingtonAccelaProfile.myRecordsPath}`;
  } catch (e) {
    console.log(`  [Arlington] My Records URL build failed: ${e.message}`);
    return false;
  }
  console.log(`  [Arlington] navigating Dashboard → My Records: ${target}`);
  let directLanded = false;
  try {
    await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForURL(/MyRecordsCap\.aspx/i, { timeout: 20000 }).catch(() => {});
    await waitForAccelaLoad(page);
    await page.waitForTimeout(1500);
    directLanded = /\/MyRecordsCap\.aspx/i.test(page.url() || "");
  } catch (e) {
    console.log(`  [Arlington] My Records direct goto error (${e.message})`);
  }
  if (directLanded) {
    console.log(
      `  [Arlington] My Records open OK — tenant path includes ARLINGTONCO: ${/(ARLINGTONCO)/i.test(page.url() || "")}`,
    );
    return true;
  }
  console.log(
    "[Arlington] direct goto did not land on MyRecordsCap — trying My Records click",
  );
  await accelaClickMyRecordsNavFromDashboard(page);
  const ok = /\/MyRecordsCap\.aspx/i.test(page.url() || "");
  console.log(
    `  [Arlington] after fallback click, MyRecordsCap=${ok} url=${(page.url() || "").substring(0, 120)}`,
  );
  return ok;
}

/**
 * Clicks "My Records" from Dashboard using findFieldInFrames('a:has-text("My Records")') first
 * (same as findAuthLandmark selector ladder), then findLinkInAnyContext exact match, then
 * click({ force: true }) like navigateToRecordInfoSection step 1 — not plain .click().
 * @returns {Promise<boolean>} true if URL ends on MyRecordsCap.aspx (or was already there)
 */
async function accelaClickMyRecordsNavFromDashboard(page) {
  const u = page.url() || "";
  if (/\/MyRecordsCap\.aspx/i.test(u)) return true;
  if (!/\/Dashboard\.aspx/i.test(u)) return false;

  const frames = getAccelaChildFrames(page);
  let handle = await findFieldInFrames(page, ['a:has-text("My Records")']);
  if (!handle) {
    const hit = await findLinkInAnyContext(page, frames, "My Records");
    if (hit) handle = hit.element;
  }
  if (!handle) {
    console.log(
      "     [Accela nav] My Records not found on Dashboard (tried :has-text + findLinkInAnyContext)",
    );
    return false;
  }
  try {
    await handle.click({ force: true });
  } catch (e) {
    console.log(`     [Accela nav] My Records click failed: ${e.message}`);
    return false;
  }
  await page.waitForURL(/MyRecordsCap\.aspx/i, { timeout: 20000 }).catch(() => {});
  await waitForAccelaLoad(page);
  await page.waitForTimeout(1500);
  return /\/MyRecordsCap\.aspx/i.test(page.url() || "");
}

/** Priority + extra module headings seen on ACA My Records accordions */
const ARLINGTON_MYRECORDS_ACCORDION_KNOWN = [
  "Building",
  "Planning",
  "Zoning",
  "Enforcement",
  "Fire",
  "Site",
  "EnvHealth",
  "Environmental Health",
  "Environmental",
];

/**
 * Expand Arlington My Records accordion panels so grids / CapDetail links are usable for search & clicks.
 * Arlington-only — no Baltimore/Fairfax calls.
 */
async function expandArlingtonMyRecordsSections(page) {
  const u = page.url() || "";
  if (!/\/ARLINGTONCO\/Cap\/MyRecordsCap\.aspx/i.test(u)) return;
  if (!(page._isArlington || /\/ARLINGTONCO\//i.test(u))) return;

  const extraLabels = await page.evaluate(() => {
    const norm = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const root =
      document.querySelector('[id*="PlaceHolderMain"]') || document.body;
    /** @type {Set<string>} */
    const extras = new Set();
    root
      .querySelectorAll(
        '[class*="HeadBar"], [class*="Accordion"], [class*="Section"], thead th',
      )
      .forEach((block) => {
        const txt = norm((block.innerText || "").split("\n")[0] || "");
        if (
          txt.length >= 3 &&
          txt.length <= 42 &&
          /^[A-Za-z0-9/&\-\s]+$/.test(txt) &&
          !/^(Showing|Records|Apply|Submit|Welcome)/i.test(txt)
        ) {
          extras.add(txt);
        }
      });
    return [...extras];
  });

  const ordered = [...new Set([...ARLINGTON_MYRECORDS_ACCORDION_KNOWN, ...extraLabels])];

  const result = await page.evaluate((labelsToTry) => {
    function norm(t) {
      return String(t || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function findToggle(label) {
      const root =
        document.querySelector('[id*="PlaceHolderMain"]') || document.body;
      const cands = [];
      root
        .querySelectorAll(
          'a, button, [role="button"], td, th, label, span, div[class*="Head"]',
        )
        .forEach((el) => {
          if (
            el.closest?.("footer, #footer, .footer, [id*='Privacy']") ||
            el.closest?.("#header_main_menu")
          )
            return;
          const t = norm(el.textContent || "");
          if (t !== label) return;
          cands.push(el);
        });
      cands.sort(
        (a, b) => norm(a.textContent || "").length - norm(b.textContent || "").length,
      );
      return cands[0] || null;
    }

    function gridAncestorStats(toggleEl) {
      let node = toggleEl;
      for (let d = 0; d < 22 && node; d++) {
        const grid =
          node.querySelector && node.querySelector('table[id*="gdvPermitList"]');
        if (grid) {
          const caps = [...grid.querySelectorAll('a[href*="CapDetail.aspx"]')];
          const cs = window.getComputedStyle(grid);
          const hidden =
            grid.offsetParent === null ||
            cs.display === "none" ||
            cs.visibility === "hidden";
          const visibleCaps = caps.filter(
            (a) =>
              !!(a.offsetWidth || a.offsetHeight || a.getClientRects().length),
          );
          return { grid, capCount: caps.length, visibleCapCount: visibleCaps.length, hidden };
        }
        node = node.parentElement;
      }
      return null;
    }

    /** @type {string[]} */
    const detected = [];
    /** @type {string[]} */
    const expansions = [];
    /** @type {string[]} */
    const absent = [];

    for (const label of labelsToTry) {
      const toggle = findToggle(label);
      if (!toggle) {
        absent.push(label);
        continue;
      }
      detected.push(label);
      const stats = gridAncestorStats(toggle);
      let needClick = false;
      if (!stats) needClick = true;
      else if (stats.capCount === 0) needClick = true;
      else if (stats.hidden) needClick = true;
      else if (stats.visibleCapCount === 0 && stats.capCount > 0)
        needClick = true;

      if (!needClick) continue;
      try {
        toggle.scrollIntoView({ block: "nearest" });
        toggle.click();
        expansions.push(label);
      } catch (_) {
        try {
          toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          expansions.push(label);
        } catch (_) {
          /**/
        }
      }
    }

    return { detected, expansions, absent };
  }, ordered);

  const detectedList = [...new Set(result.detected || [])];
  console.log(
    `[Arlington][MyRecords] accordion sections detected: ${detectedList.length ? detectedList.join(", ") : "(none matched)"}`,
  );
  const interestingAbsent = ordered.filter((l) => !detectedList.includes(l));
  if (interestingAbsent.length)
    console.log(
      `[Arlington][MyRecords] accordion headings not matched on page this run (${interestingAbsent.slice(0, 12).join(", ")}${interestingAbsent.length > 12 ? "…" : ""}) — continuing`,
    );

  for (const lab of result.expansions || []) {
    console.log(`[Arlington][MyRecords] expanding section: ${lab}`);
  }

  await page.waitForTimeout(500).catch(() => {});

  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll('table[id*="gdvPermitList"]').length > 0 ||
        document.querySelectorAll('a[href*="CapDetail.aspx"]').length > 0,
      { timeout: 30000 },
    );
  } catch (e) {
    console.warn(
      `[Arlington][MyRecords] post-accordion DOM wait warning: ${e.message}`,
    );
  }

  const nCaps = await page
    .evaluate(
      () => document.querySelectorAll('a[href*="CapDetail.aspx"]').length,
    )
    .catch(() => 0);
  console.log(
    `[Arlington][MyRecords] after accordion expansion: CapDetail links=${nCaps}`,
  );
}

/**
 * Arlington My Records: log CapList2/CapList4 grids (main + iframe), row counts, CapDetail links.
 */
async function logArlingtonMyRecordsGridDiagnostics(page) {
  if (
    !page ||
    !(page._isArlington || /\/ARLINGTONCO\//i.test(page.url() || ""))
  )
    return;
  console.log("[Arlington][MyRecords] grid diagnostics...");
  const gridIds = ArlingtonAccelaProfile.recordListTableIdPrefixes;
  const summary = await page
    .evaluate((ids) => {
      const grids = [];
      let totalCapDetail = 0;
      for (const id of ids) {
        const table = document.getElementById(id);
        if (!table) {
          grids.push({ id, present: false, trCount: 0, capDetailLinks: 0 });
          continue;
        }
        const trs = table.querySelectorAll("tr");
        const capLinks = table.querySelectorAll('a[href*="CapDetail"]');
        totalCapDetail += capLinks.length;
        let resumeInTable = 0;
        for (const tr of trs) {
          if (/resume\s+application/i.test((tr.textContent || "").slice(0, 200)))
            resumeInTable += 1;
        }
        const sample = [];
        for (const a of capLinks) {
          if (sample.length >= 5) break;
          sample.push({
            text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 64),
            href: (a.getAttribute("href") || "").slice(0, 180),
          });
        }
        grids.push({
          id,
          present: true,
          trCount: trs.length,
          capDetailLinks: capLinks.length,
          resumeRowHints: resumeInTable,
          sampleCapDetailLinks: sample,
        });
      }
      return { grids, totalCapDetailLinks: totalCapDetail };
    }, gridIds)
    .catch(() => ({ grids: [], totalCapDetailLinks: 0, error: true }));

  for (const g of summary.grids || []) {
    if (g.present) {
      console.log(
        `  [Arlington][My Records] grid ${g.id}: rows≈${g.trCount} CapDetail links=${g.capDetailLinks} sample=${JSON.stringify(g.sampleCapDetailLinks || []).slice(0, 220)}`,
      );
    } else {
      console.log(`  [Arlington][My Records] grid ${g.id}: not in main document (may be iframe or empty)`);
    }
  }
  console.log(
    `  [Arlington][My Records] CapDetail links in main doc (sum grids): ${summary.totalCapDetailLinks ?? 0}`,
  );

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const inFrame = await frame
      .evaluate((ids) => {
        let found = 0;
        const hitIds = [];
        for (const id of ids) {
          const table = document.getElementById(id);
          if (table) {
            found += table.querySelectorAll('a[href*="CapDetail"]').length;
            hitIds.push(id);
          }
        }
        return { found, hitIds };
      }, gridIds)
      .catch(() => ({ found: 0, hitIds: [] }));
    if (inFrame.found > 0) {
      console.log(
        `  [Arlington][My Records] iframe "${frame.name() || "unnamed"}" url=${(frame.url() || "").slice(0, 100)} — CapDetail links=${inFrame.found} tableIds=${(inFrame.hitIds || []).join(",")}`,
      );
    }
  }
}

/** Arlington visible My Records list — pager is outside `gdvPermitList`; use broad container + signature. */
const MAX_ARLINGTON_VISIBLE_MYRECORDS_PAGES = MAX_ACCELA_PERMIT_LIST_PAGES;

/**
 * Snapshot visible list: scored broad root; permissive CapDetail collection; compact permit match.
 */
async function arlingtonProbeVisibleMyRecordsFrame(
  frame,
  permitNumber,
  opts,
) {
  const logRootDiag = !!(opts && opts.logRootDiag);
  const quietMeta = !!(opts && opts.quiet);
  /** @typedef {{ sel: string; links: number; showing: boolean; next: boolean; score?: number }} ArlRootCand */
  /** @typedef {{ rows: ArlRootCand[] }} ArlRootDiag */
  /** @typedef {{ rows: ArlRootCand[], selectedSel?: string }} ArlProbeReturn */
  const data = /** @type {ArlProbeReturn & Record<string, unknown>} */ (
    await frame.evaluate((pn) => {
      function norm(t) {
        return String(t ?? "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      function normUpperPermitTxt(t) {
        return norm(String(t ?? "")).toUpperCase();
      }

      const ROOT_SELECTORS = [
        "#PageResult",
        ".ACA_Area_CapHome",
        "#ctl00_PlaceHolderMain_PermitList",
        "#ctl00_PlaceHolderMain_UpdatePanel1",
        ".ThreeColumns",
        "form",
        "body",
      ];

      /** @returns {{ sel: string; root: HTMLElement; links: number; showing: boolean; next: boolean; score: number }[]} */
      function scoreRootCandidates() {
        /** @type {{ sel: string; root: HTMLElement; links: number; showing: boolean; next: boolean; score: number }[]} */
        const list = [];
        for (const sel of ROOT_SELECTORS) {
          const el = document.querySelector(sel);
          if (!(el instanceof HTMLElement)) continue;
          const r = el.getBoundingClientRect();
          const capDetailCount = el.querySelectorAll(
            'a[href*="CapDetail.aspx"]',
          ).length;
          const innerRaw = String(el.textContent || "")
            .replace(/\s+/g, " ")
            .slice(0, 64000);
          const hasShowingText =
            /Showing\s*\d+\s*-\s*\d+\s*of\s*\d+/i.test(innerRaw);
          const hasNextText = /Next\s*>?/i.test(innerRaw);
          const hasRect = r.width >= 8 && r.height >= 8;
          const visibleish = hasRect || capDetailCount > 0;
          if (!visibleish) continue;
          const score =
            capDetailCount * 10 + (hasShowingText ? 5 : 0) + (hasNextText ? 3 : 0);
          list.push({
            sel,
            root: el,
            links: capDetailCount,
            showing: hasShowingText,
            next: hasNextText,
            score,
          });
        }
        list.sort(
          (a, b) => b.score - a.score || b.links - a.links || a.sel.localeCompare(b.sel),
        );
        return list;
      }

      /** @returns {string} */
      function compactPermitStr(t) {
        return String(t ?? "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, "")
          .toUpperCase();
      }

      /** Diagnostic only — never used to drop links. True if anchor→root chain hits display:none or visibility:hidden */
      /** @returns {boolean} */
      function hasHiddenLayoutAncestorUnderRoot(a, root) {
        if (!(a instanceof HTMLElement) || !(root instanceof HTMLElement))
          return false;
        if (!root.contains(a)) return false;
        for (
          let n = /** @type {HTMLElement | null} */ (a);
          n;
          n = n.parentElement
        ) {
          if (!(n instanceof HTMLElement)) break;
          const cs = window.getComputedStyle(n);
          if (cs.display === "none" || cs.visibility === "hidden") return true;
          if (n === root) break;
        }
        return false;
      }

      /** Valid CapDetail URL from `a.href` or `href` attribute — not gated on layout. */
      /** @returns {string} */
      function capHrefForKeep(a) {
        if (!(a instanceof HTMLAnchorElement)) return "";
        let resolved = "";
        try {
          resolved = String(a.href || "").trim();
        } catch (_) {
          resolved = "";
        }
        const attr = String(a.getAttribute("href") || "").trim();
        return resolved || attr;
      }

      /** @returns {{ kept: HTMLAnchorElement[]; raw: number; dropped: number; samples: { text: string; href: string; reason: string }[]; hiddenAncestorNotes: { text: string }[] }} */
      function collectCapDetailLinksPermissive(root) {
        const rawList = [
          ...root.querySelectorAll('a[href*="CapDetail.aspx"]'),
        ].filter((n) => n instanceof HTMLAnchorElement);
        /** @type {HTMLAnchorElement[]} */
        const kept = [];
        /** @type {{ text: string; href: string; reason: string }[]} */
        const samples = [];
        /** @type {{ text: string }[]} */
        const hiddenAncestorNotes = [];
        const maxSamples = 5;
        const maxNotes = 12;

        for (const a of rawList) {
          const snippet = norm(
            String(a.innerText || a.textContent || ""),
          ).slice(0, 220);
          const hrefCheck = capHrefForKeep(a);
          const hrefShow = hrefCheck.slice(0, 520);

          if (!root.contains(a)) {
            if (samples.length < maxSamples)
              samples.push({
                text: snippet,
                href: hrefShow,
                reason: "not_under_root",
              });
            continue;
          }
          if (!hrefCheck) {
            if (samples.length < maxSamples)
              samples.push({
                text: snippet,
                href: hrefShow,
                reason: "missing_href",
              });
            continue;
          }
          if (!/CapDetail\.aspx/i.test(hrefCheck)) {
            if (samples.length < maxSamples)
              samples.push({
                text: snippet,
                href: hrefShow,
                reason: "not_capdetail",
              });
            continue;
          }

          if (
            hasHiddenLayoutAncestorUnderRoot(a, root) &&
            hiddenAncestorNotes.length < maxNotes
          ) {
            hiddenAncestorNotes.push({ text: snippet });
          }

          kept.push(a);
        }

        return {
          kept,
          raw: rawList.length,
          dropped: rawList.length - kept.length,
          samples,
          hiddenAncestorNotes,
        };
      }

      /** @returns {string} */
      function extractActivePageNum(root) {
        const pg =
          root.querySelector(
            "tr.ACA_Pagination, table.ACA_GridPaging, .aca_pagination, .ACA_GridPaging, [class*='Pagination'], [class*='pagination']",
          ) || null;
        if (!(pg instanceof HTMLElement)) return "";
        const cur = pg.querySelector(
          ".ACA_CurrentPageFont, .aca_current, [class*='CurrentPage'], [class*='Selected'], td.ACA_LinkButton_Selected",
        );
        if (cur instanceof HTMLElement) {
          const tx = norm(cur.textContent || "");
          if (/^\d+$/.test(tx)) return tx;
        }
        const bold = pg.querySelector("b, strong");
        if (bold instanceof HTMLElement) {
          const tx = norm(bold.textContent || "");
          if (/^\d+$/.test(tx)) return tx;
        }
        return "";
      }

      const scored = scoreRootCandidates();
      const rows = scored.map((c) => ({
        sel: c.sel,
        links: c.links,
        showing: c.showing,
        next: c.next,
        score: c.score,
      }));
      const best = scored[0];
      const root = best ? best.root : document.body;
      const marker = best ? best.sel : "body";

      /** Pager/range detection from textContent (not innerText — Accela hides range from innerText sometimes). */
      const rootTextFlat = String(root.textContent || "")
        .replace(/\s+/g, " ")
        .slice(0, 96000);
      const showingM = rootTextFlat.match(/Showing\s*\d+\s*-\s*\d+\s*of\s*\d+/i);
      const showing = showingM ? norm(showingM[0]) : "";

      let heading = "";
      const titleEl = root.querySelector(
        ".ACA_FormTitle_Text, .ACA_PageTitle_Text, td.ACA_Title_Color, span.ACA_Title_Text",
      );
      if (titleEl instanceof HTMLElement)
        heading = norm(titleEl.textContent || "").slice(0, 200);

      const idxShow = rootTextFlat.toLowerCase().indexOf("showing");
      if (idxShow > 10) {
        const leftCh = rootTextFlat.slice(0, idxShow).trimEnd();
        const tailGuess = leftCh.slice(-180).trim();
        if (tailGuess.length > 5) heading = heading || tailGuess;
      }

      const pagerEl =
        root.querySelector(
          "tr.ACA_Pagination, table.ACA_GridPaging, .aca_pagination, .ACA_GridPaging, [class*='Pagination'], [class*='pagination']",
        ) || null;

      let pagerSnippet = "";
      const lowRf = rootTextFlat.toLowerCase();
      const iShowSnip = lowRf.indexOf("showing");
      const iNextSnip = lowRf.indexOf("next");
      if (iShowSnip !== -1) {
        pagerSnippet = norm(rootTextFlat.slice(iShowSnip, iShowSnip + 300));
      } else if (iNextSnip !== -1) {
        pagerSnippet = norm(
          rootTextFlat.slice(Math.max(0, iNextSnip - 80), iNextSnip + 160),
        );
      } else if (pagerEl instanceof HTMLElement) {
        pagerSnippet = norm(pagerEl.textContent || "").slice(0, 420);
      }

      const rngM = showing.match(/Showing\s+(\d+)\s*-\s*(\d+)/i);
      const firstRg = rngM ? rngM[1] : "";
      const lastRg = rngM ? rngM[2] : "";
      const activePageNum = extractActivePageNum(root);

      const {
        kept: listCaps,
        raw: rawLinkCount,
        dropped,
        samples: droppedSamples,
        hiddenAncestorNotes,
      } = collectCapDetailLinksPermissive(root);

      const firstTxt =
        listCaps[0] instanceof HTMLElement
          ? normUpperPermitTxt(
              String(listCaps[0].innerText || listCaps[0].textContent || ""),
            )
          : "";
      const lastTxt =
        listCaps.length > 0
          ? normUpperPermitTxt(
              String(
                listCaps[listCaps.length - 1].innerText ||
                  listCaps[listCaps.length - 1].textContent ||
                  "",
              ),
            )
          : "";

      const sortedKeys = listCaps
        .map((a) => {
          const u = normUpperPermitTxt(
            String(a.innerText || a.textContent || ""),
          );
          const h = capHrefForKeep(a);
          return `${u}|${h.slice(-260)}`;
        })
        .sort();

      const rootSigChunk = rootTextFlat.slice(0, 3800);
      const signature = [
        showing,
        pagerSnippet,
        activePageNum,
        firstRg,
        lastRg,
        String(listCaps.length),
        sortedKeys.join("!"),
        rootSigChunk,
      ].join("###");

      const compactP = compactPermitStr(String(pn ?? ""));
      let hit = null;
      /** @type {string[]} */
      const skippedSuffixMatches = [];
      for (const a of listCaps) {
        const text = norm(String(a.innerText || a.textContent || ""));
        const hrefAttr = String(a.getAttribute("href") ?? "").trim();
        let resolved = "";
        try {
          resolved = String(a.href || "").trim();
        } catch (_) {
          resolved = "";
        }
        const validHref = resolved || hrefAttr;

        const compactText = compactPermitStr(text);

        if (!compactP) continue;

        if (compactText === compactP) {
          hit = {
            hrefRaw: validHref,
            text: text.trim().length ? text : String(validHref).slice(-80),
            matchedBy: "strictExact",
          };
          break;
        }

        if (
          compactText.startsWith(compactP) &&
          compactText.length > compactP.length
        ) {
          const label =
            text.trim().length > 0
              ? text.trim().slice(0, 120)
              : compactText.slice(0, 120);
          if (
            skippedSuffixMatches.length < 32 &&
            !skippedSuffixMatches.includes(label)
          ) {
            skippedSuffixMatches.push(label);
          }
          continue;
        }
      }

      const bodyTc = String(document.body?.textContent || "").replace(
        /\s+/g,
        " ",
      );
      const reBodyPager =
        /Showing\s*\d+\s*-\s*\d+\s*of\s*\d+|Next\s*>?|<\s*Prev|Page\s*\d+/gi;
      const bodyPagerSnippets = [];
      let pm;
      while (
        (pm = reBodyPager.exec(bodyTc)) !== null &&
        bodyPagerSnippets.length < 48
      ) {
        const frag = String(pm[0] || "").trim();
        if (frag && !bodyPagerSnippets.includes(frag))
          bodyPagerSnippets.push(frag);
      }

      return {
        rootMarker: marker,
        rootDiag: { rows },
        showing,
        heading,
        pagerSnippet,
        activePageNum,
        signature,
        linkCountVisible: listCaps.length,
        rawLinkCount,
        droppedLinkCount: dropped,
        droppedLinkSamples: droppedSamples,
        hiddenAncestorNotes,
        firstVisiblePermitText: firstTxt,
        lastVisiblePermitText: lastTxt,
        hit,
        skippedSuffixMatches,
        pagerDiag: {
          rootTextPreview1000: rootTextFlat.slice(0, 1000),
          bodyPagerSnippets,
        },
      };
    }, permitNumber)
  );

  if (logRootDiag && !quietMeta && data.rootDiag && Array.isArray(data.rootDiag.rows)) {
    for (const row of data.rootDiag.rows) {
      console.log(
        `[Arlington][MyRecords] visible root candidates=${row.sel}:links=${row.links}:showing=${row.showing}:next=${row.next}`,
      );
    }
  }
  if (logRootDiag && !quietMeta && data.pagerDiag) {
    const prev = String(data.pagerDiag.rootTextPreview1000 || "")
      .replace(/\s+/g, " ")
      .slice(0, 1000);
    console.log(`[Arlington][MyRecords] selected root text preview=${prev}`);
    const sn =
      data.pagerDiag.bodyPagerSnippets &&
      Array.isArray(data.pagerDiag.bodyPagerSnippets)
        ? data.pagerDiag.bodyPagerSnippets
        : [];
    console.log(
      `[Arlington][MyRecords] body pager text matches=${sn.join(" | ")}`,
    );
  }
  if (!quietMeta) {
    const rawN = Number(data.rawLinkCount),
      keptN = Number(data.linkCountVisible),
      droppedN = Number(data.droppedLinkCount);
    console.log(
      `[Arlington][MyRecords] selected root=${data.rootMarker} rawLinks=${Number.isFinite(rawN) ? rawN : 0} keptLinks=${Number.isFinite(keptN) ? keptN : 0} dropped=${Number.isFinite(droppedN) ? droppedN : 0}`,
    );
    const samples =
      data.droppedLinkSamples && Array.isArray(data.droppedLinkSamples)
        ? data.droppedLinkSamples
        : [];
    if (samples.length) {
      for (const s of samples) {
        const sh = typeof s.href === "string" ? s.href : "";
        console.log(
          `[Arlington][MyRecords] dropped link sample text=${String(s.text || "").slice(0, 220)} href=${sh.slice(0, 520)} reason=${String(s.reason || "").slice(0, 120)}`,
        );
      }
    }
    const ancestorHints =
      data.hiddenAncestorNotes && Array.isArray(data.hiddenAncestorNotes)
        ? data.hiddenAncestorNotes
        : [];
    for (const hn of ancestorHints) {
      console.log(
        `[Arlington][MyRecords] note hidden ancestor for CapDetail link text=${String(hn.text || "").slice(0, 220)} but keeping href`,
      );
    }
  }
  return data;
}

/**
 * Click Next in the scored broad root; pool includes body fallback.
 * @returns {Promise<{ ok: boolean, ctlText: string, hrefOrOnclick: string, rootMarker: string }>}
 */
async function arlingtonTryClickVisibleMyRecordsPagerNext(frame, page) {
  const res = await frame
    .evaluate(() => {
      function norm(t) {
        return String(t || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      const ROOT_SELECTORS = [
        "#PageResult",
        ".ACA_Area_CapHome",
        "#ctl00_PlaceHolderMain_PermitList",
        "#ctl00_PlaceHolderMain_UpdatePanel1",
        ".ThreeColumns",
        "form",
        "body",
      ];

      /** Same root scoring as Arlington probe */
      /** @returns {{ root: HTMLElement; marker: string }} */
      function pickScoredRoot() {
        /** @type {{ sel: string; root: HTMLElement; links: number; showing: boolean; next: boolean; score: number }[]} */
        const list = [];
        for (const sel of ROOT_SELECTORS) {
          const el = document.querySelector(sel);
          if (!(el instanceof HTMLElement)) continue;
          const r = el.getBoundingClientRect();
          const capDetailCount = el.querySelectorAll(
            'a[href*="CapDetail.aspx"]',
          ).length;
          const innerRaw = String(el.textContent || "")
            .replace(/\s+/g, " ")
            .slice(0, 64000);
          const hasShowingText =
            /Showing\s*\d+\s*-\s*\d+\s*of\s*\d+/i.test(innerRaw);
          const hasNextText = /Next\s*>?/i.test(innerRaw);
          const hasRect = r.width >= 8 && r.height >= 8;
          const visibleish = hasRect || capDetailCount > 0;
          if (!visibleish) continue;
          const score =
            capDetailCount * 10 + (hasShowingText ? 5 : 0) + (hasNextText ? 3 : 0);
          list.push({
            sel,
            root: el,
            links: capDetailCount,
            showing: hasShowingText,
            next: hasNextText,
            score,
          });
        }
        list.sort(
          (a, b) => b.score - a.score || b.links - a.links || a.sel.localeCompare(b.sel),
        );
        const best = list[0];
        return best
          ? { root: best.root, marker: best.sel }
          : { root: document.body, marker: "body" };
      }

      /** @returns {string} */
      function buildRaw(el) {
        if (!(el instanceof HTMLElement)) return "";
        /** @type {(string|null|undefined)[]} */
        const parts = [
          el.textContent || "",
          el.innerText || "",
          el instanceof HTMLInputElement ? el.value : "",
          el.title || "",
          el.getAttribute("aria-label"),
          el.getAttribute("href"),
          el.getAttribute("onclick"),
          el.id || "",
          el.name || "",
          el.className || "",
        ].filter((x) => String(x ?? "").trim() !== "");
        return parts.join(" ");
      }

      /** @returns {HTMLElement | null} */
      function resolveClickTarget(el) {
        if (!(el instanceof HTMLElement)) return null;
        const tag = el.tagName.toLowerCase();
        if (tag === "a" || tag === "button" || tag === "input") return el;
        if (String(el.getAttribute("onclick") || "").trim()) return el;
        let n = /** @type {HTMLElement | null} */ (el);
        for (let i = 0; i < 14 && n; i++) {
          const t = n.tagName.toLowerCase();
          if (t === "a" || t === "button" || t === "input") return n;
          if (String(n.getAttribute("onclick") || "").trim()) return n;
          n = n.parentElement;
        }
        return null;
      }

      /** @returns {boolean} */
      function isPrevHeavy(rawL, dispL) {
        if (/<\s*prev/i.test(rawL)) return true;
        if (/^\s*prev\s*$/i.test(dispL)) return true;
        if (/\bprevious\b/i.test(rawL)) return true;
        return /\bprev\b/i.test(rawL) && !/\bpreview\b/i.test(rawL);
      }

      /** @returns {boolean} */
      function pagerContextRaw(rawL) {
        return (
          /gdvpermitlist|pageresult|__dopostback|pagination|gridpaging|aca_linkbutton|pageset|\$page\$/i.test(
            rawL,
          ) ||
          /\b(caplist|gdv|pagerow|pageresult)/i.test(rawL)
        );
      }

      /** @returns {string} */
      function displayLabel(el) {
        if (!(el instanceof HTMLElement)) return "";
        if (el instanceof HTMLInputElement)
          return norm(el.value || el.textContent || "");
        return norm(el.textContent || "");
      }

      /** @returns {{ text: string; id: string; href: string; onclick: string }[]} */
      function mergedPagerDiagnostics(merged, ctGuess) {
        const like =
          /\b(next|prev|page|gdvpermitlist|pageresult|__dopostback|showing)\b|<\s*prev|pageresult|gdvpermitlist|showing\s*\d+\s*-\s*\d+\s*of/i;
        /** @type {{ text: string; id: string; href: string; onclick: string }[]} */
        const diag = [];
        for (const cand of merged) {
          if (!(cand instanceof HTMLElement)) continue;
          const rjRaw = buildRaw(cand);
          const rjl = rjRaw.toLowerCase();
          if (!like.test(rjl)) continue;
          const ct = resolveClickTarget(cand) || ctGuess;
          const sampleText =
            norm(displayLabel(cand) || rjRaw).slice(0, 520) || rjRaw.slice(0, 200);
          const id = cand.id || (ct instanceof HTMLElement ? ct.id : "") || "";
          /** @type {string} */
          let hrefStr = "";
          /** @type {string} */
          let oncStr = "";
          const link =
            ct instanceof HTMLAnchorElement
              ? ct
              : ct?.closest("a") instanceof HTMLAnchorElement
                ? /** @type {HTMLAnchorElement} */ (ct.closest("a"))
                : null;
          if (link) {
            hrefStr = String(link.getAttribute("href") || "").slice(0, 520);
            try {
              if (!hrefStr.trim()) hrefStr = String(link.href || "").slice(0, 520);
            } catch (_) {}
          }
          if (ct instanceof HTMLElement)
            oncStr = String(ct.getAttribute("onclick") || "").slice(0, 520);
          diag.push({ text: sampleText, id, href: hrefStr, onclick: oncStr });
          if (diag.length >= 15) break;
        }
        return diag;
      }

      /** @returns {{ text: string; id: string; href: string; onclick: string }[]} */
      function scoredRowsToDiag(rows) {
        return rows.slice(0, 15).map((s) => {
          const ct = s.clickTarget;
          const sampleText = norm(String(s.textLab || "")).slice(0, 520);
          const id =
            (ct instanceof HTMLElement && ct.id) ||
            (s.el instanceof HTMLElement && s.el.id) ||
            "";
          /** @type {string} */
          let hrefStr = "";
          if (ct instanceof HTMLAnchorElement) {
            hrefStr = String(ct.getAttribute("href") || "").slice(0, 520);
            try {
              if (!hrefStr.trim()) hrefStr = String(ct.href || "").slice(0, 520);
            } catch (_) {}
          }
          const oncStr =
            ct instanceof HTMLElement
              ? String(ct.getAttribute("onclick") || "").slice(0, 520)
              : "";
          return { text: sampleText || id || hrefStr || oncStr || "(element)", id, href: hrefStr, onclick: oncStr };
        });
      }

      /** @typedef {{ el: HTMLElement; clickTarget: HTMLElement; score: number; textLab: string; hrefOrOnclick: string }} PagerCand */

      function hrefOrClickPart(ct, rawFallback) {
        let out = "";
        if (ct instanceof HTMLAnchorElement) {
          out = String(ct.getAttribute("href") || "").slice(0, 520);
          try {
            if (!out.trim()) out = String(ct.href || "").slice(0, 520);
          } catch (_) {}
        }
        if (!out.trim() && ct instanceof HTMLElement)
          out = String(ct.getAttribute("onclick") || "").slice(0, 520);
        if (!out.trim()) out = rawFallback.slice(0, 260);
        return out;
      }

      const { root, marker } = pickScoredRoot();
      const rootTc = String(root.textContent || "").replace(/\s+/g, " ");

      let currentPageNum = /** @type {number|null} */ (null);
      const showRg = rootTc.match(/Showing\s*(\d+)\s*-\s*(\d+)\s*of\s*\d+/i);
      if (showRg) {
        const start = parseInt(showRg[1], 10);
        const end = parseInt(showRg[2], 10);
        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          end >= start
        ) {
          const pageSize = end - start + 1;
          if (pageSize > 0)
            currentPageNum = Math.floor((start - 1) / pageSize) + 1;
        }
      }

      const seen = new Set();
      /** @type {HTMLElement[]} */
      const merged = [];
      function addAll(nl) {
        for (const raw of nl) {
          const n = /** @type {HTMLElement} */ (raw);
          if (!(n instanceof HTMLElement)) continue;
          if (!seen.has(n)) {
            seen.add(n);
            merged.push(n);
          }
        }
      }
      addAll(root.querySelectorAll("a,button,input,span,td"));
      if (document.body) addAll(document.body.querySelectorAll("a,button,input,span,td"));

      /** @type {PagerCand[]} */
      const scored = [];

      for (const el of merged) {
        const rawJoined = buildRaw(el);
        const rawL = rawJoined.toLowerCase();
        const dispNorm = norm(el.textContent || "");
        const dispL = dispNorm.toLowerCase();

        if (isPrevHeavy(rawL, dispL)) continue;

        const clickTarget = resolveClickTarget(el);
        if (!clickTarget) continue;

        if (
          clickTarget instanceof HTMLInputElement &&
          clickTarget.disabled
        )
          continue;

        let score = 0;

        const nextExact =
          /^next\s*>\s*$/i.test(dispNorm) ||
          /^next$/i.test(dispNorm) ||
          /^next\s*>$/i.test(dispNorm);
        if (nextExact) score = Math.max(score, 240);

        if (/__dopostback/i.test(rawJoined) && /next/i.test(dispNorm))
          score = Math.max(score, 236);

        if (/\bnext\s*>\s*$/i.test(rawL)) score = Math.max(score, 230);
        else if (/^next\s*>\s*$/i.test(dispNorm)) score = Math.max(score, 230);

        const ctxStrong = pagerContextRaw(rawL);
        if (/next/i.test(rawJoined) && ctxStrong) score = Math.max(score, 205);

        if (currentPageNum != null && /^\d+$/.test(dispNorm)) {
          const want = String(currentPageNum + 1);
          if (dispNorm === want) {
            score = ctxStrong
              ? Math.max(score, 185)
              : Math.max(score, 145);
          }
        }

        if (
          (/^>$/.test(dispNorm) || dispNorm === "›" || dispNorm === "▶") &&
          /__dopostback|gdvpermitlist|\$page\$|pageresult/i.test(rawL)
        ) {
          score = Math.max(score, 178);
        }

        const tagLc = el.tagName.toLowerCase();
        if (
          (tagLc === "span" || tagLc === "font" || tagLc === "td") &&
          /next/i.test(rawJoined)
        ) {
          score = Math.max(score, 165);
        }

        if (score <= 0) continue;

        scored.push({
          el,
          clickTarget,
          score,
          textLab:
            dispNorm.slice(0, 220) || rawJoined.slice(0, 120),
          hrefOrOnclick: hrefOrClickPart(
            /** @type {HTMLElement} */ (clickTarget),
            rawJoined,
          ),
        });
      }

      scored.sort((a, b) => b.score - a.score);

      /** Dedupe — one entry per clickable target */
      /** @type {Map<HTMLElement, PagerCand>} */
      const byTarget = new Map();
      for (const row of scored) {
        const prev = byTarget.get(row.clickTarget);
        if (!prev || row.score > prev.score) byTarget.set(row.clickTarget, row);
      }

      /** @type {PagerCand[]} */
      const scoredUnique = [...byTarget.values()].sort(
        (a, b) => b.score - a.score,
      );

      /** @typedef {{ ok:boolean, ctlText:string, hrefOrOnclick:string, rootMarker:string, diagSamples: object[] }} PagerEv */

      /** @returns {PagerEv} */
      function failMerged() {
        return {
          ok: false,
          ctlText: "(none)",
          hrefOrOnclick: "(none)",
          rootMarker: marker,
          diagSamples: mergedPagerDiagnostics(merged, undefined),
        };
      }

      const bestPick = scoredUnique[0];
      if (!bestPick) return failMerged();

      try {
        bestPick.clickTarget.scrollIntoView({
          block: "center",
          inline: "nearest",
        });
        bestPick.clickTarget.click();
        return {
          ok: true,
          ctlText: norm(bestPick.textLab).slice(0, 260),
          hrefOrOnclick: bestPick.hrefOrOnclick.slice(0, 520),
          rootMarker: marker,
          diagSamples: [],
        };
      } catch (_) {
        return {
          ok: false,
          ctlText: norm(bestPick.textLab).slice(0, 260),
          hrefOrOnclick: bestPick.hrefOrOnclick.slice(0, 520),
          rootMarker: marker,
          diagSamples: scoredRowsToDiag(scoredUnique),
        };
      }
    })
    .catch(() => ({
      ok: false,
      ctlText: "(error)",
      hrefOrOnclick: "(error)",
      rootMarker: "",
      diagSamples: [],
    }));

  if (
    res &&
    !res.ok &&
    Array.isArray(res.diagSamples) &&
    res.diagSamples.length > 0
  ) {
    for (const d of res.diagSamples.slice(0, 15)) {
      console.log(
        `[Arlington][MyRecords] pager candidate sample text=${String(d.text || "").slice(0, 520)} id=${String(d.id || "")} href=${String(d.href || "").slice(0, 520)} onclick=${String(d.onclick || "").slice(0, 520)}`,
      );
    }
  }

  if (res && res.ok) {
    await waitForAccelaLoad(page).catch(() => {});
    await page.waitForTimeout(450).catch(() => {});
  }
  return res;
}

/**
 * Page the visible My Records list until match or no Next / stall.
 */
async function arlingtonVisibleMyRecordsPagedWalk(
  page,
  frame,
  mainFi,
  permitNumber,
  frameLabel,
) {
  for (let vPage = 1; vPage <= MAX_ARLINGTON_VISIBLE_MYRECORDS_PAGES; vPage++) {
    const probe = await arlingtonProbeVisibleMyRecordsFrame(
      frame,
      permitNumber,
      { logRootDiag: vPage === 1 },
    ).catch(() => null);
    if (!probe) {
      console.log(
        `[Arlington][MyRecords] visible probe failed page=${vPage} frame=${frameLabel}`,
      );
      break;
    }

    const headingSafe = (probe.heading || "").slice(0, 220);
    const showingSafe = probe.showing || "(none)";
    const skippedSuffix = Array.isArray(probe.skippedSuffixMatches)
      ? probe.skippedSuffixMatches
      : [];
    console.log(
      `[Arlington][MyRecords] page=${vPage} strictExact=${!!probe.hit} skippedSuffixMatches=${JSON.stringify(skippedSuffix)}`,
    );
    console.log(
      `[Arlington][MyRecords] visible list page=${vPage} links=${probe.linkCountVisible} heading=${headingSafe} showing=${showingSafe}`,
    );

    if (
      probe.hit &&
      typeof probe.hit.hrefRaw === "string" &&
      probe.hit.hrefRaw.trim()
    ) {
      let baseHref = page.url();
      if (frame !== mainFi) {
        try {
          baseHref = frame.url();
        } catch (_) {
          baseHref = page.url();
        }
      }
      const absolute = /^https?:/i.test(probe.hit.hrefRaw)
        ? probe.hit.hrefRaw
        : new URL(probe.hit.hrefRaw, baseHref || page.url()).href;
      console.log(
        `[Arlington][MyRecords] strict exact match found permit=${permitNumber} page=${vPage}`,
      );
      console.log(
        `[Arlington][MyRecords] visible exact match href=${absolute}`,
      );
      return {
        foundLink: null,
        foundFrame: frame === mainFi ? page : frame,
        foundInfo: {
          method: "arlington-myrecords-visible-paged",
          text:
            typeof probe.hit.text === "string" && probe.hit.text.trim().length > 0
              ? probe.hit.text.trim()
              : permitNumber,
          href: absolute,
          frameName: frame === mainFi ? "main" : frame.name() || "",
          frameUrl:
            frame === mainFi
              ? page.url()
              : (() => {
                  try {
                    return frame.url();
                  } catch (_) {
                    return page.url();
                  }
                })() || "",
          openViaGoto: true,
          visibleListPage: vPage,
          rootMarker: probe.rootMarker || "",
          matchedBy:
            typeof probe.hit.matchedBy === "string"
              ? probe.hit.matchedBy
              : undefined,
        },
      };
    }

    const sigBefore = probe.signature || "";

    console.log(
      `[Arlington][MyRecords] no strict exact match on page=${vPage}; clicking Next`,
    );
    const nextRes = await arlingtonTryClickVisibleMyRecordsPagerNext(
      frame,
      page,
    );
    if (!nextRes || !nextRes.ok) {
      console.log(
        `[Arlington][MyRecords] visible list exhausted pages=${vPage}`,
      );
      return null;
    }

    console.log(
      `[Arlington][MyRecords] visible pager next found text=${nextRes.ctlText || "(none)"} href=${nextRes.hrefOrOnclick || "(none)"}`,
    );
    console.log(
      `[Arlington][MyRecords] clicked visible Next page=${vPage} result=ok`,
    );

    const deadline = Date.now() + 16000;
    let changed = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(220);
      const snap = await arlingtonProbeVisibleMyRecordsFrame(
        frame,
        permitNumber,
        { quiet: true },
      ).catch(() => null);
      if (snap && snap.signature && snap.signature !== sigBefore) {
        console.log(
          `[Arlington][MyRecords] visible signature changed page=${vPage}`,
        );
        changed = true;
        break;
      }
    }

    if (!changed) {
      console.log(
        `[Arlington][MyRecords] visible pager stalled (no signature change) page=${vPage}`,
      );
      break;
    }
  }
  return null;
}

/** True when permit search must use Arlington strict My Records pagination (any scrape mode). */
function isArlingtonTenantSearchContext(page) {
  if (!page) return false;
  if (page._isArlington) return true;
  const u = page.url() || "";
  if (/\/ARLINGTONCO\//i.test(u)) return true;
  const prof = page._accelaTenantProfile;
  return !!(prof && prof.key === "arlington_county_va");
}

/**
 * Navigate to My Records (from Dashboard, CapDetail, or other Arlington pages), wait for grids,
 * expand accordion sections — shared prep for every Arlington scrape mode.
 */
async function arlingtonEnsureMyRecordsListReady(page) {
  page._isArlington = true;
  if (!page._accelaTenantProfile) {
    page._accelaTenantProfile =
      resolveAccelaTenantProfile(page.url()) ?? ArlingtonAccelaProfile;
  }

  let currentUrl = page.url() || "";
  if (!/\/MyRecordsCap\.aspx/i.test(currentUrl)) {
    console.log(
      `[Arlington][MyRecords] ensuring list page (current=${currentUrl.slice(0, 120)})`,
    );
    if (/\/Dashboard\.aspx/i.test(currentUrl)) {
      await arlingtonNavigateDashboardToMyRecordsCap(page);
    } else {
      try {
        const origin = new URL(
          /\/ARLINGTONCO\//i.test(currentUrl)
            ? currentUrl
            : ArlingtonAccelaProfile.baseUrl,
        ).origin;
        const target = `${origin}${ArlingtonAccelaProfile.myRecordsPath}`;
        console.log(`[Arlington][MyRecords] direct goto: ${target}`);
        await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
        await page
          .waitForURL(/MyRecordsCap\.aspx/i, { timeout: 20000 })
          .catch(() => {});
        await waitForAccelaLoad(page);
        await page.waitForTimeout(1500);
      } catch (err) {
        console.warn(
          `[Arlington][MyRecords] direct goto failed: ${err.message}`,
        );
      }
    }
    currentUrl = page.url() || "";
    console.log(`[Arlington][MyRecords] after nav: ${currentUrl.slice(0, 120)}`);
  }

  console.log("[Arlington][MyRecords] waiting for grids...");
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll('table[id*="gdvPermitList"]').length > 0 ||
        document.querySelectorAll('a[href*="CapDetail.aspx"]').length > 0,
      { timeout: 30000 },
    );
  } catch (err) {
    console.warn("[Arlington][MyRecords] grid wait failed:", err.message);
  }
  await expandArlingtonMyRecordsSections(page);
  await logArlingtonMyRecordsGridDiagnostics(page).catch(() => {});

  console.log("[Arlington][MyRecords] waiting for records grid...");
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('table[id*="gdvPermitList"]').length > 0 ||
        document.querySelectorAll('a[href*="CapDetail.aspx"]').length > 0,
      { timeout: 15000 },
    )
    .then(() => {})
    .catch(() => null);
  await saveCheckpointScreenshot(page, "after_records_page").catch(() => {});
}

/**
 * Shared Arlington permit lookup: strict exact match + My Records pagination (all scrape modes).
 * @returns {Promise<{foundLink:any,foundFrame:any,foundInfo: Record<string, unknown>}|null>}
 */
async function arlingtonSearchPermitStrictInMyRecords(page, permitNumber) {
  await arlingtonEnsureMyRecordsListReady(page);
  return arlingtonFindPermitAcrossAllMyRecords(page, permitNumber);
}

/**
 * Arlington My Records: walk visible list + broad pager; grid ids logged for diagnostics only.
 * @returns {Promise<{foundLink:any,foundFrame:any,foundInfo: Record<string, unknown>}|null>}
 */
async function arlingtonFindPermitAcrossAllMyRecords(page, permitNumber) {
  const mainFi = page.mainFrame();

  /** @type {{ frame: import("playwright").Frame; label: string }[]} */
  const contexts = [{ frame: mainFi, label: "main" }];
  for (const frame of page.frames()) {
    if (frame === mainFi) continue;
    contexts.push({
      frame,
      label: `"${frame.name() || "unnamed"}" ${String(frame.url() || "").slice(
        0,
        128,
      )}`,
    });
  }

  for (const { frame, label } of contexts) {
    let gridDiag = [];
    try {
      gridDiag = await frame.evaluate(() =>
        [
          ...new Set(
            [...document.querySelectorAll('table[id*="gdvPermitList"]')]
              .map((t) => (t instanceof HTMLTableElement && t.id ? t.id : ""))
              .filter(Boolean),
          ),
        ],
      );
    } catch (_) {
      gridDiag = [];
    }
    if (gridDiag.length) {
      console.log(
        `[Arlington][MyRecords] discovered grids=${gridDiag.length} ids=${gridDiag.join(", ")} frame=${label}`,
      );
    }

    const got = await arlingtonVisibleMyRecordsPagedWalk(
      page,
      frame,
      mainFi,
      permitNumber,
      label,
    );
    if (got) return got;
  }

  console.log(
    `[Arlington][MyRecords] searched all pages; strict exact permit not found ${permitNumber}`,
  );
  return null;
}


async function searchPermit(page, portalUrl, permitNumber) {
  console.log(`  Searching for permit: ${permitNumber}`);

  const arlingtonTenantByUrl = () =>
    /\/ARLINGTONCO\//i.test(page.url() || "");
  /** Shared flag for every Arlington scrape mode (not only when already on MyRecordsCap). */
  const isArlingtonTenantContext = isArlingtonTenantSearchContext(page);

  let isAuth = await findAuthLandmark(page);
  if (!isAuth && shouldUseAccelaDashboardMyRecordsNav(page)) {
    if (isFairfaxPortal(page)) {
      try {
        await fairfaxNavigateDashboardToMyRecordsCap(page);
        isAuth = await findAuthLandmark(page);
        if (isAuth) {
          console.log(
            "[Accela] Fairfax My Records navigation succeeded (auth landmarks now visible)",
          );
        } else {
          console.log(
            "[Accela] Fairfax My Records navigation failed, continuing to normal auth failure path",
          );
        }
      } catch (err) {
        console.log(
          `[Accela] Fairfax My Records navigation failed, continuing to normal auth failure path (${err.message})`,
        );
      }
    } else if (isArlingtonPortal(page) || arlingtonTenantByUrl()) {
      try {
        await arlingtonNavigateDashboardToMyRecordsCap(page);
        isAuth = await findAuthLandmark(page);
        if (isAuth) {
          console.log(
            "[Accela] Arlington My Records navigation succeeded (auth landmarks now visible)",
          );
        } else {
          console.log(
            "[Accela] Arlington My Records navigation failed, continuing to normal auth failure path",
          );
        }
      } catch (err) {
        console.log(
          `[Accela] Arlington My Records navigation failed, continuing to normal auth failure path (${err.message})`,
        );
      }
    } else {
      console.log(
        "[Accela] dashboard detected before auth failure, attempting My Records navigation (Baltimore-style :has-text + force click)",
      );
      try {
        await accelaClickMyRecordsNavFromDashboard(page);
        isAuth = await findAuthLandmark(page);
        if (isAuth) {
          console.log("[Accela] My Records navigation succeeded (auth landmarks now visible)");
        } else {
          console.log(
            "[Accela] My Records navigation failed, continuing to normal auth failure path",
          );
        }
      } catch (err) {
        console.log(
          `[Accela] My Records navigation failed, continuing to normal auth failure path (${err.message})`,
        );
      }
    }
  }
  if (!isAuth) {
    await dumpPageDiagnostics(page, "SEARCH_AUTH_CHECK");
    throw new Error(
      "AUTHENTICATION_LOST: No authenticated landmarks found before permit search.",
    );
  }
  console.log("  ✅ Authentication verified");

  {
    let currentUrl = page.url();
    const arlingtonByUrl = /\/ARLINGTONCO\//i.test(currentUrl);
    const arlingtonByProfile = isArlingtonPortal(page) || page._isArlington;
    const isArlington = !!(arlingtonByProfile || arlingtonByUrl);

    if (isArlington) {
      console.log(
        `[Arlington] current scrape URL before record-list nav: ${currentUrl}`,
      );
      page._isArlington = true;
      if (!page._accelaTenantProfile) {
        page._accelaTenantProfile =
          resolveAccelaTenantProfile(page.url()) ?? ArlingtonAccelaProfile;
      }
    }

    if (
      isArlington &&
      /Dashboard\.aspx/i.test(currentUrl) &&
      !/MyRecordsCap\.aspx/i.test(currentUrl)
    ) {
      console.log(
        `[Arlington] forcing Dashboard -> My Records navigation`,
      );
      await arlingtonNavigateDashboardToMyRecordsCap(page);
      currentUrl = page.url();
      console.log(`[Arlington] after My Records nav: ${currentUrl}`);
    }
  }

  if (isFairfaxPortal(page) && shouldUseAccelaDashboardMyRecordsNav(page)) {
    try {
      await fairfaxNavigateDashboardToMyRecordsCap(page);
      console.log(`  [Fairfax] after My Records navigation, URL: ${page.url()}`);
    } catch (err) {
      console.log(`  [Fairfax] My Records navigation warning: ${err.message}`);
    }
  } else if (
    (isArlingtonPortal(page) || arlingtonTenantByUrl()) &&
    shouldUseAccelaDashboardMyRecordsNav(page)
  ) {
    try {
      await arlingtonNavigateDashboardToMyRecordsCap(page);
      console.log(
        `  [Arlington] after My Records navigation, URL: ${page.url()}`,
      );
    } catch (err) {
      console.log(`  [Arlington] My Records navigation warning: ${err.message}`);
    }
  } else if (shouldUseAccelaDashboardMyRecordsNav(page)) {
    try {
      console.log(
        '  [Accela] on Dashboard, navigating to My Records (Baltimore-style) for permit list',
      );
      await accelaClickMyRecordsNavFromDashboard(page);
      console.log(`  [Accela] after My Records navigation, URL: ${page.url()}`);
    } catch (err) {
      console.log(`  [Accela] My Records navigation warning: ${err.message}`);
    }
  }

  const permitsTab =
    isArlingtonTenantContext
      ? null
      : await findFieldInFrames(page, [
          "#Tab_Building",
          'a:has-text("Permits and Inspections")',
          'a:has-text("Permits & Inspections")',
          'a[title*="Permits"]',
          '#header_main_menu a:has-text("Permits")',
        ]);

  if (permitsTab) {
    console.log("  Clicking Permits tab...");
    await permitsTab.click();
    await waitForAccelaLoad(page);
    await page.waitForTimeout(3000);
    await saveCheckpointScreenshot(page, "after_permits_page");
  } else {
    const isPublicPage = await page.$(
      'a:has-text("Sign In"), a:has-text("Create an Account")',
    );
    if (isPublicPage) {
      throw new Error("Session dropped — redirected to public page.");
    }
    if (!isArlingtonTenantContext) {
      console.log(
        "  ⚠️ Permits tab not found, attempting to proceed on current page...",
      );
    }
  }

  console.log("  ⏳ Waiting for records grid...");
  let gridAppeared = null;
  if (!isArlingtonTenantContext) {
    const gridWaitSelector =
      'table[id*="PermitList"] tr, table[id*="Record"] tr, .aca_grid_container tr td a, [id*="gview_List"] tr';
    gridAppeared = await page
      .waitForSelector(gridWaitSelector, { visible: true, timeout: 15000 })
      .catch(() => null);
  }

  if (!gridAppeared && !isArlingtonTenantContext) {
    let gridInFrame = false;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const frameGrid = await frame
        .$("table tr td a, .aca_grid_container")
        .catch(() => null);
      if (frameGrid) {
        console.log(
          `  ✅ Grid found in frame: ${frame.name() || frame.url().substring(0, 60)}`,
        );
        gridInFrame = true;
        break;
      }
    }
    if (!gridInFrame) {
      await dumpPageDiagnostics(page, "NO_GRID");
      const anchorCount = await page.evaluate(
        () => document.querySelectorAll("a").length,
      );
      console.log(`  [DIAG:NO_GRID] Total anchors on page: ${anchorCount}`);
    }
  } else {
    await saveCheckpointScreenshot(page, "after_records_page");
  }

  console.log("  Scanning for permit link...");

  let foundLink = null;
  let foundFrame = null;
  let foundInfo = {};

  if (isArlingtonTenantContext) {
    console.log(
      "[Arlington][MyRecords] strict exact search (shared path for all scrape modes)...",
    );
    const arHit = await arlingtonSearchPermitStrictInMyRecords(
      page,
      permitNumber,
    );
    if (arHit && arHit.foundInfo && arHit.foundInfo.method) {
      foundLink = arHit.foundLink;
      foundFrame = arHit.foundFrame;
      foundInfo = arHit.foundInfo;
    }
  } else {
    const listLogTag = page._isBaltimore
      ? " baltimore"
      : page._isArlington || arlingtonTenantByUrl()
        ? " arlington"
        : "";
    for (let listPage = 1; listPage <= MAX_ACCELA_PERMIT_LIST_PAGES; listPage++) {
      console.log(`  [Accela search]${listLogTag} list page ${listPage}`);
      const hit = await findPermitLinkInAccelaList(page, permitNumber);
      foundLink = hit.foundLink;
      foundFrame = hit.foundFrame;
      foundInfo = hit.foundInfo;
      if (foundLink || foundInfo.method) break;
      if (listPage >= MAX_ACCELA_PERMIT_LIST_PAGES) break;
      const advanced = await tryClickAccelaPermitGridNext(page);
      if (!advanced) break;
    }
  }

  if (!foundLink && !foundInfo.method) {
    const visibleTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .filter((a) => a.offsetWidth > 0)
        .slice(0, 25)
        .map((a) =>
          (a.textContent || "").replace(/\s+/g, " ").trim().substring(0, 80),
        );
    });
    console.log(
      "  Visible anchor texts:",
      JSON.stringify(visibleTexts.filter((t) => t.length > 0)),
    );
    await dumpPageDiagnostics(page, "PERMIT_NOT_FOUND");
    if (isScraperDebugArtifactsEnabled()) {
      await page
        .screenshot({ path: "grid_not_found.png", fullPage: true })
        .catch(() => {});
    }
    throw new Error(`Permit ${permitNumber} not found in the records list.`);
  }

  console.log(
    `  ✅ Found permit link: method=${foundInfo.method} text="${foundInfo.text}" href="${(foundInfo.href || "").substring(0, 100)}" frame=${foundInfo.frameName}`,
  );

  const urlBefore = page.url();

  if (foundLink) {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
      foundLink.click(),
    ]);
  } else if (
    typeof foundInfo.href === "string" &&
    /CapDetail\.aspx/i.test(foundInfo.href) &&
    (foundInfo.method === "arlington-capdetail-dom" ||
      foundInfo.openViaGoto === true)
  ) {
    const raw = foundInfo.href;
    const targetUrl =
      /^https?:/i.test(raw) ? raw : new URL(raw, urlBefore || page.url()).href;
    console.log(
      `[Arlington] navigating to CapDetail (${String(foundInfo.method)}): ${targetUrl.substring(0, 120)}…`,
    );
    await page
      .goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 50000 })
      .catch(async (err) => {
        console.warn(
          `[Arlington] CapDetail goto warning (${err.message}) — retry networkidle`,
        );
        await page
          .goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 })
          .catch(() => {});
      });
  } else if (foundFrame && foundInfo.method === "frame-evaluate") {
    const pickText = (foundInfo.text || "").replace(/\s+/g, " ").trim();
    const relaxedArlingtonFrame =
      page._isArlington ||
      /\/ARLINGTONCO\//i.test(urlBefore || page.url() || "");
    await foundFrame
      .evaluate(
        ({ linkText, relaxedArlington }) => {
          const anchors = Array.from(document.querySelectorAll("a"));
          const want = String(linkText || "").replace(/\s+/g, " ").trim();
          const match = anchors.find((a) => {
            const text = (a.textContent || "").replace(/\s+/g, " ").trim();
            if (text !== want) return false;
            if (relaxedArlington) {
              const h = String(
                a.getAttribute("href") || a.href || "",
              ).toLowerCase();
              return h.includes("capdetail") || a.offsetWidth > 0;
            }
            return a.offsetWidth > 0;
          });
          if (match) match.click();
        },
        {
          linkText: pickText,
          relaxedArlington: relaxedArlingtonFrame,
        },
      )
      .catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => {});
  }

  await waitForAccelaLoad(page);

  console.log("  ⏳ Verifying record detail loaded...");
  const urlAfter = page.url();
  console.log(`  [DIAG:POST_CLICK] urlBefore=${urlBefore.substring(0, 100)}`);
  console.log(`  [DIAG:POST_CLICK] urlAfter=${urlAfter.substring(0, 100)}`);
  if (
    (page._isArlington || /\/ARLINGTONCO\//i.test(page.url() || "")) &&
    /CapDetail\.aspx/i.test(urlAfter || "")
  ) {
    console.log(
      `  [Arlington] Record detail (CapDetail.aspx) opened — agencyCode in URL: ${/agencyCode=ARLINGTONCO/i.test(urlAfter) ? "ARLINGTONCO" : "check query"}`,
    );
  }

  const allFrames = page.frames();
  let recordFrame = null;
  for (let i = 0; i < allFrames.length; i++) {
    const f = allFrames[i];
    const fUrl = f.url();
    const fName = f.name() || "(unnamed)";
    const preview = await f
      .evaluate(() => {
        return document.body
          ? document.body.innerText
              .substring(0, 300)
              .replace(/\s+/g, " ")
              .trim()
          : "";
      })
      .catch(() => "(inaccessible)");
    console.log(
      `  [DIAG:FRAME ${i}] name="${fName}" url=${fUrl.substring(0, 120)}`,
    );
    console.log(`  [DIAG:FRAME ${i}] preview="${preview.substring(0, 200)}"`);

    if (
      fUrl.includes("Cap/CapDetail") ||
      fUrl.includes("capDetail") ||
      fUrl.includes("Record") ||
      fUrl.includes("permit")
    ) {
      recordFrame = f;
      console.log(`  ✅ Record detail frame identified: ${fName}`);
    }
  }

  if (!recordFrame) {
    for (const f of allFrames) {
      const hasPermit = await f
        .evaluate((pn) => {
          return document.body ? document.body.innerText.includes(pn) : false;
        }, permitNumber)
        .catch(() => false);
      if (hasPermit && f !== page.mainFrame()) {
        recordFrame = f;
        console.log(
          `  ✅ Record frame found by permit number match: ${f.name() || f.url().substring(0, 80)}`,
        );
        break;
      }
      if (hasPermit && f === page.mainFrame()) {
        console.log(`  ✅ Permit number found in main frame`);
      }
    }
  }

  await waitForRecordDetailStrong(page, recordFrame, permitNumber);
  await saveCheckpointScreenshot(page, "after_record_detail");
  page._recordFrame = recordFrame;
}

async function waitForRecordDetailStrong(page, recordFrame, permitNumber) {
  const contexts = recordFrame ? [recordFrame, page] : [page];
  const detailSignals = [
    '[id*="lblPermitNumber"]',
    '[id*="capNumber"]',
    '[id*="PermitNumber"]',
    '[id*="lblPermitType"]',
    '[id*="lblCapType"]',
    '[id*="lblPermitStatus"]',
    '[id*="lblCapStatus"]',
    '[id*="PermitDetailList"]',
    '[id*="CAPDetail"]',
    ".aca_page_title",
    '[id*="TabDataList"]',
  ];

  for (let elapsed = 0; elapsed < 20000; elapsed += 2000) {
    for (const ctx of contexts) {
      for (const sel of detailSignals) {
        const el = await ctx.$(sel).catch(() => null);
        if (el) {
          const text = await el
            .evaluate((e) => (e.textContent || "").trim().substring(0, 80))
            .catch(() => "");
          const ctxName =
            ctx === page ? "main" : ctx.name ? ctx.name() || "frame" : "frame";
          console.log(
            `  ✅ Record detail signal found: sel="${sel}" text="${text}" in ${ctxName}`,
          );
          return ctx;
        }
      }
      const hasPermitText = await ctx
        .evaluate((pn) => {
          return document.body ? document.body.innerText.includes(pn) : false;
        }, permitNumber)
        .catch(() => false);
      if (hasPermitText) {
        const ctxName =
          ctx === page ? "main" : ctx.name ? ctx.name() || "frame" : "frame";
        console.log(
          `  ✅ Permit number "${permitNumber}" found in ${ctxName} body text`,
        );
        return ctx;
      }
    }
    await page.waitForTimeout(2000);
  }

  console.log(
    "  ⚠️ No strong record detail signals found after 20s, proceeding with best-effort extraction",
  );
  if (isScraperDebugArtifactsEnabled()) {
    await page
      .screenshot({ path: "record_not_loaded.png", fullPage: true })
      .catch(() => {});
  }
  return contexts[0];
}

function getExtractionContext(page) {
  return page._recordFrame || page;
}

/** Arlington CapDetail: URL or tenant flag */
function isArlingtonCapDetailPage(page) {
  if (!page) return false;
  const u = page.url() || "";
  if (!/CapDetail\.aspx/i.test(u)) return false;
  return !!(page._isArlington || /\/ARLINGTONCO\//i.test(u));
}

/**
 * When tab clicks fail — dump candidate elements for diagnostics (Arlington only).
 */
async function logArlingtonDetailTabCandidates(page, label) {
  if (!isArlingtonCapDetailPage(page)) return;
  console.log(
    `  [Arlington][PlanReview] top tab candidates (${label || "scan"}): URL=${(page.url() || "").slice(0, 160)}`,
  );
  const roots = [page];
  for (const f of page.frames()) {
    if (f !== page.mainFrame()) roots.push(f);
  }
  for (let i = 0; i < roots.length; i++) {
    const ctx = roots[i];
    const name = ctx === page ? "main" : `frame[${i}]`;
    const sample = await ctx
      .evaluate(() => {
        const rx =
          /Record Info|Payments|Plan Review|Attachments|Documents|Review|Approved|Project Information|OnBase/i;
        const out = [];
        document
          .querySelectorAll("a, button, [role='button'], span, li")
          .forEach((el) => {
            const t = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (!t || t.length > 120) return;
            if (!rx.test(t)) return;
            const st = window.getComputedStyle(el);
            const vis =
              !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
            const hidden = st.visibility === "hidden" || st.display === "none";
            out.push({
              text: t.slice(0, 100),
              id: el.id || "",
              className: String(el.className || "").slice(0, 120),
              href:
                el.tagName === "A"
                  ? (el.getAttribute("href") || "").slice(0, 180)
                  : "",
              visibleish: vis && !hidden,
            });
          });
        return out.slice(0, 40);
      })
      .catch(() => []);
    const iframes = await ctx
      .evaluate(() =>
        [...document.querySelectorAll("iframe")].map((ifr) => ({
          id: ifr.id || "",
          name: ifr.name || "",
          src: (ifr.getAttribute("src") || "").slice(0, 200),
        })),
      )
      .catch(() => []);
    console.log(
      `    ${name}: elements≈${sample.length} — ${JSON.stringify(sample.slice(0, 12)).slice(0, 800)}`,
    );
    if (iframes.length)
      console.log(
        `    ${name}: iframes=${JSON.stringify(iframes.slice(0, 8)).slice(0, 600)}`,
      );
  }
}

/**
 * Click an Arlington CapDetail top tab (Record Info, Plan Review, Payments, …).
 * @returns {Promise<{ ok: boolean, selectorHint?: string }>}
 */
async function clickArlingtonTopTab(page, tabText) {
  if (!isArlingtonCapDetailPage(page)) {
    return { ok: false };
  }
  console.log(`[Arlington][Tabs] trying top tab: ${tabText}`);

  const contexts = [];
  const seen = new Set();
  function addCtx(c) {
    if (!c) return;
    if (typeof c.locator !== "function" && typeof c.$ !== "function") return;
    if (seen.has(c)) return;
    seen.add(c);
    contexts.push(c);
  }
  addCtx(page);
  if (page._recordFrame) addCtx(page._recordFrame);
  for (const fr of page.frames()) {
    if (fr === page.mainFrame()) continue;
    const u = (fr.url() || "").toLowerCase();
    if (
      u.includes("capdetail") ||
      u.includes("arlingtonco") ||
      u.includes("accela.com") ||
      !u ||
      u === "about:blank"
    ) {
      addCtx(fr);
    }
  }

  const trySelectors = [
    `a:has-text("${tabText}")`,
    `button:has-text("${tabText}")`,
    `li:has-text("${tabText}")`,
    `span:has-text("${tabText}")`,
    "a.par-menu.NotShowLoading",
  ];

  // Arlington: `#tab-custom_component` is Accela chrome only — documents live on Arlington ERMS; use findArlingtonExternalPlanReviewHref().
  if (tabText === "Record Info") {
    trySelectors.push('a[href*="CapDetail.aspx"][href*="#"]');
    trySelectors.push('a[href*="CapDetail.aspx"]');
  }
  if (tabText === "Payments") {
    trySelectors.push('a[href*="tab-fee"]');
    trySelectors.push('a[href*="Payment"]');
  }

  for (const ctx of contexts) {
    for (const sel of trySelectors) {
      if (!sel) continue;
      try {
        let handle = null;
        if (typeof ctx.locator === "function") {
          const loc = ctx.locator(sel).first();
          if ((await loc.count().catch(() => 0)) > 0) {
            handle = await loc.elementHandle().catch(() => null);
          }
        }
        if (!handle && typeof ctx.$ === "function") {
          handle = await ctx.$(sel).catch(() => null);
        }
        if (!handle) continue;

        const meta = await handle
          .evaluate((el) => ({
            tag: el.tagName,
            text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
            href: el.getAttribute("href") || "",
            id: el.id || "",
          }))
          .catch(() => null);
        if (!meta) continue;

        const textOk =
          meta.text === tabText || (meta.text || "").startsWith(tabText + " ");
        /** Plan Review docs live off-site; refuse generic selectors unless href targets Arlington ERMS. */
        if (!textOk) {
          if (tabText !== "Plan Review") continue;
          const hlow = String(meta.href || "").toLowerCase();
          const externalPr =
            /prd-ermsaccela/i.test(hlow) &&
            /planreview/i.test(hlow) &&
            !/aca-prod\.accela\.com/i.test(hlow);
          if (!externalPr) continue;
        }

        const baseUrl = page.url();
        let navigated = false;
        try {
          await handle.scrollIntoViewIfNeeded().catch(() => {});
          const vis = await handle.isVisible().catch(() => false);
          if (vis) {
            await handle.click({ force: true, timeout: 8000 }).catch(() => {});
          } else if (meta.href) {
            const raw = meta.href.trim();
            if (raw.startsWith("#")) {
              const abs = new URL(raw, baseUrl).href;
              await page.goto(abs, {
                waitUntil: "domcontentloaded",
                timeout: 25000,
              }).catch(() => {});
              navigated = true;
            } else if (/^javascript:/i.test(raw)) {
              await handle.evaluate((el) => el.click()).catch(() => {});
            } else {
              const abs = /^https?:/i.test(raw)
                ? raw
                : new URL(raw, baseUrl).href;
              await page.goto(abs, {
                waitUntil: "domcontentloaded",
                timeout: 25000,
              }).catch(() => {});
              navigated = true;
            }
          } else {
            await handle
              .evaluate((el) =>
                el.dispatchEvent(new MouseEvent("click", { bubbles: true })),
              )
              .catch(() => {});
          }
        } catch (_) {
          await handle
            .evaluate((el) => {
              try {
                el.click();
              } catch (_) {
                el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              }
            })
            .catch(() => {});
        }

        await waitForAccelaLoad(page).catch(() => {});
        await page.waitForTimeout(600).catch(() => {});
        console.log(
          `[Arlington][Tabs] clicked ${tabText} via selector: ${sel.slice(0, 100)}${navigated ? " (navigation)" : ""}`,
        );
        return { ok: true, selectorHint: sel };
      } catch (_) {
        /* next */
      }
    }
  }

  console.log(`[Arlington][Tabs] could not activate tab: ${tabText}`);
  return { ok: false };
}

async function ensureArlingtonRecordInfoActive(page) {
  if (!isArlingtonCapDetailPage(page)) return { ok: false };
  const { ok } = await clickArlingtonTopTab(page, "Record Info");
  if (!ok) {
    await logArlingtonDetailTabCandidates(page, "Record Info");
  }

  const signals = [
    "#ctl00_PlaceHolderMain_lblPermitNumber",
    "#ctl00_PlaceHolderMain_shAttachment_lblSectionTitle",
    '[id*="shAttachment_lblSectionTitle"]',
  ];

  const textSignals = ["Application Information", "Attachments"];

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const roots = [page, page._recordFrame].filter(Boolean);
    for (const root of roots) {
      for (const s of signals) {
        try {
          if (typeof root.$ === "function") {
            const el = await root.$(s).catch(() => null);
            if (el) {
              console.log("  [Arlington][RecordInfo] active — found:", s);
              return { ok: true };
            }
          }
        } catch (_) {
          /**/
        }
      }
      for (const txt of textSignals) {
        try {
          const hit = await root
            .evaluate((t) => {
              const b = document.body;
              return b
                ? (b.innerText || "").toLowerCase().includes(t.toLowerCase())
                : false;
            }, txt)
            .catch(() => false);
          if (hit) {
            console.log(
              "  [Arlington][RecordInfo] active — body text includes:",
              txt,
            );
            return { ok: true };
          }
        } catch (_) {
          /**/
        }
      }
    }
    await page.waitForTimeout(400).catch(() => {});
  }

  const snippet = await page
    .evaluate(() =>
      document.body
        ? (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500)
        : "",
    )
    .catch(() => "");
  console.log(
    `  [Arlington][RecordInfo] visible text sample after activating Record Info: ${snippet.slice(0, 400)}`,
  );
  const nTables = await page
    .evaluate(() => document.querySelectorAll("table").length)
    .catch(() => 0);
  console.log(`  [Arlington][RecordInfo] tables found: ${nTables}`);
  return { ok: !!ok };
}

async function ensureArlingtonPlanReviewActive(page) {
  if (!isArlingtonCapDetailPage(page)) return { ok: false };
  const r = await clickArlingtonTopTab(page, "Plan Review");
  if (!r.ok) await logArlingtonDetailTabCandidates(page, "Plan Review");

  const deadline = Date.now() + 20000;
  const needles = [
    "this record does not use plan review",
    "Plans & Documents",
    "Review Results & Mark-ups",
    "Approved Documents",
    "Project Information",
    "OnBase Plan Review",
  ];
  while (Date.now() < deadline) {
    const body = await page
      .evaluate(() =>
        (document.body && document.body.innerText
          ? document.body.innerText
          : ""
        ).toLowerCase(),
      )
      .catch(() => "");
    if (needles.some((n) => body.includes(n.toLowerCase()))) {
      return { ok: true };
    }
    await page.waitForTimeout(350).catch(() => {});
  }
  return { ok: r.ok };
}

/**
 * Arlington: iframe `.src` can show AttachmentsList.aspx while Playwright contentFrame URL is briefly about:blank.
 * Wait on element src + matched child frame URL, not contentFrame alone.
 */
async function waitForArlingtonAttachmentFrame(page, timeoutMs = 30000) {
  const iframeSel = ArlingtonAccelaProfile.attachmentIframeSelector;
  const deadline = Date.now() + timeoutMs;
  try {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const raw = el.getAttribute("src") || "";
        return (
          raw &&
          raw !== "about:blank" &&
          /attachmentslist\.aspx/i.test(raw)
        );
      },
      iframeSel,
      { timeout: Math.min(25000, timeoutMs) },
    );
  } catch (_) {}

  async function iframeSrcAbsolute() {
    const h = await page.$(iframeSel).catch(() => null);
    if (!h) return "";
    const src = (
      (await h.getAttribute("src").catch(() => "")) || ""
    ).trim();
    if (!src || src === "about:blank") return "";
    try {
      return new URL(src, page.url()).href;
    } catch (_) {
      return src;
    }
  }

  let matchedFrame = null;
  while (Date.now() < deadline) {
    const absSrc = await iframeSrcAbsolute();
    if (absSrc && /attachmentslist\.aspx/i.test(absSrc)) {
      console.log(
        `[Arlington][Attachments] iframe src resolved: ${absSrc.substring(0, 200)}`,
      );
    }
    const frames = page.frames();
    for (const fr of frames) {
      let u = "";
      try {
        u = fr.url() || "";
      } catch (_) {
        /**/
      }
      if (/AttachmentsList\.aspx/i.test(u)) {
        matchedFrame = fr;
        console.log(
          `[Arlington][Attachments] matched Playwright frame URL: ${u.substring(0, 200)}`,
        );
        break;
      }
    }
    if (matchedFrame) {
      return matchedFrame;
    }

    const el = await page.$(iframeSel).catch(() => null);
    if (el) {
      const cf = await el.contentFrame().catch(() => null);
      const cu = cf ? cf.url() || "" : "";
      if (cf && /AttachmentsList\.aspx/i.test(cu)) {
        console.log(
          `[Arlington][Attachments] matched Playwright frame URL (element contentFrame): ${cu.substring(0, 200)}`,
        );
        return cf;
      }
    }

    await page.waitForTimeout(420).catch(() => {});
  }
  return null;
}

async function ensureArlingtonAttachmentsLoaded(page) {
  if (!isArlingtonCapDetailPage(page)) return null;
  await ensureArlingtonRecordInfoActive(page);

  const iframeSel = ArlingtonAccelaProfile.attachmentIframeSelector;

  const getIframeHandle = async () =>
    page.$(iframeSel).catch(() => null);

  let iframeEl = await getIframeHandle();
  if (!iframeEl) {
    await page.waitForSelector(iframeSel, { timeout: 12000 }).catch(() => {});
    iframeEl = await getIframeHandle();
  }

  async function readSrc() {
    const h = await getIframeHandle();
    if (!h) return "";
    return (await h.getAttribute("src").catch(() => "")) || "";
  }

  const clickAttachmentOpener = async () => {
    const openSelectors = [
      'a:has-text("Attachments")',
      'span:has-text("Attachments")',
      "#lnkViewRecordDocument",
      'a[href*="tab-attachments"]',
      'a:has-text("View Record Attachments")',
    ];
    for (const sel of openSelectors) {
      const h = await page.$(sel).catch(() => null);
      if (!h) continue;
      try {
        await h.click({ force: true });
        console.log(`[Arlington][Attachments] clicked opener: ${sel}`);
        await waitForAccelaLoad(page).catch(() => {});
        await page.waitForTimeout(500).catch(() => {});
        return true;
      } catch (_) {
        /**/
      }
    }
    const invoked = await page
      .evaluate(() => {
        if (typeof window.ViewPeopleDocument === "function") {
          try {
            window.ViewPeopleDocument(false);
            return true;
          } catch (_) {
            return false;
          }
        }
        return false;
      })
      .catch(() => false);
    if (invoked) {
      console.log(
        "[Arlington][Attachments] invoked ViewPeopleDocument(false) when available",
      );
      await page.waitForTimeout(800).catch(() => {});
      return true;
    }
    return false;
  };

  let src = await readSrc();
  console.log(
    `[Arlington][Attachments] iframe initially: ${src ? src.slice(0, 120) : "(empty)"}`,
  );

  if (!src || src === "about:blank") {
    await clickAttachmentOpener();
    src = await readSrc();
  }

  const maxWait = Date.now() + 20000;
  while (Date.now() < maxWait) {
    const s = (await readSrc()).toLowerCase();
    if (s && s !== "about:blank" && s.includes("attachmentslist")) {
      const full = await readSrc();
      console.log(
        `[Arlington][Attachments] iframe loaded: ${full.slice(0, 180)}`,
      );
      break;
    }
    await page.waitForTimeout(400).catch(() => {});
  }

  let sFinal = await readSrc();
  if (
    !sFinal ||
    sFinal === "about:blank" ||
    !/attachmentslist/i.test(sFinal)
  ) {
    console.log("[Arlington][Attachments] clicked View Record Attachments (retry)");
    await clickAttachmentOpener();
    const retryUntil = Date.now() + 20000;
    while (Date.now() < retryUntil) {
      const sx = (await readSrc()).toLowerCase();
      if (sx && sx !== "about:blank" && sx.includes("attachmentslist")) {
        console.log(
          `[Arlington][Attachments] iframe loaded: ${(await readSrc()).slice(0, 180)}`,
        );
        break;
      }
      await page.waitForTimeout(400).catch(() => {});
    }
  }

  iframeEl = await getIframeHandle();
  if (!iframeEl) {
    console.log("[Arlington][Attachments] iframe element not in DOM");
    return null;
  }

  const frame =
    (await waitForArlingtonAttachmentFrame(page, 30000)) ||
    (await waitForArlingtonAttachmentFrame(page, 10000));

  if (!frame) {
    const lastSrc = await readSrc();
    console.log(
      `[Arlington][Attachments] could not bind AttachmentsList frame (last iframe src snippet): ${lastSrc.slice(0, 200) || "(empty)"}`,
    );
    return null;
  }

  await frame.waitForSelector("table tr", { timeout: 15000 }).catch(() => {});
  const trCount = await frame
    .evaluate(() => document.querySelectorAll("table tr").length)
    .catch(() => 0);
  console.log(`[Arlington][Attachments] grid rows=${trCount}`);
  return frame;
}

async function extractRecordHeader(page) {
  console.log("  📋 Extracting record header...");

  const ctx = getExtractionContext(page);
  const ctxLabel = ctx === page ? "main page" : "record frame";
  console.log(`  Extracting header from: ${ctxLabel}`);

  const header = await ctx.evaluate(() => {
    const result = {
      record_number: "",
      record_type: "",
      record_status: "",
      expiration_date: "",
      _diag: {},
    };

    const root =
      document.querySelector(".rec-left") ||
      document.querySelector('[id*="PlaceHolderMain"]') ||
      document.body;

    const preview = (root.innerText || "").replace(/\s+/g, " ").trim();
    result._diag.container =
      root.id || root.className || root.tagName || "unknown";
    result._diag.preview = preview.slice(0, 300);

    const permitEl =
      root.querySelector('[id*="lblPermitNumber"]') ||
      root.querySelector('[id*="PermitNumber"]');

    if (permitEl) {
      result.record_number = (permitEl.textContent || "").trim();
      result._diag.permit =
        permitEl.id || permitEl.className || permitEl.tagName;
    }

    const typeMatch = preview.match(
      /Record\s+[A-Z0-9-]+:\s*(.*?)\s+Record Status:/i,
    );
    if (typeMatch) {
      result.record_type = typeMatch[1].trim();
    }

    const statusMatch = preview.match(
      /Record Status:\s*(.*?)\s+Expiration Date:/i,
    );
    if (statusMatch) {
      result.record_status = statusMatch[1].trim();
    }

    const expMatch = preview.match(/Expiration Date:\s*([0-9/]+)/i);
    if (expMatch) {
      result.expiration_date = expMatch[1].trim();
    }

    return result;
  });

  const diag = header._diag || {};
  delete header._diag;

  console.log(
    `     Record: ${header.record_number || "unknown"} | Status: ${header.record_status || "unknown"}`,
  );
  console.log(
    `     [DIAG:HEADER] permit=${diag.permit || "none"} container=${diag.container || "none"}`,
  );
  console.log(`     [DIAG:HEADER] preview="${diag.preview || ""}"`);

  return header;
}

/**
 * Arlington CapDetail — extract four Record Info sections from visible text (not generic label/value tables).
 */
async function extractArlingtonRecordInfoSections(ctx) {
  return ctx.evaluate(() => {
    const STOP_LINE =
      /^(More Details|Create Amendment|Plan Review|Payments|Attachments|Inspections?|Documents?|OnBase|Task|Help|Logout|My Account|Home|Search)$/i;
    const TOP_NAV = /^(Collections|Logged in as|arrow_drop_down)/i;

    const body = document.body ? document.body.innerText || "" : "";
    let lines = body
      .split(/\r?\n/)
      .map((l) => l.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
      .filter((l) => l.length);

    const markers = [
      { id: "workLocation", label: "Work Location", re: /^Work Location\s*:?\s*$/i },
      { id: "applicant", label: "Applicant", re: /^Applicant\s*:?\s*$/i },
      {
        id: "licensedProfessional",
        label: "Licensed Professional",
        re: /^Licensed Professional\s*:?\s*$/i,
      },
      { id: "owner", label: "Owner", re: /^Owner\s*:?\s*$/i },
    ];

    const findIdx = (re) => lines.findIndex((l) => re.test(l));

    /** Skip chrome above first known section */
    const idxList = [
      findIdx(markers[0].re),
      findIdx(markers[1].re),
      findIdx(markers[2].re),
      findIdx(markers[3].re),
    ].filter((n) => n >= 0);
    if (idxList.length) {
      const firstOfInterest = Math.min(...idxList);
      if (firstOfInterest > 0) lines = lines.slice(firstOfInterest);
    }

    /** Re-find after slice */
    const located = markers.map((m) => ({
      ...m,
      idx: lines.findIndex((l) => m.re.test(l)),
    }));

    const found = located
      .filter((m) => m.idx >= 0)
      .sort((a, b) => a.idx - b.idx);

    /** @type {Record<string, string[]>} */
    const byId = {
      workLocation: [],
      applicant: [],
      licensedProfessional: [],
      owner: [],
    };

    function harvest(startIdx, endExclusive) {
      const out = [];
      if (startIdx < 0) return out;
      const end = endExclusive >= 0 ? endExclusive : lines.length;
      for (let i = startIdx + 1; i < end; i++) {
        const line = lines[i];
        if (/^(Record Details|Record Info)$/i.test(line)) continue;
        if (STOP_LINE.test(line)) break;
        if (
          /^Work Location\b/i.test(line) ||
          /^Applicant\b/i.test(line) ||
          /^Licensed Professional\b/i.test(line) ||
          /^Owner\b/i.test(line)
        )
          break;
        if (/spell check|<\s*Prev|Next\s*>|Additional Results|map text|permit arlington footer/i.test(line))
          continue;
        if (/^Description:\s*$/i.test(line) && /spell/i.test(lines[i + 1] || "")) {
          i += 1;
          continue;
        }
        if (TOP_NAV.test(line)) continue;
        out.push(line);
      }
      return out;
    }

    for (let i = 0; i < found.length; i++) {
      const cur = found[i];
      const next = found[i + 1];
      const endEx = next ? next.idx : lines.length;
      byId[cur.id] = harvest(cur.idx, endEx);
    }

    const pack = (id, labelText) => {
      const lineArr = Array.isArray(byId[id]) ? byId[id] : [];
      return {
        label: labelText,
        lines: lineArr.slice(),
        text: lineArr.length ? lineArr.join("\n") : "",
      };
    };

    return {
      workLocation: pack("workLocation", "Work Location"),
      applicant: pack("applicant", "Applicant"),
      licensedProfessional: pack(
        "licensedProfessional",
        "Licensed Professional",
      ),
      owner: pack("owner", "Owner"),
    };
  });
}

/** Strip map/action UI remnants from Arlington Record Info section lines. */
const ARLINGTON_RECORD_INFO_NOISE_PATTERNS = [
  /^zoom in$/i,
  /^zoom out$/i,
  /^view additional licensed professionals>>?$/i,
  /^view additional licensed professionals$/i,
  /^create amendment$/i,
  /^more details$/i,
];

function cleanArlingtonRecordInfoLines(lines) {
  return (lines || [])
    .map((line) => String(line || "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter(
      (line) =>
        !ARLINGTON_RECORD_INFO_NOISE_PATTERNS.some((rx) => rx.test(line)),
    );
}

function extractPrimaryPhoneFromLines(lines) {
  if (!lines || !lines.length) return "";
  const s = lines.join("\n");
  const m = s.match(
    /Primary Phone\s*:\s*([0-9()+.\-\s]{10,})/i,
  );
  if (!m) return "";
  return m[1].replace(/[^\d]/g, "").slice(0, 15);
}

function extractContractorNumberFromLines(lines) {
  const s = (lines || []).join(" ");
  const m = s.match(/\bContractor\s+(\d{5,12})\b/i);
  return m ? m[1] : "";
}

function enrichArlingtonRecordInfoPostProcess(raw) {
  if (!raw) return null;
  const wl = cleanArlingtonRecordInfoLines(raw.workLocation?.lines || []);
  const a = cleanArlingtonRecordInfoLines(raw.applicant?.lines || []);
  const lp = cleanArlingtonRecordInfoLines(
    raw.licensedProfessional?.lines || [],
  );
  const ow = cleanArlingtonRecordInfoLines(raw.owner?.lines || []);

  return {
    workLocation: {
      label: raw.workLocation?.label || "Work Location",
      lines: wl.slice(),
      text: wl.length ? wl.join("\n") : "",
    },
    applicant: {
      label: raw.applicant?.label || "Applicant",
      lines: a.slice(),
      text: a.length ? a.join("\n") : "",
      name: a[0] || "",
      company: a.length > 1 ? a[1] : "",
      phone: extractPrimaryPhoneFromLines(a),
    },
    licensedProfessional: {
      label: raw.licensedProfessional?.label || "Licensed Professional",
      lines: lp.slice(),
      text: lp.length ? lp.join("\n") : "",
      company: "",
      phone: extractPrimaryPhoneFromLines(lp),
      contractorNumber: extractContractorNumberFromLines(lp),
    },
    owner: {
      label: raw.owner?.label || "Owner",
      lines: ow.slice(),
      text: ow.length ? ow.join("\n") : "",
      name: ow[0] || "",
    },
  };
}

function buildArlingtonRecordInfoTables(arlingtonRecordInfo) {
  if (!arlingtonRecordInfo) return [];
  const ar = arlingtonRecordInfo;
  const rows = [];
  const add = (key, value) => {
    const v = value != null ? String(value).trim() : "";
    if (v) rows.push({ key, value: v });
  };
  add("Work Location", ar.workLocation?.text);
  add("Applicant", ar.applicant?.text || ar.applicant?.lines?.join("\n"));
  add(
    "Licensed Professional",
    ar.licensedProfessional?.text ||
      ar.licensedProfessional?.lines?.join("\n"),
  );
  add("Owner", ar.owner?.text || ar.owner?.lines?.join("\n"));
  if (!rows.length) return [];
  return [
    {
      title: "Record Info",
      headers: ["Field", "Value"],
      rows,
    },
  ];
}

async function extractRecordDetails(page) {
  console.log("  📋 Extracting record details...");
  const ctx = getExtractionContext(page);

  let fairfaxInlineHandled = false;
  if (isFairfaxPortal(page)) {
    try {
      const containerVisible = await ctx
        .evaluate(() => {
          const el = document.querySelector("#tab-record_detail");
          return (
            !!el &&
            (el.classList.contains("show") || (el.offsetHeight || 0) > 0)
          );
        })
        .catch(() => false);
      if (containerVisible) {
        fairfaxInlineHandled = true;
        console.log(
          "  [Fairfax] Record Details inline (#tab-record_detail visible) — skipping nav click",
        );
      } else {
        console.log(
          "  [Fairfax] #tab-record_detail not visible — using standard Record Details click flow",
        );
      }
    } catch (err) {
      console.log(
        `  [Fairfax] #tab-record_detail check failed (falling through): ${err.message}`,
      );
    }
  }

  if (isBaltimorePortal(page)) {
    const frames = getAccelaChildFrames(page);
    const contentFrame = ctx;
    const rdNavOk = await navigateToRecordInfoSection(
      page,
      frames,
      contentFrame,
      "Record Details",
    );
    if (!rdNavOk) {
      console.log("[Baltimore] Record Details — navigation failed");
      return { fields: {}, tables: [], screenshot: null };
    }
    await saveCheckpointScreenshot(page, "after_record_details").catch(() => {});
  } else if (!fairfaxInlineHandled) {
    const isArlingtonDetail =
      isArlingtonPortal(page) || isArlingtonCapDetailPage(page);
    if (isArlingtonDetail) {
      console.log(
        `  [Arlington] activating Record Info tab — url=${(page.url() || "").substring(0, 140)}`,
      );
      await ensureArlingtonRecordInfoActive(page);
      await saveCheckpointScreenshot(page, "after_record_details").catch(
        () => {},
      );
      console.log(
        "  [Arlington] extracting fields from Record Info / detail context",
      );
    } else {
      const recordTabSelectors = [
        '[id*="TabDataList"] a:has-text("Record Details")',
        'a:has-text("Record Details")',
        'a:has-text("Record Detail")',
        'a[id*="RecordDetail"]',
      ];
      const { found } = await clickAccelaNavPanel(
        ctx,
        page,
        recordTabSelectors,
        "Record Details",
        {
          expandRecordInfoFirst: true,
          checkpointLabel: "after_record_details",
        },
      );

      if (!found) {
        console.log("     [panel] Record Details: link not found");
        return { fields: {}, tables: [], screenshot: null };
      }
    }
  }

  await page.waitForTimeout(1500);

  if (
    !isBaltimorePortal(page) &&
    (isArlingtonPortal(page) || isArlingtonCapDetailPage(page))
  ) {
    try {
      const raw = await extractArlingtonRecordInfoSections(ctx);
      const hasWork =
        raw &&
        raw.workLocation &&
        Array.isArray(raw.workLocation.lines) &&
        raw.workLocation.lines.length > 0;
      if (hasWork) {
        const arlingtonRecordInfo =
          enrichArlingtonRecordInfoPostProcess(raw);
        const details = {
          fields: {},
          tables: buildArlingtonRecordInfoTables(arlingtonRecordInfo),
          arlingtonRecordInfo,
          screenshot: null,
        };
        if (arlingtonRecordInfo.workLocation?.text) {
          details.fields["Work Location"] = arlingtonRecordInfo.workLocation.text;
        }
        const detailScreenshot = await page
          .screenshot({ fullPage: true })
          .catch(() => null);
        details.screenshot = detailScreenshot
          ? detailScreenshot.toString("base64")
          : null;
        console.log(
          `  [Arlington] Record Info sections: workLocation lines=${arlingtonRecordInfo.workLocation?.lines?.length || 0} applicant=${arlingtonRecordInfo.applicant?.lines?.length || 0} licensed=${arlingtonRecordInfo.licensedProfessional?.lines?.length || 0} owner=${arlingtonRecordInfo.owner?.lines?.length || 0}`,
        );
        return details;
      }
      console.log(
        "  [Arlington] structured Record Info missing Work Location — using generic label/value extraction",
      );
    } catch (err) {
      console.log(
        `  [Arlington] structured Record Info error: ${err.message} — using generic extraction`,
      );
    }
  }

  const details = await ctx.evaluate(() => {
    const fields = {};
    const badLabels = new Set([
      "add",
      "cancel",
      "*name",
      "name",
      "name:",
      "description:",
      "record status:",
      "expiration date:",
    ]);

    const recordDetailKeywords = [
      "application name",
      "work location",
      "address",
      "parcel",
      "description",
      "job value",
      "project name",
      "applicant",
      "contractor",
      "fee",
      "parcel number",
      "lot",
      "block",
      "project #",
      "application #",
      "permit #",
      "location",
      "project number",
      "permit number",
      "record number",
      "type",
      "status",
      "expiration",
      "issued",
      "submitted",
      "received",
    ];

    const allTables = Array.from(document.querySelectorAll("table"));
    let candidateTables = allTables.filter((table) => {
      const text = (table.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return recordDetailKeywords.some((kw) => text.includes(kw));
    });

    const countLabelValueRows = (table) => {
      let count = 0;
      table.querySelectorAll("tr").forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map((c) =>
          (c.textContent || "").replace(/\s+/g, " ").trim(),
        ).filter(Boolean);
        if (cells.length >= 2 && cells[0].length < 80 && cells[1].length < 400) count += 1;
      });
      return count;
    };

    if (candidateTables.length === 0 || candidateTables.every((t) => countLabelValueRows(t) < 2)) {
      const fallbackTables = allTables.filter((table) => {
        const text = (table.innerText || "").replace(/\s+/g, " ").trim();
        if (text.length < 20) return false;
        const rows = table.querySelectorAll("tr");
        if (rows.length < 2) return false;
        return countLabelValueRows(table) >= 1;
      });
      if (fallbackTables.length > 0) {
        candidateTables = fallbackTables;
      }
    }

    for (const target of candidateTables) {
      const rows = target.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td"))
          .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);

        if (cells.length < 2) return;

        const label = cells[0].replace(/:$/, "").trim();
        const value = cells[1].trim();

        if (!label || !value) return;
        if (label.length > 60) return;
        if (value.length > 300) return;
        if (badLabels.has(label.toLowerCase())) return;
        if (value.toLowerCase() === label.toLowerCase()) return;
        if (/^(add|cancel)$/i.test(value)) return;

        fields[label] = value;
      });
    }

    const rowsOut = Object.entries(fields).map(([key, value]) => ({
      key,
      value,
    }));

    return {
      tables: rowsOut.length
        ? [
            {
              title: "Record Details",
              headers: ["Field", "Value"],
              rows: rowsOut,
            },
          ]
        : [],
      fields,
    };
  });

  if (isBaltimorePortal(page)) {
    const recordDetails = await extractBaltimoreRecordDetails(ctx);
    console.log("[Baltimore] Record Details result:", recordDetails);
    if (Object.keys(recordDetails).length > 0) {
      Object.assign(details.fields, recordDetails);
      details.tables = [
        {
          title: "Record Details",
          headers: ["Field", "Value"],
          rows: Object.entries(details.fields).map(([key, value]) => ({ key, value })),
        },
      ];
    }
  } else if (isFairfaxPortal(page) && fairfaxInlineHandled) {
    const recordDetails = await extractBaltimoreRecordDetails(ctx);
    console.log("[Fairfax] Record Details extracted inline:", recordDetails);
    if (Object.keys(recordDetails).length > 0) {
      Object.assign(details.fields, recordDetails);
      details.tables = [
        {
          title: "Record Details",
          headers: ["Field", "Value"],
          rows: Object.entries(details.fields).map(([key, value]) => ({ key, value })),
        },
      ];
    }
    console.log(
      `  [Fairfax] Record Details extracted inline: ${Object.keys(details.fields).length} fields`,
    );

    try {
      const beforeKv = Object.keys(details.fields).length;
      for (const k of Object.keys(details.fields)) {
        if (isFairfaxGarbageRow({ key: k, value: details.fields[k] })) {
          delete details.fields[k];
        }
      }
      const droppedKv = beforeKv - Object.keys(details.fields).length;
      if (droppedKv > 0) {
        console.log(
          `  [Fairfax] Record Details: filtered ${droppedKv} garbage rows from fields / keyValues source`,
        );
      }

      details.tables = [
        {
          title: "Record Details",
          headers: ["Field", "Value"],
          rows: Object.entries(details.fields).map(([key, value]) => ({
            key,
            value,
          })),
        },
      ];

      const structuredContacts = await extractFairfaxRelatedContacts(page);
      if (structuredContacts.length > 0) {
        const contactRows = [];
        for (const c of structuredContacts) {
          if (c.name)
            contactRows.push({ key: `${c.role} - Name`, value: c.name });
          if (c.phone)
            contactRows.push({
              key: `${c.role} - Primary Phone`,
              value: c.phone,
            });
          if (c.email)
            contactRows.push({ key: `${c.role} - Email`, value: c.email });
          if (c.license)
            contactRows.push({
              key: `${c.role} - License Number`,
              value: c.license,
            });
          if (c.company && c.company !== c.name)
            contactRows.push({ key: `${c.role} - Company`, value: c.company });
        }
        for (const r of contactRows) {
          details.fields[r.key] = r.value;
        }
        details.tables = [
          {
            title: "Record Details",
            headers: ["Field", "Value"],
            rows: Object.entries(details.fields).map(([key, value]) => ({
              key,
              value,
            })),
          },
        ];
        console.log(
          `  [Fairfax] Related Contacts: injected ${contactRows.length} structured rows across ${structuredContacts.length} roles`,
        );
      }
    } catch (err) {
      console.log(
        `  [Fairfax] Record Details post-process: ${err.message}`,
      );
    }
  }

  const detailScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  details.screenshot = detailScreenshot
    ? detailScreenshot.toString("base64")
    : null;

  const count = Object.keys(details.fields).length;
  console.log(`     [panel] Record Details: ${count} fields extracted`);
  if (count === 0) console.log("     [panel] Record Details: panel empty (no data)");
  if (
    (isArlingtonPortal(page) || isArlingtonCapDetailPage(page)) &&
    !details.arlingtonRecordInfo
  ) {
    console.log(
      `  [Arlington] Record Info extraction summary: ${count} structured field(s) from label/value tables`,
    );
    if (count === 0) {
      const preview = await page
        .evaluate(() =>
          document.body
            ? (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600)
            : "",
        )
        .catch(() => "");
      console.log(
        `  [Arlington][RecordInfo] visible text sample after activating Record Info: ${preview.slice(0, 400)}`,
      );
      const nTab = await page
        .evaluate(() => document.querySelectorAll("table").length)
        .catch(() => 0);
      console.log(`  [Arlington][RecordInfo] tables found: ${nTab}`);
    }
  }
  return details;
}

async function extractProcessingStatus(page) {
  console.log("  📋 Extracting processing status...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToRecordInfoSection(
        page,
        frames,
        ctx,
        "Processing Status",
      );
      if (!navOk) {
        console.log(
          `  [Baltimore] Skipped Processing Status — navigation failed`,
        );
        return { departments: [], screenshot: null };
      }
      await saveCheckpointScreenshot(page, "after_processing_status").catch(
        () => {},
      );
    } catch (e) {
      console.log(
        `  [Baltimore] Skipped Processing Status — navigation failed`,
      );
      console.log(`  [Baltimore] ${e.message}`);
      return { departments: [], screenshot: null };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Processing Status")',
      'a:has-text("Processing Status")',
      'a[id*="ProcessingStatus"]',
      'a:has-text("Workflow")',
        'a:has-text("Workflow Status")',
        '[id*="TabDataList"] a:has-text("Status")',
    ],
    "Processing Status",
      { expandRecordInfoFirst: true, checkpointLabel: "after_processing_status" },
  );

  if (!found) {
      console.log("     [panel] Processing Status: link not found");
    return { departments: [], screenshot: null };
    }
  }

  if (isBaltimorePortal(page)) {
    const contentFrame = ctx;
    const processingStatus = await extractBaltimoreProcessingStatus(page, contentFrame);
    console.log('[Baltimore] Processing Status result:', processingStatus);
    const departments = (processingStatus.workflowTasks || []).map((t) => ({
      name: t.task,
      status: t.status,
      statusIcon: "",
      date: "",
      details: "",
    }));
    const screenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;
    console.log(`     [panel] Processing Status: ${departments.length} departments/tasks extracted`);
    if (departments.length === 0) console.log("     [panel] Processing Status: panel empty (no data)");
    return { departments, screenshot: screenshotBase64 };
  }

  const expandButtons = await ctx
    .$$(
      '[id*="expand"], .collapse-icon, a[onclick*="expand"], img[src*="expand"], .aca_expand',
    )
    .catch(() => []);
  for (const btn of expandButtons) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);

  const departments = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

    const depts = [];
    const rows = container.querySelectorAll(
      '[id*="WorkflowTask"], [id*="ProcessStatus"] tr, .workflow-task, li[id*="task"]',
    );

    rows.forEach((row) => {
      const nameEl = row.querySelector(
        '[id*="TaskName"], .task-name, td:first-child, span.ACA_SmLabel',
      );
      const statusEl = row.querySelector(
        '[id*="TaskStatus"], .task-status, [class*="status"]',
      );
      const dateEl = row.querySelector(
        '[id*="DueDate"], [id*="Date"], .task-date',
      );
      const detailEl = row.querySelector(
        '[id*="Comment"], [id*="Detail"], .task-detail',
      );

      const name = nameEl ? nameEl.textContent.trim() : "";
      const statusText = statusEl ? statusEl.textContent.trim() : "";

      const checkImg = row.querySelector(
        'img[src*="check"], img[src*="complete"], img[src*="green"]',
      );
      const clockImg = row.querySelector(
        'img[src*="clock"], img[src*="pending"], img[src*="yellow"], img[src*="wait"]',
      );
      let statusIcon = "";
      if (checkImg) statusIcon = "complete";
      else if (clockImg) statusIcon = "pending";

      if (name && name.length < 100) {
        depts.push({
          name,
          status: statusText,
          statusIcon,
          date: dateEl ? dateEl.textContent.trim() : "",
          details: detailEl ? detailEl.textContent.trim() : "",
        });
      }
    });

    if (depts.length === 0) {
      const allTables = container.querySelectorAll("table");
      for (const table of allTables) {
        const headerRow = table.querySelector("tr");
        if (!headerRow) continue;
        const headers = Array.from(headerRow.querySelectorAll("th, td")).map(
          (h) => h.textContent.trim().toLowerCase(),
        );
        if (
          headers.some(
            (h) =>
              h.includes("task") ||
              h.includes("department") ||
              h.includes("step"),
          )
        ) {
          const dataRows = table.querySelectorAll("tr:not(:first-child)");
          dataRows.forEach((dr) => {
            const cells = dr.querySelectorAll("td");
            if (cells.length >= 2) {
              const checkImg = dr.querySelector(
                'img[src*="check"], img[src*="complete"], img[src*="green"]',
              );
              const clockImg = dr.querySelector(
                'img[src*="clock"], img[src*="pending"], img[src*="yellow"]',
              );
              depts.push({
                name: cells[0].textContent.trim(),
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
                statusIcon: checkImg ? "complete" : clockImg ? "pending" : "",
                date: cells.length > 2 ? cells[2].textContent.trim() : "",
                details: cells.length > 3 ? cells[3].textContent.trim() : "",
              });
            }
          });
          break;
        }
      }
    }

    return depts;
  });

  const screenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;

  console.log(`     [panel] Processing Status: ${departments.length} departments/tasks extracted`);
  if (departments.length === 0) console.log("     [panel] Processing Status: panel empty (no data)");
  return { departments, screenshot: screenshotBase64 };
}

async function extractBaltimoreProcessingStatus(page, contentFrame) {
  try {
    // Wait for the loading overlay to disappear in contentFrame
    try {
      await contentFrame.waitForFunction(
        () => {
          const blocker = document.getElementById("iframeBlocker");
          return (
            !blocker ||
            blocker.style.display === "none" ||
            !blocker.offsetParent
          );
        },
        { timeout: 10000 },
      );
      console.log("[Baltimore ProcessingStatus] Blocker cleared");
    } catch (e) {
      console.log("[Baltimore ProcessingStatus] Blocker wait timeout");
    }

    // Additional settle time
    await new Promise((r) => setTimeout(r, 1500));

    const tasks = await contentFrame.evaluate(() => {
      const results = [];

      // Find all elements containing task-like text with status icons
      // Processing Status rows are direct children of the main content area
      // Each row: status icon img + arrow button + department name text

      // Strategy: find all imgs in the page, check their parent rows
      const imgs = [...document.querySelectorAll("img")];

      for (const img of imgs) {
        const row =
          img.closest("li, tr, div.workflow_row, div[class*=\"row\"]") ||
          img.parentElement;
        if (!row) continue;

        const text = (row.innerText || "").trim();
        const firstLine = text.split("\n")[0].trim();

        if (!firstLine || firstLine.length < 3 || firstLine.length > 120)
          continue;

        // Must not be navigation/chrome noise
        const noise = [
          "logout",
          "cart",
          "collections",
          "logged in",
          "search",
          "home",
          "permits and",
          "licensed",
          "key to processing",
          "expand for",
          "microsoft",
          "notice",
          "translate",
          "language",
          "arabic",
          "chinese",
          "french",
          "korean",
          "spanish",
          "add to cart",
          "add to collection",
          "select",
          "active (plan review",
          "more details",
          "loading...",
          "original text",
          "schedule or request",
          "view entire tree",
          "create amendment",
          "add to cart",
          "add to collection",
        ];
        if (noise.some((n) => firstLine.toLowerCase().includes(n))) continue;

        // Row must be inside or after the Processing Status heading
        // Check if any ancestor or preceding text mentions Processing Status
        let el = row;
        let inSection = false;
        for (let i = 0; i < 10; i++) {
          if (!el) break;
          if ((el.innerText || "").includes("Processing Status")) {
            inSection = true;
            break;
          }
          el = el.parentElement;
        }
        if (!inSection) continue;

        // Derive status from img attributes
        let status = "Unknown";
        const hint = (
          (img.src || "") +
          (img.alt || "") +
          (img.title || "")
        ).toLowerCase();
        if (hint.includes("complete") || hint.includes("check"))
          status = "Complete";
        else if (hint.includes("previously") || hint.includes("orange"))
          status = "Previously Active";
        else if (hint.includes("active")) status = "Active";

        // Avoid duplicate task names
        if (results.some((r) => r.task === firstLine)) continue;

        results.push({ task: firstLine, status, expanded: false });
      }

      return results;
    });

    console.log(`[Baltimore ProcessingStatus] Extracted ${tasks.length} tasks`);

    if (tasks.length === 0) {
      const preview = await contentFrame.evaluate(() =>
        (document.body ? document.body.innerText : "no body").substring(0, 400),
      );
      console.log(
        "[Baltimore ProcessingStatus] WARNING: 0 tasks — innerText preview:",
        preview,
      );
    }

    return { workflowTasks: tasks };
  } catch (err) {
    console.log("[Baltimore ProcessingStatus] ERROR:", err.message);
    return { workflowTasks: [] };
  }
}

async function extractBaltimoreRelatedRecords(page, contentFrame) {
  try {

    // Helper to extract table rows from an evaluate context
    // Returns array of row objects using th headers as keys
    const extractTable = (tableEl) => {
      if (!tableEl) return [];
      const rows = [];
      const headers = [];
      const ths = tableEl.querySelectorAll('th');
      ths.forEach(th => headers.push(th.innerText.trim().toLowerCase()
        .replace(/\s+/g, '_')));

      const trs = tableEl.querySelectorAll('tr');
      trs.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length === 0) return;
        const row = {};
        tds.forEach((td, i) => {
          const key = headers[i] || ('col_' + i);
          row[key] = td.innerText.trim();
        });
        const vals = Object.values(row).join('').trim();
        if (vals.length > 0) rows.push(row);
      });
      return rows;
    };

    // Try main page first
    let rows = await page.evaluate(() => {
      function findRelatedRecordsTable() {
        const tables = [...document.querySelectorAll("table")];

        for (const table of tables) {
          // Check 1: table has Record Number header
          const ths = [...table.querySelectorAll("th")];
          const hasRecordNumHeader = ths.some((th) =>
            th.innerText.trim().toLowerCase().includes("record"),
          );
          if (hasRecordNumHeader) return table;

          // Check 2: ancestor heading contains "Related Records"
          let el = table.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!el) break;
            const heading = el.querySelector(
              "h2,h3,h4,caption,strong,b",
            );
            if (heading && heading.innerText.includes("Related Records")) {
              return table;
            }
            el = el.parentElement;
          }

          // Check 3: preceding sibling heading
          let prev = table.previousElementSibling;
          for (let i = 0; i < 5; i++) {
            if (!prev) break;
            if (prev.innerText && prev.innerText.includes("Related Records")) {
              return table;
            }
            prev = prev.previousElementSibling;
          }
        }
        return null;
      }

      function extractRowsFromTable(table) {
        const rows = [];
        const headerRow = table.querySelector("tr");
        if (!headerRow) return [];

        const headerCells = [...headerRow.querySelectorAll("th, td")];
        const headers = headerCells.map((c) =>
          c.innerText.trim().toLowerCase().replace(/\s+/g, "_"),
        );

        const dataRows = [...table.querySelectorAll("tr")].slice(1);

        for (const tr of dataRows) {
          const tds = [...tr.querySelectorAll("td")];
          if (tds.length === 0) continue;

          const row = {};
          tds.forEach((td, i) => {
            const key = headers[i] || "col_" + i;
            row[key] = td.innerText.trim();
          });

          const allEmpty = Object.values(row).every(
            (v) => !v || v.trim() === "",
          );
          if (allEmpty) continue;

          const recordNum = row.record_number || row.col_0 || "";
          if (!recordNum || recordNum.trim() === "") continue;
          const lastRow = rows[rows.length - 1];
          const lastNum = lastRow
            ? lastRow.record_number || lastRow.col_0 || ""
            : "";
          if (recordNum && recordNum === lastNum) continue;
          rows.push(row);
        }

        return rows;
      }

      const table = findRelatedRecordsTable();
      if (!table) return [];
      return extractRowsFromTable(table);
    });

    // If main page found nothing, try contentFrame
    if (!rows || rows.length === 0) {
      rows = await contentFrame.evaluate(() => {
        function findRelatedRecordsTable() {
          const tables = [...document.querySelectorAll("table")];

          for (const table of tables) {
            const ths = [...table.querySelectorAll("th")];
            const hasRecordNumHeader = ths.some((th) =>
              th.innerText.trim().toLowerCase().includes("record"),
            );
            if (hasRecordNumHeader) return table;

            let el = table.parentElement;
            for (let i = 0; i < 5; i++) {
              if (!el) break;
              const heading = el.querySelector(
                "h2,h3,h4,caption,strong,b",
              );
              if (heading && heading.innerText.includes("Related Records")) {
                return table;
              }
              el = el.parentElement;
            }

            let prev = table.previousElementSibling;
            for (let i = 0; i < 5; i++) {
              if (!prev) break;
              if (prev.innerText && prev.innerText.includes("Related Records")) {
                return table;
              }
              prev = prev.previousElementSibling;
            }
          }
          return null;
        }

        function extractRowsFromTable(table) {
          const rows = [];
          const headerRow = table.querySelector("tr");
          if (!headerRow) return [];

          const headerCells = [...headerRow.querySelectorAll("th, td")];
          const headers = headerCells.map((c) =>
            c.innerText.trim().toLowerCase().replace(/\s+/g, "_"),
          );

          const dataRows = [...table.querySelectorAll("tr")].slice(1);

          for (const tr of dataRows) {
            const tds = [...tr.querySelectorAll("td")];
            if (tds.length === 0) continue;

            const row = {};
            tds.forEach((td, i) => {
              const key = headers[i] || "col_" + i;
              row[key] = td.innerText.trim();
            });

            const allEmpty = Object.values(row).every(
              (v) => !v || v.trim() === "",
            );
            if (allEmpty) continue;

            const recordNum = row.record_number || row.col_0 || "";
            if (!recordNum || recordNum.trim() === "") continue;
            const lastRow = rows[rows.length - 1];
            const lastNum = lastRow
              ? lastRow.record_number || lastRow.col_0 || ""
              : "";
            if (recordNum && recordNum === lastNum) continue;
            rows.push(row);
          }

          return rows;
        }

        const table = findRelatedRecordsTable();
        if (!table) return [];
        return extractRowsFromTable(table);
      });
      console.log('[Baltimore RelatedRecords] Found in: contentFrame');
    } else {
      console.log('[Baltimore RelatedRecords] Found in: main page');
    }

    console.log(`[Baltimore RelatedRecords] Extracted ${rows.length} records`);
    return { relatedRecords: rows || [] };

  } catch (err) {
    console.log('[Baltimore RelatedRecords] ERROR:', err.message);
    return { relatedRecords: [] };
  }
}

async function extractBaltimorePayments(page, contentFrame) {
  try {
    let result = await page.evaluate(() => {
      function findFeesTable() {
        const tables = [...document.querySelectorAll("table")];

        for (const table of tables) {
          const ths = [...table.querySelectorAll("th")];
          const headerText = ths
            .map((th) => th.innerText.toLowerCase())
            .join(" ");
          if (headerText.includes("amount") || headerText.includes("invoice")) {
            return table;
          }

          let prev = table.previousElementSibling;
          for (let i = 0; i < 5; i++) {
            if (!prev) break;
            if (
              prev.innerText &&
              (prev.innerText.includes("Fees") ||
                prev.innerText.includes("Paid"))
            ) {
              return table;
            }
            prev = prev.previousElementSibling;
          }
        }
        return null;
      }

      function extractFeeRows(table) {
        const fees = [];
        const ths = [...table.querySelectorAll("th")];
        const headers = ths.map((th) =>
          th.innerText.trim().toLowerCase().replace(/\s+/g, "_"),
        );
        // Baltimore Fees table headers are: Date | Invoice Number | Amount
        // If headers are empty or wrong, force the correct mapping
        const normalizedHeaders = headers.map((h, i) => {
          if (h.includes("date") || i === 0) return "date";
          if (h.includes("invoice") || h.includes("number") || i === 1)
            return "invoice_number";
          if (h.includes("amount") || i === 2) return "amount";
          return h || "col_" + i;
        });

        table.querySelectorAll("tr").forEach((tr) => {
          const tds = [...tr.querySelectorAll("td")];
          if (tds.length === 0) return;
          const raw = {};
          tds.forEach((td, i) => {
            raw[normalizedHeaders[i] || "col_" + i] = td.innerText.trim();
          });
          const row = { date: "", invoice_number: "", amount: "" };
          for (const [k, v] of Object.entries(raw)) {
            const key = k.toLowerCase();
            if (key.includes("date")) row.date = v;
            else if (key.includes("invoice")) row.invoice_number = v;
            else if (key.includes("amount")) row.amount = v;
          }
          // Skip pagination/noise rows
          const rowText = Object.values(row).join(" ").toLowerCase();
          if (
            rowText.includes("prev") ||
            rowText.includes("next") ||
            rowText.includes("additional results") ||
            rowText.includes("total paid")
          )
            return;

          // Skip rows where amount cell doesn't look like money
          const amount = row.amount || "";
          if (!amount.includes("$") && !amount.match(/^\d/)) return;

          const nonempty =
            (row.date || row.invoice_number || row.amount || "").trim().length >
            0;
          if (nonempty) fees.push(row);
        });
        return fees;
      }

      function findTotalPaidFees() {
        const els = [...document.querySelectorAll("*")];
        for (const el of els) {
          const t = el.innerText || "";
          if (t.includes("Total paid fees:")) {
            return el.innerText.trim();
          }
        }
        return null;
      }

      const table = findFeesTable();
      const fees = table ? extractFeeRows(table) : [];
      const totalPaidFees = findTotalPaidFees();
      return { fees, totalPaidFees };
    });

    if (!result || !result.fees || result.fees.length === 0) {
      result = await contentFrame.evaluate(() => {
        function findFeesTable() {
          const tables = [...document.querySelectorAll("table")];

          for (const table of tables) {
            const ths = [...table.querySelectorAll("th")];
            const headerText = ths
              .map((th) => th.innerText.toLowerCase())
              .join(" ");
            if (headerText.includes("amount") || headerText.includes("invoice")) {
              return table;
            }

            let prev = table.previousElementSibling;
            for (let i = 0; i < 5; i++) {
              if (!prev) break;
              if (
                prev.innerText &&
                (prev.innerText.includes("Fees") ||
                  prev.innerText.includes("Paid"))
              ) {
                return table;
              }
              prev = prev.previousElementSibling;
            }
          }
          return null;
        }

        function extractFeeRows(table) {
          const fees = [];
          const ths = [...table.querySelectorAll("th")];
          const headers = ths.map((th) =>
            th.innerText.trim().toLowerCase().replace(/\s+/g, "_"),
          );
          // Baltimore Fees table headers are: Date | Invoice Number | Amount
          // If headers are empty or wrong, force the correct mapping
          const normalizedHeaders = headers.map((h, i) => {
            if (h.includes("date") || i === 0) return "date";
            if (h.includes("invoice") || h.includes("number") || i === 1)
              return "invoice_number";
            if (h.includes("amount") || i === 2) return "amount";
            return h || "col_" + i;
          });

          table.querySelectorAll("tr").forEach((tr) => {
            const tds = [...tr.querySelectorAll("td")];
            if (tds.length === 0) return;
            const raw = {};
            tds.forEach((td, i) => {
              raw[normalizedHeaders[i] || "col_" + i] = td.innerText.trim();
            });
            const row = { date: "", invoice_number: "", amount: "" };
            for (const [k, v] of Object.entries(raw)) {
              const key = k.toLowerCase();
              if (key.includes("date")) row.date = v;
              else if (key.includes("invoice")) row.invoice_number = v;
              else if (key.includes("amount")) row.amount = v;
            }
            // Skip pagination/noise rows
            const rowText = Object.values(row).join(" ").toLowerCase();
            if (
              rowText.includes("prev") ||
              rowText.includes("next") ||
              rowText.includes("additional results") ||
              rowText.includes("total paid")
            )
              return;

            // Skip rows where amount cell doesn't look like money
            const amount = row.amount || "";
            if (!amount.includes("$") && !amount.match(/^\d/)) return;

            const nonempty =
              (row.date || row.invoice_number || row.amount || "").trim()
                .length > 0;
            if (nonempty) fees.push(row);
          });
          return fees;
        }

        function findTotalPaidFees() {
          const els = [...document.querySelectorAll("*")];
          for (const el of els) {
            const t = el.innerText || "";
            if (t.includes("Total paid fees:")) {
              return el.innerText.trim();
            }
          }
          return null;
        }

        const table = findFeesTable();
        const fees = table ? extractFeeRows(table) : [];
        const totalPaidFees = findTotalPaidFees();
        return { fees, totalPaidFees };
      });
      console.log("[Baltimore Payments] Found in: contentFrame");
    } else {
      console.log("[Baltimore Payments] Found in: main page");
    }

    const fees = (result && result.fees) || [];
    const totalPaidFees =
      result && result.totalPaidFees != null ? result.totalPaidFees : null;
    console.log(`[Baltimore Payments] Extracted ${fees.length} fee rows`);

    return {
      fees,
      totalPaidFees,
      note: "Paginated — showing visible page only",
    };
  } catch (err) {
    console.log("[Baltimore Payments] ERROR:", err.message);
    return {
      fees: [],
      totalPaidFees: null,
      note: "Paginated — showing visible page only",
    };
  }
}

/**
 * Baltimore Plan Review: summary/status page is div/span (.pil-section, .pil-subsection-title, .pil-subsection-value).
 * Do NOT use table-based logic; scope extraction to Plan Review container only to avoid capturing Processing Status table.
 */
async function extractPlanReviewSummaryBaltimore(ctx) {
  return ctx.evaluate(() => {
    const summary = {};
    const downloadLinks = [];

    const sectionTitle = Array.from(document.querySelectorAll(".pil-section-title, [class*=\"section-title\"]")).find(
      (el) => (el.textContent || "").trim().toLowerCase().includes("plan review status"),
    );
    const container = sectionTitle ? sectionTitle.closest(".pil-section") || sectionTitle.parentElement : null;
    if (!container) {
      return { summary: {}, downloadLinks: [] };
    }

    container.querySelectorAll(".pil-subsection-title, [class*=\"subsection-title\"]").forEach((labelEl) => {
      const label = (labelEl.textContent || "").replace(/:$/, "").trim();
      if (!label) return;
      let valueEl = labelEl.nextElementSibling;
      if (!valueEl || !valueEl.classList || (!valueEl.classList.contains("pil-subsection-value") && !valueEl.className.includes("subsection-value"))) {
        const parent = labelEl.closest("div");
        if (parent) {
          const val = parent.querySelector(".pil-subsection-value, [class*=\"subsection-value\"]");
          if (val) valueEl = val;
        }
      }
      const value = valueEl ? (valueEl.textContent || "").replace(/\s+/g, " ").trim() : "";
      if (label.length < 100) summary[label] = value;
    });

    container.querySelectorAll("a.pil-button-link, a.pil-link, .pil-button-inline a, a[href]").forEach((a) => {
      const text = (a.textContent || "").trim();
      const href = (a.getAttribute("href") || "").trim();
      if (text && text.length < 200) downloadLinks.push({ label: text, href: href || "" });
    });

    const keyMap = {
      "Review Type": "reviewType",
      "Total Number of Files": "totalNumberOfFiles",
      "Time Elapsed": "timeElapsed",
      "Prescreen Review Comments (Unresolved)": "prescreenReviewComments",
      "Time with Jurisdiction": "timeWithJurisdiction",
      "Time with Applicant": "timeWithApplicant",
      "Status": "status",
      "Current Non-Completed Tasks": "currentNonCompletedTasks",
    };
    const normalized = {};
    Object.keys(keyMap).forEach((k) => {
      if (summary[k] !== undefined) normalized[keyMap[k]] = summary[k];
    });
    normalized.rawFields = summary;

    return { summary: normalized, downloadLinks };
  });
}

/** Prefer Plan Review / OnBase iframes when hunting Arlington sub-tab anchors. */
function arlingtonPlanReviewFrameScore(frame) {
  let u = "";
  let n = "";
  try {
    u = (frame.url() || "").toLowerCase();
    n = (frame.name() || "").toLowerCase();
  } catch (_) {}
  const hay = `${u} ${n}`;
  let s = 0;
  if (/planreviewintegrated|prd-ermsaccela-arlingtonva|prd-ermsaccela/i.test(hay))
    s += 28;
  if (/iframeopenplanreview|openplanreview/.test(hay)) s += 20;
  if (/onbase/.test(hay)) s += 15;
  if (/plan.?review|planreview/.test(hay)) s += 10;
  if (
    /plans|documents|review.?results|approved|project.?information/.test(hay)
  )
    s += 4;
  return s;
}

function rankFramesForArlingtonPlanReview(page) {
  const frames = [...page.frames()].filter(Boolean);
  frames.sort(
    (a, b) =>
      arlingtonPlanReviewFrameScore(b) - arlingtonPlanReviewFrameScore(a),
  );
  return frames;
}

async function clickArlingtonPlanReviewSubTab(page, label) {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  const framesRanked = rankFramesForArlingtonPlanReview(page);
  const tried = new Set();
  for (const frame of framesRanked) {
    try {
      const fid = `${frame.url()}${frame.name()}`;
      if (tried.has(fid)) continue;
      tried.add(fid);
      const links = await frame.$$("a").catch(() => []);
      for (const el of links) {
        const raw = await el.textContent().catch(() => "");
        const text = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (text !== normalized) continue;
        if (!(await el.isVisible().catch(() => false))) continue;
        console.log(
          `     [Arlington][Plan Review] sub-tab "${label}" click in frame ${frame.url().substring(0, 72)}`,
        );
        await el.click({ force: true }).catch(() => {});
        await waitForAccelaLoad(page).catch(() => {});
        await page.waitForTimeout(1000);
        return true;
      }
    } catch (_) {}
  }
  return false;
}

/** Secondary tabs: short bounded click (no long Accela load wait). */
const ARLINGTON_SECONDARY_TAB_DOM_CLICK_MS = 6000;

async function clickArlingtonPlanReviewSubTabQuick(page, label) {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  const framesRanked = rankFramesForArlingtonPlanReview(page);
  const tried = new Set();
  for (const frame of framesRanked) {
    try {
      const fid = `${frame.url()}${frame.name()}`;
      if (tried.has(fid)) continue;
      tried.add(fid);
      const links = await frame.$$("a").catch(() => []);
      for (const el of links) {
        const raw = await el.textContent().catch(() => "");
        const text = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (text !== normalized) continue;
        if (!(await el.isVisible().catch(() => false))) continue;
        await el.click({ force: true }).catch(() => {});
        await page.waitForTimeout(350).catch(() => {});
        return true;
      }
    } catch (_) {}
  }
  return false;
}

async function clickArlingtonPlanReviewSubTabBounded(
  page,
  label,
  timeoutMs = ARLINGTON_SECONDARY_TAB_DOM_CLICK_MS,
) {
  try {
    return await Promise.race([
      clickArlingtonPlanReviewSubTabQuick(page, label),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  } catch (_) {
    return false;
  }
}

/**
 * Arlington ERMS: click a top-level Plan Review tab inside the integrated frame only.
 */
async function clickArlingtonErmsTopTab(frame, page, label) {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  if (!frame || typeof frame.$$ !== "function") return false;
  try {
    const candidates = await frame.$$('a, [role="tab"], button').catch(() => []);
    for (const el of candidates) {
      const raw = await el.textContent().catch(() => "");
      const text = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text !== normalized) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      console.log(
        `[Arlington][PlanReview] clicked top tab "${label}"`,
      );
      await el.click({ force: true }).catch(() => {});
      await waitForAccelaLoad(page).catch(() => {});
      await page.waitForTimeout(380).catch(() => {});
      return true;
    }
  } catch (_) {
    /**/
  }
  return false;
}

/**
 * Resolve the active top-level ERMS tab panel (`#href` target or `aria-controls`) for secondary extraction.
 * @returns {Promise<import("playwright").ElementHandle | null>}
 */
async function getArlingtonActiveErmsTopTabPanel(frame, expectedLabel) {
  if (!frame || typeof frame.evaluateHandle !== "function") return null;
  const handle = await frame
    .evaluateHandle((expectedLabelArg) => {
      const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
      const exp = norm(expectedLabelArg).toLowerCase();

      /** @returns {boolean} */
      function headingMatches(navTextLower) {
        if (!navTextLower) return false;
        if (navTextLower === exp) return true;
        if (exp.includes("review results")) {
          return /review\s+results/.test(navTextLower);
        }
        if (exp.includes("approved documents")) {
          return (
            /approved/.test(navTextLower) && /document/.test(navTextLower)
          );
        }
        if (exp.includes("project information"))
          return /project\s+information/.test(navTextLower);
        return navTextLower.includes(exp) || exp.includes(navTextLower);
      }

      /** @type {HTMLElement | null} */
      let anchorFromLi = null;
      const lis = [
        ...document.querySelectorAll(
          ".ui-tabs-nav > li, .ui-tabs .ui-tabs-nav li, ul[role=\"tablist\"] > li",
        ),
      ];
      for (const li of lis) {
        /** @type {HTMLElement} */
        const liEl = li;
        const a =
          /** @type {HTMLAnchorElement | null} */ (
            liEl.querySelector(
              'a[href^="#"], a.ui-tabs-anchor, a[role="tab"]',
            ) || liEl.querySelector("a")
          );
        const navPiece = norm(
          a ? a.innerText || a.textContent : li.innerText || li.textContent,
        ).toLowerCase();
        if (!headingMatches(navPiece)) continue;
        const isActive =
          liEl.classList.contains("ui-tabs-active") ||
          liEl.classList.contains("ui-state-active") ||
          liEl.classList.contains("selected") ||
          (a &&
            /^true$/i.test(`${a.getAttribute("aria-selected") || ""}`)) ||
          /^true$/i.test(`${li.getAttribute("aria-selected") || ""}`);
        if (isActive) {
          anchorFromLi = /** @type {HTMLElement} */ (a || liEl);
          break;
        }
      }

      /** @returns {HTMLElement | null} */
      function panelFromHrefOrControls(el) {
        if (!el) return null;
        const hrefRaw = `${el.getAttribute("href") || ""}`.trim();
        if (hrefRaw.startsWith("#")) {
          try {
            const id = hrefRaw.slice(1);
            const byId = document.getElementById(id);
            if (byId) return /** @type {HTMLElement} */ (byId);
            const qp = document.querySelector(hrefRaw);
            if (qp) return /** @type {HTMLElement} */ (qp);
          } catch (_) {
            /**/
          }
        }
        const ac =
          `${el.getAttribute("aria-controls") || ""}`.trim() ||
          `${el.closest("li")?.getAttribute("aria-controls") || ""}`.trim();
        if (ac) {
          const p = document.getElementById(ac);
          if (p) return /** @type {HTMLElement} */ (p);
        }
        return null;
      }

      /** @type {HTMLElement | null} */
      let panel = anchorFromLi
        ? panelFromHrefOrControls(anchorFromLi)
        : null;

      if (!panel) {
        const loose = lis.find((li) => {
          const liEl = /** @type {HTMLElement} */ (li);
          const a =
            liEl.querySelector(
              'a[href^="#"], a.ui-tabs-anchor, a[role="tab"]',
            ) || liEl.querySelector("a");
          const nt = norm(
            a ? a.innerText || a.textContent : li.innerText,
          ).toLowerCase();
          return headingMatches(nt);
        });
        if (loose) {
          const a =
            loose.querySelector(
              'a[href^="#"], a.ui-tabs-anchor, a[role="tab"]',
            ) || loose.querySelector("a");
          panel = panelFromHrefOrControls(/** @type {HTMLElement} */ (a || loose));
        }
      }

      if (panel && panel.tagName === "BODY") panel = null;

      if (!panel) {
        const panels = [
          ...document.querySelectorAll(
            '.ui-tabs-panel, [role="tabpanel"], .tab-content, .tab-pane',
          ),
        ].filter((el) => {
          try {
            const ee = /** @type {HTMLElement} */ (el);
            if (ee.classList.contains("ui-tabs-hide")) return false;
            if (
              `${ee.getAttribute("aria-hidden") || ""}`.toLowerCase() ===
              "true"
            )
              return false;
            const st = getComputedStyle(ee);
            if (st.display === "none" || st.visibility === "hidden")
              return false;
            const r = ee.getBoundingClientRect();
            return r.width > 16 && r.height > 20;
          } catch (_) {
            return false;
          }
        });
        const textOf = (el) =>
          norm(el.innerText || el.textContent || "");
        const heuristicPanel = panels.find((el) => {
          const text = textOf(/** @type {HTMLElement} */ (el));
          if (text.length < 20) return false;
          if (exp.includes("review results")) {
            return (
              /Comment Letters|Plan Mark[\s\-]*ups|Review Results Letter|Review Status/i.test(
                text,
              ) &&
              !/Plan Set Documents|Construction Plans|Proposed Plat\/Site Plan/i.test(
                text,
              )
            );
          }
          if (exp.includes("approved documents")) {
            return (
              /Approved Plan Set|Approved Documents|Review Results Letter/i.test(
                text,
              ) &&
              !/Plan Set Documents|Construction Plans|Proposed Plat\/Site Plan/i.test(
                text,
              )
            );
          }
          if (exp.includes("project information")) {
            return (
              /Project Information|Project ID|Project Status|Applicant|Owner/i.test(
                text,
              ) &&
              !/Plan Set Documents|Construction Plans|Proposed Plat\/Site Plan/i.test(
                text,
              )
            );
          }
          return false;
        });
        panel = heuristicPanel || null;
      }

      return panel;
    }, expectedLabel)
    .catch(() => null);

  if (!handle) return null;
  const element = typeof handle.asElement === "function" ? handle.asElement() : null;
  if (!element) {
    await handle.dispose().catch(() => {});
    return null;
  }
  return element;
}

/**
 * Diagnostics for Arlington secondary tab extraction (scoped panel).
 */
async function logArlingtonErmsSecondaryActivePanelDiag(panelHandle, tabLabelForLog) {
  if (!panelHandle) return;
  try {
    const stats = await panelHandle.evaluate((panel) => {
      if (!(panel instanceof Element)) return null;
      /** @type {Element} */
      const el = panel;
      const text = `${el.innerText || el.textContent || ""}`
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
      const tables = [...el.querySelectorAll("table")];
      let trCount = 0;
      for (const tb of tables) trCount += tb.querySelectorAll("tr").length;
      const actionCount = el.querySelectorAll(
        'input.docaction, input.img-button.docaction, input[type="image"], a[href], button',
      ).length;
      return {
        preview: text,
        tables: tables.length,
        rows: trCount,
        actions: actionCount,
      };
    });
    if (stats && typeof stats === "object") {
      console.log(
        `[Arlington][PlanReview] active panel "${tabLabelForLog}" preview=${stats.preview}`,
      );
      console.log(
        `[Arlington][PlanReview] active panel "${tabLabelForLog}" rows=${stats.rows} actions=${stats.actions}`,
      );
    }
  } catch (_) {
    /**/
  }
}

/**
 * Infer ERMS numeric PlanDoc/document id from download control onclick/href blobs.
 * @param {string} hayRaw
 * @returns {string}
 */
function arlingtonInferErmsPlanDocIdFromDomActionHaystack(hayRaw) {
  const hay = `${hayRaw || ""}`.slice(0, 8000);
  if (!hay.trim()) return "";
  const patterns = [
    /\bPlanDoc(?:ID|Id)\s*[:=]\s*['"]?(\d{5,})['"]?/i,
    /\bplanDocId\s*[:=]\s*['"]?(\d{5,})['"]?/i,
    /\b(?:DocumentId|DOCUMENTID|DOCUMENT_ID)\s*[:=']\s*['"]?(\d{5,})['"]?/i,
    /InvokeDownloadDocument\D*(\d{5,})\b/i,
    /PollDownloadDocument\D*[\(\[]\s*['"]?(\d{5,})['"]?/i,
    /DownloadDocument\D*[\(\[]\s*['"]?(\d{5,})['"]?/i,
    /\(?\s*['"]?\s*(\d{7,})\s*['"]?\s*\)?/,
    /[=,]\s*['"]?\s*(\d{7,})\s*['"]?\s*[,;)}\]]/,
  ];
  for (const p of patterns) {
    const m = hay.match(p);
    const v = m && m[1] ? `${m[1]}`.trim() : "";
    if (/^\d{5,}$/.test(v)) return v;
  }
  return "";
}

/**
 * @param {Record<string, unknown>} row — raw secondary DOM row (pre-doc map).
 * @param {string} [sourceTabKey] — `approvedDocuments`, `reviewResultsAndMarkups`, etc.
 * @returns {boolean}
 */
function isArlingtonPlanSetLeak(row, sourceTabKey) {
  if (!row || typeof row !== "object") return false;
  const nm = `${row.name || ""}`.trim();

  /** Legitimate Approved Documents packaged row — not Plan Set sheet leakage. */
  if (
    `${sourceTabKey || ""}` === "approvedDocuments" &&
    /Approved Plan Set\b/i.test(nm) &&
    !/^C-\d+/i.test(nm) &&
    !/^RW-3329/i.test(nm)
  ) {
    return false;
  }

  const text = [
    nm,
    row.filename,
    row.documentType,
    row.sheetType,
    row.description,
    row.text,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    /^C-\d+/i.test(nm) ||
    /^RW-3329/i.test(nm) ||
    /SOSI - McDonalds - Arlington/i.test(nm) ||
    /Construction Plans/i.test(text) ||
    /Proposed Plat\/Site Plan/i.test(text) ||
    /Plan Set Documents/i.test(text)
  );
}

/**
 * Discard Plan Set sheet rows leaked into RR / Approved / PI when panel resolution fails.
 * @param {string} [tabKeyCamel] Arlington integrated tab key (for context-aware leakage).
 * @returns {{ kept: object[], rejected: number }}
 */
function arlingtonFilterSecondaryDomRowsAgainstPlanSet(
  rawRows,
  tabLabelForLog,
  tabKeyCamel,
) {
  /** @type {object[]} */
  const kept = [];
  let rejected = 0;
  if (!Array.isArray(rawRows)) return { kept, rejected };

  for (const row of rawRows) {
    if (!row || typeof row !== "object") continue;
    if (isArlingtonPlanSetLeak(row, tabKeyCamel)) rejected++;
    else kept.push(row);
  }

  if (rejected > 0) {
    console.log(
      `[Arlington][PlanReview] ${`${tabLabelForLog || ""}`.trim()} rejected Plan Set leakage rows=${rejected}`,
    );
  }

  return { kept, rejected };
}

async function extractPlanReviewTablesLinksFromFrames(page, ctx) {
  const extractionSnippet = () => {
    const tables = [];
    document.querySelectorAll("table").forEach((table) => {
      const txt = (table.innerText || "").trim();
      if (txt.length < 12) return;
      const rows = [];
      table.querySelectorAll("tr").forEach((tr) => {
        const cells = [...tr.querySelectorAll("th, td")].map((c) =>
          (c.textContent || "").replace(/\s+/g, " ").trim(),
        );
        if (cells.some(Boolean)) rows.push(cells);
      });
      if (rows.length) tables.push({ rows });
    });
    const links = [...document.querySelectorAll("a[href]")]
      .map((a) => ({
        text: (a.textContent || "").trim().slice(0, 200),
        href: (a.getAttribute("href") || "").slice(0, 400),
      }))
      .filter((x) => x.text && x.href);
    const text = document.body ? document.body.innerText.slice(0, 10000) : "";
    return { tables, links: links.slice(0, 120), text };
  };

  const ranked = rankFramesForArlingtonPlanReview(page);
  const framesOrdered = [];
  const seen = new Set();
  for (const f of [ctx, ...ranked]) {
    if (!f || seen.has(f)) continue;
    seen.add(f);
    framesOrdered.push(f);
  }

  let best = { tables: [], links: [], text: "" };
  let bestScore = -1;
  for (const frame of framesOrdered) {
    if (!frame || typeof frame.evaluate !== "function") continue;
    try {
      const extracted = await frame.evaluate(extractionSnippet);
      const sc =
        (extracted.tables?.length || 0) * 10 +
        (extracted.links?.length || 0) +
        Math.min((extracted.text?.length || 0) / 100, 50);
      if (sc > bestScore) {
        bestScore = sc;
        best = extracted;
      }
    } catch (_) {}
  }
  return best;
}

/**
 * Exclude admin-only filenames from Arlington Plan Review tab mapping — keep them under Attachments only.
 */
function shouldExcludeAttachmentFromPlanReviewMapping(rawTrimmed, nameLower) {
  const t = (rawTrimmed || "").trim();
  if (!t) return true;
  if (/\bpermit placard\b/i.test(nameLower)) return true;
  if (/^invoice\b/i.test(t)) return true;
  if (/^receipt\b/i.test(t)) return true;
  if (/^permit\b/i.test(t) && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return true;
  if (/^permit\s+[0-9]/i.test(t)) return true;
  return false;
}

/**
 * @returns {{ tabKey: string, sectionKey: string|null, label: string } | null}
 */
function classifyArlingtonAttachmentForPlanReview(att) {
  const raw = `${att.name || att.filename || att.title || ""}`.trim();
  const name = raw.toLowerCase();

  if (shouldExcludeAttachmentFromPlanReviewMapping(raw, name)) return null;

  if (
    name.includes("review results letter") ||
    name.includes("mark-up") ||
    name.includes("markup")
  ) {
    return {
      tabKey: "reviewResultsAndMarkups",
      sectionKey: null,
      label: "Review Results & Mark-ups",
    };
  }

  if (name.includes("comment response letter")) {
    return {
      tabKey: "plansAndDocuments",
      sectionKey: "commentResponseLetters",
      label: "Comment Response Letters",
    };
  }

  if (
    name.includes("other supporting document") ||
    /\bsupporting document\b/i.test(name)
  ) {
    return {
      tabKey: "plansAndDocuments",
      sectionKey: "supportingDocuments",
      label: "Supporting Documents",
    };
  }

  if (name.includes("approved document") || name.includes("approved")) {
    return {
      tabKey: "approvedDocuments",
      sectionKey: null,
      label: "Approved Documents",
    };
  }

  if (
    name.includes("plan") ||
    name.includes("drawing") ||
    name.includes("sheet") ||
    name.includes("record summary")
  ) {
    return {
      tabKey: "plansAndDocuments",
      sectionKey: "planSetDocuments",
      label: "Plan Set Documents",
    };
  }

  return null;
}

function planReviewNormAttachmentName(att) {
  return `${att.name || att.filename || att.title || ""}`
    .trim()
    .toLowerCase();
}

function attachmentRowToPlanReviewDoc(att, sourceSection, sourceTab) {
  const url = att.viewUrl || att.publicUrl || att.downloadUrl || "";
  const fn = att.name || att.filename || "";
  return {
    name: fn,
    filename: fn,
    documentDate: att.latest_update || att.documentDate || "",
    size: att.size || "",
    status: att.downloadStatus || "",
    storagePath: att.storagePath || "",
    publicUrl: url,
    downloadUrl: url,
    sourceTab: sourceTab || "attachments",
    sourceSection,
  };
}

/** Maps a scraped attachment row into Plan Review normalized docs (reuse upload metadata; no download). */
function attachmentRowToArlingtonMappedPlanReviewDoc(att, classification) {
  const url = att.viewUrl || att.publicUrl || att.downloadUrl || "";
  const fn = att.name || att.filename || "";

  return {
    name: fn,
    filename: fn,
    documentDate: att.latest_update || att.documentDate || "",
    size: att.size || "",
    status: att.downloadStatus || "",
    storagePath: att.storagePath || "",
    publicUrl: url,
    downloadUrl: url,
    sourceTab: classification.tabKey,
    sourceSection: classification.sectionKey || null,
    source: "record_info_attachments",
  };
}

function portalDownloadCandidateToPlanReviewDoc(d, sourceSection) {
  const label = (d.text || d.label || "").trim();
  const href = (d.href || "").trim();
  return {
    name: label,
    filename: label,
    documentDate: "",
    size: "",
    status: "portal_link",
    storagePath: "",
    publicUrl: "",
    downloadUrl: href,
    sourceTab: "plan_review",
    sourceSection,
  };
}

function planReviewDocDedupeKey(doc) {
  const name = `${doc.name || doc.filename || ""}`.trim().toLowerCase();
  const url = `${doc.publicUrl || doc.downloadUrl || ""}`.trim();
  return `${name}##${url}`;
}

function arlingtonIntegratedRowDedupeKey(name, docDate, size, revision) {
  return `${planReviewNormAttachmentName({ name })}
###${String(docDate || "").trim().toLowerCase()}
###${String(size || "").trim().toLowerCase()}
###${String(revision || "").trim().toLowerCase()}`
    .trim();
}

function attachmentDedupeSnapshotSet(rows) {
  const s = new Set();
  const list = Array.isArray(rows) ? rows : [];
  for (const att of list) {
    s.add(
      arlingtonIntegratedRowDedupeKey(
        att.name,
        att.latest_update || att.documentDate || "",
        att.size || "",
        "",
      ),
    );
  }
  return s;
}

function arlExtractNumericDocHandleFromErmsRaw(row) {
  if (!row || typeof row !== "object") return "";
  const o = /** @type {Record<string, unknown>} */ (row);
  const v =
    o.dochandle ??
    o.docHandle ??
    o.DocHandle ??
    o.DOCHANDLE ??
    o.doc_handle ??
    "";
  const s = `${v ?? ""}`.trim();
  return /^\d+$/.test(s) ? s : "";
}

function arlingtonApplyRecordInfoAttachmentAliasToSecondaryDoc(doc, srcAttRow) {
  const url =
    `${srcAttRow.publicUrl || srcAttRow.viewUrl || srcAttRow.downloadUrl || ""}`.trim();
  if (!/^https?:\/\//i.test(url)) return;
  doc.publicUrl = url;
  doc.downloadUrl = url;
  doc.storagePath = `${srcAttRow.storagePath || ""}`.trim();
  doc.downloadStatus = "aliased_attachment";
  doc.status = "downloaded";
  doc.secondaryAliasSource = "record_info_attachments";
}

function arlingtonRecordInfoAttachmentRowHasUploadedFile(att) {
  if (!att || typeof att !== "object") return false;
  const url =
    `${att.publicUrl || att.viewUrl || att.downloadUrl || ""}`.trim();
  if (!/^https?:\/\//i.test(url)) return false;
  return true;
}

/**
 * Filename-only bridge: reuse Record Info attachment bytes when ERMS/API row matches.
 */
function arlingtonApplyRecordInfoAttachmentAliasesToSecondaryTabs(
  norm,
  attachList,
) {
  const list = Array.isArray(attachList) ? attachList : [];
  const uploaded = list.filter(arlingtonRecordInfoAttachmentRowHasUploadedFile);
  if (!uploaded.length) return;

  /** @type {{ docs: unknown[]; tabLog: string }[]} */
  const targets = [];
  const rrDocs = norm?.reviewResultsAndMarkups?.documents;
  if (Array.isArray(rrDocs))
    targets.push({ docs: rrDocs, tabLog: "Review Results & Mark-ups" });
  const adDocs = norm?.approvedDocuments?.documents;
  if (Array.isArray(adDocs))
    targets.push({ docs: adDocs, tabLog: "Approved Documents" });
  const piDocs = norm?.projectInformation?.documents;
  if (Array.isArray(piDocs))
    targets.push({ docs: piDocs, tabLog: "Project Information" });

  for (const { docs, tabLog } of targets) {
    for (const raw of docs) {
      const doc = /** @type {Record<string, unknown>} */ (raw);
      if (!doc || typeof doc !== "object") continue;
      const hasLoc =
        /^https?:\/\//i.test(
          `${doc.publicUrl || doc.downloadUrl || ""}`.trim(),
        );
      if (hasLoc && `${doc.downloadStatus || ""}` !== "metadata_only")
        continue;
      const nk = planReviewNormAttachmentName({
        name:
          `${doc.name || doc.filename || ""}`,
      });
      if (!nk) continue;
      const hit = uploaded.find((a) => planReviewNormAttachmentName(a) === nk);
      if (!hit) continue;
      arlingtonApplyRecordInfoAttachmentAliasToSecondaryDoc(doc, hit);
      console.log(
        `[Arlington][PlanReview] secondary attachment alias ${tabLog} ${`${doc.name || doc.filename || ""}`.trim()}`,
      );
    }
  }
}

/** @returns {{ downloads: number; metadataOnly: number; aliases: number }} */
function arlingtonSummarizeSecondaryTabDocs(docs) {
  let downloads = 0;
  let metadataOnly = 0;
  let aliases = 0;
  for (const raw of docs || []) {
    const d = /** @type {Record<string, unknown>} */ (raw);
    if (!d || typeof d !== "object") continue;
    const ds = `${d.downloadStatus || ""}`.trim().toLowerCase();
    const url = `${d.publicUrl || d.downloadUrl || ""}`.trim();
    if (ds === "aliased_attachment" || ds === "aliased_duplicate") aliases++;
    else if (ds === "metadata_only") metadataOnly++;
    else if (/^https?:\/\//i.test(url)) downloads++;
    else if (ds === "uploaded") downloads++;
  }
  return { downloads, metadataOnly, aliases };
}

function defaultArlingtonIntegratedTabsSkeleton() {
  return {
    plansAndDocuments: {
      label: "Plans & Documents",
      sections: {
        planSetDocuments: {
          label: "Plan Set Documents",
          documents: [],
        },
        supportingDocuments: {
          label: "Supporting Documents",
          documents: [],
        },
        commentResponseLetters: {
          label: "Comment Response Letters",
          documents: [],
        },
      },
      documents: [],
    },
    reviewResultsAndMarkups: {
      label: "Review Results & Mark-ups",
      documents: [],
      comments: [],
    },
    approvedDocuments: {
      label: "Approved Documents",
      documents: [],
    },
    projectInformation: {
      label: "Project Information",
      fields: [],
      requiredDocumentTypes: [],
      documents: [],
    },
  };
}

/** Arlington portal scope — only Plans & Documents → Plan Set Documents (unless Stage 2 enabled). */
function narrowArlingtonPlanReviewNormalizedToPlanSetOnly(norm) {
  const prOpts = ArlingtonAccelaProfile.planReview || {};
  if (prOpts.planReviewIncludeSecondaryTabs === true && norm) {
    try {
      const next = defaultArlingtonIntegratedTabsSkeleton();
      for (const key of Object.keys(next)) {
        if (!norm[key]) continue;
        next[key] = JSON.parse(JSON.stringify(norm[key]));
      }
      return next;
    } catch (_) {
      /** fall through to plan-set-only narrow */
    }
  }

  const next = defaultArlingtonIntegratedTabsSkeleton();
  try {
    const rows =
      norm?.plansAndDocuments?.sections?.planSetDocuments?.documents;
    if (Array.isArray(rows) && rows.length) {
      next.plansAndDocuments.sections.planSetDocuments.documents =
        JSON.parse(JSON.stringify(rows));
    }
    if (norm?.plansAndDocuments?.label) {
      const lab = `${norm.plansAndDocuments.label}`.trim();
      if (lab) next.plansAndDocuments.label = lab;
    }
  } catch (_) {
    /**/
  }
  return next;
}

async function dismissArlingtonPlanReviewModals(page) {
  const needles = ["no additional documents required", "submit active revision"];
  const clickSelectors = [
    'button:has-text("OK")',
    '[role="button"]:has-text("OK")',
    'input[value="OK"]',
    'input[value="Ok"]',
    'button:has-text("Ok")',
    'button:has-text("CLOSE")',
    'button:has-text("Close")',
    'button:has-text("Continue")',
    'input[value="Close"]',
    'a:has-text("OK")',
  ];
  const maxPasses = 4;
  for (let pass = 0; pass < maxPasses; pass++) {
    let dismissed = false;
    for (const fr of [...page.frames()]) {
      let bodyTxt = "";
      try {
        bodyTxt =
          fr === page.mainFrame()
            ? await page
                .evaluate(() =>
                  document.body ? document.body.innerText || "" : "",
                )
                .catch(() => "")
            : await fr
                .evaluate(() =>
                  document.body ? document.body.innerText || "" : "",
                )
                .catch(() => "");
      } catch (_) {
        /**/
      }
      const low = bodyTxt.toLowerCase();
      if (!needles.some((n) => low.includes(n))) continue;
      const urlHint =
        typeof fr.url === "function" ? fr.url().substring(0, 120) : "";
      console.log(
        `[Arlington][Plan Review] modal detected: no additional documents required (${urlHint})`,
      );
      for (const sel of clickSelectors) {
        try {
          const btn = await fr.$(sel).catch(() => null);
          if (btn && (await btn.isVisible().catch(() => false))) {
            await btn.click({ force: true }).catch(() => {});
            dismissed = true;
            console.log(
              `[Arlington][Plan Review] clicked OK modal (${sel})`,
            );
            break;
          }
        } catch (_) {}
      }
    }
    if (!dismissed) break;
    await page.waitForTimeout(550).catch(() => {});
    await waitForAccelaLoad(page).catch(() => {});
  }
}

async function pickArlingtonIntegratedContentFrame(page) {
  let best = null;
  let bestScore = -1;
  const frames = page.frames();
  for (const fr of frames) {
    let u = "";
    try {
      u = fr.url() || "";
    } catch (_) {
      continue;
    }
    const low = u.toLowerCase();
    if (
      !/planreviewintegrated|prd-ermsaccela-arlingtonva|prd-ermsaccela/i.test(
        low,
      )
    ) {
      continue;
    }
    let score = 20;
    if (/planreviewintegrated/i.test(low)) score += 30;
    const nTables = await fr
      .evaluate(() => document.querySelectorAll("table").length)
      .catch(() => 0);
    score += Math.min((Number(nTables) || 0) * 6, 60);
    if (score > bestScore) {
      bestScore = score;
      best = fr;
    }
  }
  if (best && best.url) {
    console.log(
      `[Arlington][Plan Review] integrated frame: ${(best.url() || "").substring(0, 220)}`,
    );
  }
  return best;
}

/**
 * Merge integrated iframe Plan Review scrape with attachment classification.
 */
function finalizeArlingtonPlanReviewAfterAttachments(planReview, attachmentRows) {
  const arlPrev = planReview.arlingtonPlanReview;
  const legacyTabs =
    arlPrev &&
    arlPrev.legacyExplorerTabs != null &&
    typeof arlPrev.legacyExplorerTabs === "object"
      ? arlPrev.legacyExplorerTabs
      : arlPrev?.tabs;
  const attachmentBackedNames = new Set();

  const prOpts = ArlingtonAccelaProfile.planReview || {};
  /** Arlington-only finalize — scoped to Plans & Documents → Plan Set Documents. */
  const scopePlanSetOnly = prOpts.scopePlanSetDocumentsOnly !== false;
  const preserveAllIntegratedTabs =
    prOpts.planReviewIncludeSecondaryTabs === true;

  const hadErmsApiDelivery =
    arlPrev?.integratedTabsFromExternalApi === true;

  const hadInternalIframeExtract =
    arlPrev?.integratedTabsFromInternalIframe === true;

  const hadExternalDomExtract =
    arlPrev?.integratedTabsFromExternalDom === true;

  const allowIframeIntegratedDocs =
    prOpts.downloadFromIntegratedIframe === true;
  const mapFromAttachmentsConfigured =
    prOpts.mapDocumentsFromAttachments !== false;

  /** Push Record Info classifications into buckets (only when not Plan-Set scoped). */
  const effectiveMapAttachments =
    preserveAllIntegratedTabs
      ? false
      : scopePlanSetOnly
        ? false
        : mapFromAttachmentsConfigured;

  if (preserveAllIntegratedTabs) {
    console.log(`[Arlington][PlanReview] scope=all_plan_review_tabs`);
  } else if (scopePlanSetOnly) {
    console.log(
      `[Arlington][PlanReview] scope=plans_documents.plan_set_documents only`,
    );
    console.log(
      `[Arlington][PlanReview] fallback attachments disabled`,
    );
  }
  const mergedIntegratedTabs = planReview.arlingtonPlanReview?.integratedTabs;

  const integratedIncoming =
    mergedIntegratedTabs && typeof mergedIntegratedTabs === "object"
      ? mergedIntegratedTabs
      : null;

  /** @type {ReturnType<typeof defaultArlingtonIntegratedTabsSkeleton>} */
  let normalized;
  try {
    normalized = integratedIncoming
      ? JSON.parse(JSON.stringify(integratedIncoming))
      : defaultArlingtonIntegratedTabsSkeleton();
  } catch (_) {
    normalized = defaultArlingtonIntegratedTabsSkeleton();
  }

  const seen = new Set();

  /** @type {unknown[]} */
  const emptyFields = normalized.projectInformation.fields;
  normalized.projectInformation.fields = Array.isArray(emptyFields)
    ? emptyFields
    : [];

  function pushDoc(bucketKey, doc) {
    if (!normalized[bucketKey]) return false;
    const k = planReviewDocDedupeKey(doc);
    if (!k || k === "##") return false;
    if (seen.has(k)) return false;
    seen.add(k);
    normalized[bucketKey].documents.push(doc);
    return true;
  }

  function pushClassifiedAttachmentDoc(classified, doc) {
    const k = planReviewDocDedupeKey(doc);
    if (!k || k === "##") return false;
    if (seen.has(k)) return false;
    if (!classified || !classified.tabKey) return false;

    const { tabKey, sectionKey } = classified;

    seen.add(k);
    if (
      tabKey === "plansAndDocuments" &&
      sectionKey &&
      normalized.plansAndDocuments?.sections?.[sectionKey]
    ) {
      normalized.plansAndDocuments.sections[sectionKey].documents.push(doc);
      return true;
    }
    if (normalized[tabKey] && Array.isArray(normalized[tabKey].documents)) {
      normalized[tabKey].documents.push(doc);
      return true;
    }

    /** rare: unknown tab bucket */
    seen.delete(k);
    return false;
  }

  const attachList = Array.isArray(attachmentRows) ? attachmentRows : [];
  if (effectiveMapAttachments !== false) {
    for (const att of attachList) {
      const classified = classifyArlingtonAttachmentForPlanReview(att);
      if (!classified) continue;
      const doc = attachmentRowToArlingtonMappedPlanReviewDoc(att, classified);
      attachmentBackedNames.add(planReviewNormAttachmentName(att));
      pushClassifiedAttachmentDoc(classified, doc);
    }
  }

  if (
    !scopePlanSetOnly &&
    allowIframeIntegratedDocs &&
    legacyTabs &&
    typeof legacyTabs === "object"
  ) {
    for (const [camelKey, section] of Object.entries(legacyTabs)) {
      if (!section || typeof section !== "object") continue;
      if (
        section.found &&
        Array.isArray(section.downloadCandidates)
      ) {
        for (const d of section.downloadCandidates) {
          const doc = portalDownloadCandidateToPlanReviewDoc(d, camelKey);
          const nm = `${doc.name || ""}`.trim().toLowerCase();
          if (
            nm &&
            attachmentBackedNames.has(nm) &&
            doc.status === "portal_link"
          ) {
            continue;
          }
          pushDoc(camelKey, doc);
        }
      }
    }
  }

  if (scopePlanSetOnly && !preserveAllIntegratedTabs) {
    normalized = narrowArlingtonPlanReviewNormalizedToPlanSetOnly(normalized);
  }

  if (preserveAllIntegratedTabs && Array.isArray(attachList) && attachList.length) {
    arlingtonApplyRecordInfoAttachmentAliasesToSecondaryTabs(normalized, attachList);
  }

  const planSetDocCount =
    normalized?.plansAndDocuments?.sections?.planSetDocuments?.documents
      ?.length ?? 0;
  const reviewResultsCount =
    normalized?.reviewResultsAndMarkups?.documents?.length ?? 0;
  const approvedCount = normalized?.approvedDocuments?.documents?.length ?? 0;
  const piDocCount = normalized?.projectInformation?.documents?.length ?? 0;
  const piFieldCount = normalized?.projectInformation?.fields?.length ?? 0;
  const hasNormalizedDocs =
    planSetDocCount > 0 ||
    reviewResultsCount > 0 ||
    approvedCount > 0 ||
    piDocCount > 0 ||
    (prOpts.planReviewIncludeSecondaryTabs === true && piFieldCount > 0);

  console.log(
    `[Arlington][PlanReview] Plan Set Documents extracted=${planSetDocCount}`,
  );

  const msgLow = (`${arlPrev?.message || planReview.message || ""}`).trim().toLowerCase();
  const portalUnused = msgLow.includes("does not use plan review");

  const timedOut = planReview.arlingtonPlanReview?.timeout === true;

  if (
    scopePlanSetOnly &&
    !preserveAllIntegratedTabs &&
    !portalUnused &&
    !hasNormalizedDocs
  ) {
    console.log(
      `[Arlington][PlanReview] extraction failed — not using Record Info attachments`,
    );
  }

  let source = "plan_review_unknown";
  if (portalUnused) {
    source = "plan_review_portal_unused";
  } else if (!hasNormalizedDocs) {
    source = timedOut ? "plan_review_plan_set_timed_out" : "plan_review_plan_set_pending";
  } else if (hadInternalIframeExtract) {
    source = "plan_review_internal_iframe";
  } else if (hadExternalDomExtract) {
    source = "plan_review_external_page";
  } else if (hadErmsApiDelivery) {
    source = "plan_review_erms_api";
  } else if (allowIframeIntegratedDocs) {
    source = "plan_review_integrated_iframe";
  } else {
    source = "plan_review_plan_set_iframe_meta";
  }



  let used = false;

  if (portalUnused && !hasNormalizedDocs) {
    used = false;
  } else if (portalUnused && hasNormalizedDocs) {
    used = true;
  } else {
    used = arlPrev.used !== false;
  }


  /** @type {string|null} */
  let message = arlPrev.message ?? null;

  if (
    !portalUnused &&
    scopePlanSetOnly &&
    !preserveAllIntegratedTabs &&
    !hasNormalizedDocs
  ) {
    message = "Plan Set Documents were not extracted yet";
  }

  if (timedOut && !scopePlanSetOnly && !portalUnused && !planSetDocCount) {
    message =
      message ||
      "Plan Review iframe checked, but document downloads were skipped or timed out.";
  }

  if (
    portalUnused &&
    hasNormalizedDocs &&
    message &&
    !scopePlanSetOnly
  ) {
    message = `${message} Attachments include plan-review-related documents; listed below.`;
  }

  const prevExtra = planReview.arlingtonPlanReview || {};
  planReview.arlingtonPlanReview = {
    ...prevExtra,
    used,
    message,
    source,
    tabs: normalized,
    ...(timedOut ? { timeout: true } : {}),
    tenantPlanReview: {
      enabled: prOpts.enabled !== false,
      downloadFromIntegratedIframe: !!prOpts.downloadFromIntegratedIframe,
      mapDocumentsFromAttachments: !!effectiveMapAttachments,
      planReviewIncludeSecondaryTabs:
        prOpts.planReviewIncludeSecondaryTabs === true,
      perTabExtractBudgetMs:
        typeof prOpts.perTabExtractBudgetMs === "number"
          ? prOpts.perTabExtractBudgetMs
          : 45000,
      extractBudgetMs:
        typeof prOpts.extractBudgetMs === "number"
          ? prOpts.extractBudgetMs
          : 75000,
      scopePlanSetDocumentsOnly:
        preserveAllIntegratedTabs
          ? false
          : scopePlanSetOnly
            ? true
            : false,
      ...(preserveAllIntegratedTabs
        ? { planReviewEffectiveScope: "all_plan_review_tabs" }
        : scopePlanSetOnly
          ? { planReviewEffectiveScope: "plans_documents.plan_set_documents" }
          : {}),
    },
  };

  const rrDocsFin = normalized?.reviewResultsAndMarkups?.documents || [];
  const adDocsFin = normalized?.approvedDocuments?.documents || [];
  const piDocsFin = normalized?.projectInformation?.documents || [];
  const rrSt = arlingtonSummarizeSecondaryTabDocs(rrDocsFin);
  const adSt = arlingtonSummarizeSecondaryTabDocs(adDocsFin);
  const piSt = arlingtonSummarizeSecondaryTabDocs(piDocsFin);
  const piFieldsLen = normalized?.projectInformation?.fields?.length ?? 0;
  if (preserveAllIntegratedTabs) {
    console.log("[Arlington][PlanReview] final tabs=4");
    console.log(
      `[Arlington][PlanReview] Review Results & Mark-ups rows=${rrDocsFin.length} downloads=${rrSt.downloads} metadataOnly=${rrSt.metadataOnly} aliases=${rrSt.aliases}`,
    );
    console.log(
      `[Arlington][PlanReview] Approved Documents rows=${adDocsFin.length} downloads=${adSt.downloads} metadataOnly=${adSt.metadataOnly} aliases=${adSt.aliases}`,
    );
    console.log(
      `[Arlington][PlanReview] Project Information fields=${piFieldsLen} documents=${piDocsFin.length} downloads=${piSt.downloads} metadataOnly=${piSt.metadataOnly} aliases=${piSt.aliases}`,
    );
  }
  delete planReview.arlingtonPlanReview.integratedTabs;
  delete planReview.arlingtonPlanReview.integratedDocCount;
  delete planReview.arlingtonPlanReview.integratedTabsFromExternalApi;
  delete planReview.arlingtonPlanReview.integratedTabsFromExternalDom;
  delete planReview.arlingtonPlanReview.integratedTabsFromInternalIframe;
  delete planReview.arlingtonPlanReview.legacyExplorerTabs;

  if (hasNormalizedDocs) {
    planReview.downloadLinks = [];
  }

  return planReview;
}

/** Nested Plans document tabs inside Arlington ERMS integrated iframe. */
const ARLINGTON_PLAN_NESTED_SECTIONS = [
  ["Plan Set Documents", "planSetDocuments"],
  ["Supporting Documents", "supportingDocuments"],
  ["Comment Response Letters", "commentResponseLetters"],
];

async function clickArlingtonIntegratedNestedTab(page, labelText) {
  const tgt = labelText.replace(/\s+/g, " ").trim().toLowerCase();
  const frames = rankFramesForArlingtonPlanReview(page).filter((fr) => {
    const u = (fr.url?.() || "").toLowerCase();
    return (
      /planreviewintegrated/.test(u) ||
      /prd-ermsaccela-arlingtonva|prd-ermsaccela/i.test(u)
    );
  });
  const tried = new Set();
  for (const frame of frames) {
    try {
      const fid = `${frame.url()}`;
      if (tried.has(fid)) continue;
      tried.add(fid);
      const anchors = await frame.$$("a, button, span, div[role]").catch(() => []);
      for (const el of anchors) {
        const raw = await el.textContent().catch(() => "");
        const text = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!text || text !== tgt) continue;
        if (!(await el.isVisible().catch(() => false))) continue;
        await el.click({ force: true }).catch(() => {});
        await waitForAccelaLoad(page).catch(() => {});
        await page.waitForTimeout(700).catch(() => {});
        return true;
      }
    } catch (_) {}
  }
  return false;
}

function arlingtonIntegratedHeuristicMeta(parts) {
  const clean = (parts || []).map((x) => String(x || "").trim()).filter(Boolean);
  const documentDate =
    clean.find((c) =>
      /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/i.test(c),
    ) || "";
  const nameGuess =
    clean.find((c) => /\.[a-z0-9]{2,12}$/i.test(c.replace(/\s/g, ""))) ||
    clean[0] ||
    "";
  let revision =
    clean.find((c) => /^rev(ision)?[\s.:]*\w+/i.test(c))?.slice(0, 80) || "";
  if (!revision && clean.length >= 6) revision = clean[clean.length - 2] || "";
  let uploadStatus =
    clean.find((c) => /pending|completed|approved|uploaded/i.test(c))?.slice(
      0,
      120,
    ) || "";

  let discipline =
    clean.length > 4 ? clean[Math.min(1, clean.length - 3)] || "" : "";
  let sheetType = clean.length > 5 ? clean[Math.min(2, clean.length - 2)] || "" : "";

  let size = "";
  const sizeCell = clean.find((c) => /\d+\s*(kb|mb|bytes?)/i.test(c));
  if (sizeCell) size = sizeCell.slice(0, 40);

  const description =
    clean
      .filter((_, i) => i > Math.min(5, clean.length - 5))
      .join(" | ")
      .slice(0, 400) ||
    clean.join(" | ").slice(0, 400);

  return {
    name: nameGuess,
    documentDate,
    discipline,
    sheetType,
    description,
    revision,
    uploadStatus,
    size,
  };
}

const ARLINGTON_PR_ACTION_HINT =
  /download|document|file|view|required|export|pdf|attachment|open|save/i;

/** Plan Review Plan Set row: IMG download `input.docaction` (no href/onclick). */
async function pickArlingtonPlanSetDownloadControl(rowHandle) {
  const compound = [
    'input.img-button.docaction[type="image"]',
    'input.img-button.docaction[title="Download"]',
    'input.img-button.docaction[alt="Download"]',
    'input.docaction[src*="file_download"]',
    'input[src*="file_download"]',
    'input.docaction[name]',
  ].join(", ");
  const raw = await rowHandle.$$(compound).catch(() => []);

  /** @type {{ score: number, docId: string, h: import('playwright').ElementHandle }}[] */
  const scored = [];
  for (const h of raw) {
    try {
      if (!(await h.isVisible().catch(() => false))) {
        await h.dispose().catch(() => {});
        continue;
      }
      const nameAttr = `${(await h.getAttribute("name")) || ""}`.trim();
      const title = `${(await h.getAttribute("title")) || ""}`.trim();
      const alt = `${(await h.getAttribute("alt")) || ""}`.trim();
      const src = `${(await h.getAttribute("src")) || ""}`.trim();
      const cls = `${(await h.getAttribute("class")) || ""}`;

      let score = 0;
      if (/^\d+$/.test(nameAttr)) score += 500;
      if (/\bdocaction\b/i.test(cls) && /\bimg-button\b/i.test(cls)) score += 80;
      if (/download/i.test(title) || /download/i.test(alt)) score += 200;
      if (/file_download/i.test(src)) score += 150;
      scored.push({
        score: score || 1,
        docId: nameAttr || "",
        h,
      });
    } catch (_) {
      await h.dispose().catch(() => {});
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0] || null;
  for (let i = 1; i < scored.length; i++) {
    await scored[i].h.dispose().catch(() => {});
  }
  if (!winner) return null;
  return {
    docId: winner.docId || "(unknown)",
    handle: winner.h,
  };
}

/**
 * @param {import('playwright').Download} download
 * @returns {Promise<{ safeDownloadName: string, publicUrl: string, storagePath: string, downloadStatus: string }>}
 */
async function persistArlingtonPlaywrightDownload(
  download,
  rowMeta,
  {
    DOWNLOADS_DIR,
    supabaseProjectId,
    uploadFnDl,
    sanitizeFnDl,
    downloadedHashes,
  },
  rowKey,
  downloadedRowKeys,
) {
  let filenameGuess = (
    String(rowMeta.name || "plan_review_doc")
      .split(/[\r\n|]+/)[0]
      .trim() || `plan_review_${Date.now()}`
  ).slice(0, 180);

  let safeDownloadName =
    `${filenameGuess}`.replace(/[\\/:*?"<>|]/g, "_");

  let tryExt = /\.[a-z0-9]{2,6}$/i.test(safeDownloadName) ? "" : ".pdf";

  safeDownloadName = (
    download.suggestedFilename() || safeDownloadName + tryExt
  ).replace(/[\\/:*?"<>|]/g, "_");

  tryExt =
    /\.[a-z0-9]{2,12}$/.test(safeDownloadName.toLowerCase()) ? "" : ".pdf";
  safeDownloadName = /\.[a-z0-9]{2,12}$/.test(safeDownloadName.toLowerCase())
    ? safeDownloadName
    : `${safeDownloadName}${tryExt}`;

  const filePath = path.join(DOWNLOADS_DIR, safeDownloadName);
  await download.saveAs(filePath).catch(() => {});
  let fileBuf = null;
  try {
    fileBuf = fs.readFileSync(filePath);
  } catch (_) {
    fileBuf = null;
  }

  let publicUrl = "";
  let storagePath = "";
  let downloadStatus = "no_capture";

  if (!fileBuf || isDownloadBufferLikelyHtmlError(fileBuf)) {
    downloadStatus = "failed_html_stub";
    try {
      fs.unlinkSync(filePath);
    } catch (_) {
      /**/
    }
    return {
      safeDownloadName,
      publicUrl,
      storagePath,
      downloadStatus,
    };
  }

  publicUrl = await tryUploadAccelaFile(
    filePath,
    safeDownloadName,
    supabaseProjectId,
    uploadFnDl,
    sanitizeFnDl,
    downloadedHashes,
  ).catch(() => "");

  storagePath =
    publicUrl && supabaseProjectId
      ? `drawings/${supabaseProjectId}/${safeDownloadName}`
      : "";
  downloadStatus = publicUrl ? "uploaded" : "local_only";
  if (publicUrl) downloadedRowKeys.add(rowKey);

  return {
    safeDownloadName,
    publicUrl,
    storagePath,
    downloadStatus,
  };
}

const ARLINGTON_ERMS_ORIGIN_FALLBACK =
  "https://prd-ermsaccela-az.arlingtonva.us";

function arlingtonResolveErmsAbsoluteUrl(originHint, candidate) {
  const base = `${originHint || ""}`.trim().replace(/\/$/, "") ||
    ARLINGTON_ERMS_ORIGIN_FALLBACK;
  const c = `${candidate || ""}`.trim();
  if (!c) return "";
  if (/^https?:\/\//i.test(c)) return c.slice(0, 4000);
  try {
    const pathPart = c.startsWith("/") ? c : `/${c}`;
    return new URL(pathPart, `${base}/`).href;
  } catch (_) {
    return "";
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function arlingtonPlanSetWithTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ]);
}

function arlingtonPlanSetBufferLooksLikePdf(buf, contentType) {
  if (!buf || !buf.length) return false;
  if (isDownloadBufferLikelyHtmlError(buf)) return false;
  const ct = `${contentType || ""}`.toLowerCase();
  if (/pdf/i.test(ct)) {
    return (
      buf.length >= 4 &&
      buf[0] === 0x25 &&
      buf[1] === 0x50 &&
      buf[2] === 0x44 &&
      buf[3] === 0x46
    );
  }
  if (/octet-stream/i.test(ct)) return true;
  return false;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function arlingtonErmsSessionClosedMessage(err) {
  const m = `${err && typeof err === "object" && "message" in err && err.message != null ? err.message : err || ""}`;
  return /Request context disposed|Target page, context or browser has been closed|browser has been closed|context has been closed/i.test(
    m,
  );
}

/**
 * @param {Record<string, unknown> | null | undefined} downloadCtx
 * @param {string} [documentId]
 */
function arlingtonPlanReviewTouchKeepalive(downloadCtx, documentId) {
  if (!downloadCtx || typeof downloadCtx !== "object") return;
  const touch = downloadCtx.touchSessionKeepalive;
  if (typeof touch === "function") {
    touch(documentId);
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} downloadCtx
 * @param {string} [documentId]
 */
function arlingtonPlanReviewDownloadBegin(downloadCtx, documentId) {
  arlingtonPlanReviewTouchKeepalive(downloadCtx, documentId);
  const session = downloadCtx && downloadCtx._arlingtonSession;
  if (session && typeof session === "object") {
    const s = /** @type {{ _activePlanReviewDownloads?: number }} */ (session);
    s._activePlanReviewDownloads =
      (Number(s._activePlanReviewDownloads) || 0) + 1;
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} downloadCtx
 */
function arlingtonPlanReviewDownloadEnd(downloadCtx) {
  const session = downloadCtx && downloadCtx._arlingtonSession;
  if (session && typeof session === "object") {
    const s = /** @type {{ _activePlanReviewDownloads?: number }} */ (session);
    s._activePlanReviewDownloads = Math.max(
      0,
      (Number(s._activePlanReviewDownloads) || 0) - 1,
    );
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} downloadCtx
 * @param {string} token
 * @param {string} source
 */
function arlingtonPlanSetCacheErmsVerificationToken(downloadCtx, token, source) {
  const tok = `${token || ""}`.trim();
  if (!downloadCtx || typeof downloadCtx !== "object" || !tok) return;
  downloadCtx.ermsVerificationToken = tok;
  if (source) downloadCtx.ermsVerificationTokenSource = source;
}

/**
 * Read ERMS anti-forgery token (frame, meta, HTML, cookies, cached).
 * @param {import('playwright').Page | import('playwright').Frame | null | undefined} clickTarget
 * @param {{ networkPage?: import('playwright').Page | null, downloadCtx?: Record<string, unknown> | null, documentId?: string }} [opts]
 * @returns {Promise<string>}
 */
async function arlingtonPlanSetReadErmsVerificationToken(clickTarget, opts = {}) {
  const networkPage = opts.networkPage || null;
  const downloadCtx =
    opts.downloadCtx && typeof opts.downloadCtx === "object"
      ? opts.downloadCtx
      : null;
  const documentId = `${opts.documentId || ""}`.trim();
  const docLog = documentId ? ` documentId=${documentId}` : "";

  /** @type {string} */
  let token = "";
  /** @type {string} */
  let source = "";

  if (clickTarget && typeof clickTarget.evaluate === "function") {
    try {
      const frameResult = await clickTarget.evaluate(() => {
        const exact = document.querySelector(
          'input[name="__RequestVerificationToken"]',
        );
        if (exact && exact instanceof HTMLInputElement && exact.value) {
          return { token: `${exact.value}`.trim(), source: "frame-input" };
        }
        for (const inp of document.querySelectorAll("input")) {
          const n = inp.getAttribute("name") || "";
          if (
            n.includes("__RequestVerificationToken") &&
            inp instanceof HTMLInputElement &&
            inp.value
          ) {
            return {
              token: `${inp.value}`.trim(),
              source: "frame-input-name",
            };
          }
        }
        const meta = document.querySelector(
          'meta[name="__RequestVerificationToken"], meta[name="RequestVerificationToken"]',
        );
        const metaVal = meta ? meta.getAttribute("content") : "";
        if (metaVal) {
          return { token: `${metaVal}`.trim(), source: "meta" };
        }
        const html = document.documentElement
          ? document.documentElement.innerHTML
          : "";
        const m1 = html.match(
          /name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i,
        );
        if (m1 && m1[1]) {
          return { token: `${m1[1]}`.trim(), source: "html-regex" };
        }
        const m2 = html.match(
          /value=["']([^"']+)["'][^>]*name=["']__RequestVerificationToken["']/i,
        );
        if (m2 && m2[1]) {
          return { token: `${m2[1]}`.trim(), source: "html-regex" };
        }
        return { token: "", source: "" };
      });
      if (frameResult && frameResult.token) {
        token = frameResult.token;
        source = frameResult.source || "frame-input";
      }
    } catch (frameErr) {
      if (arlingtonErmsSessionClosedMessage(frameErr)) throw frameErr;
    }
  }

  if (!token && networkPage && typeof networkPage.context === "function") {
    try {
      const cookies = await networkPage.context().cookies();
      for (const c of cookies) {
        if (
          (c.name || "").includes("__RequestVerificationToken") &&
          c.value
        ) {
          token = `${c.value}`.trim();
          source = "cookie";
          break;
        }
      }
    } catch (cookieErr) {
      if (arlingtonErmsSessionClosedMessage(cookieErr)) throw cookieErr;
    }
  }

  if (!token && downloadCtx && downloadCtx.ermsVerificationToken) {
    token = `${downloadCtx.ermsVerificationToken}`.trim();
    source = "cached";
  }

  if (token && source && source !== "cached") {
    arlingtonPlanSetCacheErmsVerificationToken(downloadCtx, token, source);
  }
  if (token && source) {
    console.log(
      `[Arlington][PlanReview] verification token source=${source}${docLog}`,
    );
  }

  return token;
}

/**
 * @returns {{ publicUrl: string, storagePath: string, downloadStatus: string, failureReason: string }}
 */
function arlingtonPlanReviewSessionClosedOutcome() {
  return {
    publicUrl: "",
    storagePath: "",
    downloadStatus: "pending_session_closed",
    failureReason: "session_closed_during_download",
  };
}

/**
 * @param {Record<string, unknown>} doc
 * @param {Record<string, unknown>} [downloadCtx]
 */
async function arlingtonPlanReviewMarkDocSessionClosed(doc, downloadCtx) {
  doc.downloadStatus = "pending_session_closed";
  doc.status = "pending";
  doc.skipReason = "session_closed_during_download";
  doc.retryCount = (Number(doc.retryCount) || 0) + 1;
  if (downloadCtx && typeof downloadCtx === "object") {
    downloadCtx.planReviewPartialPendingDownloads = true;
    const saver = downloadCtx.savePlanReviewCheckpoint;
    if (typeof saver === "function") {
      await saver("sessionClosed", { reason: "session_closed_during_download" }).catch(
        () => {},
      );
    }
  }
}

function arlingtonPlanSetPdfIsSuspiciousPlaceholder(buf, docName) {
  const n = buf ? buf.length : 0;
  if (n > 0 && n <= 4884) {
    console.log(
      `[Arlington][PlanReview] Plan Set PDF rejected ${docName} reason=suspicious_small_or_duplicate bytes=${n}`,
    );
    return true;
  }
  return false;
}

/**
 * Poll PollDownloadDocument until PercentComplete reaches 100.
 * @returns {Promise<{ URL?: string; url?: string; PercentComplete?: number } | null>}
 */
async function arlingtonPlanSetPollDownloadUntilComplete(
  networkPage,
  ermsOrigin,
  streamId,
  token,
  downloadCtx = null,
  documentId = "",
) {
  const origin = `${ermsOrigin || ARLINGTON_ERMS_ORIGIN_FALLBACK}`.replace(
    /\/$/,
    "",
  );
  const sid = `${streamId || ""}`.trim();
  const tok = `${token || ""}`.trim();
  if (!sid || !tok || !networkPage?.request) return null;

  arlingtonPlanReviewTouchKeepalive(downloadCtx, documentId || sid);

  const referer = `${origin}/PlanReviewIntegrated/plan/ViewDocuments`;
  const pollUrl = `${origin}/PlanReviewIntegrated/Plan/PollDownloadDocument`;
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    const pollBody = new URLSearchParams();
    pollBody.set("__RequestVerificationToken", tok);
    pollBody.set("streamID", sid);

    /** @type {import('playwright').APIResponse | null} */
    let pollRes = null;
    try {
      pollRes = await arlingtonPlanSetWithTimeout(
        networkPage.request.post(pollUrl, {
          timeout: 30000,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Referer: referer,
          },
          data: pollBody.toString(),
        }),
        35000,
        "plan_set_poll_post",
      );
    } catch (pollErr) {
      if (arlingtonErmsSessionClosedMessage(pollErr)) throw pollErr;
      const errMsg =
        pollErr && pollErr.message ? pollErr.message : String(pollErr);
      console.log(
        `[Arlington][PlanReview] Plan Set poll POST status=0 ct= error=${errMsg}`,
      );
      await networkPage.waitForTimeout(750).catch(() => {});
      continue;
    }

    const status = pollRes.status();
    const ct = `${pollRes.headers()["content-type"] || pollRes.headers()["Content-Type"] || ""}`;
    let bodyText = "";
    try {
      bodyText = `${await arlingtonPlanSetWithTimeout(
        pollRes.text(),
        15000,
        "plan_set_poll_body_read",
      )}`;
    } catch (bodyErr) {
      bodyText = "";
      console.log(
        `[Arlington][PlanReview] Plan Set poll body preview= read_error=${bodyErr && bodyErr.message ? bodyErr.message : bodyErr}`,
      );
    }

    console.log(
      `[Arlington][PlanReview] Plan Set poll POST status=${status} ct=${ct}`,
    );
    console.log(
      `[Arlington][PlanReview] Plan Set poll body preview=${bodyText.slice(0, 300)}`,
    );

    if (!pollRes.ok()) {
      await networkPage.waitForTimeout(750).catch(() => {});
      continue;
    }

    /** @type {{ URL?: string; url?: string; PercentComplete?: number; percentComplete?: number; ErrorMessage?: string }} */
    let pollJson = {};
    try {
      pollJson = JSON.parse(bodyText || "{}");
    } catch (_) {
      await networkPage.waitForTimeout(750).catch(() => {});
      continue;
    }

    const errMsg = `${pollJson.ErrorMessage || ""}`.trim();
    if (errMsg) return null;

    const pct = Number(
      pollJson.PercentComplete ?? pollJson.percentComplete ?? 0,
    );
    const relUrl = `${pollJson.URL || pollJson.url || ""}`.trim();

    if (pct >= 100 && relUrl) {
      console.log(
        `[Arlington][PlanReview] Plan Set poll complete url=${relUrl} percent=${pct}`,
      );
      return pollJson;
    }

    await networkPage.waitForTimeout(750).catch(() => {});
  }

  arlingtonPlanReviewTouchKeepalive(downloadCtx, documentId || sid);
  return null;
}

/**
 * GET DocumentStream exactly as poll URL (no streamId query).
 * @returns {Promise<{ pdf: Buffer | null; streamTimedOut: boolean }>}
 */
async function arlingtonPlanSetFetchDocumentStreamAfterPoll(
  networkPage,
  ermsOrigin,
  pollJson,
  docName,
  streamLogLabel = "Plan Set",
  downloadCtx = null,
  documentId = "",
) {
  const lb = `${streamLogLabel || "Plan Set"}`.trim() || "Plan Set";
  console.log(
    `[Arlington][PlanReview] ${lb} final stream fetch timeoutMs=${ERMS_DOCUMENT_STREAM_TIMEOUT_MS}`,
  );
  /** @returns {{ pdf: Buffer | null; streamTimedOut: boolean }} */
  const fail = (timedOut = false) => ({ pdf: null, streamTimedOut: timedOut });
  const origin = `${ermsOrigin || ARLINGTON_ERMS_ORIGIN_FALLBACK}`.replace(
    /\/$/,
    "",
  );
  if (!networkPage?.request || !pollJson) return fail(false);

  if (!arlingtonPlanReviewCanStartDocumentStream(downloadCtx)) {
    console.log(
      `[Arlington][PlanReview] ${lb} final stream fetch skipped ${docName} reason=insufficient_remaining_budget`,
    );
    return fail(true);
  }

  const referer = `${origin}/PlanReviewIntegrated/plan/ViewDocuments`;
  const relUrl =
    `${pollJson.URL || pollJson.url || "/PlanReviewIntegrated/Plan/DocumentStream"}`.trim();
  let streamUrl;
  try {
    const parsed = new URL(relUrl, `${origin}/`);
    parsed.search = "";
    parsed.hash = "";
    streamUrl = parsed.toString();
  } catch (_) {
    return fail(false);
  }

  /** @type {import('playwright').APIResponse | null} */
  let streamRes = null;
  const streamDeadlineMs =
    ERMS_DOCUMENT_STREAM_TIMEOUT_MS + Math.ceil(ERMS_DOCUMENT_STREAM_TIMEOUT_MS * 0.15) +
    5000;

  arlingtonPlanReviewTouchKeepalive(downloadCtx, documentId);
  try {
    streamRes = await arlingtonPlanSetWithTimeout(
      networkPage.request.get(streamUrl, {
        timeout: ERMS_DOCUMENT_STREAM_TIMEOUT_MS,
        headers: { Referer: referer },
      }),
      streamDeadlineMs,
      "plan_set_final_stream_fetch",
    );
  } catch (fetchErr) {
    if (arlingtonErmsSessionClosedMessage(fetchErr)) throw fetchErr;
    const errMsg =
      fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr);
    const timedOut = /timeout/i.test(errMsg);
    console.log(
      `[Arlington][PlanReview] ${lb} final stream fetch url=${streamUrl} status=0 ct= error=${errMsg}`,
    );
    return fail(timedOut);
  }

  const status = streamRes.status();
  const ct = `${streamRes.headers()["content-type"] || streamRes.headers()["Content-Type"] || ""}`;
  console.log(
    `[Arlington][PlanReview] ${lb} final stream fetch url=${streamUrl} status=${status} ct=${ct}`,
  );

  if (status !== 200 || !streamRes.ok()) return fail(false);
  if (!/pdf|octet-stream/i.test(ct.toLowerCase())) return fail(false);

  /** @type {Buffer} */
  let buf;
  try {
    buf = Buffer.from(
      await arlingtonPlanSetWithTimeout(
        streamRes.body(),
        ERMS_DOCUMENT_STREAM_TIMEOUT_MS,
        "plan_set_final_stream_body_read",
      ),
    );
  } catch (bodyErr) {
    const errMsg =
      bodyErr && bodyErr.message ? bodyErr.message : String(bodyErr);
    const timedOut = /timeout/i.test(errMsg);
    console.log(
      `[Arlington][PlanReview] ${lb} final stream bytes=0 error=${errMsg}`,
    );
    return fail(timedOut);
  }

  console.log(
    `[Arlington][PlanReview] ${lb} final stream bytes=${buf.length}`,
  );

  if (!arlingtonPlanSetBufferLooksLikePdf(buf, ct)) return fail(false);
  if (arlingtonPlanSetPdfIsSuspiciousPlaceholder(buf, docName)) return fail(false);

  arlingtonPlanReviewTouchKeepalive(downloadCtx, documentId);
  return { pdf: buf, streamTimedOut: false };
}

/**
 * Invoke → Poll → DocumentStream (same Playwright cookies/session).
 * @returns {Promise<{ pdf: Buffer | null; streamTimedOut: boolean }>}
 */
async function arlingtonPlanSetFetchPdfViaInvokePollStream(
  networkPage,
  clickTarget,
  ermsOrigin,
  streamId,
  docName,
  streamLogLabel = "Plan Set",
  downloadCtx = null,
  documentId = "",
) {
  const token = await arlingtonPlanSetReadErmsVerificationToken(clickTarget, {
    networkPage,
    downloadCtx,
    documentId,
  });
  if (!token) {
    console.log(
      `[Arlington][PlanReview] ${streamLogLabel} poll skipped ${docName} reason=missing_verification_token`,
    );
    return { pdf: null, streamTimedOut: false };
  }

  const pollJson = await arlingtonPlanSetPollDownloadUntilComplete(
    networkPage,
    ermsOrigin,
    streamId,
    token,
    downloadCtx,
    documentId,
  );
  if (!pollJson) return { pdf: null, streamTimedOut: false };

  return arlingtonPlanSetFetchDocumentStreamAfterPoll(
    networkPage,
    ermsOrigin,
    pollJson,
    docName,
    streamLogLabel,
    downloadCtx,
    documentId,
  );
}

/**
 * Plan Set: POST InvokeDownloadDocument + follow-up file (Playwright may not emit "download").
 * Click is dispatched inside ERMS frame (jQuery delegated handlers); network waits use parent page.
 * @returns {Promise<{ publicUrl?: string; storagePath?: string; downloadStatus?: string; failureReason?: string }>}
 */
async function arlingtonPlanSetDownloadViaInvokeDownloadDocument(
  networkPage,
  clickTarget,
  docIdForClick,
  rowMeta,
  downloadCtx,
  rowKey,
  prSeenRowKeys,
  ermsOriginHint,
  streamLogLabel = "Plan Set",
) {
  const ermsOrigin =
    `${ermsOriginHint || ""}`.trim() || ARLINGTON_ERMS_ORIGIN_FALLBACK;
  const docId = `${docIdForClick || ""}`.trim();
  const docName =
    String(rowMeta.name || "plan_review_doc")
      .split(/[\r\n|]+/)[0]
      .trim() || "plan_review_doc";

  /** @type {string[]} */
  const seen = [];
  const onRequest = (req) => {
    if (
      /InvokeDownloadDocument|PollDownloadDocument|DocumentStream|DownloadDocument|document/i.test(
        req.url(),
      )
    ) {
      seen.push(`[REQ] ${req.method()} ${req.url()}`);
    }
  };
  const onResponse = (res) => {
    if (
      /InvokeDownloadDocument|PollDownloadDocument|DocumentStream|DownloadDocument|document/i.test(
        res.url(),
      )
    ) {
      const ct = res.headers()["content-type"] || "";
      seen.push(`[RES] ${res.status()} ${res.url()} ct=${ct}`);
    }
  };

  networkPage.on("request", onRequest);
  networkPage.on("response", onResponse);

  const invokeMatches = (res) =>
    /\/PlanReviewIntegrated\/Plan\/InvokeDownloadDocument/i.test(res.url()) &&
    res.request().method() === "POST";

  arlingtonPlanReviewTouchKeepalive(downloadCtx, docId);

  /** @type {import('playwright').Response | null} */
  let invokeResp = null;
  try {
    const invokePromise = networkPage
      .waitForResponse(invokeMatches, { timeout: 20000 })
      .catch(() => null);

    await clickTarget.evaluate((innerDocId) => {
      const id = String(innerDocId || "");
      /** @type {Element | null} */
      let el = null;
      if (/^\d+$/.test(id)) {
        el =
          document.querySelector(
            `input.img-button.docaction[name="${id}"][title="Download"]`,
          ) ||
          document.querySelector(
            `input.img-button.docaction[name="${id}"][alt="Download"]`,
          ) ||
          document.querySelector(`input.docaction[name="${id}"]`);
      }
      if (!el) {
        const cand = document.querySelectorAll(
          'input.img-button.docaction, input.docaction[name]',
        );
        for (const c of cand) {
          if (
            c instanceof HTMLElement &&
            (c.getAttribute("name") || "") === id
          ) {
            el = c;
            break;
          }
        }
      }

      if (!el) throw new Error(`download input not found for ${id}`);

      el.scrollIntoView({ block: "center", inline: "center" });

      for (const type of ["mousedown", "mouseup", "click"]) {
        el.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      }
    }, docId);

    invokeResp = await invokePromise;
  } catch (e) {
    console.log(
      `[Arlington][PlanReview] Plan Set network seen=${seen.length ? seen.join(" | ") : "(none)"}`,
    );
    networkPage.off("request", onRequest);
    networkPage.off("response", onResponse);
    if (arlingtonErmsSessionClosedMessage(e)) {
      return arlingtonPlanReviewSessionClosedOutcome();
    }
    return {
      publicUrl: "",
      storagePath: "",
      downloadStatus: "invoke_click_failed",
      failureReason: (e && e.message) || String(e),
    };
  }

  console.log(
    `[Arlington][PlanReview] Plan Set network seen=${seen.length ? seen.join(" | ") : "(none)"}`,
  );
  networkPage.off("request", onRequest);
  networkPage.off("response", onResponse);

  arlingtonPlanReviewTouchKeepalive(downloadCtx, docId);

  if (!invokeResp) {
    return {
      publicUrl: "",
      storagePath: "",
      downloadStatus: "invoke_timeout",
      failureReason: "no_invoke_post_after_frame_click",
    };
  }

  return arlingtonPlanSetProcessInvokeResponseToUpload(
    networkPage,
    clickTarget,
    invokeResp,
    rowMeta,
    downloadCtx,
    rowKey,
    prSeenRowKeys,
    ermsOriginHint,
    docName,
    streamLogLabel,
    docId,
  );
}

async function persistArlingtonPlanSetBufferPdf(
  fileBuf,
  rowMeta,
  downloadCtx,
  rowKey,
  downloadedRowKeys,
  uploadTabLabel = "Plan Set",
  documentId = "",
) {
  const docName =
    String(rowMeta.name || "plan_review_doc")
      .split(/[\r\n|]+/)[0]
      .trim() || "plan_review_doc";
  const byteCount = fileBuf ? fileBuf.length : 0;
  const tabLog = `${uploadTabLabel || "Plan Set"}`.trim() || "Plan Set";

  arlingtonPlanReviewTouchKeepalive(downloadCtx, documentId);

  console.log(
    `[Arlington][PlanReview] ${tabLog} upload start ${docName} bytes=${byteCount}`,
  );

  if (!fileBuf || !byteCount) {
    console.log(
      `[Arlington][PlanReview] ${tabLog} upload failed ${docName} reason=empty_buffer`,
    );
    return {
      filename: "",
      size: 0,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "empty_buffer",
      failureReason: "empty_buffer",
    };
  }

  if (isDownloadBufferLikelyHtmlError(fileBuf)) {
    console.log(
      `[Arlington][PlanReview] ${tabLog} upload failed ${docName} reason=failed_html_stub`,
    );
    return {
      filename: "",
      size: byteCount,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "failed_html_stub",
      failureReason: "failed_html_stub",
    };
  }

  if (
    typeof byteCount === "number" &&
    byteCount > getSupabaseStorageObjectMaxBytes()
  ) {
    console.log(
      `[Arlington][PlanReview] oversized file skipped upload tab=${tabLog} name=${docName} bytes=${byteCount}`,
    );
    return {
      filename: "",
      size: byteCount,
      fileSizeBytes: byteCount,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "oversized_for_supabase",
      failureReason: "supabase_object_size_limit",
      skipReason: "supabase_object_size_limit",
    };
  }

  const {
    DOWNLOADS_DIR,
    supabaseProjectId,
    permitNumber: permitNumberCtx,
    uploadFn: uploadFnDl,
    sanitizeFn: sanitizeFnDl,
    downloadedHashes,
  } = downloadCtx || {};

  if (!DOWNLOADS_DIR) {
    console.log(
      `[Arlington][PlanReview] ${tabLog} upload failed ${docName} reason=missing_downloads_dir`,
    );
    return {
      filename: "",
      size: byteCount,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "upload_failed",
      failureReason: "missing_downloads_dir",
    };
  }

  if (!supabaseProjectId) {
    console.log(
      `[Arlington][PlanReview] ${tabLog} upload failed ${docName} reason=missing_projectId`,
    );
    return {
      filename: "",
      size: byteCount,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "upload_failed",
      failureReason: "missing_projectId",
    };
  }

  if (typeof uploadFnDl !== "function") {
    console.log(
      `[Arlington][PlanReview] ${tabLog} upload failed ${docName} reason=missing_supabase_client`,
    );
    return {
      filename: "",
      size: byteCount,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "upload_failed",
      failureReason: "missing_supabase_client",
    };
  }

  const hashMap =
    downloadedHashes instanceof Map ? downloadedHashes : new Map();

  let filenameGuess = docName.slice(0, 180);
  if (typeof sanitizeFnDl === "function") {
    try {
      const sanitized = `${sanitizeFnDl(filenameGuess) || ""}`.trim();
      if (sanitized) filenameGuess = sanitized.slice(0, 180);
    } catch (_) {
      /**/
    }
  }

  let safeDownloadName = `${filenameGuess.replace(/[\\/:*?"<>|]/g, "_")}.pdf`.replace(
    /[\\/:*?"<>|]/g,
    "_",
  );
  const contentHash8 = crypto
    .createHash("md5")
    .update(fileBuf)
    .digest("hex")
    .slice(0, 8);
  const baseName = safeDownloadName.replace(/\.pdf$/i, "");
  const versionedFileName = `${baseName}-${contentHash8}.pdf`;
  const permitSlug = `${permitNumberCtx || "unknown"}`
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 80);
  const storagePath = `drawings/${supabaseProjectId}/plan-review/${permitSlug}/${versionedFileName}`;

  const filePath = path.join(DOWNLOADS_DIR, versionedFileName);
  try {
    fs.writeFileSync(filePath, fileBuf);
  } catch (writeErr) {
    console.log(
      `[Arlington][PlanReview] ${tabLog} upload failed ${docName} reason=write_failed`,
    );
    return {
      filename: safeDownloadName,
      size: byteCount,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "write_failed",
      failureReason:
        writeErr && writeErr.message ? writeErr.message : "write_failed",
    };
  }

  let publicUrl = "";
  const planSetUploadOpts = { upsert: true, cacheControl: "0" };
  try {
    publicUrl = await uploadFnDl(filePath, storagePath, planSetUploadOpts);
  } catch (uploadErr) {
    const em = `${
      uploadErr && uploadErr.message ? uploadErr.message : uploadErr
    }`;
    if (
      /exceeded the maximum allowed size|maximum allowed size|too large|object too large|\b413\b|payload too large/i.test(
        em,
      )
    ) {
      console.log(
        `[Arlington][PlanReview] oversized file skipped upload tab=${tabLog} name=${docName} bytes=${byteCount}`,
      );
      try {
        fs.unlinkSync(filePath);
      } catch (_) {
        /**/
      }
      return {
        filename: versionedFileName,
        size: byteCount,
        fileSizeBytes: byteCount,
        publicUrl: "",
        storagePath: "",
        downloadStatus: "oversized_for_supabase",
        failureReason: "supabase_object_size_limit",
        skipReason: "supabase_object_size_limit",
      };
    }

    console.log(
      `[Arlington][PlanReview] ${tabLog} upload failed ${docName} reason=upload_error error=${em}`,
    );
    try {
      fs.unlinkSync(filePath);
    } catch (_) {
      /**/
    }
    return {
      filename: versionedFileName,
      size: byteCount,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "upload_failed",
      failureReason: uploadErr && uploadErr.message ? uploadErr.message : "upload_error",
    };
  }

  if (!publicUrl) {
    let failReason = "upload_error";
    if (byteCount < 1024) failReason = "file_too_small_for_upload";
    console.log(
      `[Arlington][PlanReview] ${tabLog} upload failed ${docName} reason=${failReason}`,
    );
    return {
      filename: versionedFileName,
      size: byteCount,
      publicUrl: "",
      storagePath: "",
      downloadStatus: "upload_failed",
      failureReason: failReason,
    };
  }

  const cacheBust = Date.now();
  const publicUrlWithVersion = `${publicUrl}?v=${cacheBust}`;
  downloadedRowKeys.add(rowKey);
  hashMap.set(
    crypto.createHash("md5").update(fileBuf).digest("hex"),
    { fileName: versionedFileName, viewUrl: publicUrlWithVersion },
  );

  console.log(
    `[Arlington][PlanReview] ${tabLog} upload overwrite=true cacheBust=${cacheBust}`,
  );
  console.log(
    `[Arlington][PlanReview] ${tabLog} upload OK ${docName} storagePath=${storagePath}`,
  );

  arlingtonPlanReviewTouchKeepalive(downloadCtx, documentId);

  return {
    filename: versionedFileName,
    size: byteCount,
    publicUrl: publicUrlWithVersion,
    storagePath,
    downloadStatus: "uploaded",
  };
}

async function tryArlingtonIntegratedRowDownload(
  page,
  rowHandle,
  rowMeta,
  sourceTabCamel,
  sourceSectionCamel,
  attachmentDedupeKeys,
  downloadedRowKeys,
  downloadedHashes,
  downloadCtx,
) {
  if (!downloadCtx) return null;
  const {
    DOWNLOADS_DIR,
    supabaseProjectId,
    uploadFn: uploadFnDl,
    sanitizeFn: sanitizeFnDl,
  } = downloadCtx;
  const rowKey = arlingtonIntegratedRowDedupeKey(
    rowMeta.name,
    rowMeta.documentDate || "",
    rowMeta.size || "",
    rowMeta.revision || "",
  );
    if (attachmentDedupeKeys.has(rowKey) || downloadedRowKeys.has(rowKey)) {
      return null;
    }
  const candidates = await rowHandle.$$(
    'a, button, input[type="button"], input[type="submit"], img[onclick]',
  ).catch(() => []);
  /** @type {import('playwright').ElementHandle} */
  let best = null;
  for (const c of candidates) {
    try {
      if (!(await c.isVisible().catch(() => false))) continue;
      const href = (
        await c.evaluate((node) =>
          node.getAttribute("href") || node.getAttribute("onclick") || "",
        ).catch(() => "")
      ).slice(0, 400);
      const title = (
        await c.evaluate((node) =>
          node.getAttribute("title") ||
          node.getAttribute("alt") ||
          node.tagName ||
          "",
        ).catch(() => "")
      ).slice(0, 200);
      const text = (
        ((await c.textContent().catch(() => "")) || "").trim()).slice(
        0,
        140,
      );
      const hay = `${href} ${title} ${text}`;
      const looksAction = ARLINGTON_PR_ACTION_HINT.test(hay) || /\.pdf\b/i.test(hay);
      if (!looksAction) continue;
      best = c;
      break;
    } catch (_) {}
  }
  if (!best && candidates.length) {
    /** last resort click last clickable in Actions-ish column */
    for (let j = candidates.length - 1; j >= 0; j--) {
      const cand = candidates[j];
      try {
        if (await cand.isVisible().catch(() => false)) {
          best = cand;
          break;
        }
      } catch (_) {}
    }
  }
  if (!best) return null;

  /** @type {import('playwright').Download|null} */
  let download = null;
  try {
    const downloadPromise = page
      .waitForEvent("download", { timeout: 15000 })
      .catch(() => null);
    await best.click({ force: true }).catch(() => {});
    download = await downloadPromise;
  } catch (_) {
    download = null;
  }

  let downloadStatus = "no_capture";
  let publicUrl = "";
  let storagePath = "";

  let filenameGuess = (
    String(rowMeta.name || "plan_review_doc")
      .split(/[\r\n|]+/)[0]
      .trim() || `plan_review_${Date.now()}`
  ).slice(0, 180);

  let safeDownloadName =
    `${filenameGuess}`.replace(/[\\/:*?"<>|]/g, "_");

  let tryExt = /\.[a-z0-9]{2,6}$/i.test(safeDownloadName) ? "" : ".pdf";

  if (download) {
    safeDownloadName = (
      download.suggestedFilename() || safeDownloadName + tryExt
    ).replace(/[\\/:*?"<>|]/g, "_");

    tryExt =
      /\.[a-z0-9]{2,12}$/.test(safeDownloadName.toLowerCase()) ? "" : ".pdf";
    safeDownloadName = /\.[a-z0-9]{2,12}$/.test(safeDownloadName.toLowerCase())
      ? safeDownloadName
      : `${safeDownloadName}${tryExt}`;

    const filePath = path.join(DOWNLOADS_DIR, safeDownloadName);
    await download.saveAs(filePath).catch(() => {});
    let fileBuf = null;
    try {
      fileBuf = fs.readFileSync(filePath);
    } catch (_) {
      fileBuf = null;
    }
    if (!fileBuf || isDownloadBufferLikelyHtmlError(fileBuf)) {
      downloadStatus = "failed_html_stub";
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    } else {
      publicUrl = await tryUploadAccelaFile(
        filePath,
        safeDownloadName,
        supabaseProjectId,
        uploadFnDl,
        sanitizeFnDl,
        downloadedHashes,
      ).catch(() => "");
      storagePath =
        publicUrl && supabaseProjectId
          ? `drawings/${supabaseProjectId}/${safeDownloadName}`
          : "";
      downloadStatus = publicUrl ? "uploaded" : "local_only";
      downloadedRowKeys.add(rowKey);
    }
  }
  return {
    name: rowMeta.name,
    filename: safeDownloadName.replace(/_/g, " ") || safeDownloadName,
    documentDate: rowMeta.documentDate || "",
    discipline: rowMeta.discipline || "",
    sheetType: rowMeta.sheetType || "",
    description: rowMeta.description || "",
    revision: rowMeta.revision || "",
    uploadStatus: rowMeta.uploadStatus || "",
    size: rowMeta.size || "",
    status: downloadStatus,
    sourceTab: sourceTabCamel,
    sourceSection: sourceSectionCamel,
    storagePath,
    publicUrl,
    downloadUrl: publicUrl,
    downloadStatus,
  };
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} domTarget
 * @returns {Promise<import('playwright').ElementHandle | null>}
 */
async function findArlingtonPlanSetRowHandleByDocumentId(domTarget, documentId) {
  const id = `${documentId || ""}`.trim();
  if (!id || !/^\d+$/.test(id)) return null;
  const jsHandle = await domTarget
    .evaluateHandle((docId) => {
      const div = document.querySelector("#divDocuments");
      if (!div) return null;
      const input =
        div.querySelector(`input.img-button.docaction[name="${docId}"]`) ||
        div.querySelector(`input.docaction[name="${docId}"]`);
      if (!input) return null;
      return input.closest("tr");
    }, id)
    .catch(() => null);
  if (!jsHandle) return null;
  const el = jsHandle.asElement();
  if (!el) {
    await jsHandle.dispose().catch(() => {});
    return null;
  }
  return el;
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} domTarget
 * @returns {Promise<import('playwright').ElementHandle | null>}
 */
async function findArlingtonPlanSetRowHandleByName(domTarget, docName) {
  const needle = `${docName || ""}`.trim();
  if (!needle) return null;
  const jsHandle = await domTarget
    .evaluateHandle((nameFull) => {
      const div = document.querySelector("#divDocuments");
      if (!div) return null;
      const parts = nameFull.split(/[\s|]+/).filter((p) => p.length >= 2);
      const needles = [nameFull, ...parts].filter(
        (v, i, a) => a.indexOf(v) === i,
      );
      const rows = [...div.querySelectorAll("tr")].filter((tr) =>
        tr.querySelector("td"),
      );
      for (const tr of rows) {
        const t = (tr.innerText || "").replace(/\s+/g, " ");
        const low = t.toLowerCase();
        if (
          /supporting documents|comment response letters|name\s+discipline\s+sheet|document type|upload status/i.test(
            low,
          )
        )
          continue;
        for (const n of needles) {
          if (n.length >= 2 && t.includes(n)) return tr;
        }
      }
      return null;
    }, needle)
    .catch(() => null);
  if (!jsHandle) return null;
  const el = jsHandle.asElement();
  if (!el) {
    await jsHandle.dispose().catch(() => {});
    return null;
  }
  return el;
}

/**
 * Visible ERMS tabpanel only — not scoped to #divDocuments.
 * @param {import('playwright').Page | import('playwright').Frame} domTarget
 */
async function findArlingtonActivePanelRowHandleByName(domTarget, docName) {
  const needle = `${docName || ""}`.trim();
  if (!needle) return null;
  const jsHandle = await domTarget
    .evaluateHandle((nameFull) => {
      const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
      const panels = [
        ...document.querySelectorAll(
          '.ui-tabs-panel, [role="tabpanel"], .tab-content',
        ),
      ];
      let root = null;
      for (const p of panels) {
        try {
          const st = getComputedStyle(p);
          const r = p.getBoundingClientRect();
          if (
            st.display !== "none" &&
            st.visibility !== "hidden" &&
            r.height > 10 &&
            r.width > 20
          ) {
            root = p;
            break;
          }
        } catch (_) {
          /**/
        }
      }
      if (!root) root = document.body;
      const parts = nameFull.split(/[\s|]+/).filter((p) => p.length >= 2);
      const needles = [nameFull, ...parts].filter(
        (v, i, a) => a.indexOf(v) === i,
      );
      const rows = [...root.querySelectorAll("tr")].filter((tr) =>
        tr.querySelector("td"),
      );
      for (const tr of rows) {
        const t = norm(tr.innerText);
        if (
          /supporting documents|comment response letters|name\s+discipline\s+sheet|document type|upload status/i.test(
            t,
          )
        )
          continue;
        for (const n of needles) {
          if (n.length >= 2 && t.includes(n)) return tr;
        }
      }
      return null;
    }, needle)
    .catch(() => null);
  if (!jsHandle) return null;
  const el = jsHandle.asElement();
  if (!el) {
    await jsHandle.dispose().catch(() => {});
    return null;
  }
  return el;
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} domTarget
 * @returns {Promise<import('playwright').ElementHandle | null>}
 */
async function findArlingtonActivePanelRowHandleByDocumentId(
  domTarget,
  documentId,
) {
  const id = `${documentId || ""}`.trim();
  if (!id || !/^\d+$/.test(id)) return null;
  const jsHandle = await domTarget
    .evaluateHandle((docId) => {
      const panels = [
        ...document.querySelectorAll(
          '.ui-tabs-panel, [role="tabpanel"], .tab-content',
        ),
      ];
      let root = null;
      for (const p of panels) {
        try {
          const st = getComputedStyle(p);
          const r = p.getBoundingClientRect();
          if (
            st.display !== "none" &&
            st.visibility !== "hidden" &&
            r.height > 10 &&
            r.width > 20
          ) {
            root = p;
            break;
          }
        } catch (_) {
          /**/
        }
      }
      if (!root) root = document.body;
      const input =
        root.querySelector(`input.img-button.docaction[name="${docId}"]`) ||
        root.querySelector(`input.docaction[name="${docId}"]`);
      if (!input) return null;
      return input.closest("tr") || input.closest("div") || input;
    }, id)
    .catch(() => null);
  if (!jsHandle) return null;
  const el = jsHandle.asElement();
  if (!el) {
    await jsHandle.dispose().catch(() => {});
    return null;
  }
  return el;
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {{ continueRun?: boolean; logPrefix?: string }} [opts]
 */
function arlingtonPlanReviewInitDownloadManager(dc, opts = {}) {
  if (!dc || typeof dc !== "object") return;
  const continueRun = opts.continueRun === true;
  const logPrefix = `${opts.logPrefix || "[Arlington][PlanReview]"}`.replace(
    /\]$/,
    "",
  );
  dc.planReviewDownloadsAttemptedThisRun = 0;
  dc.planReviewDownloadsSucceededThisRun = 0;
  dc.planReviewPlanSetDownloadsSucceededThisRun = 0;
  dc.planReviewSecondaryDownloadsSucceededThisRun = 0;
  dc.planReviewStreamTimeoutsThisRun = 0;
  dc.planReviewHardFailuresThisRun = 0;
  dc.planReviewSkippedAlreadyDownloadedThisRun = 0;
  dc.planReviewStoppedReason = "";
  dc.planReviewAttemptedDocIdsThisRun =
    dc.planReviewAttemptedDocIdsThisRun instanceof Set
      ? dc.planReviewAttemptedDocIdsThisRun
      : new Set();
  dc.planReviewLimits = continueRun
    ? {
        maxTotal: ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_TOTAL_DOWNLOADS_PER_RUN,
        maxPlanSet: ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_PLAN_SET_DOWNLOADS_PER_RUN,
        maxSecondary:
          ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_SECONDARY_DOWNLOADS_PER_RUN,
        maxStreamTimeouts:
          ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_STREAM_TIMEOUTS_PER_RUN,
        maxHardFailures:
          ARLINGTON_PLAN_REVIEW_CONTINUE_MAX_HARD_DOWNLOAD_FAILURES_PER_RUN,
        minRemainingBudgetMs:
          ARLINGTON_PLAN_REVIEW_CONTINUE_MIN_REMAINING_BUDGET_MS,
      }
    : {
        maxTotal: ARLINGTON_PLAN_REVIEW_MAX_TOTAL_DOWNLOADS_PER_RUN,
        maxPlanSet: ARLINGTON_PLAN_REVIEW_MAX_PLAN_SET_DOWNLOADS_PER_RUN,
        maxSecondary: ARLINGTON_PLAN_REVIEW_MAX_SECONDARY_DOWNLOADS_PER_RUN,
        maxStreamTimeouts: ARLINGTON_PLAN_REVIEW_MAX_STREAM_TIMEOUTS_PER_RUN,
        maxHardFailures: ARLINGTON_PLAN_REVIEW_MAX_HARD_DOWNLOAD_FAILURES_PER_RUN,
        minRemainingBudgetMs: ARLINGTON_PLAN_REVIEW_MIN_REMAINING_BUDGET_MS,
      };
  const lim = dc.planReviewLimits;
  console.log(
    `${logPrefix}] batch limits total=${lim.maxTotal} planSet=${lim.maxPlanSet} secondary=${lim.maxSecondary} streamTimeouts=${lim.maxStreamTimeouts}`,
  );
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @returns {number}
 */
/**
 * Selective Plan Review scrape (approved/review only) reuses a fresh wall clock for downloads.
 * The global Accela scrape deadline is often already exhausted after metadata extract.
 * @param {Record<string, unknown> | null | undefined} sharedGridCtx
 * @param {Record<string, unknown> | null | undefined} downloadCtx
 * @param {string} scopeLabel
 */
function arlingtonPlanReviewRearmSelectiveDownloadBudget(
  sharedGridCtx,
  downloadCtx,
  scopeLabel,
) {
  if (!sharedGridCtx || typeof sharedGridCtx !== "object") return;
  const wallMs = ARLINGTON_PLAN_REVIEW_CONTINUE_WALL_MS;
  const deadline = Date.now() + wallMs;
  sharedGridCtx.scrapeDeadlineMs = deadline;
  sharedGridCtx.planReviewDownloadsAbortedDeadline = false;
  sharedGridCtx.planReviewStoppedReason = "";
  if (downloadCtx && typeof downloadCtx === "object") {
    downloadCtx.scrapeDeadlineMs = deadline;
  }
  console.log(
    `[Arlington][PlanReview] selective scope=${scopeLabel} rearmed download budget wallMs=${wallMs}`,
  );
}

function arlingtonPlanReviewRemainingBudgetMs(dc) {
  if (!dc || typeof dc !== "object") return 0;
  const deadline = Number(dc.scrapeDeadlineMs) || 0;
  const minMs =
    dc.planReviewLimits &&
    typeof dc.planReviewLimits === "object" &&
    Number(dc.planReviewLimits.minRemainingBudgetMs) > 0
      ? Number(dc.planReviewLimits.minRemainingBudgetMs)
      : ARLINGTON_PLAN_REVIEW_MIN_REMAINING_BUDGET_MS;
  if (!(deadline > 0)) return minMs;
  return Math.max(0, deadline - Date.now());
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @returns {boolean}
 */
function arlingtonPlanReviewCanStartDocumentStream(dc) {
  const remaining = arlingtonPlanReviewRemainingBudgetMs(dc);
  const minMs =
    dc &&
    dc.planReviewLimits &&
    typeof dc.planReviewLimits === "object" &&
    Number(dc.planReviewLimits.minRemainingBudgetMs) > 0
      ? Number(dc.planReviewLimits.minRemainingBudgetMs)
      : ARLINGTON_PLAN_REVIEW_MIN_REMAINING_BUDGET_MS;
  return remaining >= minMs;
}

/**
 * @param {"planSet"|"reviewResultsAndMarkups"|"approvedDocuments"|"secondary"} source
 * @returns {boolean}
 */
function arlingtonPlanReviewSourceIsPlanSet(source) {
  return source === "planSet";
}

/**
 * @param {"planSet"|"reviewResultsAndMarkups"|"approvedDocuments"|"secondary"} source
 * @returns {boolean}
 */
function arlingtonPlanReviewSourceIsSecondary(source) {
  return (
    source === "reviewResultsAndMarkups" ||
    source === "approvedDocuments" ||
    source === "secondary"
  );
}

/**
 * @param {Record<string, unknown>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} dc
 */
function arlingtonPlanReviewCountQueueTotals(integratedTabs, dc) {
  const ps =
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  const rr = integratedTabs?.reviewResultsAndMarkups?.documents;
  const ad = integratedTabs?.approvedDocuments?.documents;
  const planSetTotal = Array.isArray(ps) ? ps.length : 0;
  const reviewResultsTotal = Array.isArray(rr) ? rr.length : 0;
  const approvedTotal = Array.isArray(ad) ? ad.length : 0;
  let alreadyDownloaded = 0;
  let pending = 0;
  /** @param {unknown[]} docs */
  const walk = (docs) => {
    if (!Array.isArray(docs)) return;
    for (const doc of docs) {
      if (arlingtonErmsSinkDocLooksUploadComplete(doc)) alreadyDownloaded++;
      else pending++;
    }
  };
  walk(Array.isArray(ps) ? ps : []);
  walk(Array.isArray(rr) ? rr : []);
  walk(Array.isArray(ad) ? ad : []);
  if (dc && typeof dc === "object") {
    dc.planReviewQueueTotals = {
      planSetTotal,
      reviewResultsTotal,
      approvedTotal,
      alreadyDownloaded,
      pendingTotal: pending,
    };
  }
  return { planSetTotal, reviewResultsTotal, approvedTotal, alreadyDownloaded, pending };
}

/**
 * @param {Record<string, unknown>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} dc
 */
function arlingtonPlanReviewLogDownloadQueueStart(
  integratedTabs,
  dc,
  logPrefix = "[Arlington][PlanReview]",
) {
  const t = arlingtonPlanReviewCountQueueTotals(integratedTabs, dc);
  console.log(
    `${logPrefix} queue totals planSet=${t.planSetTotal} reviewResults=${t.reviewResultsTotal} approved=${t.approvedTotal} alreadyDownloaded=${t.alreadyDownloaded} pending=${t.pending}`,
  );
}

/**
 * @param {Record<string, unknown>} integratedTabs
 * @returns {Record<string, number>}
 */
function arlingtonPlanReviewPendingByReason(integratedTabs, scopeRaw) {
  /** @type {Record<string, number>} */
  const by = {};
  const buckets = scopeRaw
    ? arlingtonPlanReviewScopedDocBucketLists(integratedTabs, scopeRaw)
    : [
        integratedTabs?.plansAndDocuments?.sections?.planSetDocuments
          ?.documents,
        integratedTabs?.reviewResultsAndMarkups?.documents,
        integratedTabs?.approvedDocuments?.documents,
      ].filter((x) => Array.isArray(x) && x.length);
  for (const docs of buckets) {
    if (!Array.isArray(docs)) continue;
    for (const doc of docs) {
      if (!arlingtonPlanReviewDocNeedsDownloadAttempt(doc)) continue;
      const d =
        doc && typeof doc === "object"
          ? /** @type {Record<string, unknown>} */ (doc)
          : null;
      if (!d) continue;
      const key =
        `${d.downloadStatus || d.skipReason || "pending_not_attempted"}`.trim() ||
        "pending_not_attempted";
      by[key] = (by[key] || 0) + 1;
    }
  }
  return by;
}

/**
 * @param {Record<string, unknown>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} dc
 * @returns {string}
 */
function arlingtonPlanReviewDocHasTabOrTokenPending(doc) {
  if (!doc || typeof doc !== "object") return false;
  const ds = `${/** @type {Record<string, unknown>} */ (doc).downloadStatus || ""}`.trim();
  return ds === "pending_tab_not_resolved" || ds === "pending_token_missing";
}

function arlingtonPlanReviewNextRecommendedScope(integratedTabs, dc) {
  const rr = integratedTabs?.reviewResultsAndMarkups?.documents;
  const ad = integratedTabs?.approvedDocuments?.documents;
  const ps =
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  const rrList = Array.isArray(rr) ? rr : [];
  const adList = Array.isArray(ad) ? ad : [];
  const psList = Array.isArray(ps) ? ps : [];
  const rrTabToken = rrList.filter(
    (d) =>
      !arlingtonErmsSinkDocLooksUploadComplete(d) &&
      arlingtonPlanReviewDocHasTabOrTokenPending(d),
  ).length;
  const adTabToken = adList.filter(
    (d) =>
      !arlingtonErmsSinkDocLooksUploadComplete(d) &&
      arlingtonPlanReviewDocHasTabOrTokenPending(d),
  ).length;
  const rrPending = rrList.filter(
    (d) => !arlingtonErmsSinkDocLooksUploadComplete(d),
  ).length;
  const adPending = adList.filter(
    (d) => !arlingtonErmsSinkDocLooksUploadComplete(d),
  ).length;
  const psPending = psList.filter(
    (d) => !arlingtonErmsSinkDocLooksUploadComplete(d),
  ).length;
  if (rrTabToken > 0 || adTabToken > 0) return "secondary";
  if (rrPending > 0) return "reviewResults";
  if (adPending > 0) return "approvedDocuments";
  if (psPending > 0) return "planSet";
  if (
    dc &&
    (dc.planReviewPartialPendingDownloads === true ||
      dc.planReviewDownloadsAbortedDeadline === true)
  ) {
    return "allPending";
  }
  return "complete";
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {string} reason
 */
function arlingtonPlanReviewMarkCheckpointSaved(dc) {
  if (!dc || typeof dc !== "object") return;
  dc.planReviewCheckpointSaved = true;
  const session = dc._arlingtonSession;
  if (session && typeof session === "object") {
    /** @type {Record<string, unknown>} */ (session).arlingtonPlanReviewCheckpointSaved =
      true;
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]
 * @returns {Promise<void>}
 */
async function arlingtonPlanReviewStopDownloads(dc, reason, extra = {}) {
  if (!dc || typeof dc !== "object") return;
  if (`${dc.planReviewStoppedReason || ""}`.trim()) return;
  dc.planReviewStoppedReason = reason;
  dc.planReviewDownloadsAbortedDeadline = true;
  dc.planReviewPartialPendingDownloads = true;
  const integ = dc.planReviewIntegratedTabs;
  const pending =
    integ && typeof integ === "object"
      ? arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(integ)
      : Number(extra.pending) || 0;
  const downloadedThisRun = Number(dc.planReviewDownloadsSucceededThisRun) || 0;
  console.log(
    `[Arlington][PlanReview] stopping downloads reason=${reason} downloadedThisRun=${downloadedThisRun} pending=${pending}`,
  );
  const saver = dc.savePlanReviewCheckpoint;
  if (typeof saver === "function") {
    await saver(`stop_${reason}`, {
      pending,
      downloaded: downloadedThisRun,
      ...extra,
    }).catch(() => {});
    arlingtonPlanReviewMarkCheckpointSaved(dc);
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {"planSet"|"reviewResultsAndMarkups"|"approvedDocuments"|"secondary"} source
 * @returns {Promise<{ stop: boolean; reason: string }>}
 */
async function arlingtonPlanReviewShouldStopBeforeDoc(dc, source) {
  if (!dc || typeof dc !== "object") return { stop: false, reason: "" };
  if (dc.planReviewDownloadsAbortedDeadline === true) {
    return {
      stop: true,
      reason: `${dc.planReviewStoppedReason || "near_global_deadline"}`.trim(),
    };
  }
  const lim =
    dc.planReviewLimits && typeof dc.planReviewLimits === "object"
      ? dc.planReviewLimits
      : {};
  const maxTotal = Number(lim.maxTotal) || ARLINGTON_PLAN_REVIEW_MAX_TOTAL_DOWNLOADS_PER_RUN;
  const maxPlanSet =
    Number(lim.maxPlanSet) || ARLINGTON_PLAN_REVIEW_MAX_PLAN_SET_DOWNLOADS_PER_RUN;
  const maxSecondary =
    Number(lim.maxSecondary) || ARLINGTON_PLAN_REVIEW_MAX_SECONDARY_DOWNLOADS_PER_RUN;
  const maxStreamT =
    Number(lim.maxStreamTimeouts) || ARLINGTON_PLAN_REVIEW_MAX_STREAM_TIMEOUTS_PER_RUN;
  const maxHardF =
    Number(lim.maxHardFailures) || ARLINGTON_PLAN_REVIEW_MAX_HARD_DOWNLOAD_FAILURES_PER_RUN;

  const succeeded = Number(dc.planReviewDownloadsSucceededThisRun) || 0;
  if (succeeded >= maxTotal) {
    await arlingtonPlanReviewStopDownloads(dc, "batch_limit_reached");
    return { stop: true, reason: "batch_limit_reached" };
  }
  if (arlingtonPlanReviewSourceIsPlanSet(source)) {
    const psOk =
      Number(dc.planReviewPlanSetDownloadsSucceededThisRun) || 0;
    if (psOk >= maxPlanSet) {
      await arlingtonPlanReviewStopDownloads(dc, "plan_set_batch_limit_reached");
      return { stop: true, reason: "plan_set_batch_limit_reached" };
    }
  }
  if (arlingtonPlanReviewSourceIsSecondary(source)) {
    const secOk =
      Number(dc.planReviewSecondaryDownloadsSucceededThisRun) || 0;
    if (secOk >= maxSecondary) {
      await arlingtonPlanReviewStopDownloads(
        dc,
        "secondary_batch_limit_reached",
      );
      return { stop: true, reason: "secondary_batch_limit_reached" };
    }
  }
  const streamT = Number(dc.planReviewStreamTimeoutsThisRun) || 0;
  if (streamT >= maxStreamT) {
    await arlingtonPlanReviewStopDownloads(dc, "stream_timeout_limit_reached");
    return { stop: true, reason: "stream_timeout_limit_reached" };
  }
  const hardF = Number(dc.planReviewHardFailuresThisRun) || 0;
  if (hardF >= maxHardF) {
    await arlingtonPlanReviewStopDownloads(dc, "hard_failure_limit_reached");
    return { stop: true, reason: "hard_failure_limit_reached" };
  }
  const remaining = arlingtonPlanReviewRemainingBudgetMs(dc);
  if (remaining < ARLINGTON_PLAN_REVIEW_MIN_REMAINING_BUDGET_MS) {
    await arlingtonPlanReviewPauseDownloadsIfNearGlobalDeadline(dc);
    return { stop: true, reason: "near_global_deadline" };
  }
  if (!arlingtonPlanReviewCanStartDocumentStream(dc)) {
    await arlingtonPlanReviewPauseDownloadsIfNearGlobalDeadline(dc);
    return { stop: true, reason: "near_global_deadline" };
  }
  return { stop: false, reason: "" };
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {string} documentId
 */
function arlingtonPlanReviewMarkDocAttemptedThisRun(dc, documentId) {
  if (!dc || typeof dc !== "object") return;
  const id = `${documentId || ""}`.trim();
  if (!id) return;
  let set = dc.planReviewAttemptedDocIdsThisRun;
  if (!(set instanceof Set)) {
    set = new Set();
    dc.planReviewAttemptedDocIdsThisRun = set;
  }
  set.add(id);
  dc.planReviewDownloadsAttemptedThisRun =
    (Number(dc.planReviewDownloadsAttemptedThisRun) || 0) + 1;
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {string} documentId
 * @returns {boolean}
 */
function arlingtonPlanReviewDocAlreadyAttemptedThisRun(dc, documentId) {
  if (!dc || typeof dc !== "object") return false;
  const set = dc.planReviewAttemptedDocIdsThisRun;
  if (!(set instanceof Set)) return false;
  const id = `${documentId || ""}`.trim();
  return id ? set.has(id) : false;
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {"planSet"|"reviewResultsAndMarkups"|"approvedDocuments"|"secondary"} source
 */
function arlingtonPlanReviewRecordDownloadSuccess(dc, source) {
  if (!dc || typeof dc !== "object") return;
  dc.planReviewDownloadsSucceededThisRun =
    (Number(dc.planReviewDownloadsSucceededThisRun) || 0) + 1;
  if (arlingtonPlanReviewSourceIsPlanSet(source)) {
    dc.planReviewPlanSetDownloadsSucceededThisRun =
      (Number(dc.planReviewPlanSetDownloadsSucceededThisRun) || 0) + 1;
  } else if (arlingtonPlanReviewSourceIsSecondary(source)) {
    dc.planReviewSecondaryDownloadsSucceededThisRun =
      (Number(dc.planReviewSecondaryDownloadsSucceededThisRun) || 0) + 1;
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} dc
 */
function arlingtonPlanReviewRecordHardFailure(dc) {
  if (!dc || typeof dc !== "object") return;
  dc.planReviewHardFailuresThisRun =
    (Number(dc.planReviewHardFailuresThisRun) || 0) + 1;
}

/**
 * @param {Record<string, unknown>} doc
 * @param {Record<string, unknown> | null | undefined} dc
 * @returns {Promise<void>}
 */
async function arlingtonPlanReviewRecordStreamTimeout(doc, dc) {
  if (!dc || typeof dc !== "object") return;
  dc.planReviewStreamTimeoutsThisRun =
    (Number(dc.planReviewStreamTimeoutsThisRun) || 0) + 1;
  dc.planReviewPartialPendingDownloads = true;
  const saver = dc.savePlanReviewCheckpoint;
  if (typeof saver === "function") {
    const integ = dc.planReviewIntegratedTabs;
    const pending =
      integ && typeof integ === "object"
        ? arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(integ)
        : 0;
    await saver("streamTimeout", {
      pending,
      downloaded: Number(dc.planReviewDownloadsSucceededThisRun) || 0,
      docName: `${doc?.name || doc?.filename || ""}`.trim(),
    }).catch(() => {});
    arlingtonPlanReviewMarkCheckpointSaved(dc);
  }
  const lim =
    dc.planReviewLimits && typeof dc.planReviewLimits === "object"
      ? dc.planReviewLimits
      : {};
  const maxStreamT =
    Number(lim.maxStreamTimeouts) ||
    ARLINGTON_PLAN_REVIEW_MAX_STREAM_TIMEOUTS_PER_RUN;
  const streamT = Number(dc.planReviewStreamTimeoutsThisRun) || 0;
  if (streamT >= maxStreamT) {
    await arlingtonPlanReviewStopDownloads(dc, "stream_timeout_limit_reached");
  }
}

/**
 * @param {unknown[]} sink
 * @param {string} tabKey
 * @param {string} [prepReason]
 */
function arlingtonPlanReviewMarkSinkTabNotResolved(sink, tabKey, prepReason) {
  if (!Array.isArray(sink)) return;
  const skipReason = `${prepReason || ""}`.trim() || "tab_not_resolved";
  for (const doc of sink) {
    if (!doc || typeof doc !== "object") continue;
    if (arlingtonErmsSinkDocLooksUploadComplete(doc)) continue;
    const d = /** @type {Record<string, unknown>} */ (doc);
    const docId = arlingtonPickSecondaryRowDocumentId(d);
    if (!docId) continue;
    d.downloadStatus = "pending_tab_not_resolved";
    d.status = "pending";
    d.skipReason = skipReason;
    d.sourceTab = tabKey;
  }
}

/**
 * @param {import("playwright").Page | import("playwright").Frame} frame
 * @param {string} hrefPart
 * @returns {Promise<boolean>}
 */
async function arlingtonPlanReviewClickFrameHref(frame, hrefPart) {
  if (!frame || typeof frame.evaluate !== "function") return false;
  const part = `${hrefPart || ""}`.trim();
  if (!part) return false;
  try {
    return !!(await frame.evaluate((hrefNeedle) => {
      const needle = `${hrefNeedle || ""}`.trim();
      if (!needle) return false;
      const links = document.querySelectorAll("a[href]");
      for (const a of links) {
        const href = `${a.getAttribute("href") || ""}`;
        if (href.includes(needle)) {
          a.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
          return true;
        }
      }
      return false;
    }, part));
  } catch (_) {
    return false;
  }
}

/**
 * @param {import("playwright").Page | import("playwright").Frame | null | undefined} frame
 * @returns {Promise<string>}
 */
async function arlingtonPlanReviewFrameUrlShort(frame) {
  if (!frame || typeof frame.url !== "function") return "(no-frame)";
  try {
    return `${frame.url() || ""}`.slice(0, 160);
  } catch (_) {
    return "(url-error)";
  }
}

/**
 * @param {import("playwright").Page} page
 * @param {import("playwright").Page | import("playwright").Frame} target
 * @param {number} timeoutMs
 * @returns {Promise<import("playwright").Page | import("playwright").Frame>}
 */
async function arlingtonPlanReviewRefreshErmsTarget(page, target, timeoutMs) {
  const refreshed = await waitForArlingtonPlanReviewErmsShellReady(
    page,
    timeoutMs,
  );
  return refreshed || target;
}

/**
 * Approved Documents readiness with panel evidence when URL did not change.
 * @returns {Promise<{ ready: boolean; reason: string }>}
 */
async function arlingtonPlanReviewEvaluateApprovedTabReadyDetail(frame) {
  if (!frame || typeof frame.evaluate !== "function") {
    return { ready: false, reason: "no_frame" };
  }
  try {
    const result = await frame.evaluate(() => {
      const href = `${location.href || ""}`;
      const body = document.body?.innerText || "";

      if (
        /Building Arlington/i.test(body) &&
        /Sign Out/i.test(body) &&
        !/File Actions/i.test(body)
      ) {
        return { ready: false, reason: "site_chrome_not_approved_grid" };
      }

      const hasFileActions = /File Actions/i.test(body);
      const hasDocDate = /Document Date/i.test(body);
      const hasDownload = /Download/i.test(body);
      const hasApprovedPlanSet = /Approved Plan Set/i.test(body);
      const hasRrLetter = /Review Results Letter/i.test(body);
      const docActions = document.querySelectorAll(
        'input.docaction, input.img-button.docaction, input[type="image"]',
      ).length;
      const tableRows = document.querySelectorAll("table tbody tr").length;
      const gridStrong =
        hasFileActions &&
        hasDocDate &&
        hasDownload &&
        (hasApprovedPlanSet || hasRrLetter) &&
        tableRows > 1 &&
        docActions > 0;

      if (gridStrong) {
        return { ready: true, reason: "approved_grid_markers" };
      }

      if (href.includes("ApprovedDocuments") && gridStrong) {
        return { ready: true, reason: "url_approved_documents" };
      }
      if (/Approved Plan Set/i.test(body) && gridStrong) {
        return { ready: true, reason: "approved_plan_set_text" };
      }
      if (
        /Review Results Letter/i.test(body) &&
        /Approved Plan Set/i.test(body) &&
        gridStrong
      ) {
        return { ready: true, reason: "rr_letter_and_approved_plan_set" };
      }
      if (
        hasFileActions &&
        hasDocDate &&
        hasDownload &&
        tableRows > 0 &&
        docActions > 0
      ) {
        return { ready: true, reason: "file_actions_and_date" };
      }
      return { ready: false, reason: "approved_markers_missing" };
    });
    return {
      ready: !!result?.ready,
      reason: `${result?.reason || "approved_markers_missing"}`.trim(),
    };
  } catch (_) {
    return { ready: false, reason: "evaluate_error" };
  }
}

/**
 * @param {import("playwright").Page} page
 * @param {import("playwright").Page | import("playwright").Frame} domTarget
 * @param {{ label: string; tabKey: string }} st
 * @param {{ panelHref: string; markerRxSource: string }} hints
 * @returns {Promise<{ ok: boolean; domTarget: import("playwright").Page | import("playwright").Frame; notResolvedReason?: string }>}
 */
async function arlingtonPlanReviewPrepareApprovedTabForDownload(
  page,
  domTarget,
  st,
  hints,
) {
  const logP = "[Arlington][PlanReview][ApprovedPrep]";
  /** @type {string[]} */
  const failSteps = [];
  let target = domTarget;

  console.log(
    `${logP} before url=${await arlingtonPlanReviewFrameUrlShort(target)}`,
  );

  const hrefClick = await arlingtonPlanReviewClickFrameHref(
    target,
    hints.panelHref,
  );
  console.log(`${logP} hrefClick=${hrefClick}`);
  if (!hrefClick) failSteps.push("approved_href_click_failed");
  await page.waitForTimeout(800).catch(() => {});
  target = await arlingtonPlanReviewRefreshErmsTarget(page, target, 15000);
  console.log(
    `${logP} after href url=${await arlingtonPlanReviewFrameUrlShort(target)}`,
  );

  let ev = await arlingtonPlanReviewEvaluateApprovedTabReadyDetail(target);
  if (ev.ready) {
    console.log(`${logP} ready=${ev.ready} reason=${ev.reason}`);
    return { ok: true, domTarget: target };
  }

  let labelClick = await clickArlingtonErmsTopTab(target, page, "Approved Documents");
  if (!labelClick) {
    const panelEl = await clickAndResolveArlingtonErmsTopPanel(
      page,
      target,
      st,
    ).catch(() => null);
    labelClick = !!panelEl;
    if (panelEl && typeof panelEl.dispose === "function") {
      await panelEl.dispose().catch(() => {});
    }
  }
  console.log(`${logP} labelClick=${labelClick}`);
  if (!labelClick) failSteps.push("approved_label_click_failed");
  await page.waitForTimeout(800).catch(() => {});
  target = await arlingtonPlanReviewRefreshErmsTarget(page, target, 15000);
  console.log(
    `${logP} after label url=${await arlingtonPlanReviewFrameUrlShort(target)}`,
  );

  ev = await arlingtonPlanReviewEvaluateApprovedTabReadyDetail(target);
  if (ev.ready) {
    console.log(`${logP} ready=${ev.ready} reason=${ev.reason}`);
    return { ok: true, domTarget: target };
  }

  let directGoto = false;
  let gotoUrl = "";
  try {
    const origin = new URL(target.url()).origin;
    gotoUrl = `${origin}/PlanReviewIntegrated/Plan/ApprovedDocuments`;
    await target.goto(gotoUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    directGoto = true;
    await page.waitForTimeout(800).catch(() => {});
    target = await arlingtonPlanReviewRefreshErmsTarget(page, target, 15000);
  } catch (_) {
    directGoto = false;
    failSteps.push("approved_direct_goto_failed");
  }
  console.log(
    `${logP} directGoto=${directGoto} url=${gotoUrl || (await arlingtonPlanReviewFrameUrlShort(target))}`,
  );

  ev = await arlingtonPlanReviewEvaluateApprovedTabReadyDetail(target);
  if (!ev.ready) failSteps.push("approved_markers_missing");
  const notResolvedReason = [...new Set(failSteps)].join("|") || ev.reason;
  console.log(`${logP} ready=${ev.ready} reason=${ev.ready ? ev.reason : notResolvedReason}`);

  return {
    ok: ev.ready,
    domTarget: target,
    notResolvedReason: ev.ready ? undefined : notResolvedReason,
  };
}

/**
 * @param {import("playwright").Page} page
 * @param {import("playwright").Page | import("playwright").Frame} domTarget
 * @param {{ label: string; tabKey: string }} st
 * @returns {Promise<{ ok: boolean; domTarget: import("playwright").Page | import("playwright").Frame; notResolvedReason?: string }>}
 */
async function arlingtonPlanReviewPrepareSecondaryTabForDownload(page, domTarget, st) {
  const hints =
    ARLINGTON_SECONDARY_TAB_DOWNLOAD_HINTS[
      /** @type {keyof typeof ARLINGTON_SECONDARY_TAB_DOWNLOAD_HINTS} */ (
        st.tabKey
      )
    ];
  if (!hints) return { ok: false, domTarget, notResolvedReason: "no_hints" };

  await ensureArlingtonPlanReviewActive(page).catch(() => ({ ok: false }));
  await page.waitForTimeout(650).catch(() => {});

  let target = domTarget;
  const refreshed = await waitForArlingtonPlanReviewErmsShellReady(page, 45000);
  if (refreshed) target = refreshed;

  if (st.tabKey === "approvedDocuments") {
    const approvedPrep = await arlingtonPlanReviewPrepareApprovedTabForDownload(
      page,
      target,
      st,
      hints,
    );
    console.log(
      `[Arlington][PlanReview] ${st.label} download-phase tab markers=${approvedPrep.ok}`,
    );
    return approvedPrep;
  }

  await arlingtonPlanReviewClickFrameHref(target, hints.panelHref);
  await page.waitForTimeout(650).catch(() => {});

  if (st.tabKey === "reviewResultsAndMarkups") {
    for (const nl of ARLINGTON_REVIEW_RESULTS_DOM_SUBTABS) {
      // eslint-disable-next-line no-await-in-loop
      const hit = await clickArlingtonIntegratedNestedTab(page, nl);
      if (hit) break;
    }
    await page.waitForTimeout(650).catch(() => {});
  }

  const markersOk = await arlingtonPlanReviewEvaluateSecondaryTabReady(
    target,
    st.tabKey,
  );

  console.log(
    `[Arlington][PlanReview] ${st.label} download-phase tab markers=${markersOk}`,
  );
  return {
    ok: markersOk,
    domTarget: target,
    notResolvedReason: markersOk ? undefined : "review_markers_missing",
  };
}

/**
 * @param {Record<string, unknown>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {Record<string, unknown> | null | undefined} parentDownloadCtx
 */
function arlingtonPlanReviewFinalizeRunStats(
  integratedTabs,
  dc,
  parentDownloadCtx,
  scopeRawArg,
) {
  if (!dc || typeof dc !== "object") return;
  const scopeRaw =
    `${scopeRawArg || dc.planReviewScope || ""}`.trim() || undefined;
  const pendingByReason = arlingtonPlanReviewPendingByReason(
    integratedTabs,
    scopeRaw,
  );
  const pendingTotal = Object.values(pendingByReason).reduce((a, b) => a + b, 0);
  const queue = dc.planReviewQueueTotals || {};
  const runStats = {
    planSetTotal: Number(queue.planSetTotal) || 0,
    reviewResultsTotal: Number(queue.reviewResultsTotal) || 0,
    approvedTotal: Number(queue.approvedTotal) || 0,
    alreadyDownloaded: Number(queue.alreadyDownloaded) || 0,
    pendingTotal,
    pendingByReason,
    downloadedThisRun: Number(dc.planReviewDownloadsSucceededThisRun) || 0,
    streamTimeoutsThisRun: Number(dc.planReviewStreamTimeoutsThisRun) || 0,
    hardFailuresThisRun: Number(dc.planReviewHardFailuresThisRun) || 0,
    stoppedReason: `${dc.planReviewStoppedReason || "complete"}`.trim() || "complete",
    nextRecommendedScope: arlingtonPlanReviewNextRecommendedScope(
      integratedTabs,
      dc,
    ),
    checkpointSaved: dc.planReviewCheckpointSaved === true,
  };
  dc.planReviewRunStats = runStats;
  if (pendingTotal > 0 || dc.planReviewPartialPendingDownloads === true) {
    dc.planReviewPartialPendingDownloads = true;
  }
  if (parentDownloadCtx && typeof parentDownloadCtx === "object") {
    parentDownloadCtx.planReviewRunStats = runStats;
    if (dc.planReviewPartialPendingDownloads === true) {
      parentDownloadCtx.planReviewPartialPendingDownloads = true;
    }
    if (dc.planReviewCheckpointSaved === true) {
      parentDownloadCtx.planReviewCheckpointSaved = true;
    }
    const session = parentDownloadCtx._arlingtonSession;
    if (session && typeof session === "object") {
      const s = /** @type {Record<string, unknown>} */ (session);
      if (dc.planReviewPartialPendingDownloads === true) {
        s.arlingtonPlanReviewPartialPendingDownloads = true;
      }
      if (dc.planReviewCheckpointSaved === true) {
        s.arlingtonPlanReviewCheckpointSaved = true;
      }
    }
  }
  console.log(
    `[Arlington][PlanReview] partial success pending=${pendingTotal} pendingByReason=${JSON.stringify(pendingByReason)} nextRecommendedScope=${runStats.nextRecommendedScope}`,
  );
}

/**
 * @param {object} opts
 * @returns {Promise<{ planSetDomDownloads: number }>}
 */
async function runArlingtonPlanReviewDownloadPhasesAfterCheckpoint(opts) {
  const {
    page,
    domTarget,
    integratedTabs,
    sharedGridCtx,
    sink,
    attachmentDedupeKeys,
    prSeenRowKeys,
    downloadedHashes,
    planSetErmsOrigin,
    prCfg,
    downloadCtx,
  } = opts;

  let planSetDomDownloads = 0;
  if (!sharedGridCtx) return { planSetDomDownloads };

  let dlScopeRaw = null;
  if (downloadCtx?.planReviewScope) {
    dlScopeRaw = `${downloadCtx.planReviewScope}`.trim();
  } else if (downloadCtx?.planReviewMode === "metadataOnly") {
    dlScopeRaw = "metadataOnly";
  } else if (downloadCtx?.downloadDocuments === false) {
    dlScopeRaw = "metadataOnly";
  }
  const dlScope = dlScopeRaw
    ? arlingtonNormalizePlanReviewActionScope(dlScopeRaw)
    : "allPending";

  console.log(
    `[Arlington][PlanReview] download phase resolved scope raw=${dlScopeRaw || "(default)"} normalized=${dlScope}`,
  );

  if (dlScope === "metadataOnly") {
    return { planSetDomDownloads };
  }

  if (sharedGridCtx && typeof sharedGridCtx === "object") {
    /** @type {Record<string, unknown>} */ (sharedGridCtx).planReviewScope =
      dlScopeRaw || dlScope;
  }

  const selectiveSecondaryScope =
    dlScope === "approvedDocuments" ||
    dlScope === "reviewResults" ||
    dlScope === "projectInformation";
  const selectiveLogPrefix = selectiveSecondaryScope
    ? "[Arlington][PlanReview][Selective]"
    : "[Arlington][PlanReview]";

  if (selectiveSecondaryScope && sharedGridCtx) {
    arlingtonPlanReviewRearmSelectiveDownloadBudget(
      sharedGridCtx,
      downloadCtx,
      dlScope,
    );
  }

  arlingtonPlanReviewInitDownloadManager(sharedGridCtx, {
    continueRun: selectiveSecondaryScope,
    logPrefix: selectiveLogPrefix,
  });
  arlingtonPlanReviewLogDownloadQueueStart(
    integratedTabs,
    sharedGridCtx,
    selectiveLogPrefix,
  );
  if (dlScopeRaw && dlScopeRaw !== "allPending") {
    console.log(
      `[Arlington][PlanReview] download phases scope=${dlScope}`,
    );
  }

  const runSecondaryDownloads =
    arlingtonPlanReviewScopeAllowsSecondary(dlScope) &&
    (prCfg.planReviewIncludeSecondaryTabs === true || selectiveSecondaryScope);

  if (runSecondaryDownloads) {
    const scopeNorm = arlingtonNormalizePlanReviewActionScope(dlScope);
    if (scopeNorm === "approvedDocuments") {
      const adList = integratedTabs?.approvedDocuments?.documents;
      const adArr = Array.isArray(adList) ? adList : [];
      const adPending = adArr.filter((d) =>
        arlingtonPlanReviewDocNeedsDownloadAttempt(d),
      ).length;
      console.log(
        `${selectiveLogPrefix} source=approvedDocuments total=${adArr.length} pending=${adPending} downloaded=${adArr.length - adPending}`,
      );
    } else if (scopeNorm === "reviewResults") {
      const rrList = integratedTabs?.reviewResultsAndMarkups?.documents;
      const rrArr = Array.isArray(rrList) ? rrList : [];
      const rrPending = rrArr.filter((d) =>
        arlingtonPlanReviewDocNeedsDownloadAttempt(d),
      ).length;
      console.log(
        `${selectiveLogPrefix} source=reviewResultsAndMarkups total=${rrArr.length} pending=${rrPending} downloaded=${rrArr.length - rrPending}`,
      );
    }
    await runArlingtonSecondaryTabsDownloadPhase({
      page,
      domTarget,
      integratedTabs,
      sharedGridCtx,
      attachmentDedupeKeys,
      prSeenRowKeys,
      downloadedHashes,
      planSetErmsOrigin,
      downloadCtx,
      scope: dlScope,
      logPrefix: selectiveSecondaryScope ? selectiveLogPrefix : "",
    });
  }

  if (
    arlingtonPlanReviewScopeAllowsPlanSet(dlScope) &&
    !sharedGridCtx.planReviewDownloadsAbortedDeadline &&
    Array.isArray(sink) &&
    sink.length
  ) {
    await clickArlingtonPlanReviewSubTab(page, "Plans & Documents");
    await page.waitForTimeout(650).catch(() => {});
    await clickArlingtonIntegratedNestedTab(page, "Plan Set Documents").catch(
      () => false,
    );
    await page.waitForTimeout(650).catch(() => {});

    const refreshed = await waitForArlingtonPlanReviewIframeReady(page, 30000);
    const dlTarget = refreshed || domTarget;

    planSetDomDownloads = await downloadArlingtonPlanSetDocumentsForSink(
      page,
      dlTarget,
      sink,
      {
        attachmentDedupeKeys,
        prSeenRowKeys,
        downloadedHashes,
        downloadCtx: sharedGridCtx,
        ermsOrigin: planSetErmsOrigin,
        downloadSource: "planSet",
      },
    );
    console.log(
      `[Arlington][PlanReview] Plan Set Documents rows=${sink.length} downloads=${planSetDomDownloads}`,
    );
  }

  arlingtonPlanReviewFinalizeRunStats(
    integratedTabs,
    sharedGridCtx,
    downloadCtx,
    dlScopeRaw || dlScope,
  );

  const saver = sharedGridCtx.savePlanReviewCheckpoint;
  if (typeof saver === "function") {
    await saver("downloadPhasesEnd", {
      downloaded: Number(sharedGridCtx.planReviewDownloadsSucceededThisRun) || 0,
      pending: arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(
        integratedTabs,
        dlScopeRaw || dlScope,
      ),
    }).catch(() => {});
    arlingtonPlanReviewMarkCheckpointSaved(sharedGridCtx);
  }

  return { planSetDomDownloads };
}

/**
 * @param {Record<string, unknown>} downloadCtx
 * @returns {Promise<void>}
 */
async function arlingtonPlanReviewMaybeCheckpointEvery5Downloads(downloadCtx) {
  if (!downloadCtx || typeof downloadCtx !== "object") return;
  const fn = downloadCtx.savePlanReviewCheckpoint;
  if (typeof fn !== "function") return;
  const integ = downloadCtx.planReviewIntegratedTabs;
  if (!integ || typeof integ !== "object") return;
  const prev =
    (Number(downloadCtx.planReviewDownloadsSinceCheckpoint) || 0) + 1;
  downloadCtx.planReviewDownloadsSinceCheckpoint = prev;
  if (prev < 5) return;
  downloadCtx.planReviewDownloadsSinceCheckpoint = 0;
  arlingtonPlanReviewTouchKeepalive(downloadCtx, "");
  const uploaded =
    arlingtonCountPlanReviewUploadedDocsAcrossIntegratedTabs(integ);
  const pendingIncomplete =
    arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(integ);
  await fn("everyFive", {
    downloaded: uploaded,
    pending: pendingIncomplete,
  }).catch(() => {});
  arlingtonPlanReviewMarkCheckpointSaved(downloadCtx);
}

/**
 * @param {Record<string, unknown>} downloadCtx
 * @returns {Promise<boolean>} true when downloads must stop globally
 */
async function arlingtonPlanReviewPauseDownloadsIfNearGlobalDeadline(
  downloadCtx,
) {
  if (!downloadCtx || typeof downloadCtx !== "object") return false;
  const dc = /** @type {Record<string, unknown>} */ (downloadCtx);
  if (dc.planReviewDownloadsAbortedDeadline === true) return true;
  const deadline = Number(dc.scrapeDeadlineMs) || 0;
  const reserveRaw = dc.reserveMsForFinalSave;
  const reserve =
    typeof reserveRaw === "number" && reserveRaw > 0
      ? reserveRaw
      : ARLINGTON_PLAN_REVIEW_RESUME_RESERVE_FINAL_SAVE_MS;
  if (!(deadline > 0) || !(Date.now() + reserve > deadline)) return false;
  const integ = dc.planReviewIntegratedTabs;
  if (integ && typeof integ === "object") {
    markArlingtonPlanReviewPendingTimeoutResumeIntegrated(integ);
  }
  const pendingIncomplete =
    integ && typeof integ === "object"
      ? arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(integ)
      : 0;
  const saver =
    typeof dc.savePlanReviewCheckpoint === "function"
      ? /** @type {(k: string, x: Record<string, unknown>) => Promise<void>} */ (
          dc.savePlanReviewCheckpoint
        )
      : null;
  if (saver && integ && typeof integ === "object") {
    await saver("nearTimeout", {
      pending: pendingIncomplete,
      downloaded: arlingtonCountPlanReviewUploadedDocsAcrossIntegratedTabs(integ),
    }).catch(() => {});
  }
  console.log(
    `[Arlington][PlanReview] nearing timeout; checkpoint saved and paused remaining downloads pending=${pendingIncomplete}`,
  );
  dc.planReviewDownloadsSinceCheckpoint = 0;
  dc.planReviewDownloadsAbortedDeadline = true;
  dc.planReviewPartialPendingDownloads = true;
  dc.planReviewStoppedReason = dc.planReviewStoppedReason || "near_global_deadline";
  arlingtonPlanReviewMarkCheckpointSaved(dc);
  return true;
}

/**
 * Shared ERMS Invoke -> Poll -> DocumentStream download loop.
 * @returns {Promise<number>}
 */
async function downloadArlingtonErmsDocumentsForSink(
  downloadPage,
  domTarget,
  sink,
  {
    attachmentDedupeKeys,
    prSeenRowKeys,
    downloadedHashes,
    downloadCtx,
    ermsOrigin: ermsOriginOpt,
    logLabel = "Plan Set",
    rowScope = "planSet",
    downloadSource = "planSet",
  },
) {
  if (!downloadCtx || !domTarget || !Array.isArray(sink) || !sink.length)
    return 0;

  let ermsOriginHint = `${ermsOriginOpt || ""}`.trim();
  if (!ermsOriginHint && typeof domTarget.url === "function") {
    try {
      ermsOriginHint = new URL(domTarget.url()).origin;
    } catch (_) {
      /**/
    }
  }

  const findRowByDocumentId =
    rowScope === "activePanel"
      ? findArlingtonActivePanelRowHandleByDocumentId
      : findArlingtonPlanSetRowHandleByDocumentId;
  const findRowByName =
    rowScope === "activePanel"
      ? findArlingtonActivePanelRowHandleByName
      : findArlingtonPlanSetRowHandleByName;

  let downloads = 0;
  const seenDocumentIds = new Set();
  for (let i = 0; i < sink.length; i++) {
    const doc = sink[i];
    if (downloadCtx.planReviewDownloadsAbortedDeadline === true) {
      break;
    }

    const nameGuess = `${doc.name || doc.filename || ""}`.trim();
    if (!nameGuess) {
      console.log(
        `[Arlington][PlanReview] ${logLabel} download failed  reason=no_doc_name`,
      );
      continue;
    }

    if (arlingtonErmsSinkDocLooksUploadComplete(doc)) {
      if (downloadCtx && typeof downloadCtx === "object") {
        downloadCtx.planReviewSkippedAlreadyDownloadedThisRun =
          (Number(downloadCtx.planReviewSkippedAlreadyDownloadedThisRun) || 0) +
          1;
      }
      if (`${doc.downloadStatus || ""}`.trim() === "") {
        doc.downloadStatus = "already_downloaded";
        doc.status = "downloaded";
      }
      continue;
    }

    const documentId = `${doc.documentId || doc.action?.documentId || ""}`.trim();
    if (documentId) {
      if (seenDocumentIds.has(documentId)) {
        console.log(
          `[Arlington][PlanReview] ${logLabel} duplicate documentId=${documentId} row=${nameGuess}`,
        );
        doc.downloadStatus = "duplicate_skipped";
        continue;
      }
      seenDocumentIds.add(documentId);
    }

    if (
      documentId &&
      arlingtonPlanReviewDocAlreadyAttemptedThisRun(downloadCtx, documentId)
    ) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const stopGate = await arlingtonPlanReviewShouldStopBeforeDoc(
      downloadCtx,
      downloadSource,
    );
    if (stopGate.stop) {
      if (documentId && /^\d+$/.test(documentId)) {
        doc.downloadStatus = "pending_not_attempted";
        doc.status = "pending";
        doc.skipReason = stopGate.reason || "batch_limit_reached";
      }
      break;
    }

    const rowMeta = {
      name: nameGuess,
      documentDate: doc.documentDate || "",
      discipline: doc.discipline || "",
      sheetType: doc.sheetType || doc.documentType || "",
      description: doc.description || "",
      revision: doc.revision || "",
      uploadStatus: doc.uploadStatus || doc.status || "",
      size: doc.size || "",
    };

    const rowKey = arlingtonIntegratedRowDedupeKey(
      rowMeta.name,
      rowMeta.documentDate || "",
      rowMeta.size || "",
      rowMeta.revision || "",
    );

    if (attachmentDedupeKeys.has(rowKey) || prSeenRowKeys.has(rowKey)) {
      console.log(
        `[Arlington][PlanReview] ${logLabel} download failed ${nameGuess} reason=dedupe_skip`,
      );
      doc.downloadStatus = "duplicate_skipped";
      continue;
    }

    /** @type {string} */
    let docId = documentId;
    /** @type {import('playwright').ElementHandle | null} */
    let rowHandle = null;

    if (docId) {
      rowHandle = await findRowByDocumentId(domTarget, docId);
      console.log(
        `[Arlington][PlanReview] ${logLabel} download target documentId=${docId} row=${nameGuess}${rowHandle ? "" : " (row handle not resolved)"}`,
      );
    }

    if (!docId) {
      rowHandle = await findRowByName(domTarget, nameGuess);
      if (!rowHandle) {
        console.log(
          `[Arlington][PlanReview] ${logLabel} download failed ${nameGuess} reason=no_row_match`,
        );
        continue;
      }

      const picked = await pickArlingtonPlanSetDownloadControl(rowHandle);
      if (!picked || !picked.handle) {
        console.log(
          `[Arlington][PlanReview] ${logLabel} download failed ${nameGuess} reason=no_download_input`,
        );
        await rowHandle.dispose().catch(() => {});
        continue;
      }
      docId = picked.docId || "(unknown)";
      await picked.handle.dispose().catch(() => {});
      await rowHandle.dispose().catch(() => {});
      console.log(
        `[Arlington][PlanReview] ${logLabel} download target name=${docId} row=${nameGuess}`,
      );
    } else if (rowHandle) {
      await rowHandle.dispose().catch(() => {});
    }

    if ((!docId || docId === "(unknown)") && doc.sourceApi) {
      continue;
    }

    if (!docId) {
      continue;
    }

    arlingtonPlanReviewMarkDocAttemptedThisRun(downloadCtx, docId);
    arlingtonPlanReviewDownloadBegin(downloadCtx, docId);
    try {
      let uploadOutcome = await arlingtonPlanSetDownloadViaInvokeDownloadDocument(
        downloadPage,
        domTarget,
        docId,
        rowMeta,
        downloadCtx,
        rowKey,
        prSeenRowKeys,
        ermsOriginHint,
        logLabel,
      );

      let uploadedOk =
        `${uploadOutcome.downloadStatus || ""}`.trim() === "uploaded" &&
        !!`${uploadOutcome.publicUrl || ""}`.trim();

      if (
        !uploadedOk &&
        docId &&
        /^\d+$/.test(docId) &&
        (doc.sourceApi || rowScope === "activePanel")
      ) {
        uploadOutcome = await arlingtonErmsDownloadViaDirectPlanDocInvoke(
          downloadPage,
          domTarget,
          docId,
          rowMeta,
          downloadCtx,
          rowKey,
          prSeenRowKeys,
          ermsOriginHint,
          logLabel,
        );
        uploadedOk =
          `${uploadOutcome.downloadStatus || ""}`.trim() === "uploaded" &&
          !!`${uploadOutcome.publicUrl || ""}`.trim();
      }

      if (
        `${uploadOutcome.failureReason || ""}`.trim() ===
        "session_closed_during_download"
      ) {
        await arlingtonPlanReviewMarkDocSessionClosed(doc, downloadCtx);
        continue;
      }

      if (uploadedOk) {
        downloads++;
        arlingtonPlanReviewRecordDownloadSuccess(downloadCtx, downloadSource);
        doc.publicUrl = uploadOutcome.publicUrl;
        doc.downloadUrl = uploadOutcome.publicUrl;
        doc.storagePath = uploadOutcome.storagePath || "";
        doc.size = uploadOutcome.size || doc.size || "";
        doc.downloadStatus = "uploaded";
        doc.status = "downloaded";
        console.log(
          `[Arlington][PlanReview] ${logLabel} download OK ${nameGuess}`,
        );
        delete doc.retryCount;
        delete doc.skipReason;
        await arlingtonPlanReviewMaybeCheckpointEvery5Downloads(downloadCtx);
      } else if (
        `${uploadOutcome.downloadStatus || ""}`.trim() ===
        "pending_stream_timeout"
      ) {
        doc.downloadStatus = "pending_stream_timeout";
        doc.status = "pending";
        doc.skipReason = "stream_timeout";
        doc.failureReason = "stream_timeout";
        doc.lastAttemptAt = new Date().toISOString();
        doc.retryCount = (Number(doc.retryCount) || 0) + 1;
        if (downloadCtx && typeof downloadCtx === "object")
          downloadCtx.planReviewPartialPendingDownloads = true;
        console.log(
          `[Arlington][PlanReview] ${logLabel} download pending stream_timeout ${nameGuess}`,
        );
        // eslint-disable-next-line no-await-in-loop
        await arlingtonPlanReviewRecordStreamTimeout(doc, downloadCtx);
        break;
      } else if (
        `${uploadOutcome.downloadStatus || ""}`.trim() ===
        "pending_token_missing"
      ) {
        doc.downloadStatus = "pending_token_missing";
        doc.status = "pending";
        doc.skipReason = "missing_verification_token";
        doc.retryCount = (Number(doc.retryCount) || 0) + 1;
        downloadCtx.planReviewPartialPendingDownloads = true;
        arlingtonPlanReviewRecordHardFailure(downloadCtx);
        console.log(
          `[Arlington][PlanReview] ${logLabel} download pending token_missing ${nameGuess}`,
        );
      } else if (
        `${uploadOutcome.downloadStatus || ""}`.trim() ===
        "pending_not_attempted"
      ) {
        doc.downloadStatus = "pending_not_attempted";
        doc.status = "pending";
        doc.skipReason =
          uploadOutcome.failureReason || "insufficient_remaining_budget";
      } else {
        const reason =
          uploadOutcome.failureReason ||
          uploadOutcome.downloadStatus ||
          "unknown";
        const ds = `${uploadOutcome.downloadStatus || ""}`.trim();
        if (ds === "oversized_for_supabase") {
          doc.downloadStatus = "oversized_for_supabase";
          doc.status = "pending";
        } else if (/upload_failed|write_failed|failed_html/.test(ds)) {
          doc.downloadStatus = "failed_upload";
          doc.status = "pending";
          arlingtonPlanReviewRecordHardFailure(downloadCtx);
        } else {
          doc.downloadStatus = "failed_non_retryable";
          doc.status = "pending";
          arlingtonPlanReviewRecordHardFailure(downloadCtx);
        }
        doc.skipReason = `${reason}`.slice(0, 200);
        console.log(
          `[Arlington][PlanReview] ${logLabel} download failed ${nameGuess} reason=${reason}`,
        );
        const hardF = Number(downloadCtx.planReviewHardFailuresThisRun) || 0;
        if (hardF >= ARLINGTON_PLAN_REVIEW_MAX_HARD_DOWNLOAD_FAILURES_PER_RUN) {
          // eslint-disable-next-line no-await-in-loop
          await arlingtonPlanReviewStopDownloads(
            downloadCtx,
            "hard_failure_limit_reached",
          );
          break;
        }
      }
    } catch (loopErr) {
      if (arlingtonErmsSessionClosedMessage(loopErr)) {
        await arlingtonPlanReviewMarkDocSessionClosed(doc, downloadCtx);
        console.log(
          `[Arlington][PlanReview] ${logLabel} download pending ${nameGuess} reason=session_closed_during_download`,
        );
      } else {
        arlingtonPlanReviewRecordHardFailure(downloadCtx);
        console.log(
          `[Arlington][PlanReview] ${logLabel} download failed ${nameGuess} reason=${loopErr && loopErr.message ? loopErr.message : loopErr}`,
        );
      }
    } finally {
      arlingtonPlanReviewDownloadEnd(downloadCtx);
    }
  }
  return downloads;
}

/**
 * Plan Set: click IMG `input.docaction` inside #divDocuments row; mutate sink in place.
 * @returns {Promise<number>} rows that received Supabase `publicUrl`
 */
async function downloadArlingtonPlanSetDocumentsForSink(
  downloadPage,
  domTarget,
  sink,
  options,
) {
  return downloadArlingtonErmsDocumentsForSink(
    downloadPage,
    domTarget,
    sink,
    {
      ...options,
      logLabel: "Plan Set",
      rowScope: "planSet",
      downloadSource: options.downloadSource || "planSet",
    },
  );
}

/**
 * Secondary ERMS tabs: API-first download by document id (no DOM row match).
 */
async function downloadArlingtonActivePanelDocumentsForSink(
  downloadPage,
  domTarget,
  sink,
  sourceTabCamel,
  sourceSectionCamel,
  {
    attachmentDedupeKeys,
    prSeenRowKeys,
    downloadedHashes,
    downloadCtx,
    ermsOrigin,
    tabLabel,
    aliasDocSources = [],
  },
) {
  const label =
    `${tabLabel || sourceTabCamel || "Plan Review tab"}`.trim() ||
    "Plan Review tab";
  const result = await downloadArlingtonSecondaryApiDocumentsForSink(
    downloadPage,
    domTarget,
    sink,
    {
      attachmentDedupeKeys,
      prSeenRowKeys,
      downloadCtx,
      ermsOrigin,
      logLabel: label,
      aliasDocSources,
    },
  );
  return result.downloads;
}

/**
 * Secondary ERMS tab rows: only rows inside resolved panel (`table tr` scoped to panel).
 * @param {import("playwright").ElementHandle | null} panelHandle
 * @param {string} [tabKey]
 * @returns {Promise<object[]>}
 */
async function extractArlingtonSecondaryTabRowsFromPanel(panelHandle, tabKey) {
  if (
    !panelHandle ||
    typeof panelHandle.evaluate !== "function"
  ) {
    return [];
  }

  try {
    return await panelHandle.evaluate((panelRootArg, tabKeyIn) => {
      const panelRoot =
        panelRootArg instanceof Element
          ? /** @type {Element} */ (panelRootArg)
          : null;
      if (!panelRoot) return [];

      const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
      const BAD =
        /Supporting\s+Documents|Comment\s+Response\s+Letters|Other\s+Supporting\s+Document|^Name\s+Discipline\s+Sheet\s+Type|Upload\s+Status$/i;

      /** @type {WeakMap<Element, string[]>} */
      const headerByTable = new WeakMap();

      function extractRowAction(tr) {
        /** @param {...string} blobs */
        function inferDocId(...blobs) {
          const hay = blobs.filter(Boolean).join("\n").slice(0, 8000);
          if (!hay.trim()) return "";
          const ps = [
            /\bPlanDoc(?:ID|Id)\s*[:=]\s*['"]?(\d{5,})['"]?/i,
            /\bplanDocId\s*[:=]\s*['"]?(\d{5,})['"]?/i,
            /\b(?:DocumentId|DOCUMENTID)\s*[:=']\s*['"]?(\d{5,})['"]?/i,
            /InvokeDownloadDocument\D*(\d{5,})\b/i,
            /DownloadDocument\D*[\(\[]\s*['"]?(\d{5,})['"]?/i,
            /[=,]\s*['"]?\s*(\d{7,})\s*['"]?\s*[,;)}\]]/,
          ];
          for (const p of ps) {
            const m = hay.match(p);
            const v = m && m[1] ? `${m[1]}`.trim() : "";
            if (/^\d{5,}$/.test(v)) return v;
          }
          return "";
        }

        /** @returns {object} */
        function finalizeAction(base) {
          if (base && typeof base === "object" && base.documentId)
            return base;
          const onc = `${(base && base.onclick) || ""}`;
          const hr = `${(base && base.href) || ""}`;
          const idAttr = `${(base && base.id) || ""}`;
          const nmAttr = `${(base && base.name) || ""}`;
          const inferred = inferDocId(onc, hr, idAttr, nmAttr);
          if (inferred && base && typeof base === "object") {
            return { ...base, documentId: inferred };
          }
          return base || {};
        }

        /** @type {HTMLInputElement | null} */
        let dlInput =
          tr.querySelector("input.img-button.docaction[name]") ||
          tr.querySelector("input.docaction[name]");
        if (!dlInput) {
          const imgs = [...tr.querySelectorAll('input[type="image"][name]')];
          for (const im of imgs) {
            const nm = `${im.getAttribute("name") || ""}`.trim();
            if (/^\d+$/.test(nm)) {
              dlInput = im;
              break;
            }
          }
        }
        if (dlInput) {
          const nameAttr = `${dlInput.getAttribute("name") || ""}`.trim();
          const onc = `${dlInput.getAttribute("onclick") || ""}`.trim();
          if (/^\d+$/.test(nameAttr)) {
            return finalizeAction({
              documentId: nameAttr,
              title: `${dlInput.getAttribute("title") || ""}`
                .trim()
                .slice(0, 800),
              alt: `${dlInput.getAttribute("alt") || ""}`.trim().slice(0, 800),
              href: "",
              onclick: onc.slice(0, 4000),
              id: `${dlInput.getAttribute("id") || ""}`.trim().slice(0, 500),
              name: nameAttr.slice(0, 260),
            });
          }
          const idGuess = inferDocId(
            onc,
            `${dlInput.getAttribute("id") || ""}`,
            nameAttr,
          );
          if (idGuess) {
            return finalizeAction({
              documentId: idGuess,
              title: `${dlInput.getAttribute("title") || ""}`
                .trim()
                .slice(0, 800),
              alt: `${dlInput.getAttribute("alt") || ""}`.trim().slice(0, 800),
              href: "",
              onclick: onc.slice(0, 4000),
              id: `${dlInput.getAttribute("id") || ""}`.trim().slice(0, 500),
              name: nameAttr.slice(0, 260),
            });
          }
        }

        const nodes = [
          ...tr.querySelectorAll(
            "input.docaction,input[type='image'],a,button",
          ),
        ].filter((el) => {
          try {
            return !!(el.closest("td") || el.closest("th"));
          } catch (_) {
            return false;
          }
        });
        const scored = [];
        for (const el of nodes) {
          const tn = `${el.tagName || ""}`.toUpperCase();
          let href = `${el.getAttribute("href") || ""}`.trim();
          if (/^javascript:void/i.test(href) || /^#?$/.test(href)) href = "";
          const onclick = `${el.getAttribute("onclick") || ""}`.trim();
          const id = `${el.getAttribute("id") || ""}`.trim();
          const nameAttr = `${el.getAttribute("name") || ""}`.trim();
          const title = `${el.getAttribute("title") || ""}`.trim();
          let alt = "";
          if (tn === "INPUT") {
            alt = `${el.getAttribute("alt") || ""}`.trim();
          }
          let score =
            (/^\d+$/.test(nameAttr) ? 200 : 0) +
            (/^https?:\/\//i.test(href) ? 120 : 0) +
            (onclick ? 40 : 0) +
            (title ? 5 : 0) +
            (alt ? 5 : 0) +
            (id ? 3 : 0);
          const hayOn = `${title} ${alt} ${onclick} ${href}`.toLowerCase();
          if (/download|open|pdf|view|sheet|mark.?up|result/.test(hayOn))
            score += 25;
          const inf = inferDocId(onclick, href, id, nameAttr);
          if (inf) score += 180;
          if (href || onclick || id || title || alt || inf)
            scored.push({
              score,
              documentId: inf || "",
              href: href.slice(0, 2000),
              onclick: onclick.slice(0, 4000),
              id: id.slice(0, 500),
              name: nameAttr.slice(0, 260),
              title: title.slice(0, 800),
              alt: alt.slice(0, 800),
            });
        }
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best)
          return { href: "", onclick: "", id: "", title: "", alt: "" };
        const { score: _omit, ...action } = best;
        return finalizeAction(action);
      }

      function findCol(headers, patterns) {
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i];
          if (patterns.some((p) => p.test(h))) return i;
        }
        return -1;
      }

      function cellAt(cells, ix, fallback = "") {
        if (ix < 0) return fallback;
        return `${cells[ix] ?? fallback}`.trim();
      }

      /** @type {object[]} */
      const out = [];
      const seen = new Set();

      let emittedOrdinal = -1;

      for (const tr of panelRoot.querySelectorAll("table tr")) {
        const table = tr.closest("table");
        if (!table) continue;
        const tds = [...tr.querySelectorAll("th,td")].filter(Boolean);
        if (!tds.length) continue;
        const cells = tds.map((td) => norm(td.innerText));
        const text = norm(tr.innerText);
        if (text.length < 3) continue;
        if (BAD.test(text)) continue;

        const onlyTh = tds.length > 0 && tds.every((e) => e.tagName === "TH");
        const looksHeader =
          onlyTh ||
          (/^name$/i.test(cells[0] || "") &&
            /\b(date|type|discipline|status|reviewer|download)\b/i.test(
              text.toLowerCase(),
            ));
        if (looksHeader) {
          headerByTable.set(
            table,
            cells.map((c) => c.toLowerCase()),
          );
          continue;
        }

        const headerCells = headerByTable.get(table) || [];
        const nameIx = findCol(headerCells, [
          /^name$/,
          /file\s*name/,
          /document\s*name/,
          /^document$/,
        ]);
        const discIx = findCol(headerCells, [/discipline/]);
        const typeIx = findCol(headerCells, [
          /document\s*type/,
          /sheet\s*type/,
          /^type$/,
        ]);
        const statusIx = findCol(headerCells, [/status/, /review\s*result/]);
        const reviewerIx = findCol(headerCells, [/reviewer/, /reviewed\s*by/]);
        const dateIx = findCol(headerCells, [
          /date/,
          /upload/,
          /approval/,
          /approved/,
        ]);

        let nameGuess = cellAt(cells, nameIx >= 0 ? nameIx : 0, "");
        if (!nameGuess) {
          nameGuess =
            cells.find(
              (c) =>
                c.length >= 8 &&
                !/^name$/i.test(c) &&
                !/^status$/i.test(c) &&
                !/^date$/i.test(c),
            ) || "";
        }
        if (!nameGuess || /^name$/i.test(nameGuess)) continue;

        let documentDateCell = cellAt(cells, dateIx, "");
        if (!documentDateCell) {
          const dm = nameGuess.match(
            /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
          );
          if (dm) documentDateCell = dm[1];
        }

        const action = extractRowAction(tr);
        const hasDocaction = !!action.documentId;
        const hasHttp =
          action.href && /^https?:\/\//i.test(action.href);
        if (!hasDocaction && !hasHttp && !action.onclick) continue;

        emittedOrdinal += 1;
        const tabPart = `${tabKeyIn || ""}`.trim();
        const idPart = `${action.documentId || ""}`.trim();
        const nmPart = norm(nameGuess).toLowerCase();
        const dtPart = norm(documentDateCell).toLowerCase();
        const key = /^\d+$/.test(idPart)
          ? `${tabPart}|id:${idPart}`
          : `${tabPart}|idx:${emittedOrdinal}|${nmPart}|${dtPart}|${norm(action.onclick || "").slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({
          name: nameGuess,
          discipline: cellAt(cells, discIx, cells[1] || ""),
          sheetType: cellAt(cells, typeIx, cells[2] || ""),
          documentType: cellAt(cells, typeIx, ""),
          documentDate: documentDateCell,
          reviewStatus: cellAt(cells, statusIx, ""),
          reviewer: cellAt(cells, reviewerIx, ""),
          description: cells.slice(3).join(" | ").slice(0, 450),
          revision: "",
          uploadStatus: cellAt(cells, statusIx, ""),
          text,
          action,
          source: "plan_review_secondary_tab_panel",
          tabKey: tabKeyIn || "",
          secondaryDomRowIndex: emittedOrdinal,
        });
      }

      return out;
    }, tabKey || "");
  } catch (_) {
    return [];
  }
}

const extractArlingtonSecondaryRowsFromPanel =
  extractArlingtonSecondaryTabRowsFromPanel;

/**
 * Collect frame diagnostics for Project Information candidate ranking.
 * Runs inside Playwright frame.evaluate.
 */
function arlingtonProjectInformationFrameEvaluateScript() {
  const norm = (s) =>
    `${s ?? ""}`
      .trim()
      .replace(/\s+/g, " ");
  const text = norm(
    document.body?.innerText || document.body?.textContent || "",
  );
  const url = location.href;

  /** @returns {{ id: string; name: string; value: string; parentText: string }}[] */
  const inputs = [
    ...document.querySelectorAll("input, textarea, select"),
  ].map((c) => {
    let v = "";
    if (c instanceof HTMLSelectElement) {
      const opt = c.selectedOptions?.[0];
      v = norm(
        `${opt?.textContent || opt?.value || c.value || ""}`,
      );
    } else if (
      c instanceof HTMLInputElement ||
      c instanceof HTMLTextAreaElement
    ) {
      v = norm(
        `${c.value || c.defaultValue || c.getAttribute("value") || ""}`,
      );
    }
    if (!v.trim()) v = norm(`${c.getAttribute("value") || ""}`);
    return {
      id: c.id || "",
      name: c.name || "",
      value: v.slice(0, 300),
      parentText: norm(
        c.closest("tr,.row,.form-group,div,li")?.innerText || "",
      ),
    };
  });

  const haystack = `${text} ${JSON.stringify(inputs)}`;
  const hasProjectLabels =
    /Project ID|Plan Review Project Name|Accela CAP ID|Review Type|CPHD Case|Address/i.test(
      haystack,
    );
  const filledInputs = inputs.filter((i) => `${i.value || ""}`.trim().length > 0);
  const filledInputCount = filledInputs.length;
  const hasProjectValues = filledInputCount >= 3;
  const isOuterShellUrl =
    /\/Plan\/ProjectInformation(?:\?|$|#)/i.test(url) &&
    !/\/GetUnityForm\//i.test(url);

  let extractedProjectId = "";
  const pidMatch = text.match(
    /Project\s+ID\s+([A-Z]{2,8}\d{2}-\d{4,6}(?:-(?:RA|REN|RB)\d+)?)/i,
  );
  if (pidMatch) extractedProjectId = norm(pidMatch[1]);

  let nonEmptyExpectedFieldCount = 0;
  for (const label of [
    "Project ID",
    "Accela CAP ID",
    "Review Type",
    "Plan Review Project Name",
    "Address",
  ]) {
    const row = inputs.find((i) =>
      new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(
        `${i.parentText} ${i.id} ${i.name}`,
      ),
    );
    if (row && `${row.value || ""}`.trim()) nonEmptyExpectedFieldCount += 1;
    else if (label === "Project ID" && extractedProjectId) {
      nonEmptyExpectedFieldCount += 1;
    }
  }

  let likelyThinShell = false;
  if (isOuterShellUrl && (text.length < 200 || filledInputCount < 1)) {
    likelyThinShell = true;
  } else if (isOuterShellUrl && hasProjectLabels && filledInputCount < 1) {
    likelyThinShell = true;
  } else if (
    inputs.length <= 24 &&
    filledInputCount < 1 &&
    isOuterShellUrl
  ) {
    likelyThinShell = true;
  }

  return {
    url,
    bodyLen: text.length,
    preview: text.slice(0, 500),
    inputCount: inputs.length,
    filledInputCount,
    hasProjectLabels,
    hasProjectValues,
    likelyThinShell,
    nonEmptyExpectedFieldCount,
    extractedProjectId,
    isOuterShellUrl,
    isUnityFormUrl:
      /\/GetUnityForm\//i.test(url) && /readOnly=true/i.test(url),
    hasUnityFormPath: /\/GetUnityForm\//i.test(url),
    readOnlyQuery: /readOnly=true/i.test(url),
  };
}

/**
 * PR `ProjectInformation` route often nests the real form in a child iframe (e.g. innerFormFrame).
 * @param {import("playwright").Page | import("playwright").Frame | null | undefined} prFrame
 * @param {string} [permitNumber]
 * @returns {Promise<import("playwright").Frame | null | undefined>}
 */
async function findArlingtonProjectInformationDataFrame(prFrame, permitNumber) {
  /** @type {import("playwright").Frame[]} */
  const candidates = [];

  /** @param {import("playwright").Frame} f */
  function walk(f) {
    candidates.push(f);
    for (const c of f.childFrames()) walk(c);
  }

  if (prFrame && typeof prFrame.childFrames === "function") {
    walk(/** @type {import("playwright").Frame} */ (prFrame));
  } else if (
    prFrame &&
    typeof prFrame.mainFrame === "function"
  ) {
    walk(prFrame.mainFrame());
  } else {
    return /** @type {import("playwright").Frame | null | undefined} */ (
      prFrame
    );
  }

  /** @type {{ frame: import("playwright").Frame, diag: Record<string, unknown> | null; score: number; reason: string; frameName: string }[]} */
  const framed = [];

  for (const frame of candidates) {
    let frameName = "";
    try {
      frameName = `${frame.name?.() || ""}`;
    } catch (_) {
      frameName = "";
    }

    /** @type {Record<string, unknown> | null} */
    const diag = await frame
      .evaluate(arlingtonProjectInformationFrameEvaluateScript)
      .catch(() => null);

    const { score, reason } = scoreArlingtonProjectInformationFrameCandidate(
      diag,
      permitNumber,
    );

    const structured = {
      frameName,
      url: `${diag?.url || ""}`,
      bodyLen: Number(diag?.bodyLen) || 0,
      filledInputCount: Number(diag?.filledInputCount) || 0,
      hasUnityForm: diag?.hasUnityFormPath === true,
      readOnly: diag?.readOnlyQuery === true,
      likelyThinShell: diag?.likelyThinShell === true,
      extractedProjectId: `${diag?.extractedProjectId || ""}`,
      score,
      reason,
    };
    console.log(
      `[Arlington][PlanReview] ProjectInfo frame candidate ${JSON.stringify(structured)}`,
    );

    framed.push({ frame, diag, score, reason, frameName });
  }

  const permitHint = `${permitNumber || ""}`.trim();
  const ranked = framed
    .slice()
    .sort((a, b) => b.score - a.score);

  for (const entry of ranked) {
    console.log(
      `[Arlington][ProjectInfo] ranked candidate score=${entry.score} url=${entry.diag?.url || ""} reason=${entry.reason}`,
    );
  }

  const pick = selectArlingtonProjectInformationFrameFromRanked(ranked);
  if (pick && ranked[pick.index]) {
    const chosen = ranked[pick.index];
    console.log(
      `[Arlington][ProjectInfo] selected candidate score=${chosen.score} url=${chosen.diag?.url || ""} reason=${pick.reason}`,
    );
    return chosen.frame;
  }

  console.log(
    `[Arlington][ProjectInfo] no populated Project Information data frame found (${ranked.length} candidates)`,
  );
  return null;
}

/**
 * Poll descendant frames until a populated Unity Project Information form appears.
 * @param {import("playwright").Page} page
 * @param {import("playwright").Page | import("playwright").Frame} ermsRoot
 * @param {string} [permitNumber]
 * @param {number} [timeoutMs]
 */
async function waitForArlingtonProjectInformationUnityFormFrame(
  page,
  ermsRoot,
  permitNumber,
  timeoutMs = 20000,
) {
  const logP = "[Arlington][PlanReview][ProjectInfo]";
  const deadline = Date.now() + timeoutMs;
  let root = ermsRoot;
  let lastRankedCount = 0;

  while (Date.now() < deadline) {
    const dataFrame = await findArlingtonProjectInformationDataFrame(
      root,
      permitNumber,
    );
    if (dataFrame) {
      const dataUrl = await arlingtonPlanReviewFrameUrlShort(dataFrame);
      if (
        /\/GetUnityForm\//i.test(dataUrl) ||
        (await dataFrame
          .evaluate(arlingtonProjectInformationFrameEvaluateScript)
          .then((d) => Number(d?.filledInputCount) > 0)
          .catch(() => false))
      ) {
        console.log(
          `${logP} nested Unity form ready url=${dataUrl}`,
        );
        return { frame: dataFrame, found: true, url: dataUrl };
      }
    }

    const refreshed = await waitForArlingtonPlanReviewErmsShellReady(
      page,
      Math.min(3000, deadline - Date.now()),
    );
    if (refreshed) root = refreshed;
    lastRankedCount += 1;
    await page.waitForTimeout(250).catch(() => {});
  }

  console.warn(
    `${logP} nested Unity form not found within ${timeoutMs}ms (polls=${lastRankedCount})`,
  );
  return {
    frame: null,
    found: false,
    url: "",
    diagnosticReason: ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND,
  };
}

/** Escape label text for use in RegExp. */
function arlingtonProjectInformationRegexEscapeLabel(label) {
  return `${label}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip trailing UnityForm debug/runtime noise from parsed values. */
function arlingtonUnityTextCleanProjectInfoValue(value) {
  let v = `${value ?? ""}`.trim().replace(/\s+/g, " ");
  if (!v) return "";
  const cutPatterns = [
    /\bdebug\s*:/i,
    /\bDocument Mode\s*:/i,
    /\bUA String\s*:/i,
    /\bSaving form\b/i,
    /\bThe form is being saved\b/i,
  ];
  for (const pat of cutPatterns) {
    const m = v.search(pat);
    if (m >= 0) v = v.slice(0, m).trim();
  }
  return v.replace(/#\s*$/, "").trim();
}

/**
 * Parse visible UnityForm body text when DOM label/input mapping fails.
 * @param {string} text
 * @param {string} [requestedPermit]
 * @returns {{ projectId: string; accelaCapId: string; reviewType: string; planReviewProjectName: string; address: string; cphdCase: string }}
 */
function extractArlingtonProjectInfoFromUnityText(text, requestedPermit) {
  const norm = (s) => `${s ?? ""}`.trim().replace(/\s+/g, " ");
  let t = norm(text);
  t = t.replace(/^Project Information\s+/i, "");

  /** @param {string} label @param {"start" | "end"} mode */
  const labelPattern = (label, mode) => {
    const escaped = arlingtonProjectInformationRegexEscapeLabel(label);
    if (/\#\s*$/.test(label)) {
      const base = label.replace(/\#\s*$/, "").trim();
      const baseEsc = arlingtonProjectInformationRegexEscapeLabel(base);
      return new RegExp(`${baseEsc}\\s*#`, "i");
    }
    return new RegExp(
      mode === "start" ? `\\b${escaped}\\b` : `\\b${escaped}\\b`,
      "i",
    );
  };

  /** @param {string} startLabel @param {string | null} endLabel */
  const extractBetween = (startLabel, endLabel) => {
    const startRe = labelPattern(startLabel, "start");
    const startMatch = t.match(startRe);
    if (!startMatch || startMatch.index == null) return "";
    const afterStart = startMatch.index + startMatch[0].length;
    if (!endLabel) {
      return arlingtonUnityTextCleanProjectInfoValue(t.slice(afterStart));
    }
    const rest = t.slice(afterStart);
    const endRe = labelPattern(endLabel, "end");
    const endMatch = rest.match(endRe);
    if (!endMatch || endMatch.index == null) {
      return arlingtonUnityTextCleanProjectInfoValue(rest);
    }
    return arlingtonUnityTextCleanProjectInfoValue(
      rest.slice(0, endMatch.index),
    );
  };

  void requestedPermit;

  return {
    projectId: extractBetween("Project ID", "Accela CAP ID"),
    accelaCapId: extractBetween("Accela CAP ID", "Review Type"),
    reviewType: extractBetween("Review Type", "Plan Review Project Name"),
    planReviewProjectName: extractBetween(
      "Plan Review Project Name",
      "Address",
    ),
    address: extractBetween("Address", "CPHD Case #"),
    cphdCase: extractBetween("CPHD Case #", null),
  };
}


/** @param {ReturnType<typeof extractArlingtonProjectInfoFromUnityText>} parsed */
function arlingtonProjectInfoUnityTextToFields(parsed) {
  return [
    { label: "Project ID", value: `${parsed.projectId || ""}`.trim() },
    {
      label: "Plan Review Project Name",
      value: `${parsed.planReviewProjectName || ""}`.trim(),
    },
    { label: "Accela CAP ID", value: `${parsed.accelaCapId || ""}`.trim() },
    { label: "Address", value: `${parsed.address || ""}`.trim() },
    { label: "Review Type", value: `${parsed.reviewType || ""}`.trim() },
    { label: "CPHD Case #", value: `${parsed.cphdCase || ""}`.trim() },
  ].map((f) => ({ ...f, sourceTab: "projectInformation" }));
}

/** @param {unknown} priorPortalData */
function arlingtonPriorIntegratedTabsFromPortalData(priorPortalData) {
  const pr = /** @type {Record<string, unknown>} */ (
    priorPortalData || {}
  )?.tabs?.planReview;
  if (!pr || typeof pr !== "object") return null;
  const tabs = /** @type {Record<string, unknown>} */ (pr).tabs;
  if (!tabs || typeof tabs !== "object") return null;
  try {
    return structuredCloneWorksSafe(tabs);
  } catch (_) {
    return JSON.parse(JSON.stringify(tabs));
  }
}

/**
 * PI-only scrape: keep prior integrated tabs; replace projectInformation only when valid.
 * @param {unknown} priorPortalData
 * @param {ReturnType<typeof defaultArlingtonIntegratedTabsSkeleton>} scrapedIntegratedTabs
 * @param {string} [permitNumber]
 */
function arlingtonApplyProjectInformationOnlyIntegratedTabsMerge(
  priorPortalData,
  scrapedIntegratedTabs,
  permitNumber,
) {
  const priorTabs = arlingtonPriorIntegratedTabsFromPortalData(priorPortalData);
  /** @type {Record<string, unknown>} */
  let merged;
  try {
    merged = priorTabs
      ? structuredCloneWorksSafe(priorTabs)
      : structuredCloneWorksSafe(scrapedIntegratedTabs);
  } catch (_) {
    merged = priorTabs
      ? JSON.parse(JSON.stringify(priorTabs))
      : JSON.parse(JSON.stringify(scrapedIntegratedTabs));
  }
  if (!merged || typeof merged !== "object") {
    merged = JSON.parse(JSON.stringify(scrapedIntegratedTabs));
  }

  const scrapedPi = scrapedIntegratedTabs?.projectInformation;
  const scrapedFields = Array.isArray(scrapedPi?.fields) ? scrapedPi.fields : [];
  const priorPi = /** @type {Record<string, unknown>} */ (merged).projectInformation;
  const priorFields = Array.isArray(
    /** @type {Record<string, unknown>} */ (priorPi || {})?.fields,
  )
    ? /** @type {{ label: string; value: string }[]} */ (
        /** @type {Record<string, unknown>} */ (priorPi).fields
      )
    : [];

  if (arlingtonProjectInformationExtractionIsWeak(scrapedFields, permitNumber)) {
    console.log(
      "[Arlington][ProjectInfo] weak extraction rejected; preserving prior projectInformation",
    );
    if (priorPi && typeof priorPi === "object") {
      /** @type {Record<string, unknown>} */ (merged).projectInformation = {
        ...priorPi,
        extractionStatus: priorFields.length > 0 ? "preserved_prior" : "weak_failed",
      };
    } else {
      /** @type {Record<string, unknown>} */ (merged).projectInformation = {
        label: "Project Information",
        fields: [],
        requiredDocumentTypes: [],
        documents: [],
        extractionStatus: "weak_failed",
      };
    }
    return merged;
  }

  /** @type {Record<string, unknown>} */ (merged).projectInformation = {
    ...(priorPi && typeof priorPi === "object" ? priorPi : {}),
    ...(scrapedPi && typeof scrapedPi === "object" ? scrapedPi : {}),
    label: "Project Information",
    fields: scrapedFields.map((f) => ({
      label: `${f.label || ""}`.trim(),
      value: `${f.value ?? ""}`.trim().slice(0, 2000),
    })),
    extractionStatus: "ok",
  };

  const ps =
    /** @type {Record<string, unknown>} */ (merged)?.plansAndDocuments?.sections
      ?.planSetDocuments?.documents;
  const rr =
    /** @type {Record<string, unknown>} */ (merged)?.reviewResultsAndMarkups
      ?.documents;
  const ad =
    /** @type {Record<string, unknown>} */ (merged)?.approvedDocuments?.documents;
  console.log(
    `[Arlington][ProjectInfo] selective projectInformation merge applied preservedPlanSet=${Array.isArray(ps) ? ps.length : 0} preservedReviewResults=${Array.isArray(rr) ? rr.length : 0} preservedApproved=${Array.isArray(ad) ? ad.length : 0}`,
  );
  console.log(
    "[Arlington][ProjectInfo] projectInformation-only update: preserving all out-of-scope tabs",
  );
  const get = (label) => {
    const f = (/** @type {Record<string, unknown>} */ (merged).projectInformation
      ?.fields || []).find(
      (row) => `${/** @type {Record<string, unknown>} */ (row).label || ""}`.trim() === label,
    );
    return `${/** @type {Record<string, unknown>} */ (f)?.value ?? ""}`.trim();
  };
  const finalFields =
    /** @type {{ label: string; value: string }[]} */ (
      /** @type {Record<string, unknown>} */ (merged).projectInformation?.fields
    ) || [];
  const valid = !arlingtonProjectInformationExtractionIsWeak(
    finalFields,
    permitNumber,
  );
  console.log(
    `[Arlington][ProjectInfo] final valid=${valid} Project ID=${get("Project ID")} Accela CAP ID=${get("Accela CAP ID")} Address=${get("Address")} Review Type=${get("Review Type")}`,
  );
  return merged;
}

/** @param {unknown} priorPortalData */
function arlingtonPriorProjectInformationFields(priorPortalData) {
  const tabs = /** @type {Record<string, unknown>} */ (
    priorPortalData || {}
  )?.tabs;
  if (!tabs || typeof tabs !== "object") return [];
  const pr = /** @type {Record<string, unknown>} */ (tabs).planReview;
  if (!pr || typeof pr !== "object") return [];
  const prTabs = /** @type {Record<string, unknown>} */ (pr).tabs;
  if (!prTabs || typeof prTabs !== "object") return [];
  const pi = /** @type {Record<string, unknown>} */ (prTabs).projectInformation;
  if (!pi || typeof pi !== "object") return [];
  const fields = /** @type {Record<string, unknown>} */ (pi).fields;
  return Array.isArray(fields) ? fields : [];
}

/**
 * Pull PI fields from a frame document (UnityForm / Hyland readonly disabled inputs).
 * @param {import("playwright").Frame | null | undefined} frame
 * @returns {Promise<{ label: string, value: string, sourceTab?: string }[]>}
 */
async function extractArlingtonProjectInformationFieldsFromFrame(frame, permitNumber) {
  if (!frame || typeof frame.evaluate !== "function") {
    return { fields: [], panelFound: false };
  }

  const permitHint = `${permitNumber || ""}`.trim();

  try {
    const permitBaseArg = normalizeArlingtonBaseProjectId(permitHint);
    /** @type {unknown} */
    const raw = await frame.evaluate(
      ({ permitArg, permitBase }) => {
      const wanted = [
        "Project ID",
        "Plan Review Project Name",
        "Accela CAP ID",
        "Address",
        "Review Type",
        "CPHD Case #",
      ];

      const norm = (s) =>
        `${s ?? ""}`.trim().replace(/\s+/g, " ");

      const labelKey = (s) =>
        norm(s)
          .replace(/:$/, "")
          .toLowerCase();

      const wantedKeys = new Map(wanted.map((w) => [labelKey(w), w]));

      const isWantedLabel = (text) => {
        const k = labelKey(text);
        return wantedKeys.has(k) ? wantedKeys.get(k) : null;
      };

      const REV_SUFFIX = /-(?:RA|REN|RB)\d+$/i;
      const normalizeBase = (s) => `${s || ""}`.trim().replace(REV_SUFFIX, "");
      const projectIdMatchesPermit = (pid) => {
        const p = norm(pid);
        const permit = `${permitArg || ""}`.trim();
        if (!p) return false;
        if (!permit) return p !== "0";
        if (p.toUpperCase() === permit.toUpperCase()) return true;
        return (
          normalizeBase(p).toUpperCase() === normalizeBase(permit).toUpperCase()
        );
      };

      const isProjectGroupSelect = (el) => {
        if (!(el instanceof HTMLSelectElement)) return false;
        const idName = `${el.id || ""} ${el.name || ""}`.toLowerCase();
        return idName.includes("projectgroup");
      };

      const looksLikeAddressDropdownList = (value) => {
        const v = norm(value);
        if (!v) return false;
        if (/^<none>/i.test(v)) return true;
        if (
          /\b40 N GLEBE RD\b/i.test(v) &&
          (/\b4500 31ST ST S\b/i.test(v) || /\b4505 31ST ST S\b/i.test(v))
        ) {
          return true;
        }
        if (
          /\b4500 31ST ST S\b/i.test(v) &&
          /\b4505 31ST ST S\b/i.test(v) &&
          /\b4834 LANGSTON BLVD\b/i.test(v)
        ) {
          return true;
        }
        const streets =
          v.match(
            /\b\d{3,5}\s+[A-Z0-9 .]+(?:ST|AVE|BLVD|RD|DR|LN|WAY|CT|PL)\b/gi,
          ) || [];
        return streets.length >= 2 && v.length > 40;
      };

      const isRejectedValue = (label, value) => {
        const v = norm(value);
        if (!v) return true;
        if (/^<none>/i.test(v)) return true;
        if (looksLikeAddressDropdownList(v)) return true;
        if (label === "Project ID" && (v === "0" || !/[A-Za-z0-9-]/.test(v))) {
          return true;
        }
        if (
          (label === "Review Type" || label === "Accela CAP ID") &&
          /\b40 n glebe rd\b/i.test(v.toLowerCase())
        ) {
          return true;
        }
        if (
          label === "Review Type" &&
          !/^\d{1,6}$/.test(v) &&
          /\b(st|ave|blvd|rd|dr)\b/i.test(v)
        ) {
          return true;
        }
        if (
          label === "Accela CAP ID" &&
          !/\d{2}REC-\d+-\w+/i.test(v) &&
          v.length < 10
        ) {
          return true;
        }
        if (
          (label === "Plan Review Project Name" || label === "Address") &&
          /^<none>\s+\d/i.test(v)
        ) {
          return true;
        }
        if (label === "Project ID" && `${permitArg || ""}`.trim()) {
          return !projectIdMatchesPermit(v);
        }
        return false;
      };

      /** Resolve visible Project Information panel only — reject project-group shells. */
      function resolveProjectInformationPanel() {
        /** @type {HTMLElement[]} */
        const candidates = [];
        for (const sel of [
          '[id*="ProjectInformation" i]',
          '[class*="ProjectInformation" i]',
          ".unity-form",
          ".UnityForm",
        ]) {
          try {
            candidates.push(
              .../** @type {HTMLElement[]} */ ([
                ...document.querySelectorAll(sel),
              ]),
            );
          } catch (_) {
            /**/
          }
        }
        let best = null;
        let bestScore = 0;
        for (const el of candidates) {
          if (!(el instanceof HTMLElement)) continue;
          const text = norm(el.innerText || el.textContent || "");
          if (!/Project Information/i.test(text)) continue;
          if (!/\bProject ID\b/i.test(text)) continue;
          if (!/\bAccela CAP ID\b/i.test(text)) continue;
          const pgSelect = el.querySelector(
            'select[id*="projectgroup" i], select[name*="projectgroup" i], select[name*="ProjectGroup" i]',
          );
          if (pgSelect instanceof HTMLSelectElement) {
            const optText = [...(pgSelect.options || [])]
              .map((o) => norm(o.textContent || o.label || ""))
              .join(" ");
            if (looksLikeAddressDropdownList(optText)) continue;
          }
          const score =
            (/\bPlan Review Project Name\b/i.test(text) ? 15 : 0) +
            (/\bReview Type\b/i.test(text) ? 10 : 0) +
            el.querySelectorAll(
              'input:not([type="button"]):not([type="submit"]):not([type="image"]), textarea',
            ).length;
          if (score > bestScore) {
            bestScore = score;
            best = el;
          }
        }
        return best;
      }

      let panel = resolveProjectInformationPanel();
      if (!panel) {
        const body = document.body;
        const bodyText = norm(body?.innerText || body?.textContent || "");
        if (
          body &&
          /Project Information/i.test(bodyText) &&
          /\bProject ID\b/i.test(bodyText) &&
          /\bAccela CAP ID\b/i.test(bodyText)
        ) {
          panel = body;
        }
      }
      if (!panel) {
        return {
          panelFound: false,
          bodyLen: 0,
          labelMapCandidates: [],
          rejected: [],
          fields: wanted.map((label) => ({
            label,
            value: "",
            sourceTab: "projectInformation",
          })),
        };
      }

      /** @type {(el?: Element | null, sourceHint?: string) => string} */
      const readControlValue = (el, sourceHint) => {
        if (!el || !(el instanceof Element)) return "";
        if (el instanceof HTMLSelectElement) {
          if (isProjectGroupSelect(el)) return "";
          const opt = el.selectedOptions?.[0];
          return norm(
            `${opt?.textContent || opt?.value || el.value || ""}`,
          );
        }
        const tag = `${el.tagName || ""}`.toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA") {
          const inp = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el);
          return norm(
            `${inp.value || inp.defaultValue || inp.getAttribute("value") || ""}`,
          );
        }
        return norm(el.getAttribute?.("value") || "");
      };

      const controlSelector =
        'input:not([type="button"]):not([type="submit"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]), textarea, select';

      /** @type {(labelEl: Element) => { value: string; source: string }} */
      function findValueNearLabel(labelEl) {
        if (!(labelEl instanceof Element)) return { value: "", source: "" };
        const labelText = isWantedLabel(
          norm(labelEl.innerText || labelEl.textContent || "").replace(/:$/, ""),
        );
        if (!labelText) return { value: "", source: "" };

        const forId = labelEl.getAttribute?.("for");
        if (
          forId &&
          typeof CSS !== "undefined" &&
          typeof CSS.escape === "function"
        ) {
          try {
            const byFor = panel.querySelector(`#${CSS.escape(forId)}`);
            const v = readControlValue(byFor, `#${forId}`);
            if (v && !isRejectedValue(labelText, v)) {
              return { value: v, source: `#${forId}` };
            }
          } catch (_) {
            /**/
          }
        }

        const containers = [
          labelEl.closest("tr"),
          labelEl.closest(".form-group"),
          labelEl.closest(".row"),
          labelEl.closest("li"),
          labelEl.parentElement,
          labelEl.parentElement?.parentElement,
        ].filter(Boolean);

        for (const container of containers) {
          if (!container) continue;
          const controls = [
            ...container.querySelectorAll(controlSelector),
          ].filter(
            (c) =>
              !(c instanceof HTMLSelectElement && isProjectGroupSelect(c)),
          );
          const preferred = controls.filter((c) => {
            if (c instanceof HTMLSelectElement) return true;
            if (
              c instanceof HTMLInputElement ||
              c instanceof HTMLTextAreaElement
            ) {
              return c.disabled || c.readOnly || c.hasAttribute("readonly");
            }
            return true;
          });
          const scan = preferred.length ? preferred : controls;
          for (const c of scan) {
            const idPart = `${c.id || c.getAttribute("name") || c.tagName}`.trim();
            const v = readControlValue(c, idPart);
            if (v && !isRejectedValue(labelText, v)) {
              return { value: v, source: idPart || "near_label" };
            }
            if (v) rejected.push(`${labelText}=${v}`);
          }
        }

        let seenLabel = false;
        for (const node of panel.querySelectorAll("*")) {
          if (node === labelEl) {
            seenLabel = true;
            continue;
          }
          if (!seenLabel) continue;
          if (!node.matches?.(controlSelector)) continue;
          if (node instanceof HTMLSelectElement) continue;
          const idPart = `${node.id || node.getAttribute("name") || "next_control"}`.trim();
          const v = readControlValue(node, idPart);
          if (v && !isRejectedValue(labelText, v)) {
            return { value: v, source: idPart };
          }
          if (v) rejected.push(`${labelText}=${v}`);
          break;
        }

        const next = labelEl.nextElementSibling;
        if (next instanceof HTMLSelectElement) {
          return { value: "", source: "" };
        }
        const direct = readControlValue(next, "next_sibling");
        if (direct && !isRejectedValue(labelText, direct)) {
          return { value: direct, source: "next_sibling" };
        }
        const nextControl = next?.querySelector?.(controlSelector);
        if (nextControl instanceof HTMLSelectElement) {
          return { value: "", source: "" };
        }
        const nested = readControlValue(nextControl, "next_nested");
        if (nested && !isRejectedValue(labelText, nested)) {
          return { value: nested, source: "next_nested" };
        }
        return { value: "", source: "" };
      }

      /** @type {Map<string, string>} */
      const mapped = new Map();
      /** @type {Map<string, string>} */
      const mappedSource = new Map();
      /** @type {{ label: string; value: string; source: string }[]} */
      const labelMapCandidates = [];
      /** @type {string[]} */
      const rejected = [];

      for (const label of wanted) {
        const labelEl = [
          ...panel.querySelectorAll("label, span, td, th, p, strong, b"),
        ].find((el) => {
          const t = norm(
            el.innerText || /** @type {string} */ (el.textContent || ""),
          ).replace(/:$/, "");
          return t === label || labelKey(t) === labelKey(label);
        });
        const pair = labelEl ? findValueNearLabel(labelEl) : { value: "", source: "missing_label" };
        labelMapCandidates.push({
          label,
          value: pair.value,
          source: pair.source || (labelEl ? "label_pair" : "missing_label"),
        });
        if (pair.value && !isRejectedValue(label, pair.value)) {
          mapped.set(label, pair.value);
          mappedSource.set(label, pair.source || "label_pair");
        } else if (pair.value) {
          rejected.push(`${label}=${pair.value}`);
        }
      }

      const rtHidden = panel.querySelector(
        '#ProjectData_ReviewTypeID, input[name="ProjectData.ReviewTypeID"], input[id*="ReviewTypeID" i][type="hidden"]',
      );
      if (rtHidden instanceof HTMLInputElement) {
        const rtVal = readControlValue(rtHidden, "ProjectData_ReviewTypeID");
        if (rtVal && !isRejectedValue("Review Type", rtVal)) {
          mapped.set("Review Type", rtVal);
          mappedSource.set("Review Type", "ProjectData_ReviewTypeID");
        } else if (rtVal) {
          rejected.push(`Review Type=${rtVal}`);
        }
      }

      for (const row of panel.querySelectorAll("tr")) {
        const cells = [...row.querySelectorAll("td, th")];
        if (cells.length < 2) continue;
        for (let i = 0; i < cells.length - 1; i++) {
          const labelText = norm(
            cells[i].innerText || cells[i].textContent || "",
          ).replace(/:$/, "");
          const canonical = isWantedLabel(labelText);
          if (!canonical || mapped.has(canonical)) continue;
          for (const c of cells[i + 1].querySelectorAll(controlSelector)) {
            if (c instanceof HTMLSelectElement && isProjectGroupSelect(c)) {
              continue;
            }
            const idPart = `${c.id || c.getAttribute("name") || "table_cell"}`.trim();
            const v = readControlValue(c, idPart);
            if (v && !isRejectedValue(canonical, v)) {
              mapped.set(canonical, v);
              mappedSource.set(canonical, `table:${idPart}`);
              labelMapCandidates.push({
                label: canonical,
                value: v,
                source: `table:${idPart}`,
              });
              break;
            }
            if (v) rejected.push(`${canonical}=${v}`);
          }
        }
      }

      /** @type {{ label: string; value: string; sourceTab: string }[]} */
      const fields = wanted.map((label) => ({
        label,
        value: mapped.get(label) || "",
        sourceTab: "projectInformation",
      }));

      const addrVal = mapped.get("Address") || "";
      const nameVal = mapped.get("Plan Review Project Name") || "";
      const cphdIdx = fields.findIndex((f) => f.label === "CPHD Case #");
      if (cphdIdx >= 0) {
        const cphdVal = `${fields[cphdIdx].value || ""}`.trim();
        if (
          cphdVal &&
          (cphdVal === addrVal || cphdVal === nameVal)
        ) {
          fields[cphdIdx] = { ...fields[cphdIdx], value: "" };
        }
      }

      return {
        panelFound: true,
        bodyLen: norm(panel.innerText || panel.textContent || "").length,
        labelMapCandidates,
        rejected,
        fields,
      };
    },
      { permitArg: permitHint, permitBase: permitBaseArg },
    );

    const payload =
      raw && typeof raw === "object"
        ? /** @type {{ panelFound?: boolean; bodyLen?: number; labelMapCandidates?: unknown[]; rejected?: string[]; fields?: { label: string; value: string }[] }} */ (
            raw
          )
        : { fields: Array.isArray(raw) ? raw : [] };

    if (payload.panelFound === true) {
      console.log("[Arlington][ProjectInfo] visible Project Information panel found");
    }
    for (const rej of payload.rejected || []) {
      console.log(`[Arlington][ProjectInfo] rejected global dropdown value=${rej}`);
    }

    const domFields = Array.isArray(payload.fields) ? payload.fields : [];
    let fields = domFields;
    let extractionSource = "domMapper";

    if (arlingtonProjectInformationExtractionIsWeak(domFields, permitHint)) {
      console.log(
        "[Arlington][ProjectInfo] DOM mapper weak; trying Unity text fallback",
      );
      const bodyText = await frame
        .evaluate(() => {
          const norm = (s) =>
            `${s ?? ""}`.trim().replace(/\s+/g, " ");
          return norm(
            document.body?.innerText || document.body?.textContent || "",
          );
        })
        .catch(() => "");

      if (bodyText) {
        const parsed = extractArlingtonProjectInfoFromUnityText(
          bodyText,
          permitHint,
        );
        if (
          arlingtonProjectInformationUnityTextExtractionIsValid(
            parsed,
            permitHint,
          )
        ) {
          fields = arlingtonProjectInfoUnityTextToFields(parsed);
          extractionSource = "unityTextFallback";
          console.log(
            `[Arlington][ProjectInfo] unity text fallback extracted Project ID=${parsed.projectId} Accela CAP ID=${parsed.accelaCapId} Address=${parsed.address} Review Type=${parsed.reviewType}`,
          );
        }
      }
    }

    const get = (label) =>
      `${fields.find((f) => f.label === label)?.value ?? ""}`.trim();
    const valid = !arlingtonProjectInformationExtractionIsWeak(
      fields,
      permitHint,
    );
    console.log(
      `[Arlington][ProjectInfo] final valid=${valid} source=${extractionSource} Project ID=${get("Project ID")} Accela CAP ID=${get("Accela CAP ID")} Address=${get("Address")} Review Type=${get("Review Type")}`,
    );
    for (const f of fields) {
      if (!f || !f.label) continue;
      const src =
        extractionSource === "unityTextFallback"
          ? "unityTextFallback"
          : payload.labelMapCandidates?.find((c) => c?.label === f.label)
              ?.source || "mapped";
      console.log(
        `[Arlington][ProjectInfo] field ${`${f.label}`.trim()}=${`${f.value != null ? f.value : ""}`.trim()} source=${src}`,
      );
    }
    return {
      fields,
      panelFound:
        payload.panelFound === true &&
        fields.some((f) => `${f?.value ?? ""}`.trim().length > 0),
    };
  } catch (_) {
    return { fields: [], panelFound: false };
  }
}

/**
 * PI fields from resolved ERMS panel (labels + inputs, table, dl).
 * Kept for narrow panel-scoped reads; Plan Review merge uses {@link extractArlingtonProjectInformationFieldsFromFrame}.
 * @param {import("playwright").ElementHandle | null} panelHandle
 * @returns {Promise<{ label: string, value: string }[]>}
 */
async function extractArlingtonProjectInformationFieldsFromPanel(panelHandle) {
  if (
    !panelHandle ||
    typeof panelHandle.evaluate !== "function"
  ) {
    return [];
  }

  try {
    const raw = await panelHandle.evaluate((panelRootArg) => {
      const panel =
        panelRootArg instanceof Element
          ? /** @type {Element} */ (panelRootArg)
          : null;
      if (!panel) return [];

      const norm = (s) => (s || "").trim().replace(/\s+/g, " ");

      const wanted = [
        "Project ID",
        "Plan Review Project Name",
        "Accela CAP ID",
        "Address",
        "Review Type",
        "CPHD Case #",
      ];

      /** @type {(el?: Element | null) => string} */
      const readValue = (el) => {
        if (!el) return "";
        const tag = `${el.tagName || ""}`.toUpperCase();
        if (tag === "SELECT") {
          const sel = /** @type {HTMLSelectElement} */ (el);
          const selectedText = sel.selectedOptions?.[0]?.textContent?.trim();
          if (selectedText && selectedText !== "<None>")
            return norm(selectedText);
        }
        if (
          "value" in el &&
          /** @type {HTMLInputElement} */ (el).value != null
        ) {
          return norm(
            `${/** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */ (el).value}`,
          );
        }
        return norm(
          el.getAttribute?.("value") || el.innerText || el.textContent || "",
        );
      };

      /** @type {(labelEl?: Element | null) => string} */
      function findValueNearLabel(labelEl) {
        if (!(labelEl instanceof Element)) return "";

        const forId = labelEl.getAttribute?.("for");
        if (
          forId &&
          typeof CSS !== "undefined" &&
          typeof CSS.escape === "function"
        ) {
          try {
            const byFor = panel.querySelector(`#${CSS.escape(forId)}`);
            const v = readValue(byFor);
            if (v) return v;
          } catch (_) {
            /**/
          }
        }

        const containers = [
          labelEl.closest("tr"),
          labelEl.closest(".form-group"),
          labelEl.closest(".row"),
          labelEl.closest("li"),
          labelEl.parentElement,
          labelEl.parentElement?.parentElement,
        ].filter(Boolean);

        for (const container of containers) {
          if (!container) continue;
          const controls = [
            ...container.querySelectorAll("input, textarea, select"),
          ];
          for (const c of controls) {
            const v = readValue(c);
            if (v) return v;
          }

          const textPieces = [...container.querySelectorAll("span, div, td")]
            .map((x) =>
              norm(x.innerText || /** @type {string} */ (x.textContent || "")),
            )
            .filter(Boolean);

          const labelText = norm(
            labelEl.innerText ||
              /** @type {string} */ (labelEl.textContent || ""),
          ).replace(/:$/, "");

          const nonLabel = textPieces.find((t) => {
            const tr = t.replace(/:$/, "");
            return (
              t !== labelText &&
              !wanted.some(
                (w) =>
                  w === tr ||
                  w.toLowerCase() === `${tr || ""}`.toLowerCase(),
              )
            );
          });
          if (nonLabel) return nonLabel;
        }

        const next = labelEl.nextElementSibling;
        const direct = readValue(next);
        if (
          direct &&
          !wanted.includes(direct.replace(/:$/, "")) &&
          !wanted.find(
            (w) =>
              w.toLowerCase() === direct.replace(/:$/, "").toLowerCase(),
          )
        ) {
          return direct;
        }

        const nextControl = next?.querySelector?.(
          "input, textarea, select",
        );
        return readValue(nextControl);
      }

      /** @type {{ label: string; value: string; sourceTab: string }[]} */
      const fields = [];

      for (const label of wanted) {
        const labelEl = [...panel.querySelectorAll("label, span, div, td, th")]
          /** @returns {boolean} */
          .find((el) => {
            const t = norm(
              el.innerText || /** @type {string} */ (el.textContent || ""),
            ).replace(/:$/, "");
            return t === label || t.toLowerCase() === label.toLowerCase();
          });

        const value = labelEl ? findValueNearLabel(labelEl) : "";

        fields.push({
          label,
          value,
          sourceTab: "projectInformation",
        });
      }

      const setIfEmpty = (label, value) => {
        const f = fields.find((x) => x.label === label);
        const v = norm(value);
        if (f && !`${f.value || ""}`.trim() && v) f.value = v;
      };

      const getVal = (label) => {
        const f = fields.find((x) => x.label === label);
        return f ? `${f.value || ""}`.trim() : "";
      };

      const rtHidden = readValue(
        (panel.ownerDocument || document).getElementById("ProjectData_ReviewTypeID"),
      );
      if (rtHidden && /^\d{1,6}$/.test(rtHidden)) {
        const f = fields.find((x) => x.label === "Review Type");
        if (f && !`${f.value || ""}`.trim()) f.value = rtHidden;
      }

      return fields;
    });
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
}

/**
 * @deprecated Use extractArlingtonProjectInformationFieldsFromPanel with resolved active panel handle.
 */
async function extractArlingtonProjectInformationFieldsFromVisiblePanel(
  domTarget,
) {
  const raw = await domTarget
    .evaluate(() => {
      const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
      function pickActiveTabPanelRoot() {
        const panels = [
          ...document.querySelectorAll(
            '.ui-tabs-panel, [role="tabpanel"], .tab-content',
          ),
        ];
        const cand = [];
        for (const p of panels) {
          try {
            const el = /** @type {HTMLElement} */ (p);
            if (el.classList.contains("ui-tabs-hide")) continue;
            if (
              `${el.getAttribute("aria-hidden") || ""}`.toLowerCase() ===
              "true"
            )
              continue;
            const st = getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.height < 8 || r.width < 16) continue;
            cand.push(el);
          } catch (_) {
            /**/
          }
        }
        cand.sort((a, b) => {
          try {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          } catch (_) {
            return 0;
          }
        });
        return cand[0] || /** @type {HTMLElement | null} */ (document.body);
      }

      let root = pickActiveTabPanelRoot();
      if (!root) root = /** @type {HTMLElement} */ (document.body);
      const fields = [];
      root.querySelectorAll("table tr").forEach((tr) => {
        const th = tr.querySelector("th");
        const td = tr.querySelector("td");
        if (th && td) {
          const label = norm(th.innerText);
          const value = norm(td.innerText);
          if (label && value) fields.push({ label, value });
        }
      });
      root.querySelectorAll("dl").forEach((dl) => {
        const dts = [...dl.querySelectorAll("dt")];
        const dds = [...dl.querySelectorAll("dd")];
        for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
          const label = norm(dts[i].innerText);
          const value = norm(dds[i].innerText);
          if (label) fields.push({ label, value });
        }
      });
      return fields;
    })
    .catch(() => []);
  return Array.isArray(raw) ? raw : [];
}

async function arlingtonIntegratedReadRowCells(rowHandle) {
  return rowHandle.evaluate((tr) => {
    const cells = [...tr.querySelectorAll("td, th")];
    const parts = cells.map((c) =>
      (c.textContent || "").replace(/\s+/g, " ").trim(),
    );
    const rawText = parts.join(" | ").trim();
    return { parts, rawText };
  });
}

async function scrapeArlingtonPlanIntegratedGrid(opts) {
  const {
    page,
    logLabel,
    sourceTabCamel,
    sourceSectionCamel,
    docsSink,
    attachmentDedupeKeys,
    prSeenRowKeys,
    downloadedHashes,
    downloadCtx,
    iframeDownloadsDisabled,
  } = opts;

  const fr = await pickArlingtonIntegratedContentFrame(page);
  if (!fr) {
    console.log(
      `[Arlington][Plan Review] ${logLabel}: no integrated frame matched`,
    );
    return { rowCount: 0, downloads: 0 };
  }
  await page.waitForTimeout(350).catch(() => {});

  const rowHandles =
    (await fr.$$('table tbody tr, table[class*="Grid"] tr, table tr').catch(
      () => [],
    )) || [];
  /** @type {import('playwright').ElementHandle[]} */
  const dataRows = [];
  for (const rh of rowHandles) {
    const onlyTh = await rh.evaluate((tr) => {
      const cells = [...tr.querySelectorAll("th, td")];
      return (
        cells.length > 0 &&
        cells.every((c) =>
          /^th$/i.test(c.tagName) ||
          (cells.length <= 12 && /^\s*name\b/i.test(
            String(c.textContent || ""),
          )),
        )
      );
    }).catch(() => false);
    if (onlyTh) continue;
    const cellCount =
      parseInt(await rh.evaluate((tr) => tr.querySelectorAll("td").length).catch(() => "0"),
        10) || 0;
    if (!cellCount) continue;
    dataRows.push(rh);
  }

  const scanned = Math.min(dataRows.length, 120);

  if (iframeDownloadsDisabled) {
    console.log(
      `[Arlington][Plan Review] ${logLabel} rows=${scanned} (integrated iframe downloads disabled — row scan skipped)`,
    );
    return { rowCount: scanned, downloads: 0 };
  }

  let downloads = 0;
  const slice = dataRows.slice(0, Math.min(dataRows.length, 120));
  for (const rh of slice) {
    const { parts } = await arlingtonIntegratedReadRowCells(rh);
    const rowMeta = arlingtonIntegratedHeuristicMeta(parts);

    /** skip empty stubs */
    if (!rowMeta.name && parts.length < 2) continue;

    const docMeta = rowMeta.name
      ? rowMeta
      : { ...rowMeta, name: parts.join("|").slice(0, 260) };

    const docObj = await tryArlingtonIntegratedRowDownload(
      page,
      rh,
      docMeta,
      sourceTabCamel,
      sourceSectionCamel,
      attachmentDedupeKeys,
      prSeenRowKeys,
      downloadedHashes,
      downloadCtx,
    );

    if (docObj) {
      if (
        docObj.publicUrl ||
        /^(uploaded|success)$/i.test(String(docObj.downloadStatus || ""))
      ) {
        downloads++;
      }
      docsSink.push(docObj);
    }
  }
  console.log(
    `[Arlington][Plan Review] ${logLabel} rows=${slice.length} downloads=${downloads}`,
  );
  return { rowCount: slice.length, downloads };
}




/** Arlington ERMS portal — authenticated off Accela (not `#tab-custom_component`). */
function arlingtonExternalPlanReviewHrefLooksValid(absHref) {
  const low = `${absHref || ""}`.toLowerCase().trim();
  if (!/^https?:\/\//i.test(low)) return false;
  if (!/prd-ermsaccela/i.test(low) || !/planreview/i.test(low)) return false;
  if (/aca-prod\.accela\.com/i.test(low) || /capdetail\.aspx/i.test(low))
    return false;
  return true;
}

async function scrapeArlingtonExternalPlanHrefFromRoot(root) {
  if (!root || typeof root.evaluate !== "function") return "";
  try {
    return (
      `${await root.evaluate(() => {
        function resolveAbs(raw) {
          if (!raw) return "";
          const s = `${raw}`.trim();
          if (!s || s.startsWith("#")) return "";
          try {
            return new URL(s, document.baseURI || location.href).href;
          } catch (_) {
            return s;
          }
        }
        function pickPlanReviewUrl(hRaw) {
          const abs = resolveAbs(hRaw);
          const low = abs.toLowerCase();
          if (
            !abs ||
            !/prd-ermsaccela/i.test(low) ||
            !/planreview/i.test(low) ||
            /aca-prod\.accela\.com/i.test(low) ||
            /capdetail\.aspx/i.test(low)
          )
            return "";
          return abs;
        }

        const byId = document.querySelector(
          "#ctl00_PlaceHolderMain_lnkLink4MoreInfo",
        );
        const fromId = pickPlanReviewUrl(byId && byId.getAttribute("href"));
        if (fromId) return fromId;

        const links = [...document.querySelectorAll("a[href]")];
        const preferred = [];
        for (const a of links) {
          const cls = `${a.className || ""}`;
          const href = `${a.getAttribute("href") || ""}`;
          if (cls.includes("external_link")) preferred.push(a);
          else if (
            /prd-ermsaccela/i.test(href) ||
            (/planreview/i.test(href) && /\.arlingtonva\.us/i.test(href))
          )
            preferred.push(a);
        }
        for (const a of preferred.length ? preferred : links) {
          const ok = pickPlanReviewUrl(a.getAttribute("href"));
          if (ok) return ok;
        }
        return "";
      }) || ""}`
    ).trim();
  } catch (_) {
    return "";
  }
}

async function findArlingtonExternalPlanReviewHref(page, extractionCtx) {
  const roots = [];
  const seen = new Set();
  const push = (r) => {
    if (!r || seen.has(r)) return;
    if (typeof r.evaluate !== "function") return;
    seen.add(r);
    roots.push(r);
  };

  push(page);
  push(page._recordFrame);
  if (extractionCtx && extractionCtx !== page) push(extractionCtx);

  for (const r of roots) {
    const h = await scrapeArlingtonExternalPlanHrefFromRoot(r).catch(() => "");
    if (h && arlingtonExternalPlanReviewHrefLooksValid(h)) return h;
  }
  return "";
}

async function waitForArlingtonPlanReviewViewDocumentsUrl(page, deadlineMs = 55000) {
  const needles = [
    /PlanReviewIntegrated\/plan\/ViewDocuments/i,
    /PlanReviewIntegrated\/Plan\/ViewDocuments/i,
  ];
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    let u = "";
    try {
      u = `${page.url() || ""}`;
    } catch (_) {
      /**/
    }
    if (needles.some((rx) => rx.test(u))) return true;
    await page.waitForTimeout(340).catch(() => {});
  }
  return false;
}

/**
 * Playwright locator for the Arlington external ERMS Plan Review link (Cap Detail).
 * @returns {Promise<import('playwright').Locator | null>}
 */
async function findArlingtonExternalPlanReviewLinkLocator(page, extractionCtx) {
  const roots = [];
  const seen = new Set();
  const push = (r) => {
    if (!r || seen.has(r)) return;
    if (typeof r.locator !== "function") return;
    seen.add(r);
    roots.push(r);
  };
  push(page);
  push(page._recordFrame);
  if (extractionCtx && extractionCtx !== page) push(extractionCtx);

  const baseUrl = (() => {
    try {
      return page.url() || "";
    } catch (_) {
      return "";
    }
  })();

  for (const root of roots) {
    const candidates = [
      root.locator("#ctl00_PlaceHolderMain_lnkLink4MoreInfo").first(),
      root.locator('a.external_link[href*="prd-ermsaccela"]').first(),
      root.locator('a[href*="prd-ermsaccela"]').first(),
      root.locator('a[href*="PlanReviewIntegrated" i]').first(),
    ];
    for (const lc of candidates) {
      const cnt = await lc.count().catch(() => 0);
      if (!cnt) continue;
      const href = await lc.getAttribute("href").catch(() => "");
      let abs = `${href || ""}`.trim();
      try {
        if (abs && baseUrl) abs = new URL(abs, baseUrl).href;
      } catch (_) {
        /**/
      }
      if (arlingtonExternalPlanReviewHrefLooksValid(abs)) return lc;
    }
  }
  return null;
}

/**
 * Click the external Plan Review link; handle new tab OR same-tab navigation to ViewDocuments.
 * @returns {Promise<{ prPage: import('playwright').Page | null, openedNewTab: boolean }>}
 */
async function openArlingtonErmsPlanReviewViaExternalClick(accPage, extractionCtx) {
  const linkLoc = await findArlingtonExternalPlanReviewLinkLocator(
    accPage,
    extractionCtx,
  );
  if (!linkLoc) {
    console.warn(
      "[Arlington][PlanReview] external Plan Review link element not found for click",
    );
    return { prPage: null, openedNewTab: false };
  }

  const context = accPage.context();
  const navPromise = accPage.waitForURL(
    /planreviewintegrated\/plan\/viewdocuments/i,
    { timeout: 45000 },
  );
  const popupPromise = context.waitForEvent("page", { timeout: 45000 });

  await linkLoc.click({ timeout: 60000 }).catch((e) => {
    console.warn(
      `[Arlington][PlanReview] external link click failed: ${e && e.message ? e.message : e}`,
    );
  });

  let prPage = null;
  let openedNewTab = false;
  try {
    prPage = await Promise.race([
      popupPromise.then((p) => {
        try {
          openedNewTab = true;
          console.log(
            "[Arlington][PlanReview] external link opens new page",
          );
        } catch (_) {
          /**/
        }
        return p;
      }),
      navPromise.then(() => accPage),
    ]);
  } catch (_) {
    /**/
  }

  if (!prPage) {
    try {
      const late = await popupPromise.catch(() => null);
      if (late) {
        prPage = late;
        openedNewTab = true;
        console.log(
          "[Arlington][PlanReview] external link opens new page (late)",
        );
      }
    } catch (_) {
      /**/
    }
  }

  if (!prPage) {
    try {
      const u = `${accPage.url() || ""}`;
      if (/planreviewintegrated\/plan\/viewdocuments/i.test(u)) prPage = accPage;
    } catch (_) {
      /**/
    }
  }

  if (!prPage) {
    return { prPage: null, openedNewTab: false };
  }

  await prPage.waitForLoadState("domcontentloaded").catch(() => {});
  return { prPage, openedNewTab };
}

/** Arlington ERMS base URL for resolving `ReturnUrl` from SignIn redirects. */
const ARLINGTON_ERMS_PUBLIC_ORIGIN =
  "https://prd-ermsaccela-az.arlingtonva.us";

/**
 * Wait for post-authentication redirect from SignIn to ViewDocuments, or navigate ReturnUrl.
 */
async function waitForArlingtonPlanReviewPastSignIn(prPage) {
  let u = "";
  try {
    u = prPage.url() || "";
  } catch (_) {
    return;
  }
  if (!/planreviewintegrated\/signin\/signin/i.test(u)) {
    return;
  }

  console.log("[Arlington][PlanReview] SignIn redirect detected");

  await Promise.race([
    prPage.waitForURL(/PlanReviewIntegrated\/plan\/ViewDocuments/i, {
      timeout: 60000,
    }),
    prPage.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return (
          !!document.querySelector("#divDocuments") ||
          /Plan Set Documents/i.test(text)
        );
      },
      { timeout: 60000 },
    ),
  ]).catch(() => {});

  let afterUrl = "";
  try {
    afterUrl = prPage.url() || "";
  } catch (_) {
    /**/
  }
  console.log(`[Arlington][PlanReview] after SignIn wait url=${afterUrl}`);

  let stuckOnSignIn = false;
  try {
    stuckOnSignIn = /planreviewintegrated\/signin\/signin/i.test(
      prPage.url() || "",
    );
  } catch (_) {
    stuckOnSignIn = false;
  }

  if (!stuckOnSignIn) return;

  let returnAbs = "";
  try {
    const parsed = new URL(prPage.url());
    const ret = parsed.searchParams.get("ReturnUrl");
    if (ret)
      returnAbs = new URL(ret, ARLINGTON_ERMS_PUBLIC_ORIGIN).href;
  } catch (_) {
    /**/
  }

  if (!returnAbs) return;

  console.log(
    `[Arlington][PlanReview] SignIn stuck; navigating ReturnUrl=${returnAbs}`,
  );
  await prPage
    .goto(returnAbs, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    .catch(() => {});

  await Promise.race([
    prPage.waitForURL(/PlanReviewIntegrated\/plan\/ViewDocuments/i, {
      timeout: 60000,
    }),
    prPage.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return (
          !!document.querySelector("#divDocuments") ||
          /Plan Set Documents/i.test(text)
        );
      },
      { timeout: 60000 },
    ),
  ]).catch(() => {});

  try {
    afterUrl = prPage.url() || "";
  } catch (_) {
    /**/
  }
  console.log(`[Arlington][PlanReview] after SignIn wait url=${afterUrl}`);
}

/**
 * @returns {Promise<boolean>}
 */
async function waitForArlingtonPlanReviewPrPageLoaded(prPage) {
  try {
    await prPage.waitForFunction(
      () => {
        const href = (location.href || "").toLowerCase();
        const bodyText = document.body?.innerText || "";
        return (
          href.includes("/planreviewintegrated/plan/viewdocuments") ||
          !!document.querySelector("#divDocuments") ||
          /Plan Set Documents/i.test(bodyText)
        );
      },
      { timeout: 45000 },
    );
  } catch (_) {
    return false;
  }

  let divDoc = false;
  let planSetText = false;
  try {
    const peek = await prPage.evaluate(() => ({
      div: !!document.querySelector("#divDocuments"),
      pst: /Plan Set Documents/i.test(document.body?.innerText || ""),
    }));
    divDoc = peek.div;
    planSetText = peek.pst;
  } catch (_) {
    /**/
  }
  console.log(
    `[Arlington][PlanReview] loaded: divDocuments=${divDoc} planSetText=${planSetText}`,
  );
  return true;
}

function mapArlingtonDomSecondaryTabRowToDoc(row, tabKey) {
  const doc = mapArlingtonDomPlanSetRowToDoc(row);
  doc.sourceTab = tabKey;
  doc.sourceSection =
    tabKey === "plansAndDocuments" ? "planSetDocuments" : tabKey;
  doc.source = row.source || `plan_review_${tabKey}`;
  if (row.reviewer) doc.reviewer = `${row.reviewer}`.trim();
  if (row.reviewStatus) doc.reviewStatus = `${row.reviewStatus}`.trim();
  if (row.documentType) doc.documentType = `${row.documentType}`.trim();
  if (row.documentDate) doc.documentDate = `${row.documentDate}`.trim();
  if (
    row.secondaryDomRowIndex != null &&
    `${row.secondaryDomRowIndex}` !== ""
  ) {
    doc.secondaryDomRowIndex = row.secondaryDomRowIndex;
  }
  if (
    tabKey !== "plansAndDocuments" &&
    !`${doc.publicUrl || doc.downloadUrl || ""}`.trim()
  ) {
    doc.status = "plan_review_secondary_row";
  }
  return doc;
}

function mapArlingtonDomPlanSetRowToDoc(row) {
  const name = `${row.name || ""}`.trim();
  const actRaw = row.action && typeof row.action === "object" ? row.action : {};
  /** @type {{ href?: string; onclick?: string; id?: string; title?: string; alt?: string; name?: string; documentId?: string }} */
  const action = {};
  const hRaw = `${actRaw.href ?? ""}`.trim();
  if (hRaw) action.href = hRaw.slice(0, 2000);
  const ocRaw = `${actRaw.onclick ?? ""}`.trim();
  if (ocRaw) action.onclick = ocRaw.slice(0, 4000);
  const idRaw = `${actRaw.id ?? ""}`.trim();
  if (idRaw) action.id = idRaw.slice(0, 500);
  const nameAttrRaw = `${actRaw.name ?? ""}`.trim();
  if (nameAttrRaw) action.name = nameAttrRaw.slice(0, 260);
  const documentIdRaw = `${actRaw.documentId ?? ""}`.trim();
  if (documentIdRaw && /^\d+$/.test(documentIdRaw)) {
    action.documentId = documentIdRaw.slice(0, 32);
  }
  if (!action.documentId) {
    const hay = [action.onclick, action.href, action.id, action.name]
      .filter(Boolean)
      .join("\n");
    const inf = arlingtonInferErmsPlanDocIdFromDomActionHaystack(hay);
    if (/^\d+$/.test(inf)) action.documentId = inf.slice(0, 32);
  }
  const titRaw = `${actRaw.title ?? ""}`.trim();
  if (titRaw) action.title = titRaw.slice(0, 800);
  const altRaw = `${actRaw.alt ?? ""}`.trim();
  if (altRaw) action.alt = altRaw.slice(0, 800);

  let publicUrl = "";
  let downloadUrl = "";
  if (/^https?:\/\//i.test(hRaw) && !/^javascript:/i.test(hRaw))
    downloadUrl = publicUrl = hRaw;

  const out = {
    name,
    filename: name,
    discipline: `${row.discipline || ""}`.trim(),
    sheetType: `${row.sheetType || ""}`.trim(),
    description: `${row.description || ""}`.trim(),
    revision: `${row.revision || ""}`.trim(),
    uploadStatus: `${row.uploadStatus || ""}`.trim(),
    documentDate: "",
    size: "",
    status: publicUrl ? "plan_set_has_url" : "plan_set_row",
    storagePath: "",
    publicUrl,
    downloadUrl,
    sourceTab: "plansAndDocuments",
    sourceSection: "planSetDocuments",
    source: row.source || "plan_review_plan_set_documents",
  };
  if (Object.keys(action).length) out.action = action;
  if (action.documentId) out.documentId = action.documentId;
  if (arlingtonPlanSetDocIsDeleteOnlyInactive(out)) {
    out.status = "plan_set_delete_only_inactive";
    out.downloadStatus = "inactive_delete_only";
    delete out.documentId;
  }
  return out;
}

/** QA row names that must appear in live Plans & Documents grid (LDAP23-00156). */
const ARLINGTON_PLAN_SET_QA_EXPECTED_NAMES = {
  "LDAP23-00156": [
    "045-0011 Arlington VA Deed of Easement Executed",
    "As-Built - Civil Set",
    "As-Built - Landscape Set",
    "Bioretention - ECS Construction Inspection Checklist",
    "Bioretention - Final Condition",
    "DC0750091_ARLINGTON COUNTY AS-BUILT_1-22-26_SIGNED",
    "Review Results Letter - 4834 LANGSTON BLVD - McDonald s (AS BUILT) (LDAP23-00156) - 3-23-2026",
    "Review Results Letter - 4834 LANGSTON BLVD - McDonald's",
  ],
};

const ARLINGTON_PLAN_SET_EXPECTED_ROW_COUNTS = {
  "LDAP23-00156": 89,
};

function arlingtonPlanSetMissingExpectedRowNames(collectedRows, permitNumber) {
  const expected =
    ARLINGTON_PLAN_SET_QA_EXPECTED_NAMES[`${permitNumber || ""}`.trim()] || [];
  if (!expected.length) return [];
  const have = new Set(
    (collectedRows || []).map((r) =>
      planReviewNormAttachmentName({
        name: `${r?.name ?? r?.filename ?? ""}`,
      }),
    ),
  );
  return expected.filter(
    (n) => !have.has(planReviewNormAttachmentName({ name: n })),
  );
}

function arlingtonLogPlanSetCollectionRowDebug(rows, permitNumber) {
  const permit = `${permitNumber || ""}`.trim();
  const expectedCount = ARLINGTON_PLAN_SET_EXPECTED_ROW_COUNTS[permit];
  if (expectedCount == null || rows.length === expectedCount) return;
  rows.forEach((r, i) => {
    const act = r?.action && typeof r.action === "object" ? r.action : {};
    const actionText = `${act.title || ""} ${act.alt || ""} ${act.onclick || ""} ${act.href || ""}`
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 240);
    const hasDownload =
      !!(`${act.documentId || ""}`.trim()) ||
      /browse|download|docaction/i.test(actionText);
    console.log(
      `[Arlington][PlanReview][ROW] index=${i} name=${r.name || ""} discipline=${r.discipline || ""} sheetType=${r.sheetType || ""} revision=${r.revision || ""} hasDownload=${hasDownload} actionText=${actionText}`,
    );
  });
  const missing = arlingtonPlanSetMissingExpectedRowNames(rows, permit);
  if (missing.length) {
    console.log(
      `[Arlington][PlanReview] missing expected names=${JSON.stringify(missing)}`,
    );
  }
}

/**
 * Live Plans & Documents grid under #divDocuments — portal list is source of truth.
 * @returns {Promise<object[]>}
 */
async function extractArlingtonPlanSetDocumentsFromPrPageDom(domTarget, opts) {
  const permitNumber =
    opts && typeof opts === "object"
      ? `${opts.permitNumber || ""}`.trim()
      : "";
  const arlingtonPlanSetRowStableKeyNode = (row) =>
    arlingtonPlanSetNameRevisionMergeKey(row);

  /** @param {number} passNum */
  const runCollectPass = (passNum) =>
    domTarget.evaluate((passNumIn) => {
      const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
      /** Section labels whose grids must never be scraped in Plan Set pass */
      const EXCLUDE_HEADING =
        /\b(Supporting Documents|Comment Response Letters|Review Results|Approved Documents|Project Information)\b/i;

      /** Reject phantom / header rows in the Plan Set sheet */
      function isRejectedName(nm) {
        const n = norm(nm);
        if (!n) return true;
        const low = n.toLowerCase();
        if (low === "document") return true;
        if (low === "name") return true;
        if (low === "document type") return true;
        if (/^sheet type\b$/i.test(n)) return true;
        if (/^(discipline|description|revision|upload status)$/i.test(n))
          return true;
        /** Full header line pasted into one column */
        if (
          /\bName\b.*\bDiscipline\b.*\bSheet Type\b.*\bDescription\b/i.test(n)
        ) {
          return true;
        }
        return false;
      }

      function extractRowAction(tr) {
        const dlInput =
          tr.querySelector('input.img-button.docaction[name]') ||
          tr.querySelector('input.docaction[name]');
        if (dlInput) {
          const nameAttr = `${dlInput.getAttribute("name") || ""}`.trim();
          if (/^\d+$/.test(nameAttr)) {
            return {
              documentId: nameAttr,
              title: `${dlInput.getAttribute("title") || ""}`.trim().slice(0, 800),
              alt: `${dlInput.getAttribute("alt") || ""}`.trim().slice(0, 800),
              href: "",
              onclick: "",
              id: `${dlInput.getAttribute("id") || ""}`.trim().slice(0, 500),
            };
          }
        }

        const nodes = [...tr.querySelectorAll("a, button, img, input, [onclick]")].filter((el) => {
          try {
            return !!(el.closest("td") || el.closest("th"));
          } catch (_) {
            return false;
          }
        });
        /** Prefer real links, then elements with actionable handlers */
        const scored = [];
        for (const el of nodes) {
          const tn = `${el.tagName || ""}`.toUpperCase();
          let href = `${el.getAttribute("href") || ""}`.trim();
          if (/^javascript:void/i.test(href) || /^#?$/.test(href)) href = "";
          const onclick = `${el.getAttribute("onclick") || ""}`.trim();
          const id = `${el.getAttribute("id") || ""}`.trim();
          const title = `${el.getAttribute("title") || ""}`.trim();
          let alt = "";
          if (tn === "IMG" || tn === "INPUT") {
            alt = `${el.getAttribute("alt") || ""}`.trim();
          }
          const role = `${el.getAttribute("role") || ""}`.trim();
          let score =
            (/^https?:\/\//i.test(href) ? 120 : 0) +
            (onclick ? 40 : 0) +
            (title ? 5 : 0) +
            (alt ? 5 : 0) +
            (id ? 3 : 0);
          const hayOn = `${title} ${alt} ${onclick} ${href}`.toLowerCase();
          if (/download|open|pdf|view|sheet/.test(hayOn)) score += 25;
          if (tn === "A" || tn === "BUTTON" || role === "button") score += 8;
          if (tn === "IMG" || tn === "INPUT") score += 4;
          if (href || onclick || id || title || alt)
            scored.push({
              score,
              href: href.slice(0, 2000),
              onclick: onclick.slice(0, 4000),
              id: id.slice(0, 500),
              title: title.slice(0, 800),
              alt: alt.slice(0, 800),
            });
        }
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best)
          return { href: "", onclick: "", id: "", title: "", alt: "" };
        const { score: _omit, ...action } = best;
        return action;
      }

      /**
       * Scroll container for virtualized / DataTables / jqGrid plan-set grids.
       * @param {HTMLTableElement | null} tableEl
       * @param {Element} scopeRoot
       * @returns {HTMLElement}
       */
      function resolveScrollEl(tableEl, scopeRoot) {
        const root =
          scopeRoot && scopeRoot.nodeType === 1 ? scopeRoot : document.body;
        const direct = root.querySelector(
          ".dataTables_scrollBody, .ui-jqgrid-bdiv",
        );
        if (
          direct &&
          direct instanceof HTMLElement &&
          direct.scrollHeight > direct.clientHeight + 4
        )
          return direct;

        /** @type {HTMLElement | null} */
        let el = tableEl instanceof HTMLElement ? tableEl : null;
        for (let i = 0; i < 26 && el; i++) {
          try {
            const st = window.getComputedStyle(el);
            const oy = st.overflowY;
            if (
              (oy === "auto" || oy === "scroll" || oy === "overlay") &&
              el.scrollHeight > el.clientHeight + 4
            )
              return el;
          } catch (_) {
            /**/
          }
          el = el.parentElement;
        }

        /** @type {HTMLElement | undefined} */
        const docElm = /** @type {HTMLElement | undefined} */ (
          document.scrollingElement || document.documentElement
        );
        return docElm || document.documentElement;
      }

      /**
       * Broad fallback when tabpanel-scoped grid misses real sheet rows: scan every
       * `tr` under `#divDocuments`, keep rows matching Arlington Plan Set patterns.
       */
      function fallbackExtractPlanSetRows(container) {
        const SECTION_HDR =
          /^(Supporting Documents|Comment Response Letters|Plan Set Documents|Approved Documents|Review Results)$/i;
        const DISC_RE =
          /\b(Architectural|Forms\s+and\s+Letters|Civil|Structural|Electrical|Mechanical|Plumbing|MEP|Survey|Landscape|Geotechnical|Gas|LDA)\b/i;
        const SHEET_RE =
          /\b(Construction\s+Plans|Proposed\s+Plat\/Site\s+Plan|Statement\s+of|Site\s+Plan|Grading|Cover\s+Sheet|As-Built|Bioretention|Deed\s+of\s+Easement|Review\s+Results\s+Letter)\b/i;
        const REV_RE = /^\d{1,4}$/;

        const allTr = [...container.querySelectorAll("tr")];
        const candidates = allTr.filter((tr) => {
          if (!tr.querySelector("td")) return false;
          const t = norm(tr.innerText);
          return t.length >= 2;
        });

        const rows = [];
        const seen = new Set();
        for (const tr of candidates) {
          const text = norm(tr.innerText);
          if (SECTION_HDR.test(text.trim())) continue;

          const cells = [...tr.querySelectorAll("td")].map((td) =>
            norm(td.innerText),
          );
          if (cells.length < 2) continue;

          const joinedHdr = cells
            .map((c) => c.toLowerCase())
            .join("|")
            .slice(0, 200);
          if (
            /\bname\b.*\bdiscipline\b.*\bsheet\b/i.test(joinedHdr) ||
            /^name\|/.test(joinedHdr)
          )
            continue;

        let name = "";
        for (const c of cells) {
          if (/^(C|L|A|S|P|M|E|G|H|RW)[-]?\d{3,4}\b/i.test(c)) {
            name = c;
            break;
          }
        }
        if (!name) {
          for (const c of cells) {
            if (/^\d{3,4}-\d{4}\b/.test(c)) {
              name = c;
              break;
            }
          }
        }
        if (!name) {
          for (const c of cells) {
            if (/^(C-|RW-)[0-9]/i.test(c)) {
              name = c;
              break;
            }
          }
        }
        if (!name) {
          for (const c of cells) {
            if (!c || c.length < 2) continue;
            if (REV_RE.test(c)) continue;
            if (/^n\/a$/i.test(c)) continue;
            if (/^(delete|browse|download|actions?)$/i.test(c)) continue;
            if (/^discipline$|^sheet type$|^upload status$/i.test(c)) continue;
            name = c;
            break;
          }
        }
        if (!name || isRejectedName(name)) {
          if (!rowHasPlanSetDownloadAction(tr)) continue;
          for (const c of cells) {
            if (!c || c.length < 2) continue;
            if (/^(delete|browse|download|actions?)$/i.test(c)) continue;
            name = c;
            break;
          }
        }
        if (!name || isRejectedName(name)) continue;

          let discipline = "";
          let sheetType = "";
          let revision = "";
          for (const c of cells) {
            if (c === name) continue;
            if (!discipline && DISC_RE.test(c)) discipline = c;
            else if (!sheetType && SHEET_RE.test(c)) sheetType = c;
            else if (!revision && REV_RE.test(c) && c !== name) revision = c;
          }

          const act = extractRowAction(tr);
          if (
            isDeleteOnlyPortalRow(tr, {
              action: act,
              name,
              discipline,
              sheetType,
              revision,
            })
          )
            continue;

          const aid = `${act.documentId || ""}`.trim();
          const key = `${name}|${discipline}|${sheetType}|${revision}|${aid}|${(act.onclick || "").slice(0, 92)}`;
          if (seen.has(key)) continue;
          seen.add(key);

          rows.push({
            name,
            discipline,
            sheetType,
            description: "",
            revision,
            uploadStatus: "",
            action: act,
            source: "plan_review_plan_set_documents",
          });
        }
        return { rows, candidateCount: candidates.length };
      }

      function rowHasPlanSetDownloadAction(tr) {
        const dlInput =
          tr.querySelector('input.img-button.docaction[name]') ||
          tr.querySelector("input.docaction[name]");
        if (dlInput) {
          const nameAttr = `${dlInput.getAttribute("name") || ""}`.trim();
          if (/^\d+$/.test(nameAttr)) return true;
          const title = `${dlInput.getAttribute("title") || ""}`.trim();
          const alt = `${dlInput.getAttribute("alt") || ""}`.trim();
          if (/browse|download/i.test(`${title} ${alt}`)) return true;
        }
        const tlow = norm(tr.innerText).toLowerCase();
        if (/browse\s*\.*\s*download|download\s*\.*\s*browse/.test(tlow))
          return true;
        return false;
      }

      function isDeleteOnlyPortalRow(tr, rowObj) {
        if (rowHasPlanSetDownloadAction(tr)) return false;
        const act =
          rowObj?.action && typeof rowObj.action === "object"
            ? rowObj.action
            : {};
        const actionText = `${act.title || ""} ${act.alt || ""} ${act.onclick || ""} ${act.href || ""} ${norm(tr.innerText)}`
          .replace(/\s+/g, " ");
        const low = actionText.toLowerCase();
        if (!/\bdelete\b/.test(low)) return false;
        if (/browse\s*\.*\s*download|download\s*\.*\s*browse/.test(low))
          return false;
        if (/\bbrowse\b/.test(low) && /\bdownload\b/.test(low)) return false;
        return true;
      }

      const divDocuments = document.querySelector("#divDocuments");
      if (!divDocuments) {
        const scrollElEmpty =
          /** @type {HTMLElement} */ (
            document.scrollingElement || document.documentElement
          ) || document.documentElement;
        if (passNumIn === 1) scrollElEmpty.scrollTop = 0;
        window.__arlPrPsScroll = scrollElEmpty;
        return {
          rows: [],
          visibleExtracted: 0,
          scrollTop: scrollElEmpty.scrollTop,
          scrollHeight: scrollElEmpty.scrollHeight,
          clientHeight: scrollElEmpty.clientHeight || 0,
          debug: {
            tableCount: 0,
            candidateCount: 0,
            acceptedCount: 0,
            sampleNames: [],
          },
        };
      }

      /**
       * Resolve visible nested "Plan Set Documents" tabpanel (prefer active).
       */
      function planSetScopedRoot(container) {
        const tabAnchors = [
          ...container.querySelectorAll(
            '.ui-tabs-nav a[href^="#"], ul.ui-tabs-nav li a[href^="#"], [role="tab"][href^="#"]',
          ),
        ].filter(Boolean);

        const matchesLabel = (t) =>
          /^plan\s*set\s*documents\b/i.test(norm(t));

        /** @type {{panel: HTMLElement, rank: number}[]} */
        const hits = [];

        for (const a of tabAnchors) {
          if (!matchesLabel(a.textContent || "")) continue;
          const hrefRaw = `${a.getAttribute("href") || ""}`.trim();
          if (!hrefRaw.startsWith("#")) continue;
          const panel = container.querySelector(hrefRaw);
          if (!panel || panel.nodeType !== 1) continue;
          /** @type {HTMLElement} */
          const fel = panel;
          let rank = 0;
          try {
            const st = window.getComputedStyle(fel);
            const r = fel.getBoundingClientRect();
            const visible =
              st.display !== "none" &&
              st.visibility !== "hidden" &&
              r.height > 4 &&
              r.width > 4;
            if (visible) rank += 100;
          } catch (_) {
            /**/
          }
          try {
            const li = a.closest("li");
            if (
              li?.classList.contains("ui-tabs-active") ||
              li?.classList.contains("ui-state-active") ||
              a.classList.contains("ui-tabs-active") ||
              a.getAttribute("aria-selected") === "true"
            )
              rank += 50;
          } catch (_) {
            /**/
          }
          hits.push({ panel: fel, rank });
        }
        hits.sort((x, y) => y.rank - x.rank);

        /** Highest-ranked nested Plan Set tabpanel */
        /** @type {HTMLElement} */
        let scope = hits.length ? hits[0].panel : null;

        /** If tab wiring missing, locate first visible table under Plan Set context */
        if (!scope) {
          const walks = [...container.querySelectorAll("table")];

          outer: for (const tbl of walks) {
            let p = tbl;
            for (let d = 0; d < 14 && p; d++) {
              const chunk = `${p.tagName}:${p.textContent || ""}`
                .replace(/\s+/g, " ")
                .slice(0, 2000)
                .toLowerCase();
              const siChunk = chunk.indexOf("supporting");
              const beforeSup =
                siChunk >= 0 ? chunk.slice(0, siChunk) : chunk;
              if (
                /supporting documents|comment response|review results|approved documents/i.test(
                  chunk,
                ) &&
                !/plan set documents/i.test(beforeSup)
              )
                continue outer;
              p = p.parentElement;
            }
            /** prefer table preceded by explicit Plan Set label in ancestry */
            p = tbl;
            let sawPlanSet = false;
            for (let d = 0; d < 18 && p; d++) {
              const tnorm = `${p.textContent || ""}`.replace(/\s+/g, " ");
              if (/Plan Set Documents\b/i.test(tnorm.slice(0, 800))) {
                sawPlanSet = true;
                break;
              }
              if (EXCLUDE_HEADING.test(tnorm.slice(0, 1200))) break;
              p = p.parentElement;
            }
            if (!sawPlanSet) continue;
            scope = tbl.closest("div") || tbl;
            break;
          }
        }

        /** Last resort — least bad: `#divDocuments` but still filter rows aggressively */
        if (!scope) scope = container;
        return scope;
      }

      const scopeRoot = divDocuments;
      const matrixTables = [...scopeRoot.querySelectorAll("table")];

      /** Pick table with Plan Set column headers and the most data rows */
      /** @type {HTMLTableElement | null} */
      let chosen = null;
      let bestTableScore = -1;
      for (const tb of matrixTables) {
        const fst =
          tb.tHead?.querySelector("tr") ||
          tb.querySelector("tr th")?.closest("tr") ||
          tb.querySelector("tr");
        if (!fst) continue;
        const rowText = norm(fst.innerText).toLowerCase();
        const hasHeaders =
          /\bname\b/.test(rowText) &&
          /\bdiscipline\b/.test(rowText) &&
          (/\bsheet type\b|\bsheet\b/.test(rowText) ||
            /\bupload\b/.test(rowText));
        if (!hasHeaders) continue;
        const body = tb.tBodies?.[0] || tb;
        const dataCount = [...body.querySelectorAll("tr")].filter((tr) =>
          tr.querySelector("td"),
        ).length;
        const score = dataCount + 1000;
        if (score > bestTableScore) {
          bestTableScore = score;
          chosen = tb;
        }
      }
      if (!chosen && matrixTables[0]) chosen = matrixTables[0];
      if (!chosen) {
        const tableCountAll = divDocuments.querySelectorAll("table").length;
        const fb = fallbackExtractPlanSetRows(divDocuments);
        const scrollElFb = resolveScrollEl(null, scopeRoot);
        if (passNumIn === 1) scrollElFb.scrollTop = 0;
        window.__arlPrPsScroll = scrollElFb;
        return {
          rows: fb.rows,
          visibleExtracted: fb.rows.length,
          scrollTop: scrollElFb.scrollTop,
          scrollHeight: scrollElFb.scrollHeight,
          clientHeight: scrollElFb.clientHeight || 0,
          debug: {
            tableCount: tableCountAll,
            candidateCount: fb.candidateCount,
            acceptedCount: fb.rows.length,
            sampleNames: fb.rows.slice(0, 3).map((r) => r.name),
          },
        };
      }

      const tbody = chosen.tBodies?.[0] || chosen;

      /** Derive header column indices once from thead or first header row */
      let nameIx = 0;
      let discIx = 1;
      let sheetIx = 2;
      let descIx = 3;
      let revIx = 4;
      let upIx = 5;
      const hdrRow =
        chosen.tHead?.querySelector("tr") ||
        tbody.querySelector("tr th")?.closest("tr") ||
        tbody.querySelector("tr");
      if (hdrRow) {
        const hcells = [...hdrRow.querySelectorAll("th, td")].map((td) =>
          norm(td.innerText).toLowerCase(),
        );
        hcells.forEach((hc, i) => {
          if (hc.includes("name") && !/\bcompany\b|\bstreet\b/i.test(hc))
            nameIx = i;
          else if (hc.includes("discipline")) discIx = i;
          else if (hc.includes("sheet")) sheetIx = i;
          else if (hc.includes("description")) descIx = i;
          else if (hc.includes("revision")) revIx = i;
          else if (hc.includes("upload")) upIx = i;
        });
      }
      const headerCellCount = hdrRow
        ? [...hdrRow.querySelectorAll("th, td")].length
        : 6;

      /** Data rows — tbody tr excluding header repeats */
      const hdrNormHdr = hdrRow ? norm(hdrRow.innerText).toLowerCase() : "";
      const dataRows = [...tbody.querySelectorAll("tr")].filter((tr) => {
        if (!tr.querySelector("td")) return false;
        const onlyTh =
          [...tr.children].every(
            /** @returns {boolean} */
            (c) => /^TH$/i.test(c.tagName),
          ) && tr.children.length;
        if (onlyTh) return false;
        if (
          hdrNormHdr &&
          norm(tr.innerText).toLowerCase() === hdrNormHdr
        )
          return false;
        return true;
      });

      function dataCellOffsetForRow(tr, cells) {
        if (cells.length <= headerCellCount) return 0;
        if (cells.length === headerCellCount + 1) {
          const fc = `${cells[0] || ""}`.trim();
          if (
            tr.querySelector("td:first-child input.docaction") ||
            tr.querySelector("td:first-child input.img-button") ||
            /^(delete\b|actions?\b)/i.test(fc) ||
            (/browse/i.test(fc) && /download/i.test(fc))
          ) {
            return 1;
          }
          return 1;
        }
        return Math.max(0, cells.length - headerCellCount);
      }

      function cellAt(cells, ix, offset) {
        return `${cells[offset + ix] ?? ""}`.trim();
      }

      /** @returns {boolean} */
      function matchesRealPlanSheetRow(nameGuess, _discipline, _sheetType, text, tr) {
        const ng = norm(nameGuess);
        if (/name\s+discipline\s+sheet\s+type/i.test(ng)) return false;
        if (/^actions$/i.test(ng) && norm(text).length < 48) return false;
        if (ng.length >= 2 && !isRejectedName(ng)) return true;
        if (rowHasPlanSetDownloadAction(tr)) return true;
        if (/cannot be deleted because there is an attached comment/i.test(text))
          return rowHasPlanSetDownloadAction(tr) || ng.length >= 1;
        return false;
      }

      const out = [];
      for (const tr of dataRows) {
        const cells = [...tr.querySelectorAll("td")].map((td) =>
          norm(td.innerText),
        );
        const text = norm(tr.innerText);
        if (cells.length < 2) continue;

        const offset = dataCellOffsetForRow(tr, cells);
        let nameGuess = cellAt(cells, nameIx, offset);
        const discipline = cellAt(cells, discIx, offset);
        const sheetType = cellAt(cells, sheetIx, offset);
        const description = cellAt(cells, descIx, offset);
        const revision = cellAt(cells, revIx, offset);
        const uploadStatus = cellAt(cells, upIx, offset);

        /** Header row rerun */
        const headerish =
          /^name$/i.test(nameGuess) ||
          (/^discipline$/i.test(norm(discipline)) && /^sheet type$/i.test(norm(sheetType)));
        if (headerish) continue;

        if (isRejectedName(nameGuess) && !rowHasPlanSetDownloadAction(tr)) continue;

        if (!matchesRealPlanSheetRow(nameGuess, discipline, sheetType, text, tr)) {
          continue;
        }

        const action = extractRowAction(tr);
        if (
          isDeleteOnlyPortalRow(tr, {
            action,
            name: nameGuess,
            discipline,
            sheetType,
            revision,
          })
        )
          continue;

        out.push({
          name: nameGuess,
          discipline,
          sheetType,
          description,
          revision,
          uploadStatus,
          action,
          source: "plan_review_plan_set_documents",
        });
      }
      const scrollEl = resolveScrollEl(chosen, scopeRoot);
      if (passNumIn === 1) scrollEl.scrollTop = 0;
      window.__arlPrPsScroll = scrollEl;

      const tableCountAll = divDocuments.querySelectorAll("table").length;
      const primaryCandidates = dataRows.length;
      function planSetDomRowRichness(row) {
        let score = 0;
        if (`${row.discipline || ""}`.trim()) score += 16;
        if (`${row.sheetType || ""}`.trim()) score += 16;
        if (`${row.description || ""}`.trim()) score += 4;
        const act =
          row.action && typeof row.action === "object" ? row.action : {};
        if (`${act.documentId || ""}`.trim()) score += 80;
        if (`${act.onclick || ""}`.trim()) score += 20;
        return score;
      }

      function planSetDomNameRevKey(row) {
        const nm = norm(row.name).toLowerCase();
        const rev = norm(row.revision).toLowerCase();
        return rev ? `${nm}|rev:${rev}` : nm;
      }

      const fb = fallbackExtractPlanSetRows(divDocuments);
      const mergedMap = new Map();
      for (const r of [...out, ...fb.rows]) {
        const k = planSetDomNameRevKey(r);
        const prev = mergedMap.get(k);
        if (!prev || planSetDomRowRichness(r) > planSetDomRowRichness(prev)) {
          mergedMap.set(k, r);
        }
      }
      let finalRows = [...mergedMap.values()];
      let candidateCount = primaryCandidates + fb.candidateCount;
      return {
        rows: finalRows,
        visibleExtracted: finalRows.length,
        scrollTop: scrollEl.scrollTop,
        scrollHeight: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight || 0,
        debug: {
          tableCount: tableCountAll,
          candidateCount,
          acceptedCount: finalRows.length,
          sampleNames: finalRows.slice(0, 3).map((r) => r.name),
        },
      };
      }, passNum).catch(() => ({
      rows: [],
      visibleExtracted: 0,
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      debug: {
        tableCount: 0,
        candidateCount: 0,
        acceptedCount: 0,
        sampleNames: [],
      },
    }));

  const stepScrollDom = () =>
    domTarget.evaluate(() => {
      const elUnknown = window.__arlPrPsScroll;
      const el =
        elUnknown && elUnknown instanceof HTMLElement
          ? elUnknown
          : /** @type {HTMLElement} */ (
              document.scrollingElement || document.documentElement
            );
      const ch = el.clientHeight || 0;
      const step = Math.max(140, Math.floor(ch * 0.92) || 360);
      const maxTop = Math.max(0, el.scrollHeight - ch);
      const before = el.scrollTop;
      el.scrollTop = Math.min(maxTop, before + step);
      return {
        before,
        after: el.scrollTop,
        moved: el.scrollTop > before + 0.5,
      };
    });

  await domTarget.evaluate(() => {
    try {
      delete window.__arlPrPsScroll;
    } catch (_) {
      /**/
    }
  }).catch(() => {});

  const seenRows = new Map();
  /** @type {Record<string, unknown>} */
  let lastDebugLoop = {
    tableCount: 0,
    candidateCount: 0,
    acceptedCount: 0,
    sampleNames: [],
  };

  let stableNoNew = 0;
  let lastUniqueTotal = -1;

  // eslint-disable-next-line no-await-in-loop
  for (let pass = 1; pass <= 380; pass++) {
    const packAwait = await runCollectPass(pass);
    const pk =
      packAwait && typeof packAwait === "object" ? packAwait : { rows: [] };
    /** @type {unknown[]} */
    const rowsSlice = Array.isArray(pk.rows) ? pk.rows : [];
    lastDebugLoop =
      pk.debug && typeof pk.debug === "object" ? pk.debug : lastDebugLoop;

    for (const r of rowsSlice) {
      const k = arlingtonPlanSetRowStableKeyNode(r);
      const prev = seenRows.get(k);
      if (
        !prev ||
        arlingtonPlanSetRowMetadataRichnessScore(r) >
          arlingtonPlanSetRowMetadataRichnessScore(prev)
      ) {
        seenRows.set(k, r);
      }
    }

    const u = seenRows.size;
    if (u === lastUniqueTotal) stableNoNew++;
    else stableNoNew = 0;
    lastUniqueTotal = u;

    const scrollTopLoop = Number(pk.scrollTop) || 0;
    const scrollHeightLoop = Number(pk.scrollHeight) || 0;
    const clientHeightLoop = Number(pk.clientHeight) || 0;
    const scrollMaxLoop = Math.max(0, scrollHeightLoop - clientHeightLoop);

    console.log(
      `[Arlington][PlanReview] Plan Set collect pass=${pass} visibleRows=${rowsSlice.length} totalUnique=${u} scrollTop=${Math.round(scrollTopLoop)}/${Math.round(scrollMaxLoop)}`,
    );

    const atBottomLoop =
      scrollTopLoop >= scrollMaxLoop - 8 ||
      scrollHeightLoop <= clientHeightLoop + 14;

    if (atBottomLoop && stableNoNew >= 2) break;

    // eslint-disable-next-line no-await-in-loop
    await stepScrollDom();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) =>
      setTimeout(r, 160 + Math.floor(Math.random() * 110)),
    );
  }

  await domTarget.evaluate(() => {
    try {
      delete window.__arlPrPsScroll;
    } catch (_) {
      /**/
    }
  }).catch(() => {});

  const finalRowsCollected = [...seenRows.values()];
  const dLoop = lastDebugLoop || {};

  console.log(
    `[Arlington][PlanReview][DOM] #divDocuments tables=${dLoop.tableCount ?? 0}`,
  );
  console.log(
    `[Arlington][PlanReview][DOM] candidate rows=${dLoop.candidateCount ?? 0}`,
  );
  console.log(
    `[Arlington][PlanReview][DOM] Plan Set Documents total DOM rows=${finalRowsCollected.length}`,
  );
  console.log(
    `[Arlington][PlanReview][DOM] accepted rows (final pass slice)=${dLoop.acceptedCount ?? "n/a"}`,
  );
  const sampleStrLoop =
    (Array.isArray(dLoop.sampleNames) ? dLoop.sampleNames : []).join(", ") ||
    "(none)";
  console.log(
    `[Arlington][PlanReview][DOM] sample accepted=${sampleStrLoop}`,
  );

  arlingtonLogPlanSetCollectionRowDebug(finalRowsCollected, permitNumber);

  return finalRowsCollected;
}

function arlingtonLiftJsonArrays(value, depthLeft = 5) {
  if (depthLeft <= 0) return [];
  if (Array.isArray(value))
    return value.filter((x) => x != null && typeof x === "object");
  if (value === null || value === undefined || typeof value !== "object") {
    return [];
  }
  const keys = [
    "data",
    "Items",
    "items",
    "Documents",
    "documents",
    "Results",
    "results",
    "Records",
    "records",
    "Rows",
    "rows",
    "value",
    "Value",
    "payload",
    "Payload",
  ];
  const vObj = /** @type {Record<string, unknown>} */ (value);
  for (const k of keys) {
    if (!(k in vObj)) continue;
    const lifted = arlingtonLiftJsonArrays(vObj[k], depthLeft - 1);
    if (lifted.length) return lifted;
  }
  return [];
}

function arlingtonInferErmsDocName(record) {
  if (!record || typeof record !== "object") return "document";
  const keys = [
    "FileName",
    "fileName",
    "Filename",
    "filename",
    "DocumentName",
    "documentName",
    "DocName",
    "docName",
    "SheetName",
    "sheetName",
    "Title",
    "title",
    "Name",
    "name",
    "Description",
    "description",
  ];
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").slice(0, 260).trim();
  }
  return "document";
}

function arlingtonResolveMaybeRelative(origin, candidate) {
  const c = `${candidate || ""}`.trim();
  if (!c) return "";
  if (/^https?:\/\//i.test(c)) return c;
  try {
    return new URL(c, `${origin.replace(/\/$/, "")}/`).href;
  } catch (_) {
    return "";
  }
}

function arlingtonNormPlanReviewCell(s) {
  return `${s || ""}`.trim().replace(/\s+/g, " ").toLowerCase();
}

function arlingtonPlanSetNameRevisionMergeKey(doc) {
  const name = planReviewNormAttachmentName({
    name: `${doc?.name ?? doc?.filename ?? ""}`,
  });
  const rev = `${doc?.revision ?? ""}`.trim().toLowerCase();
  return rev ? `${name}|rev:${rev}` : name;
}

/** Prefer portal rows with documentId/download action and richer metadata. */
function arlingtonPlanSetRowMetadataRichnessScore(doc) {
  const d =
    doc && typeof doc === "object"
      ? /** @type {Record<string, unknown>} */ (doc)
      : null;
  if (!d) return 0;
  let score = 0;
  if (arlingtonPlanReviewDocLooksDownloadComplete(d)) score += 500;
  if (arlingtonPlanSetDocPinnedOrInferredNumericId(d)) score += 120;
  if (arlingtonPlanSetDocRecoverableErmsInteractive(d)) score += 80;
  if (`${d.discipline || ""}`.trim()) score += 16;
  if (`${d.sheetType || ""}`.trim()) score += 16;
  if (`${d.documentType || ""}`.trim()) score += 8;
  if (`${d.description || ""}`.trim()) score += 4;
  if (`${d.uploadStatus || ""}`.trim()) score += 2;
  if (`${d.revision || ""}`.trim()) score += 1;
  return score;
}

function arlingtonEnrichPlanSetRowMetadataFromDonor(base, donor) {
  if (!base || typeof base !== "object") return base;
  if (!donor || typeof donor !== "object") return base;
  const out = /** @type {Record<string, unknown>} */ ({ ...base });
  const d = /** @type {Record<string, unknown>} */ (donor);
  for (const k of [
    "discipline",
    "sheetType",
    "documentType",
    "description",
    "revision",
    "uploadStatus",
    "documentDate",
    "size",
  ]) {
    const bv = `${out[k] ?? ""}`.trim();
    const dv = `${d[k] ?? ""}`.trim();
    if (!bv && dv) out[k] = d[k];
  }
  if (
    arlingtonPlanSetDocRecoverableErmsInteractive(d) &&
    !arlingtonPlanSetDocRecoverableErmsInteractive(out)
  ) {
    out.action = d.action;
    if (`${d.documentId ?? ""}`.trim()) out.documentId = d.documentId;
  } else if (
    arlingtonPlanSetDocPinnedOrInferredNumericId(d) &&
    !arlingtonPlanSetDocPinnedOrInferredNumericId(out)
  ) {
    out.action = d.action;
    if (`${d.documentId ?? ""}`.trim()) out.documentId = d.documentId;
  }
  return out;
}

/**
 * Collapse duplicate Plan Set variants (portal/API/prior) into one canonical row.
 * @param {unknown[]} rows
 * @param {{ portalPrefer?: unknown[] }} [opts]
 */
function arlingtonMergeAllPlanSetRowVariants(rows, opts) {
  const list = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && typeof r === "object",
  );
  if (!list.length) return null;
  const portalPrefer = Array.isArray(opts?.portalPrefer)
    ? opts.portalPrefer.filter((r) => r && typeof r === "object")
    : [];
  const portalSet = new Set(portalPrefer);
  const basePool = portalPrefer.length
    ? portalPrefer
    : list;
  const sorted = [...basePool].sort(
    (a, b) =>
      arlingtonPlanSetRowMetadataRichnessScore(b) -
      arlingtonPlanSetRowMetadataRichnessScore(a),
  );
  let acc = arlingtonNormalizePlanReviewDocRow(
    /** @type {Record<string, unknown>} */ ({ ...sorted[0] }),
  );
  for (const row of list) {
    if (row === sorted[0]) continue;
    acc = arlingtonEnrichPlanSetRowMetadataFromDonor(acc, row);
    if (arlingtonPlanReviewDocLooksDownloadComplete(row)) {
      acc = arlingtonMergePlanReviewDocRowFields(
        /** @type {Record<string, unknown>} */ (row),
        acc,
      );
    } else {
      acc = arlingtonMergePlanReviewDocRowFields(
        acc,
        /** @type {Record<string, unknown>} */ (row),
      );
    }
  }
  return arlingtonNormalizePlanReviewDocRow(acc);
}

function arlingtonExtractPriorPlanSetDocList(priorCtx) {
  if (!priorCtx || typeof priorCtx !== "object") return [];
  const o = /** @type {Record<string, unknown>} */ (priorCtx);
  const pr = o.tabs && typeof o.tabs === "object"
    ? /** @type {Record<string, unknown>} */ (o.tabs).planReview
    : null;
  const tabs =
    pr && typeof pr === "object" && !Array.isArray(pr) && pr.tabs
      ? pr.tabs
      : o.plansAndDocuments
        ? o
        : null;
  if (!tabs || typeof tabs !== "object") return [];
  const docs =
    /** @type {Record<string, unknown>} */ (tabs)?.plansAndDocuments?.sections
      ?.planSetDocuments?.documents;
  return Array.isArray(docs) ? docs : [];
}

/**
 * Portal grid is source of truth: rebuild Plan Set list from fresh DOM rows,
 * merge downloaded fields from prior by normalized name + revision, drop stale pending orphans.
 * @param {unknown[]} planSink mutated in place
 * @param {unknown} [priorPortalOrTabs]
 * @returns {{ staleRemoved: string[]; total: number }}
 */
function arlingtonRebuildPlanSetSinkFromPortalCollection(
  planSink,
  priorPortalOrTabs,
  opts,
) {
  if (!Array.isArray(planSink)) {
    return {
      staleRemoved: [],
      total: 0,
      rawCount: 0,
      duplicatesCollapsed: 0,
      canonicalCount: 0,
    };
  }

  const permitNumber =
    opts && typeof opts === "object"
      ? `${opts.permitNumber || ""}`.trim()
      : "";

  const priorList = arlingtonExtractPriorPlanSetDocList(priorPortalOrTabs);
  const filteredIn = arlingtonFilterActivePlanSetDocuments(planSink);
  const rawCount = filteredIn.rawCount;
  const deleteOnlySkipped = filteredIn.deleteOnlySkipped;
  planSink.length = 0;
  for (const row of filteredIn.active) planSink.push(row);

  /** @type {Map<string, Record<string, unknown>[]>} */
  const priorByNameRev = new Map();
  for (const p of priorList) {
    if (!p || typeof p !== "object") continue;
    const pr = /** @type {Record<string, unknown>} */ (p);
    const nameRev = arlingtonPlanSetNameRevisionMergeKey(pr);
    if (!priorByNameRev.has(nameRev)) priorByNameRev.set(nameRev, []);
    priorByNameRev.get(nameRev).push(pr);
  }

  /** @type {Map<string, Record<string, unknown>[]>} */
  const portalByKey = new Map();
  for (const fresh of planSink) {
    if (!fresh || typeof fresh !== "object") continue;
    const fr = /** @type {Record<string, unknown>} */ (fresh);
    const key = arlingtonPlanSetNameRevisionMergeKey(fr);
    if (!portalByKey.has(key)) portalByKey.set(key, []);
    portalByKey.get(key).push(fr);
  }

  /** @type {Set<string>} */
  const currentNameRevKeys = new Set(portalByKey.keys());
  let duplicatesCollapsed = 0;
  /** @type {Record<string, unknown>[]} */
  const canonical = [];

  for (const [key, group] of portalByKey.entries()) {
    duplicatesCollapsed += Math.max(0, group.length - 1);
    const priors = priorByNameRev.get(key) || [];
    const merged = arlingtonMergeAllPlanSetRowVariants([...group, ...priors], {
      portalPrefer: group,
    });
    if (merged) canonical.push(merged);
    else if (group[0]) canonical.push(arlingtonNormalizePlanReviewDocRow(group[0]));
    currentNameRevKeys.add(key);
  }

  /** @type {string[]} */
  const staleRemoved = [];

  for (const p of priorList) {
    if (!p || typeof p !== "object") continue;
    const pr = /** @type {Record<string, unknown>} */ (p);
    const key = arlingtonPlanSetNameRevisionMergeKey(pr);
    if (currentNameRevKeys.has(key)) continue;
    if (arlingtonPlanReviewDocLooksDownloadComplete(pr)) continue;
    const pu = `${pr.publicUrl || ""}`.trim();
    const sp = `${pr.storagePath || ""}`.trim();
    const du = `${pr.downloadUrl || ""}`.trim();
    if (pu || sp || du) continue;
    const hasDownloadAction = arlingtonPlanSetDocRecoverableErmsInteractive(pr);
    if (hasDownloadAction) continue;
    const nm = `${pr.name ?? pr.filename ?? ""}`.trim() || key;
    staleRemoved.push(nm);
    console.log(
      `[Arlington][PlanReview] stale pending row removed name=${nm} reason=no_current_portal_row_no_download_action`,
    );
  }

  planSink.length = 0;
  for (const row of canonical) planSink.push(row);

  const canonicalCount = planSink.length;
  const missingExpected = arlingtonPlanSetMissingExpectedRowNames(
    planSink,
    permitNumber,
  );

  console.log(`[Arlington][PlanReview] portal rows raw=${rawCount}`);
  console.log(
    `[Arlington][PlanReview] active downloadable rows count=${planSink.length}`,
  );
  console.log(
    `[Arlington][PlanReview] inactive delete-only rows skipped count=${deleteOnlySkipped.length}`,
  );
  console.log(
    `[Arlington][PlanReview] skipped delete-only row names sample=${JSON.stringify(deleteOnlySkipped.slice(0, 12).filter(Boolean))}`,
  );
  console.log(
    `[Arlington][PlanReview] canonical unique rows=${canonicalCount}`,
  );
  console.log(
    `[Arlington][PlanReview] duplicate rows collapsed=${duplicatesCollapsed}`,
  );
  console.log(
    `[Arlington][PlanReview] stale inactive rows removed=${JSON.stringify(staleRemoved.filter(Boolean))}`,
  );
  if (missingExpected.length) {
    console.log(
      `[Arlington][PlanReview] missing expected rows after collect=${JSON.stringify(missingExpected.filter(Boolean))}`,
    );
  }

  return {
    staleRemoved,
    total: planSink.length,
    rawCount,
    duplicatesCollapsed,
    canonicalCount,
  };
}

/**
 * Re-harvest Plan Set metadata from the live portal grid and rebuild the sink.
 * @param {import("playwright").Page} page
 * @param {import("playwright").Page | import("playwright").Frame} prFrame
 * @param {Record<string, unknown>} integratedTabs
 * @param {unknown} [priorPortalData]
 */
async function arlingtonRefreshPlanSetMetadataFromPortalFrame(
  page,
  prFrame,
  integratedTabs,
  priorPortalData,
  permitNumber,
) {
  const permit = `${permitNumber || ""}`.trim();
  const sink =
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  if (!Array.isArray(sink)) return;

  await clickArlingtonPlanReviewSubTab(page, "Plans & Documents");
  await page.waitForTimeout(650).catch(() => {});
  await clickArlingtonIntegratedNestedTab(page, "Plan Set Documents").catch(
    () => false,
  );
  await page.waitForTimeout(650).catch(() => {});

  const domTarget =
    (await waitForArlingtonPlanReviewIframeReady(page, 30000)) || prFrame;
  const rawRows = await extractArlingtonPlanSetDocumentsFromPrPageDom(
    domTarget,
    { permitNumber: permit },
  );

  sink.length = 0;
  for (const r of rawRows) {
    sink.push(mapArlingtonDomPlanSetRowToDoc(r));
  }
  arlingtonRebuildPlanSetSinkFromPortalCollection(sink, priorPortalData, {
    permitNumber: permit,
  });
  arlingtonFinalizePlanSetDocumentsSink(sink);
}

/** Drop junk sheet labels / ERMS placeholders from normalized Plan Set docs */
function arlingtonPlanSetRejectedHydratedName(nm) {
  const raw = `${nm || ""}`.trim();
  if (!raw) return true;
  const low = raw.toLowerCase();
  if (low === "document") return true;
  if (low === "name") return true;
  if (low === "document type") return true;
  return false;
}

/** Strip placeholder label rows (never user-facing doc names). */
function arlingtonStripRejectedPlanReviewPlaceholderDocNames(planSink) {
  if (!Array.isArray(planSink)) return;
  for (let i = planSink.length - 1; i >= 0; i--) {
    const d = planSink[i];
    const nm = `${d?.name ?? d?.filename ?? ""}`.trim();
    if (arlingtonPlanSetRejectedHydratedName(nm)) planSink.splice(i, 1);
  }
}

/** @param {unknown} doc */
function arlingtonPlanSetDocGroupedName(doc, fallbackKey) {
  const d =
    doc && typeof doc === "object"
      ? /** @type {Record<string, unknown>} */ (doc)
      : null;
  if (!d) return `__row_${fallbackKey}`;
  const nk = planReviewNormAttachmentName({
    name: `${d.name ?? d.filename ?? ""}`,
  });
  return nk && nk.trim()
    ? nk
    : `__blank_name__:${fallbackKey}`;
}

/** Numeric PlanDoc identity stored on the row (resume / retry). */
function arlingtonPlanSetDocPinnedOrInferredNumericId(doc) {
  const d =
    doc && typeof doc === "object"
      ? /** @type {Record<string, unknown>} */ (doc)
      : null;
  if (!d) return false;
  let pid = `${d.documentId ?? ""}`.trim();
  if (/^\d{5,}$/.test(pid)) return true;
  const act =
    d.action && typeof d.action === "object"
      ? /** @type {Record<string, unknown>} */ (d.action)
      : null;
  pid = `${act?.documentId ?? ""}`.trim();
  return /^\d{5,}$/.test(pid);
}

/** Row still matches a live Plan Set download control (DOM / invoke path). */
function arlingtonPlanSetDocRecoverableErmsInteractive(doc) {
  const d =
    doc && typeof doc === "object"
      ? /** @type {Record<string, unknown>} */ (doc)
      : null;
  if (!d) return false;
  if (arlingtonPlanSetDocPinnedOrInferredNumericId(doc)) return true;
  const hay = [];
  const act =
    d.action && typeof d.action === "object"
      ? /** @type {Record<string, unknown>} */ (d.action)
      : null;
  hay.push(act?.onclick, act?.href, act?.id, act?.name, d.documentId);
  const inferred = arlingtonInferErmsPlanDocIdFromDomActionHaystack(
    hay.filter(Boolean).join("\n"),
  );
  if (/^\d{5,}$/.test(inferred)) return true;
  const low = hay.filter(Boolean).join("\n").toLowerCase();
  if (
    /\binvokedownloaddocument\b|\bdocumentstream\b|\bpolldownloaddocument\b|\bplandocid\b/.test(
      low,
    )
  )
    return true;
  const hrefRaw = `${act?.href ?? ""}`.trim();
  if (
    /^https?:\/\//i.test(hrefRaw) &&
    !/^javascript:void/i.test(hrefRaw.toLowerCase())
  )
    return true;
  return false;
}

function arlingtonPlanSetDocActionHaystack(doc) {
  const d =
    doc && typeof doc === "object"
      ? /** @type {Record<string, unknown>} */ (doc)
      : null;
  if (!d) return "";
  const act =
    d.action && typeof d.action === "object"
      ? /** @type {Record<string, unknown>} */ (d.action)
      : null;
  return `${act?.title ?? ""} ${act?.alt ?? ""} ${act?.onclick ?? ""} ${act?.href ?? ""} ${act?.name ?? ""}`
    .trim()
    .replace(/\s+/g, " ");
}

/** True when the portal row exposes Browse/Download or a numeric docaction input. */
function arlingtonPlanSetDocHasRealDownloadInput(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (arlingtonPlanReviewDocLooksDownloadComplete(doc)) return true;
  const d = /** @type {Record<string, unknown>} */ (doc);
  const act =
    d.action && typeof d.action === "object"
      ? /** @type {Record<string, unknown>} */ (d.action)
      : null;
  const docId = `${d.documentId ?? act?.documentId ?? ""}`.trim();
  if (/^\d+$/.test(docId)) {
    const tit = `${act?.title ?? ""} ${act?.alt ?? ""}`.toLowerCase();
    if (/browse|download/.test(tit)) return true;
    const oc = `${act?.onclick ?? ""}`.toLowerCase();
    if (
      /\binvokedownloaddocument\b|\bpolldownloaddocument\b|\bdocumentstream\b/.test(
        oc,
      )
    )
      return true;
    if (/browse|download/.test(oc)) return true;
  }
  const hay = arlingtonPlanSetDocActionHaystack(d).toLowerCase();
  if (/browse\s*\.*\s*download|download\s*\.*\s*browse/.test(hay))
    return true;
  if (/\bbrowse\b/.test(hay) && /\bdownload\b/.test(hay)) return true;
  const hrefRaw = `${act?.href ?? ""}`.trim();
  if (
    /^https?:\/\//i.test(hrefRaw) &&
    !/^javascript:void/i.test(hrefRaw.toLowerCase())
  )
    return true;
  const low = [
    act?.onclick,
    act?.href,
    act?.id,
    act?.name,
    d.documentId,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (
    /\binvokedownloaddocument\b|\bpolldownloaddocument\b|\bdocumentstream\b/.test(
      low,
    )
  )
    return true;
  return false;
}

/**
 * Portal rows with Delete-only actions and no real download control — inactive shadows.
 * @param {unknown} doc
 */
function arlingtonPlanSetDocIsDeleteOnlyInactive(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (arlingtonPlanReviewDocLooksDownloadComplete(doc)) return false;
  if (arlingtonPlanSetDocHasRealDownloadInput(doc)) return false;
  const hay = arlingtonPlanSetDocActionHaystack(doc).toLowerCase();
  if (!/\bdelete\b/.test(hay)) return false;
  if (/browse\s*\.*\s*download|download\s*\.*\s*browse/.test(hay)) return false;
  if (/\bbrowse\b/.test(hay) && /\bdownload\b/.test(hay)) return false;
  return true;
}

/**
 * @param {unknown[]} rows
 * @returns {{ active: Record<string, unknown>[]; deleteOnlySkipped: string[]; rawCount: number }}
 */
function arlingtonFilterActivePlanSetDocuments(rows) {
  const raw = Array.isArray(rows) ? rows : [];
  /** @type {Record<string, unknown>[]} */
  const active = [];
  /** @type {string[]} */
  const deleteOnlySkipped = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    if (arlingtonPlanSetDocIsDeleteOnlyInactive(row)) {
      deleteOnlySkipped.push(
        `${/** @type {Record<string, unknown>} */ (row).name ?? /** @type {Record<string, unknown>} */ (row).filename ?? ""}`.trim() ||
          "(unnamed)",
      );
      continue;
    }
    active.push(/** @type {Record<string, unknown>} */ (row));
  }
  return { active, deleteOnlySkipped, rawCount: raw.length };
}

/** Rows that already hit download/stream plumbing — keep visible for retry. */
function arlingtonPlanSetDocTemporalAttemptSignals(doc) {
  const d =
    doc && typeof doc === "object"
      ? /** @type {Record<string, unknown>} */ (doc)
      : null;
  if (!d) return false;
  const ds = `${d.downloadStatus || ""}`.trim();
  const temporalStatuses = [
    "pending_stream_timeout",
    "pending_session_closed",
    "pending_token_missing",
    "pending_tab_not_resolved",
    "pending_not_attempted",
    "pending_timeout_resume",
    "upload_failed",
    "invoke_error",
    "invoke_timeout",
    "invoke_click_failed",
    "empty_buffer",
    "failed_html_stub",
    "write_failed",
    "no_file_buffer",
    "no_file_after_invoke",
    "upload_timeout",
    "missing_document_id",
  ];
  if (temporalStatuses.includes(ds)) return true;
  const rcRaw = Number(d.retryCount ?? 0);
  if (!Number.isNaN(rcRaw) && rcRaw > 0) return true;
  return false;
}

/**
 * Incomplete sibling row that still maps to retryable/live ERMS chrome.
 * Duplicate plan_set_row stubs collapse only when another row same name uploaded.
 */
function arlingtonPlanSetDocEligiblePendingOrRetryTwin(doc) {
  if (arlingtonPlanSetDocIsDeleteOnlyInactive(doc)) return false;
  if (arlingtonErmsSinkDocLooksUploadComplete(doc)) return false;
  if (arlingtonPlanSetDocTemporalAttemptSignals(doc)) return true;
  return arlingtonPlanSetDocRecoverableErmsInteractive(doc);
}

/** Phantom API/DOM row with no actionable download path once real grid harvested. */
function arlingtonPlanSetDocStaleOrphanPlaceholder(doc, allowGlobalStaleSweep) {
  if (!allowGlobalStaleSweep || !doc || typeof doc !== "object") return false;
  if (arlingtonErmsSinkDocLooksUploadComplete(doc)) return false;
  if (arlingtonPlanSetDocEligiblePendingOrRetryTwin(doc)) return false;
  return true;
}

/**
 * Suppress stale plan_set_row / metadata-only shadow rows after DOM harvest +
 * normalize duplicate names (downloaded > pending-retry/actionable > orphaned stub).
 */
function arlingtonDedupeSuppressStalePlanSetDocuments(planSink) {
  if (!Array.isArray(planSink) || !planSink.length) return;

  arlingtonStripRejectedPlanReviewPlaceholderDocNames(planSink);

  const filtered = arlingtonFilterActivePlanSetDocuments(planSink);
  planSink.length = 0;
  for (const row of filtered.active) planSink.push(row);

  const harvested = planSink.some(
    (d) =>
      arlingtonErmsSinkDocLooksUploadComplete(d) ||
      arlingtonPlanSetDocRecoverableErmsInteractive(d),
  );

  const pass1 = [];
  for (const d of planSink) {
    if (
      harvested &&
      arlingtonPlanSetDocStaleOrphanPlaceholder(d, true)
    ) {
      continue;
    }
    pass1.push(d);
  }

  /** @type {Map<string, unknown[]>} */
  const buckets = new Map();
  pass1.forEach((d, ix) => {
    const nk =
      arlingtonPlanSetNameRevisionMergeKey(d) || `__blank_name_rev__:${ix}`;
    if (!buckets.has(nk)) buckets.set(nk, []);
    buckets.get(nk).push(d);
  });

  const pass2 = [];
  for (const grp of buckets.values()) {
    if (!grp.length) continue;
    if (grp.length === 1) {
      pass2.push(grp[0]);
      continue;
    }
    const merged = arlingtonMergeAllPlanSetRowVariants(grp, {
      portalPrefer: grp,
    });
    pass2.push(merged || grp[0]);
  }

  planSink.length = 0;
  planSink.push(...pass2);
  arlingtonStripRejectedPlanReviewPlaceholderDocNames(planSink);
}

/** Plan Set Documents only — stale stubs + sibling dedupe + scaffolding strip. */
function arlingtonFinalizePlanSetDocumentsSink(planSink, quiet) {
  if (!Array.isArray(planSink) || !planSink.length) return;
  arlingtonDedupeSuppressStalePlanSetDocuments(planSink);
  if (!quiet) {
    const psC = arlingtonCountNormalizedPlanReviewBucketDocs(planSink);
    console.log(
      `[Arlington][PlanReview] final active planSet downloaded=${psC.downloaded} pending=${psC.pending} total=${psC.total}`,
    );
  }
}

function arlingtonErmsRowDiscipline(row) {
  if (!row || typeof row !== "object") return "";
  return `${row.Discipline ?? row.discipline ?? ""}`.trim();
}

function arlingtonErmsRowSheetType(row) {
  if (!row || typeof row !== "object") return "";
  return `${row.SheetType ?? row.sheetType ?? ""}`.trim();
}

/** True when the API row carries an explicit sheet/document identity (not Discipline/SheetType alone). */
function arlingtonRequiredSheetHasExplicitDocumentName(row) {
  if (!row || typeof row !== "object") return false;
  const identityKeys = [
    "FileName",
    "fileName",
    "Filename",
    "filename",
    "DocumentName",
    "documentName",
    "DocName",
    "docName",
    "SheetName",
    "sheetName",
    "Title",
    "title",
  ];
  for (const k of identityKeys) {
    const v = row[k];
    if (
      typeof v === "string" &&
      v.trim() &&
      !arlingtonPlanSetRejectedHydratedName(v.trim())
    )
      return true;
  }
  const nm = row.Name ?? row.name;
  if (
    typeof nm === "string" &&
    nm.trim() &&
    !arlingtonPlanSetRejectedHydratedName(nm.trim())
  )
    return true;
  return false;
}

/** RequiredPlanSheets rows that only describe discipline/type — not standalone documents */
function arlingtonRequiredPlanSheetRowIsMetadataOnly(row) {
  if (!row || typeof row !== "object") return true;
  if (arlingtonRequiredSheetHasExplicitDocumentName(row)) return false;
  const inferred = arlingtonInferErmsDocName(row);
  return arlingtonPlanSetRejectedHydratedName(inferred);
}

function arlingtonFindDomPlanRowMatch(planSink, discipline, sheetType) {
  if (!Array.isArray(planSink)) return null;
  const ad = arlingtonNormPlanReviewCell(discipline);
  const ast = arlingtonNormPlanReviewCell(sheetType);
  let domMatch =
    planSink.find(
      (d) =>
        arlingtonNormPlanReviewCell(d.discipline) === ad &&
        arlingtonNormPlanReviewCell(d.sheetType) === ast,
    ) || null;
  if (!domMatch && ad) {
    const hits = planSink.filter(
      (d) => arlingtonNormPlanReviewCell(d.discipline) === ad,
    );
    if (hits.length === 1) domMatch = hits[0];
  }
  return domMatch;
}

/**
 * Merge RequiredPlanSheets into Plan Set sink: DOM rows stay primary; API only enriches matches or fills when DOM empty.
 */
function arlingtonApplyRequiredPlanSheetsToPlanSink(
  planSink,
  requiredRows,
  origin,
) {
  const domRowCount = Array.isArray(planSink) ? planSink.length : 0;

  console.log(`[Arlington][PlanReview] DOM Plan Set rows=${domRowCount}`);

  const metadataOnlyAll =
    requiredRows.length === 0 ||
    requiredRows.every(
      (r) =>
        !r ||
        typeof r !== "object" ||
        arlingtonRequiredPlanSheetRowIsMetadataOnly(r),
    );

  console.log(
    `[Arlington][PlanReview] API RequiredPlanSheets metadata-only=${metadataOnlyAll}`,
  );

  if (domRowCount > 0) {
    for (const row of requiredRows) {
      if (!row || typeof row !== "object") continue;
      const metaOnly = arlingtonRequiredPlanSheetRowIsMetadataOnly(row);
      const apiDoc = arlingtonApiRowToPlanReviewDoc(
        origin,
        row,
        "planSetDocuments",
      );

      if (!metaOnly && arlingtonPlanSetRejectedHydratedName(apiDoc.name))
        continue;

      const domMatch = arlingtonFindDomPlanRowMatch(
        planSink,
        arlingtonErmsRowDiscipline(row),
        arlingtonErmsRowSheetType(row),
      );
      if (!domMatch) continue;

      const urlGuess = arlingtonInferErmsDocUrl(origin, row);
      if (urlGuess && !`${domMatch.publicUrl || ""}`.trim()) {
        domMatch.publicUrl = urlGuess;
        domMatch.downloadUrl = urlGuess;
        domMatch.status = "plan_set_has_url";
      }

      if (apiDoc.revision && !`${domMatch.revision || ""}`.trim())
        domMatch.revision = apiDoc.revision;
      if (apiDoc.documentDate && !`${domMatch.documentDate || ""}`.trim())
        domMatch.documentDate = apiDoc.documentDate;
      if (apiDoc.size && !`${domMatch.size || ""}`.trim())
        domMatch.size = apiDoc.size;
    }
  } else if (!metadataOnlyAll) {
    for (const row of requiredRows) {
      if (!row || typeof row !== "object") continue;
      if (arlingtonRequiredPlanSheetRowIsMetadataOnly(row)) continue;
      const doc = arlingtonApiRowToPlanReviewDoc(
        origin,
        row,
        "planSetDocuments",
      );
      if (arlingtonPlanSetRejectedHydratedName(doc.name)) continue;
      planSink.push(doc);
    }
  }
}

function arlingtonInferErmsDocUrl(origin, row) {
  if (!row || typeof row !== "object") return "";
  const keys = [
    "DownloadUrl",
    "downloadUrl",
    "ViewUrl",
    "viewUrl",
    "FileUrl",
    "fileUrl",
    "Url",
    "url",
    "Href",
    "href",
    "RelativeUrl",
    "relativeUrl",
    "PortalUrl",
    "portalUrl",
  ];
  /** @type {string[]} */
  const candidates = [];
  for (const k of keys) {
    const raw = `${/** @type {Record<string, unknown>} */ (row)[k] || ""}`.trim();
    if (raw) candidates.push(arlingtonResolveMaybeRelative(origin, raw));
  }
  for (const c of candidates) {
    const low = c.toLowerCase();
    if (/^https?:\/\//i.test(c) && /\.pdf\b/i.test(low)) return c;
  }
  for (const c of candidates) {
    if (/^https?:\/\//i.test(c) && /download/i.test(c.toLowerCase())) return c;
  }
  for (const c of candidates) {
    if (/^https?:\/\//i.test(c)) return c;
  }
  return "";
}

function arlingtonApiRowToPlanReviewDoc(origin, row, sourceSectionCamel) {
  const nameGuess = arlingtonInferErmsDocName(row);
  const urlGuess = arlingtonInferErmsDocUrl(origin, row);
  let docDate = "";
  let sizeGuess = "";
  let revision = "";
  if (
    typeof row === "object" &&
    row
  ) {
    if (typeof row.DocumentDate === "string") docDate = row.DocumentDate.trim();
    if (typeof row.documentDate === "string")
      docDate = row.documentDate.trim();
    const szRaw = `${row.FileSize ?? row.fileSize ?? row.Size ?? ""}`.slice(
      0,
      40,
    );
    if (szRaw) sizeGuess = szRaw.trim();
    const revRaw = `${row.RevisionNumber ?? row.revision ?? ""}`
      .toString()
      .slice(0, 80);
    if (revRaw.trim()) revision = revRaw.trim();
  }
  const discipline = `${row?.Discipline ?? row?.discipline ?? ""}`.trim();
  const sheetType = `${row?.SheetType ?? row?.sheetType ?? ""}`.trim();

  return {
    name: nameGuess,
    filename: nameGuess,
    discipline,
    sheetType,
    documentDate: docDate.slice(0, 80),
    size: sizeGuess,
    status: urlGuess ? "api_link" : "api_metadata",
    storagePath: "",
    publicUrl: urlGuess,
    downloadUrl: urlGuess,
    sourceTab: "plansAndDocuments",
    sourceSection: sourceSectionCamel,
    source: "plan_review_erms_api",
    revision,
  };
}

function arlingtonExtractErmsPlanDocId(row) {
  if (!row || typeof row !== "object") return "";
  const ids = arlingtonCollectErmsCandidateIdsFromObject(row);
  return ids.length ? ids[0] : "";
}

const ARLINGTON_ERMS_DOC_ID_KEYS = [
  "DocumentID",
  "DocumentId",
  "documentId",
  "documentID",
  "ID",
  "Id",
  "id",
  "PlanDocID",
  "PlanDocId",
  "planDocId",
  "plandocid",
  "FileID",
  "FileId",
  "fileId",
  "fileID",
  "AttachmentID",
  "AttachmentId",
  "attachmentId",
  "attachmentID",
  "DocId",
  "docId",
  "ResponseLetterID",
  "ResponseLetterId",
  "responseLetterId",
  "LetterID",
  "LetterId",
  "letterId",
  "ApplicationDocID",
  "ApplicationDocId",
  "applicationDocId",
];

const ARLINGTON_ERMS_DOC_ID_NESTED_KEYS = [
  "Document",
  "document",
  "File",
  "file",
  "Attachment",
  "attachment",
  "PlanDocument",
  "planDocument",
];

function arlingtonCollectErmsCandidateIdsFromObject(obj, prefix, out) {
  const found = out || new Map();
  if (!obj || typeof obj !== "object") return found;
  const o = /** @type {Record<string, unknown>} */ (obj);
  for (const k of ARLINGTON_ERMS_DOC_ID_KEYS) {
    const v = `${o[k] ?? ""}`.trim();
    if (/^\d+$/.test(v)) {
      found.set(prefix ? `${prefix}.${k}` : k, v);
    }
  }
  for (const nest of ARLINGTON_ERMS_DOC_ID_NESTED_KEYS) {
    if (o[nest] && typeof o[nest] === "object") {
      arlingtonCollectErmsCandidateIdsFromObject(
        o[nest],
        prefix ? `${prefix}.${nest}` : nest,
        found,
      );
    }
  }
  return found;
}

function arlingtonCollectSecondaryRowCandidateIds(doc) {
  /** @type {Map<string, string>} */
  const found = new Map();
  if (!doc || typeof doc !== "object") return found;
  arlingtonCollectErmsCandidateIdsFromObject(doc, "", found);
  if (doc.raw && typeof doc.raw === "object") {
    arlingtonCollectErmsCandidateIdsFromObject(doc.raw, "raw", found);
  }
  if (doc.raw && typeof doc.raw === "object") {
    const dhRaw = arlExtractNumericDocHandleFromErmsRaw(
      /** @type {Record<string, unknown>} */ (doc.raw),
    );
    if (dhRaw) found.set("dochandle", dhRaw);
  }
  const topId = `${doc.documentId || doc.action?.documentId || ""}`.trim();
  if (/^\d+$/.test(topId)) found.set("documentId", topId);

  if (doc.action && typeof doc.action === "object") {
    const ac = /** @type {Record<string, unknown>} */ (doc.action);
    const hay = [
      ac.onclick,
      ac.href,
      ac.id,
      ac.name,
      ac.title,
      ac.alt,
    ]
      .map((x) => `${x ?? ""}`)
      .join("\n");
    const inf = arlingtonInferErmsPlanDocIdFromDomActionHaystack(hay);
    if (/^\d+$/.test(inf)) found.set("action.inferredDocumentId", inf);
  }
  return found;
}

function arlingtonPickSecondaryRowDocumentId(doc) {
  const candidates = arlingtonCollectSecondaryRowCandidateIds(doc);
  const preferKeys = [
    "documentId",
    "action.documentId",
    "action.inferredDocumentId",
    "PlanDocId",
    "PlanDocID",
    "planDocId",
    "plandocid",
    "raw.PlanDocId",
    "raw.PlanDocID",
    "raw.planDocId",
    "DocumentId",
    "DocumentID",
    "raw.DocumentId",
    "raw.DocumentID",
  ];
  for (const k of preferKeys) {
    const v = `${candidates.get(k) || ""}`.trim();
    if (/^\d+$/.test(v)) return v;
  }
  for (const [k, v] of candidates.entries()) {
    if (/dochandle/i.test(k)) continue;
    if (/^\d+$/.test(`${v || ""}`.trim())) return `${v}`.trim();
  }
  return "";
}

function arlingtonFormatSecondaryRowCandidateIds(doc) {
  const candidates = arlingtonCollectSecondaryRowCandidateIds(doc);
  if (!candidates.size) return "none";
  return [...candidates.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
}

function arlingtonApplySecondaryDocAlias(target, source) {
  target.publicUrl = `${source.publicUrl || ""}`.trim();
  target.downloadUrl = `${source.downloadUrl || source.publicUrl || ""}`.trim();
  target.storagePath = `${source.storagePath || ""}`.trim();
  target.downloadStatus = "aliased_duplicate";
  target.status = "downloaded";
  if (!target.documentId && source.documentId) {
    target.documentId = source.documentId;
  }
  if (!target.action?.documentId && source.documentId) {
    target.action = { ...(target.action || {}), documentId: source.documentId };
  }
}

/**
 * Fallback when Approved “Approved Plan Set…” row has no downloadable id on DOM:
 * reuse an uploaded Plan Set artifact only for that package row.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 */
function arlingtonApplyApprovedDocumentsPlanSetFallbackAlias(
  target,
  source,
) {
  target.publicUrl = `${source.publicUrl || ""}`.trim();
  target.downloadUrl = `${source.downloadUrl || source.publicUrl || ""}`.trim();
  target.storagePath = `${source.storagePath || ""}`.trim();
  target.downloadStatus = "aliased_plan_set";
  target.status = "downloaded";
  if (!target.documentId && source.documentId) {
    target.documentId = source.documentId;
  }
  if (!target.action?.documentId && source.documentId) {
    target.action = { ...(target.action || {}), documentId: source.documentId };
  }
}

function arlingtonPlanReviewDocIsUploaded(d) {
  if (!d || typeof d !== "object") return false;
  const hasUrl = !!`${d.publicUrl || d.downloadUrl || ""}`.trim();
  return (
    hasUrl &&
    (`${d.downloadStatus || ""}`.trim() === "uploaded" ||
      `${d.downloadStatus || ""}`.trim() === "aliased_duplicate" ||
      `${d.downloadStatus || ""}`.trim() === "aliased_attachment" ||
      `${d.downloadStatus || ""}`.trim() === "aliased_plan_set" ||
      `${d.status || ""}`.trim() === "downloaded")
  );
}

/** Plan Set documents list from persisted `portal_data` (Arlington integrated shape). */
function arlingtonPortalDataPlanSetDocuments(portalData) {
  const pr = portalData?.tabs?.planReview;
  if (!pr || typeof pr !== "object") return undefined;
  const tabs =
    pr.tabs ||
    (pr.arlingtonPlanReview && typeof pr.arlingtonPlanReview === "object"
      ? /** @type {Record<string, unknown>} */ (pr.arlingtonPlanReview).tabs
      : null);
  return tabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
}

/**
 * Prior DB row has a usable Plan Set (rows + at least one URL/id/uploaded doc).
 * @param {Record<string, unknown> | null | undefined} portalData
 */
function arlingtonPortalDataHasValidPlanSet(portalData) {
  const docs = arlingtonPortalDataPlanSetDocuments(portalData);
  if (!Array.isArray(docs) || docs.length === 0) return false;
  return docs.some((d) => {
    if (!d || typeof d !== "object") return false;
    if (`${d.publicUrl || ""}`.trim() || `${d.downloadUrl || ""}`.trim())
      return true;
    const id = `${d.documentId || d.action?.documentId || ""}`.trim();
    if (id) return true;
    if (arlingtonPlanReviewDocIsUploaded(d)) return true;
    if (`${d.storagePath || ""}`.trim()) return true;
    return false;
  });
}

/**
 * @param {ReturnType<typeof defaultArlingtonIntegratedTabsSkeleton> | null | undefined} integratedTabs
 */
function arlingtonIntegratedTabsPlanSetValid(integratedTabs) {
  const docs =
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  if (!Array.isArray(docs) || docs.length < 1) return false;
  return docs.some((d) => {
    if (!d || typeof d !== "object") return false;
    if (`${d.publicUrl || ""}`.trim() || `${d.downloadUrl || ""}`.trim())
      return true;
    const id = `${d.documentId || d.action?.documentId || ""}`.trim();
    return !!id;
  });
}

/**
 * True when the integrated tabs object has none of the user-visible Arlington Plan Review payloads.
 * @param {Record<string, unknown> | null | undefined} tabsLike
 */
function arlingtonIntegratedPlanReviewIsEffectivelyEmpty(tabsLike) {
  if (!tabsLike || typeof tabsLike !== "object") return true;
  const ps = tabsLike?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  const rr = tabsLike?.reviewResultsAndMarkups?.documents;
  const ad = tabsLike?.approvedDocuments?.documents;
  const piFields = tabsLike?.projectInformation?.fields;
  const len = (a) => (Array.isArray(a) ? a.length : 0);
  return (
    len(ps) === 0 &&
    len(rr) === 0 &&
    len(ad) === 0 &&
    (!Array.isArray(piFields) || piFields.length === 0)
  );
}

/**
 * Replace scraped Plan Review with the existing DB blob when ERA/MS/OnBase failed or produced an empty skeleton.
 * @returns {boolean} whether prior planReview was restored
 */
function arlingtonMaybePreservePlanReviewInPortalPayload(
  portalPayloadForDb,
  existingPortalData,
  /** @type {{ newIntegratedTabsEmpty: boolean }} */ opts,
) {
  if (
    !portalPayloadForDb ||
    typeof portalPayloadForDb !== "object" ||
    !existingPortalData ||
    typeof existingPortalData !== "object"
  ) {
    return false;
  }
  const newWrap = portalPayloadForDb.tabs?.planReview;
  const priorWrap = existingPortalData.tabs?.planReview;
  if (
    !newWrap ||
    typeof newWrap !== "object" ||
    priorWrap == null ||
    typeof priorWrap !== "object"
  )
    return false;

  const priorHasTabs =
    priorWrap.tabs && typeof priorWrap.tabs === "object";

  const newTabs = /** @type {Record<string, unknown>} */ (newWrap).tabs;
  const newIntegratedEmptyExplicit =
    arlingtonIntegratedPlanReviewIsEffectivelyEmpty(newTabs);

  const newIntegratedEmpty =
    opts?.newIntegratedTabsEmpty === true || newIntegratedEmptyExplicit;

  const priorValid = priorHasTabs
    ? arlingtonPortalDataHasValidPlanSet({
        tabs: { planReview: priorWrap },
      })
    : false;

  const explicitShouldNotPersist =
    typeof /** @type {Record<string, unknown>} */ (newWrap).shouldPersist ===
      "boolean" &&
    /** @type {Record<string, unknown>} */ (newWrap).shouldPersist === false;

  const explicitShouldPersist =
    typeof /** @type {Record<string, unknown>} */ (newWrap).shouldPersist ===
      "boolean" &&
    /** @type {Record<string, unknown>} */ (newWrap).shouldPersist === true;

  /** @type {Record<string, unknown>} */
  const nw = /** @type {Record<string, unknown>} */ (newWrap);
  const preserveWeak = nw.preservePreviousPlanReview === true;

  /** Marked selective update that persisted successfully must never be replaced by prior blob. */
  const isSuccessfulSelectiveUpdate =
    nw._arlingtonSelectiveUpdate === true && !explicitShouldNotPersist;

  const mustPreserve =
    !explicitShouldPersist &&
    !isSuccessfulSelectiveUpdate &&
    (preserveWeak ||
      (!!priorHasTabs &&
        priorValid &&
        (explicitShouldNotPersist || newIntegratedEmpty)));

  if (!mustPreserve) {
    if (isSuccessfulSelectiveUpdate) {
      console.log(
        `[Arlington][PlanReview] selective ${`${nw._arlingtonSelectiveScope || ""}`.trim() || "scoped"} update persisted — not restoring prior planReview blob`,
      );
    }
    return false;
  }

  console.log(
    "[Arlington][PlanReview] ERMS unavailable; preserving existing Plan Review data",
  );
  if (explicitShouldNotPersist) {
    console.log(
      "[Arlington][PlanReview] not overwriting existing planReview because shouldPersist=false",
    );
  }

  portalPayloadForDb.tabs = portalPayloadForDb.tabs || {};
  /** @type {Record<string, unknown>} */
  const tabsOut = /** @type {Record<string, unknown>} */ (
    portalPayloadForDb.tabs
  );
  tabsOut.planReview =
    structuredCloneWorksSafe(priorWrap) ?? /** @type {unknown} */ (priorWrap);

  const errPrev = portalPayloadForDb.planReviewLastError;
  if (errPrev && typeof errPrev === "object") {
    portalPayloadForDb.planReviewLastError = errPrev;
  } else {
    portalPayloadForDb.planReviewLastError = {
      type: "erms_iframe_not_ready",
      message:
        "Plan Review iframe did not load / OnBase session failed",
      at: new Date().toISOString(),
    };
  }
  return true;
}

function arlingtonWeakNewPlanReview(integratedTabs) {
  return !arlingtonIntegratedTabsPlanSetValid(integratedTabs);
}

function arlingtonFindUploadedPlanReviewDoc(
  docLists,
  { documentId, rowKey, normalizedName },
) {
  const lists = Array.isArray(docLists) ? docLists : [docLists];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      if (!arlingtonPlanReviewDocIsUploaded(d)) continue;
      if (documentId) {
        const id = `${d.documentId || d.action?.documentId || ""}`.trim();
        if (id && id === documentId) return d;
      }
      if (rowKey) {
        const k = arlingtonIntegratedRowDedupeKey(
          d.name || d.filename || "",
          d.documentDate || "",
          d.size || "",
          d.revision || "",
        );
        if (k === rowKey) return d;
      }
      if (normalizedName) {
        const nm = planReviewNormAttachmentName(d);
        if (nm && nm === normalizedName) return d;
      }
    }
  }
  return null;
}

/** Plan Set / secondary alias: document id, dedupe key, then normalized filename. */
function arlingtonFindSecondaryDocAlias(docLists, { documentId, rowKey, name }) {
  const normalizedName = name
    ? planReviewNormAttachmentName({ name })
    : "";
  return (
    arlingtonFindUploadedPlanReviewDoc(docLists, { documentId }) ||
    arlingtonFindUploadedPlanReviewDoc(docLists, { rowKey }) ||
    (normalizedName
      ? arlingtonFindUploadedPlanReviewDoc(docLists, { normalizedName })
      : null)
  );
}

function arlingtonSecondaryTabDocDedupeKey(doc) {
  return `${doc?.documentId || doc?.action?.documentId || ""}|${doc?.name || doc?.filename || ""}|${doc?.sourceApi || ""}`;
}

function arlingtonMergeSecondaryTabDocuments(dest, incoming) {
  if (!Array.isArray(dest) || !Array.isArray(incoming)) return;
  const seen = new Set(dest.map((d) => arlingtonSecondaryTabDocDedupeKey(d)));
  for (const doc of incoming) {
    if (!doc || typeof doc !== "object") continue;
    const key = arlingtonSecondaryTabDocDedupeKey(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    dest.push(doc);
  }
}

function arlingtonApiRowToSecondaryTabDoc(origin, row, tabKey, sourceApi) {
  const nameGuess = arlingtonInferErmsDocName(row);
  const planDocId = arlingtonExtractErmsPlanDocId(row);
  let docDate = "";
  let sizeGuess = "";
  let revision = "";
  let discipline = "";
  let sheetType = "";
  let reviewStatus = "";
  let reviewer = "";
  let documentType = "";
  if (row && typeof row === "object") {
    const o = /** @type {Record<string, unknown>} */ (row);
    docDate = `${o.DocumentDate ?? o.documentDate ?? o.ApprovalDate ?? o.approvalDate ?? o.Date ?? o.date ?? ""}`.trim();
    sizeGuess = `${o.FileSize ?? o.fileSize ?? o.Size ?? o.size ?? ""}`.trim().slice(0, 40);
    revision = `${o.RevisionNumber ?? o.revision ?? ""}`.trim().slice(0, 80);
    discipline = `${o.Discipline ?? o.discipline ?? ""}`.trim();
    sheetType = `${o.SheetType ?? o.sheetType ?? ""}`.trim();
    reviewStatus = `${o.Status ?? o.status ?? o.ReviewStatus ?? o.reviewStatus ?? ""}`.trim();
    reviewer = `${o.Reviewer ?? o.reviewer ?? o.ReviewedBy ?? o.reviewedBy ?? ""}`.trim();
    documentType = `${o.DocumentType ?? o.documentType ?? o.DocType ?? o.docType ?? o.Type ?? o.type ?? ""}`.trim();
    if (sourceApi === "Comments") {
      const commentName = `${o.CommentText ?? o.commentText ?? o.Subject ?? o.subject ?? o.Title ?? o.title ?? ""}`.trim();
      if (commentName) {
        /** prefer comment text as display name when present */
      }
    }
  }

  let displayName = nameGuess;
  if (sourceApi === "Comments" && row && typeof row === "object") {
    const o = /** @type {Record<string, unknown>} */ (row);
    const c = `${o.CommentText ?? o.commentText ?? o.Subject ?? o.subject ?? ""}`.trim();
    if (c) displayName = c.slice(0, 260);
  }

  /** @type {Record<string, unknown>} */
  const out = {
    name: displayName,
    filename: displayName,
    discipline,
    sheetType: sheetType || documentType,
    documentType,
    documentDate: docDate.slice(0, 80),
    size: sizeGuess,
    reviewStatus,
    reviewer,
    revision,
    status: "metadata_only",
    downloadStatus: "metadata_only",
    storagePath: "",
    publicUrl: "",
    downloadUrl: "",
    sourceTab: tabKey,
    source: "api_fallback",
    sourceApi,
    raw: row,
  };

  if (planDocId) {
    out.documentId = planDocId;
    out.action = { documentId: planDocId };
  }
  const crmDh = arlExtractNumericDocHandleFromErmsRaw(row);
  if (crmDh) out.secondaryCrmDocHandle = crmDh;

  return out;
}

function arlingtonAccelaDocTypeToField(row) {
  if (!row || typeof row !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (row);
  const label = `${o.DocTypeName ?? o.docTypeName ?? o.Name ?? o.name ?? o.Type ?? o.type ?? ""}`.trim();
  if (!label) return null;
  const parts = [];
  for (const k of [
    "Description",
    "description",
    "Required",
    "required",
    "Category",
    "category",
    "Status",
    "status",
  ]) {
    const v = `${o[k] ?? ""}`.trim();
    if (v) parts.push(v);
  }
  return { label: label.slice(0, 200), value: parts.join(" | ").slice(0, 500) };
}

function arlingtonApiRowToCommentEntry(row) {
  if (!row || typeof row !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (row);
  const text = `${o.CommentText ?? o.commentText ?? o.Text ?? o.text ?? o.Subject ?? o.subject ?? o.Description ?? o.description ?? ""}`.trim();
  if (!text) return null;
  const reviewer = `${o.Reviewer ?? o.reviewer ?? o.CreatedBy ?? o.createdBy ?? o.UserName ?? o.userName ?? ""}`.trim();
  const documentDate = `${o.CommentDate ?? o.commentDate ?? o.Date ?? o.date ?? o.CreatedDate ?? o.createdDate ?? ""}`.trim();
  return {
    text: text.slice(0, 2000),
    reviewer: reviewer.slice(0, 120),
    documentDate: documentDate.slice(0, 80),
    sourceApi: "Comments",
    raw: row,
  };
}

function arlingtonMergeCommentEntries(dest, incoming) {
  if (!Array.isArray(dest) || !Array.isArray(incoming)) return;
  for (const c of incoming) {
    if (!c || !c.text) continue;
    const key = `${c.text}`.slice(0, 120).toLowerCase();
    const exists = dest.some(
      (d) =>
        `${d?.text || ""}`.slice(0, 120).toLowerCase() === key,
    );
    if (!exists) dest.push(c);
  }
}

/** Dedupe within a tab — matches UI expectation (name + date + logical tab bucket). */
function arlingtonDomSecondaryDedupeKey(doc) {
  if (!doc || typeof doc !== "object") return "";
  const d = /** @type {Record<string, unknown>} */ (doc);
  const tab = `${d.sourceTab || ""}`.trim().toLowerCase();
  let id = `${d.documentId ?? ""}`.trim();
  if (!id && d.action && typeof d.action === "object") {
    id = `${
      /** @type {Record<string, unknown>} */ (d.action).documentId ?? ""
    }`.trim();
  }
  const n = `${d.name || d.filename || ""}`.trim().replace(/\s+/g, " ").toLowerCase();
  const date = `${d.documentDate || ""}`.trim().replace(/\s+/g, " ").toLowerCase();
  const rowIx =
    d.secondaryDomRowIndex != null && `${d.secondaryDomRowIndex}` !== ""
      ? `|r${String(d.secondaryDomRowIndex)}`
      : "";
  if (/^\d+$/.test(id)) return `${tab}|id:${id}`;
  return `${tab}|norow|${n}|${date}${rowIx}`;
}

function arlingtonMergeSecondaryDomDocuments(dest, incoming) {
  if (!Array.isArray(dest) || !Array.isArray(incoming)) return;
  const seen = new Set(dest.map((d) => arlingtonDomSecondaryDedupeKey(d)));
  for (const doc of incoming) {
    if (!doc || typeof doc !== "object") continue;
    const k = arlingtonDomSecondaryDedupeKey(doc);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    dest.push(doc);
  }
}

/**
 * API hydrate for secondary tabs: comments + PI field metadata only.
 * Review Results / Approved **document rows** must come from active ERMS tab DOM first;
 * ResponseLetters/ApplicationDocs APIs are fallback when DOM yields zero rows (see below).
 */
function arlingtonApplyApiRowsToSecondaryTabsCommentsAndPi(
  integratedTabs,
  apiRows,
  origin,
) {
  if (!integratedTabs || !apiRows) return;

  const rrComments = integratedTabs.reviewResultsAndMarkups?.comments;
  const piFields = integratedTabs.projectInformation?.fields;
  const piReqTypes = integratedTabs.projectInformation?.requiredDocumentTypes;

  for (const row of apiRows.comments || []) {
    if (!row || typeof row !== "object") continue;
    const commentEntry = arlingtonApiRowToCommentEntry(row);
    if (Array.isArray(rrComments) && commentEntry) {
      arlingtonMergeCommentEntries(rrComments, [commentEntry]);
    }
  }

  if (Array.isArray(piFields) || Array.isArray(piReqTypes)) {
    for (const row of apiRows.accelaDocTypes || []) {
      const field = arlingtonAccelaDocTypeToField(row);
      if (field) {
        if (Array.isArray(piFields)) {
          const exists = piFields.some(
            (f) =>
              `${f?.label || ""}`.trim().toLowerCase() ===
              `${field.label || ""}`.trim().toLowerCase(),
          );
          if (!exists) piFields.push(field);
        }
        if (Array.isArray(piReqTypes)) {
          const exists = piReqTypes.some(
            (f) =>
              `${f?.label || ""}`.trim().toLowerCase() ===
              `${field.label || ""}`.trim().toLowerCase(),
          );
          if (!exists) piReqTypes.push(field);
        }
      }
    }
  }
}

/**
 * Restore RR/AD from prior portal_data or mark dom_extraction_failed when empty.
 * @param {ReturnType<typeof defaultArlingtonIntegratedTabsSkeleton>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} priorPortalData
 */
function arlingtonRestoreSecondaryFromPriorOrMarkDomFailed(
  integratedTabs,
  priorPortalData,
) {
  if (!integratedTabs) return;
  const priorTabs = priorPortalData?.tabs?.planReview?.tabs;
  const rrDest = integratedTabs.reviewResultsAndMarkups;
  const adDest = integratedTabs.approvedDocuments;
  if (!rrDest || !adDest) return;

  delete rrDest.secondaryExtractionStatus;
  delete adDest.secondaryExtractionStatus;

  const priorRr = priorTabs?.reviewResultsAndMarkups?.documents;
  const priorAd = priorTabs?.approvedDocuments?.documents;

  if (
    Array.isArray(rrDest.documents) &&
    rrDest.documents.length === 0 &&
    Array.isArray(priorRr) &&
    priorRr.length
  ) {
    rrDest.documents = structuredCloneWorksSafe(priorRr);
  }
  if (
    Array.isArray(adDest.documents) &&
    adDest.documents.length === 0 &&
    Array.isArray(priorAd) &&
    priorAd.length
  ) {
    adDest.documents = structuredCloneWorksSafe(priorAd);
  }

  if (Array.isArray(rrDest.documents) && rrDest.documents.length === 0) {
    rrDest.secondaryExtractionStatus = "dom_extraction_failed";
  }
  if (Array.isArray(adDest.documents) && adDest.documents.length === 0) {
    adDest.secondaryExtractionStatus = "dom_extraction_failed";
  }
}

/**
 * When iframe+Plan Set succeeded but RR/AD DOM both stayed empty, never replace RR/Approved
 * with misleading API metadata-only rows — restore prior or mark dom failure; optional PI docs still merged.
 *
 * @param {Record<string, unknown> | null | undefined} priorPortalData
 */
function arlingtonMaybeApplySecondaryApiAfterDom(
  integratedTabs,
  prApiSecondaryFallback,
  planSetErmsOrigin,
  planReviewState,
  existingValidPlanReview,
  priorPortalData,
) {
  if (!prApiSecondaryFallback) return;

  const nfNonApi = (arr) =>
    Array.isArray(arr)
      ? arr.filter((d) => d && `${d.source || ""}` !== "api_fallback")
          .length
      : 0;

  const rrN = nfNonApi(integratedTabs.reviewResultsAndMarkups?.documents);
  const adN = nfNonApi(integratedTabs.approvedDocuments?.documents);

  const secondaryDomBothEmpty =
    planReviewState &&
    planReviewState.iframeReady === true &&
    planReviewState.planSetValid === true &&
    rrN === 0 &&
    adN === 0;

  if (secondaryDomBothEmpty) {
    console.log(
      "[Arlington][PlanReview] secondary DOM failed; not replacing secondary tabs with API fallback metadata",
    );
    arlingtonRestoreSecondaryFromPriorOrMarkDomFailed(
      integratedTabs,
      priorPortalData,
    );
    if (planReviewState && typeof planReviewState === "object") {
      planReviewState.suppressedSecondaryApiMetadata = true;
      planReviewState.secondaryDomExtractionFailed = true;
    }
    if (existingValidPlanReview) return;
    arlingtonApplySecondaryApiDocumentsWhenDomEmpty(
      integratedTabs,
      prApiSecondaryFallback,
      planSetErmsOrigin,
      {
        existingValidPlanReview,
        planReviewStateRef: planReviewState,
        skipRrAndApprovedApi: true,
      },
    );
    return;
  }

  arlingtonApplySecondaryApiDocumentsWhenDomEmpty(
    integratedTabs,
    prApiSecondaryFallback,
    planSetErmsOrigin,
    {
      existingValidPlanReview,
      planReviewStateRef: planReviewState,
    },
  );
}

/**
 * Fallback only: when DOM did not populate document rows for RR / Approved / PI docs.
 * Skips document-level API merge when DB already has a valid Plan Set (preserve path).
 * @param {{
 *   existingValidPlanReview?: boolean,
 *   planReviewStateRef?: { usedApiFallback?: boolean } | null,
 *   skipRrAndApprovedApi?: boolean,
 * }} opts
 */
function arlingtonApplySecondaryApiDocumentsWhenDomEmpty(
  integratedTabs,
  apiRows,
  origin,
  opts,
) {
  if (!integratedTabs || !apiRows) return;
  const {
    existingValidPlanReview = false,
    planReviewStateRef = null,
    skipRrAndApprovedApi = false,
  } = opts && typeof opts === "object" ? opts : {};

  if (existingValidPlanReview) {
    console.log(
      "[Arlington][PlanReview] API document fallback skipped (existing valid Plan Review in DB)",
    );
    return;
  }

  const rrSink = integratedTabs.reviewResultsAndMarkups?.documents;
  const adSink = integratedTabs.approvedDocuments?.documents;

  if (!skipRrAndApprovedApi && Array.isArray(rrSink) && rrSink.length === 0) {
    const nBefore = rrSink.length;
    for (const row of apiRows.responseLetters || []) {
      if (!row || typeof row !== "object") continue;
      arlingtonMergeSecondaryTabDocuments(rrSink, [
        arlingtonApiRowToSecondaryTabDoc(
          origin,
          row,
          "reviewResultsAndMarkups",
          "ResponseLetters",
        ),
      ]);
    }
    for (const row of apiRows.comments || []) {
      if (!row || typeof row !== "object") continue;
      arlingtonMergeSecondaryTabDocuments(rrSink, [
        arlingtonApiRowToSecondaryTabDoc(
          origin,
          row,
          "reviewResultsAndMarkups",
          "Comments",
        ),
      ]);
    }
    if (
      rrSink.length > nBefore &&
      planReviewStateRef &&
      typeof planReviewStateRef === "object"
    ) {
      planReviewStateRef.usedApiFallback = true;
    }
    console.log(
      `[Arlington][PlanReview] Review Results fallback API rows=${(apiRows.responseLetters || []).length} + comments-docs=${(apiRows.comments || []).length} (DOM empty)`,
    );
  }

  if (!skipRrAndApprovedApi && Array.isArray(adSink) && adSink.length === 0) {
    const nBefore = adSink.length;
    for (const row of apiRows.applicationDocs || []) {
      if (!row || typeof row !== "object") continue;
      arlingtonMergeSecondaryTabDocuments(adSink, [
        arlingtonApiRowToSecondaryTabDoc(
          origin,
          row,
          "approvedDocuments",
          "ApplicationDocs",
        ),
      ]);
    }
    if (
      adSink.length > nBefore &&
      planReviewStateRef &&
      typeof planReviewStateRef === "object"
    ) {
      planReviewStateRef.usedApiFallback = true;
    }
    console.log(
      `[Arlington][PlanReview] Approved Documents fallback ApplicationDocs=${(apiRows.applicationDocs || []).length} (DOM empty)`,
    );
  }

  const piDocs = integratedTabs.projectInformation?.documents;
  if (Array.isArray(piDocs) && piDocs.length === 0) {
    const nBefore = piDocs.length;
    for (const row of apiRows.accelaDocTypes || []) {
      if (!row || typeof row !== "object") continue;
      const planDocId = arlingtonExtractErmsPlanDocId(row);
      if (!planDocId) continue;
      arlingtonMergeSecondaryTabDocuments(piDocs, [
        arlingtonApiRowToSecondaryTabDoc(
          origin,
          row,
          "projectInformation",
          "AccelaDocTypes",
        ),
      ]);
    }
    if (
      piDocs.length > nBefore &&
      planReviewStateRef &&
      typeof planReviewStateRef === "object"
    ) {
      planReviewStateRef.usedApiFallback = true;
    }
  }
}

/** @deprecated Prefer comments+pi hydrate + DOM + fallback helpers */
function arlingtonApplyApiRowsToSecondaryTabs(integratedTabs, apiRows, origin) {
  arlingtonApplyApiRowsToSecondaryTabsCommentsAndPi(integratedTabs, apiRows, origin);
  arlingtonApplySecondaryApiDocumentsWhenDomEmpty(integratedTabs, apiRows, origin, {});
}

/**
 * Process invoke JSON/binary -> poll -> DocumentStream -> Supabase (shared tail).
 */
async function arlingtonPlanSetProcessInvokeResponseToUpload(
  networkPage,
  clickTarget,
  invokeResp,
  rowMeta,
  downloadCtx,
  rowKey,
  prSeenRowKeys,
  ermsOriginHint,
  docName,
  successLogLabel = "Plan Set",
  documentId = "",
) {
  const ermsOrigin =
    `${ermsOriginHint || ""}`.trim() || ARLINGTON_ERMS_ORIGIN_FALLBACK;

  const ist = invokeResp ? invokeResp.status() : 0;
  const ict = invokeResp
    ? `${invokeResp.headers()["content-type"] || invokeResp.headers()["Content-Type"] || ""}`
    : "";

  console.log(
    `[Arlington][PlanReview] Plan Set invoke POST status=${ist} ct=${ict}`,
  );

  /** @type {Buffer | null} */
  let fileBuf = null;
  /** @type {string} */
  let streamId = "";
  /** @type {boolean} */
  let invokeStreamTimedOut = false;

  const ictLow = ict.toLowerCase();
  if (
    invokeResp &&
    (/\bpdf\b|octet-stream|download/i.test(ictLow) ||
      /\.pdf/i.test(invokeResp.url()))
  ) {
    try {
      fileBuf = Buffer.from(
        await arlingtonPlanSetWithTimeout(
          invokeResp.body(),
          15000,
          "plan_set_invoke_body_read",
        ),
      );
    } catch (_) {
      fileBuf = null;
    }
    console.log(
      `[Arlington][PlanReview] Plan Set invoke body preview=[binary ${fileBuf ? fileBuf.length : 0} bytes]`,
    );
  } else {
    let invokeBodyText = "";
    try {
      invokeBodyText = `${await arlingtonPlanSetWithTimeout(
        invokeResp.text(),
        15000,
        "plan_set_invoke_body_read",
      )}`;
    } catch (readErr) {
      invokeBodyText = "";
      console.log(
        `[Arlington][PlanReview] Plan Set invoke body preview= read_error=${readErr && readErr.message ? readErr.message : readErr}`,
      );
    }
    if (invokeBodyText) {
      console.log(
        `[Arlington][PlanReview] Plan Set invoke body preview=${invokeBodyText.slice(0, 300)}`,
      );
    }

    try {
      const invokeJson = JSON.parse(invokeBodyText || "{}");
      streamId = `${invokeJson.StreamID || invokeJson.streamId || invokeJson.StreamId || ""}`.trim();
      const invokeErr = `${invokeJson.ErrorMessage || ""}`.trim();
      if (invokeErr) {
        return {
          publicUrl: "",
          storagePath: "",
          downloadStatus: "invoke_error",
          failureReason: invokeErr.slice(0, 500),
        };
      }
    } catch (_) {
      /**/
    }

    if (streamId) {
      console.log(
        `[Arlington][PlanReview] ${successLogLabel} streamId=${streamId} documentId=${documentId || "(from invoke)"}`,
      );
      try {
        const streamPack = await arlingtonPlanSetFetchPdfViaInvokePollStream(
          networkPage,
          clickTarget,
          ermsOrigin,
          streamId,
          docName,
          successLogLabel,
          downloadCtx,
          documentId,
        );
        invokeStreamTimedOut = !!streamPack.streamTimedOut;
        fileBuf = streamPack.pdf;
      } catch (streamErr) {
        if (arlingtonErmsSessionClosedMessage(streamErr)) {
          return arlingtonPlanReviewSessionClosedOutcome();
        }
        throw streamErr;
      }
    }
  }

  if (invokeStreamTimedOut && (!fileBuf || !Buffer.byteLength(fileBuf))) {
    return {
      publicUrl: "",
      storagePath: "",
      downloadStatus: "pending_stream_timeout",
      failureReason: "stream_timeout",
    };
  }
  if (
    fileBuf &&
    fileBuf.length &&
    arlingtonPlanSetPdfIsSuspiciousPlaceholder(fileBuf, docName)
  ) {
    fileBuf = null;
  }

  if (fileBuf && fileBuf.length) {
    let uploaded;
    try {
      uploaded = await arlingtonPlanSetWithTimeout(
        persistArlingtonPlanSetBufferPdf(
          fileBuf,
          rowMeta,
          downloadCtx,
          rowKey,
          prSeenRowKeys,
          successLogLabel,
          documentId,
        ),
        60000,
        "plan_set_upload",
      );
    } catch (uploadErr) {
      if (arlingtonErmsSessionClosedMessage(uploadErr)) {
        return arlingtonPlanReviewSessionClosedOutcome();
      }
      return {
        publicUrl: "",
        storagePath: "",
        downloadStatus: "upload_timeout",
        failureReason:
          uploadErr && uploadErr.message ? uploadErr.message : String(uploadErr),
      };
    }

    if (
      `${uploaded.publicUrl || ""}`.trim() &&
      `${uploaded.downloadStatus || ""}`.trim() === "uploaded"
    ) {
      console.log(
        `[Arlington][PlanReview] ${successLogLabel} download OK ${docName} via InvokeDownloadDocument->PollDownloadDocument->DocumentStream documentId=${documentId || "(unknown)"}`,
      );
      if (clickTarget && typeof clickTarget.page === "function") {
        await dismissBlockingModalsInArlingtonPlanReviewFrame(clickTarget).catch(
          () => {},
        );
      }
    }
    return uploaded;
  }

  return {
    publicUrl: "",
    storagePath: "",
    downloadStatus: "no_file_buffer",
    failureReason: streamId
      ? "invoke_poll_stream_failed"
      : "no_file_after_invoke",
  };
}

/**
 * API/direct path: POST InvokeDownloadDocument with plandocid (no DOM click).
 */
async function arlingtonErmsDownloadViaDirectPlanDocInvoke(
  networkPage,
  clickTarget,
  planDocId,
  rowMeta,
  downloadCtx,
  rowKey,
  prSeenRowKeys,
  ermsOriginHint,
  logLabel = "Plan Review",
) {
  const ermsOrigin =
    `${ermsOriginHint || ""}`.trim() || ARLINGTON_ERMS_ORIGIN_FALLBACK;
  const docId = `${planDocId || ""}`.trim();
  const docName =
    String(rowMeta.name || "plan_review_doc")
      .split(/[\r\n|]+/)[0]
      .trim() || "plan_review_doc";

  if (!/^\d+$/.test(docId)) {
    return {
      publicUrl: "",
      storagePath: "",
      downloadStatus: "invoke_error",
      failureReason: "invalid_plan_doc_id",
    };
  }

  let token = "";
  try {
    token = await arlingtonPlanSetReadErmsVerificationToken(clickTarget, {
      networkPage,
      downloadCtx,
      documentId: docId,
    });
  } catch (tokenErr) {
    if (arlingtonErmsSessionClosedMessage(tokenErr)) {
      return arlingtonPlanReviewSessionClosedOutcome();
    }
    throw tokenErr;
  }
  if (!token) {
    return {
      publicUrl: "",
      storagePath: "",
      downloadStatus: "pending_token_missing",
      failureReason: "missing_verification_token",
    };
  }

  const referer = `${ermsOrigin.replace(/\/$/, "")}/PlanReviewIntegrated/plan/ViewDocuments`;
  const invokeBody = new URLSearchParams();
  invokeBody.set("__RequestVerificationToken", token);
  invokeBody.set("plandocid", docId);

  if (!arlingtonPlanReviewCanStartDocumentStream(downloadCtx)) {
    return {
      publicUrl: "",
      storagePath: "",
      downloadStatus: "pending_not_attempted",
      failureReason: "insufficient_remaining_budget",
    };
  }

  arlingtonPlanReviewTouchKeepalive(downloadCtx, docId);

  /** @type {import('playwright').APIResponse | null} */
  let apiInvoke = null;
  try {
    apiInvoke = await arlingtonPlanSetWithTimeout(
      networkPage.request.post(
        `${ermsOrigin.replace(/\/$/, "")}/PlanReviewIntegrated/Plan/InvokeDownloadDocument`,
        {
          timeout: 30000,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Referer: referer,
          },
          data: invokeBody.toString(),
        },
      ),
      35000,
      "plan_set_direct_invoke_post",
    );
  } catch (invokeErr) {
    if (arlingtonErmsSessionClosedMessage(invokeErr)) {
      return arlingtonPlanReviewSessionClosedOutcome();
    }
    return {
      publicUrl: "",
      storagePath: "",
      downloadStatus: "invoke_error",
      failureReason:
        invokeErr && invokeErr.message ? invokeErr.message : String(invokeErr),
    };
  }

  arlingtonPlanReviewTouchKeepalive(downloadCtx, docId);

  const status = apiInvoke.status();
  const ct = `${apiInvoke.headers()["content-type"] || apiInvoke.headers()["Content-Type"] || ""}`;
  console.log(
    `[Arlington][PlanReview] ${logLabel} InvokeDownloadDocument POST status=${status} ct=${ct} plandocid=${docId}`,
  );

  const bodyText = `${await apiInvoke.text().catch(() => "")}`;
  console.log(
    `[Arlington][PlanReview] ${logLabel} invoke body preview=${bodyText.slice(0, 300)}`,
  );

  const fakeResp = {
    status: () => status,
    headers: () => ({ "content-type": ct }),
    url: () => `${ermsOrigin}/PlanReviewIntegrated/Plan/InvokeDownloadDocument`,
    text: async () => bodyText,
    body: async () => Buffer.from(bodyText),
  };

  return arlingtonPlanSetProcessInvokeResponseToUpload(
    networkPage,
    clickTarget,
    /** @type {import('playwright').Response} */ (fakeResp),
    rowMeta,
    downloadCtx,
    rowKey,
    prSeenRowKeys,
    ermsOriginHint,
    docName,
    logLabel,
    docId,
  );
}

/**
 * API-first ERMS download by plandocid — no DOM row or panel click required.
 */
async function downloadArlingtonErmsDocumentById({
  networkPage,
  tokenTarget,
  documentId,
  doc,
  rowMeta,
  downloadCtx,
  rowKey,
  prSeenRowKeys,
  ermsOrigin,
  logLabel = "Plan Review",
}) {
  const docId = `${documentId || doc?.documentId || doc?.action?.documentId || ""}`.trim();
  if (!/^\d+$/.test(docId)) {
    return {
      publicUrl: "",
      storagePath: "",
      downloadStatus: "metadata_only",
      failureReason: "missing_document_id",
    };
  }

  return arlingtonErmsDownloadViaDirectPlanDocInvoke(
    networkPage,
    tokenTarget,
    docId,
    rowMeta,
    downloadCtx,
    rowKey,
    prSeenRowKeys,
    ermsOrigin,
    logLabel,
  );
}

/**
 * Public helper: Invoke → Poll → DocumentStream by ERMS document id (no DOM row).
 */
async function downloadErmsDocumentById({
  documentId,
  doc,
  sourceTab,
  prFrame,
  networkPage,
  projectId,
  permitNumber,
  userId,
  downloadCtx,
  rowKey,
  prSeenRowKeys,
  ermsOrigin,
  logLabel,
}) {
  const nameGuess =
    `${doc?.name || doc?.filename || ""}`.trim() || "plan_review_doc";
  const rowMeta = {
    name: nameGuess,
    documentDate: doc?.documentDate || "",
    discipline: doc?.discipline || "",
    sheetType: doc?.sheetType || doc?.documentType || "",
    description: doc?.description || "",
    revision: doc?.revision || "",
    uploadStatus: doc?.uploadStatus || doc?.status || "",
    size: doc?.size || "",
  };
  const ctx =
    downloadCtx ||
    (projectId || permitNumber
      ? {
          supabaseProjectId: projectId,
          permitNumber,
          userId,
        }
      : null);

  return downloadArlingtonErmsDocumentById({
    networkPage: networkPage || (prFrame && typeof prFrame.page === "function" ? prFrame.page() : prFrame),
    tokenTarget: prFrame,
    documentId,
    doc,
    rowMeta,
    downloadCtx: ctx,
    rowKey,
    prSeenRowKeys,
    ermsOrigin,
    logLabel: logLabel || sourceTab || "Plan Review",
  });
}

/**
 * Secondary tabs: download API rows by document id; alias Plan Set duplicates.
 * @returns {Promise<{ downloads: number; metadataOnly: number; aliases: number }>}
 */
async function downloadArlingtonSecondaryApiDocumentsForSink(
  networkPage,
  tokenTarget,
  sink,
  {
    attachmentDedupeKeys,
    prSeenRowKeys,
    downloadCtx,
    ermsOrigin,
    logLabel = "Plan Review",
    aliasDocSources = [],
    downloadSource = "secondary",
  },
) {
  if (!downloadCtx || !Array.isArray(sink) || !sink.length) {
    return { downloads: 0, metadataOnly: 0, aliases: 0 };
  }

  let downloads = 0;
  let metadataOnly = 0;
  let aliases = 0;

  for (const doc of sink) {
    if (downloadCtx.planReviewDownloadsAbortedDeadline === true) {
      break;
    }
    const nameGuess =
      `${doc.name || doc.filename || ""}`.trim() || "(unnamed)";

    const dsEarly = `${doc.downloadStatus || ""}`.trim();
    if (arlingtonErmsSinkDocLooksUploadComplete(doc)) {
      if (
        dsEarly === "aliased_duplicate" ||
        dsEarly === "aliased_attachment" ||
        dsEarly === "aliased_plan_set"
      ) {
        aliases++;
      }
      continue;
    }

    console.log(
      `[Arlington][PlanReview][Secondary] row sourceApi=${doc.sourceApi || "?"} name=${nameGuess} ids=${arlingtonFormatSecondaryRowCandidateIds(doc)}`,
    );

    const docId = arlingtonPickSecondaryRowDocumentId(doc);

    const skipAliasDup =
      `${doc.sourceTab || ""}` === "approvedDocuments" &&
      `${doc.source || ""}` !== "api_fallback" &&
      /Approved Plan Set\b/i.test(nameGuess) &&
      !!docId;

    if (docId) {
      console.log(
        `[Arlington][PlanReview] ${logLabel} download target documentId=${docId} row=${nameGuess}`,
      );
    }

    const rowMeta = {
      name: nameGuess,
      documentDate: doc.documentDate || "",
      discipline: doc.discipline || "",
      sheetType: doc.sheetType || doc.documentType || "",
      description: doc.description || "",
      revision: doc.revision || "",
      uploadStatus: doc.uploadStatus || doc.status || "",
      size: doc.size || "",
    };
    const rowKey = `${arlingtonIntegratedRowDedupeKey(
      rowMeta.name,
      rowMeta.documentDate || "",
      rowMeta.size || "",
      rowMeta.revision || "",
    )}###pid:${docId || "none"}###dom:${doc.secondaryDomRowIndex ?? "na"}`;

    const aliasMatch = skipAliasDup
      ? null
      : arlingtonFindSecondaryDocAlias(aliasDocSources, {
          documentId: docId,
          rowKey,
          name: nameGuess,
        });
    if (aliasMatch) {
      const approvedPackFallback =
        `${doc.sourceTab || ""}` === "approvedDocuments" &&
        `${doc.source || ""}` !== "api_fallback" &&
        /Approved Plan Set\b/i.test(nameGuess) &&
        !docId;
      if (approvedPackFallback) {
        arlingtonApplyApprovedDocumentsPlanSetFallbackAlias(doc, aliasMatch);
        console.log(
          `[Arlington][PlanReview] ${logLabel} approved Plan Set packaged row aliased to Plan Set artifact ${nameGuess}`,
        );
      } else {
        arlingtonApplySecondaryDocAlias(doc, aliasMatch);
        console.log(
          `[Arlington][PlanReview] ${logLabel} duplicate aliased ${nameGuess}`,
        );
      }
      aliases++;
      continue;
    }

    const dedupeHit =
      attachmentDedupeKeys.has(rowKey) || prSeenRowKeys.has(rowKey);

    if (!docId) {
      doc.downloadStatus = "metadata_only";
      doc.status = doc.status || "api_metadata";
      metadataOnly++;
      continue;
    }

    if (arlingtonPlanReviewDocAlreadyAttemptedThisRun(downloadCtx, docId)) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const stopGate = await arlingtonPlanReviewShouldStopBeforeDoc(
      downloadCtx,
      downloadSource,
    );
    if (stopGate.stop) {
      doc.downloadStatus = "pending_not_attempted";
      doc.status = "pending";
      doc.skipReason = stopGate.reason || "batch_limit_reached";
      break;
    }

    arlingtonPlanReviewMarkDocAttemptedThisRun(downloadCtx, docId);
    arlingtonPlanReviewDownloadBegin(downloadCtx, docId);
    try {
      const uploadOutcome = await downloadErmsDocumentById({
        documentId: docId,
        doc,
        sourceTab: logLabel,
        prFrame: tokenTarget,
        networkPage,
        downloadCtx,
        rowKey,
        prSeenRowKeys,
        ermsOrigin,
        logLabel,
      });

      const uploadedOk =
        `${uploadOutcome.downloadStatus || ""}`.trim() === "uploaded" &&
        !!`${uploadOutcome.publicUrl || ""}`.trim();

      if (
        `${uploadOutcome.failureReason || ""}`.trim() ===
        "session_closed_during_download"
      ) {
        await arlingtonPlanReviewMarkDocSessionClosed(doc, downloadCtx);
        continue;
      }

      if (uploadedOk) {
        downloads++;
        arlingtonPlanReviewRecordDownloadSuccess(downloadCtx, downloadSource);
        doc.publicUrl = uploadOutcome.publicUrl;
        doc.downloadUrl = uploadOutcome.publicUrl;
        doc.storagePath = uploadOutcome.storagePath || "";
        doc.size = uploadOutcome.size || doc.size || "";
        doc.documentId = docId;
        doc.action = { ...(doc.action || {}), documentId: docId };
        doc.downloadStatus = "uploaded";
        doc.status = "downloaded";
        delete doc.retryCount;
        delete doc.skipReason;
        console.log(
          `[Arlington][PlanReview] ${logLabel} download OK ${nameGuess}`,
        );
        await arlingtonPlanReviewMaybeCheckpointEvery5Downloads(downloadCtx);
      } else if (
        `${uploadOutcome.downloadStatus || ""}`.trim() ===
        "pending_stream_timeout"
      ) {
        doc.downloadStatus = "pending_stream_timeout";
        doc.status = "pending";
        doc.skipReason = "stream_timeout";
        doc.failureReason = "stream_timeout";
        doc.lastAttemptAt = new Date().toISOString();
        doc.retryCount = (Number(doc.retryCount) || 0) + 1;
        if (downloadCtx && typeof downloadCtx === "object")
          downloadCtx.planReviewPartialPendingDownloads = true;
        console.log(
          `[Arlington][PlanReview] ${logLabel} download pending stream_timeout ${nameGuess}`,
        );
        // eslint-disable-next-line no-await-in-loop
        await arlingtonPlanReviewRecordStreamTimeout(doc, downloadCtx);
        break;
      } else if (
        `${uploadOutcome.downloadStatus || ""}`.trim() ===
        "pending_token_missing"
      ) {
        doc.downloadStatus = "pending_token_missing";
        doc.status = "pending";
        doc.skipReason = "missing_verification_token";
        doc.retryCount = (Number(doc.retryCount) || 0) + 1;
        downloadCtx.planReviewPartialPendingDownloads = true;
        arlingtonPlanReviewRecordHardFailure(downloadCtx);
        console.log(
          `[Arlington][PlanReview] ${logLabel} download pending token_missing ${nameGuess}`,
        );
      } else if (
        `${uploadOutcome.downloadStatus || ""}`.trim() ===
        "pending_not_attempted"
      ) {
        doc.downloadStatus = "pending_not_attempted";
        doc.status = "pending";
        doc.skipReason =
          uploadOutcome.failureReason || "insufficient_remaining_budget";
      } else if (
        `${uploadOutcome.downloadStatus || ""}`.trim() === "oversized_for_supabase"
      ) {
        doc.downloadStatus = "oversized_for_supabase";
        doc.status = "pending";
        doc.skipReason =
          `${uploadOutcome.skipReason || ""}`.trim() ||
          "supabase_object_size_limit";
        doc.fileSizeBytes =
          Number(uploadOutcome.fileSizeBytes ?? uploadOutcome.size) || 0;
        console.log(
          `[Arlington][PlanReview] oversized file skipped upload tab=${logLabel} name=${nameGuess} bytes=${doc.fileSizeBytes || uploadOutcome.size || 0}`,
        );
      } else if (dedupeHit) {
        const aliasRetry = skipAliasDup
          ? null
          : arlingtonFindSecondaryDocAlias(aliasDocSources, {
              documentId: docId,
              rowKey,
              name: nameGuess,
            });
        if (aliasRetry) {
          const approvedPackFallback =
            `${doc.sourceTab || ""}` === "approvedDocuments" &&
            `${doc.source || ""}` !== "api_fallback" &&
            /Approved Plan Set\b/i.test(nameGuess);
          if (approvedPackFallback) {
            arlingtonApplyApprovedDocumentsPlanSetFallbackAlias(
              doc,
              aliasRetry,
            );
          } else {
            arlingtonApplySecondaryDocAlias(doc, aliasRetry);
          }
          console.log(
            `[Arlington][PlanReview] ${logLabel} duplicate aliased ${nameGuess}`,
          );
          aliases++;
        } else {
          console.log(
            `[Arlington][PlanReview] ${logLabel} download failed ${nameGuess} reason=${uploadOutcome.failureReason || uploadOutcome.downloadStatus || "unknown"}`,
          );
        }
      } else if (
        `${uploadOutcome.downloadStatus || ""}`.trim() === "metadata_only"
      ) {
        doc.downloadStatus = "metadata_only";
        doc.status = doc.status || "api_metadata";
        metadataOnly++;
      } else {
        const reason =
          uploadOutcome.failureReason ||
          uploadOutcome.downloadStatus ||
          "unknown";
        const ds = `${uploadOutcome.downloadStatus || ""}`.trim();
        if (ds === "oversized_for_supabase") {
          doc.downloadStatus = "oversized_for_supabase";
        } else if (/upload_failed|write_failed|failed_html/.test(ds)) {
          doc.downloadStatus = "failed_upload";
          arlingtonPlanReviewRecordHardFailure(downloadCtx);
        } else {
          doc.downloadStatus = "failed_non_retryable";
          arlingtonPlanReviewRecordHardFailure(downloadCtx);
        }
        doc.status = "pending";
        doc.skipReason = `${reason}`.slice(0, 200);
        console.log(
          `[Arlington][PlanReview] ${logLabel} download failed ${nameGuess} reason=${reason}`,
        );
        const hardF = Number(downloadCtx.planReviewHardFailuresThisRun) || 0;
        if (hardF >= ARLINGTON_PLAN_REVIEW_MAX_HARD_DOWNLOAD_FAILURES_PER_RUN) {
          // eslint-disable-next-line no-await-in-loop
          await arlingtonPlanReviewStopDownloads(
            downloadCtx,
            "hard_failure_limit_reached",
          );
          break;
        }
      }
    } catch (loopErr) {
      if (arlingtonErmsSessionClosedMessage(loopErr)) {
        await arlingtonPlanReviewMarkDocSessionClosed(doc, downloadCtx);
        console.log(
          `[Arlington][PlanReview] ${logLabel} download pending ${nameGuess} reason=session_closed_during_download`,
        );
      } else {
        arlingtonPlanReviewRecordHardFailure(downloadCtx);
        console.log(
          `[Arlington][PlanReview] ${logLabel} download failed ${nameGuess} reason=${loopErr && loopErr.message ? loopErr.message : loopErr}`,
        );
      }
    } finally {
      arlingtonPlanReviewDownloadEnd(downloadCtx);
    }
  }

  return { downloads, metadataOnly, aliases };
}

async function fetchArlingtonPlanReviewPortalPayload(
  page,
  pathWithSlashAndMaybeQuery,
  originOverride,
) {
  const pathname = pathWithSlashAndMaybeQuery.startsWith("/")
    ? pathWithSlashAndMaybeQuery
    : `/${pathWithSlashAndMaybeQuery}`;
  let origin = "";
  if (originOverride && `${originOverride}`.trim()) {
    try {
      origin = new URL(originOverride).origin;
    } catch (_) {
      origin = `${originOverride}`.replace(/\/$/, "");
    }
  } else {
    try {
      origin = new URL(page.url()).origin;
    } catch (_) {
      origin = "";
    }
  }
  const absUrl = `${origin}${pathname}`;
  let status = 0;
  let textBody = "";

  try {
    if (typeof page.request?.get === "function") {
      const res = await page.request.get(absUrl, { timeout: 45000 }).catch(() => null);
      if (res) {
        status = res.status();
        textBody =
          `${(await res.text().catch(() => "")) || ""}`.slice(0, 2_500_000);
      }
    }
  } catch (_) {
    /**/
  }

  if (!textBody.trim()) {
    try {
      const ev = await page
        .evaluate(async (u) => {
          try {
            const r = await fetch(u, {
              credentials: "include",
              cache: "no-store",
            });
            return {
              status: r.status,
              text: `${(await r.text().catch(() => "")) || ""}`,
            };
          } catch (_) {
            return { status: 0, text: "" };
          }
        }, absUrl)
        .catch(() => null);
      if (ev && typeof ev === "object") {
        status = Number(ev.status) || status;
        textBody = `${ev.text || ""}`.slice(0, 2_500_000);
      }
    } catch (_) {
      /**/
    }
  }

  /** @type {unknown} */
  let json = null;
  const trimmed = `${textBody}`.trim();
  if (/^[{[]/.test(trimmed)) {
    try {
      json = JSON.parse(trimmed);
    } catch (_) {
      json = null;
    }
  }
  return { absUrl, status, rawText: trimmed, json };
}

async function arlingtonPlanReviewApiHydrateTabs(
  page,
  permitProjectId,
  integratedTabs,
  hydrateOpts,
) {
  const proj = encodeURIComponent(`${permitProjectId || ""}`.trim());
  const ermsOrigin =
    hydrateOpts &&
    typeof hydrateOpts === "object" &&
    typeof hydrateOpts.ermsOrigin === "string"
      ? hydrateOpts.ermsOrigin.trim()
      : "";

  /** @returns {unknown[]} */
  const rowsFrom = (parsed) => {
    if (!parsed || !parsed.json || typeof parsed.json !== "object")
      return arlingtonLiftJsonArrays(parsed?.json ?? null);
    if (Array.isArray(parsed.json))
      return /** @type {unknown[]} */ (parsed.json);
    const lifted = arlingtonLiftJsonArrays(parsed.json);
    return lifted.length ? lifted : [];
  };

  let origin = "";
  try {
    origin = ermsOrigin
      ? new URL(ermsOrigin).origin
      : new URL(page.url()).origin;
  } catch (_) {
    origin = ermsOrigin ? ermsOrigin.replace(/\/$/, "") : "";
  }

  const requiredParsed = await fetchArlingtonPlanReviewPortalPayload(
    page,
    `/PlanReviewPortalService/api/document/RequiredPlanSheets?project=${proj}`,
    origin,
  );
  const requiredRows = rowsFrom(requiredParsed);
  {
    const rawJ = requiredParsed.json;
    const rawType =
      rawJ === null || rawJ === undefined
        ? String(rawJ)
        : Array.isArray(rawJ)
          ? "array"
          : typeof rawJ;
    console.log(
      `[Arlington][PlanReview][DEBUG] RequiredPlanSheets raw type=${rawType}`,
    );
    let rawKeys = "(n/a)";
    if (rawJ && typeof rawJ === "object") {
      rawKeys = Array.isArray(rawJ)
        ? `[array length=${rawJ.length}]`
        : Object.keys(rawJ).join(",");
    }
    console.log(
      `[Arlington][PlanReview][DEBUG] RequiredPlanSheets raw keys=${rawKeys}`,
    );
    let firstRawPreview = "(none)";
    try {
      if (Array.isArray(rawJ) && rawJ.length) {
        firstRawPreview = JSON.stringify(rawJ.slice(0, 2));
      } else if (rawJ && typeof rawJ === "object" && !Array.isArray(rawJ)) {
        const liftedPreview = arlingtonLiftJsonArrays(rawJ);
        firstRawPreview = JSON.stringify(
          liftedPreview.slice(0, 2),
        );
      } else if (rawJ != null) {
        firstRawPreview = JSON.stringify(rawJ).slice(0, 800);
      }
    } catch (_) {
      firstRawPreview = "(stringify error)";
    }
    console.log(
      `[Arlington][PlanReview][DEBUG] RequiredPlanSheets first item=${firstRawPreview}`,
    );
  }
  console.log(
    `[Arlington][PlanReview] API RequiredPlanSheets count=${requiredRows.length}`,
  );

  const planSink =
    integratedTabs.plansAndDocuments.sections.planSetDocuments.documents;
  arlingtonApplyRequiredPlanSheetsToPlanSink(planSink, requiredRows, origin);
  try {
    const firstNorm =
      planSink.length > 0 ? planSink[0] : null;
    console.log(
      `[Arlington][PlanReview][DEBUG] PlanSet normalized first item=${firstNorm ? JSON.stringify(firstNorm) : "(none)"}`,
    );
  } catch (_) {
    console.log(
      "[Arlington][PlanReview][DEBUG] PlanSet normalized first item=(log error)",
    );
  }

  const appParsed = await fetchArlingtonPlanReviewPortalPayload(
    page,
    `/PlanReviewPortalService/api/document/ApplicationDocs?project=${proj}`,
    origin,
  );
  const appRows = rowsFrom(appParsed);
  console.log(
    `[Arlington][PlanReview] ApplicationDocs api rows=${appRows.length}`,
  );

  const rlParsed = await fetchArlingtonPlanReviewPortalPayload(
    page,
    `/PlanReviewPortalService/api/document/ResponseLetters?project=${proj}`,
    origin,
  );
  const rlRows = rowsFrom(rlParsed);
  console.log(
    `[Arlington][PlanReview] ResponseLetters api rows=${rlRows.length}`,
  );

  const cmParsed = await fetchArlingtonPlanReviewPortalPayload(
    page,
    `/PlanReviewPortalService/api/PlanReviewData/Comments?identifier=${proj}`,
    origin,
  );
  const cmRows = rowsFrom(cmParsed);
  console.log(
    `[Arlington][PlanReview] Comments api rows=${cmRows.length}`,
  );

  const dtParsed = await fetchArlingtonPlanReviewPortalPayload(
    page,
    `/PlanReviewPortalService/api/planreviewdata/AccelaDocTypes?identifier=${proj}`,
    origin,
  );
  const dtRows = rowsFrom(dtParsed);
  console.log(
    `[Arlington][PlanReview] AccelaDocTypes api rows=${dtRows.length}`,
  );

  const includeSecondary =
    (hydrateOpts &&
      typeof hydrateOpts === "object" &&
      hydrateOpts.includeSecondaryTabs === true) ||
    ArlingtonAccelaProfile.planReview?.planReviewIncludeSecondaryTabs === true;

  if (includeSecondary) {
    arlingtonApplyApiRowsToSecondaryTabsCommentsAndPi(integratedTabs, {
      responseLetters: rlRows,
      applicationDocs: appRows,
      comments: cmRows,
      accelaDocTypes: dtRows,
    }, origin);
    console.log(
      `[Arlington][PlanReview] secondary API hydrate: comments+PI fields only (Review Results / Approved document rows deferred to DOM-first)`,
    );
  }

  return {
    planRowCount: requiredRows.length,
    responseLettersCount: rlRows.length,
    applicationDocsCount: appRows.length,
    commentsCount: cmRows.length,
    accelaDocTypesCount: dtRows.length,
    secondaryApiFallback:
      includeSecondary
        ? {
            responseLetters: rlRows,
            applicationDocs: appRows,
            comments: cmRows,
            accelaDocTypes: dtRows,
          }
        : null,
  };
}

async function dismissArlingtonPlanReviewViewDocsPopups(page) {
  let detected = false;
  let closed = false;

  outer: for (let pass = 0; pass < 10; pass++) {
    /** @returns {Promise<{ found:boolean, selectors:string[], textClose:boolean}>} */

    const peek = await page
      .evaluate(() => ({
        dlg: [...document.querySelectorAll(".ui-dialog")].some((el) => {
          const st = window.getComputedStyle(el);
          return (
            st.display !== "none" &&
            st.visibility !== "hidden" &&
            el.offsetWidth > 24 &&
            el.offsetHeight > 24
          );
        }),
      }))
      .catch(() => ({ dlg: false }));
    const dialogVisible =
      peek &&
      typeof peek === "object" &&
      /** @type {{ dlg?:boolean}} */ (peek).dlg === true;

    if (!dialogVisible) break outer;
    detected = true;

    const clickSelectors = [
      ".ui-dialog-titlebar-close",
      ".ui-icon-closethick",
      "button[aria-label*='Close' i]",
      '[title*="Close" i]',
    ];
    for (const sel of clickSelectors) {
      const handles = await page.$$(sel).catch(() => []);
      for (const h of handles) {
        try {
          if (!(await h.isVisible().catch(() => false))) continue;
          await h.click({ force: true, timeout: 4000 }).catch(() => {});
          closed = true;
          await page.waitForTimeout(400).catch(() => {});
          continue outer;
        } catch (_) {
          /**/
        }
      }
    }

    const textClose = await page
      .evaluate(() => {
        const buttons = [...document.querySelectorAll("button, a, [role='button']")];
        for (const b of buttons) {
          const t = (b.textContent || "").replace(/\s+/g, " ").trim();
          if (!/^close$/i.test(t) || t.length > 12) continue;
          const st = window.getComputedStyle(b);
          if (st.display === "none" || st.visibility === "hidden") continue;
          try {
            b.click();
            return true;
          } catch (_) {
            /**/
          }
        }
        return false;
      })
      .catch(() => false);
    if (textClose) {
      closed = true;
      await page.waitForTimeout(400).catch(() => {});
      continue;
    }

    break;
  }

  const suffix = detected ? (closed ? "closed" : "detected") : "skipped";
  console.log(`[Arlington][PlanReview] popup ${suffix}`);
}

/**
 * Locate Arlington ERMS integrated iframe (`iFrameOpenPlanReview` / PlanReviewIntegrated).
 * @returns {import('playwright').Frame | null}
 */
function pickArlingtonPlanReviewErmsFrame(page) {
  for (const f of page.frames()) {
    try {
      if (f.name() === "iFrameOpenPlanReview") return f;
    } catch (_) {
      /**/
    }
  }
  for (const f of page.frames()) {
    try {
      const u = `${f.url() || ""}`;
      if (/planreviewintegrated/i.test(u)) return f;
    } catch (_) {
      /**/
    }
  }
  return null;
}

/**
 * ERMS shell readiness (core tabs only) — safe for Review/Approved secondary pages.
 * @returns {Promise<import('playwright').Frame | null>}
 */
async function waitForArlingtonPlanReviewErmsShellReady(
  page,
  timeoutMs = 60000,
  scopeLabel = "",
) {
  const scopeNote = `${scopeLabel || ""}`.trim();
  if (!scopeNote) {
    console.log(
      "[Arlington][PlanReview] waiting for ERMS iframe shell (secondary-safe)",
    );
  }
  const deadline = Date.now() + timeoutMs;
  const pollMs = 500;
  /** @type {number} */
  let lastDiagLog = 0;

  while (Date.now() < deadline) {
    const fr = pickArlingtonPlanReviewErmsFrame(page);
    if (fr) {
      let frameUrl = "";
      try {
        frameUrl = `${fr.url() || ""}`.slice(0, 200);
      } catch (_) {
        frameUrl = "(frame-url-error)";
      }
      const snap = await fr
        .evaluate(() => {
          const bodyText =
            document.body?.innerText || document.body?.textContent || "";
          const href = `${location.href || ""}`;
          const trimmedLen = bodyText.replace(/\s+/g, " ").trim().length;
          const stuckQueryProject =
            /QueryProject/i.test(href) && trimmedLen < 200;
          const hasCoreTabs =
            /Plans\s*&\s*Documents/i.test(bodyText) &&
            /Review Results\s*&\s*Mark-ups/i.test(bodyText) &&
            /Approved Documents/i.test(bodyText) &&
            /Project Information/i.test(bodyText);
          const notBlankShell = trimmedLen > 200 && !stuckQueryProject;
          const ok = !stuckQueryProject && (hasCoreTabs || notBlankShell);
          return {
            ok,
            bodyLen: bodyText.length,
            trimmedLen,
            hasCoreTabs,
            stuckQueryProject,
            href: href.slice(0, 160),
          };
        })
        .catch(() => null);

      const now = Date.now();
      if (now - lastDiagLog >= 2500 || !snap) {
        lastDiagLog = now;
        const s =
          snap || {
            bodyLen: 0,
            trimmedLen: 0,
            hasCoreTabs: false,
            stuckQueryProject: false,
            href: frameUrl,
          };
        console.log(
          `[Arlington][PlanReview] ERMS shell check url=${s.href || frameUrl} bodyLen=${s.bodyLen} coreTabs=${s.hasCoreTabs} stuckQueryProject=${s.stuckQueryProject}`,
        );
      }

      if (snap?.ok) {
        console.log(
          scopeNote
            ? `[Arlington][PlanReview] ERMS shell ready for secondary scope=${scopeNote}`
            : `[Arlington][PlanReview] ERMS shell ready coreTabs=${snap.hasCoreTabs}`,
        );
        return fr;
      }
    }

    await page.waitForTimeout(pollMs).catch(() => {});
  }

  if (scopeNote) {
    console.log(
      `[Arlington][PlanReview] ERMS shell not ready for secondary scope=${scopeNote}; preserving existing Plan Review data`,
    );
  } else {
    console.log(
      `[Arlington][PlanReview] ERMS shell not ready within ${timeoutMs}ms`,
    );
  }
  return null;
}

/**
 * Secondary tab readiness: URL + panel markers (not Plan Set #divDocuments).
 * @param {import("playwright").Page | import("playwright").Frame} frame
 * @param {string} tabKey
 * @returns {Promise<boolean>}
 */
async function arlingtonPlanReviewEvaluateSecondaryTabReady(frame, tabKey) {
  if (tabKey === "approvedDocuments") {
    const detail = await arlingtonPlanReviewEvaluateApprovedTabReadyDetail(frame);
    return detail.ready;
  }

  const hints =
    ARLINGTON_SECONDARY_TAB_DOWNLOAD_HINTS[
      /** @type {keyof typeof ARLINGTON_SECONDARY_TAB_DOWNLOAD_HINTS} */ (
        tabKey
      )
    ];
  if (!hints || typeof frame.evaluate !== "function") return false;
  const urlNeedle =
    tabKey === "reviewResultsAndMarkups"
      ? "ReviewDocuments"
      : tabKey === "approvedDocuments"
        ? "ApprovedDocuments"
        : "";
  if (!urlNeedle) return false;
  try {
    return !!(await frame.evaluate(
      ({ urlNeedle, markerRxSource }) => {
        const href = `${location.href || ""}`;
        if (!href.includes(urlNeedle)) return false;
        const body = document.body?.innerText || "";
        let rx;
        try {
          rx = new RegExp(markerRxSource, "i");
        } catch (_) {
          return false;
        }
        if (rx.test(body)) return true;
        if (/File Actions|Document Date|Download|Name/i.test(body)) return true;
        const rows = document.querySelectorAll(
          'tr, [role="row"], .grid-row, table tbody tr, a[href*="Download"]',
        );
        return !!(rows && rows.length > 0);
      },
      { urlNeedle, markerRxSource: hints.markerRxSource },
    ));
  } catch (_) {
    return false;
  }
}

/**
 * Strong readiness: ERMS shell + Plan markers (not merely ViewDocuments URL).
 * @returns {Promise<import('playwright').Frame | null>}
 */
async function waitForArlingtonPlanReviewErmsContentReady(
  page,
  timeoutMs = 60000,
) {
  console.log("[Arlington][PlanReview] waiting for ERMS iframe DOM (gated readiness)");
  const deadline = Date.now() + timeoutMs;
  const pollMs = 500;
  /** @type {number} */
  let lastDiagLog = 0;

  while (Date.now() < deadline) {
    const fr = pickArlingtonPlanReviewErmsFrame(page);
    /** @type {string} */
    let fuShort = "(no-frame)";

    if (fr) {
      try {
        fuShort = `${fr.url() || ""}`.slice(0, 200);
      } catch (_) {
        fuShort = "(frame-url-error)";
      }
      const snap = await fr
        .evaluate(() => {
          const bodyText =
            document.body?.innerText || document.body?.textContent || "";
          const hasCoreTabs =
            /Plans\s*&\s*Documents/i.test(bodyText) &&
            /Review Results\s*&\s*Mark-ups/i.test(bodyText) &&
            /Approved Documents/i.test(bodyText) &&
            /Project Information/i.test(bodyText);
          const hasPlanSet =
            !!document.querySelector("#divDocuments") ||
            /Plan Set Documents/i.test(bodyText);
          const notBlank =
            bodyText.replace(/\s+/g, " ").trim().length > 1000;
          const ok = notBlank && hasCoreTabs && hasPlanSet;
          return {
            ok,
            bodyLen: bodyText.length,
            divDocuments: !!document.querySelector("#divDocuments"),
            hasCoreTabs,
            hasPlanSetText: /Plan Set Documents/i.test(bodyText),
          };
        })
        .catch(() => null);

      const now = Date.now();
      if (now - lastDiagLog >= 2500 || !snap) {
        lastDiagLog = now;
        const s =
          snap || {
            bodyLen: 0,
            divDocuments: false,
            hasCoreTabs: false,
            hasPlanSetText: false,
          };
        console.log(
          `[Arlington][PlanReview] iframe ready check url=${fuShort} bodyLen=${s.bodyLen} divDocuments=${s.divDocuments} coreTabs=${s.hasCoreTabs} planSetText=${s.hasPlanSetText}`,
        );
      }

      if (snap?.ok) {
        console.log(
          `[Arlington][PlanReview] iframe ready confirmed divDocuments=${snap.divDocuments} coreTabs=${snap.hasCoreTabs} planSetText=${snap.hasPlanSetText}`,
        );
        return fr;
      }
    } else {
      const now = Date.now();
      if (now - lastDiagLog >= 2500) {
        lastDiagLog = now;
        console.log(
          `[Arlington][PlanReview] iframe ready check url=(no-frame) bodyLen=0 divDocuments=false coreTabs=false planSetText=false`,
        );
      }
    }

    await page.waitForTimeout(pollMs).catch(() => {});
  }

  console.log(
    `[Arlington][PlanReview] iframe not ready within ${timeoutMs}ms`,
  );
  return null;
}

/**
 * Gated readiness with one Plan Review tab retry (re-click + re-poll).
 * @returns {Promise<import('playwright').Frame | null>}
 */
async function waitForArlingtonPlanReviewIframeReady(page, timeoutMs = 60000) {
  let fr = await waitForArlingtonPlanReviewErmsContentReady(page, timeoutMs);
  if (fr) return fr;
  console.log(
    "[Arlington][PlanReview] iframe readiness retry — re-activating Plan Review tab",
  );
  await ensureArlingtonPlanReviewActive(page).catch(() => ({ ok: false }));
  await page.waitForTimeout(3000).catch(() => {});
  await waitForAccelaLoad(page).catch(() => {});
  fr = await waitForArlingtonPlanReviewErmsContentReady(page, timeoutMs);
  if (!fr) {
    console.log(
      "[Arlington][PlanReview] iframe not ready after retries; marking extraction failed",
    );
  }
  return fr;
}

/**
 * Dismiss blocking modals only inside the ERMS Plan Review frame (not Accela shell).
 */
async function dismissBlockingModalsInArlingtonPlanReviewFrame(fr) {
  const accelaNeedles = [
    "no additional documents required",
    "submit active revision",
  ];
  const clickSelectors = [
    'button:has-text("OK")',
    '[role="button"]:has-text("OK")',
    'input[value="OK"]',
    'input[value="Ok"]',
    'button:has-text("Ok")',
    'button:has-text("CLOSE")',
    'button:has-text("Close")',
    'button:has-text("Continue")',
    'input[value="Close"]',
    'a:has-text("OK")',
  ];
  const parentPage = fr.page();
  for (let pass = 0; pass < 3; pass++) {
    const state = await fr
      .evaluate((needles) => {
        const body = (document.body?.innerText || "").toLowerCase();
        const hasDiv = !!document.querySelector("#divDocuments");
        const accela = needles.some((n) => body.includes(n));
        const jqueryDlg = [...document.querySelectorAll(".ui-dialog")].some(
          (el) => {
            const st = window.getComputedStyle(el);
            return (
              st.display !== "none" &&
              st.visibility !== "hidden" &&
              el.offsetWidth > 24 &&
              el.offsetHeight > 24
            );
          },
        );
        return { blocked: !hasDiv && (accela || jqueryDlg) };
      }, accelaNeedles)
      .catch(() => ({ blocked: false }));

    if (!state.blocked) break;

    let clicked = false;
    for (const sel of clickSelectors) {
      const btn = await fr.$(sel).catch(() => null);
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click({ force: true }).catch(() => {});
        clicked = true;
        console.log(
          `[Arlington][PlanReview] frame modal dismissed (${sel}) pass=${pass + 1}`,
        );
        break;
      }
    }
    if (!clicked) {
      const closed = await fr
        .evaluate(() => {
          for (const sel of [
            ".ui-dialog-titlebar-close",
            ".ui-icon-closethick",
          ]) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const st = window.getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden") continue;
            try {
              el.click();
              return sel;
            } catch (_) {
              /**/
            }
          }
          return "";
        })
        .catch(() => "");
      if (closed) {
        console.log(
          `[Arlington][PlanReview] frame jquery dialog closed (${closed}) pass=${pass + 1}`,
        );
      }
    }
    await parentPage.waitForTimeout(500).catch(() => {});
  }
}

async function restoreArlingtonCapDetailAfterErms(page, savedCapUrl) {
  if (!`${savedCapUrl || ""}`.includes("CapDetail.aspx")) return;
  try {
    await page.goto(`${savedCapUrl}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (_) {
    /**/
  }
  await waitForAccelaLoad(page).catch(() => {});
  await page.waitForTimeout(380).catch(() => {});
}

const ARLINGTON_SECONDARY_TAB_SPECS = [
  { label: "Review Results & Mark-ups", tabKey: "reviewResultsAndMarkups" },
  { label: "Approved Documents", tabKey: "approvedDocuments" },
  { label: "Project Information", tabKey: "projectInformation" },
];

/** Nested row within Review Results & Mark-ups (visible document grid). */
const ARLINGTON_REVIEW_RESULTS_DOM_SUBTABS = [
  "Comment Letters & Plan Mark-ups",
  "Comment Letters & Plan Markups",
  "Comment Letters",
  "Plan Mark-ups",
];

const ARLINGTON_SECONDARY_REVIEW_RESULTS_RE =
  /Comment Letters|Plan Mark-ups|Review Results Letter|Review Status|Document Date|Download/i;

const ARLINGTON_SECONDARY_APPROVED_RE =
  /Approved Plan Set|Approved Documents|Document Date|Download/i;

const ARLINGTON_SECONDARY_PROJECT_INFO_RE =
  /Project Information|Project ID|Project Status|Applicant|Owner/i;

/** @returns {RegExp} */
function arlingtonSecondaryExpectedRegex(tabKey) {
  if (tabKey === "reviewResultsAndMarkups")
    return ARLINGTON_SECONDARY_REVIEW_RESULTS_RE;
  if (tabKey === "approvedDocuments") return ARLINGTON_SECONDARY_APPROVED_RE;
  return ARLINGTON_SECONDARY_PROJECT_INFO_RE;
}

const ARLINGTON_APPROVED_PANEL_CHROME_RE =
  /Building Arlington|Jobs\s*•\s*Services A-Z|Sign Out|Projects Settings Profile|en Español|ePlan Review Help/i;

const ARLINGTON_APPROVED_PANEL_GRID_RE =
  /File Actions|Document Date|Download|Approved Plan Set|Review Results Letter/i;

/**
 * @param {import("playwright").ElementHandle | null | undefined} panelHandle
 * @returns {Promise<{ acceptable: boolean; reason: string; id: string; rows: number; actions: number; markerHits: number; preview: string }>}
 */
async function arlingtonEvaluateApprovedDocumentsPanelStrength(panelHandle) {
  if (!panelHandle || typeof panelHandle.evaluate !== "function") {
    return {
      acceptable: false,
      reason: "no_panel",
      id: "",
      rows: 0,
      actions: 0,
      markerHits: 0,
      preview: "",
    };
  }
  try {
    const stats = await panelHandle.evaluate((root) => {
      if (!(root instanceof Element)) return null;
      const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
      const el = /** @type {HTMLElement} */ (root);
      const text = norm(el.innerText || el.textContent || "");
      const id = `${el.id || ""}`.trim();
      const tables = [...el.querySelectorAll("table")];
      let trCount = 0;
      for (const tb of tables) trCount += tb.querySelectorAll("tr").length;
      const docActions = el.querySelectorAll(
        'input.docaction, input.img-button.docaction, input[type="image"]',
      ).length;
      const actionCount = el.querySelectorAll(
        'input.docaction, input.img-button.docaction, input[type="image"], a[href], button',
      ).length;
      const markerHits = [
        /File Actions/i.test(text),
        /Document Date/i.test(text),
        /Download/i.test(text),
        /Approved Plan Set/i.test(text),
        /Review Results Letter/i.test(text),
      ].filter(Boolean).length;
      return {
        id,
        preview: text.slice(0, 300),
        rows: trCount,
        actions: actionCount,
        docActions,
        markerHits,
      };
    });
    if (!stats || typeof stats !== "object") {
      return {
        acceptable: false,
        reason: "panel_not_element",
        id: "",
        rows: 0,
        actions: 0,
        markerHits: 0,
        preview: "",
      };
    }
    const id = `${stats?.id || ""}`.trim();
    const preview = `${stats?.preview || ""}`.trim();
    const rows = Number(stats?.rows) || 0;
    const actions = Number(stats?.actions) || 0;
    const docActions = Number(stats?.docActions) || 0;
    const markerHits = Number(stats?.markerHits) || 0;

    if (/arlington-header/i.test(id)) {
      return {
        acceptable: false,
        reason: "arlington_header_id",
        id,
        rows,
        actions,
        markerHits,
        preview,
      };
    }
    if (/Building Arlington/i.test(preview)) {
      return {
        acceptable: false,
        reason: "site_chrome_building_arlington",
        id,
        rows,
        actions,
        markerHits,
        preview,
      };
    }
    if (
      /Jobs\s*•\s*Services A-Z/i.test(preview) ||
      /Sign Out/i.test(preview) ||
      /Projects Settings Profile/i.test(preview)
    ) {
      return {
        acceptable: false,
        reason: "site_chrome_nav",
        id,
        rows,
        actions,
        markerHits,
        preview,
      };
    }
    if (rows === 0 && markerHits < 2) {
      return {
        acceptable: false,
        reason: "no_rows_weak_markers",
        id,
        rows,
        actions,
        markerHits,
        preview,
      };
    }
    if (markerHits < 2 || docActions < 1) {
      return {
        acceptable: false,
        reason: "grid_markers_insufficient",
        id,
        rows,
        actions,
        markerHits,
        preview,
      };
    }
    if (rows < 2 && markerHits < 4) {
      return {
        acceptable: false,
        reason: "rows_and_markers_weak",
        id,
        rows,
        actions,
        markerHits,
        preview,
      };
    }
    return {
      acceptable: true,
      reason: "approved_grid_ok",
      id,
      rows,
      actions,
      markerHits,
      preview,
    };
  } catch (_) {
    return {
      acceptable: false,
      reason: "evaluate_error",
      id: "",
      rows: 0,
      actions: 0,
      markerHits: 0,
      preview: "",
    };
  }
}

const ARLINGTON_PROJECT_INFORMATION_HREF =
  "/PlanReviewIntegrated/Plan/ProjectInformation";

/**
 * @param {import("playwright").Page | import("playwright").Frame | null | undefined} frame
 */
async function arlingtonPlanReviewEvaluateProjectInformationBodyMarkers(frame) {
  if (!frame || typeof frame.evaluate !== "function") {
    return {
      projectId: false,
      projectName: false,
      accelaCap: false,
      address: false,
      reviewType: false,
      cphdCase: false,
    };
  }
  try {
    return await frame.evaluate(() => {
      const text =
        document.body?.innerText || document.body?.textContent || "";
      return {
        projectId: /Project ID/i.test(text),
        projectName: /Plan Review Project Name/i.test(text),
        accelaCap: /Accela CAP ID/i.test(text),
        address: /\bAddress\b/i.test(text),
        reviewType: /Review Type/i.test(text),
        cphdCase: /CPHD Case/i.test(text),
      };
    });
  } catch (_) {
    return {
      projectId: false,
      projectName: false,
      accelaCap: false,
      address: false,
      reviewType: false,
      cphdCase: false,
    };
  }
}

/**
 * Navigate ERMS to Project Information and wait for form body markers.
 * @returns {Promise<{ root: import("playwright").Page | import("playwright").Frame; markers: Record<string, boolean> }>}
 */
async function arlingtonPrepareArlingtonProjectInformationErmsFrame(page, ermsRoot) {
  const logP = "[Arlington][PlanReview][ProjectInfo]";
  let root = ermsRoot;
  const beforeUrl = await arlingtonPlanReviewFrameUrlShort(root);
  console.log(`${logP} before url=${beforeUrl}`);

  const refreshed = await waitForArlingtonPlanReviewErmsShellReady(page, 45000);
  if (refreshed) root = refreshed;

  let hrefClick = false;
  let currentUrl = await arlingtonPlanReviewFrameUrlShort(root);
  if (!/ProjectInformation/i.test(currentUrl)) {
    hrefClick = await arlingtonPlanReviewClickFrameHref(
      root,
      ARLINGTON_PROJECT_INFORMATION_HREF,
    );
    if (!hrefClick && typeof root.url === "function") {
      try {
        const origin = new URL(root.url()).origin;
        await root.goto(`${origin}${ARLINGTON_PROJECT_INFORMATION_HREF}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        hrefClick = true;
      } catch (_) {
        /**/
      }
    }
    await page.waitForTimeout(1200).catch(() => {});
    root =
      (await waitForArlingtonPlanReviewErmsShellReady(page, 45000)) || root;
  }

  currentUrl = await arlingtonPlanReviewFrameUrlShort(root);
  if (!/ProjectInformation/i.test(currentUrl)) {
    const tabClicked = await clickArlingtonErmsTopTab(
      root,
      page,
      "Project Information",
    ).catch(() => false);
    if (tabClicked) {
      await page.waitForTimeout(1000).catch(() => {});
      root =
        (await waitForArlingtonPlanReviewErmsShellReady(page, 45000)) || root;
    }
  }

  const afterUrl = await arlingtonPlanReviewFrameUrlShort(root);
  console.log(
    `${logP} hrefClick=${hrefClick} after click url=${afterUrl}`,
  );

  await root
    .waitForFunction(
      () => {
        const text =
          document.body?.innerText || document.body?.textContent || "";
        const hasMarkers =
          /Project Information/i.test(text) &&
          /Project ID/i.test(text) &&
          (/Accela CAP ID/i.test(text) || /Review Type/i.test(text));
        const controls = [
          ...document.querySelectorAll("input, textarea, select"),
        ];
        const disabledOrReadonly = controls.filter(
          (c) =>
            c instanceof HTMLInputElement ||
            c instanceof HTMLTextAreaElement ||
            c instanceof HTMLSelectElement
              ? c.disabled || c.readOnly
              : false,
        );
        const filledDisabled = disabledOrReadonly.filter((c) => {
          const v =
            c instanceof HTMLSelectElement
              ? `${c.selectedOptions?.[0]?.textContent || c.value || ""}`
              : c instanceof HTMLInputElement ||
                  c instanceof HTMLTextAreaElement
                ? `${c.value || c.defaultValue || c.getAttribute("value") || ""}`
                : "";
          return `${v}`.trim().length > 0;
        });
        return (
          hasMarkers ||
          (disabledOrReadonly.length >= 4 && filledDisabled.length >= 2)
        );
      },
      { timeout: 20000, polling: 250 },
    )
    .catch(() => null);

  await dismissBlockingModalsInArlingtonPlanReviewFrame(root).catch(() => {});

  const markers = await arlingtonPlanReviewEvaluateProjectInformationBodyMarkers(
    root,
  );
  console.log(
    `${logP} bodyMarkers projectId=${!!markers.projectId} projectName=${!!markers.projectName} accelaCap=${!!markers.accelCap} address=${!!markers.address} reviewType=${!!markers.reviewType} cphdCase=${!!markers.cphdCase}`,
  );

  return { root, markers };
}

/**
 * @param {import("playwright").Page} page
 * @param {import("playwright").Page | import("playwright").Frame} ermsRoot
 * @returns {Promise<{ label: string; value: string; sourceTab?: string }[]>}
 */
async function arlingtonExtractArlingtonProjectInformationFields(
  page,
  ermsRoot,
  permitNumber,
) {
  const logP = "[Arlington][PlanReview][ProjectInfo]";
  const permitHint = `${permitNumber || ""}`.trim();
  const { root, markers } =
    await arlingtonPrepareArlingtonProjectInformationErmsFrame(page, ermsRoot);

  const unityWait = await waitForArlingtonProjectInformationUnityFormFrame(
    page,
    root,
    permitHint,
    20000,
  );

  let dataFrame = unityWait.frame;
  if (!dataFrame) {
    dataFrame = await findArlingtonProjectInformationDataFrame(root, permitHint);
  }

  let dataUrl = dataFrame
    ? await arlingtonPlanReviewFrameUrlShort(dataFrame)
    : "(none)";
  console.log(
    `${logP} dataFrameFound=${!!dataFrame} url=${dataUrl} unityWait=${unityWait.found}`,
  );

  /** @type {string | null} */
  let diagnosticReason = unityWait.found
    ? null
    : unityWait.diagnosticReason || null;

  if (!dataFrame) {
    console.warn(
      `${logP} ${diagnosticReason || ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND}`,
    );
    return {
      fields: [],
      panelFound: false,
      unityFrameFound: false,
      diagnosticReason:
        diagnosticReason || ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND,
      selectedFrameUrl: dataUrl,
    };
  }

  /** @type {import("playwright").Page | import("playwright").Frame} */
  let extractTarget = dataFrame;
  await page.waitForTimeout(300).catch(() => {});

  let piFields = [];
  let panelFound = false;

  const applyExtract = (result) => {
    const fields = Array.isArray(result?.fields) ? result.fields : [];
    if (result?.panelFound === true) panelFound = true;
    return fields;
  };

  piFields = applyExtract(
    await extractArlingtonProjectInformationFieldsFromFrame(
      extractTarget,
      permitHint,
    ),
  );

  if (arlingtonProjectInformationExtractionIsWeak(piFields, permitHint)) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const retryUnity = await waitForArlingtonProjectInformationUnityFormFrame(
        page,
        root,
        permitHint,
        4000,
      );
      if (retryUnity.frame) {
        extractTarget = retryUnity.frame;
        dataFrame = retryUnity.frame;
        dataUrl = retryUnity.url || dataUrl;
      }
      const retryResult = await extractArlingtonProjectInformationFieldsFromFrame(
        extractTarget,
        permitHint,
      );
      const retry = applyExtract(retryResult);
      if (!arlingtonProjectInformationExtractionIsWeak(retry, permitHint)) {
        piFields = retry;
        break;
      }
      if (retry.length > piFields.length) piFields = retry;
    }
  }

  if (
    arlingtonProjectInformationExtractionIsWeak(piFields, permitHint) &&
    (markers.projectId || markers.projectName || markers.accelCap)
  ) {
    /** @type {import("playwright").Frame[]} */
    const frames = [];
    const walk = (f) => {
      frames.push(f);
      for (const c of f.childFrames()) walk(c);
    };
    if (typeof root.childFrames === "function") {
      walk(/** @type {import("playwright").Frame} */ (root));
    }
    for (const fr of frames) {
      const attemptResult = await extractArlingtonProjectInformationFieldsFromFrame(
        fr,
        permitHint,
      );
      const attempt = applyExtract(attemptResult);
      if (
        !arlingtonProjectInformationExtractionIsWeak(attempt, permitHint) ||
        attempt.length > piFields.length
      ) {
        piFields = attempt;
        dataFrame = fr;
        dataUrl = await arlingtonPlanReviewFrameUrlShort(fr);
      }
      if (!arlingtonProjectInformationExtractionIsWeak(piFields, permitHint)) {
        break;
      }
    }
    console.log(
      `${logP} dataFrameFound=${!!dataFrame} url=${dataUrl} (frame sweep)`,
    );
  }

  const weak = arlingtonProjectInformationExtractionIsWeak(piFields, permitHint);
  if (weak && !diagnosticReason) {
    diagnosticReason = ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND;
  }

  console.log(`${logP} fields=${piFields.length}`);
  return {
    fields: piFields,
    panelFound,
    unityFrameFound: unityWait.found || /\/GetUnityForm\//i.test(dataUrl),
    diagnosticReason: weak ? diagnosticReason : null,
    selectedFrameUrl: dataUrl,
  };
}

/**
 * @param {ReturnType<typeof defaultArlingtonIntegratedTabsSkeleton>} integratedTabs
 * @param {{ label: string; value: string }[]} piFields
 * @param {unknown} [priorPortalData]
 */
function arlingtonMergeProjectInformationFieldsDest(
  integratedTabs,
  piFields,
  priorPortalData,
  permitNumber,
  extractMeta,
) {
  if (!Array.isArray(piFields)) return;
  const destFields = integratedTabs?.projectInformation?.fields;
  if (!Array.isArray(destFields)) return;

  const priorFields = arlingtonPriorProjectInformationFields(priorPortalData);
  const diagnosticReason =
    extractMeta && typeof extractMeta === "object"
      ? `${extractMeta.diagnosticReason || ""}`.trim()
      : "";

  if (arlingtonProjectInformationExtractionIsWeak(piFields, permitNumber)) {
    console.log(
      "[Arlington][ProjectInfo] weak extraction rejected; preserving prior projectInformation",
    );
    if (priorFields.length > 0) {
      destFields.length = 0;
      for (const f of priorFields) {
        if (!f || typeof f !== "object") continue;
        const label = `${/** @type {Record<string, unknown>} */ (f).label || ""}`.trim();
        if (!label) continue;
        destFields.push({
          label,
          value: `${/** @type {Record<string, unknown>} */ (f).value ?? ""}`
            .trim()
            .slice(0, 2000),
        });
      }
      if (integratedTabs.projectInformation) {
        integratedTabs.projectInformation.extractionStatus = "preserved_prior";
      }
    } else {
      destFields.length = 0;
      if (integratedTabs.projectInformation) {
        const reason =
          diagnosticReason || ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND;
        integratedTabs.projectInformation.extractionStatus =
          reason === ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND
            ? "unity_frame_not_found"
            : "weak_failed";
        integratedTabs.projectInformation.diagnostics = {
          rejectionReason: reason,
          selectedFrameUrl:
            extractMeta && typeof extractMeta === "object"
              ? `${extractMeta.selectedFrameUrl || ""}`.trim() || null
              : null,
          unityFrameFound:
            extractMeta && typeof extractMeta === "object"
              ? extractMeta.unityFrameFound === true
              : false,
        };
        console.warn(
          `[Arlington][ProjectInfo] ${reason} selectedFrameUrl=${integratedTabs.projectInformation.diagnostics.selectedFrameUrl || "(none)"}`,
        );
      }
    }
    return;
  }

  if (!piFields.length) return;

  destFields.length = 0;
  for (const f of piFields) {
    if (!f || !f.label) continue;
    destFields.push({
      label: `${f.label}`.trim(),
      value: `${f.value != null ? f.value : ""}`.trim().slice(0, 2000),
    });
  }
  if (integratedTabs.projectInformation) {
    integratedTabs.projectInformation.extractionStatus = "ok";
    integratedTabs.projectInformation.sectionState = "complete";
  }
  const nFields = integratedTabs.projectInformation?.fields?.length ?? 0;
  const nDocs = integratedTabs.projectInformation?.documents?.length ?? 0;
  const get = (label) => {
    const f = (integratedTabs.projectInformation?.fields || []).find(
      (row) => `${row?.label || ""}`.trim() === label,
    );
    return `${f?.value ?? ""}`.trim();
  };
  const valid = !arlingtonProjectInformationExtractionIsWeak(
    integratedTabs.projectInformation?.fields || [],
    permitNumber,
  );
  console.log(
    `[Arlington][ProjectInfo] final valid=${valid} Project ID=${get("Project ID")} Accela CAP ID=${get("Accela CAP ID")} Address=${get("Address")} Review Type=${get("Review Type")}`,
  );
  console.log(
    `[Arlington][PlanReview] Project Information fields=${nFields} documents=${nDocs}`,
  );
  for (const f of integratedTabs.projectInformation?.fields || []) {
    if (!f || !`${f.label || ""}`.trim()) continue;
    console.log(
      `[Arlington][PlanReview] Project Information field ${`${f.label}`.trim()}=${`${f.value != null ? f.value : ""}`.trim()}`,
    );
  }
}

/**
 * Keep session.data in sync with portal_data written/preserved for DB.
 * @param {Record<string, unknown>} session
 * @param {string} permitNumber
 * @param {Record<string, unknown>} portalPayloadForDb
 */
function arlingtonSyncSessionDataPortalPayload(session, permitNumber, portalPayloadForDb) {
  if (!session || !`${permitNumber || ""}`.trim() || !portalPayloadForDb) return;
  session.data = session.data || {};
  session.data[permitNumber] = portalPayloadForDb;
}

/**
 * @param {import("playwright").Page} page
 * @param {import("playwright").Page | import("playwright").Frame} ermsRoot
 * @param {{ label: string; tabKey: string }} st
 * @param {RegExp} expectedRegex
 * @returns {Promise<import("playwright").ElementHandle | null>}
 */
async function clickAndResolveArlingtonApprovedDocumentsPanel(
  page,
  ermsRoot,
  st,
  expectedRegex,
) {
  const maxAttempts = 5;
  const waitMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let root = ermsRoot;
    const refreshed = await waitForArlingtonPlanReviewErmsShellReady(page, 45000);
    if (refreshed) root = refreshed;

    /** @type {import("playwright").ElementHandle | null} */
    let panelEl = await arlingtonClickErmsTopTabAndWait(
      root,
      st.label,
      expectedRegex,
    ).catch(() => null);

    if (panelEl) {
      const strength = await arlingtonEvaluateApprovedDocumentsPanelStrength(
        panelEl,
      );
      if (strength.acceptable) {
        console.log(
          `[Arlington][PlanReview] Approved Documents panel resolved attempt=${attempt} id=${strength.id || "(none)"} rows=${strength.rows} actions=${strength.actions} markers=${strength.markerHits}`,
        );
        return panelEl;
      }
      console.log(
        `[Arlington][PlanReview] Approved Documents panel weak attempt=${attempt} reason=${strength.reason} id=${strength.id || "(none)"} rows=${strength.rows} actions=${strength.actions} preview=${strength.preview.slice(0, 120)}`,
      );
      await panelEl.dispose().catch(() => {});
      panelEl = null;
    } else {
      console.log(
        `[Arlington][PlanReview] Approved Documents panel not resolved attempt=${attempt}`,
      );
    }

    if (attempt < maxAttempts) {
      await page.waitForTimeout(waitMs).catch(() => {});
    }
  }

  console.log(
    `[Arlington][PlanReview] active panel "${st.label}" not resolved after ${maxAttempts} attempts (header/nav rejected or grid missing)`,
  );
  return null;
}

/**
 * Restore prior Approved Documents rows or mark DOM extraction failed.
 * @param {ReturnType<typeof defaultArlingtonIntegratedTabsSkeleton>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} priorPortalData
 * @param {{ secondaryDomExtractionFailed?: boolean; secondaryDomValid?: boolean; failureReason?: string | null }} [planReviewStateRef]
 */
function arlingtonRestoreApprovedDocumentsFromPriorOrMarkFailed(
  integratedTabs,
  priorPortalData,
  planReviewStateRef,
) {
  if (!integratedTabs?.approvedDocuments) return;
  const adDest = integratedTabs.approvedDocuments;
  const priorAd =
    priorPortalData?.tabs?.planReview?.tabs?.approvedDocuments?.documents;
  const priorCount = Array.isArray(priorAd) ? priorAd.length : 0;

  if (Array.isArray(adDest.documents) && adDest.documents.length === 0) {
    if (priorCount > 0) {
      adDest.documents = structuredCloneWorksSafe(priorAd);
      console.log(
        `[Arlington][PlanReview] Approved Documents DOM weak — preserved ${priorCount} prior row(s)`,
      );
      if (planReviewStateRef && typeof planReviewStateRef === "object") {
        planReviewStateRef.secondaryDomExtractionFailed = true;
        planReviewStateRef.secondaryDomValid = false;
        planReviewStateRef.failureReason =
          `${planReviewStateRef.failureReason || ""} approved_dom_weak_preserved_prior`.trim();
      }
    } else {
      adDest.secondaryExtractionStatus = "dom_extraction_failed";
      console.log(
        "[Arlington][PlanReview] Approved Documents DOM weak — no prior rows; marked dom_extraction_failed",
      );
      if (planReviewStateRef && typeof planReviewStateRef === "object") {
        planReviewStateRef.secondaryDomExtractionFailed = true;
        planReviewStateRef.secondaryDomValid = false;
        planReviewStateRef.failureReason =
          `${planReviewStateRef.failureReason || ""} approved_dom_extraction_failed`.trim();
      }
    }
  }
}

/**
 * Pick the active ERMS tabpanel: hash href / aria-controls first, then content score.
 * @param {import("playwright").Page | import("playwright").Frame} frame
 * @param {string} label
 * @param {RegExp} expectedRegex
 * @param {{ panelHref?: string; ariaControls?: string }} [hints]
 * @returns {Promise<import("playwright").ElementHandle | null>}
 */
async function arlingtonResolveActiveErmsPanel(
  frame,
  label,
  expectedRegex,
  hints,
) {
  const panelHref = `${hints?.panelHref || ""}`.trim();
  const ariaControls = `${hints?.ariaControls || ""}`.trim();

  const handle = await frame.evaluateHandle(
    ({
      expectedSource,
      panelHrefRaw,
      ariaControlsRaw,
      panelLabelRaw,
    }) => {
      const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
      const panelLabelNorm = `${panelLabelRaw || ""}`.trim();
      const labelIsProjectInformation =
        panelLabelNorm === "Project Information";
      const labelIsApprovedDocuments =
        panelLabelNorm === "Approved Documents";

      const projectInfoLabels = [
        "Project ID",
        "Plan Review Project Name",
        "Accela CAP ID",
        "Address",
        "Review Type",
        "CPHD Case #",
      ];

      const badProjectInfoContainer =
        /arlington-header|header|footer|nav|main|page|subcontent|maincontent|wrap|menu|help/i;

      const chromeText =
        /Building Arlington|Jobs|Services A-Z|en Español|Help|Sign Out|Custom Help Menu/i;

      const approvedChromeText =
        /Building Arlington|Jobs\s*•\s*Services A-Z|Sign Out|Projects Settings Profile|en Español|ePlan Review Help/i;

      /**
       * Approved Documents must be the ERMS document grid, not site header/nav.
       * @param {HTMLElement} el
       * @param {string} text
       * @param {number} rows
       * @param {number} docActions
       */
      function approvedDocumentsPanelUnacceptable(el, text, rows, docActions) {
        if (!labelIsApprovedDocuments || !el) return false;
        const idRaw = `${el.id || ""}`.trim();
        if (/arlington-header/i.test(idRaw)) return true;
        if (/Building Arlington/i.test(text)) return true;
        if (
          /Jobs\s*•\s*Services A-Z/i.test(text) ||
          /Sign Out/i.test(text) ||
          /Projects Settings Profile/i.test(text)
        ) {
          return true;
        }
        const markerHits = [
          /File Actions/i.test(text),
          /Document Date/i.test(text),
          /Download/i.test(text),
          /Approved Plan Set/i.test(text),
          /Review Results Letter/i.test(text),
        ].filter(Boolean).length;
        if (rows === 0 && markerHits < 2) return true;
        if (markerHits < 2 || docActions < 1) return true;
        if (rows < 2 && markerHits < 4) return true;
        return false;
      }

      /**
       * PI tab must land on real form markup, not page chrome wrappers.
       * @param {HTMLElement | null | undefined} el
       */
      function projectInformationPanelUnacceptable(el) {
        if (!labelIsProjectInformation || !el) return false;
        const textInner = norm(el.innerText || el.textContent || "");
        if (
          badProjectInfoContainer.test(
            `${el.id || ""} ${el.className || ""}`,
          )
        ) {
          return true;
        }
        if (chromeText.test(textInner)) return true;
        const labelHits = projectInfoLabels.filter((x) =>
          new RegExp(
            x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          ).test(textInner),
        ).length;
        const formControls = el.querySelectorAll(
          "input, textarea, select",
        ).length;
        if (labelHits < 2 || formControls < 1) return true;
        return false;
      }

      let expected;
      try {
        expected = new RegExp(expectedSource, "i");
      } catch (_) {
        expected = /^$/;
      }

      /** @returns {HTMLElement | null} */
      function pickHrefPanel() {
        const raw = `${panelHrefRaw || ""}`.trim();
        if (!raw || raw.toLowerCase() === "#") return null;
        let sel = "";
        try {
          if (raw.startsWith("#")) sel = raw;
          else {
            const m = raw.match(/#([\w\-:.]+)\s*$/);
            sel = m ? `#${m[1]}` : "";
          }
        } catch (_) {
          sel = "";
        }
        if (!sel) return null;
        try {
          const el = /** @type {HTMLElement | null} */ (
            document.querySelector(sel)
          );
          const t = norm(el?.innerText || el?.textContent || "");
          if (el && t.length > 40) return el;
        } catch (_) {
          /**/
        }
        return null;
      }

      /** @returns {HTMLElement | null} */
      function pickAriaPanel() {
        const idRaw = `${ariaControlsRaw || ""}`.trim();
        if (!idRaw) return null;
        try {
          const el = /** @type {HTMLElement | null} */ (
            document.getElementById(idRaw)
          );
          const t = norm(el?.innerText || el?.textContent || "");
          if (el && t.length > 40) return el;
        } catch (_) {
          /**/
        }
        return null;
      }

      const linked = pickHrefPanel() || pickAriaPanel();
      if (linked && !projectInformationPanelUnacceptable(linked)) {
        if (labelIsApprovedDocuments) {
          const lt = norm(linked.innerText || linked.textContent || "");
          const lRows = linked.querySelectorAll("tr").length;
          const lDocActions = linked.querySelectorAll(
            "input.docaction,input.img-button.docaction,input[type='image']",
          ).length;
          if (
            !approvedDocumentsPanelUnacceptable(
              linked,
              lt,
              lRows,
              lDocActions,
            )
          ) {
            return linked;
          }
        } else {
          return linked;
        }
      }

      const planSetLeak =
        /Plan Set Documents|Proposed Plat\/Site Plan|Construction Plans|C-401|RW-3329 McDonalds 1 of 7/i;

      const hasPlanSetInstructions =
        /Document Upload Instructions and Tips|Plan Set Documents Must be|Proposed Plat\/Site Plan|Construction Plans/i;

      const broadIds = /^(main|page|subcontent|maincontent)$/i;

      const panelSelectors = [
        ".ui-tabs-panel",
        '[role="tabpanel"]',
        ".tab-content",
        ".tab-pane",
        "div[id]",
        "section",
      ].join(",");

      const candidates = [...document.querySelectorAll(panelSelectors)]
        .map((el) => {
          const text = norm(el.innerText || el.textContent);
          let rect = { width: 0, height: 0 };
          try {
            const r = el.getBoundingClientRect?.();
            if (r)
              rect = { width: r.width || 0, height: r.height || 0 };
          } catch (_) {
            /**/
          }
          const tables = el.querySelectorAll("table").length;
          const rows = el.querySelectorAll("tr").length;
          const actions = el.querySelectorAll(
            "input.docaction,input[type='image'],a,button",
          ).length;
          const docActions = el.querySelectorAll(
            "input.docaction,input.img-button.docaction,input[type='image']",
          ).length;

          const expectedHit = expected.test(text);
          const badPlanSetOnly =
            planSetLeak.test(text) && !expectedHit;

          /** @type {number} */
          let score = 0;
          if (expectedHit) score += 1000;
          if (tables) score += tables * 20;
          if (rows) score += rows * 5;
          if (actions) score += actions;
          if (rect.width > 0 && rect.height > 0) score += 25;
          const clsRole = `${el.className || ""} ${el.getAttribute("role") || ""}`;
          if (/ui-tabs-panel|tabpanel|tab-content|tab-pane/i.test(clsRole))
            score += 50;
          const pid = `${el.id || ""}`.trim();
          if (broadIds.test(pid)) score -= 10000;
          if (hasPlanSetInstructions.test(text) && !expectedHit)
            score -= 10000;

          if (labelIsProjectInformation) {
            const idCls = `${el.id || ""} ${el.className || ""}`;
            if (badProjectInfoContainer.test(idCls))
              score -= 100000;
            if (chromeText.test(text)) score -= 100000;
            const labelHits = projectInfoLabels.filter((x) =>
              new RegExp(
                x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "i",
              ).test(text),
            ).length;
            const formControls = el.querySelectorAll(
              "input, textarea, select",
            ).length;
            if (labelHits >= 2) score += 5000;
            if (formControls > 0) score += 1000;
            if (labelHits < 2) score -= 10000;
          }
          if (labelIsApprovedDocuments) {
            const idCls = `${el.id || ""} ${el.className || ""}`;
            if (/arlington-header/i.test(idCls)) score -= 200000;
            if (approvedChromeText.test(text)) score -= 200000;
            const markerHits = [
              /File Actions/i.test(text),
              /Document Date/i.test(text),
              /Download/i.test(text),
              /Approved Plan Set/i.test(text),
              /Review Results Letter/i.test(text),
            ].filter(Boolean).length;
            if (markerHits >= 3) score += 4000;
            if (rows > 1) score += rows * 12;
            if (docActions > 0) score += docActions * 8;
            if (tables > 0) score += tables * 40;
            if (
              approvedDocumentsPanelUnacceptable(el, text, rows, docActions)
            ) {
              score -= 250000;
            }
          }
          if (
            `${el.getAttribute("aria-hidden") || ""}`.toLowerCase() === "true"
          )
            score -= 800;
          try {
            const st = getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden")
              score -= 2000;
          } catch (_) {
            /**/
          }
          if (
            typeof el.closest === "function" &&
            el.closest("#divDocuments")
          ) {
            score -= 50000;
          }
          if (badPlanSetOnly) score -= 10000;

          return {
            el,
            score,
            text,
            id: el.id || "",
            className: String(el.className || ""),
            role: el.getAttribute("role") || "",
            ariaHidden: el.getAttribute("aria-hidden") || "",
            tables,
            rows,
            actions,
            expectedHit,
            badPlanSetOnly,
          };
        })
        .filter((x) => {
          if (x.text.length <= 20 || x.score <= 0) return false;
          if (!labelIsApprovedDocuments) return true;
          const docActions = x.el.querySelectorAll(
            "input.docaction,input.img-button.docaction,input[type='image']",
          ).length;
          return !approvedDocumentsPanelUnacceptable(
            x.el,
            x.text,
            x.rows,
            docActions,
          );
        })
        .sort((a, b) => b.score - a.score);

      return candidates[0]?.el || null;
    },
    {
      expectedSource: expectedRegex.source,
      panelHrefRaw: panelHref,
      ariaControlsRaw: ariaControls,
      panelLabelRaw: label,
    },
  );

  const element =
    typeof handle?.asElement === "function"
      ? handle.asElement()
      : null;

  if (!element) {
    await handle.dispose().catch(() => {});
    console.log(
      `[Arlington][PlanReview] active panel not resolved for ${label}`,
    );
    return null;
  }

  const diag = await element.evaluate((el) => {
    const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
    const text = norm(el.innerText || el.textContent || "");
    const projectInfoLabels = [
      "Project ID",
      "Plan Review Project Name",
      "Accela CAP ID",
      "Address",
      "Review Type",
      "CPHD Case #",
    ];
    const labelHits = projectInfoLabels.filter((x) =>
      new RegExp(
        x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      ).test(text),
    ).length;
    const controls =
      el.querySelectorAll("input, textarea, select").length;
    const base = {
      id: el.id || "",
      className: String(el.className || ""),
      role: el.getAttribute("role") || "",
      ariaHidden: el.getAttribute("aria-hidden") || "",
      preview: norm(el.innerText || el.textContent).slice(0, 700),
      tables: el.querySelectorAll("table").length,
      rows: el.querySelectorAll("tr").length,
      actions: el.querySelectorAll(
        "input.docaction,input[type='image'],a,button",
      ).length,
      controls,
      labelHits,
    };
    return base;
  });

  if (`${label}`.trim() === "Project Information") {
    console.log(
      `[Arlington][PlanReview] Project Information resolved panel id=${diag.id ?? ""} controls=${diag.controls ?? 0} labels=${diag.labelHits ?? 0}`,
    );
  }

  if (`${label}`.trim() === "Approved Documents") {
    const strength = await arlingtonEvaluateApprovedDocumentsPanelStrength(
      element,
    );
    if (!strength.acceptable) {
      console.log(
        `[Arlington][PlanReview] active panel rejected weak Approved Documents id=${strength.id || diag.id || ""} reason=${strength.reason} rows=${strength.rows} preview=${(strength.preview || diag.preview || "").slice(0, 120)}`,
      );
      await element.dispose().catch(() => {});
      return null;
    }
  }

  console.log(`[Arlington][PlanReview] active panel "${label}" ${JSON.stringify(diag)}`);

  return /** @type {import("playwright").ElementHandle} */ (element);
}

/**
 * Strict top-tab click + wait for active tab / markers, then resolve active panel handle.
 * @param {import("playwright").Page | import("playwright").Frame} frame
 * @param {string} label
 * @param {RegExp} expectedRegex
 * @returns {Promise<import("playwright").ElementHandle | null>}
 */
async function arlingtonClickErmsTopTabAndWait(frame, label, expectedRegex) {
  const parentPage =
    typeof frame.waitForTimeout === "function"
      ? frame
      : frame.page?.();

  const beforeSig = await frame.evaluate(() => {
    const body =
      document.body?.innerText || document.body?.textContent || "";
    return body.replace(/\s+/g, " ").trim().slice(0, 3000);
  });

  /** @type {{ panelHref?: string; ariaControls?: string }} */
  let panelHints = {};

  const clicked = await frame.evaluate((tabLabel) => {
    const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
    const normLabel = norm(tabLabel);
    const lower = normLabel.toLowerCase();

    function txtOf(el) {
      return norm(el.innerText || el.textContent || "");
    }

    /** @returns {Element | null} */
    function pickTarget() {
      const prio = [
        ".ui-tabs-nav a",
        "a[href^='#']",
        "a",
        "button",
        'li[role="tab"] a',
        "li",
        "span",
      ];
      for (const sel of prio) {
        const nodes = [...document.querySelectorAll(sel)];
        /** @type {Element | undefined} */
        const exact = nodes.find(
          (e) =>
            txtOf(e).length > 0 &&
            txtOf(e).toLowerCase() === lower,
        );
        if (exact) return exact;
        /** @type {Element | undefined} */
        const inc = nodes.find(
          (e) =>
            txtOf(e).length > 0 &&
            txtOf(e).toLowerCase().includes(lower),
        );
        if (inc) return inc;
      }
      return null;
    }

    /** @returns {HTMLElement | null} */
    function resolveClickable(target) {
      if (!(target instanceof Element)) return null;
      /** @type {HTMLElement | null} */
      let clickEl = target.matches("a,button,input,[onclick]")
        ? /** @type {HTMLElement} */ (target)
        : null;
      if (!clickEl) {
        clickEl =
          /** @type {HTMLElement | null} */ (
            target.querySelector("a[href],button,input,[onclick]")
          );
      }
      if (!clickEl) {
        clickEl =
          /** @type {HTMLElement | null} */ (
            target.closest("a,button,input,[onclick]")
          );
      }
      if (!clickEl && target.matches("[onclick]"))
        clickEl = /** @type {HTMLElement} */ (target);

      const tagU = `${target.tagName || ""}`.toUpperCase();
      if (
        !clickEl &&
        tagU === "LI" &&
        target.getAttribute("onclick")
      ) {
        clickEl = /** @type {HTMLElement} */ (target);
      }

      return clickEl;
    }

    const target = pickTarget();
    if (!target) {
      return {
        ok: false,
        reason: "tab_not_found",
        label: tabLabel,
        targetTag: "",
        clickableTag: "",
        clickableHref: "",
        clickableId: "",
        clickableClass: "",
        panelHref: "",
        ariaControls: "",
      };
    }

    const clickable = resolveClickable(target);
    if (!clickable) {
      return {
        ok: false,
        reason: "no_clickable_child",
        label: tabLabel,
        targetTag: target.tagName,
        clickableTag: "",
        clickableHref: "",
        clickableId: `${target.id || ""}`,
        clickableClass: String(target.className || ""),
        panelHref: "",
        ariaControls: "",
      };
    }

    clickable.click();

    const hrefRaw = `${clickable.getAttribute("href") || ""}`.trim();
    const ariaControlsRaw =
      `${clickable.getAttribute("aria-controls") || ""}`.trim();

    return {
      ok: true,
      reason: "",
      label: tabLabel,
      targetTag: target.tagName,
      clickableTag: clickable.tagName,
      clickableHref: hrefRaw,
      clickableId: clickable.id || "",
      clickableClass: String(clickable.className || ""),
      panelHref: hrefRaw,
      ariaControls: ariaControlsRaw,
    };
  }, label);

  if (clicked?.ok) {
    console.log(
      `[Arlington][PlanReview] top tab click ${label}: targetTag=${clicked.targetTag || "?"} clickableTag=${clicked.clickableTag || "?"} clickableHref=${clicked.clickableHref || ""} clickableId=${clicked.clickableId || ""} clickableClass=${clicked.clickableClass || ""}`,
    );
    panelHints = {
      panelHref: `${clicked.clickableHref || clicked.panelHref || ""}`.trim(),
      ariaControls: `${clicked.ariaControls || ""}`.trim(),
    };
  } else {
    console.log(
      `[Arlington][PlanReview] top tab click ${label}: FAILED reason=${`${clicked?.reason || "unknown"}`.trim()} targetTag=${clicked?.targetTag || "?"} clickableTag=?`,
    );
  }

  if (!clicked || !clicked.ok) {
    let fb = false;
    if (typeof parentPage.waitForTimeout === "function") {
      fb = await clickArlingtonErmsTopTab(frame, parentPage, label).catch(
        () => false,
      );
      if (!fb)
        fb = await clickArlingtonPlanReviewSubTab(parentPage, label).catch(
          () => false,
        );
      if (!fb)
        fb = await clickArlingtonPlanReviewSubTab(
          /** @type {import("playwright").Page} */ (frame),
          label,
        ).catch(() => false);
    }
    if (!fb) return null;
    panelHints = {};
  }

  await frame
    .waitForFunction(
      ({ expectedSource, beforeSig: bs, tabLabel: tl }) => {
        const body =
          document.body?.innerText || document.body?.textContent || "";
        let expectedOk = false;
        try {
          expectedOk = new RegExp(expectedSource, "i").test(body);
        } catch (_) {
          expectedOk = false;
        }
        if (expectedOk) return true;

        const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
        const lowNeedle = norm(tl).toLowerCase();
        if (!lowNeedle) return false;

        /** @returns {boolean} */
        const cnActive = (el) => {
          if (!el) return false;
          const c =
            (el.getAttribute && el.getAttribute("class")) ||
            `${/** @type {{ className?: unknown }} */ (el).className ?? ""}`;
          return /ui-tabs-active|ui-state-active|\bactive\b|\bselected\b/i.test(
            `${c}`,
          );
        };

        for (const li of document.querySelectorAll(
          '.ui-tabs-nav li, ul[role="tablist"] li[role="tab"]',
        )) {
          if (!cnActive(li)) continue;
          const tlLi = norm(li.innerText || "").toLowerCase();
          if (
            tlLi.includes(lowNeedle) ||
            lowNeedle.includes(tlLi)
          )
            return true;
          const a = li.querySelector("a");
          if (
            a &&
            norm(a.innerText || "").toLowerCase().includes(lowNeedle)
          )
            return true;
        }

        for (const a of document.querySelectorAll(
          '.ui-tabs-nav a.ui-state-active, a.ui-tabs-anchor.ui-state-active, [role="tab"].ui-state-active',
        )) {
          if (
            cnActive(a) &&
            norm(a.innerText || "").toLowerCase().includes(lowNeedle)
          )
            return true;
        }

        const current = body.replace(/\s+/g, " ").trim().slice(0, 3000);
        return current !== bs;
      },
      {
        expectedSource: expectedRegex.source,
        beforeSig,
        tabLabel: label,
      },
      { timeout: 10000, polling: 250 },
    )
    .catch(() => null);

  if (`${label}`.trim() === "Project Information") {
    await frame
      .waitForFunction(
        () => {
          const text =
            document.body?.innerText || document.body?.textContent || "";
          return (
            /Project ID/i.test(text) &&
            /Plan Review Project Name/i.test(text) &&
            /Accela CAP ID/i.test(text)
          );
        },
        { timeout: 10000, polling: 250 },
      )
      .catch(() => null);
  }

  if (typeof parentPage?.waitForTimeout === "function") {
    await parentPage.waitForTimeout(1500).catch(() => {});
  }

  await dismissBlockingModalsInArlingtonPlanReviewFrame(frame).catch(
    () => {},
  );

  return await arlingtonResolveActiveErmsPanel(
    frame,
    label,
    expectedRegex,
    panelHints,
  );
}

/**
 * Click ERMS secondary top-level tab and resolve the scored active panel.
 * @returns {Promise<import("playwright").ElementHandle | null>}
 */
async function clickAndResolveArlingtonErmsTopPanel(page, ermsRoot, st) {
  const re = arlingtonSecondaryExpectedRegex(st.tabKey);

  if (st.tabKey === "approvedDocuments") {
    return clickAndResolveArlingtonApprovedDocumentsPanel(
      page,
      ermsRoot,
      st,
      re,
    );
  }

  if (st.tabKey === "projectInformation") {
    return arlingtonClickErmsTopTabAndWait(ermsRoot, st.label, re).catch(
      () => null,
    );
  }

  /** @type {import("playwright").ElementHandle | null} */
  let panelEl = await arlingtonClickErmsTopTabAndWait(
    ermsRoot,
    st.label,
    re,
  ).catch(() => null);

  if (!panelEl) {
    console.log(
      `[Arlington][PlanReview] active panel "${st.label}" not resolved after top tab click; DOM extraction skipped for this tab`,
    );
    return null;
  }

  return panelEl;
}

/**
 * @returns {Promise<{ domRowCount: number }>}
 */
async function arlingtonSecondaryTabOptionalDomMerge(
  page,
  domTarget,
  st,
  integratedTabs,
  mergeOpts,
) {
  const priorPortalData =
    mergeOpts && typeof mergeOpts === "object"
      ? mergeOpts.priorPortalData
      : null;
  const permitNumber =
    mergeOpts && typeof mergeOpts === "object"
      ? `${mergeOpts.permitNumber || ""}`.trim()
      : "";
  const planReviewStateRef =
    mergeOpts && typeof mergeOpts === "object"
      ? mergeOpts.planReviewStateRef
      : null;
  let domRowCount = 0;
  /** @type {import("playwright").Page | import("playwright").Frame} */
  const ermsRoot = domTarget;
  const parentPage = ermsRoot.page ? ermsRoot.page() : page;

  /** @type {import("playwright").ElementHandle | null} */
  let panelEl = null;
  try {
      if (st.tabKey === "projectInformation") {
      const piResult = await arlingtonExtractArlingtonProjectInformationFields(
        parentPage,
        ermsRoot,
        permitNumber,
      );
      const piWeak = arlingtonProjectInformationExtractionIsWeak(
        piResult.fields,
        permitNumber,
      );
      if (
        planReviewStateRef &&
        !piWeak &&
        piResult.fields.some((f) => `${f?.value ?? ""}`.trim().length > 0)
      ) {
        planReviewStateRef.projectInformationPanelResolved = true;
      }
      arlingtonMergeProjectInformationFieldsDest(
        integratedTabs,
        piResult.fields,
        priorPortalData,
        permitNumber,
        {
          diagnosticReason: piResult.diagnosticReason,
          unityFrameFound: piResult.unityFrameFound,
          selectedFrameUrl: piResult.selectedFrameUrl,
        },
      );
    }

    panelEl = await clickAndResolveArlingtonErmsTopPanel(page, ermsRoot, st);
    if (st.tabKey === "reviewResultsAndMarkups" && planReviewStateRef) {
      planReviewStateRef.reviewResultsVisited = true;
    }
    if (!panelEl) {
      if (st.tabKey === "reviewResultsAndMarkups" && planReviewStateRef) {
        planReviewStateRef.reviewResultsPanelResolved = false;
      }
      if (st.tabKey === "approvedDocuments") {
        arlingtonRestoreApprovedDocumentsFromPriorOrMarkFailed(
          integratedTabs,
          priorPortalData,
          planReviewStateRef,
        );
      }
      if (st.tabKey === "projectInformation") {
        return {
          domRowCount:
            integratedTabs.projectInformation?.documents?.length ?? 0,
        };
      }
      return { domRowCount };
    }

    await logArlingtonErmsSecondaryActivePanelDiag(panelEl, st.label);

    const extractMapped = async (p) => {
      let rawSec = await extractArlingtonSecondaryRowsFromPanel(
        p,
        st.tabKey,
      );
      const filtered = arlingtonFilterSecondaryDomRowsAgainstPlanSet(
        rawSec,
        st.label,
        st.tabKey,
      );
      rawSec = filtered.kept;

      const mapped = rawSec.map((r) =>
        mapArlingtonDomSecondaryTabRowToDoc(r, st.tabKey),
      );
      return mapped;
    };

    /** @type {Awaited<ReturnType<typeof extractMapped>>} */
    let mapped = await extractMapped(panelEl);

    if (
      st.tabKey === "reviewResultsAndMarkups" &&
      mapped.length === 0
    ) {
      for (const nl of ARLINGTON_REVIEW_RESULTS_DOM_SUBTABS) {
        // eslint-disable-next-line no-await-in-loop
        const hit = await clickArlingtonIntegratedNestedTab(page, nl);
        if (hit) break;
      }
      await parentPage.waitForTimeout(1000).catch(() => {});
      await panelEl.dispose().catch(() => {});
      panelEl = await arlingtonResolveActiveErmsPanel(
        ermsRoot,
        st.label,
        ARLINGTON_SECONDARY_REVIEW_RESULTS_RE,
      );
      if (panelEl) {
        await logArlingtonErmsSecondaryActivePanelDiag(panelEl, st.label).catch(
          () => {},
        );
        mapped = await extractMapped(panelEl);
      }
    }

    domRowCount = mapped.length;

    if (
      st.tabKey === "approvedDocuments" ||
      st.tabKey === "reviewResultsAndMarkups"
    ) {
      if (st.tabKey === "reviewResultsAndMarkups" && planReviewStateRef) {
        planReviewStateRef.reviewResultsPanelResolved = true;
      }
      const dest = integratedTabs[st.tabKey]?.documents;
      if (Array.isArray(dest) && mapped.length > 0) {
        dest.length = 0;
        arlingtonMergeSecondaryDomDocuments(dest, mapped);
      } else if (st.tabKey === "reviewResultsAndMarkups") {
        if (Array.isArray(dest)) {
          dest.length = 0;
        }
        if (mapped.length === 0) {
          console.log(
            "[Arlington][PlanReview] Review Results & Mark-ups panel resolved but no document rows found; saving empty result state",
          );
        }
      } else if (st.tabKey === "approvedDocuments" && mapped.length === 0) {
        arlingtonRestoreApprovedDocumentsFromPriorOrMarkFailed(
          integratedTabs,
          priorPortalData,
          planReviewStateRef,
        );
      }
      return { domRowCount };
    }

    const dest = integratedTabs[st.tabKey]?.documents;
    if (Array.isArray(dest)) {
      if (mapped.length > 0 && st.tabKey === "projectInformation") {
        dest.length = 0;
      }
      arlingtonMergeSecondaryDomDocuments(dest, mapped);
    }

    return { domRowCount };
  } catch (secErr) {
    console.warn(
      `[Arlington][PlanReview] ${st.label} merge: ${secErr && secErr.message ? secErr.message : secErr}`,
    );
    return { domRowCount };
  } finally {
    if (panelEl && typeof panelEl.dispose === "function") {
      await panelEl.dispose().catch(() => {});
    }
  }
}

function arlingtonSecondaryTabRowCount(integratedTabs, tabKey) {
  const tab = integratedTabs[tabKey];
  if (!tab) return 0;
  const docCount = Array.isArray(tab.documents) ? tab.documents.length : 0;
  if (tabKey === "reviewResultsAndMarkups") {
    const commentCount = Array.isArray(tab.comments) ? tab.comments.length : 0;
    return Math.max(docCount, commentCount);
  }
  return docCount;
}

async function runArlingtonSecondaryTabsExtractPhase(opts) {
  const {
    page,
    domTarget,
    integratedTabs,
    priorPortalData,
    planReviewStateRef,
  } = opts;
  const scopeNorm = opts.scope
    ? arlingtonNormalizePlanReviewActionScope(opts.scope)
    : null;

  for (const st of ARLINGTON_SECONDARY_TAB_SPECS) {
    if (
      scopeNorm &&
      !arlingtonPlanReviewScopeAllowsSecondaryTab(scopeNorm, st.tabKey)
    ) {
      continue;
    }
    let domRowCount = 0;
    try {
      const mergeOut = await arlingtonSecondaryTabOptionalDomMerge(
        page,
        domTarget,
        st,
        integratedTabs,
        {
          priorPortalData,
          planReviewStateRef,
          permitNumber: `${opts.permitNumber || ""}`.trim(),
        },
      );
      domRowCount =
        mergeOut && typeof mergeOut.domRowCount === "number"
          ? mergeOut.domRowCount
          : 0;

      if (st.tabKey !== "projectInformation") {
        console.log(
          `[Arlington][PlanReview] ${st.label} DOM rows=${domRowCount} downloads=0`,
        );
      }
    } catch (secErr) {
      console.warn(
        `[Arlington][PlanReview] tab "${st.label}": ${secErr && secErr.message ? secErr.message : secErr}`,
      );
      const rowCount = arlingtonSecondaryTabRowCount(integratedTabs, st.tabKey);
      const fieldCount =
        integratedTabs.projectInformation?.fields?.length ?? 0;
      if (st.tabKey === "projectInformation") {
        console.log(
          `[Arlington][PlanReview] Project Information fields=${fieldCount} documents=${rowCount} (after tab error)`,
        );
      } else {
        console.log(
          `[Arlington][PlanReview] ${st.label} DOM rows=${domRowCount} downloads=0`,
        );
      }
    }
  }
}

async function runArlingtonSecondaryTabsDownloadPhase(opts) {
  const {
    page,
    domTarget,
    integratedTabs,
    sharedGridCtx,
    attachmentDedupeKeys,
    prSeenRowKeys,
    planSetErmsOrigin,
    downloadCtx,
  } = opts;

  const planSetSink =
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents ||
    [];

  const scopeNorm = opts.scope
    ? arlingtonNormalizePlanReviewActionScope(opts.scope)
    : "allPending";
  const continueLogPrefix =
    typeof opts.logPrefix === "string" ? opts.logPrefix : "";

  for (const st of ARLINGTON_SECONDARY_TAB_SPECS) {
    if (st.tabKey === "projectInformation") continue;
    if (
      opts.scope &&
      !arlingtonPlanReviewScopeAllowsSecondaryTab(scopeNorm, st.tabKey)
    ) {
      continue;
    }

    let dls = 0;
    let metadataOnly = 0;
    let aliases = 0;
    let domRowCount =
      arlingtonSecondaryTabRowCount(integratedTabs, st.tabKey) || 0;
    let uniqEstimate = 0;
    try {
      const sinkSec = integratedTabs[st.tabKey]?.documents;
      const sinkArr = Array.isArray(sinkSec) ? sinkSec : [];
      const pendingSec = sinkArr.filter(
        (d) => !arlingtonErmsSinkDocLooksUploadComplete(d),
      ).length;
      const downloadedSec = sinkArr.length - pendingSec;
      if (continueLogPrefix) {
        console.log(
          `${continueLogPrefix} source=${st.tabKey} total=${sinkArr.length} pending=${pendingSec} downloaded=${downloadedSec}`,
        );
      }
      const aliasDocSources = [
        planSetSink,
        integratedTabs.reviewResultsAndMarkups?.documents,
        integratedTabs.approvedDocuments?.documents,
        integratedTabs.projectInformation?.documents,
      ].filter((list) => Array.isArray(list) && list.length);

      uniqEstimate =
        Array.isArray(sinkSec) && sinkSec.length
          ? new Set(sinkSec.map((d) => arlingtonDomSecondaryDedupeKey(d))).size
          : 0;

      let dlTarget = domTarget;
      let tabReady = true;
      if (
        sharedGridCtx &&
        Array.isArray(sinkSec) &&
        sinkSec.length &&
        (st.tabKey === "reviewResultsAndMarkups" ||
          st.tabKey === "approvedDocuments")
      ) {
        const prep = await arlingtonPlanReviewPrepareSecondaryTabForDownload(
          page,
          domTarget,
          st,
        );
        dlTarget = prep.domTarget;
        tabReady = prep.ok;
        if (!tabReady) {
          arlingtonPlanReviewMarkSinkTabNotResolved(
            sinkSec,
            st.tabKey,
            prep.notResolvedReason,
          );
          console.log(
            `[Arlington][PlanReview] ${st.label} download-phase tab not resolved; marked pending_tab_not_resolved reason=${prep.notResolvedReason || "tab_not_resolved"}`,
          );
          const saver = sharedGridCtx.savePlanReviewCheckpoint;
          if (typeof saver === "function") {
            // eslint-disable-next-line no-await-in-loop
            await saver("tabNotResolved", {
              tab: st.tabKey,
              pending: arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(
                integratedTabs,
              ),
            }).catch(() => {});
            arlingtonPlanReviewMarkCheckpointSaved(sharedGridCtx);
            if (downloadCtx && typeof downloadCtx === "object") {
              arlingtonPlanReviewMarkCheckpointSaved(downloadCtx);
            }
          }
        }
      }

      if (
        sharedGridCtx &&
        Array.isArray(sinkSec) &&
        sinkSec.length &&
        tabReady
      ) {
        const result = await downloadArlingtonSecondaryApiDocumentsForSink(
          page,
          dlTarget,
          sinkSec,
          {
            attachmentDedupeKeys,
            prSeenRowKeys,
            downloadCtx: sharedGridCtx,
            ermsOrigin: planSetErmsOrigin,
            logLabel: st.label,
            aliasDocSources,
            downloadSource: st.tabKey,
          },
        );
        dls = result.downloads;
        metadataOnly = result.metadataOnly;
        aliases = result.aliases;
      } else if (Array.isArray(sinkSec) && sinkSec.length) {
        for (const doc of sinkSec) {
          if (!arlingtonPickSecondaryRowDocumentId(doc)) {
            doc.downloadStatus = "metadata_only";
            doc.status = doc.status || "api_metadata";
            metadataOnly++;
          }
        }
      }

      if (st.tabKey !== "projectInformation") {
        console.log(
          `[Arlington][PlanReview] ${st.label} DOM rows=${domRowCount} unique=${uniqEstimate} downloads=${dls}`,
        );
      }
    } catch (secErr) {
      console.warn(
        `[Arlington][PlanReview] tab "${st.label}" download-phase: ${secErr && secErr.message ? secErr.message : secErr}`,
      );
      const rowCount = arlingtonSecondaryTabRowCount(integratedTabs, st.tabKey);
      const fieldCount =
        integratedTabs.projectInformation?.fields?.length ?? 0;
      if (st.tabKey === "projectInformation") {
        console.log(
          `[Arlington][PlanReview] Project Information fields=${fieldCount} documents=${rowCount} (after tab error)`,
        );
      } else {
        console.log(
          `[Arlington][PlanReview] ${st.label} DOM rows=${domRowCount} unique=${uniqEstimate} downloads=${dls}`,
        );
      }
    }
  }
}

async function runArlingtonSecondaryTabsExtractAndDownload(opts) {
  await runArlingtonSecondaryTabsExtractPhase(opts);
  await runArlingtonSecondaryTabsDownloadPhase(opts);
}

async function extractPlanReviewArlington(page, ctx, downloadCtx) {
  if (
    !downloadCtx ||
    !downloadCtx.DOWNLOADS_DIR ||
    typeof downloadCtx.uploadFn !== "function"
  ) {
    console.warn(
      "  [Arlington][Plan Review] Arlington integrated Plan Review deferred — missing downloadCtx (run after Attachments)",
    );
    return {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
      arlingtonPlanReview: {
        used: false,
        message: null,
        tabs: null,
      },
    };
  }

  const attachmentDedupeKeys = attachmentDedupeSnapshotSet(
    downloadCtx.attachmentRows,
  );
  const prSeenRowKeys = new Set();
  const downloadedHashes =
    downloadCtx.downloadedHashes instanceof Map
      ? downloadCtx.downloadedHashes
      : new Map();

  const tenantPrCfg = ArlingtonAccelaProfile.planReview || {};
  const { prCfg, downloadScope: scrapeDownloadScope } =
    arlingtonResolveScrapePlanReviewCfg(tenantPrCfg, downloadCtx);
  if (scrapeDownloadScope) {
    console.log(
      `[Arlington][PlanReview] selective scrape scope=${scrapeDownloadScope}`,
    );
    downloadCtx.planReviewScope = scrapeDownloadScope;
  }
  const selectiveScrapeScope =
    scrapeDownloadScope &&
    scrapeDownloadScope !== "allPending" &&
    scrapeDownloadScope !== "all" &&
    scrapeDownloadScope !== "metadataOnly"
      ? scrapeDownloadScope
      : null;
  const skipPlanSetExtract =
    selectiveScrapeScope === "approvedDocuments" ||
    selectiveScrapeScope === "reviewResults" ||
    selectiveScrapeScope === "projectInformation";
  const unusedSnippet = (
    prCfg.unusedMessageIncludes || "this record does not use plan review"
  )
    .toString()
    .trim()
    .toLowerCase();
  const tabLabelToKey = prCfg.expectedTabKeys || {};
  const subTabLabels = Array.isArray(prCfg.expectedTabs)
    ? prCfg.expectedTabs
    : [
        "Plans & Documents",
        "Review Results & Mark-ups",
        "Approved Documents",
        "Project Information",
      ];


  console.log("  📋 [Arlington] Extracting plan review (tenant profile)...");

  const permitProjectId =
    `${downloadCtx.permitNumber || downloadCtx.recordNumber || ""}`.trim();
  if (!permitProjectId) {
    console.warn(
      "[Arlington][PlanReview] permitNumber missing on downloadCtx — REST calls may fail",
    );
  }

  if (!isArlingtonCapDetailPage(page)) {
    console.log(
      "     [Arlington][Plan Review] Arlington Cap Detail page required",
    );
    return {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
      arlingtonPlanReview: {
        used: false,
        message:
          "Could not scrape Plan Review — browser was not on an Arlington permit detail page.",
        tabs: null,
      },
    };
  }

  await ensureArlingtonRecordInfoActive(page);

  /** @type {string|null} */
  let screenshotBase64 = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  screenshotBase64 = screenshotBase64
    ? screenshotBase64.toString("base64")
    : null;
  const savedCapDetailUrl = page.url();



  const bodyCheck = await ctx.evaluate((snippet) => {
    const body = document.body ? document.body.innerText : "";
    const low = body.toLowerCase();
    if (!snippet || !low.includes(snippet)) {
      return { unused: false, message: null };
    }
    const rx =
      /this record does not use plan review[^.]*(?:\.|$)/i;
    const m = body.match(rx);
    return {
      unused: true,
      message: m
        ? m[0].trim()
        : "This record does not use plan review.",
    };
  }, unusedSnippet);

  if (bodyCheck.unused) {
    console.log(
      `     [Arlington][Plan Review] not used on this record: ${bodyCheck.message}`,
    );
    return {
      comments: [],
      text: bodyCheck.message || "",
      screenshot: screenshotBase64,
      planReviewSummary: null,
      downloadLinks: [],
      arlingtonPlanReview: {
        used: false,
        message: bodyCheck.message,
        tabs: null,
      },
    };
  }

  let integratedTabs = defaultArlingtonIntegratedTabsSkeleton();
  if (selectiveScrapeScope === "projectInformation") {
    const priorIntegrated = arlingtonPriorIntegratedTabsFromPortalData(
      downloadCtx?.priorPortalData,
    );
    if (priorIntegrated && typeof priorIntegrated === "object") {
      try {
        integratedTabs =
          structuredCloneWorksSafe(priorIntegrated) ?? priorIntegrated;
      } catch (_) {
        integratedTabs = JSON.parse(JSON.stringify(priorIntegrated));
      }
      console.log(
        "[Arlington][ProjectInfo] projectInformation-only update: preserving all out-of-scope tabs",
      );
    }
  }

  const existingValidPlanReview = arlingtonPortalDataHasValidPlanSet(
    downloadCtx.priorPortalData,
  );
  const planReviewState = {
    iframeReady: false,
    domReady: false,
    planSetValid: false,
    secondaryTabsValid: false,
    secondaryDomValid: false,
    suppressedSecondaryApiMetadata: false,
    secondaryDomExtractionFailed: false,
    usedApiFallback: false,
    shouldPersist: false,
    failureReason: null,
    tabs: null,
    partialPendingDownloads: false,
    reviewResultsVisited: false,
    reviewResultsPanelResolved: false,
    projectInformationPanelResolved: false,
  };

  const iframeDownloadsDisabled =
    prCfg.downloadFromIntegratedIframe !== true;

  const extractBudgetMs =
    typeof prCfg.extractBudgetMs === "number" ? prCfg.extractBudgetMs : 75000;
  const perTabMsCfg =
    typeof prCfg.perTabExtractBudgetMs === "number"
      ? prCfg.perTabExtractBudgetMs
      : 45000;
  const budgetMs =
    prCfg.planReviewIncludeSecondaryTabs === true
      ? Math.max(extractBudgetMs, 90000 + 3 * perTabMsCfg)
      : extractBudgetMs;
  const prDeadline = Date.now() + budgetMs;
  if (prCfg.planReviewIncludeSecondaryTabs === true) {
    console.log(
      `[Arlington][PlanReview] secondary tabs enabled=true extractBudgetMs=${budgetMs}`,
    );
  }
  /** @type {boolean} */
  let timedOut = false;

  const sharedGridCtx =
    iframeDownloadsDisabled
      ? null
      : {
          DOWNLOADS_DIR: downloadCtx.DOWNLOADS_DIR,
          supabaseProjectId: downloadCtx.supabaseProjectId,
          permitNumber:
            `${downloadCtx.permitNumber || downloadCtx.recordNumber || ""}`.trim(),
          uploadFn: downloadCtx.uploadFn,
          sanitizeFn: downloadCtx.sanitizeFn,
          downloadedHashes,
          supabaseStorageObjectMaxBytes: getSupabaseStorageObjectMaxBytes(),
          forceRetryOversizedDownloads:
            downloadCtx.forceRetryOversizedDownloads === true ||
            downloadCtx.forceRetryOversized === true,
          planReviewScope: scrapeDownloadScope || downloadCtx.planReviewScope,
        };

  const runPlanReviewPersistCheckpoint = async (
    phase,
    /** @type {Record<string, unknown>} */ extra,
  ) => {
    if (
      !downloadCtx.supabase ||
      !downloadCtx.userId ||
      typeof downloadCtx.hashPortalData !== "function"
    )
      return;
    const sg =
      sharedGridCtx && typeof sharedGridCtx === "object"
        ? /** @type {Record<string, unknown>} */ (sharedGridCtx)
        : null;
    const checkpointScope =
      selectiveScrapeScope || scrapeDownloadScope || downloadCtx?.planReviewScope;
    const inc = arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(
      integratedTabs,
      checkpointScope || undefined,
    );
    const partial =
      inc > 0 ||
      !!(sg && sg.planReviewDownloadsAbortedDeadline === true) ||
      !!(sg && sg.planReviewPartialPendingDownloads === true);
    const aborted = !!(sg && sg.planReviewDownloadsAbortedDeadline === true);
    const slice = buildArlingtonPlanReviewCheckpointTabSlice({
      integratedTabs,
      screenshotBase64,
      combinedText:
        typeof extra.text === "string"
          ? `${extra.text}`
          : `[Arlington][PlanReview] checkpoint phase=${phase}`,
      partialPendingDownloads: partial,
      scrapeStatus: aborted ? "partial_pending_downloads" : undefined,
    });
    await persistArlingtonPlanReviewCheckpoint({
      supabase: downloadCtx.supabase,
      userId: downloadCtx.userId,
      supabaseProjectId: downloadCtx.supabaseProjectId,
      permitNumber:
        `${downloadCtx.permitNumber || downloadCtx.recordNumber || ""}`.trim(),
      hashPortalData: downloadCtx.hashPortalData,
      planReviewTabPayload: slice,
      selectiveScope: checkpointScope || undefined,
    });
    if (sharedGridCtx && typeof sharedGridCtx === "object") {
      arlingtonPlanReviewMarkCheckpointSaved(
        /** @type {Record<string, unknown>} */ (sharedGridCtx),
      );
    }
    arlingtonPlanReviewMarkCheckpointSaved(downloadCtx);
    if (phase === "metadata") {
      const ps =
        integratedTabs?.plansAndDocuments?.sections?.planSetDocuments
          ?.documents?.length ?? 0;
      const rr =
        integratedTabs?.reviewResultsAndMarkups?.documents?.length ?? 0;
      const appr =
        integratedTabs?.approvedDocuments?.documents?.length ?? 0;
      const pif =
        integratedTabs?.projectInformation?.fields?.length ?? 0;
      console.log(
        `[Arlington][PlanReview] metadata checkpoint saved planSet=${ps} reviewResults=${rr} approved=${appr} projectFields=${pif}`,
      );
    }
  };

  if (sharedGridCtx) {
    Object.assign(sharedGridCtx, {
      planReviewIntegratedTabs: integratedTabs,
      touchSessionKeepalive:
        typeof downloadCtx.touchSessionKeepalive === "function"
          ? downloadCtx.touchSessionKeepalive
          : null,
      _arlingtonSession: downloadCtx._arlingtonSession || null,
      ermsVerificationToken: downloadCtx.ermsVerificationToken || "",
      scrapeDeadlineMs:
        typeof downloadCtx.scrapeDeadlineMs === "number"
          ? downloadCtx.scrapeDeadlineMs
          : 0,
      reserveMsForFinalSave:
        typeof downloadCtx.reserveMsForFinalSave === "number"
          ? downloadCtx.reserveMsForFinalSave
          : ARLINGTON_PLAN_REVIEW_RESUME_RESERVE_FINAL_SAVE_MS,
      planReviewDownloadsSinceCheckpoint: 0,
      planReviewDownloadsAbortedDeadline: false,
      planReviewPartialPendingDownloads: false,
      savePlanReviewCheckpoint: /** @type {(...a: unknown[]) => Promise<void>} */ (
        async (phaseTag, xs) => {
          const x =
            xs && typeof xs === "object" && !Array.isArray(xs)
              ? /** @type {Record<string, unknown>} */ (xs)
              : {};
          await runPlanReviewPersistCheckpoint(String(phaseTag || ""), x);
          if (phaseTag === "everyFive") {
            console.log(
              `[Arlington][PlanReview] checkpoint saved after 5 downloads downloaded=${x.downloaded ?? "?"} pending=${x.pending ?? "?"}`,
            );
          }
        }
      ),
    });
  }

  /** When scoped to Plan Set only, iframe row scans skip Supporting / CRL nested grids. */
  const scopePlanSetOnly = prCfg.scopePlanSetDocumentsOnly !== false;
  const scopedNestedPlanSections = scopePlanSetOnly
    ? /** @type {typeof ARLINGTON_PLAN_NESTED_SECTIONS} */ ([
        ["Plan Set Documents", "planSetDocuments"],
      ])
    : ARLINGTON_PLAN_NESTED_SECTIONS;

  /**
   * Scoped: internal Accela Plan Review tab + `iFrameOpenPlanReview`.
   * Legacy (non-scoped): optional external popup link + restore CapDetail.
   */
  let ermsComplete = false;
  let triedErmsNavigation = false;
  /** Playwright-download successes inside Plan Set grid (supplement to API URLs). */
  let planSetDomDownloads = 0;
  let usedExternalDomFlow = false;
  let usedInternalIframeFlow = false;
  let usedApiHydrate = false;
  /** True after scoped internal path attempted (avoid Accela modal loop on failure). */
  let attemptedScopedInternalPr = false;

  if (scopePlanSetOnly) {
    attemptedScopedInternalPr = true;
    console.log(
      "[Arlington][PlanReview] using internal Accela Plan Review tab",
    );
    const prActivate = await ensureArlingtonPlanReviewActive(page);
    if (!prActivate.ok) {
      console.log("     [Arlington][Plan Review] tab not found");
      await logArlingtonDetailTabCandidates(page, "Plan Review");
      return {
        comments: [],
        text: "",
        screenshot: screenshotBase64,
        planReviewSummary: null,
        downloadLinks: [],
        arlingtonPlanReview: {
          used: false,
          message: "Plan Review tab not found",
          tabs: null,
        },
      };
    }

    await page.waitForTimeout(1200).catch(() => {});
    await waitForAccelaLoad(page).catch(() => {});

    const useSecondaryShellReadiness =
      arlingtonPlanReviewScopeUsesSecondaryShellReadiness(selectiveScrapeScope);
    if (useSecondaryShellReadiness) {
      console.log(
        `[Arlington][PlanReview] selective secondary scope=${selectiveScrapeScope} — using ERMS shell readiness`,
      );
    }

    const prFrame = useSecondaryShellReadiness
      ? await waitForArlingtonPlanReviewErmsShellReady(
          page,
          60000,
          `${selectiveScrapeScope || ""}`.trim(),
        )
      : await waitForArlingtonPlanReviewIframeReady(page, 60000);
    planReviewState.iframeReady = !!prFrame;

    if (!prFrame) {
      planReviewState.failureReason =
        `${planReviewState.failureReason || ""} iframe_not_ready`.trim();
      if (useSecondaryShellReadiness) {
        console.warn(
          `[Arlington][PlanReview] ERMS shell not ready for secondary scope=${selectiveScrapeScope}; extraction aborted`,
        );
      } else {
        console.warn(
          "[Arlington][PlanReview] iFrameOpenPlanReview / PlanReviewIntegrated frame not ready",
        );
      }
    } else {
      planReviewState.domReady = true;
      await dismissBlockingModalsInArlingtonPlanReviewFrame(prFrame);

      const piOnlyScrape = scrapeDownloadScope === "projectInformation";
      const sink =
        integratedTabs.plansAndDocuments.sections.planSetDocuments.documents;

      let planSetErmsOrigin = "";
      try {
        planSetErmsOrigin = new URL(prFrame.url()).origin;
      } catch (_) {
        /**/
      }

      /** @type {{ responseLetters?: unknown[]; applicationDocs?: unknown[]; comments?: unknown[]; accelaDocTypes?: unknown[] } | null} */
      let prApiSecondaryFallback = null;

      if (skipPlanSetExtract) {
        console.log(
          `[Arlington][PlanReview] selective scope=${selectiveScrapeScope} — skipping Plan Set extract/API hydrate`,
        );
      }

      if (!piOnlyScrape && !skipPlanSetExtract) {
        await clickArlingtonPlanReviewSubTab(page, "Plans & Documents");
        await page.waitForTimeout(650).catch(() => {});
        await clickArlingtonIntegratedNestedTab(
          page,
          "Plan Set Documents",
        ).catch(() => false);
        await page.waitForTimeout(650).catch(() => {});

        const rawRows = await extractArlingtonPlanSetDocumentsFromPrPageDom(
          prFrame,
          { permitNumber: `${permitProjectId || ""}`.trim() },
        );
        sink.length = 0;
        for (const r of rawRows) {
          sink.push(mapArlingtonDomPlanSetRowToDoc(r));
        }
        arlingtonRebuildPlanSetSinkFromPortalCollection(
          sink,
          downloadCtx?.priorPortalData,
          { permitNumber: `${permitProjectId || ""}`.trim() },
        );
        arlingtonFinalizePlanSetDocumentsSink(sink);

        if (`${permitProjectId || ""}`.trim()) {
          const hydrateRet = await arlingtonPlanReviewApiHydrateTabs(
            page,
            permitProjectId,
            integratedTabs,
            {
              ermsOrigin: planSetErmsOrigin,
              scopedDomPrimaryPlanSet: scopePlanSetOnly,
              includeSecondaryTabs:
                prCfg.planReviewIncludeSecondaryTabs === true,
            },
          );
          prApiSecondaryFallback = hydrateRet.secondaryApiFallback || null;
          usedApiHydrate = true;
          arlingtonRebuildPlanSetSinkFromPortalCollection(
            sink,
            downloadCtx?.priorPortalData,
            { permitNumber: `${permitProjectId || ""}`.trim() },
          );
          arlingtonFinalizePlanSetDocumentsSink(sink);
        }
      } else if (piOnlyScrape) {
        console.log(
          "[Arlington][PlanReview] scope=projectInformation — skipping Plan Set extract/downloads",
        );
      }

      if (prCfg.planReviewIncludeSecondaryTabs === true) {
        await runArlingtonSecondaryTabsExtractPhase({
          page,
          domTarget: prFrame,
          integratedTabs,
          sharedGridCtx,
          attachmentDedupeKeys,
          prSeenRowKeys,
          downloadedHashes,
          planSetErmsOrigin,
          scope: scrapeDownloadScope,
          priorPortalData: downloadCtx?.priorPortalData,
          planReviewStateRef: planReviewState,
          permitNumber: permitProjectId,
        });
      }

      if (selectiveScrapeScope === "approvedDocuments") {
        const adAfterExtract =
          integratedTabs.approvedDocuments?.documents?.length ?? 0;
        if (adAfterExtract === 0) {
          arlingtonRestoreApprovedDocumentsFromPriorOrMarkFailed(
            integratedTabs,
            downloadCtx?.priorPortalData,
            planReviewState,
          );
        }
      }

      if (!piOnlyScrape && prApiSecondaryFallback) {
        arlingtonMaybeApplySecondaryApiAfterDom(
          integratedTabs,
          prApiSecondaryFallback,
          planSetErmsOrigin,
          planReviewState,
          existingValidPlanReview,
          downloadCtx?.priorPortalData,
        );
      }

      await runPlanReviewPersistCheckpoint("metadata", {}).catch(() => {});
      if (!piOnlyScrape) {
        arlingtonResumePlanReviewDownloadsFromPrior(
          integratedTabs,
          downloadCtx?.priorPortalData,
          true,
          {
            forceRetryOversized:
              downloadCtx?.forceRetryOversizedDownloads === true ||
              downloadCtx?.forceRetryOversized === true ||
              arlingtonEnvForceRetryOversizedPlanReviewDownloads(),
            configuredMaxUploadBytes: getSupabaseStorageObjectMaxBytes(),
          },
          selectiveScrapeScope || undefined,
        );
      }

      const dlOut = await runArlingtonPlanReviewDownloadPhasesAfterCheckpoint({
        page,
        domTarget: prFrame,
        integratedTabs,
        sharedGridCtx,
        sink,
        attachmentDedupeKeys,
        prSeenRowKeys,
        downloadedHashes,
        planSetErmsOrigin,
        prCfg,
        downloadCtx,
      });
      planSetDomDownloads = dlOut.planSetDomDownloads;

      if (
        selectiveScrapeScope === "approvedDocuments" ||
        selectiveScrapeScope === "reviewResults"
      ) {
        planReviewState.planSetValid = false;
      } else {
        planReviewState.planSetValid =
          arlingtonIntegratedTabsPlanSetValid(integratedTabs);
        if (planReviewState.domReady && sink.length === 0) {
          console.log(
            "[Arlington][PlanReview] Plan Set returned 0 despite ready iframe; treating as invalid DOM extraction",
          );
        }
      }

      const shCap = await page
        .screenshot({ fullPage: true })
        .catch(() => null);
      if (shCap) {
        screenshotBase64 = shCap.toString("base64");
      }
      ermsComplete = true;
      usedInternalIframeFlow = true;
    }
  } else {
    const candidateExternalPr =
      `${await findArlingtonExternalPlanReviewHref(page, ctx)}`.trim();
    if (
      candidateExternalPr &&
      arlingtonExternalPlanReviewHrefLooksValid(candidateExternalPr)
    ) {
      triedErmsNavigation = true;
      console.log(
        `[Arlington][PlanReview] external link found: ${candidateExternalPr}`,
      );
      try {
        const opened = await openArlingtonErmsPlanReviewViaExternalClick(
          page,
          ctx,
        );
        let prPage = opened.prPage;
        const openedNewTab = opened.openedNewTab;

        if (!prPage) {
          console.warn(
            "[Arlington][PlanReview] could not open external Plan Review page (click produced no navigation or popup)",
          );
        } else {
          let prUrl = "";
          try {
            prUrl = prPage.url();
          } catch (_) {
            /**/
          }
          console.log(
            `[Arlington][PlanReview] initial external page url=${prUrl}`,
          );

          await waitForArlingtonPlanReviewPastSignIn(prPage);

          const loadedOk =
            await waitForArlingtonPlanReviewPrPageLoaded(prPage);
          if (!loadedOk) {
            console.warn(
              "[Arlington][PlanReview] timed out waiting for Plan Review DOM signals",
            );
          }

          if (loadedOk) {
            usedExternalDomFlow = true;
            planReviewState.iframeReady = true;
            planReviewState.domReady = true;

            await dismissArlingtonPlanReviewViewDocsPopups(prPage);

            const topOk = await clickArlingtonPlanReviewSubTab(
              prPage,
              "Plans & Documents",
            );
            if (topOk) {
              await prPage.waitForTimeout(650).catch(() => {});
            }
            const nestOk = await clickArlingtonIntegratedNestedTab(
              prPage,
              "Plan Set Documents",
            ).catch(() => false);
            if (nestOk) {
              await prPage.waitForTimeout(650).catch(() => {});
            }

            const rawRows = await extractArlingtonPlanSetDocumentsFromPrPageDom(
              prPage,
              { permitNumber: `${permitProjectId || ""}`.trim() },
            );
            const sink =
              integratedTabs.plansAndDocuments.sections.planSetDocuments
                .documents;
            sink.length = 0;
            for (const r of rawRows) {
              sink.push(mapArlingtonDomPlanSetRowToDoc(r));
            }
            arlingtonRebuildPlanSetSinkFromPortalCollection(
              sink,
              downloadCtx?.priorPortalData,
              { permitNumber: `${permitProjectId || ""}`.trim() },
            );
            arlingtonFinalizePlanSetDocumentsSink(sink);

            let planSetErmsOrigin = "";
            try {
              planSetErmsOrigin = new URL(prPage.url()).origin;
            } catch (_) {
              /**/
            }

            /** @type {{ responseLetters?: unknown[]; applicationDocs?: unknown[]; comments?: unknown[]; accelaDocTypes?: unknown[] } | null} */
            let prApiSecondaryFallback = null;

            if (`${permitProjectId || ""}`.trim()) {
              const hydrateRet = await arlingtonPlanReviewApiHydrateTabs(
                prPage,
                permitProjectId,
                integratedTabs,
                {
                  ermsOrigin: planSetErmsOrigin,
                  scopedDomPrimaryPlanSet: scopePlanSetOnly,
                  includeSecondaryTabs:
                    prCfg.planReviewIncludeSecondaryTabs === true,
                },
              );
              prApiSecondaryFallback = hydrateRet.secondaryApiFallback || null;
              usedApiHydrate = true;
            }

            if (prCfg.planReviewIncludeSecondaryTabs === true) {
              await runArlingtonSecondaryTabsExtractPhase({
                page: prPage,
                domTarget: prPage,
                integratedTabs,
                sharedGridCtx,
                attachmentDedupeKeys,
                prSeenRowKeys,
                downloadedHashes,
                planSetErmsOrigin,
              });
            }

            if (prApiSecondaryFallback) {
              arlingtonMaybeApplySecondaryApiAfterDom(
                integratedTabs,
                prApiSecondaryFallback,
                planSetErmsOrigin,
                planReviewState,
                existingValidPlanReview,
                downloadCtx?.priorPortalData,
              );
            }

            await runPlanReviewPersistCheckpoint("metadata", {}).catch(() => {});
            arlingtonResumePlanReviewDownloadsFromPrior(
              integratedTabs,
              downloadCtx?.priorPortalData,
              true,
              {
                forceRetryOversized:
                  downloadCtx?.forceRetryOversizedDownloads === true ||
                  downloadCtx?.forceRetryOversized === true ||
                  arlingtonEnvForceRetryOversizedPlanReviewDownloads(),
                configuredMaxUploadBytes: getSupabaseStorageObjectMaxBytes(),
              },
            );

            const dlOutExt =
              await runArlingtonPlanReviewDownloadPhasesAfterCheckpoint({
                page: prPage,
                domTarget: prPage,
                integratedTabs,
                sharedGridCtx,
                sink,
                attachmentDedupeKeys,
                prSeenRowKeys,
                downloadedHashes,
                planSetErmsOrigin,
                prCfg,
                downloadCtx,
              });
            planSetDomDownloads = dlOutExt.planSetDomDownloads;

            planReviewState.planSetValid =
              arlingtonIntegratedTabsPlanSetValid(integratedTabs);
            if (planReviewState.domReady && sink.length === 0) {
              console.log(
                "[Arlington][PlanReview] Plan Set returned 0 despite ready iframe; treating as invalid DOM extraction",
              );
            }

            const shErms = await prPage
              .screenshot({ fullPage: true })
              .catch(() => null);
            if (shErms) {
              screenshotBase64 = shErms.toString("base64");
            }
            ermsComplete = true;
          }

          if (prPage !== page && openedNewTab) {
            await prPage.close().catch(() => {});
          }
        }
      } catch (ermsWalkErr) {
        console.warn(
          `[Arlington][PlanReview] ERMS walk error: ${ermsWalkErr.message}`,
        );
      } finally {
        await restoreArlingtonCapDetailAfterErms(page, savedCapDetailUrl);
        await waitForAccelaLoad(page).catch(() => {});
        await ensureArlingtonRecordInfoActive(page).catch(() => ({
          ok: false,
        }));
      }
    }
  }

  if (!ermsComplete && (triedErmsNavigation || attemptedScopedInternalPr)) {
    integratedTabs = defaultArlingtonIntegratedTabsSkeleton();
  }

  /** @type {Record<string, object>} */
  const tabsNamed = {};

  if (!ermsComplete) {
    if (scopePlanSetOnly) {
      console.log(
        "[Arlington][PlanReview] scoped Plan Review incomplete — skipping Accela modal/sub-tab loop",
      );
    } else {
    const prActivate = await ensureArlingtonPlanReviewActive(page);
    if (!prActivate.ok) {
      console.log("     [Arlington][Plan Review] tab not found");
      await logArlingtonDetailTabCandidates(page, "Plan Review");
      return {
        comments: [],
        text: "",
        screenshot: screenshotBase64,
        planReviewSummary: null,
        downloadLinks: [],
        arlingtonPlanReview: {
          used: false,
          message: "Plan Review tab not found",
          tabs: null,
        },
      };
    }

    await page.waitForTimeout(1200).catch(() => {});
    await waitForAccelaLoad(page).catch(() => {});
    await dismissArlingtonPlanReviewModals(page);
    await page.waitForTimeout(450).catch(() => {});

    for (const label of subTabLabels) {
    if (Date.now() > prDeadline) {
      timedOut = true;
      console.log(
        "[Arlington][Plan Review] extract budget exhausted before finishing Plan Review sub-tabs — returning partial text",
      );
      break;
    }

    const safeCheckpoint = `arlington_pr_${label
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48)}`;
    try {
      let subFound = await clickArlingtonPlanReviewSubTab(page, label);
      if (!subFound) {
        const panelTry = await clickAccelaNavPanel(
          ctx,
          page,
          [
            `a:has-text("${label}")`,
            `[id*="TabDataList"] a:has-text("${label}")`,
            `[id*="tabData"] a:has-text("${label}")`,
          ],
          label,
          {
            checkpointLabel: safeCheckpoint,
            expandRecordInfoFirst: false,
          },
        );
        subFound = panelTry.found;
      }
      await page.waitForTimeout(550);
      await waitForAccelaLoad(page).catch(() => {});

      if (!subFound) {
        tabsNamed[label] = {
          found: false,
          reason: "sub-tab link not found",
          tables: [],
          links: [],
          textPreview: "",
        };
        continue;
      }

      const extracted = await extractPlanReviewTablesLinksFromFrames(page, ctx);

      const downloadLinks = (extracted.links || []).filter((x) => {
        const h = (x.href || "").toLowerCase();
        return (
          /\.pdf(\?|$)/i.test(h) ||
          /download|fileupload|filedownload|blob:/i.test(h)
        );
      });

      tabsNamed[label] = {
        found: true,
        tables: extracted.tables,
        links: extracted.links,
        downloadCandidates: downloadLinks.slice(0, 40),
        textPreview: extracted.text.slice(0, 4000),
      };

      if (!iframeDownloadsDisabled) {
        await pickArlingtonIntegratedContentFrame(page).catch(() => null);
      }

      const tabCamel = tabLabelToKey[label] || `${label.replace(/\s+/g, "")}`;
      const logTop = tabLogTitles[tabCamel] || label;

      if (!iframeDownloadsDisabled && sharedGridCtx) {
        if (tabCamel === "plansAndDocuments") {
          let sawNestedRows = false;
          for (const [nestedLabel, sectionKey] of scopedNestedPlanSections) {
            await clickArlingtonIntegratedNestedTab(page, nestedLabel);
            await waitForAccelaLoad(page).catch(() => {});
            await page.waitForTimeout(600).catch(() => {});

            const sinkSection =
              integratedTabs.plansAndDocuments.sections[sectionKey].documents;

            await scrapeArlingtonPlanIntegratedGrid({
              page,
              logLabel: nestedLabel,
              sourceTabCamel: tabCamel,
              sourceSectionCamel: sectionKey,
              docsSink: sinkSection,
              attachmentDedupeKeys,
              prSeenRowKeys,
              downloadedHashes,
              downloadCtx: sharedGridCtx,
              iframeDownloadsDisabled: false,
            });
            sawNestedRows = sawNestedRows || sinkSection.length > 0;
          }
          const flatDocs = integratedTabs.plansAndDocuments.documents || [];
          if (!sawNestedRows) {
            await scrapeArlingtonPlanIntegratedGrid({
              page,
              logLabel: logTop,
              sourceTabCamel: tabCamel,
              sourceSectionCamel: "_root",
              docsSink: flatDocs,
              attachmentDedupeKeys,
              prSeenRowKeys,
              downloadedHashes,
              downloadCtx: sharedGridCtx,
              iframeDownloadsDisabled: false,
            });
          }
        } else if (integratedTabs[tabCamel]?.documents) {
          await scrapeArlingtonPlanIntegratedGrid({
            page,
            logLabel: logTop,
            sourceTabCamel: tabCamel,
            sourceSectionCamel: "_root",
            docsSink: integratedTabs[tabCamel].documents,
            attachmentDedupeKeys,
            prSeenRowKeys,
            downloadedHashes,
            downloadCtx: sharedGridCtx,
            iframeDownloadsDisabled: false,
          });
        }
      } else if (iframeDownloadsDisabled) {
        console.log(
          `[Arlington][Plan Review] ${logTop}: integrated iframe downloads disabled — skipping row scan`,
        );
      }
    } catch (err) {
      console.log(
        `     [Arlington][Plan Review] sub-tab "${label}" error: ${err.message}`,
      );
      tabsNamed[label] = {
        found: false,
        reason: err.message || "error",
        tables: [],
        links: [],
        textPreview: "",
      };
    }
  }
  }
  }

  /** Explorer snapshot tabs — iframe legacy path or ERMS API synthetic explorer. */
  const tabsCamel = {};
  /** @type {string} */
  let combinedText = "";
  /** @type {unknown[]} */
  let flatDownloads = [];

  if (ermsComplete) {
    const planDocs =
      integratedTabs.plansAndDocuments.sections.planSetDocuments.documents ||
      [];
    const explain = [
      `Plan_Set=${planDocs.length}`,
      `iframe_dl=${planSetDomDownloads}`,
    ].join(" | ");
    const ermsExplainPrefix = usedInternalIframeFlow
      ? "[Arlington ERMS iframe iFrameOpenPlanReview]"
      : "[Arlington ERMS ViewDocuments]";

    const secondaryIntegrated =
      prCfg.planReviewIncludeSecondaryTabs === true;

    for (const label of subTabLabels) {
      const camel = tabLabelToKey[label] || `${label.replace(/\s+/g, "")}`;
      if (camel === "plansAndDocuments") {
        tabsCamel[camel] = {
          label,
          found: true,
          tables: [],
          links: [],
          downloadCandidates: [],
          textPreview:
            `${ermsExplainPrefix} Plans & Documents — ${explain}`,
        };
      } else if (secondaryIntegrated) {
        let textPreview =
          `${ermsExplainPrefix} ${label}`;
        /** @type {boolean} */
        let foundFlag = true;
        if (camel === "reviewResultsAndMarkups") {
          const d =
            integratedTabs.reviewResultsAndMarkups?.documents || [];
          const c =
            integratedTabs.reviewResultsAndMarkups?.comments || [];
          textPreview += ` — ERMS/API+integrated docs=${d.length} comments=${c.length}`;
        } else if (camel === "approvedDocuments") {
          const d = integratedTabs.approvedDocuments?.documents || [];
          textPreview += ` — ERMS/API+integrated docs=${d.length}`;
        } else if (camel === "projectInformation") {
          const fld = integratedTabs.projectInformation?.fields || [];
          const d = integratedTabs.projectInformation?.documents || [];
          textPreview += ` — ERMS/API+integrated fields=${fld.length} docs=${d.length}`;
        } else {
          textPreview += " — integrated secondary tab placeholder";
          foundFlag = false;
        }
        tabsCamel[camel] = {
          label,
          found: foundFlag,
          tables: [],
          links: [],
          downloadCandidates: [],
          textPreview,
        };
      } else {
        tabsCamel[camel] = {
          label,
          found: false,
          reason: "Deferred in ERMS-focused phase.",
          tables: [],
          links: [],
          downloadCandidates: [],
          textPreview: "",
        };
      }
    }
    combinedText = Object.entries(tabsCamel)
      .map(
        ([k, v]) => `## ${v.label || k}\n${v.textPreview || v.reason || ""}`,
      )
      .join("\n\n")
      .trim();
    flatDownloads = [];
    console.log(
      `     [Arlington][Plan Review] ERMS explorer snapshot tabs=${Object.keys(tabsCamel).length}`,
    );
  } else {
    for (const [label, payload] of Object.entries(tabsNamed)) {
      const camel = tabLabelToKey[label];
      if (camel) tabsCamel[camel] = { ...payload, label };
      else tabsCamel[label.replace(/\s+/g, "")] = { ...payload, label };
    }
    combinedText = Object.entries(tabsNamed)
      .map(
        ([label, v]) =>
          `## ${label}\n${v.textPreview || (v.found === false ? v.reason || "" : "")}`,
      )
      .join("\n\n")
      .trim();
    flatDownloads = Object.values(tabsNamed).flatMap(
      (v) => v.downloadCandidates || [],
    );
    console.log(
      `     [Arlington][Plan Review] sub-tabs collected: ${Object.keys(tabsNamed).length}, textLen=${combinedText.length}`,
    );
  }

  if (timedOut && prCfg.scopePlanSetDocumentsOnly === false) {
    console.log(
      "[Arlington][Plan Review] Budget timeout — finalize will rely on mapped Record Info attachments for tab documents.",
    );
  } else if (timedOut) {
    console.log(
      "[Arlington][Plan Review] Budget timeout — Plan Set extraction may be partial (scoped: no Record Info fallback).",
    );
  }

  arlingtonFinalizePlanSetDocumentsSink(
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents,
  );
  arlingtonStripRejectedPlanReviewPlaceholderDocNames(
    integratedTabs?.reviewResultsAndMarkups?.documents,
  );
  arlingtonStripRejectedPlanReviewPlaceholderDocNames(
    integratedTabs?.approvedDocuments?.documents,
  );
  arlingtonStripRejectedPlanReviewPlaceholderDocNames(
    integratedTabs?.projectInformation?.documents,
  );

  /** Count successful uploads in integrated payloads (public URLs), after cleanup. */
  let integratedUploadedTally = 0;
  (function tallyPublic(norm) {
    const walkDocs = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const d of arr) {
        if (d && d.publicUrl && String(d.publicUrl).startsWith("http"))
          integratedUploadedTally++;
      }
    };
    walkDocs(norm?.plansAndDocuments?.documents);
    if (norm?.plansAndDocuments?.sections) {
      for (const s of Object.values(norm.plansAndDocuments.sections)) {
        walkDocs(s?.documents);
      }
    }
    walkDocs(norm?.reviewResultsAndMarkups?.documents);
    walkDocs(norm?.approvedDocuments?.documents);
    walkDocs(norm?.projectInformation?.documents);
  })(integratedTabs);

  try {
    const n =
      integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents
        ?.length ?? 0;
    console.log(`[Arlington][PlanReview] final Plan Set Documents=${n}`);
  } catch (_) {
    /**/
  }

  if (selectiveScrapeScope === "projectInformation") {
    integratedTabs = arlingtonApplyProjectInformationOnlyIntegratedTabsMerge(
      downloadCtx?.priorPortalData,
      integratedTabs,
      permitProjectId,
    );
  }

  planReviewState.tabs = integratedTabs;

  const approvedDocCount = Array.isArray(
    integratedTabs?.approvedDocuments?.documents,
  )
    ? integratedTabs.approvedDocuments.documents.length
    : 0;
  const reviewDocCount = Array.isArray(
    integratedTabs?.reviewResultsAndMarkups?.documents,
  )
    ? integratedTabs.reviewResultsAndMarkups.documents.length
    : 0;

  const nfNonApi = (arr) =>
    Array.isArray(arr)
      ? arr.filter((d) => d && `${d.source || ""}` !== "api_fallback")
          .length
      : 0;

  if (selectiveScrapeScope === "approvedDocuments") {
    planReviewState.planSetValid = false;
    const adDomOk =
      !planReviewState.secondaryDomExtractionFailed &&
      nfNonApi(integratedTabs.approvedDocuments?.documents) > 0;
    planReviewState.secondaryTabsValid = adDomOk;
    planReviewState.secondaryDomValid = adDomOk;
  } else if (selectiveScrapeScope === "reviewResults") {
    planReviewState.planSetValid = false;
    planReviewState.secondaryTabsValid =
      planReviewState.reviewResultsPanelResolved === true;
    planReviewState.secondaryDomValid = planReviewState.reviewResultsPanelResolved === true;
  } else if (selectiveScrapeScope === "projectInformation") {
    planReviewState.planSetValid = false;
    const projectInfoFields =
      integratedTabs?.projectInformation?.fields || [];
    const projectInfoDocCount =
      integratedTabs?.projectInformation?.documents?.length || 0;
    const projectInfoWeak = arlingtonProjectInformationExtractionIsWeak(
      projectInfoFields,
      permitProjectId,
    );
    const priorPiFieldCount = arlingtonPriorProjectInformationFields(
      downloadCtx?.priorPortalData,
    ).length;
    planReviewState.secondaryTabsValid =
      !projectInfoWeak ||
      priorPiFieldCount > 0 ||
      projectInfoDocCount > 0;
    planReviewState.secondaryDomValid = planReviewState.secondaryTabsValid;
  } else {
    planReviewState.planSetValid =
      arlingtonIntegratedTabsPlanSetValid(integratedTabs);
    planReviewState.secondaryTabsValid =
      nfNonApi(integratedTabs.reviewResultsAndMarkups?.documents) > 0 ||
      nfNonApi(integratedTabs.approvedDocuments?.documents) > 0;
    planReviewState.secondaryDomValid = planReviewState.secondaryTabsValid;
  }

  const statusScope =
    selectiveScrapeScope || scrapeDownloadScope || downloadCtx?.planReviewScope;
  const incompletesLeft =
    prCfg.planReviewIncludeSecondaryTabs === true ||
    selectiveScrapeScope === "planSet"
      ? arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(
          integratedTabs,
          statusScope || undefined,
        )
      : 0;
  const abortedDl =
    !!(sharedGridCtx &&
      /** @type {Record<string, unknown>} */ (
        sharedGridCtx
      ).planReviewDownloadsAbortedDeadline === true);
  const downloadedThisRun =
    Number(
      sharedGridCtx &&
        /** @type {Record<string, unknown>} */ (sharedGridCtx)
          .planReviewDownloadsSucceededThisRun,
    ) || 0;
  const attemptedThisRun =
    Number(
      sharedGridCtx &&
        /** @type {Record<string, unknown>} */ (sharedGridCtx)
          .planReviewDownloadsAttemptedThisRun,
    ) || 0;
  /** @type {string|undefined} */
  let scrapeStatusOut;
  if (abortedDl || incompletesLeft > 0) {
    planReviewState.partialPendingDownloads = true;
    if (selectiveScrapeScope && downloadedThisRun === 0 && attemptedThisRun === 0) {
      scrapeStatusOut = "partial_pending_downloads";
      console.log(
        `[Arlington][PlanReview] selective scope=${selectiveScrapeScope} finished with pending=${incompletesLeft} downloadsAttempted=0`,
      );
    } else {
      scrapeStatusOut = "partial_pending_downloads";
    }
  }
  if (
    sharedGridCtx &&
    /** @type {Record<string, unknown>} */ (sharedGridCtx)
      .planReviewPartialPendingDownloads === true
  ) {
    planReviewState.partialPendingDownloads = true;
  }

  if (
    selectiveScrapeScope &&
    (selectiveScrapeScope === "approvedDocuments" ||
      selectiveScrapeScope === "reviewResults") &&
    sharedGridCtx
  ) {
    const scopedAd =
      selectiveScrapeScope === "approvedDocuments"
        ? integratedTabs?.approvedDocuments?.documents
        : integratedTabs?.reviewResultsAndMarkups?.documents;
    const rowCount = Array.isArray(scopedAd) ? scopedAd.length : 0;
    const needsDl = Array.isArray(scopedAd)
      ? scopedAd.filter((d) => arlingtonPlanReviewDocNeedsDownloadAttempt(d)).length
      : 0;
    if (rowCount > 0 && needsDl > 0 && downloadedThisRun === 0 && attemptedThisRun === 0) {
      planReviewState.partialPendingDownloads = true;
      scrapeStatusOut = "partial_pending_downloads";
      console.log(
        `[Arlington][PlanReview] selective scope=${selectiveScrapeScope} rows=${rowCount} needDownload=${needsDl} but no download attempts this run`,
      );
    }
  }

  if (
    (prCfg.planReviewIncludeSecondaryTabs === true ||
      selectiveScrapeScope === "planSet") &&
    incompletesLeft === 0 &&
    !abortedDl &&
    ermsComplete &&
    sharedGridCtx
  ) {
    const scopeNote = statusScope ? ` scope=${statusScope}` : "";
    console.log(
      `[Arlington][PlanReview] all plan review downloads complete${scopeNote}`,
    );
  }

  const preservePreviousPlanReview =
    !selectiveScrapeScope &&
    existingValidPlanReview &&
    arlingtonWeakNewPlanReview(integratedTabs);

  if (selectiveScrapeScope === "approvedDocuments") {
    planReviewState.shouldPersist =
      planReviewState.iframeReady === true && approvedDocCount > 0;
  } else if (selectiveScrapeScope === "reviewResults") {
    planReviewState.shouldPersist =
      planReviewState.iframeReady === true &&
      planReviewState.reviewResultsPanelResolved === true;
    if (
      planReviewState.shouldPersist &&
      reviewDocCount === 0 &&
      planReviewState.reviewResultsPanelResolved === true
    ) {
      console.log(
        "[Arlington][PlanReview] Review Results & Mark-ups panel resolved but no document rows found; saving empty result state",
      );
    }
  } else if (selectiveScrapeScope === "projectInformation") {
    const projectInfoFields =
      integratedTabs?.projectInformation?.fields || [];
    const projectInfoDocCount =
      integratedTabs?.projectInformation?.documents?.length || 0;
    const projectInfoWeak = arlingtonProjectInformationExtractionIsWeak(
      projectInfoFields,
      permitProjectId,
    );
    planReviewState.shouldPersist =
      planReviewState.iframeReady === true &&
      planReviewState.projectInformationPanelResolved === true &&
      (!projectInfoWeak || projectInfoDocCount > 0);
    console.log(
      `[Arlington][PlanReview] projectInformation persist check fields=${projectInfoFields.length} documents=${projectInfoDocCount} weak=${projectInfoWeak} panelResolved=${planReviewState.projectInformationPanelResolved} shouldPersist=${planReviewState.shouldPersist}`,
    );
  } else {
    planReviewState.shouldPersist =
      (planReviewState.iframeReady && planReviewState.planSetValid) ||
      (!existingValidPlanReview && planReviewState.usedApiFallback === true);
  }

  if (
    selectiveScrapeScope === "projectInformation" &&
    !planReviewState.shouldPersist
  ) {
    scrapeStatusOut = scrapeStatusOut || "partial_success_plan_review_failed";
  }

  let persistReason = "ok";
  if (preservePreviousPlanReview)
    persistReason = "preserve_existing_valid_plan_set_over_weak_new";
  else if (
    selectiveScrapeScope === "reviewResults" &&
    !planReviewState.shouldPersist
  )
    persistReason = "review_results_panel_not_resolved_or_iframe_not_ready";
  else if (
    selectiveScrapeScope === "projectInformation" &&
    !planReviewState.shouldPersist
  )
    persistReason = "project_information_empty_or_iframe_not_ready";
  else if (!planReviewState.shouldPersist)
    persistReason = "incomplete_or_no_persist_rule_match";

  console.log(
    `[Arlington][PlanReview] persist decision iframeReady=${planReviewState.iframeReady} planSetValid=${planReviewState.planSetValid} secondaryDomValid=${planReviewState.secondaryDomValid} reviewResultsPanelResolved=${planReviewState.reviewResultsPanelResolved} usedApiFallback=${planReviewState.usedApiFallback} suppressedSecondaryApiMetadata=${planReviewState.suppressedSecondaryApiMetadata} existingValid=${existingValidPlanReview} shouldPersist=${planReviewState.shouldPersist} reason=${persistReason}`,
  );

  if (preservePreviousPlanReview) {
    console.log(
      "[Arlington][PlanReview] weak/failed extraction detected; preserving existing valid planReview",
    );
  }

  return {
    comments: [],
    text: combinedText,
    screenshot: screenshotBase64,
    planReviewSummary: null,
    downloadLinks: flatDownloads,
    arlingtonPlanReview: {
      used: true,
      message: null,
      ...(timedOut ? { timeout: true } : {}),
      tabs: tabsCamel,
      legacyExplorerTabs: tabsCamel,
      integratedTabs,
      ...(ermsComplete && usedInternalIframeFlow
        ? { integratedTabsFromInternalIframe: true }
        : {}),
      ...(ermsComplete && usedExternalDomFlow
        ? { integratedTabsFromExternalDom: true }
        : {}),
      ...(ermsComplete && usedApiHydrate
        ? { integratedTabsFromExternalApi: true }
        : {}),
      integratedDocCount: integratedUploadedTally,
      planReviewState,
      preservePreviousPlanReview,
      existingValidPlanReviewSnapshot: existingValidPlanReview,
      ...(selectiveScrapeScope
        ? {
            _arlingtonSelectiveScope: selectiveScrapeScope,
            _arlingtonSelectiveUpdate: true,
          }
        : {}),
      ...(selectiveScrapeScope === "reviewResults"
        ? {
            _arlingtonReviewResultsPanelResolved:
              planReviewState.reviewResultsPanelResolved === true,
          }
        : {}),
      ...(selectiveScrapeScope === "projectInformation"
        ? {
            _arlingtonProjectInformationPanelResolved:
              planReviewState.projectInformationPanelResolved === true &&
              !arlingtonProjectInformationExtractionIsWeak(
                integratedTabs?.projectInformation?.fields || [],
                permitProjectId,
              ),
          }
        : {}),
      ...(planReviewState.partialPendingDownloads === true
        ? { partialPendingDownloads: true }
        : {}),
      ...(scrapeStatusOut ? { scrapeStatus: scrapeStatusOut } : {}),
      ...(sharedGridCtx && sharedGridCtx.planReviewRunStats
        ? { runStats: sharedGridCtx.planReviewRunStats }
        : {}),
    },
  };
}
async function extractPlanReview(page) {
  console.log("  📋 Extracting plan review...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    // [Baltimore] Plan Review scraping disabled —
    // Plan Review tab not present on Baltimore ACA records
    // const prNavOk = await navigateToPlanReview(page, ctx);
    // if (prNavOk) {
    //   const planReview = await extractPlanReviewSummaryBaltimore(ctx);
    //   console.log("[Baltimore] Plan Review result:", planReview);
    // }
    return {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
    };
  }

  if (
    isArlingtonPortal(page) ||
    isArlingtonCapDetailPage(page)
  ) {
    console.log(
      "     [panel] Arlington Plan Review is deferred until after Attachments",
    );
    return {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
    };
  }

  const { found } = await clickAccelaNavPanel(
    ctx,
    page,
    [
      '[id*="TabDataList"] a:has-text("Plan Review")',
      'a:has-text("Plan Review")',
      'a[id*="PlanReview"]',
    ],
    "Plan Review",
    { checkpointLabel: "after_plan_review" },
  );

  if (!found) {
    console.log("     [panel] Plan Review: link not found");
    return {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
    };
  }

  await page.waitForTimeout(1500);

  const data = await ctx.evaluate(() => {
    const comments = [];
    const candidateTables = Array.from(document.querySelectorAll("table")).filter((table) => {
      const text = (table.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      return (
        text.includes("reviewer") ||
        text.includes("department") ||
        text.includes("comment") ||
        text.includes("review status")
      );
    });
    const root = candidateTables[0] || null;
    if (!root) return { comments: [], text: "" };
    root.querySelectorAll("tr").forEach((row) => {
      const cells = Array.from(row.querySelectorAll("td"))
        .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (cells.length >= 3) {
        comments.push({
          reviewer: cells[0] || "",
          department: cells[1] || "",
          comment: cells[2] || "",
          date: cells[3] || "",
        });
      }
    });
    const text = comments.length
      ? comments
          .map((c) =>
            [
              c.reviewer ? `Reviewer: ${c.reviewer}` : "",
              c.department ? `Department: ${c.department}` : "",
              c.comment ? `Comment: ${c.comment}` : "",
              c.date ? `Date: ${c.date}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n")
      : "";
    return { comments, text };
  });

  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;
  console.log(`     [panel] Plan Review: ${data.comments.length} review comments extracted`);
  if (data.comments.length === 0) console.log("     [panel] Plan Review: panel empty (no data)");
  return {
    comments: data.comments,
    text: data.text,
    screenshot: screenshotBase64,
    planReviewSummary: null,
    downloadLinks: [],
  };
}

async function extractRelatedRecords(page) {
  console.log("  📋 Extracting related records...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToRecordInfoSection(
        page,
        frames,
        ctx,
    "Related Records",
      );
      if (!navOk) {
        console.log(
          `  [Baltimore] Skipped Related Records — navigation failed`,
        );
        return { records: [], screenshot: null };
      }
      await saveCheckpointScreenshot(page, "after_related_records").catch(
        () => {},
      );
    } catch (e) {
      console.log(`  [Baltimore] Skipped Related Records — navigation failed`);
      console.log(`  [Baltimore] ${e.message}`);
      return { records: [], screenshot: null };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Related Records")',
        'a:has-text("Related Records")',
        'a[id*="RelatedRecord"]',
        'a:has-text("Related Record")',
        'a[id*="Related"]',
      ],
      "Related Records",
      { expandRecordInfoFirst: true, checkpointLabel: "after_related_records" },
  );

  if (!found) {
      console.log("     [panel] Related Records: link not found");
    return { records: [], screenshot: null };
    }
  }

  if (isBaltimorePortal(page)) {
    const contentFrame = ctx;
    const relatedRecords = await extractBaltimoreRelatedRecords(page, contentFrame);
    console.log('[Baltimore] Related Records result:', relatedRecords);
    const raw = relatedRecords.relatedRecords || [];
    const records = raw.map((row) => ({
      record_number: row.record_number ?? row.col_0 ?? "",
      record_type: row.record_type ?? row.col_1 ?? "",
      project_name: row.project_name ?? row.col_2 ?? "",
      date: row.date ?? row.col_3 ?? "",
      status: row.status ?? "",
    }));
    const relScreenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    console.log(`     [panel] Related Records: ${records.length} records extracted`);
    if (records.length === 0) console.log("     [panel] Related Records: panel empty (no data)");
    return {
      records,
      screenshot: relScreenshot ? relScreenshot.toString("base64") : null,
    };
  }

  const viewTree = await ctx.$(
    'a:has-text("View Entire Tree"), a:has-text("Entire Tree")',
  );
  if (viewTree && (await viewTree.isVisible().catch(() => false))) {
    await viewTree.click().catch(() => {});
    await waitForAccelaLoad(page);
  }

  const records = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

    const results = [];
    container
      .querySelectorAll('[id*="RelatedRecord"] tr, [id*="Related"] table tr')
      .forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const recordNum = cells[0].textContent.trim();
          if (recordNum && !recordNum.toLowerCase().includes("record number")) {
            results.push({
              record_number: recordNum,
              record_type: cells.length > 1 ? cells[1].textContent.trim() : "",
              status: cells.length > 2 ? cells[2].textContent.trim() : "",
              project_name: cells.length > 3 ? cells[3].textContent.trim() : "",
              date: cells.length > 4 ? cells[4].textContent.trim() : "",
            });
          }
        }
      });
    return results;
  });

  const relScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(`     [panel] Related Records: ${records.length} records extracted`);
  if (records.length === 0) console.log("     [panel] Related Records: panel empty (no data)");
  return {
    records,
    screenshot: relScreenshot ? relScreenshot.toString("base64") : null,
  };
}

/**
 * Runs in browser: scrape attachment table rows from Accela content (main frame or iframe).
 * @param {boolean} [baltimoreIframeTable] - when true, prefer main `table` in iframe; rows are direct `tr` children
 */
function accelaExtractAttachmentRowsInPage(baltimoreIframeTable) {
  const _cSelsTail = [
    "#ctl00_PlaceHolderMain_uploadedFiles",
    '[id*="uploadedFiles"]',
    '[id*="AttachmentList"]',
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
  ];
  const _cSels = baltimoreIframeTable
    ? [
        "table",
        ".document_status_list",
        '[class*="document_status"]',
        ..._cSelsTail,
      ]
    : [
        ".document_status_list",
        '[class*="document_status"]',
        ..._cSelsTail,
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }
  if (!container || !container.querySelectorAll) container = document.body;

    const results = [];
  const rowSel = baltimoreIframeTable
    ? "tr"
    : '[id*="Attachment"] tr, [id*="Document"] tr';
  const rowNodes =
    container && container.querySelectorAll
      ? container.querySelectorAll(rowSel)
      : [];
  rowNodes.forEach((row) => {
        const cells = row.querySelectorAll("td");
    if (cells.length < 2) return;

          const name = cells[0].textContent.trim();

    // Skip pagination and action rows
    if (
      !name ||
      name.includes("< Prev") ||
      name.includes("Next >") ||
      /^\d+$/.test(name) ||
      name === "View Details" ||
      name === "Action" ||
      name === "Name" ||
      name.toLowerCase().includes("file name") ||
      name.toLowerCase().includes("document name")
    ) {
      return;
    }

    // Only keep rows that look like actual filenames or have a size value
    const hasSize = cells.length > 5 && cells[5].textContent.trim().length > 0;
    const looksLikeFile = name.includes(".") || hasSize;
    if (!looksLikeFile) return;

    if (name.length >= 200) return;

            const actionLinks = row.querySelectorAll("a");
            let hasDownload = false;
            /** @type {{ eventTarget?: string; eventArgument?: string; href?: string } | null} */
            let downloadAction = null;
            for (const a of actionLinks) {
              const t = a.textContent.trim().toLowerCase();
      if (t.includes("download") || t.includes("view")) hasDownload = true;
              const href = (a.getAttribute("href") || "").trim();
              const onclick = (a.getAttribute("onclick") || "").trim();
              const src = href.includes("__doPostBack")
                ? href
                : onclick.includes("__doPostBack")
                  ? onclick
                  : href;
              const m = /__doPostBack\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/.exec(
                src,
              );
              if (m && (t === name.toLowerCase() || a.id.includes("lnkFileName"))) {
                downloadAction = {
                  eventTarget: m[1],
                  eventArgument: m[2] || "",
                  href: href || undefined,
                };
              }
            }
            results.push({
              name,
              record_id: cells.length > 1 ? cells[1].textContent.trim() : "",
              record_type: cells.length > 2 ? cells[2].textContent.trim() : "",
              entity_type: cells.length > 3 ? cells[3].textContent.trim() : "",
              type: cells.length > 4 ? cells[4].textContent.trim() : "",
              size: cells.length > 5 ? cells[5].textContent.trim() : "",
      latest_update: cells.length > 6 ? cells[6].textContent.trim() : "",
              rowIndex: Array.from(row.parentElement.children).indexOf(row),
              hasDownload,
              downloadAction,
              source: "attachments",
            });
  });
  return results;
}

/** Normalize permit / record numbers for safe comparison (spacing, case). */
function normalizePermitNumberKey(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * True when normalized key ends with a short numeric Accela revision/amendment segment
 * (e.g. ...-01, ...-02). Requires at least four hyphen segments so we do not strip
 * main record tails like ...-00386.
 */
function accelaNormalizedHasTrailingRevisionSuffix(normalizedKey) {
  const parts = normalizedKey.split("-");
  if (parts.length < 4) return false;
  return /^\d{1,3}$/.test(parts[parts.length - 1]);
}

/**
 * Strip one or more trailing revision segments (-01, -02, ...) from a normalized key.
 * Only strips when the last segment is 1–3 digits and there are at least 4 segments.
 */
function accelaPermitBaseKeyFromNormalized(normalizedKey) {
  if (!normalizedKey) return "";
  let parts = normalizedKey.split("-");
  while (parts.length >= 4) {
    const last = parts[parts.length - 1];
    if (/^\d{1,3}$/.test(last)) parts = parts.slice(0, -1);
    else break;
  }
  return parts.join("-");
}

/**
 * Baltimore / Fairfax: allow list + verify match when the user asked for a base permit
 * (no trailing -01 style suffix) and the portal shows a revision-linked record.
 * If the user includes an explicit revision suffix, only an exact normalized match passes.
 */
function accelaPermitsEquivalentForTenant(requestedRaw, visibleRaw, tenantFamilyAware) {
  const reqK = normalizePermitNumberKey(requestedRaw);
  const visK = normalizePermitNumberKey(visibleRaw);
  if (!reqK || !visK) return { ok: false, kind: null };
  if (reqK === visK) return { ok: true, kind: "exact" };
  if (!tenantFamilyAware) return { ok: false, kind: null };

  if (accelaNormalizedHasTrailingRevisionSuffix(reqK)) {
    return { ok: false, kind: null };
  }

  const baseV = accelaPermitBaseKeyFromNormalized(visK);
  if (baseV === reqK) return { ok: true, kind: "base" };

  if (visK.startsWith(reqK + "-")) {
    const suf = visK.slice(reqK.length + 1);
    if (/^\d{1,3}$/.test(suf)) return { ok: true, kind: "base" };
  }
  return { ok: false, kind: null };
}

/** Lower score = better list match. -1 = no match. */
function scoreAccelaListLinkText(rawLinkText, permitNumber, familyAware) {
  const t = normalizePermitNumberKey(
    String(rawLinkText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const p = normalizePermitNumberKey(permitNumber);
  if (!p) return -1;
  if (t === p) return 0;
  if (familyAware) {
    const equiv = accelaPermitsEquivalentForTenant(permitNumber, rawLinkText, true);
    if (equiv.ok && equiv.kind === "base") return 1;
    if (accelaNormalizedHasTrailingRevisionSuffix(p)) {
      return -1;
    }
    if (t.includes(p)) return 2;
    return -1;
  }
  if (t.includes(p)) return 2;
  return -1;
}

/**
 * TEMP (Baltimore): Only `tabs.info` (Record Details) + `tabs.attachments` in portalData;
 * other tab keys are omitted and their extractors are skipped. Set `false` to restore full portal payload.
 */
const BALTIMORE_MINIMAL_PORTAL_TABS = true;
const FAIRFAX_MINIMAL_PORTAL_TABS = true;

/**
 * Parse __doPostBack('target','arg') for the "Next >" pager link in the attachment iframe.
 */
async function baltimoreParseAttachmentNextPostBack(frame) {
  return frame
    .evaluate(() => {
      const anchors = [...document.querySelectorAll("a")];
      const nextA = anchors.find((a) => {
        const t = (a.textContent || "").replace(/\s+/g, " ").trim();
        return t === "Next >" || /^Next\s*>$/i.test(t);
      });
      if (!nextA) return null;
      const href = (nextA.getAttribute("href") || "").trim();
      const onclick = (nextA.getAttribute("onclick") || "").trim();
      const src = href.includes("__doPostBack")
        ? href
        : onclick.includes("__doPostBack")
          ? onclick
          : href;
      const m = /__doPostBack\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/.exec(
        src,
      );
      if (!m) return null;
      return { target: m[1], argument: m[2] || "" };
    })
    .catch(() => null);
}

/** Parse __doPostBack for "< Prev" pager link in the attachment iframe. */
async function baltimoreParseAttachmentPrevPostBack(frame) {
  return frame
    .evaluate(() => {
      const anchors = [...document.querySelectorAll("a")];
      const prevA = anchors.find((a) => {
        const t = (a.textContent || "").replace(/\s+/g, " ").trim();
        return (
          t === "< Prev" ||
          /^<\s*Prev$/i.test(t) ||
          t === "Previous" ||
          /^Previous$/i.test(t)
        );
      });
      if (!prevA) return null;
      const href = (prevA.getAttribute("href") || "").trim();
      const onclick = (prevA.getAttribute("onclick") || "").trim();
      const src = href.includes("__doPostBack")
        ? href
        : onclick.includes("__doPostBack")
          ? onclick
          : href;
      const m = /__doPostBack\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/.exec(
        src,
      );
      if (!m) return null;
      return { target: m[1], argument: m[2] || "" };
    })
    .catch(() => null);
}

async function arlingtonAttachmentIframePageSignature(frame) {
  const sigObj = await baltimoreReadAttachmentPageSignature(frame).catch(() => null);
  if (!sigObj) return "";
  return `${sigObj.rowKeys || ""}##${sigObj.viewStateTail || ""}`;
}

async function arlingtonReadAttachmentVisibleFilenames(frame) {
  const batch = await frame
    .evaluate(accelaExtractAttachmentRowsInPage, true)
    .catch(() => []);
  return (Array.isArray(batch) ? batch : [])
    .map((r) => (r && r.name ? String(r.name).trim() : ""))
    .filter(Boolean);
}

function arlingtonAttachmentFilenameMatchesVisible(targetName, visibleName) {
  const norm = (s) =>
    String(s || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const want = norm(targetName);
  const vis = norm(visibleName);
  if (!want || !vis) return false;
  return vis === want;
}

/**
 * Reset attachment iframe pager to page 1 (metadata scan ends on last page).
 * @param {string} [firstPageSignature] optional signature captured during metadata scan
 */
async function arlingtonResetAttachmentIframeToFirstPage(
  page,
  frame,
  firstPageSignature,
) {
  const logP = "[Arlington][Attachments]";
  for (let step = 0; step < 50; step++) {
    const currentSig = await arlingtonAttachmentIframePageSignature(frame);
    if (firstPageSignature && currentSig === firstPageSignature) {
      return true;
    }
    const prevPb = await baltimoreParseAttachmentPrevPostBack(frame);
    if (!prevPb) {
      if (step === 0 || (firstPageSignature && currentSig === firstPageSignature)) {
        return true;
      }
      if (!firstPageSignature) {
        return true;
      }
      console.log(
        `${logP} reset to page 1 stopped (no Prev) step=${step} signature=${currentSig.slice(0, 80)}`,
      );
      return step > 0;
    }
    const postRes = await baltimoreSubmitAttachmentIframeFormPost(
      frame,
      prevPb.target,
      prevPb.argument,
    );
    if (!postRes.ok) {
      console.log(
        `${logP} reset Prev POST failed step=${step} err=${postRes.error || postRes.status}`,
      );
      return false;
    }
    await page.waitForTimeout(450).catch(() => {});
    await waitForBaltimoreAttachmentContentReady(
      frame,
      `reset_prev_${step}`,
      12000,
    ).catch(() => {});
  }
  console.warn(`${logP} reset to page 1 exceeded max Prev steps`);
  return false;
}

/**
 * Navigate attachment iframe to 1-based pageNumber (always resets to page 1 first).
 */
async function arlingtonNavigateAttachmentIframeToPageNumber(
  page,
  frame,
  targetPageNumber,
  firstPageSignature,
) {
  const logP = "[Arlington][Attachments]";
  const target = Math.max(1, Number(targetPageNumber) || 1);
  console.log(`${logP} navigating to attachment page=${target}`);

  const resetOk = await arlingtonResetAttachmentIframeToFirstPage(
    page,
    frame,
    firstPageSignature,
  );
  if (!resetOk) {
    return false;
  }

  for (let step = 1; step < target; step++) {
    const nextPb = await baltimoreParseAttachmentNextPostBack(frame);
    if (!nextPb) {
      console.log(
        `${logP} navigate page=${target} stopped at step=${step} (no Next)`,
      );
      return false;
    }
    const postRes = await baltimoreSubmitAttachmentIframeFormPost(
      frame,
      nextPb.target,
      nextPb.argument,
    );
    if (!postRes.ok) {
      console.log(
        `${logP} navigate page=${target} Next POST failed step=${step}`,
      );
      return false;
    }
    await page.waitForTimeout(450).catch(() => {});
    await waitForBaltimoreAttachmentContentReady(
      frame,
      `nav_next_${step}`,
      12000,
    ).catch(() => {});
  }
  return true;
}

/**
 * Replay ASP.NET WebForms postback: serialize the iframe form, set __EVENT*, POST with cookies,
 * replace document (same-origin fetch). Primary Baltimore attachment pager — not UI click.
 */
async function baltimoreSubmitAttachmentIframeFormPost(
  frame,
  eventTarget,
  eventArgument,
) {
  return frame.evaluate(
    async ({ eventTarget: et, eventArgument: ea }) => {
      const form =
        document.getElementById("aspnetForm") ||
        document.querySelector("form#aspnetForm") ||
        document.forms[0];
      if (!form) return { ok: false, error: "no_form" };
      const rawAction = form.getAttribute("action") || window.location.pathname;
      const absAction = new URL(rawAction, window.location.href).href;
      const params = new URLSearchParams();
      for (const el of form.querySelectorAll("input, select, textarea")) {
        if (!el.name) continue;
        const tag = el.tagName.toLowerCase();
        if (tag === "input") {
          const type = (el.type || "text").toLowerCase();
          if (type === "submit" || type === "button") continue;
          if (type === "checkbox" || type === "radio") {
            if (el.checked) params.append(el.name, el.value);
          } else {
            params.append(el.name, el.value);
          }
        } else if (tag === "select") {
          for (const o of el.selectedOptions) {
            params.append(el.name, o.value);
          }
        } else {
          params.append(el.name, el.value);
        }
      }
      params.set("__EVENTTARGET", et);
      params.set("__EVENTARGUMENT", ea || "");
      try {
        const r = await fetch(absAction, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: window.location.href,
          },
          body: params.toString(),
        });
        const html = await r.text();
        if (!r.ok) {
          return {
            ok: false,
            status: r.status,
            error: "http_" + r.status,
          };
        }
        document.open();
        document.write(html);
        document.close();
        return { ok: true, status: r.status };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
    { eventTarget, eventArgument: eventArgument || "" },
  );
}

async function baltimoreReadAttachmentPageSignature(frame) {
  return frame
    .evaluate(() => {
      const vsEl = document.querySelector('input[name="__VIEWSTATE"]');
      const vs = vsEl ? vsEl.value || "" : "";
      const names = [...document.querySelectorAll("table tr td:first-child")]
        .map((c) => (c.textContent || "").trim())
        .filter(
          (t) =>
            t &&
            !t.includes("Next") &&
            !t.includes("Prev") &&
            !/^Name$/i.test(t),
        );
      return { viewStateTail: vs.slice(-64), rowKeys: names.sort().join("|") };
    })
    .catch(() => ({ viewStateTail: "", rowKeys: "" }));
}


async function downloadBaltimoreAttachmentForRow(page, att, frame, deps) {
  const {
    DOWNLOADS_DIR,
    supabaseProjectId,
    uploadFn,
    baltimoreRowFilenameLinkLocator,
    baltimoreDlState,
  } = deps;

  const attachTag = attachmentIframeDownloadLogTag(page);

  let link = baltimoreRowFilenameLinkLocator(frame, att.name);
  let found = (await link.count()) > 0;

  if (!found && isArlingtonPortal(page)) {
    try {
      const escapeRegex = (s) =>
        String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const shortName = String(att.name || "").trim().slice(0, 120);
      const alt = frame
        .locator("a[id*='lnkFileName'], a[href*='__doPostBack'][id*='FileName']")
        .filter({
          hasText: new RegExp(
            `^\\s*${escapeRegex(shortName)}\\s*$`,
            "i",
          ),
        });
      if ((await alt.count()) > 0) {
        link = alt.first();
        found = true;
        console.log(
          `       ${attachTag} filename link resolved via lnkFileName for "${shortName.slice(0, 64)}"`,
        );
      }
    } catch (e) {
      console.log(
        `       ${attachTag} Arlington lnkFileName fallback error: ${e.message}`,
      );
    }
  }

  const iframeLinks = await frame
    .evaluate(() =>
      [...document.querySelectorAll("a")]
        .map((a) => a.innerText.trim())
        .filter(
          (t) =>
            t.length > 5 &&
            ![
              "Record ID",
              "Record Type",
              "Entity Type",
              "Latest Update",
              "Entity",
              "Next >",
              "< Prev",
              "Resubmit",
              "Actions",
              "View Details",
              "Name",
              "Size",
              "Type",
            ].includes(t),
        ),
    )
    .catch(() => []);
  const visibleFilenamesForLog = Array.isArray(iframeLinks)
    ? [...iframeLinks]
    : [];
  if (!found) {
    att.downloadStatus = "failed";
    att.downloadError = "link_not_found";
  console.log(
      `${attachTag} FAIL ${att.name} link_not_found filesOnPage=${JSON.stringify(visibleFilenamesForLog.slice(0, 12))}`,
    );
    return;
  }

  try {
    let baltimoreCapturePath = null;
    let baltimoreUploadKey = null;
    const context = page.context();
    const frameUrlsBefore = page.frames().map((f) => f.url());

    const capturedResponses = [];
    const onResponse = (resp) => {
      try {
        const headers = resp.headers();
        const ct = (headers["content-type"] || "").toLowerCase();
        const cd = (headers["content-disposition"] || "").toLowerCase();
        if (
          ct.includes("application/pdf") ||
          cd.includes("attachment") ||
          resp.url().toLowerCase().includes(".pdf")
        ) {
          capturedResponses.push(resp);
        }
      } catch (_) {}
    };
    baltimoreDlState.onResponse = onResponse;
    page.on("response", onResponse);

    let resolvedDownload = null;
    let popupPageAfterClick = null;
    let contextSpawnedAfterClick = null;

    if (!baltimoreDlState.clickCompareDone) {
      try {
        const popupPromiseM1 = page
          .waitForEvent("popup", { timeout: 12000 })
          .catch(() => null);
        const contextPagePromiseM1 = context
          .waitForEvent("page", { timeout: 12000 })
          .catch(() => null);
        const downloadPromiseM1 = page
          .waitForEvent("download", { timeout: 12000 })
          .catch(() => null);

        await link.click({ force: true });
        await new Promise((r) => setTimeout(r, 2500));
        const d1 = await downloadPromiseM1;
        const popupM1 = await popupPromiseM1;
        const ctxPageM1 = await contextPagePromiseM1;
        popupPageAfterClick = popupM1;
        contextSpawnedAfterClick = ctxPageM1;

        let download = d1;
        if (!download) {
          const downloadPromise2 = page
            .waitForEvent("download", { timeout: 25000 })
            .catch(() => null);
          const popupPromise2 = page
            .waitForEvent("popup", { timeout: 10000 })
            .catch(() => null);
          const contextPagePromise2 = context
            .waitForEvent("page", { timeout: 10000 })
            .catch(() => null);
          await frame
            .evaluate((fname) => {
              const norm = (s) =>
                (s || "").replace(/\s+/g, " ").trim();
              const rows = [...document.querySelectorAll("tr")];
              let a = null;
              for (const tr of rows) {
                const inRow = [...tr.querySelectorAll("a")];
                const hit = inRow.find(
                  (el) =>
                    norm(el.innerText) === norm(fname) ||
                    norm(el.textContent).includes(fname),
                );
                if (hit) {
                  a = hit;
                  break;
                }
              }
              if (!a) {
                return { error: "anchor not found for Method2 (row-scoped)" };
              }
              const href = (a.getAttribute("href") || "").trim();
              const onclickAttr = a.getAttribute("onclick") || "";
              const db =
                typeof window.__doPostBack === "function"
                  ? window.__doPostBack
                  : null;
              let invoked = null;
              if (db && href.includes("__doPostBack")) {
                const m = href.match(
                  /__doPostBack\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/,
                );
                if (m) {
                  try {
                    db(m[1], m[2]);
                    invoked = {
                      type: "href__doPostBack",
                      target: m[1],
                      argument: m[2],
                    };
                  } catch (e) {
                    return {
                      error: "doPostBack threw: " + String(e.message),
                      href,
                    };
                  }
                }
              }
              if (!invoked && onclickAttr) {
                const code = onclickAttr.replace(
                  /^\s*javascript:\s*/i,
                  "",
                );
                try {
                  const fn = new Function(code);
                  fn.call(a);
                  invoked = { type: "onclick_newFunction" };
                } catch (e1) {
                  try {
                    (0, eval)(code);
                    invoked = { type: "onclick_eval" };
                  } catch (e2) {
                    return {
                      error:
                        "onclick failed: " +
                        String(e2.message),
                      onclickSnippet: onclickAttr.slice(0, 300),
                    };
                  }
                }
              }
              if (!invoked) {
                return {
                  error: "no invokable postback/onclick",
                  href,
                  onclickSnippet: onclickAttr.slice(0, 300),
                  doPostBackDefined:
                    typeof window.__doPostBack === "function",
                };
              }
              return {
                ok: true,
                invoked,
                href,
                onclickSnippet: onclickAttr.slice(0, 300),
                iframeUrlAfterInvoke: window.location.href,
                doPostBackDefined:
                  typeof window.__doPostBack === "function",
              };
            }, att.name)
            .catch((e) => ({ error: String(e.message) }));
          await new Promise((r) => setTimeout(r, 2500));
          download = await downloadPromise2;
          const popupM2 = await popupPromise2;
          const ctxPageM2 = await contextPagePromise2;
          if (popupM2) popupPageAfterClick = popupM2;
          if (ctxPageM2) contextSpawnedAfterClick = ctxPageM2;
        }

        resolvedDownload = download;
      } finally {
        baltimoreDlState.clickCompareDone = true;
      }
    } else {
      const popupPromise = page
        .waitForEvent("popup", { timeout: 12000 })
        .catch(() => null);
      const contextPagePromise = context
        .waitForEvent("page", { timeout: 12000 })
        .catch(() => null);
      const downloadPromise = page
        .waitForEvent("download", { timeout: 30000 })
        .catch(() => null);
      await link.click({ force: true });
      resolvedDownload = await downloadPromise;
      popupPageAfterClick = await popupPromise;
      contextSpawnedAfterClick = await contextPagePromise;
    }

    const saveAndUploadLocalFile = async (
      fileNameHint,
      bodyBuffer,
      sourceLabel,
    ) => {
      const rawBuf =
        bodyBuffer && Buffer.isBuffer(bodyBuffer)
          ? bodyBuffer
          : bodyBuffer
            ? Buffer.from(bodyBuffer)
            : null;
      if (rawBuf && isDownloadBufferLikelyHtmlError(rawBuf)) {
        att.downloadStatus = "failed";
        att.downloadError = "html_error_body";
        console.log(
          `       ⚠️ ${attachTag} REJECT (${sourceLabel}) — response body looks like HTML error page`,
        );
        return { safeName: null, storagePath: null, publicUrl: null };
      }
      const safeName = (
        fileNameHint ||
        att.name ||
        `baltimore_${Date.now()}.pdf`
      ).replace(/[\\/:*?"<>|]/g, "_");
      const localPath = path.join(DOWNLOADS_DIR, safeName);
      fs.writeFileSync(localPath, rawBuf);
      const storagePath = `drawings/${supabaseProjectId}/${safeName}`;
      const publicUrl = await uploadFn(localPath, storagePath);
      if (publicUrl) {
        att.viewUrl = publicUrl;
        att.storagePath = storagePath;
        att.downloadStatus = "uploaded";
        try {
          fs.unlinkSync(localPath);
        } catch (_) {}
        console.log(
          `       ✅ ${attachTag} capture via ${sourceLabel}: ${safeName}`,
        );
      } else {
        att.downloadStatus = "local";
        att.viewUrl = "";
        console.log(
          `       ⚠️ ${attachTag} capture local only via ${sourceLabel}: ${safeName}`,
        );
      }
      return { safeName, storagePath, publicUrl };
    };

    let captured = false;

    // A) Native Playwright download event
    const download = resolvedDownload;
    if (download) {
      const fileName = download.suggestedFilename() || att.name;
      const localPath = path.join(DOWNLOADS_DIR, fileName);
      await download.saveAs(localPath);
      let fileBuf;
      try {
        fileBuf = fs.readFileSync(localPath);
      } catch (e) {
        att.downloadStatus = "failed";
        att.downloadError = `read_saved_file: ${e.message}`;
        console.log(`       ⚠️ ${attachTag} REJECT ${fileName} — could not read saved file`);
      }
      if (fileBuf && isDownloadBufferLikelyHtmlError(fileBuf)) {
        att.downloadStatus = "failed";
        att.downloadError = "saved_file_html_error_page";
        try {
          fs.unlinkSync(localPath);
        } catch (_) {}
        console.log(
          `       ⚠️ ${attachTag} REJECT ${fileName} — saved file looks like HTML (portal error)`,
        );
      } else if (fileBuf) {
        const storagePath = `drawings/${supabaseProjectId}/${fileName}`;
        const publicUrl = await uploadFn(localPath, storagePath);
        baltimoreUploadKey = storagePath;
        baltimoreCapturePath = "A(download event)";
        if (publicUrl) {
          att.viewUrl = publicUrl;
          att.downloadStatus = "uploaded";
          try {
            fs.unlinkSync(localPath);
          } catch (_) {}
        } else {
          att.downloadStatus = "local";
          att.viewUrl = "";
        }
        captured = true;
      }
    }

    // B) popup/new page path
    let popupPage = popupPageAfterClick;
    const contextSpawnedPage = contextSpawnedAfterClick;
    if (!popupPage && contextSpawnedPage && contextSpawnedPage !== page) {
      popupPage = contextSpawnedPage;
    }
    if (!captured && popupPage) {
      await popupPage.waitForLoadState("domcontentloaded").catch(() => {});
      const popupUrl = popupPage.url();
      let popupDownloaded = false;
      const popupDl = await popupPage
        .waitForEvent("download", { timeout: 5000 })
        .catch(() => null);
      if (popupDl) {
        const popupName = popupDl.suggestedFilename() || att.name;
        const popupLocal = path.join(DOWNLOADS_DIR, popupName);
        await popupDl.saveAs(popupLocal);
        let popupBuf;
        try {
          popupBuf = fs.readFileSync(popupLocal);
        } catch (_) {
          popupBuf = null;
        }
        if (popupBuf && isDownloadBufferLikelyHtmlError(popupBuf)) {
          att.downloadStatus = "failed";
          att.downloadError = "popup_saved_file_html_error_page";
          try {
            fs.unlinkSync(popupLocal);
          } catch (_) {}
          console.log(
            `       ⚠️ ${attachTag} REJECT popup save ${popupName} — HTML error page`,
          );
        } else if (popupBuf) {
        const popupStorage = `drawings/${supabaseProjectId}/${popupName}`;
        const popupUrlUploaded = await uploadFn(popupLocal, popupStorage);
        baltimoreUploadKey = popupStorage;
        baltimoreCapturePath = "B(popup download event)";
        if (popupUrlUploaded) {
          att.viewUrl = popupUrlUploaded;
          att.downloadStatus = "uploaded";
          try {
            fs.unlinkSync(popupLocal);
          } catch (_) {}
        } else {
          att.downloadStatus = "local";
          att.viewUrl = "";
        }
        captured = true;
        popupDownloaded = true;
        }
      }
      if (!popupDownloaded && popupUrl && /pdf|fileupload|attachment/i.test(popupUrl)) {
        const popupResp = await context.request
          .get(popupUrl, { timeout: 20000 })
          .catch(() => null);
        if (popupResp && popupResp.ok()) {
          const headers = popupResp.headers();
          const ct = (headers["content-type"] || "").toLowerCase();
          const cd = (headers["content-disposition"] || "").toLowerCase();
          if (
            ct.includes("application/pdf") ||
            cd.includes("attachment") ||
            popupUrl.toLowerCase().includes(".pdf")
          ) {
            const buf = Buffer.from(await popupResp.body());
            const up = await saveAndUploadLocalFile(
              att.name,
              buf,
              "B(popup response)",
            );
            if (up.storagePath) {
              baltimoreUploadKey = up.storagePath;
              baltimoreCapturePath = "B(popup response)";
              captured = true;
            }
          }
        }
      }
    }

    // C) response interception on original page
    if (!captured) {
      for (const resp of capturedResponses) {
        const headers = resp.headers();
        const ct = (headers["content-type"] || "").toLowerCase();
        const cd = (headers["content-disposition"] || "").toLowerCase();
        const isPdfLike =
          ct.includes("application/pdf") ||
          cd.includes("attachment") ||
          resp.url().toLowerCase().includes(".pdf");
        if (!isPdfLike) continue;
        const body = await resp.body().catch(() => null);
        if (body && body.length > 0) {
          const up = await saveAndUploadLocalFile(
            att.name,
            body,
            "C(response interception)",
          );
          if (up.storagePath) {
          baltimoreUploadKey = up.storagePath;
          baltimoreCapturePath = "C(response interception)";
          captured = true;
          break;
          }
        }
      }
    }

    // D) frame navigation path
    if (!captured) {
      await page.waitForTimeout(1500);
      const frameUrlsAfter = page.frames().map((f) => f.url());
      const newOrChangedFrameUrl = frameUrlsAfter.find(
        (u) =>
          u &&
          !frameUrlsBefore.includes(u) &&
          /pdf|fileupload|attachment|download/i.test(u),
      );
      if (newOrChangedFrameUrl) {
        const frameResp = await context.request
          .get(newOrChangedFrameUrl, { timeout: 20000 })
          .catch(() => null);
        if (frameResp && frameResp.ok()) {
          const headers = frameResp.headers();
          const ct = (headers["content-type"] || "").toLowerCase();
          const cd = (headers["content-disposition"] || "").toLowerCase();
          if (
            ct.includes("application/pdf") ||
            cd.includes("attachment") ||
            newOrChangedFrameUrl.toLowerCase().includes(".pdf")
          ) {
            const buf = Buffer.from(await frameResp.body());
            const up = await saveAndUploadLocalFile(
              att.name,
              buf,
              "D(frame navigation)",
            );
            if (up.storagePath) {
              baltimoreUploadKey = up.storagePath;
              baltimoreCapturePath = "D(frame navigation)";
              captured = true;
            }
          }
        }
      }
    }

    page.off("response", onResponse);
    baltimoreDlState.onResponse = null;

    if (!captured) {
      att.downloadStatus = "failed";
      att.downloadError = "click_no_download";
      console.log(`${attachTag} FAIL ${att.name} click_no_download`);
    } else if (
      att.viewUrl &&
      ["uploaded", "success"].includes(att.downloadStatus)
    ) {
      console.log(
        `${attachTag} OK ${att.name} path=${baltimoreCapturePath || "?"}`,
      );
    } else if (captured) {
      console.log(`${attachTag} FAIL ${att.name} captured_but_no_public_url`);
    }
  } catch (dlErr) {
    if (baltimoreDlState.onResponse) {
      page.off("response", baltimoreDlState.onResponse);
    }
    att.downloadStatus = "failed";
    att.downloadError = dlErr.message;
    console.log(`${attachTag} FAIL ${att.name} ${dlErr.message}`);
  }
}

async function captureBaltimoreIframeDiag(frame) {
  if (!frame) {
    return {
      iframeUrl: "",
      readyState: "unknown",
      rowCount: 0,
      firstRowTexts: [],
      anchorCount: 0,
      firstAnchors: [],
      htmlLen: 0,
      hasPdfAnchor: false,
      hasPdfRow: false,
    };
  }
  return frame
    .evaluate(() => {
      const iframeUrl = window.location.href || "";
      const readyState = document.readyState || "";
      const body = document.body;
      const htmlLen = body ? body.innerHTML.length : 0;
      const rows = Array.from(document.querySelectorAll("tr"));
      const rowCount = rows.length;
      const firstRowTexts = rows
        .slice(0, 5)
        .map((r) => (r.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const anchors = Array.from(document.querySelectorAll("a"));
      const anchorCount = anchors.length;
      const firstAnchors = anchors.slice(0, 10).map((a) => ({
        text: (a.textContent || "").replace(/\s+/g, " ").trim(),
        href: a.getAttribute("href") || "",
      }));
      const hasPdfAnchor = anchors.some((a) =>
        (a.textContent || "").toUpperCase().includes(".PDF"),
      );
      const hasPdfRow = rows.some((r) =>
        (r.textContent || "").toUpperCase().includes(".PDF"),
      );
      return {
        iframeUrl,
        readyState,
        rowCount,
        firstRowTexts,
        anchorCount,
        firstAnchors,
        htmlLen,
        hasPdfAnchor,
        hasPdfRow,
      };
    })
    .catch(() => ({
      iframeUrl: "",
      readyState: "unknown",
      rowCount: 0,
      firstRowTexts: [],
      anchorCount: 0,
      firstAnchors: [],
      htmlLen: 0,
      hasPdfAnchor: false,
      hasPdfRow: false,
    }));
}

async function waitForBaltimoreAttachmentContentReady(
  frame,
  label,
  timeoutMs = 15000,
  pollMs = 400,
) {
  const start = Date.now();
  let lastSnap = null;
  let consecutiveEmptyHtml = 0;
  while (Date.now() - start < timeoutMs) {
    const snap = await captureBaltimoreIframeDiag(frame);
    lastSnap = snap;
    if (snap.htmlLen === 0) {
      consecutiveEmptyHtml++;
      if (consecutiveEmptyHtml >= 5) {
        consecutiveEmptyHtml = 0;
        await frame.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await new Promise((r) => setTimeout(r, pollMs));
      }
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }
    consecutiveEmptyHtml = 0;
    const isReady =
      snap.readyState === "complete" && snap.rowCount > 1 && snap.htmlLen > 0;
    if (isReady) {
      return { ready: true, snap };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ready: false, snap: lastSnap };
}

/** @param {Record<string, unknown> | null | undefined} dc */
function arlingtonAttachmentRemainingBudgetMs(dc) {
  if (!dc || typeof dc !== "object") return 0;
  const deadline = Number(dc.scrapeDeadlineMs) || 0;
  const minMs =
    Number(dc.attachmentsMinRemainingBudgetMs) > 0
      ? Number(dc.attachmentsMinRemainingBudgetMs)
      : ARLINGTON_ATTACHMENTS_MIN_REMAINING_BUDGET_MS;
  if (!(deadline > 0)) return minMs;
  return Math.max(0, deadline - Date.now());
}

/** @param {Record<string, unknown> | null | undefined} dc */
function arlingtonAttachmentCanStartDownload(dc) {
  return (
    arlingtonAttachmentRemainingBudgetMs(dc) >=
    (Number(dc?.attachmentsMinRemainingBudgetMs) > 0
      ? Number(dc.attachmentsMinRemainingBudgetMs)
      : ARLINGTON_ATTACHMENTS_MIN_REMAINING_BUDGET_MS)
  );
}

/** @param {Record<string, unknown> | null | undefined} dc @param {unknown[]} attachments */
async function arlingtonAttachmentStopDownloads(dc, reason, attachments, extra = {}) {
  if (!dc || typeof dc !== "object") return;
  if (`${dc.attachmentsStoppedReason || ""}`.trim()) return;
  dc.attachmentsStoppedReason = reason;
  dc.attachmentsDownloadsAbortedDeadline = true;
  dc.attachmentsPartialPendingDownloads = true;
  const totals = arlingtonCountAttachmentQueueTotals(attachments);
  const downloadedThisRun = Number(dc.attachmentsDownloadsSucceededThisRun) || 0;
  console.log(
    `[Arlington][Attachments] stopping reason=${reason} downloadedThisRun=${downloadedThisRun} pending=${totals.pending}`,
  );
  const saver = dc.saveAttachmentsCheckpoint;
  if (typeof saver === "function") {
    await saver(`stop_${reason}`, {
      pending: totals.pending,
      downloaded: downloadedThisRun,
      ...extra,
    }).catch(() => {});
    arlingtonAttachmentMarkCheckpointSaved(dc);
  }
}

/** @param {Record<string, unknown> | null | undefined} dc @param {unknown[]} attachments */
async function arlingtonAttachmentShouldStopBeforeDownload(dc, attachments) {
  if (!dc || typeof dc !== "object") return { stop: false, reason: "" };
  if (typeof dc.isCancelRequested === "function") {
    try {
      if (await dc.isCancelRequested()) {
        await arlingtonAttachmentStopDownloads(
          dc,
          "user_cancelled",
          attachments,
        );
        return { stop: true, reason: "user_cancelled", cancelled: true };
      }
    } catch (_) {
      /* ignore poll errors */
    }
  }
  if (dc.attachmentsDownloadsAbortedDeadline === true) {
    return {
      stop: true,
      reason: `${dc.attachmentsStoppedReason || "near_global_deadline"}`.trim(),
    };
  }
  const maxPerRun =
    Number(dc.attachmentsMaxDownloadsPerRun) > 0
      ? Number(dc.attachmentsMaxDownloadsPerRun)
      : dc.continueRun === true
        ? ARLINGTON_ATTACHMENTS_CONTINUE_MAX_DOWNLOADS_PER_RUN
        : ARLINGTON_ATTACHMENTS_MAX_DOWNLOADS_PER_RUN;
  const doneThisRun = Number(dc.attachmentsDownloadsSucceededThisRun) || 0;
  if (doneThisRun >= maxPerRun) {
    await arlingtonAttachmentStopDownloads(
      dc,
      "attachment_batch_limit_reached",
      attachments,
    );
    return { stop: true, reason: "attachment_batch_limit_reached" };
  }
  if (!arlingtonAttachmentCanStartDownload(dc)) {
    await arlingtonAttachmentStopDownloads(
      dc,
      "near_global_deadline",
      attachments,
    );
    return { stop: true, reason: "near_global_deadline" };
  }
  return { stop: false, reason: "" };
}

/** @deprecated use arlingtonNavigateAttachmentIframeToPageNumber */
async function arlingtonNavigateAttachmentIframeToPageIndex(
  page,
  frame,
  targetPageIndex,
  firstPageSignature,
) {
  return arlingtonNavigateAttachmentIframeToPageNumber(
    page,
    frame,
    Math.max(1, (Number(targetPageIndex) || 0) + 1),
    firstPageSignature,
  );
}

/**
 * Arlington Attachments: metadata scan → checkpoint → batched/resumable downloads.
 * @returns {Promise<{ attachments: unknown[]; screenshot: string|null; runStats?: Record<string, unknown>; partialPendingDownloads?: boolean; scrapeStatus?: string }>}
 */
async function runArlingtonAttachmentsResumableLifecycle(
  page,
  session,
  frame,
  downloadCtx,
) {
  const logP = "[Arlington][Attachments]";
  const DOWNLOADS_DIR = downloadCtx.DOWNLOADS_DIR;
  const priorRows = arlingtonPriorAttachmentRowsFromPortalData(
    downloadCtx.priorPortalData,
  );
  const priorTotals = arlingtonCountAttachmentQueueTotals(priorRows);
  if (priorTotals.alreadyDownloaded > 0 || priorTotals.pending > 0) {
    console.log(
      `${logP} resume alreadyDownloaded=${priorTotals.alreadyDownloaded} pending=${priorTotals.pending}`,
    );
  }

  downloadCtx.attachmentsMaxDownloadsPerRun =
    downloadCtx.continueRun === true
      ? ARLINGTON_ATTACHMENTS_CONTINUE_MAX_DOWNLOADS_PER_RUN
      : ARLINGTON_ATTACHMENTS_MAX_DOWNLOADS_PER_RUN;
  downloadCtx.attachmentsMinRemainingBudgetMs =
    ARLINGTON_ATTACHMENTS_MIN_REMAINING_BUDGET_MS;
  downloadCtx.attachmentsDownloadsSucceededThisRun = 0;
  downloadCtx.attachmentsDownloadsAttemptedThisRun = 0;
  downloadCtx.attachmentsDownloadsSinceCheckpoint = 0;
  downloadCtx.attachmentsDownloadsAbortedDeadline = false;
  downloadCtx.attachmentsPartialPendingDownloads = false;
  downloadCtx.attachmentsStoppedReason = "";

  console.log(
    `${logP} batch limits total=${downloadCtx.attachmentsMaxDownloadsPerRun}`,
  );

  /** @type {Record<string, unknown>[]} */
  const attachments = [];
  const seenNames = new Set();
  const seenPageSigs = new Set();
  const iframeDlTag = attachmentIframeDownloadLogTag(page);
  /** @type {string} */
  let firstPageSignature = "";

  if (
    downloadCtx.skipMetadataScan === true &&
    Array.isArray(downloadCtx.attachmentsFromPortal) &&
    downloadCtx.attachmentsFromPortal.length > 0
  ) {
    for (const row of downloadCtx.attachmentsFromPortal) {
      if (row && typeof row === "object") {
        attachments.push(
          structuredCloneWorksSafe(row) ??
            /** @type {Record<string, unknown>} */ ({ ...row }),
        );
      }
    }
  } else {
  for (let pageIdx = 0; pageIdx < 50; pageIdx++) {
    const pageReady = await waitForBaltimoreAttachmentContentReady(
      frame,
      `arlington_meta_p${pageIdx}`,
    );
    if (!pageReady.ready) {
      console.log(`${logP} metadata page ${pageIdx + 1} readiness timeout — stop scan`);
      break;
    }
    const sigObj = await baltimoreReadAttachmentPageSignature(frame);
    const pageSig = `${sigObj.rowKeys}##${sigObj.viewStateTail}`;
    if (seenPageSigs.has(pageSig)) break;
    seenPageSigs.add(pageSig);
    if (pageIdx === 0 && pageSig) {
      firstPageSignature = pageSig;
    }

    const batch = await frame.evaluate(accelaExtractAttachmentRowsInPage, true);
    for (const row of batch) {
      if (seenNames.has(row.name)) continue;
      seenNames.add(row.name);
      row.pageNumber = pageIdx + 1;
      row._baltimorePageIndex = pageIdx;
      row.source = "attachments";
      if (!row.downloadStatus) row.downloadStatus = "pending";
      attachments.push(row);
    }

    const nextPb = await baltimoreParseAttachmentNextPostBack(frame);
    if (!nextPb) break;
    const postRes = await baltimoreSubmitAttachmentIframeFormPost(
      frame,
      nextPb.target,
      nextPb.argument,
    );
    if (!postRes.ok) break;
  }
  }

  const merged =
    downloadCtx.skipMetadataScan === true
      ? attachments
      : arlingtonMergePriorAttachmentRows(attachments, priorRows);
  const metaTotals = arlingtonCountAttachmentQueueTotals(merged);
  let screenshotBase64 = await page.screenshot({ fullPage: true }).catch(() => null);
  screenshotBase64 = screenshotBase64
    ? screenshotBase64.toString("base64")
    : null;

  const runAttachmentsPersistCheckpoint = async (phase, extra = {}) => {
    if (
      !downloadCtx.supabase ||
      !downloadCtx.userId ||
      typeof downloadCtx.hashPortalData !== "function"
    ) {
      return;
    }
    const totals = arlingtonCountAttachmentQueueTotals(merged);
    const partial =
      totals.pending > 0 ||
      downloadCtx.attachmentsDownloadsAbortedDeadline === true ||
      downloadCtx.attachmentsPartialPendingDownloads === true;
    const slice = buildArlingtonAttachmentsCheckpointTabSlice({
      attachments: merged,
      screenshotBase64,
      partialPendingDownloads: partial,
      scrapeStatus: partial ? "partial_pending_downloads" : undefined,
      sectionState: downloadCtx.attachmentsRateLimited
        ? "rate_limited"
        : partial
          ? "partial"
          : downloadCtx.skipMetadataScan === true
            ? "downloading"
            : metaTotals.total > 0
              ? "downloading"
              : "complete",
      rateLimitRetryAfter: downloadCtx.attachmentsRateLimitRetryAfter,
      logSummary: false,
    });
    await persistArlingtonAttachmentsCheckpoint({
      supabase: downloadCtx.supabase,
      userId: downloadCtx.userId,
      supabaseProjectId: downloadCtx.supabaseProjectId,
      permitNumber: `${downloadCtx.permitNumber || ""}`.trim(),
      hashPortalData: downloadCtx.hashPortalData,
      attachmentsTabPayload: slice,
    });
    arlingtonAttachmentMarkCheckpointSaved(downloadCtx);
    if (phase === "metadata") {
      console.log(
        `${logP} metadata checkpoint saved found=${metaTotals.total} downloaded=${metaTotals.alreadyDownloaded} pending=${metaTotals.pending}`,
      );
    } else if (phase === "everyFive") {
      console.log(
        `${logP} checkpoint saved after 5 downloads downloaded=${extra.downloaded ?? "?"} pending=${extra.pending ?? totals.pending}`,
      );
    }
  };

  downloadCtx.saveAttachmentsCheckpoint = async (phaseTag, xs) => {
    const x =
      xs && typeof xs === "object" && !Array.isArray(xs)
        ? /** @type {Record<string, unknown>} */ (xs)
        : {};
    await runAttachmentsPersistCheckpoint(String(phaseTag || ""), x);
  };

  if (downloadCtx.skipMetadataScan !== true) {
    await runAttachmentsPersistCheckpoint("metadata", {});
  }

  console.log(
    `${logP} resetting attachment iframe to page 1 before download phase`,
  );
  await arlingtonResetAttachmentIframeToFirstPage(
    page,
    frame,
    firstPageSignature,
  ).catch(() => {});

  const baltimoreRowFilenameLinkLocator = (frame, filename) => {
    const row = frame.locator("tr", { hasText: filename }).first();
    return row.locator("a").filter({ hasText: filename }).first();
  };
  const downloadDeps = {
    DOWNLOADS_DIR,
    supabaseProjectId: downloadCtx.supabaseProjectId,
    uploadFn: downloadCtx.uploadFn,
    baltimoreRowFilenameLinkLocator,
    baltimoreDlState: { clickCompareDone: false, onResponse: null },
  };

  /** @type {Map<number, Record<string, unknown>[]>} */
  const pendingByPage = new Map();
  for (const att of merged) {
    if (!arlingtonAttachmentNeedsDownloadAttempt(att)) continue;
    const rawPage =
      Number(
        /** @type {Record<string, unknown>} */ (att).pageNumber ??
          (Number(/** @type {Record<string, unknown>} */ (att)._baltimorePageIndex) >=
          0
            ? Number(
                /** @type {Record<string, unknown>} */ (att)._baltimorePageIndex,
              ) + 1
            : 0) ??
          0,
      ) || 1;
    const pageNum = Math.max(1, rawPage);
    /** @type {Record<string, unknown>} */ (att).pageNumber = pageNum;
    if (!pendingByPage.has(pageNum)) pendingByPage.set(pageNum, []);
    pendingByPage.get(pageNum).push(/** @type {Record<string, unknown>} */ (att));
  }

  const sortedPageNums = [...pendingByPage.keys()].sort((a, b) => a - b);
  const pendingDownloadCount = [...pendingByPage.values()].reduce(
    (sum, list) => sum + list.length,
    0,
  );
  console.log(
    `${logP} download batch grouped by pages pages=${sortedPageNums.length} pending=${pendingDownloadCount}`,
  );

  for (const pageNum of sortedPageNums) {
    const stopGate = await arlingtonAttachmentShouldStopBeforeDownload(
      downloadCtx,
      merged,
    );
    if (stopGate.stop) {
      console.log(
        `${logP} stopping reason=${stopGate.reason} downloadedThisRun=${downloadCtx.attachmentsDownloadsSucceededThisRun || 0} pending=${arlingtonCountAttachmentQueueTotals(merged).pending}`,
      );
      break;
    }

    const navOk = await arlingtonNavigateAttachmentIframeToPageNumber(
      page,
      frame,
      pageNum,
      firstPageSignature,
    );
    await waitForBaltimoreAttachmentContentReady(
      frame,
      `arlington_dl_p${pageNum}`,
    ).catch(() => {});

    const visibleFiles = await arlingtonReadAttachmentVisibleFilenames(frame);
    console.log(
      `${logP} page=${pageNum} filesVisible=${visibleFiles.length}`,
    );

    for (const att of pendingByPage.get(pageNum) || []) {
      const stopBefore = await arlingtonAttachmentShouldStopBeforeDownload(
        downloadCtx,
        merged,
      );
      if (stopBefore.stop) break;

      const attName = `${att.name || ""}`.trim();
      const onPage = visibleFiles.some((vf) =>
        arlingtonAttachmentFilenameMatchesVisible(attName, vf),
      );

      if (!navOk || !onPage) {
        console.log(
          `${logP} page mismatch target=${attName.slice(0, 120)} currentPage=${pageNum} visibleFiles=${JSON.stringify(visibleFiles.slice(0, 12))}`,
        );
        att.downloadStatus = "pending_retry";
        att.downloadError = "page_not_resolved";
        continue;
      }

      downloadCtx.attachmentsDownloadsAttemptedThisRun =
        (Number(downloadCtx.attachmentsDownloadsAttemptedThisRun) || 0) + 1;
      if (session) {
        mirrorSessionProgress(session, `Attachments → downloading: ${attName}`);
      }
      console.log(
        `${logP} downloading file page=${pageNum} name=${attName.slice(0, 120)}`,
      );
      try {
        await downloadBaltimoreAttachmentForRow(
          page,
          att,
          frame,
          downloadDeps,
        );
      } catch (e) {
        att.downloadStatus = "pending_retry";
        att.downloadError = e.message || "download_error";
        console.log(`${iframeDlTag} FAIL ${attName} ${e.message}`);
      }

      if (
        att.downloadStatus === "failed" &&
        (att.downloadError === "link_not_found" ||
          att.downloadError === "click_no_download")
      ) {
        att.downloadStatus = "pending_retry";
      }

      if (arlingtonAttachmentLooksUploadComplete(att)) {
        downloadCtx.attachmentsDownloadsSucceededThisRun =
          (Number(downloadCtx.attachmentsDownloadsSucceededThisRun) || 0) + 1;
      }

      downloadCtx.attachmentsDownloadsSinceCheckpoint =
        (Number(downloadCtx.attachmentsDownloadsSinceCheckpoint) || 0) + 1;
      if (
        downloadCtx.attachmentsDownloadsSinceCheckpoint >=
        ARLINGTON_ATTACHMENTS_CHECKPOINT_EVERY_N
      ) {
        const totals = arlingtonCountAttachmentQueueTotals(merged);
        await runAttachmentsPersistCheckpoint("everyFive", {
          downloaded: downloadCtx.attachmentsDownloadsSucceededThisRun,
          pending: totals.pending,
        });
        downloadCtx.attachmentsDownloadsSinceCheckpoint = 0;
      }
    }
  }

  for (const att of merged) {
    delete att.rowIndex;
    delete att.hasDownload;
    delete att._baltimorePageIndex;
  }

  const finalTotals = arlingtonCountAttachmentQueueTotals(merged);
  const partialPending = finalTotals.pending > 0;
  if (partialPending) {
    downloadCtx.attachmentsPartialPendingDownloads = true;
  }

  const normalizedMerged = arlingtonNormalizeAttachmentsForPortal(merged, {
    logSummary: true,
  });
  merged.length = 0;
  merged.push(...normalizedMerged);

  await runAttachmentsPersistCheckpoint("final", {
    downloaded: downloadCtx.attachmentsDownloadsSucceededThisRun,
    pending: finalTotals.pending,
  });

  const ok = normalizedMerged.filter((a) =>
    arlingtonAttachmentLooksUploadComplete(a),
  ).length;
  const fail = normalizedMerged.filter(
    (a) =>
      /** @type {Record<string, unknown>} */ (a).downloadStatus === "failed",
  ).length;
  console.log(
    `${iframeDlTag} summary: found=${normalizedMerged.length} downloaded=${ok} failed=${fail} pending=${finalTotals.pending}`,
  );

  return {
    attachments: normalizedMerged,
    screenshot: screenshotBase64,
    partialPendingDownloads: partialPending,
    scrapeStatus: partialPending ? "partial_pending_downloads" : "complete",
    runStats: {
      found: merged.length,
      downloaded: ok,
      failed: fail,
      pending: finalTotals.pending,
      downloadedThisRun: Number(downloadCtx.attachmentsDownloadsSucceededThisRun) || 0,
      attemptedThisRun: Number(downloadCtx.attachmentsDownloadsAttemptedThisRun) || 0,
      checkpointSaved: downloadCtx.attachmentsCheckpointSaved === true,
      pendingByReason: arlingtonAttachmentPendingByReason(merged),
    },
  };
}

async function extractAttachments(
  page,
  session,
  supabaseProjectId,
  supabase,
  uploadFn,
  sanitizeFn,
  arlingtonDownloadCtx = null,
) {
  console.log("  📋 Extracting attachments...");
  const ctx = getExtractionContext(page);
  let baltimoreAttachmentFrame = null;

  if (isMinimalTabsPortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToRecordInfoSection(
        page,
        frames,
        ctx,
        "Attachments",
      );
      if (!navOk) {
        console.log(`  [Baltimore] Skipped Attachments — navigation failed`);
        return { attachments: [], screenshot: null };
      }
      await saveCheckpointScreenshot(page, "after_attachments").catch(() => {});

      if (isFairfaxPortal(page)) {
        // Fairfax requires clicking "View Record Attachments" on the main page
        // to populate the AttachmentsList iframe. Baltimore does not need this.
        try {
          const hit = await findLinkInAnyContext(
            page,
            frames,
            "View Record Attachments",
          );
          let viewControl = hit?.element || null;
          if (!viewControl) {
            const searchContexts = [page, ...frames];
            for (const ctx of searchContexts) {
              const buttons = await ctx.$$("button").catch(() => []);
              for (const b of buttons) {
                const t = ((await b.textContent()) || "")
                  .replace(/\s+/g, " ")
                  .trim();
                if (
                  t === "View Record Attachments" &&
                  (await b.isVisible().catch(() => false))
                ) {
                  viewControl = b;
                  break;
                }
              }
              if (viewControl) break;
            }
          }
          if (viewControl) {
            await viewControl.click();
            await waitForAccelaLoad(page);
            await page.waitForTimeout(1500);
          }
        } catch (err) {
          console.log(
            `  [scrape] Fairfax View Record Attachments click warning: ${err.message}`,
          );
        }
      }

      // Wait for attachment iframe to load real content (async after navigation)
      baltimoreAttachmentFrame = null;
      const maxWait = 15000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const loaded = page.frames().find(
          (fr) =>
            fr.url().includes("AttachmentsList") ||
            fr.url().includes("FileUpload/A"),
        );
        if (loaded) {
          baltimoreAttachmentFrame = loaded;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!baltimoreAttachmentFrame) {
        console.log(
          "  [Baltimore Attachments] iframe never loaded — no attachments",
        );
        return { attachments: [], screenshot: null };
      }
      console.log(
        `  [Baltimore Attachments] iframe loaded: ${baltimoreAttachmentFrame.url().substring(0, 80)}`,
      );

      // Wait for table rows to appear inside the attachment iframe
      try {
        await baltimoreAttachmentFrame.waitForSelector("table tr", {
          timeout: 10000,
        });
      } catch (e) {
        console.log(
          "  [Baltimore Attachments] table never appeared in iframe",
        );
        return { attachments: [], screenshot: null };
      }
    } catch (e) {
      console.log(`  [Baltimore] Skipped Attachments — navigation failed`);
      console.log(`  [Baltimore] ${e.message}`);
      return { attachments: [], screenshot: null };
    }
  } else if (isArlingtonPortal(page) || isArlingtonCapDetailPage(page)) {
    try {
      baltimoreAttachmentFrame = await ensureArlingtonAttachmentsLoaded(page);
      if (!baltimoreAttachmentFrame) {
        return { attachments: [], screenshot: null };
      }

      console.log(
        `  [Arlington][Attachments] using iframe frame: ${(
          baltimoreAttachmentFrame.url() || ""
        ).substring(0, 130)}`,
      );

      const gid = ArlingtonAccelaProfile.attachmentGridId;
      try {
        await baltimoreAttachmentFrame.waitForSelector(
          `#${gid}, table[id="${gid}"]`,
          { timeout: 15000 },
        );
      } catch (e) {
        console.log(
          `  [Arlington][Attachments] grid #${gid} optional wait: ${e.message}`,
        );
      }
      try {
        await baltimoreAttachmentFrame.waitForSelector("table tr", {
          timeout: 10000,
        });
      } catch (e) {
        console.log(
          `  [Arlington][Attachments] no rows in attachment iframe — ${e.message}`,
        );
        const brief =
          typeof baltimoreAttachmentFrame.evaluate === "function"
            ? await baltimoreAttachmentFrame
                .evaluate(() => ({
                  tables: document.querySelectorAll("table").length,
                  bodySnippet:
                    document.body &&
                    typeof document.body.innerText === "string"
                      ? document.body.innerText
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 520)
                      : "",
                }))
                .catch(() => null)
            : null;
        if (brief) {
          console.log(
            `  [Arlington][Attachments] iframe body/table probe: ${JSON.stringify(brief)}`,
          );
          const rateProbe = arlingtonOrchestration.detectCloudflareRateLimit(
            brief.bodySnippet,
          );
          if (rateProbe.rateLimited) {
            const retryAfter = arlingtonOrchestration.formatRetryAfterIso(
              arlingtonOrchestration.computeRateLimitRetryAfterMs(
                session?.arlingtonRateLimitAttempts || 0,
              ),
            );
            console.log(
              `[Arlington][Attachments] rate limited by Accela/Cloudflare error=${rateProbe.errorCode || "1015"} retryAfter=${retryAfter}`,
            );
            if (session && typeof session === "object") {
              session.arlingtonAttachmentsRateLimited = true;
              session.arlingtonAttachmentsRateLimitRetryAfter = retryAfter;
              session.arlingtonRateLimitAttempts =
                (Number(session.arlingtonRateLimitAttempts) || 0) + 1;
            }
            return {
              attachments: null,
              screenshot: null,
              rateLimited: true,
              attachmentsState: "rate_limited",
              rateLimitRetryAfter: retryAfter,
              preservePriorAttachments: true,
            };
          }
        }
        return { attachments: [], screenshot: null };
      }

      const rowProbe = await baltimoreAttachmentFrame
        .evaluate((gridId) => {
          const t =
            document.getElementById(gridId) ||
            document.querySelector(`table[id="${gridId}"]`);
          return {
            gridFound: !!t,
            trCount: t ? t.querySelectorAll("tr").length : 0,
            fileLinks: t
              ? t.querySelectorAll(
                  "a[href*='__doPostBack'][id*='lnkFileName'], a[onclick*='__doPostBack']",
                ).length
              : 0,
          };
        }, gid)
        .catch(() => null);
      if (rowProbe) {
        console.log(
          `  [Arlington][Attachments] grid probe: ${JSON.stringify(rowProbe)}`,
        );
      }
    } catch (e) {
      console.log(`  [Arlington][Attachments] setup failed: ${e.message}`);
      return { attachments: [], screenshot: null };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Attachments")',
        'a:has-text("Attachments")',
        'a:has-text("Attachment")',
        'a[id*="Attachment"]',
        'a:has-text("Documents")',
        'a[id*="Document"]',
        'a:has-text("Document")',
      ],
      "Attachments",
      { expandRecordInfoFirst: true, checkpointLabel: "after_attachments" },
    );

    if (!found) {
      console.log("     [panel] Attachments: link not found");
      return { attachments: [], screenshot: null };
    }
  }

  const DOWNLOADS_DIR = path.join(__dirname, "downloads");
  if (!fs.existsSync(DOWNLOADS_DIR))
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const downloadedHashes = new Map();

  const rowHost = baltimoreAttachmentFrame || page;

  /** Baltimore attachment download: row-scoped filename link (Playwright click only for file open, not paging). */
  const baltimoreRowFilenameLinkLocator = (frame, filename) => {
    const row = frame.locator("tr", { hasText: filename }).first();
    return row.locator("a").filter({ hasText: filename }).first();
  };

  const baltimoreDlState = {
    clickCompareDone: false,
    onResponse: null,
  };
  let attachments;
  /** @type {Record<string, unknown>|undefined} */
  let arlingtonAttachmentsRunStats;
  let arlingtonAttachmentsPartialPending;
  let arlingtonAttachmentsScrapeStatus;
  /** @type {string|null} */
  let arlingtonAttScreenshot = null;
  if (baltimoreAttachmentFrame) {
    if (
      (isArlingtonPortal(page) || isArlingtonCapDetailPage(page)) &&
      arlingtonDownloadCtx &&
      typeof arlingtonDownloadCtx === "object"
    ) {
      const arResult = await runArlingtonAttachmentsResumableLifecycle(
        page,
        session,
        baltimoreAttachmentFrame,
        arlingtonDownloadCtx,
      );
      attachments = arResult.attachments;
      arlingtonAttachmentsRunStats = arResult.runStats;
      arlingtonAttachmentsPartialPending = arResult.partialPendingDownloads;
      arlingtonAttachmentsScrapeStatus = arResult.scrapeStatus;
      arlingtonAttScreenshot = arResult.screenshot;
    } else {
    const iframeDlTag = attachmentIframeDownloadLogTag(page);
    if (isArlingtonPortal(page)) {
      console.log(
        "  [Arlington][Attachments] row scan, paging, and filename-link downloads use the shared iframe path (Baltimore-style)",
      );
    }
    attachments = [];
    const seenNames = new Set();
    const seenPageSigs = new Set();
    const fr = baltimoreAttachmentFrame;
    const downloadDeps = {
      DOWNLOADS_DIR,
      supabaseProjectId,
      uploadFn,
      baltimoreRowFilenameLinkLocator,
      baltimoreDlState,
    };
    for (let pageIdx = 0; pageIdx < 50; pageIdx++) {
      if (session?._cancelRequested) {
        console.log(`${iframeDlTag} cancelled — stopping attachment downloads`);
        break;
      }
      if (session?._scrapeJobId && supabase) {
        try {
          const { shouldAbort } = require("./lib/scrape-job-cancellation.js");
          if (await shouldAbort(session, supabase)) {
            session._cancelRequested = true;
            console.log(`${iframeDlTag} cancelled — stopping attachment downloads`);
            break;
          }
        } catch (_) {}
      }
      const pageReady = await waitForBaltimoreAttachmentContentReady(
        fr,
        `baltimore_p${pageIdx}`,
      );
      if (!pageReady.ready) {
        console.log(
          `${iframeDlTag} page ${pageIdx + 1} readiness timeout — stop`,
        );
        break;
      }
      const sigObj = await baltimoreReadAttachmentPageSignature(fr);
      const pageSig = `${sigObj.rowKeys}##${sigObj.viewStateTail}`;
      if (seenPageSigs.has(pageSig)) {
        console.log(
          `${iframeDlTag} duplicate WebForms page signature — stop (page ${pageIdx + 1})`,
        );
        break;
      }
      seenPageSigs.add(pageSig);

      const batch = await fr.evaluate(accelaExtractAttachmentRowsInPage, true);
      const namesOnPage = batch.map((r) => r.name);
      console.log(
        `${iframeDlTag} page ${pageIdx + 1} filenames: ${JSON.stringify(namesOnPage)}`,
      );

      for (const row of batch) {
        if (session?._cancelRequested) break;
        if (seenNames.has(row.name)) continue;
        seenNames.add(row.name);
        row._baltimorePageIndex = pageIdx;
        attachments.push(row);
        if (session) {
          mirrorSessionProgress(session, `Attachments → page ${pageIdx + 1}: ${row.name}`);
        }
        try {
          await downloadBaltimoreAttachmentForRow(page, row, fr, downloadDeps);
        } catch (e) {
          row.downloadStatus = "failed";
          row.downloadError = e.message;
          console.log(`${iframeDlTag} FAIL ${row.name} ${e.message}`);
        }
      }
      if (session?._cancelRequested) break;

      const nextPb = await baltimoreParseAttachmentNextPostBack(fr);
      if (!nextPb) {
        console.log(`${iframeDlTag} no further pages (no Next > postback)`);
        break;
      }
      console.log(
        `${iframeDlTag} form-post page ${pageIdx + 1}→${pageIdx + 2} __EVENTTARGET=${nextPb.target}`,
      );
      const postRes = await baltimoreSubmitAttachmentIframeFormPost(
        fr,
        nextPb.target,
        nextPb.argument,
      );
      if (!postRes.ok) {
        console.log(
          `${iframeDlTag} WebForms POST failed: ${postRes.error || postRes.status}`,
        );
        break;
      }
    }
    const ok = attachments.filter((a) =>
      ["uploaded", "success"].includes(a.downloadStatus),
    ).length;
    const fail = attachments.filter((a) => a.downloadStatus === "failed")
      .length;
    console.log(
      `${iframeDlTag} summary: found=${attachments.length} downloaded=${ok} failed=${fail}`,
    );
    }
  } else {
    attachments = await ctx.evaluate(accelaExtractAttachmentRowsInPage);
  }
  console.log(
    `     [panel] Attachments: ${attachments.length} items extracted`,
  );
  if (attachments.length === 0) {
    console.log("     [panel] Attachments: panel empty (no data)");
  }
  console.log(
    `     Found ${attachments.length} attachments, attempting downloads...`,
  );

  if (!baltimoreAttachmentFrame) {
  for (let ai = 0; ai < attachments.length; ai++) {
    const att = attachments[ai];
    if (session?._cancelRequested) {
      console.log("       🛑 Attachments download cancelled — leaving remaining pending");
      break;
    }
    if (session?._scrapeJobId && supabase) {
      try {
        const { shouldAbort } = require("./lib/scrape-job-cancellation.js");
        if (await shouldAbort(session, supabase)) {
          session._cancelRequested = true;
          console.log("       🛑 Attachments download cancelled — leaving remaining pending");
          break;
        }
      } catch (_) {}
    }
    if (session)
      mirrorSessionProgress(session, `Attachments → downloading ${ai + 1}/${attachments.length}: ${att.name}`);
    console.log(
      `       📥 [${ai + 1}/${attachments.length}] Downloading: ${att.name}`,
    );

    try {
        const rows = await rowHost.$$(
          '[id*="Attachment"] tr, [id*="Document"] tr',
        );
      let targetRow = null;
      const dataRows = [];
      for (const row of rows) {
        const firstCell = await row.$("td");
        if (firstCell) dataRows.push(row);
      }
      if (att.rowIndex !== undefined && att.rowIndex < dataRows.length) {
        targetRow = dataRows[att.rowIndex];
      } else {
        for (const row of dataRows) {
          const firstCell = await row.$("td");
          if (!firstCell) continue;
          const text = (await firstCell.textContent().catch(() => "")).trim();
          if (text === att.name) {
            targetRow = row;
            break;
          }
        }
      }

      if (!targetRow) {
        console.log(
          `       ⚠️ Could not re-locate row for "${att.name}" (index ${att.rowIndex}), skipping download`,
        );
        att.downloadStatus = "failed";
        att.downloadError = "row_not_found";
        continue;
      }

      const actionsLink = await targetRow.$(
        'a:has-text("Actions"), a:has-text("View"), a[id*="Action"]',
      );
      if (!actionsLink) {
        const downloadLink = await targetRow.$(
          'a[href*="Download"], a[href*="download"], a[onclick*="download"]',
        );
        if (downloadLink) {
          try {
            const [download] = await Promise.all([
              page.waitForEvent("download", { timeout: 30000 }),
              downloadLink.click(),
            ]);
            const safeDlName = (
              download.suggestedFilename() || att.name
            ).replace(/[^a-zA-Z0-9._-]/g, "_");
            const filePath = path.join(DOWNLOADS_DIR, safeDlName);
            await download.saveAs(filePath);

            const viewUrl = await tryUploadAccelaFile(
              filePath,
              safeDlName,
              supabaseProjectId,
              uploadFn,
              sanitizeFn,
              downloadedHashes,
            );
            att.viewUrl = viewUrl;
            if (viewUrl && supabaseProjectId) {
              att.storagePath = `drawings/${supabaseProjectId}/${safeDlName}`;
            }
            att.downloadStatus = viewUrl ? "success" : "uploaded_no_url";
            console.log(
              `       ✅ Downloaded: ${att.name} → ${viewUrl || "(local)"}`,
            );
          } catch (dlErr) {
            console.log(
              `       ⚠️ Download failed for ${att.name}: ${dlErr.message}`,
            );
            att.downloadStatus = "failed";
            att.downloadError = dlErr.message;
          }
          continue;
        }

        console.log(
          `       ⚠️ No Actions/Download link found for "${att.name}"`,
        );
        att.downloadStatus = "failed";
        att.downloadError = "no_download_link";
        continue;
      }

      await actionsLink.click().catch(() => {});
      await page.waitForTimeout(1000);

      const viewDetailsLink = await page.$(
        'a:has-text("View Details"), a:has-text("Detail"), [id*="ViewDetail"]',
      );
      if (
        viewDetailsLink &&
        (await viewDetailsLink.isVisible().catch(() => false))
      ) {
        await viewDetailsLink.click().catch(() => {});
        await waitForAccelaLoad(page);
      }

      const downloadBtn = await page.$(
        'a:has-text("Download"), input[value*="Download"], button:has-text("Download"), a[href*="Download"]',
      );

      if (downloadBtn && (await downloadBtn.isVisible().catch(() => false))) {
        try {
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 30000 }),
            downloadBtn.click(),
          ]);
          const suggestedName = download.suggestedFilename() || att.name;
          const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_");
          const filePath = path.join(DOWNLOADS_DIR, safeName);
          await download.saveAs(filePath);

          const viewUrl = await tryUploadAccelaFile(
            filePath,
            safeName,
            supabaseProjectId,
            uploadFn,
            sanitizeFn,
            downloadedHashes,
          );
          att.viewUrl = viewUrl;
          if (viewUrl && supabaseProjectId) {
            att.storagePath = `drawings/${supabaseProjectId}/${safeName}`;
          }
          att.downloadStatus = viewUrl ? "success" : "uploaded_no_url";
          console.log(
            `       ✅ Downloaded: ${safeName} → ${viewUrl || "(local)"}`,
          );
        } catch (dlErr) {
          console.log(
            `       ⚠️ Download failed for ${att.name}: ${dlErr.message}`,
          );
          att.downloadStatus = "failed";
          att.downloadError = dlErr.message;
        }
      } else {
        console.log(`       ⚠️ No Download button found for "${att.name}"`);
        att.downloadStatus = "failed";
        att.downloadError = "no_download_button";
      }

      const backLink = await page.$(
        'a:has-text("Back"), a:has-text("Return"), a:has-text("Attachments")',
      );
      if (backLink && (await backLink.isVisible().catch(() => false))) {
        await backLink.click().catch(() => {});
        await waitForAccelaLoad(page);
      } else {
        await page.goBack().catch(() => {});
        await waitForAccelaLoad(page);
      }
    } catch (err) {
      console.log(
        `       ❌ Attachment error for "${att.name}": ${err.message}`,
      );
      att.downloadStatus = "failed";
      att.downloadError = err.message;
      }
    }
  }

  if (!arlingtonAttachmentsRunStats) {
    for (const att of attachments) {
      delete att.rowIndex;
      delete att.hasDownload;
      delete att._baltimorePageIndex;
    }
  }

  const attScreenshot =
    arlingtonAttScreenshot != null
      ? arlingtonAttScreenshot
      : await page.screenshot({ fullPage: true }).catch(() => null);
  const downloadedCount = attachments.filter((a) =>
    ["success", "uploaded"].includes(a.downloadStatus),
  ).length;
  const failedCount = attachments.filter(
    (a) => a.downloadStatus === "failed",
  ).length;
  console.log(
    `     Attachments: ${attachments.length} found, ${downloadedCount} downloaded, ${failedCount} failed`,
  );
  const successfulFilenames = attachments
    .filter((a) => ["success", "uploaded"].includes(a.downloadStatus))
    .map((a) => a.name);
  console.log(
    `     [Attachment][SUMMARY] ${JSON.stringify({
      attachmentsFound: attachments.length,
      downloadedCount,
      failedCount,
      successfulFilenames,
      downloadedCountIncludesStatuses: ["success", "uploaded"],
    })}`,
  );
  return {
    attachments,
    screenshot:
      typeof attScreenshot === "string"
        ? attScreenshot
        : attScreenshot
          ? attScreenshot.toString("base64")
          : null,
    arlingtonAttachmentsRunStats,
    partialPendingDownloads: arlingtonAttachmentsPartialPending,
    scrapeStatus: arlingtonAttachmentsScrapeStatus,
  };
}

async function tryUploadAccelaFile(
  filePath,
  fileName,
  projectId,
  uploadFn,
  sanitizeFn,
  downloadedHashes,
) {
  if (!fs.existsSync(filePath)) return "";
  const fileBuffer = fs.readFileSync(filePath);

  if (fileBuffer.length < 1024) {
    console.log(
      `       ⚠️ File too small (${fileBuffer.length} bytes), skipping upload`,
    );
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    return "";
  }

  const contentHash = crypto.createHash("md5").update(fileBuffer).digest("hex");
  const prev = downloadedHashes.get(contentHash);
  if (prev) {
    console.log(
      `       ⚠️ DUPLICATE: "${fileName}" same as "${prev.fileName}", aliasing URL`,
    );
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    return prev.viewUrl || "";
  }

  if (!projectId || !uploadFn) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    downloadedHashes.set(contentHash, { fileName, viewUrl: "" });
    return "";
  }

  const storagePath = `drawings/${projectId}/${fileName}`;
  const publicUrl = await uploadFn(filePath, storagePath);
  try {
    fs.unlinkSync(filePath);
  } catch (_) {}
  downloadedHashes.set(contentHash, { fileName, viewUrl: publicUrl || "" });
  return publicUrl || "";
}

async function extractInspections(page) {
  console.log("  📋 Extracting inspections...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToRecordInfoSection(
        page,
        frames,
        ctx,
        "Inspections",
      );
      if (!navOk) {
        console.log(`  [Baltimore] Skipped Inspections — navigation failed`);
        return {
          inspections: [],
          upcoming: [],
          completed: [],
          screenshot: null,
        };
      }
      await saveCheckpointScreenshot(page, "after_inspections").catch(() => {});
    } catch (e) {
      console.log(`  [Baltimore] Skipped Inspections — navigation failed`);
      console.log(`  [Baltimore] ${e.message}`);
      return {
        inspections: [],
        upcoming: [],
        completed: [],
        screenshot: null,
      };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Inspections")',
      'a:has-text("Inspections")',
      'a:has-text("Inspection")',
      'a[id*="Inspection"]',
    ],
    "Inspections",
      { expandRecordInfoFirst: true, checkpointLabel: "after_inspections" },
  );

  if (!found) {
      console.log("     [panel] Inspections: link not found");
    return { inspections: [], upcoming: [], completed: [], screenshot: null };
    }
  }

  const inspData = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let mainContainer = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        mainContainer = e;
        break;
      }
    }

    const upcoming = [];
    const completed = [];
    const all = [];

    function parseInspectionTable(container, category) {
      const rows = container.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const type = cells[0].textContent.trim();
          if (
            type &&
            type.length < 200 &&
            !type.toLowerCase().includes("inspection type") &&
            !type.toLowerCase().includes("type")
          ) {
            const entry = {
              type,
              status: cells.length > 1 ? cells[1].textContent.trim() : "",
              date: cells.length > 2 ? cells[2].textContent.trim() : "",
              inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
              result: cells.length > 4 ? cells[4].textContent.trim() : "",
              category,
            };
            all.push(entry);
            if (category === "upcoming") upcoming.push(entry);
            else completed.push(entry);
          }
        }
      });
    }

    const upcomingSection = mainContainer.querySelector(
      '[id*="Upcoming"], [id*="upcoming"], [id*="Scheduled"], [id*="scheduled"]',
    );
    const completedSection = mainContainer.querySelector(
      '[id*="Completed"], [id*="completed"], [id*="History"], [id*="history"]',
    );

    if (upcomingSection) {
      const table =
        upcomingSection.closest("table") ||
        upcomingSection.querySelector("table") ||
        upcomingSection;
      parseInspectionTable(table, "upcoming");
    }
    if (completedSection) {
      const table =
        completedSection.closest("table") ||
        completedSection.querySelector("table") ||
        completedSection;
      parseInspectionTable(table, "completed");
    }

    if (all.length === 0) {
      mainContainer
        .querySelectorAll('[id*="Inspection"] tr, [id*="inspection"] tr')
        .forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length >= 2) {
            const type = cells[0].textContent.trim();
            if (
              type &&
              type.length < 200 &&
              !type.toLowerCase().includes("inspection type")
            ) {
              const statusText =
                cells.length > 1
                  ? cells[1].textContent.trim().toLowerCase()
                  : "";
              const category =
                statusText.includes("pass") ||
                statusText.includes("fail") ||
                statusText.includes("approved") ||
                statusText.includes("completed")
                  ? "completed"
                  : "upcoming";
              const entry = {
                type,
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
                date: cells.length > 2 ? cells[2].textContent.trim() : "",
                inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
                result: cells.length > 4 ? cells[4].textContent.trim() : "",
                category,
              };
              all.push(entry);
              if (category === "upcoming") upcoming.push(entry);
              else completed.push(entry);
            }
          }
        });
    }

    if (all.length === 0) {
      const tables = mainContainer.querySelectorAll("table");
      for (const table of tables) {
        const headerRow = table.querySelector("tr");
        if (!headerRow) continue;
        const headerText = (headerRow.innerText || "").toLowerCase();
        const looksLikeInspection =
          headerText.includes("inspection") ||
          (headerText.includes("type") && (headerText.includes("status") || headerText.includes("date")));
        if (!looksLikeInspection) continue;
        const dataRows = table.querySelectorAll("tr:not(:first-child)");
        dataRows.forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length >= 2) {
            const type = cells[0].textContent.trim();
            if (
              type &&
              type.length < 200 &&
              !type.toLowerCase().includes("inspection type") &&
              !type.toLowerCase().includes("type\n")
            ) {
              const statusText =
                cells.length > 1 ? cells[1].textContent.trim().toLowerCase() : "";
              const category =
                statusText.includes("pass") ||
                statusText.includes("fail") ||
                statusText.includes("approved") ||
                statusText.includes("completed")
                  ? "completed"
                  : "upcoming";
              const entry = {
                type,
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
                date: cells.length > 2 ? cells[2].textContent.trim() : "",
                inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
                result: cells.length > 4 ? cells[4].textContent.trim() : "",
                category,
              };
              all.push(entry);
              if (category === "upcoming") upcoming.push(entry);
              else completed.push(entry);
            }
          }
        });
        if (all.length > 0) break;
      }
    }

    return { all, upcoming, completed };
  });

  const inspScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(
    `     [panel] Inspections: ${inspData.all.length} extracted (${inspData.upcoming.length} upcoming, ${inspData.completed.length} completed)`,
  );
  if (inspData.all.length === 0) console.log("     [panel] Inspections: panel empty (no data)");
  return {
    inspections: inspData.all,
    upcoming: inspData.upcoming,
    completed: inspData.completed,
    screenshot: inspScreenshot ? inspScreenshot.toString("base64") : null,
  };
}

async function extractPayments(page) {
  console.log("  📋 Extracting payments...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToPaymentsSection(page, frames, ctx);
      if (!navOk) {
        console.log(`  [Baltimore] Skipped Fees / Payments — navigation failed`);
        return { payments: [], screenshot: null };
      }
      await saveCheckpointScreenshot(page, "after_fees").catch(() => {});
    } catch (e) {
      console.log(`  [Baltimore] Skipped Fees / Payments — navigation failed`);
      console.log(`  [Baltimore] ${e.message}`);
      return { payments: [], screenshot: null };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Fees")',
        'a:has-text("Fees")',
        '[id*="TabDataList"] a:has-text("Payments")',
      'a:has-text("Payments")',
      'a:has-text("Payment")',
      'a[id*="Payment"]',
        'a[id*="Fee"]',
    ],
      "Payments / Fees",
      { expandPaymentsFirst: true, checkpointLabel: "after_fees" },
  );

  if (!found) {
      console.log("     [panel] Payments/Fees: link not found");
    return { payments: [], screenshot: null };
    }
  }

  if (isBaltimorePortal(page)) {
    const contentFrame = ctx;
    const baltimorePay = await extractBaltimorePayments(page, contentFrame);
    const payments = (baltimorePay.fees || []).map((f) => ({
      description: f.invoice_number || "",
      amount: f.amount || "",
      status: "",
      date: f.date || "",
    }));
    const payScreenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    console.log(`     [panel] Payments/Fees: ${payments.length} records extracted`);
    if (payments.length === 0) console.log("     [panel] Payments/Fees: panel empty (no data)");
    return {
      payments,
      screenshot: payScreenshot ? payScreenshot.toString("base64") : null,
    };
  }

  const payments = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

    const results = [];
    container
      .querySelectorAll('[id*="Payment"] tr, [id*="Fee"] tr')
      .forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const desc = cells[0].textContent.trim();
          if (
            desc &&
            desc.length < 200 &&
            !desc.toLowerCase().includes("description")
          ) {
            results.push({
              description: desc,
              amount: cells.length > 1 ? cells[1].textContent.trim() : "",
              status: cells.length > 2 ? cells[2].textContent.trim() : "",
              date: cells.length > 3 ? cells[3].textContent.trim() : "",
            });
          }
        }
      });
    return results;
  });

  const payScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(`     [panel] Payments/Fees: ${payments.length} records extracted`);
  if (payments.length === 0) console.log("     [panel] Payments/Fees: panel empty (no data)");
  return {
    payments,
    screenshot: payScreenshot ? payScreenshot.toString("base64") : null,
  };
}

async function scrapeAccelaRecord(
  session,
  permitNumber,
  supabaseProjectId,
  userId,
  supabase,
  hashPortalData,
  uploadToSupabaseStorage,
  sanitizeStorageKey,
  baltimoreTabs,
  fairfaxTabs,
  arlingtonTabs,
) {
  const { portalUrl } = session;
  const page =
    session.page || (session.context ? session.context.pages()[0] : null);
  if (!page) {
    throw new Error(
      "No authenticated page found in session — cannot start Accela scrape",
    );
  }
  const accelaTenantProfile = resolveAccelaTenantProfile(portalUrl);
  page._accelaTenantProfile = accelaTenantProfile;
  page._isArlington = !!(
    accelaTenantProfile && accelaTenantProfile.key === "arlington_county_va"
  );
  page._isBaltimore = (typeof portalUrl === "string" && portalUrl.toUpperCase().includes("BALTIMORE"));
  page._isFairfax = (typeof portalUrl === "string" && portalUrl.toUpperCase().includes("FAIRFAX"));
  if (page._isArlington && accelaTenantProfile) {
    console.log(
      `  [Arlington] Accela tenant profile: key=${accelaTenantProfile.key} agencyCode=${accelaTenantProfile.agencyCode} baseUrl=${accelaTenantProfile.baseUrl}`,
    );
  }
  const baltimoreTabSet =
    page._isBaltimore &&
    Array.isArray(baltimoreTabs) &&
    baltimoreTabs.length > 0
      ? new Set(baltimoreTabs.map((k) => String(k).trim()))
      : null;
  const fairfaxTabSet =
    page._isFairfax &&
    Array.isArray(fairfaxTabs) &&
    fairfaxTabs.length > 0
      ? new Set(fairfaxTabs.map((k) => String(k).trim()))
      : null;
  const arlingtonTabSet =
    page._isArlington &&
    Array.isArray(arlingtonTabs) &&
    arlingtonTabs.length > 0
      ? new Set(arlingtonTabs.map((k) => String(k).trim()))
      : null;
  const wantsArlingtonInfo =
    !page._isArlington || !arlingtonTabSet || arlingtonTabSet.has("info");
  const wantsArlingtonAttachments =
    !page._isArlington ||
    !arlingtonTabSet ||
    arlingtonTabSet.has("attachments");
  const wantsArlingtonPlanReview =
    !page._isArlington ||
    !arlingtonTabSet ||
    arlingtonTabSet.has("plan_review");
  const arlingtonExtras = !(
    page._isArlington && !arlingtonRunsSupplementalAccordionPanels(arlingtonTabSet)
  );
  const wantsBaltimoreInfo =
    !page._isBaltimore || !baltimoreTabSet || baltimoreTabSet.has("info");
  const wantsBaltimoreAttachments =
    !page._isBaltimore || !baltimoreTabSet || baltimoreTabSet.has("attachments");
  const wantsFairfaxInfo =
    !page._isFairfax || !fairfaxTabSet || fairfaxTabSet.has("info");
  const wantsFairfaxAttachments =
    !page._isFairfax || !fairfaxTabSet || fairfaxTabSet.has("attachments");
  if (page._isBaltimore) {
    console.log(
      "  [Baltimore] portal detected — using extended submenu wait and multi-context link search",
      baltimoreTabSet
        ? `(tabs: ${[...baltimoreTabSet].join(", ")})`
        : "(tabs: default all)",
    );
  }
  if (page._isFairfax) {
    console.log(
      "  [Fairfax] portal detected — using extended submenu wait and multi-context link search",
      fairfaxTabSet
        ? `(tabs: ${[...fairfaxTabSet].join(", ")})`
        : "(tabs: default all)",
    );
  }
  if (page._isArlington && arlingtonTabSet) {
    console.log(
      `  [Arlington] scrape tab scope (API tabs): ${[...arlingtonTabSet].join(", ")} — supplemental panels=${arlingtonExtras}`,
    );
  }
  const currentUrl = page.url();
  console.log(`  [GUARD] Starting scrape on existing page. URL: ${currentUrl}`);
  if (currentUrl === "about:blank" || !currentUrl || currentUrl === "") {
    throw new Error(
      `Authenticated page is blank (url=${currentUrl}) — session may be corrupt`,
    );
  }
  const extendArlingtonPlanReviewTimeout =
    page._isArlington &&
    (!arlingtonTabSet || arlingtonTabSet.has("plan_review"));

  const extendArlingtonAttachmentsTimeout =
    page._isArlington &&
    (!arlingtonTabSet || arlingtonTabSet.has("attachments")) &&
    !extendArlingtonPlanReviewTimeout;

  const arlingtonDurableMode =
    page._isArlington && session?.arlingtonDurableMode !== false;

  const TIMEOUT =
    arlingtonDurableMode
      ? null
      : extendArlingtonPlanReviewTimeout || extendArlingtonAttachmentsTimeout
        ? ARLINGTON_ATTACHMENTS_GLOBAL_TIMEOUT_MS
        : 600000;

  if (extendArlingtonPlanReviewTimeout && !arlingtonDurableMode) {
    console.log(
      `[Arlington][PlanReview] using extended global timeout=${TIMEOUT}`,
    );
  } else if (extendArlingtonAttachmentsTimeout && !arlingtonDurableMode) {
    console.log(
      `[Arlington][Attachments] using extended global timeout=${TIMEOUT}`,
    );
  } else if (arlingtonDurableMode) {
    console.log(
      "[Arlington][DurableJob] scrape-wide wall disabled — resumable job lifecycle active",
    );
  }

  const startTime = Date.now();
  const accelaSid = `${session._accelaSessionId || ""}`.trim();

  const checkTimeout = () => {
    if (arlingtonDurableMode || TIMEOUT == null) return;
    if (Date.now() - startTime > TIMEOUT) {
      if (
        page._isArlington &&
        (session.arlingtonPlanReviewCheckpointSaved === true ||
          session.arlingtonPlanReviewPartialPendingDownloads === true ||
          session.arlingtonAttachmentsCheckpointSaved === true ||
          session.arlingtonAttachmentsPartialPending === true)
      ) {
        if (
          session.arlingtonAttachmentsCheckpointSaved === true ||
          session.arlingtonAttachmentsPartialPending === true
        ) {
          session.arlingtonAttachmentsTimedOutAfterProgress = true;
          session.arlingtonAttachmentsPartialPending = true;
          console.log(
            `  [Arlington][Attachments] global scrape wall reached after checkpoint/progress — continuing as partial success`,
          );
        }
        if (
          session.arlingtonPlanReviewCheckpointSaved === true ||
          session.arlingtonPlanReviewPartialPendingDownloads === true
        ) {
          session.arlingtonPlanReviewTimedOutAfterProgress = true;
          session.arlingtonPlanReviewPartialPendingDownloads = true;
          console.log(
            `  [Arlington][PlanReview] global scrape wall reached after checkpoint/progress — continuing as partial success`,
          );
        }
        return;
      }
      throw new Error(
        `Accela scraping timed out (${Math.max(1, Math.round(TIMEOUT / 60000))} minute limit)`,
      );
    }
  };

  console.log(
    `[Scrape] requested projectId=${supabaseProjectId || "(none)"} permitNumber=${permitNumber}`,
  );

  const hadScrapeActive = session._scrapeActive === true;
  if (!hadScrapeActive) {
    session._scrapeActive = true;
    if (accelaSid) {
      console.log(`[Session][scrape] active=true sid=${accelaSid} flow=accela`);
    }
  }

  const {
    shouldAbort: accelaShouldAbort,
  } = require("./lib/scrape-job-cancellation.js");

  async function accelaCancelRequested() {
    try {
      return await accelaShouldAbort(session, supabase);
    } catch (_) {
      return !!session._cancelRequested;
    }
  }

  try {
    if (await accelaCancelRequested()) {
      session.status = "cancelled";
      session._cancelRequested = true;
      return { cancelled: true };
    }
    session.arlingtonPartialSuccessPlanReviewFailed = false;
    mirrorSessionProgress(session, `${permitNumber} → Searching...`);
    await searchPermit(page, portalUrl, permitNumber);
    checkTimeout();
    if (await accelaCancelRequested()) {
      session.status = "cancelled";
      session._cancelRequested = true;
      return { cancelled: true };
    }

    mirrorSessionProgress(session, `${permitNumber} → Record Header`);
    const header = await extractRecordHeader(page);
    const visiblePermit = (header.record_number || "").trim();
    console.log(`[Scrape] visible permit loaded: ${visiblePermit || "(empty)"}`);
    if (page._isArlington) {
      const arlingtonMode = arlingtonOrchestration.detectArlingtonRecordMode(
        header,
        permitNumber,
      );
      session.arlingtonRecordMode = arlingtonMode;
      console.log(`[Arlington][Mode] type=${arlingtonMode}`);
      if (session._scrapeJobId && supabase) {
        arlingtonOrchestration
          .updateArlingtonJobPhase(supabase, session._scrapeJobId, {
            recordMode: arlingtonMode,
            phase: "record_info",
          })
          .catch(() => {});
      }
    }
    if (page._isBaltimore || page._isFairfax) {
      const tenantLabel = page._isBaltimore ? "Baltimore" : "Fairfax";
      if (!visiblePermit) {
        throw new Error(
          `PERMIT_VERIFY_FAILED: ${tenantLabel} record header did not expose permit number — aborting scrape (no DB write)`,
        );
      }
      const tenantMatch = accelaPermitsEquivalentForTenant(
        permitNumber,
        visiblePermit,
        true,
      );
      if (!tenantMatch.ok) {
        throw new Error(
          `PERMIT_MISMATCH visible=${visiblePermit} requested=${permitNumber} — aborting scrape (no DB write)`,
        );
      }
      if (tenantMatch.kind === "base") {
        console.log(
          `[Accela permit verify] accepted base permit match visible=${visiblePermit} requested=${permitNumber}`,
        );
      }
    } else if (
      visiblePermit &&
      normalizePermitNumberKey(visiblePermit) !==
        normalizePermitNumberKey(permitNumber)
    ) {
      throw new Error(
        `PERMIT_MISMATCH visible=${visiblePermit} requested=${permitNumber} — aborting scrape (no DB write)`,
      );
    }
    checkTimeout();

    const headerScreenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    const headerScreenshotBase64 = headerScreenshot
      ? headerScreenshot.toString("base64")
      : null;

    let details = { fields: {}, tables: [], screenshot: null };
    const wantsRecordDetailsTab =
      (page._isBaltimore && wantsBaltimoreInfo) ||
      (page._isFairfax && wantsFairfaxInfo) ||
      (!page._isBaltimore && !page._isFairfax && !page._isArlington) ||
      (page._isArlington && wantsArlingtonInfo);
    if (wantsRecordDetailsTab) {
      try {
        mirrorSessionProgress(session, `${permitNumber} → Record Details`);
        details = await extractRecordDetails(page);
      } catch (err) {
        console.log(`  [scrape] Record Details section error: ${err.message}`);
      }
    } else {
      if (page._isBaltimore || page._isFairfax) {
        const tabSkipLabel = page._isBaltimore ? "Baltimore" : "Fairfax";
        console.log(
          `  [scrape] (skip) Record Details — ${tabSkipLabel} tab selection (info off)`,
        );
      } else if (page._isArlington) {
        console.log(
          "  [scrape] (skip) Record Details — Arlington tab preset (record info off)",
        );
      }
    }
    checkTimeout();

    let processingStatus = { departments: [], screenshot: null };
    if (!isMinimalTabsPortal(page) && (!page._isArlington || arlingtonExtras)) {
      try {
    mirrorSessionProgress(session, `${permitNumber} → Processing Status`);
        processingStatus = await extractProcessingStatus(page);
      } catch (err) {
        console.log(`  [scrape] Processing Status section error: ${err.message}`);
      }
    } else {
      if (isMinimalTabsPortal(page)) {
      console.log(
        "  [scrape] (skip) Processing Status — BALTIMORE_MINIMAL_PORTAL_TABS",
      );
      } else if (page._isArlington && !arlingtonExtras) {
        console.log(
          "  [scrape] (skip) Processing Status — Arlington narrowed tab preset",
        );
      }
    }
    checkTimeout();

    let planReview = {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
    };
    let arlingtonNewPlanReviewIntegratedEmpty = false;
    if (!isMinimalTabsPortal(page)) {
      if (page._isArlington && wantsArlingtonPlanReview) {
        console.log(
          "  [scrape] (defer) Plan Review — Arlington until after Attachments",
        );
      } else if (!page._isArlington) {
        try {
    mirrorSessionProgress(session, `${permitNumber} → Plan Review`);
          planReview = await extractPlanReview(page);
        } catch (err) {
          console.log(`  [scrape] Plan Review section error: ${err.message}`);
        }
      }
    } else {
      console.log("  [scrape] (skip) Plan Review — BALTIMORE_MINIMAL_PORTAL_TABS");
    }
    checkTimeout();

    let relatedRecords = { records: [], screenshot: null };
    if (!isMinimalTabsPortal(page) && (!page._isArlington || arlingtonExtras)) {
      try {
    mirrorSessionProgress(session, `${permitNumber} → Related Records`);
        relatedRecords = await extractRelatedRecords(page);
      } catch (err) {
        console.log(`  [scrape] Related Records section error: ${err.message}`);
      }
    } else {
      if (isMinimalTabsPortal(page)) {
      console.log(
        "  [scrape] (skip) Related Records — BALTIMORE_MINIMAL_PORTAL_TABS",
      );
      } else if (page._isArlington && !arlingtonExtras) {
        console.log(
          "  [scrape] (skip) Related Records — Arlington narrowed tab preset",
        );
      }
    }
    checkTimeout();

    let attachments = { attachments: [], screenshot: null };
    const wantsAttachmentsTab =
      (page._isBaltimore && wantsBaltimoreAttachments) ||
      (page._isFairfax && wantsFairfaxAttachments) ||
      (!page._isBaltimore && !page._isFairfax && !page._isArlington) ||
      (page._isArlington && wantsArlingtonAttachments);
    if (wantsAttachmentsTab) {
      if (await accelaCancelRequested()) {
        session.status = "cancelled";
        session._cancelRequested = true;
        return { cancelled: true };
      }
      try {
        mirrorSessionProgress(session, `${permitNumber} → Attachments`);
        /** @type {Record<string, unknown> | null} */
        let arlingtonPriorPortalForAtt = null;
        if (page._isArlington && supabase && userId) {
          if (supabaseProjectId) {
            const { data: arow } = await supabase
              .from("projects")
              .select("portal_data")
              .eq("id", supabaseProjectId)
              .maybeSingle();
            arlingtonPriorPortalForAtt = arow?.portal_data ?? null;
          }
          if (!arlingtonPriorPortalForAtt) {
            const { data: a2 } = await supabase
              .from("projects")
              .select("portal_data")
              .eq("permit_number", permitNumber)
              .eq("user_id", userId)
              .limit(1);
            arlingtonPriorPortalForAtt = a2?.[0]?.portal_data ?? null;
          }
        }
        const ATT_DOWNLOADS_ROOT = path.join(__dirname, "downloads");
        if (!fs.existsSync(ATT_DOWNLOADS_ROOT)) {
          fs.mkdirSync(ATT_DOWNLOADS_ROOT, { recursive: true });
        }
        const arlingtonAttDownloadCtx =
          page._isArlington && wantsArlingtonAttachments
            ? {
                DOWNLOADS_DIR: ATT_DOWNLOADS_ROOT,
                supabaseProjectId,
                uploadFn: uploadToSupabaseStorage,
                sanitizeFn: sanitizeStorageKey,
                permitNumber,
                priorPortalData: arlingtonPriorPortalForAtt,
                supabase,
                userId,
                hashPortalData,
                scrapeDeadlineMs: arlingtonDurableMode
                  ? startTime + 365 * 24 * 60 * 60 * 1000
                  : startTime + (TIMEOUT || 600000),
                reserveMsForFinalSave:
                  ARLINGTON_ATTACHMENTS_RESUME_RESERVE_FINAL_SAVE_MS,
                touchSessionKeepalive:
                  typeof session.touchSessionKeepalive === "function"
                    ? session.touchSessionKeepalive.bind(session)
                    : null,
                _arlingtonSession: session,
              }
            : null;
        attachments = await extractAttachments(
          page,
          session,
          supabaseProjectId,
          supabase,
          uploadToSupabaseStorage,
          sanitizeStorageKey,
          arlingtonAttDownloadCtx,
        );
        if (attachments.rateLimited === true) {
          session.arlingtonAttachmentsRateLimited = true;
          session.arlingtonAttachmentsPartialPending = true;
          session.arlingtonAttachmentsCheckpointSaved = true;
          const priorRows = arlingtonPriorAttachmentRowsFromPortalData(
            arlingtonPriorPortalForAtt,
          );
          if (priorRows.length > 0) {
            attachments.attachments = arlingtonNormalizeAttachmentsForPortal(
              priorRows,
              { logSummary: true },
            );
          } else {
            attachments.attachments = [];
          }
          attachments.scrapeStatus = "rate_limited";
          attachments.partialPendingDownloads = true;
          if (supabase && userId && typeof hashPortalData === "function") {
            const slice = buildArlingtonAttachmentsCheckpointTabSlice({
              attachments: attachments.attachments,
              screenshotBase64: attachments.screenshot || null,
              partialPendingDownloads: true,
              scrapeStatus: "rate_limited",
              sectionState: "rate_limited",
              rateLimitRetryAfter: attachments.rateLimitRetryAfter,
            });
            await persistArlingtonAttachmentsCheckpoint({
              supabase,
              userId,
              supabaseProjectId,
              permitNumber,
              hashPortalData,
              attachmentsTabPayload: slice,
            });
          }
          if (session.arlingtonDurableMode === true && supabase) {
            session.arlingtonSkipRemainingPhasesDueToRateLimit = true;
            await arlingtonDurableJob.scheduleRateLimitResume(
              supabase,
              session,
              async () => {
                if (!session.arlingtonAutoContinueAttachments) return;
                await runArlingtonAttachmentsAutoContinueLoop({
                  session,
                  projectId: supabaseProjectId,
                  userId,
                  permitNumber,
                  maxCycles: arlingtonOrchestration.resolveDurableAutoContinueMaxCycles(
                    session,
                  ),
                  delayMs: session.arlingtonAutoContinueDelayMs ?? 2000,
                  maxNoProgressCycles:
                    session.arlingtonAutoContinueMaxNoProgressCycles ?? 2,
                  supabase,
                  hashPortalData,
                  uploadToSupabaseStorage,
                  sanitizeStorageKey,
                  initialResultOrStats: session.arlingtonAttachmentsRunStats,
                });
              },
              {
                errorCode: "1015",
                attempt: session.arlingtonRateLimitAttempts || 0,
              },
            );
          }
        }
        if (attachments.partialPendingDownloads === true) {
          session.arlingtonAttachmentsPartialPending = true;
        }
        if (
          attachments.scrapeStatus === "partial_pending_downloads" ||
          attachments.arlingtonAttachmentsRunStats?.checkpointSaved === true
        ) {
          session.arlingtonAttachmentsCheckpointSaved = true;
        }
        if (attachments.arlingtonAttachmentsRunStats) {
          session.arlingtonAttachmentsRunStats =
            attachments.arlingtonAttachmentsRunStats;
        }
      } catch (err) {
        console.log(`  [scrape] Attachments section error: ${err.message}`);
      }
    } else {
      if (page._isBaltimore || page._isFairfax) {
        const tabSkipLabel = page._isBaltimore ? "Baltimore" : "Fairfax";
        console.log(
          `  [scrape] (skip) Attachments — ${tabSkipLabel} tab selection (attachments off)`,
        );
      } else if (page._isArlington) {
        console.log(
          "  [scrape] (skip) Attachments — Arlington tab preset (attachments off)",
        );
      }
    }
    checkTimeout();

    if (
      page._isArlington &&
      wantsArlingtonAttachments &&
      session.arlingtonAutoContinueAttachments === true
    ) {
      try {
        mirrorSessionProgress(session, `${permitNumber} → Continuing Attachments downloads automatically...`);
        const autoAttSummary = await runArlingtonAttachmentsAutoContinueLoop({
          session,
          projectId: supabaseProjectId,
          userId,
          permitNumber,
          maxCycles: arlingtonOrchestration.resolveDurableAutoContinueMaxCycles(
            session,
          ),
          delayMs: session.arlingtonAutoContinueDelayMs ?? 2000,
          maxNoProgressCycles:
            session.arlingtonAutoContinueMaxNoProgressCycles ?? 2,
          supabase,
          hashPortalData,
          uploadToSupabaseStorage,
          sanitizeStorageKey,
          initialResultOrStats: session.arlingtonAttachmentsRunStats,
        });
        if (
          autoAttSummary.finalStatus ===
            "partial_success_attachments_pending" ||
          autoAttSummary.finalStatus === "partial_success_no_downloads"
        ) {
          session.arlingtonAttachmentsPartialPending = true;
          session.arlingtonAttachmentsCheckpointSaved = true;
        } else if (autoAttSummary.finalStatus === "complete") {
          session.arlingtonAttachmentsPartialPending = false;
        }
        const pendingLeft = Number(autoAttSummary.pending) || 0;
        const cyc = Number(autoAttSummary.cycles) || 0;
        if (pendingLeft > 0) {
          mirrorSessionProgress(session, `${permitNumber} → Attachments partially complete (${pendingLeft} pending after ${cyc} auto-continue cycle(s))`);
        } else {
          mirrorSessionProgress(session, `${permitNumber} → Attachments downloads complete (${cyc} auto-continue cycle(s))`);
        }
      } catch (autoAttErr) {
        const autoAttMsg =
          autoAttErr && autoAttErr.message
            ? autoAttErr.message
            : String(autoAttErr);
        console.warn(
          `  [scrape] Arlington Attachments auto-continue error: ${autoAttMsg}`,
        );
        session.arlingtonAttachmentsPartialPending = true;
      }
      checkTimeout();
    }

    if (
      page._isArlington &&
      wantsArlingtonAttachments &&
      supabase &&
      userId &&
      (session.arlingtonAutoContinueAttachments === true ||
        session.arlingtonAttachmentsCheckpointSaved === true)
    ) {
      try {
        const latestPd = await arlingtonFetchLatestPortalDataRow(
          supabase,
          userId,
          supabaseProjectId,
          permitNumber,
        );
        const reloaded = arlingtonPriorAttachmentRowsFromPortalData(latestPd);
        if (reloaded.length > 0) {
          attachments.attachments = arlingtonNormalizeAttachmentsForPortal(
            reloaded,
            { logSummary: true },
          );
          const pendingReload = attachments.attachments.filter(
            (a) => !arlingtonAttachmentLooksUploadComplete(a),
          ).length;
          attachments.partialPendingDownloads =
            pendingReload > 0 ||
            session.arlingtonAttachmentsPartialPending === true;
          attachments.scrapeStatus = attachments.partialPendingDownloads
            ? "partial_pending_downloads"
            : "complete";
          console.log(
            `  [Arlington][Attachments] reloaded ${reloaded.length} row(s) from DB before final portal save (pending=${pendingReload})`,
          );
        }
      } catch (reloadErr) {
        const reloadMsg =
          reloadErr && reloadErr.message
            ? reloadErr.message
            : String(reloadErr);
        console.warn(
          `  [Arlington][Attachments] reload from DB failed: ${reloadMsg}`,
        );
      }
    }

    if (
      page._isArlington &&
      !isMinimalTabsPortal(page) &&
      wantsArlingtonPlanReview &&
      session.arlingtonSkipRemainingPhasesDueToRateLimit !== true
    ) {
      try {
        mirrorSessionProgress(session, `${permitNumber} → Plan Review`);
        const DOWNLOADS_ROOT = path.join(__dirname, "downloads");
        if (!fs.existsSync(DOWNLOADS_ROOT)) {
          fs.mkdirSync(DOWNLOADS_ROOT, { recursive: true });
        }
        const planReviewHashes = new Map();
        /** @type {Record<string, unknown> | null} */
        let arlingtonPriorPortalForPr = null;
        if (supabase && userId) {
          if (supabaseProjectId) {
            const { data: prow } = await supabase
              .from("projects")
              .select("portal_data")
              .eq("id", supabaseProjectId)
              .maybeSingle();
            arlingtonPriorPortalForPr = prow?.portal_data ?? null;
          }
          if (!arlingtonPriorPortalForPr) {
            const { data: pr2 } = await supabase
              .from("projects")
              .select("portal_data")
              .eq("permit_number", permitNumber)
              .eq("user_id", userId)
              .limit(1);
            arlingtonPriorPortalForPr = pr2?.[0]?.portal_data ?? null;
          }
        }
        planReview = await extractPlanReviewArlington(
          page,
          getExtractionContext(page),
          {
            DOWNLOADS_DIR: DOWNLOADS_ROOT,
            supabaseProjectId,
            uploadFn: uploadToSupabaseStorage,
            sanitizeFn: sanitizeStorageKey,
            downloadedHashes: planReviewHashes,
            attachmentRows: attachments.attachments || [],
            permitNumber,
            priorPortalData: arlingtonPriorPortalForPr,
            supabase,
            userId,
            hashPortalData,
            scrapeDeadlineMs: arlingtonDurableMode
              ? startTime + 365 * 24 * 60 * 60 * 1000
              : startTime + (TIMEOUT || 600000),
            reserveMsForFinalSave:
              ARLINGTON_PLAN_REVIEW_RESUME_RESERVE_FINAL_SAVE_MS,
            touchSessionKeepalive:
              typeof session.touchSessionKeepalive === "function"
                ? session.touchSessionKeepalive.bind(session)
                : null,
            _arlingtonSession: session,
            forceRetryOversizedDownloads:
              session.arlingtonPlanReviewRetryOversizedDownloads === true ||
              arlingtonEnvForceRetryOversizedPlanReviewDownloads(),
            planReviewScope: session.arlingtonPlanReviewScope,
            planReviewMode: session.arlingtonPlanReviewMode,
            downloadDocuments: session.arlingtonDownloadDocuments,
          },
        );
        const arlPr = planReview?.arlingtonPlanReview;
        if (arlPr?.partialPendingDownloads === true) {
          session.arlingtonPlanReviewPartialPendingDownloads = true;
        }
        if (
          arlPr?.scrapeStatus === "partial_pending_downloads" ||
          arlPr?.runStats?.checkpointSaved === true
        ) {
          session.arlingtonPlanReviewCheckpointSaved = true;
        }
        if (arlPr?.runStats) {
          session.arlingtonPlanReviewRunStats = arlPr.runStats;
        }
      } catch (err) {
        console.log(
          `  [scrape] Arlington Plan Review (deferred) error: ${err.message}`,
        );
      }
      checkTimeout();
    } else if (
      page._isArlington &&
      wantsArlingtonPlanReview &&
      session.arlingtonSkipRemainingPhasesDueToRateLimit === true
    ) {
      console.log(
        "[Arlington][PlanReview] deferred — attachments rate-limited; remaining phases scheduled after cooldown",
      );
    }

    if (page._isArlington && wantsArlingtonPlanReview) {
      planReview = finalizeArlingtonPlanReviewAfterAttachments(
        planReview,
        attachments.attachments,
      );
      const pt = planReview?.arlingtonPlanReview?.tabs;
      if (pt && typeof pt === "object") {
        arlingtonNewPlanReviewIntegratedEmpty =
          arlingtonIntegratedPlanReviewIsEffectivelyEmpty(
            /** @type {Record<string, unknown>} */ (pt),
          );
      }

      if (
        session.arlingtonAutoContinueDownloads === true &&
        arlingtonPlanReviewScopeSupportsAutoContinue(
          session.arlingtonPlanReviewScope,
        )
      ) {
        const continueScope = arlingtonPlanReviewMapScrapeScopeToContinueScope(
          session.arlingtonPlanReviewScope,
        );
        try {
          mirrorSessionProgress(session, `${permitNumber} → Continuing Plan Review downloads automatically...`);
          const autoSummary = await runArlingtonPlanReviewAutoContinueLoop({
            session,
            projectId: supabaseProjectId,
            userId,
            permitNumber,
            scope: continueScope,
            maxCycles: arlingtonOrchestration.resolveDurableAutoContinueMaxCycles(
              session,
            ),
            delayMs: session.arlingtonAutoContinueDelayMs ?? 2000,
            maxNoProgressCycles:
              session.arlingtonAutoContinueMaxNoProgressCycles ?? 2,
            supabase,
            hashPortalData,
            uploadToSupabaseStorage,
            sanitizeStorageKey,
          });
          if (
            autoSummary.finalStatus === "partial_success_plan_review_pending" ||
            autoSummary.finalStatus === "partial_success_no_downloads"
          ) {
            session.arlingtonPlanReviewPartialPendingDownloads = true;
            session.arlingtonPlanReviewCheckpointSaved = true;
          } else if (autoSummary.finalStatus === "complete") {
            session.arlingtonPlanReviewPartialPendingDownloads = false;
          }
          const pendingLeft = Number(autoSummary.pending) || 0;
          const cyc = Number(autoSummary.cycles) || 0;
          if (pendingLeft > 0) {
            mirrorSessionProgress(session, `${permitNumber} → Plan Review partially complete (${pendingLeft} pending after ${cyc} auto-continue cycle(s))`);
          } else {
            mirrorSessionProgress(session, `${permitNumber} → Plan Review downloads complete (${cyc} auto-continue cycle(s))`);
          }
        } catch (autoErr) {
          const autoMsg =
            autoErr && autoErr.message ? autoErr.message : String(autoErr);
          console.warn(
            `  [scrape] Arlington Plan Review auto-continue error: ${autoMsg}`,
          );
          session.arlingtonPlanReviewPartialPendingDownloads = true;
        }
        checkTimeout();
      }
    }

    let inspections = {
      inspections: [],
      upcoming: [],
      completed: [],
      screenshot: null,
    };
    if (!isMinimalTabsPortal(page) && (!page._isArlington || arlingtonExtras)) {
      try {
    mirrorSessionProgress(session, `${permitNumber} → Inspections`);
        inspections = await extractInspections(page);
      } catch (err) {
        console.log(`  [scrape] Inspections section error: ${err.message}`);
      }
    } else {
      if (isMinimalTabsPortal(page)) {
        console.log(
          "  [scrape] (skip) Inspections — BALTIMORE_MINIMAL_PORTAL_TABS",
        );
      } else if (page._isArlington && !arlingtonExtras) {
        console.log(
          "  [scrape] (skip) Inspections — Arlington narrowed tab preset",
        );
      }
    }
    checkTimeout();

    let payments = { payments: [], screenshot: null };
    if (!isMinimalTabsPortal(page) && !page._isArlington) {
      try {
    mirrorSessionProgress(session, `${permitNumber} → Payments`);
        payments = await extractPayments(page);
      } catch (err) {
        console.log(`  [scrape] Payments section error: ${err.message}`);
      }
    } else if (page._isArlington) {
      console.log("  [scrape] (skip) Payments — Arlington tenant scope");
    } else {
      console.log("  [scrape] (skip) Payments — BALTIMORE_MINIMAL_PORTAL_TABS");
    }

    const isBaltimore = page._isBaltimore === true;
    const isFairfaxTenant = page._isFairfax === true;
    const isArlingtonTenant = page._isArlington === true;
    const isBaltimoreOrFairfaxPayload = isBaltimore || isFairfaxTenant;
    const portalData = {
      portalType: "accela",
      ...(isBaltimoreOrFairfaxPayload || isArlingtonTenant
        ? { schemaVersion: 2 }
        : {}),
      name: header.record_number || permitNumber,
      projectNum: permitNumber,
      description: header.record_type || "",
      location:
        (isArlingtonTenant &&
          details.arlingtonRecordInfo?.workLocation?.text) ||
        details.fields["Work Location"] ||
        details.fields["Address"] ||
        details.fields["Location"] ||
        "",
      dashboardStatus: header.record_status || "",
      tabs: {
        info: (() => {
          if (
            isArlingtonTenant &&
            details.arlingtonRecordInfo &&
            details.arlingtonRecordInfo.workLocation &&
            Array.isArray(details.arlingtonRecordInfo.workLocation.lines) &&
            details.arlingtonRecordInfo.workLocation.lines.length > 0
          ) {
            const ar = details.arlingtonRecordInfo;
            const recordStatusDisplay = (header.record_status || "")
              .replace(/^Record Status:\s*/i, "")
              .trim();
            const expirationDisplay = (header.expiration_date || "")
              .replace(/^Expiration Date:\s*/i, "")
              .trim();
            return {
              title: "Record Info",
              jurisdiction: "arlington_county_va",
              tables: details.tables || [],
              fields: header,
              keyValues: [
                {
                  key: "Record Number",
                  value: header.record_number || "",
                },
                {
                  key: "Record Type",
                  value: header.record_type || "",
                },
                {
                  key: "Record Status",
                  value: recordStatusDisplay,
                },
                {
                  key: "Expiration Date",
                  value: expirationDisplay,
                },
                {
                  key: "Work Location",
                  value: ar.workLocation?.text || "",
                },
                {
                  key: "Applicant",
                  value:
                    ar.applicant?.text ||
                    (ar.applicant?.lines || []).join("\n") ||
                    "",
                },
                {
                  key: "Licensed Professional",
                  value:
                    ar.licensedProfessional?.text ||
                    (ar.licensedProfessional?.lines || []).join("\n") ||
                    "",
                },
                {
                  key: "Owner",
                  value:
                    ar.owner?.text || (ar.owner?.lines || []).join("\n") || "",
                },
              ],
              arlingtonRecordInfo: ar,
              screenshot: details.screenshot,
            };
          }
          return {
          tables: (() => {
            if (!isBaltimoreOrFairfaxPayload) return details.tables;
            const keepAlways = new Set([
              "Record Number",
              "Record Type",
              "Record Status",
              "Expiration Date",
              "Work Location",
              "Applicant",
              "Licensed Professional",
              "Project Description",
            ]);
            const bareDupLabels = new Set([
              "primary phone",
              "secondary phone",
              "e-mail",
              "email",
            ]);
            const navOrSpell = /< Prev|Next >|Additional Results|spell check/i;
            const keepRow = ({ key, value }) => {
              const k = (key ?? "").trim();
              const v = String(value ?? "");
              if (keepAlways.has(k)) return true;
              if (k.includes(" - ")) return true;
              if (/^\d{2}\/\d{2}\/\d{4}$/.test(k)) return false;
              if (navOrSpell.test(k) || navOrSpell.test(v)) return false;
              if (k.includes("Block:--") || k.includes("Lot:--")) return false;
              if (/^\d+\)/.test(k)) return false;
              if (/\wStatus:/i.test(k)) return false;
              if (bareDupLabels.has(k.toLowerCase())) return false;
              return true;
            };
            return details.tables.map((t) =>
              t.title === "Record Details" && Array.isArray(t.rows)
                ? { ...t, rows: t.rows.filter(keepRow) }
                : t,
            );
          })(),
          fields: header,
          keyValues: (() => {
            const rows = [
            ...(header.record_number
              ? [{ key: "Record Number", value: header.record_number }]
              : []),
            ...(header.record_type
              ? [{ key: "Record Type", value: header.record_type }]
              : []),
            ...(header.record_status
              ? [{ key: "Record Status", value: header.record_status }]
              : []),
            ...(header.expiration_date
              ? [{ key: "Expiration Date", value: header.expiration_date }]
              : []),
            ...Object.entries(details.fields).map(([key, value]) => ({
              key,
              value,
            })),
            ];
            if (!isBaltimoreOrFairfaxPayload) return rows;

            const keepAlways = new Set([
              "Record Number",
              "Record Type",
              "Record Status",
              "Expiration Date",
              "Work Location",
              "Applicant",
              "Licensed Professional",
              "Project Description",
            ]);
            const bareDupLabels = new Set([
              "primary phone",
              "secondary phone",
              "e-mail",
              "email",
            ]);
            const navOrSpell = /< Prev|Next >|Additional Results|spell check/i;

            return rows.filter(({ key, value }) => {
              const k = (key ?? "").trim();
              const v = String(value ?? "");
              if (keepAlways.has(k)) return true;
              if (k.includes(" - ")) return true;
              if (/^\d{2}\/\d{2}\/\d{4}$/.test(k)) return false;
              if (navOrSpell.test(k) || navOrSpell.test(v)) return false;
              if (k.includes("Block:--") || k.includes("Lot:--")) return false;
              if (/^\d+\)/.test(k)) return false;
              if (/\wStatus:/i.test(k)) return false;
              if (bareDupLabels.has(k.toLowerCase())) return false;
              return true;
            });
          })(),
          screenshot: details.screenshot,
        };
        })(),
        status: {
          departments: processingStatus.departments,
          tables:
            processingStatus.departments.length > 0
              ? [
                  {
                    title: "Processing Status",
                    headers: ["Department", "Status", "Due Date", "Details"],
                    rows: processingStatus.departments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: processingStatus.screenshot,
        },
        reports: {
          pdfs: [
            ...(processingStatus.screenshot
              ? [
                  {
                    fileName: "Processing Status",
                    text: processingStatus.departments
                      .map(
                        (d) => `${d.name}: ${d.status} ${d.date} ${d.details}`,
                      )
                      .join("\n"),
                    screenshot: processingStatus.screenshot,
                    source: "accela",
                  },
                ]
              : []),
            ...(planReview.text &&
            (!isBaltimoreOrFairfaxPayload ||
              planReview.comments.length > 0 ||
              isArlingtonTenant)
              ? [
                  {
                    fileName: "Plan Review - Review Comments",
                    text: planReview.text,
                    screenshot: planReview.screenshot,
                    source: "accela",
                    comments: planReview.comments,
                  },
                ]
              : []),
            ...(headerScreenshotBase64
              ? [
                  {
                    fileName: "Record Overview",
                    text: Object.entries(header)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n"),
                    screenshot: headerScreenshotBase64,
                    source: "accela",
                  },
                ]
              : []),
          ],
          keyValues: [],
          tables: [],
          ...(isBaltimoreOrFairfaxPayload && planReview.planReviewSummary
            ? { planReviewSummary: planReview.planReviewSummary }
            : {}),
        },
        attachments: {
          tables:
            attachments.attachments.length > 0
              ? [
                  {
                    title: "Attachments",
                    headers: [
                      "Name",
                      "Record ID",
                      "Record Type",
                      "Entity Type",
                      "Type",
                      "Size",
                      "Last Updated",
                    ],
                    rows: attachments.attachments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: attachments.screenshot,
          ...(attachments.partialPendingDownloads
            ? { partialPendingDownloads: true }
            : {}),
          ...(attachments.scrapeStatus
            ? { scrapeStatus: attachments.scrapeStatus }
            : {}),
          source: page._isArlington ? "attachments" : undefined,
          ...(page._isArlington
            ? { jurisdiction: "arlington_county_va" }
            : {}),
        },
        inspections: {
          tables: [
            ...(inspections.upcoming.length > 0
              ? [
                  {
                    title: "Upcoming Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.upcoming,
                  },
                ]
              : []),
            ...(inspections.completed.length > 0
              ? [
                  {
                    title: "Completed Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.completed,
                  },
                ]
              : []),
            ...(inspections.inspections.length > 0 &&
            inspections.upcoming.length === 0 &&
            inspections.completed.length === 0
              ? [
                  {
                    title: "Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.inspections,
                  },
                ]
              : []),
          ],
          keyValues: [],
          screenshot: inspections.screenshot,
        },
        payments: {
          tables:
            payments.payments.length > 0
              ? [
                  {
                    title: "Payments",
                    headers: ["Description", "Amount", "Status", "Date"],
                    rows: payments.payments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: payments.screenshot,
        },
        relatedRecords: {
          tables:
            relatedRecords.records.length > 0
              ? [
                  {
                    title: "Related Records",
                    headers: [
                      "Record Number",
                      "Record Type",
                      "Status",
                      "Project Name",
                      "Date",
                    ],
                    rows: relatedRecords.records,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: relatedRecords.screenshot,
        },
        planReview: (() => {
          const base = {
            comments: planReview.comments || [],
            text: planReview.text || "",
            screenshot: planReview.screenshot || null,
            planReviewSummary: planReview.planReviewSummary || null,
            downloadLinks: planReview.downloadLinks || [],
          };
          if (planReview.arlingtonPlanReview) {
            const arlPr = planReview.arlingtonPlanReview;
            return {
              ...base,
              used: arlPr.used,
              message: arlPr.message,
              source: arlPr.source || null,
              tabs: arlPr.tabs,
              jurisdiction: "arlington_county_va",
              ...(arlPr.timeout === true ? { timeout: true } : {}),
              tenantPlanReview: arlPr.tenantPlanReview || undefined,
              ...(arlPr.partialPendingDownloads === true
                ? { partialPendingDownloads: true }
                : {}),
              ...(arlPr.scrapeStatus ? { scrapeStatus: arlPr.scrapeStatus } : {}),
              ...(arlPr.preservePreviousPlanReview === true
                ? { preservePreviousPlanReview: true }
                : {}),
              ...(typeof arlPr.planReviewState?.shouldPersist === "boolean"
                ? { shouldPersist: arlPr.planReviewState.shouldPersist }
                : {}),
              ...(arlPr._arlingtonSelectiveScope
                ? {
                    _arlingtonSelectiveScope: arlPr._arlingtonSelectiveScope,
                    _arlingtonSelectiveUpdate:
                      arlPr._arlingtonSelectiveUpdate === true,
                  }
                : {}),
              ...(typeof arlPr._arlingtonReviewResultsPanelResolved ===
              "boolean"
                ? {
                    _arlingtonReviewResultsPanelResolved:
                      arlPr._arlingtonReviewResultsPanelResolved,
                  }
                : {}),
              ...(typeof arlPr._arlingtonProjectInformationPanelResolved ===
              "boolean"
                ? {
                    _arlingtonProjectInformationPanelResolved:
                      arlPr._arlingtonProjectInformationPanelResolved,
                  }
                : {}),
              ...(arlPr.planReviewState &&
              typeof arlPr.planReviewState === "object"
                ? {
                    planReviewState: {
                      reviewResultsVisited:
                        arlPr.planReviewState.reviewResultsVisited === true,
                      reviewResultsPanelResolved:
                        arlPr.planReviewState.reviewResultsPanelResolved ===
                        true,
                    },
                  }
                : {}),
            };
          }
          return base;
        })(),
      },
    };

    if (
      page._isArlington &&
      wantsArlingtonPlanReview &&
      planReview?.arlingtonPlanReview?.planReviewState
    ) {
      const st = /** @type {Record<string, unknown>} */ (
        planReview.arlingtonPlanReview.planReviewState
      );
      const iframeReadyVal = !!st.iframeReady;
      const planSetValidVal = !!st.planSetValid;

      const explicitMayNotPersist =
        typeof st.shouldPersist === "boolean" && !st.shouldPersist;

      const extractionFailedPersist =
        explicitMayNotPersist ||
        (!iframeReadyVal && !planSetValidVal);

      if (extractionFailedPersist) {
        portalData.planReviewLastError = {
          type: iframeReadyVal
            ? "plan_review_extraction_incomplete"
            : "erms_iframe_not_ready",
          message:
            "Plan Review iframe did not load / OnBase session failed",
          at: new Date().toISOString(),
        };
        session.arlingtonPartialSuccessPlanReviewFailed = true;
      }
    }

    if (isMinimalTabsPortal(page)) {
      const minimalTabs = {};
      if (
        (page._isBaltimore && wantsBaltimoreInfo) ||
        (page._isFairfax && wantsFairfaxInfo)
      ) {
        minimalTabs.info = portalData.tabs.info;
      }
      if (
        (page._isBaltimore && wantsBaltimoreAttachments) ||
        (page._isFairfax && wantsFairfaxAttachments)
      ) {
        minimalTabs.attachments = portalData.tabs.attachments;
      }
      portalData.tabs = minimalTabs;
    }
    console.log(
      "[PortalData] sections returned:",
      Object.keys(portalData.tabs),
      "(info = Record Details)",
    );

    const arlingtonPrTabForResponse =
      page._isArlington &&
      portalData.tabs?.planReview &&
      typeof portalData.tabs.planReview === "object"
        ? /** @type {Record<string, unknown>} */ (portalData.tabs.planReview)
        : null;
    const arlingtonRestorePlanReviewForResponse =
      !!arlingtonPrTabForResponse &&
      (arlingtonPrTabForResponse.preservePreviousPlanReview === true ||
        (typeof arlingtonPrTabForResponse.shouldPersist === "boolean" &&
          arlingtonPrTabForResponse.shouldPersist === false));

    if (
      arlingtonRestorePlanReviewForResponse &&
      supabase &&
      userId
    ) {
      /** @type {Record<string, unknown> | null} */
      let priorPdRestore = null;
      if (supabaseProjectId) {
        const { data: prow } = await supabase
          .from("projects")
          .select("portal_data")
          .eq("id", supabaseProjectId)
          .maybeSingle();
        priorPdRestore = prow?.portal_data ?? null;
      }
      if (!priorPdRestore) {
        const { data: pr2 } = await supabase
          .from("projects")
          .select("portal_data")
          .eq("permit_number", permitNumber)
          .eq("user_id", userId)
          .limit(1);
        priorPdRestore = pr2?.[0]?.portal_data ?? null;
      }
      const priorPr = priorPdRestore?.tabs?.planReview;
      if (priorPr != null && typeof priorPr === "object") {
        console.log(
          "[Arlington][PlanReview] weak/failed extraction detected; preserving existing valid planReview for API response",
        );
        portalData.tabs.planReview =
          structuredCloneWorksSafe(priorPr) ?? priorPr;
      }
      delete /** @type {Record<string, unknown>} */ (
        portalData.tabs.planReview || {}
      ).preservePreviousPlanReview;
    }

    let portalPayloadForDb = portalData;
    if (
      page._isArlington &&
      arlingtonTabSet &&
      !(
        arlingtonTabSet.has("info") &&
        arlingtonTabSet.has("attachments") &&
        arlingtonTabSet.has("plan_review")
      ) &&
      supabase &&
      userId
    ) {
      let priorPd = null;
      if (supabaseProjectId) {
        const { data: prow } = await supabase
          .from("projects")
          .select("portal_data")
          .eq("id", supabaseProjectId)
          .maybeSingle();
        priorPd = prow?.portal_data ?? null;
      }
      if (!priorPd) {
        const { data: pr2 } = await supabase
          .from("projects")
          .select("portal_data")
          .eq("permit_number", permitNumber)
          .eq("user_id", userId)
          .limit(1);
        priorPd = pr2?.[0]?.portal_data ?? null;
      }
      if (priorPd) {
        portalPayloadForDb = mergeArlingtonPartialPortalData(
          priorPd,
          portalData,
          arlingtonTabSet,
        );
        console.log(
          "  [Arlington] merged partial scrape into existing portal_data (preserve untouched tabs)",
        );
      }
    }

    if (page._isArlington) {
      const bytesBefore = portalDataUtf8ByteLength(portalPayloadForDb);
      console.log("[PortalData] payload bytes before sanitize=", bytesBefore);
      portalPayloadForDb =
        sanitizeArlingtonPortalDataTabsPlanReviewForDb(portalPayloadForDb);
      const bytesAfter = portalDataUtf8ByteLength(portalPayloadForDb);
      const prWrap = portalPayloadForDb?.tabs?.planReview;
      const planReviewBytes = portalDataUtf8ByteLength(
        prWrap != null ? { tabs: { planReview: prWrap } } : { tabs: {} },
      );
      console.log("[PortalData] payload bytes after sanitize=", bytesAfter);
      console.log("[PortalData] planReview bytes=", planReviewBytes);
    }

    arlingtonSyncSessionDataPortalPayload(
      session,
      permitNumber,
      portalPayloadForDb,
    );

    console.log(`  📊 Extraction summary: info.fields=${Object.keys(details.fields).length} | status.departments=${processingStatus.departments.length} | relatedRecords=${relatedRecords.records.length} | attachments=${attachments.attachments.length} | inspections=${inspections.inspections.length + inspections.upcoming.length + inspections.completed.length} | payments=${payments.payments.length}`);

    if (supabase && userId) {
      mirrorSessionProgress(session, `${permitNumber} → Syncing to database...`);
      console.log(`\n  💾 Syncing ${permitNumber} to Supabase...`);
      console.log(
        `  📌 supabaseProjectId=${supabaseProjectId || "(none)"}, userId=${userId}, portalType=${portalPayloadForDb.portalType}`,
      );

      let existingRow = null;
      const selectFields =
        page._isBaltimore || page._isFairfax
          ? "id, portal_data_hash, portal_data, permit_number, user_id, address, jurisdiction"
          : "id, portal_data_hash, portal_data, address, jurisdiction";

      if (page._isBaltimore || page._isFairfax) {
        const tenantLabel = page._isBaltimore ? "Baltimore" : "Fairfax";
        if (!supabaseProjectId) {
          throw new Error(
            `${tenantLabel} scrape requires projectId — refusing DB write`,
          );
        }
        const { data: bRows, error: bErr } = await supabase
          .from("projects")
          .select(selectFields)
          .eq("id", supabaseProjectId)
          .limit(1);
        if (bErr || !bRows?.length) {
          throw new Error(
            `${tenantLabel} scrape: projects row not found id=${supabaseProjectId}`,
          );
        }
        existingRow = bRows[0];
        const dbPermOk = accelaPermitsEquivalentForTenant(
          permitNumber,
          existingRow.permit_number,
          true,
        ).ok;
        if (!dbPermOk) {
          throw new Error(
            `${tenantLabel} DB permit mismatch projects.id=${supabaseProjectId} dbPermit=${existingRow.permit_number} requested=${permitNumber}`,
          );
        }
      } else {
      if (supabaseProjectId) {
        const { data: rows } = await supabase
          .from("projects")
            .select(selectFields)
          .eq("id", supabaseProjectId);
        existingRow = rows && rows.length > 0 ? rows[0] : null;
      }
      if (!existingRow) {
        const { data: rows } = await supabase
          .from("projects")
            .select(selectFields)
          .eq("permit_number", permitNumber)
          .eq("user_id", userId);
        existingRow = rows && rows.length > 0 ? rows[0] : null;
        }
      }

      if (page._isArlington && portalPayloadForDb) {
        portalPayloadForDb = arlingtonFinalizePortalPayloadBeforeDbSave(
          portalPayloadForDb,
          existingRow?.portal_data ?? null,
          session,
        );
        portalPayloadForDb =
          sanitizeArlingtonPortalDataTabsPlanReviewForDb(portalPayloadForDb);
        arlingtonSyncSessionDataPortalPayload(
          session,
          permitNumber,
          portalPayloadForDb,
        );
      }

      const arlingtonPlanReviewOnlyPersistSplice =
        page._isArlington &&
        arlingtonTabSet &&
        arlingtonTabSet.size === 1 &&
        arlingtonTabSet.has("plan_review");

      if (
        arlingtonPlanReviewOnlyPersistSplice &&
        existingRow?.portal_data &&
        portalDataUtf8ByteLength(portalPayloadForDb) >
          PLAN_REVIEW_LARGE_PAYLOAD_FALLBACK_BYTES
      ) {
        const slimPr =
          portalPayloadForDb.tabs && typeof portalPayloadForDb.tabs === "object"
            ? /** @type {Record<string, unknown>} */ (
                portalPayloadForDb.tabs
              ).planReview
            : null;
        const beforeAll = portalDataUtf8ByteLength(portalPayloadForDb);
        portalPayloadForDb = portalDataArlingtonSpliceMinimalPlanReviewUpdate(
          existingRow.portal_data,
          slimPr ?? {},
        );
        portalPayloadForDb =
          sanitizeArlingtonPortalDataTabsPlanReviewForDb(portalPayloadForDb);
        arlingtonSyncSessionDataPortalPayload(
          session,
          permitNumber,
          portalPayloadForDb,
        );
        console.log(
          `[PortalData] Arlington plan_review-only splice: ${beforeAll}b → ${portalDataUtf8ByteLength(portalPayloadForDb)}b (DB blob + sanitized planReview)`,
        );
      }

      if (
        page._isArlington &&
        existingRow?.portal_data &&
        portalPayloadForDb?.tabs &&
        wantsArlingtonPlanReview
      ) {
        const preserved = arlingtonMaybePreservePlanReviewInPortalPayload(
          portalPayloadForDb,
          existingRow.portal_data,
          { newIntegratedTabsEmpty: arlingtonNewPlanReviewIntegratedEmpty },
        );
        if (preserved) {
          arlingtonSyncSessionDataPortalPayload(
            session,
            permitNumber,
            portalPayloadForDb,
          );
          console.log(
            "[Arlington][PlanReview] session.data synced with preserved planReview for API response",
          );
        }
      }

      const newHash = hashPortalData(portalPayloadForDb);

      const isLegacyBaltimore =
        (page._isBaltimore || page._isFairfax) &&
        existingRow?.portal_data &&
        (existingRow.portal_data.schemaVersion == null || existingRow.portal_data.schemaVersion < 2);
      const forceOverwrite = isLegacyBaltimore;

      if (
        existingRow &&
        existingRow.portal_data_hash === newHash &&
        !forceOverwrite &&
        !(page._isBaltimore || page._isFairfax)
      ) {
        console.log(
          `  ⏭️ Data unchanged (hash match), skipping update for row ${existingRow.id}`,
        );
        await supabase
          .from("projects")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", existingRow.id);
      } else if (existingRow) {
        if (forceOverwrite) {
          const tenantLabel = page._isBaltimore ? "Baltimore" : "Fairfax";
          console.log(
            `  📌 ${tenantLabel}: forcing overwrite for row ${existingRow.id} (legacy schema)`,
          );
        }
        if (page._isBaltimore || page._isFairfax) {
          const tenantLabel = page._isBaltimore ? "Baltimore" : "Fairfax";
          console.log(
            `  📌 ${tenantLabel}: full portal_data replace (attachments rows = this scrape only, no merge) projects.id=${existingRow.id}`,
          );
        }
        const payloadWithMeta = preservePermitPilotMetaOnPortalMerge(
          existingRow.portal_data,
          portalPayloadForDb,
        );
        const canonicalApply = applyScrapeCanonicalAddressToPortalData(
          {
            address: existingRow.address,
            jurisdiction: existingRow.jurisdiction,
            portal_data: existingRow.portal_data,
          },
          payloadWithMeta,
          {
            sourcePortal: payloadWithMeta.portalType || portalPayloadForDb.portalType || null,
            scrapedAt: new Date().toISOString(),
          },
        );
        const updatePayload = {
          portal_status: header.record_status || "Scraped",
          last_checked_at: new Date().toISOString(),
          portal_data: canonicalApply.portalData,
          portal_data_hash: newHash,
          permit_number: permitNumber,
          ...(canonicalApply.projectPatch || {}),
        };

        const { data, error } = await supabase
          .from("projects")
          .update(updatePayload)
          .eq("id", existingRow.id)
          .select("id, portal_data");

        if (error) {
          console.error("  ❌ Supabase error:", error.message);
        } else if (data && data.length > 0) {
          const writtenType = data[0].portal_data?.portalType || "(none)";
          console.log(
            `  ✅ Updated project row=${data[0].id}, written portalType=${writtenType}`,
          );
        }
      } else {
        if (page._isBaltimore || page._isFairfax) {
          const tenantLabel = page._isBaltimore ? "Baltimore" : "Fairfax";
          throw new Error(
            `${tenantLabel} scrape: missing projects row (should have been loaded by id)`,
          );
        }
        const canonicalApply = applyScrapeCanonicalAddressToPortalData(
          null,
          portalPayloadForDb,
          {
            sourcePortal: portalPayloadForDb.portalType || null,
            scrapedAt: new Date().toISOString(),
          },
        );
        const { data: created, error: createError } = await supabase
          .from("projects")
          .insert({
            user_id: userId,
            name: header.record_number || permitNumber,
            permit_number: permitNumber,
            description: header.record_type || "",
            address:
              canonicalApply.projectPatch?.address ||
              canonicalApply.portalData.location ||
              portalPayloadForDb.location ||
              "",
            jurisdiction: portalPayloadForDb.jurisdiction || "Unknown",
            status: "draft",
            portal_status: header.record_status || "Unknown",
            last_checked_at: new Date().toISOString(),
            portal_data: canonicalApply.portalData,
            portal_data_hash: newHash,
          })
          .select("id, portal_data");
        if (createError) {
          console.error("  ❌ Supabase create error:", createError.message);
        } else if (created && created.length > 0) {
          const writtenType = created[0].portal_data?.portalType || "(none)";
          console.log(
            `  📝 Created new project row=${created[0].id}, written portalType=${writtenType}`,
          );
        }
      }

      if (existingRow || supabaseProjectId) {
        const verifyId = existingRow?.id || supabaseProjectId;
        const { data: verify } = await supabase
          .from("projects")
          .select("id, permit_number, credential_id, portal_data")
          .eq("id", verifyId)
          .maybeSingle();
        if (verify) {
          console.log(
            `  🔍 DB verify: row=${verify.id}, permit=${verify.permit_number}, credential=${verify.credential_id || "(none)"}, portalType=${verify.portal_data?.portalType || "(none)"}`,
          );
        }
      }
    }

    const prIframeFailed =
      page._isArlington &&
      session.arlingtonPartialSuccessPlanReviewFailed === true;
    const prPartial =
      page._isArlington &&
      (session.arlingtonPlanReviewPartialPendingDownloads === true ||
        session.arlingtonPlanReviewTimedOutAfterProgress === true ||
        (planReview?.arlingtonPlanReview &&
          (planReview.arlingtonPlanReview.partialPendingDownloads === true ||
            planReview.arlingtonPlanReview.scrapeStatus ===
              "partial_pending_downloads")));
    const attPartial =
      page._isArlington &&
      (session.arlingtonAttachmentsPartialPending === true ||
        session.arlingtonAttachmentsTimedOutAfterProgress === true);
    if (prIframeFailed) {
      console.log(
        `  ⚠️ Accela scrape finished for ${permitNumber} status=partial_success_plan_review_failed`,
      );
    } else if (attPartial) {
      console.log(
        `  ✅ Accela scrape complete for ${permitNumber} status=partial_success_attachments_pending`,
      );
    } else if (prPartial) {
      console.log(
        `  ✅ Accela scrape complete for ${permitNumber} status=partial_pending_downloads`,
      );
    } else {
      console.log(`  ✅ Accela scrape complete for ${permitNumber}`);
    }

    arlingtonSyncSessionDataPortalPayload(
      session,
      permitNumber,
      portalPayloadForDb,
    );

    return portalPayloadForDb;
  } catch (err) {
    throw err;
  } finally {
    if (!hadScrapeActive) {
      session._scrapeActive = false;
      session._activePlanReviewDownloads = 0;
      if (accelaSid) {
        console.log(
          `[Session][scrape] active=false sid=${accelaSid} flow=accela`,
        );
      }
    }
  }
}

/**
 * Baltimore Record Details: grouped div blocks — Work Location, Applicant, Licensed Professional,
 * Project Description, Owner; optional "More Details" expansion.
 */
async function extractBaltimoreRecordDetails(contentFrame) {
  try {
    /* More Details + section expands disabled temporarily (speed) — re-enable when fixed.
    try {
      const moreBtn = await contentFrame.$('text="More Details"');
      if (moreBtn) {
        await moreBtn.click();
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) {}

    const sectionHeadings = [
      "Related Contacts",
      "Application Information",
      "Parcel Information",
      "Planning and Zoning Info",
      "Permit Dates and Internal Use",
      "Trade and Accessory Info",
      "Responsible Parties",
    ];
    for (const heading of sectionHeadings) {
      try {
        const el = await contentFrame.$(`text="${heading}"`);
        if (el) {
          await el.click();
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (e) {}
    }
    */

    const fields = await contentFrame.evaluate(() => {
      const result = {};
      const clean = el => (el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '');
      const allEls = [...document.querySelectorAll('*')];

      // WORK LOCATION
      for (const el of allEls) {
        if (clean(el) === 'Work Location') {
          let sib = el.nextElementSibling;
          for (let i = 0; i < 8; i++) {
            if (!sib) break;
            const t = clean(sib);
            if (t && t.length < 100 && /\d/.test(t) &&
                t.indexOf('function') === -1 && t.indexOf('var ') === -1) {
              result['Work Location'] = t.replace(/\s*\*\s*$/, '').replace(/-+$/, '').trim();
              break;
            }
            sib = sib.nextElementSibling;
          }
          break;
        }
      }

      // NAMED BLOCKS
      const knownLabels = [
        'Applicant', 'Licensed Professional', 'Project Description', 'Owner'
      ];

      for (const label of knownLabels) {
        const candidates = allEls.filter(el => {
          const t = clean(el).replace(/:$/, '');
          return t === label;
        });

        for (const candidate of candidates) {
          const block = candidate.closest('td, li, div[class], p')
                        || candidate.parentElement;
          if (!block) continue;

          let value = clean(block);
          value = value.replace(label + ':', '').replace(label, '').trim();
          value = value.replace(/\s+/g, ' ').trim();

          if (value && value.length > 5 &&
              value.indexOf('< Prev') === -1 &&
              value.indexOf('Additional Results') === -1 &&
              value.indexOf('spell check') === -1 &&
              value.indexOf('function ') === -1 &&
              value.indexOf('var ') === -1 &&
              value.indexOf('__doPostBack') === -1 &&
              value.indexOf('searchWaterMark') === -1) {
            result[label] = value;
            break;
          }
        }
      }

      const moreDetails = {};

      // Related Contacts only (full More Details section loop disabled for speed)
      const relatedHeading = 'Related Contacts';
      const rcHeadingEl = allEls.find(el => {
        const t = (el.innerText || '').trim();
        return (t === relatedHeading || t === relatedHeading + ':') &&
               el.children.length <= 2;
      });
      if (rcHeadingEl) {
        const parent = rcHeadingEl.parentElement;
        if (parent) {
          const sectionData = {};
          const container = parent.nextElementSibling || parent;
          const tables = [...(container.querySelectorAll('table') || [])];

          for (const table of tables) {
            const rows = [...table.querySelectorAll('tr')];
            for (const row of rows) {
              const cells = [...row.querySelectorAll('td, th')];
              if (cells.length === 2) {
                const lbl = (cells[0].innerText || '').trim().replace(/:$/, '');
                const val = (cells[1].innerText || '').trim();
                if (lbl && val && lbl.length < 80 &&
                    lbl.indexOf('function') === -1) {
                  sectionData[lbl] = val;
                }
              } else if (cells.length > 2) {
                const headers = [...table.querySelectorAll('th')].map(
                  thEl => (thEl.innerText || '').trim()
                );
                if (headers.length > 0) {
                  if (!sectionData['_rows']) sectionData['_rows'] = [];
                  const rowObj = {};
                  cells.forEach((td, i) => {
                    const key = headers[i] || ('col_' + i);
                    rowObj[key] = (td.innerText || '').trim();
                  });
                  if (Object.values(rowObj).some(v => v)) {
                    sectionData['_rows'].push(rowObj);
                  }
                }
              }
            }
          }

          const divEls = [...(container.querySelectorAll('div, span, td') || [])];
          for (const el of divEls) {
            const t = (el.innerText || '').trim();
            if (t.endsWith(':') && t.length < 80 && el.children.length === 0) {
              const next = el.nextElementSibling;
              if (next) {
                const val = (next.innerText || '').trim();
                const lbl = t.replace(/:$/, '');
                if (val && val.indexOf('function') === -1 &&
                    val.indexOf('var ') === -1 && !sectionData[lbl]) {
                  sectionData[lbl] = val;
                }
              }
            }
          }

          if (Object.keys(sectionData).length > 0) {
            moreDetails[relatedHeading] = sectionData;
          }
        }
      }

      // Flatten moreDetails into top-level string key/value pairs
      for (const [section, sectionData] of Object.entries(moreDetails)) {
        if (typeof sectionData !== 'object') continue;
        for (const [lbl, val] of Object.entries(sectionData)) {
          if (lbl === '_rows') {
            // Skip row arrays for now — not renderable as simple strings
            continue;
          }
          if (typeof val === 'string' && val.trim()) {
            result[section + ' - ' + lbl] = val.trim();
          }
        }
      }

      return result;
    });

    const count = Object.keys(fields).length;
    console.log('[Baltimore RecordDetails] Extracted ' + count + ' fields');
    return fields;

  } catch(err) {
    console.log('[Baltimore RecordDetails] ERROR:', err.message);
    return {};
  }
}

const ARLINGTON_PLAN_REVIEW_CONTINUE_SCOPES = new Set([
  "allPending",
  "secondary",
  "planSet",
  "reviewResults",
  "approvedDocuments",
]);

const ARLINGTON_PLAN_REVIEW_SCRAPE_SCOPES = new Set([
  "metadataOnly",
  "planSet",
  "reviewResults",
  "approvedDocuments",
  "projectInformation",
  "secondary",
  "all",
]);

/** Scrape + continue download scope normalization (includes projectInformation). */
function arlingtonNormalizePlanReviewActionScope(scope) {
  const s = `${scope || "allPending"}`.trim();
  if (s === "projectInformation" || s === "metadataOnly" || s === "all") {
    return s;
  }
  return arlingtonPlanReviewNormalizeContinueScope(s);
}

/**
 * Apply optional /api/scrape planReviewScope (defaults to tenant profile when omitted).
 * @param {typeof ArlingtonAccelaProfile.planReview} tenantPrCfg
 * @param {{ planReviewScope?: string; planReviewMode?: string; downloadDocuments?: boolean }} downloadCtx
 */
function arlingtonResolveScrapePlanReviewCfg(tenantPrCfg, downloadCtx) {
  const cfg = { ...(tenantPrCfg || {}) };
  let scope =
    downloadCtx && downloadCtx.planReviewScope != null
      ? `${downloadCtx.planReviewScope}`.trim()
      : "";
  if (!scope && downloadCtx?.planReviewMode === "metadataOnly") {
    scope = "metadataOnly";
  }
  if (!scope && downloadCtx?.downloadDocuments === false) {
    scope = "metadataOnly";
  }
  if (!scope || !ARLINGTON_PLAN_REVIEW_SCRAPE_SCOPES.has(scope)) {
    return { prCfg: cfg, downloadScope: null };
  }

  if (scope === "metadataOnly") {
    return {
      prCfg: {
        ...cfg,
        downloadFromIntegratedIframe: false,
        planReviewIncludeSecondaryTabs: true,
        scopePlanSetDocumentsOnly: true,
      },
      downloadScope: "metadataOnly",
    };
  }

  if (scope === "planSet") {
    return {
      prCfg: {
        ...cfg,
        planReviewIncludeSecondaryTabs: false,
        scopePlanSetDocumentsOnly: true,
        downloadFromIntegratedIframe: cfg.downloadFromIntegratedIframe !== false,
      },
      downloadScope: "planSet",
    };
  }

  if (
    scope === "reviewResults" ||
    scope === "approvedDocuments" ||
    scope === "secondary"
  ) {
    return {
      prCfg: {
        ...cfg,
        planReviewIncludeSecondaryTabs: true,
        scopePlanSetDocumentsOnly: true,
        downloadFromIntegratedIframe: cfg.downloadFromIntegratedIframe !== false,
      },
      downloadScope: scope,
    };
  }

  if (scope === "projectInformation") {
    return {
      prCfg: {
        ...cfg,
        planReviewIncludeSecondaryTabs: true,
        scopePlanSetDocumentsOnly: true,
        downloadFromIntegratedIframe: false,
      },
      downloadScope: "projectInformation",
    };
  }

  if (scope === "all") {
    return {
      prCfg: {
        ...cfg,
        planReviewIncludeSecondaryTabs: true,
        scopePlanSetDocumentsOnly: true,
        downloadFromIntegratedIframe: cfg.downloadFromIntegratedIframe !== false,
      },
      downloadScope: "allPending",
    };
  }

  return { prCfg: cfg, downloadScope: null };
}

/** @param {string} [scope] */
function arlingtonPlanReviewNormalizeContinueScope(scope) {
  const s = `${scope || "allPending"}`.trim();
  return ARLINGTON_PLAN_REVIEW_CONTINUE_SCOPES.has(s) ? s : "allPending";
}

/** @param {string} scope @param {string} tabKey */
function arlingtonPlanReviewScopeAllowsSecondaryTab(scope, tabKey) {
  const s = arlingtonNormalizePlanReviewActionScope(scope);
  if (s === "projectInformation") {
    return tabKey === "projectInformation";
  }
  if (tabKey === "projectInformation") {
    return s === "allPending" || s === "all" || s === "secondary";
  }
  if (s === "planSet") return false;
  if (s === "reviewResults") return tabKey === "reviewResultsAndMarkups";
  if (s === "approvedDocuments") return tabKey === "approvedDocuments";
  if (s === "secondary") {
    return (
      tabKey === "reviewResultsAndMarkups" || tabKey === "approvedDocuments"
    );
  }
  return (
    tabKey === "reviewResultsAndMarkups" || tabKey === "approvedDocuments"
  );
}

/** @param {string} scope */
function arlingtonPlanReviewScopeAllowsPlanSet(scope) {
  const s = arlingtonNormalizePlanReviewActionScope(scope);
  if (
    s === "projectInformation" ||
    s === "reviewResults" ||
    s === "approvedDocuments"
  ) {
    return false;
  }
  return s === "allPending" || s === "all" || s === "planSet" || s === "secondary";
}

/** @param {string} scope */
function arlingtonPlanReviewScopeAllowsSecondary(scope) {
  const s = arlingtonNormalizePlanReviewActionScope(scope);
  return (
    s === "allPending" ||
    s === "all" ||
    s === "secondary" ||
    s === "reviewResults" ||
    s === "approvedDocuments" ||
    s === "projectInformation"
  );
}

/**
 * @param {Record<string, unknown> | null | undefined} portalData
 * @returns {Record<string, unknown> | null}
 */
function arlingtonPlanReviewHydrateIntegratedTabsFromPortalData(portalData) {
  const prTab = portalData?.tabs?.planReview;
  const tabs = prTab?.tabs;
  if (!tabs || typeof tabs !== "object" || Array.isArray(tabs)) return null;
  const hasStructure =
    tabs.plansAndDocuments != null ||
    tabs.reviewResultsAndMarkups != null ||
    tabs.approvedDocuments != null;
  if (!hasStructure) return null;
  return structuredCloneWorksSafe(
    /** @type {Record<string, unknown>} */ (tabs),
  );
}

/**
 * @param {Record<string, unknown>} integratedTabs
 */
function arlingtonPlanReviewCountSourceStats(integratedTabs) {
  /** @param {unknown[] | undefined} docs */
  const countDocs = (docs) => {
    const list = Array.isArray(docs) ? docs : [];
    let downloaded = 0;
    let pending = 0;
    for (const d of list) {
      if (arlingtonPlanReviewDocLooksDownloadComplete(d)) downloaded++;
      else pending++;
    }
    return { total: list.length, downloaded, pending };
  };
  const ps =
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  const rr = integratedTabs?.reviewResultsAndMarkups?.documents;
  const ad = integratedTabs?.approvedDocuments?.documents;
  const psC = countDocs(Array.isArray(ps) ? ps : []);
  const rrC = countDocs(Array.isArray(rr) ? rr : []);
  const adC = countDocs(Array.isArray(ad) ? ad : []);
  return {
    planSetTotal: psC.total,
    planSetDownloaded: psC.downloaded,
    planSetPending: psC.pending,
    reviewResultsTotal: rrC.total,
    reviewResultsDownloaded: rrC.downloaded,
    reviewResultsPending: rrC.pending,
    approvedTotal: adC.total,
    approvedDownloaded: adC.downloaded,
    approvedPending: adC.pending,
  };
}

/**
 * @param {Record<string, unknown>} integratedTabs
 * @param {Record<string, unknown> | null | undefined} dc
 * @param {string} scope
 * @param {string} permitNumber
 * @param {string} projectId
 */
function arlingtonPlanReviewBuildContinueResponse(
  integratedTabs,
  dc,
  scope,
  permitNumber,
  projectId,
) {
  const scopeNorm = arlingtonPlanReviewNormalizeContinueScope(scope);
  const stats = arlingtonPlanReviewCountSourceStats(integratedTabs);
  const pendingByReason = arlingtonPlanReviewPendingByReason(
    integratedTabs,
    scopeNorm,
  );
  const pendingTotal = Object.values(pendingByReason).reduce((a, b) => a + b, 0);
  const downloadedThisRun = Number(dc?.planReviewDownloadsSucceededThisRun) || 0;
  const attemptedThisRun = Number(dc?.planReviewDownloadsAttemptedThisRun) || 0;
  const skippedAlreadyDownloaded =
    Number(dc?.planReviewSkippedAlreadyDownloadedThisRun) || 0;
  const stoppedReason =
    `${dc?.planReviewStoppedReason || ""}`.trim() ||
    (pendingTotal > 0 ? "pending_remain" : "complete");
  let status = "complete";
  if (pendingTotal > 0) {
    status =
      downloadedThisRun > 0
        ? "partial_success_plan_review_pending"
        : "partial_success_no_downloads";
  }
  return {
    status,
    scope: scopeNorm,
    permitNumber,
    projectId,
    ...stats,
    downloadedThisRun,
    attemptedThisRun,
    skippedAlreadyDownloaded,
    pendingByReason,
    stoppedReason,
    nextRecommendedScope: arlingtonPlanReviewNextRecommendedScope(
      integratedTabs,
      dc,
    ),
  };
}

/** @param {string} [planReviewScope] Scrape or continue scope label. */
function arlingtonPlanReviewScopeSupportsAutoContinue(planReviewScope) {
  const raw = `${planReviewScope || ""}`.trim();
  if (!raw || raw === "projectInformation" || raw === "metadataOnly") {
    return false;
  }
  if (raw === "all" || raw === "allPending") return true;
  const norm = arlingtonNormalizePlanReviewActionScope(raw);
  return (
    norm === "allPending" ||
    norm === "planSet" ||
    norm === "reviewResults" ||
    norm === "approvedDocuments" ||
    norm === "secondary"
  );
}

/** @param {string} [planReviewScope] */
function arlingtonPlanReviewMapScrapeScopeToContinueScope(planReviewScope) {
  const raw = `${planReviewScope || ""}`.trim();
  if (raw === "all") return "allPending";
  return arlingtonPlanReviewNormalizeContinueScope(raw);
}

/** @param {Record<string, number>} pendingByReason */
function arlingtonPlanReviewOnlyNonRetryablePendingRemain(pendingByReason) {
  const entries = Object.entries(pendingByReason || {}).filter(
    ([, n]) => Number(n) > 0,
  );
  if (entries.length === 0) return false;
  return entries.every(([key]) => {
    const k = `${key}`.trim().toLowerCase();
    return (
      k === "failed_non_retryable" ||
      k === "duplicate_skipped" ||
      k === "already_downloaded" ||
      k.includes("non_retryable") ||
      k.includes("unavailable") ||
      k === "pending_tab_not_resolved" ||
      k === "pending_token_missing" ||
      k === "metadata_only"
    );
  });
}

/** @param {Record<string, number>} pendingByReason */
function arlingtonPlanReviewPendingCount(pendingByReason) {
  return Object.values(pendingByReason || {}).reduce(
    (a, b) => a + (Number(b) || 0),
    0,
  );
}

/** @param {Record<string, unknown>} session */
function arlingtonPlanReviewSessionIsUsable(session) {
  try {
    return !!(
      session?.page &&
      session?.browser &&
      typeof session.browser.isConnected === "function" &&
      session.browser.isConnected()
    );
  } catch (_) {
    return false;
  }
}

/**
 * In-process auto-continue loop after initial Arlington Plan Review scrape phase.
 * @param {object} opts
 */
async function runArlingtonPlanReviewAutoContinueLoop(opts) {
  const {
    session,
    projectId,
    userId,
    permitNumber,
    scope,
    maxCycles = 8,
    delayMs = 2000,
    maxNoProgressCycles = 2,
    supabase,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
    initialResultOrStats,
  } = opts;

  const logP = "[Arlington][PlanReview][AutoContinue]";
  const scopeNorm = arlingtonPlanReviewNormalizeContinueScope(scope);
  const permit = `${permitNumber || ""}`.trim();
  const projId = `${projectId || ""}`.trim();

  if (!arlingtonPlanReviewScopeSupportsAutoContinue(scope)) {
    console.log(`${logP} skipped scope=${scopeNorm} (not a document auto-continue scope)`);
    return {
      stoppedReason: "scope_not_supported",
      cycles: 0,
      pending: 0,
      finalStatus: "complete",
    };
  }

  if (!arlingtonPlanReviewSessionIsUsable(session)) {
    console.log(`${logP} stopping reason=session_invalid cycles=0 pending=?`);
    return {
      stoppedReason: "session_invalid",
      cycles: 0,
      pending: 0,
      finalStatus: "partial_success_plan_review_pending",
    };
  }

  console.log(
    `${logP} enabled scope=${scopeNorm} maxCycles=${maxCycles}`,
  );

  let cycle = 0;
  let noProgressCycles = 0;
  /** @type {Record<string, unknown>|null} */
  let lastResult =
    initialResultOrStats && typeof initialResultOrStats === "object"
      ? initialResultOrStats
      : null;
  let stoppedReason = "complete";
  let finalStatus = "complete";

  const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

  while (cycle < maxCycles) {
    let cancelHit = !!session._cancelRequested;
    if (!cancelHit && session._scrapeJobId && supabase) {
      try {
        const { shouldAbort } = require("./lib/scrape-job-cancellation.js");
        cancelHit = await shouldAbort(session, supabase);
      } catch (_) {}
    }
    if (cancelHit) {
      session._cancelRequested = true;
      stoppedReason = "cancelled";
      finalStatus = "partial_success_plan_review_pending";
      break;
    }

    if (!arlingtonPlanReviewSessionIsUsable(session)) {
      stoppedReason = "session_invalid";
      finalStatus = "partial_success_plan_review_pending";
      break;
    }

    const pendingBefore = lastResult?.pendingByReason
      ? arlingtonPlanReviewPendingCount(
          /** @type {Record<string, number>} */ (lastResult.pendingByReason),
        )
      : null;

    console.log(
      `${logP} cycle=${cycle + 1} pendingBefore=${pendingBefore != null ? pendingBefore : "?"}`,
    );

    if (pendingBefore === 0 && (cycle > 0 || lastResult)) {
      stoppedReason = "complete";
      finalStatus = "complete";
      session.arlingtonPlanReviewPartialPendingDownloads = false;
      break;
    }

    if (cycle > 0) {
      mirrorSessionProgress(session, `${permit} → Continuing pending Plan Review downloads automatically...`);
      await sleep(delayMs);
    }

    let result;
    try {
      result = await continueArlingtonPlanReviewDownloads(session, {
        projectId: projId,
        permitNumber: permit,
        userId,
        supabase,
        hashPortalData,
        uploadToSupabaseStorage,
        sanitizeStorageKey,
        scope: scopeNorm,
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/browser|page|session|not available|not found/i.test(msg)) {
        stoppedReason = "session_invalid";
      } else if (/auth|login|sign in|navigation|Plan Review tab/i.test(msg)) {
        stoppedReason = "auth_or_navigation_failure";
        finalStatus = "failed";
      } else {
        stoppedReason = "error";
        finalStatus = "partial_success_plan_review_pending";
      }
      console.log(
        `${logP} stopping reason=${stoppedReason} cycles=${cycle + 1} pending=?`,
      );
      session.arlingtonPlanReviewPartialPendingDownloads = true;
      return {
        stoppedReason,
        cycles: cycle + 1,
        pending: pendingBefore ?? 0,
        finalStatus,
        error: msg,
      };
    }

    lastResult = result;
    const pendingAfter = arlingtonPlanReviewPendingCount(result.pendingByReason);
    const downloaded = Number(result.downloadedThisRun) || 0;
    const attempted = Number(result.attemptedThisRun) || 0;

    console.log(
      `${logP} cycle=${cycle + 1} downloadedThisRun=${downloaded} attemptedThisRun=${attempted} pendingAfter=${pendingAfter} status=${result.status}`,
    );

    if (result.status === "complete" || pendingAfter === 0) {
      stoppedReason = "complete";
      finalStatus = "complete";
      session.arlingtonPlanReviewPartialPendingDownloads = false;
      break;
    }

    if (downloaded > 0 || attempted > 0) {
      noProgressCycles = 0;
    } else {
      noProgressCycles += 1;
    }

    if (noProgressCycles >= maxNoProgressCycles) {
      stoppedReason = "no_progress";
      finalStatus = "partial_success_plan_review_pending";
      session.arlingtonPlanReviewPartialPendingDownloads = true;
      break;
    }

    if (arlingtonPlanReviewOnlyNonRetryablePendingRemain(result.pendingByReason)) {
      stoppedReason = "only_non_retryable_remaining";
      finalStatus = "partial_success_plan_review_pending";
      session.arlingtonPlanReviewPartialPendingDownloads = true;
      break;
    }

    if (cycle + 1 >= maxCycles) {
      stoppedReason = "max_cycles";
      finalStatus = "partial_success_plan_review_pending";
      session.arlingtonPlanReviewPartialPendingDownloads = true;
      break;
    }

    finalStatus =
      result.status === "partial_success_no_downloads"
        ? "partial_success_no_downloads"
        : "partial_success_plan_review_pending";
    session.arlingtonPlanReviewPartialPendingDownloads = true;
    session.arlingtonPlanReviewCheckpointSaved = true;

    cycle += 1;
  }

  const pendingEnd = lastResult?.pendingByReason
    ? arlingtonPlanReviewPendingCount(
        /** @type {Record<string, number>} */ (lastResult.pendingByReason),
      )
    : 0;

  console.log(
    `${logP} stopping reason=${stoppedReason} cycles=${cycle + (lastResult ? 1 : 0)} pending=${pendingEnd}`,
  );

  if (finalStatus === "complete") {
    session.arlingtonPlanReviewPartialPendingDownloads = false;
  }

  return {
    stoppedReason,
    cycles: cycle + (lastResult ? 1 : 0),
    pending: pendingEnd,
    finalStatus,
    lastResult,
  };
}

/**
 * @param {object} opts
 * @returns {Promise<{ planSetDomDownloads: number }>}
 */
async function runArlingtonPlanReviewContinueDownloadPhases(opts) {
  const {
    page,
    domTarget,
    integratedTabs,
    sharedGridCtx,
    sink,
    attachmentDedupeKeys,
    prSeenRowKeys,
    downloadedHashes,
    planSetErmsOrigin,
    downloadCtx,
    scope,
    logPrefix = "[Arlington][PlanReview][Continue]",
  } = opts;

  let planSetDomDownloads = 0;
  if (!sharedGridCtx) return { planSetDomDownloads };

  const scopeNorm = arlingtonPlanReviewNormalizeContinueScope(scope);
  arlingtonPlanReviewInitDownloadManager(sharedGridCtx, {
    continueRun: true,
    logPrefix,
  });
  arlingtonPlanReviewLogDownloadQueueStart(
    integratedTabs,
    sharedGridCtx,
    logPrefix,
  );

  if (arlingtonPlanReviewScopeAllowsSecondary(scopeNorm)) {
    await runArlingtonSecondaryTabsDownloadPhase({
      page,
      domTarget,
      integratedTabs,
      sharedGridCtx,
      attachmentDedupeKeys,
      prSeenRowKeys,
      downloadedHashes,
      planSetErmsOrigin,
      downloadCtx,
      scope: scopeNorm,
      logPrefix,
    });
  }

  if (
    arlingtonPlanReviewScopeAllowsPlanSet(scopeNorm) &&
    !sharedGridCtx.planReviewDownloadsAbortedDeadline &&
    Array.isArray(sink) &&
    sink.length
  ) {
    const psArr = sink;
    const pendingPs = psArr.filter(
      (d) => !arlingtonErmsSinkDocLooksUploadComplete(d),
    ).length;
    console.log(
      `${logPrefix} source=planSet total=${psArr.length} pending=${pendingPs} downloaded=${psArr.length - pendingPs}`,
    );

    await clickArlingtonPlanReviewSubTab(page, "Plans & Documents");
    await page.waitForTimeout(650).catch(() => {});
    await clickArlingtonIntegratedNestedTab(page, "Plan Set Documents").catch(
      () => false,
    );
    await page.waitForTimeout(650).catch(() => {});

    const refreshed = await waitForArlingtonPlanReviewIframeReady(page, 30000);
    const dlTarget = refreshed || domTarget;

    planSetDomDownloads = await downloadArlingtonPlanSetDocumentsForSink(
      page,
      dlTarget,
      sink,
      {
        attachmentDedupeKeys,
        prSeenRowKeys,
        downloadedHashes,
        downloadCtx: sharedGridCtx,
        ermsOrigin: planSetErmsOrigin,
        downloadSource: "planSet",
      },
    );
    console.log(
      `${logPrefix} Plan Set Documents rows=${sink.length} downloads=${planSetDomDownloads}`,
    );
  }

  arlingtonPlanReviewFinalizeRunStats(
    integratedTabs,
    sharedGridCtx,
    downloadCtx,
  );

  const saver = sharedGridCtx.savePlanReviewCheckpoint;
  if (typeof saver === "function") {
    await saver("continueDownloadsEnd", {
      downloaded: Number(sharedGridCtx.planReviewDownloadsSucceededThisRun) || 0,
      pending: arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(
        integratedTabs,
      ),
      scope: scopeNorm,
    }).catch(() => {});
    arlingtonPlanReviewMarkCheckpointSaved(sharedGridCtx);
  }

  return { planSetDomDownloads };
}

/**
 * Resume pending Arlington Plan Review downloads from saved portal_data/checkpoint.
 * @param {Record<string, unknown>} session
 */
async function continueArlingtonPlanReviewDownloads(
  session,
  {
    projectId,
    permitNumber,
    userId,
    supabase,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
    scope: scopeRaw,
    workerCycleDeadlineMs,
  },
) {
  const scope = arlingtonPlanReviewNormalizeContinueScope(scopeRaw);
  const logPrefix = "[Arlington][PlanReview][Continue]";
  const permit = `${permitNumber || ""}`.trim();
  const projId = `${projectId || ""}`.trim();

  console.log(
    `${logPrefix} start permit=${permit} projectId=${projId || "(none)"} scope=${scope}`,
  );

  const page = session.page;
  if (!page || !session.browser || !session.browser.isConnected()) {
    throw new Error("Session browser or page is not available");
  }

  const portalUrlStr = `${session.portalUrl || ""}`;
  if (!portalUrlStr.toUpperCase().includes("ARLINGTONCO")) {
    throw new Error("Continue Plan Review downloads requires an Arlington Accela session");
  }

  page._isArlington = true;

  if (!userId || !supabase || typeof hashPortalData !== "function") {
    throw new Error("userId, supabase, and hashPortalData are required");
  }

  const selectFields = "id, portal_data, permit_number, user_id";
  let portalData = null;
  if (projId) {
    const { data: rows } = await supabase
      .from("projects")
      .select(selectFields)
      .eq("id", projId)
      .limit(1);
    portalData = rows?.[0]?.portal_data ?? null;
  }
  if (!portalData && permit) {
    const { data: rows } = await supabase
      .from("projects")
      .select(selectFields)
      .eq("permit_number", permit)
      .eq("user_id", userId)
      .limit(1);
    portalData = rows?.[0]?.portal_data ?? null;
  }

  const integratedTabs =
    arlingtonPlanReviewHydrateIntegratedTabsFromPortalData(portalData);
  if (!integratedTabs) {
    throw new Error(
      "Saved Plan Review metadata is missing or unusable — run a normal scrape with plan_review first",
    );
  }

  const priorPortal =
    portalData && typeof portalData === "object"
      ? structuredCloneWorksSafe(portalData)
      : null;

  arlingtonResumePlanReviewDownloadsFromPrior(
    integratedTabs,
    priorPortal,
    true,
    {
      forceRetryOversized:
        session.arlingtonPlanReviewRetryOversizedDownloads === true ||
        arlingtonEnvForceRetryOversizedPlanReviewDownloads(),
      configuredMaxUploadBytes: getSupabaseStorageObjectMaxBytes(),
    },
  );

  const attachmentDedupeKeys = new Set();
  const prSeenRowKeys = new Set();
  const downloadedHashes =
    session._downloadedHashes instanceof Map
      ? session._downloadedHashes
      : new Map();

  const pathMod = require("path");
  const fsMod = require("fs");
  const DOWNLOADS_ROOT = pathMod.join(__dirname, "downloads");
  if (!fsMod.existsSync(DOWNLOADS_ROOT)) {
    fsMod.mkdirSync(DOWNLOADS_ROOT, { recursive: true });
  }

  const wallStart = Date.now();
  const scrapeDeadlineMs =
    workerCycleDeadlineMs ||
    wallStart + ARLINGTON_PLAN_REVIEW_CONTINUE_WALL_MS;

  /** @type {string|null} */
  let screenshotBase64 = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  screenshotBase64 = screenshotBase64
    ? screenshotBase64.toString("base64")
    : null;

  const sink =
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments
      ?.documents || [];

  const downloadCtx = {
    DOWNLOADS_DIR: DOWNLOADS_ROOT,
    supabaseProjectId: projId,
    uploadFn: uploadToSupabaseStorage,
    sanitizeFn: sanitizeStorageKey,
    downloadedHashes,
    attachmentRows: [],
    permitNumber: permit,
    priorPortalData: priorPortal,
    supabase,
    userId,
    hashPortalData,
    scrapeDeadlineMs,
    reserveMsForFinalSave: ARLINGTON_PLAN_REVIEW_RESUME_RESERVE_FINAL_SAVE_MS,
    touchSessionKeepalive:
      typeof session.touchSessionKeepalive === "function"
        ? session.touchSessionKeepalive.bind(session)
        : null,
    _arlingtonSession: session,
    forceRetryOversizedDownloads:
      session.arlingtonPlanReviewRetryOversizedDownloads === true,
  };

  const sharedGridCtx = {
    DOWNLOADS_DIR: DOWNLOADS_ROOT,
    supabaseProjectId: projId,
    permitNumber: permit,
    uploadFn: uploadToSupabaseStorage,
    sanitizeFn: sanitizeStorageKey,
    downloadedHashes,
    supabaseStorageObjectMaxBytes: getSupabaseStorageObjectMaxBytes(),
    forceRetryOversizedDownloads:
      downloadCtx.forceRetryOversizedDownloads === true,
    planReviewIntegratedTabs: integratedTabs,
    touchSessionKeepalive: downloadCtx.touchSessionKeepalive,
    _arlingtonSession: session,
    ermsVerificationToken: "",
    scrapeDeadlineMs,
    reserveMsForFinalSave: ARLINGTON_PLAN_REVIEW_RESUME_RESERVE_FINAL_SAVE_MS,
    planReviewDownloadsSinceCheckpoint: 0,
    planReviewDownloadsAbortedDeadline: false,
    planReviewPartialPendingDownloads: false,
    planReviewDownloadsAttemptedThisRun: 0,
  };

  const runPlanReviewPersistCheckpoint = async (
    phase,
    /** @type {Record<string, unknown>} */ extra,
  ) => {
    const inc =
      arlingtonCountPlanReviewIncompleteDocsAcrossIntegratedTabs(integratedTabs);
    const partial =
      inc > 0 ||
      sharedGridCtx.planReviewDownloadsAbortedDeadline === true ||
      sharedGridCtx.planReviewPartialPendingDownloads === true;
    const slice = buildArlingtonPlanReviewCheckpointTabSlice({
      integratedTabs,
      screenshotBase64,
      combinedText:
        typeof extra.text === "string"
          ? `${extra.text}`
          : `[Arlington][PlanReview][Continue] checkpoint phase=${phase}`,
      partialPendingDownloads: partial,
      scrapeStatus: partial ? "partial_pending_downloads" : undefined,
    });
    await persistArlingtonPlanReviewCheckpoint({
      supabase,
      userId,
      supabaseProjectId: projId,
      permitNumber: permit,
      hashPortalData,
      planReviewTabPayload: slice,
      selectiveScope: scope || undefined,
    });
    arlingtonPlanReviewMarkCheckpointSaved(sharedGridCtx);
    arlingtonPlanReviewMarkCheckpointSaved(downloadCtx);
  };

  sharedGridCtx.savePlanReviewCheckpoint = async (phaseTag, xs) => {
    const x =
      xs && typeof xs === "object" && !Array.isArray(xs)
        ? /** @type {Record<string, unknown>} */ (xs)
        : {};
    await runPlanReviewPersistCheckpoint(String(phaseTag || ""), x);
  };

  await runPlanReviewPersistCheckpoint("continueHydrate", {}).catch(() => {});

  if (!isArlingtonCapDetailPage(page)) {
    mirrorSessionProgress(session, `${permit} → Searching...`);
    await searchPermit(page, portalUrlStr, permit);
  }

  await ensureArlingtonRecordInfoActive(page);

  const prActivate = await ensureArlingtonPlanReviewActive(page);
  if (!prActivate.ok) {
    throw new Error("Plan Review tab not found on Accela record");
  }

  await page.waitForTimeout(1200).catch(() => {});
  await waitForAccelaLoad(page).catch(() => {});

  const prFrame =
    (await waitForArlingtonPlanReviewErmsShellReady(page, 60000)) ||
    (await waitForArlingtonPlanReviewIframeReady(page, 45000));
  if (!prFrame) {
    throw new Error("Plan Review ERMS iframe not ready");
  }

  await dismissBlockingModalsInArlingtonPlanReviewFrame(prFrame);

  let planSetErmsOrigin = "";
  try {
    planSetErmsOrigin = new URL(prFrame.url()).origin;
  } catch (_) {
    /**/
  }

  try {
    if (arlingtonPlanReviewScopeAllowsPlanSet(scope)) {
      await arlingtonRefreshPlanSetMetadataFromPortalFrame(
        page,
        prFrame,
        integratedTabs,
        priorPortal,
        permit,
      );
      arlingtonResumePlanReviewDownloadsFromPrior(
        integratedTabs,
        priorPortal,
        true,
        {
          forceRetryOversized:
            session.arlingtonPlanReviewRetryOversizedDownloads === true ||
            arlingtonEnvForceRetryOversizedPlanReviewDownloads(),
          configuredMaxUploadBytes: getSupabaseStorageObjectMaxBytes(),
        },
        scope,
      );
      await runPlanReviewPersistCheckpoint("continuePlanSetRefresh", {}).catch(
        () => {},
      );
    }

    await runArlingtonPlanReviewContinueDownloadPhases({
      page,
      domTarget: prFrame,
      integratedTabs,
      sharedGridCtx,
      sink,
      attachmentDedupeKeys,
      prSeenRowKeys,
      downloadedHashes,
      planSetErmsOrigin,
      downloadCtx,
      scope,
      logPrefix,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(`${logPrefix} error during download phases: ${msg}`);
    await runPlanReviewPersistCheckpoint("continueError", { text: msg }).catch(
      () => {},
    );
    throw err;
  }

  const response = arlingtonPlanReviewBuildContinueResponse(
    integratedTabs,
    sharedGridCtx,
    scope,
    permit,
    projId,
  );

  const pendingTotal = Object.values(response.pendingByReason).reduce(
    (a, b) => a + b,
    0,
  );
  console.log(
    `${logPrefix} stopping reason=${response.stoppedReason} downloadedThisRun=${response.downloadedThisRun} pending=${pendingTotal}`,
  );
  console.log(
    `${logPrefix} status=${response.status} pending=${pendingTotal} pendingByReason=${JSON.stringify(response.pendingByReason)} nextRecommendedScope=${response.nextRecommendedScope}`,
  );

  if (response.status === "partial_success_plan_review_pending") {
    session.arlingtonPlanReviewPartialPendingDownloads = true;
    session.arlingtonPlanReviewCheckpointSaved = true;
  } else if (response.status === "complete") {
    session.arlingtonPlanReviewPartialPendingDownloads = false;
  }

  return response;
}

/** True when Accela still shows login/MFA — human completion required. */
async function detectAccelaHumanLoginRequired(page) {
  if (!page) return true;
  try {
    const url = `${page.url() || ""}`;
    if (/Login\.aspx/i.test(url)) return true;
    const loginFrame = await findLoginFrame(page).catch(() => null);
    /** @type {(import("playwright").Page | import("playwright").Frame)[]} */
    const contexts = loginFrame ? [loginFrame, page] : [page];
    for (const ctx of contexts) {
      const pass = await ctx.$('input[type="password"]').catch(() => null);
      if (pass && (await pass.isVisible().catch(() => false))) return true;
    }
  } catch (_) {
    return true;
  }
  return false;
}

/** @param {Record<string, unknown> | null | undefined} session */
function arlingtonPlanReviewSessionBrowserUsable(session) {
  if (!session || typeof session !== "object") return false;
  if (session.portalType !== "accela") return false;
  const portalUrl = `${session.portalUrl || session.dashboardUrl || ""}`;
  if (!portalUrl.toUpperCase().includes("ARLINGTONCO")) return false;
  if (!session.browser || !session.page) return false;
  try {
    if (
      typeof session.browser.isConnected === "function" &&
      !session.browser.isConnected()
    ) {
      return false;
    }
  } catch (_) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} integratedTabs
 * @returns {{ planSetPending: number; reviewResultsPending: number; approvedPending: number; skippedAlreadyDownloaded: number }}
 */
function arlingtonPlanReviewCountResumeQueueFromIntegratedTabs(integratedTabs) {
  /** @param {unknown[] | undefined} docs */
  const tally = (docs) => {
    let pending = 0;
    let skipped = 0;
    for (const doc of Array.isArray(docs) ? docs : []) {
      if (arlingtonPlanReviewDocLooksDownloadComplete(doc)) {
        skipped++;
      } else if (arlingtonPlanReviewDocNeedsDownloadAttempt(doc)) {
        pending++;
      }
    }
    return { pending, skipped };
  };
  const ps =
    integratedTabs?.plansAndDocuments?.sections?.planSetDocuments?.documents;
  const rr = integratedTabs?.reviewResultsAndMarkups?.documents;
  const ad = integratedTabs?.approvedDocuments?.documents;
  const psT = tally(Array.isArray(ps) ? ps : []);
  const rrT = tally(Array.isArray(rr) ? rr : []);
  const adT = tally(Array.isArray(ad) ? ad : []);
  return {
    planSetPending: psT.pending,
    reviewResultsPending: rrT.pending,
    approvedPending: adT.pending,
    skippedAlreadyDownloaded: psT.skipped + rrT.skipped + adT.skipped,
  };
}

/**
 * Pending-only Plan Review download resume (scope=allPending). Session must be ready.
 * @param {Record<string, unknown>} session
 */
async function resumeArlingtonPlanReviewPendingDownloads(
  session,
  {
    projectId,
    permitNumber,
    userId,
    supabase,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
  },
) {
  const logP = "[Arlington][PlanReview][Resume]";
  console.log(`${logP} requested pending-only resume`);

  const permit = `${permitNumber || ""}`.trim();
  const projId = `${projectId || ""}`.trim();

  let portalData = null;
  if (projId && supabase) {
    const { data: rows } = await supabase
      .from("projects")
      .select("id, portal_data, permit_number, user_id")
      .eq("id", projId)
      .limit(1);
    portalData = rows?.[0]?.portal_data ?? null;
  }
  if (!portalData && permit && supabase && userId) {
    const { data: rows } = await supabase
      .from("projects")
      .select("id, portal_data, permit_number, user_id")
      .eq("permit_number", permit)
      .eq("user_id", userId)
      .limit(1);
    portalData = rows?.[0]?.portal_data ?? null;
  }

  const integratedTabs =
    arlingtonPlanReviewHydrateIntegratedTabsFromPortalData(portalData);
  if (integratedTabs) {
    const q = arlingtonPlanReviewCountResumeQueueFromIntegratedTabs(integratedTabs);
    console.log(
      `${logP} queue pending planSet=${q.planSetPending} reviewResults=${q.reviewResultsPending} approved=${q.approvedPending}`,
    );
    console.log(`${logP} skipped alreadyDownloaded=${q.skippedAlreadyDownloaded}`);
  } else {
    console.log(`${logP} queue pending planSet=? reviewResults=? approved=? (no saved metadata)`);
  }

  const result = await continueArlingtonPlanReviewDownloads(session, {
    projectId: projId,
    permitNumber: permit,
    userId,
    supabase,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
    scope: "allPending",
  });

  const pendingAfter =
    (Number(result.planSetPending) || 0) +
    (Number(result.reviewResultsPending) || 0) +
    (Number(result.approvedPending) || 0);

  console.log(
    `${logP} complete pending=${pendingAfter} downloadedThisRun=${result.downloadedThisRun ?? 0}`,
  );

  return result;
}

function arlingtonAttachmentsBuildContinueResponse(rows, dc, permitNumber, projectId) {
  const list = Array.isArray(rows) ? rows : [];
  const totals = arlingtonCountAttachmentQueueTotals(list);
  const pendingByReason = arlingtonAttachmentPendingByReason(list);
  const pendingTotal = arlingtonAttachmentPendingCount(pendingByReason);
  const downloadedThisRun = Number(dc?.attachmentsDownloadsSucceededThisRun) || 0;
  const attemptedThisRun = Number(dc?.attachmentsDownloadsAttemptedThisRun) || 0;
  const stoppedReason =
    `${dc?.attachmentsStoppedReason || ""}`.trim() ||
    (pendingTotal > 0 ? "pending_remain" : "complete");
  let status = "complete";
  if (pendingTotal > 0) {
    status =
      downloadedThisRun > 0
        ? "partial_success_attachments_pending"
        : "partial_success_no_downloads";
  }
  return {
    status,
    permitNumber,
    projectId,
    found: totals.total,
    downloaded: totals.alreadyDownloaded,
    pending: pendingTotal,
    downloadedThisRun,
    attemptedThisRun,
    pendingByReason,
    stoppedReason,
  };
}

/**
 * Resume pending Arlington Attachments downloads from saved portal_data/checkpoint.
 */
async function continueArlingtonAttachmentsDownloads(
  session,
  {
    projectId,
    permitNumber,
    userId,
    supabase,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
    workerCycleDeadlineMs,
    isCancelRequested,
  },
) {
  const logPrefix = "[Arlington][Attachments][Continue]";
  const permit = `${permitNumber || ""}`.trim();
  const projId = `${projectId || ""}`.trim();

  console.log(
    `${logPrefix} start permit=${permit} projectId=${projId || "(none)"}`,
  );

  const page = session.page;
  if (!page || !session.browser || !session.browser.isConnected()) {
    throw new Error("Session browser or page is not available");
  }

  const portalUrlStr = `${session.portalUrl || ""}`;
  if (!portalUrlStr.toUpperCase().includes("ARLINGTONCO")) {
    throw new Error("Continue Attachments downloads requires an Arlington Accela session");
  }

  page._isArlington = true;

  if (!userId || !supabase || typeof hashPortalData !== "function") {
    throw new Error("userId, supabase, and hashPortalData are required");
  }

  let portalData = null;
  if (projId) {
    const { data: row } = await supabase
      .from("projects")
      .select("portal_data")
      .eq("id", projId)
      .maybeSingle();
    portalData = row?.portal_data ?? null;
  }
  if (!portalData) {
    const { data: rows } = await supabase
      .from("projects")
      .select("portal_data")
      .eq("permit_number", permit)
      .eq("user_id", userId)
      .limit(1);
    portalData = rows?.[0]?.portal_data ?? null;
  }

  const priorRows = arlingtonPriorAttachmentRowsFromPortalData(portalData);
  if (!priorRows.length) {
    throw new Error("No attachment metadata in portal_data — run Attachments scrape first");
  }

  if (!isArlingtonCapDetailPage(page)) {
    mirrorSessionProgress(session, `${permit} → Searching...`);
    await searchPermit(page, portalUrlStr, permit);
  }

  const frame = await ensureArlingtonAttachmentsLoaded(page);
  if (!frame) {
    throw new Error("Attachments iframe not ready");
  }

  const DOWNLOADS_ROOT = path.join(__dirname, "downloads");
  if (!fs.existsSync(DOWNLOADS_ROOT)) {
    fs.mkdirSync(DOWNLOADS_ROOT, { recursive: true });
  }

  const downloadCtx = {
    DOWNLOADS_DIR: DOWNLOADS_ROOT,
    supabaseProjectId: projId,
    uploadFn: uploadToSupabaseStorage,
    sanitizeFn: sanitizeStorageKey,
    permitNumber: permit,
    priorPortalData: portalData,
    supabase,
    userId,
    hashPortalData,
    workerCycleDeadlineMs,
    scrapeDeadlineMs:
      workerCycleDeadlineMs ||
      Date.now() + ARLINGTON_ATTACHMENTS_CONTINUE_WALL_MS,
    reserveMsForFinalSave: ARLINGTON_ATTACHMENTS_RESUME_RESERVE_FINAL_SAVE_MS,
    touchSessionKeepalive:
      typeof session.touchSessionKeepalive === "function"
        ? session.touchSessionKeepalive.bind(session)
        : null,
    _arlingtonSession: session,
    continueRun: true,
    skipMetadataScan: true,
    attachmentsFromPortal: priorRows,
    isCancelRequested,
  };

  const arResult = await runArlingtonAttachmentsResumableLifecycle(
    page,
    session,
    frame,
    downloadCtx,
  );

  const response = arlingtonAttachmentsBuildContinueResponse(
    arResult.attachments,
    downloadCtx,
    permit,
    projId,
  );

  console.log(
    `${logPrefix} status=${response.status} pending=${response.pending} downloadedThisRun=${response.downloadedThisRun}`,
  );

  if (response.status === "partial_success_attachments_pending") {
    session.arlingtonAttachmentsPartialPending = true;
    session.arlingtonAttachmentsCheckpointSaved = true;
  } else if (response.status === "complete") {
    session.arlingtonAttachmentsPartialPending = false;
  }

  return response;
}

async function runArlingtonAttachmentsAutoContinueLoop(opts) {
  const {
    session,
    projectId,
    userId,
    permitNumber,
    maxCycles = 8,
    delayMs = 2000,
    maxNoProgressCycles = 2,
    supabase,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
    initialResultOrStats,
  } = opts;

  const logP = "[Arlington][Attachments][AutoContinue]";
  const permit = `${permitNumber || ""}`.trim();
  const projId = `${projectId || ""}`.trim();

  if (!arlingtonPlanReviewSessionIsUsable(session)) {
    console.log(`${logP} stopping reason=session_invalid cycles=0 pending=?`);
    return {
      stoppedReason: "session_invalid",
      cycles: 0,
      pending: 0,
      finalStatus: "partial_success_attachments_pending",
    };
  }

  console.log(`${logP} enabled maxCycles=${maxCycles}`);

  let cycle = 0;
  let noProgressCycles = 0;
  /** @type {Record<string, unknown>|null} */
  let lastResult =
    initialResultOrStats && typeof initialResultOrStats === "object"
      ? initialResultOrStats
      : null;
  let stoppedReason = "complete";
  let finalStatus = "complete";

  const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

  while (cycle < maxCycles) {
    if (session._cancelRequested) {
      stoppedReason = "cancelled";
      finalStatus = "partial_success_attachments_pending";
      break;
    }

    if (!arlingtonPlanReviewSessionIsUsable(session)) {
      stoppedReason = "session_invalid";
      finalStatus = "partial_success_attachments_pending";
      break;
    }

    const pendingBefore = lastResult?.pendingByReason
      ? arlingtonAttachmentPendingCount(
          /** @type {Record<string, number>} */ (lastResult.pendingByReason),
        )
      : Number(lastResult?.pending) || null;

    console.log(
      `${logP} cycle=${cycle + 1} pendingBefore=${pendingBefore != null ? pendingBefore : "?"}`,
    );

    if (pendingBefore === 0 && (cycle > 0 || lastResult)) {
      stoppedReason = "complete";
      finalStatus = "complete";
      session.arlingtonAttachmentsPartialPending = false;
      console.log(`${logP} stopping reason=complete pending=0`);
      break;
    }

    if (cycle > 0) {
      mirrorSessionProgress(session, `${permit} → Continuing pending Attachments downloads automatically...`);
      await sleep(delayMs);
    }

    let result;
    try {
      result = await continueArlingtonAttachmentsDownloads(session, {
        projectId: projId,
        permitNumber: permit,
        userId,
        supabase,
        hashPortalData,
        uploadToSupabaseStorage,
        sanitizeStorageKey,
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      stoppedReason = /browser|page|session|not available/i.test(msg)
        ? "session_invalid"
        : "error";
      finalStatus = "partial_success_attachments_pending";
      session.arlingtonAttachmentsPartialPending = true;
      console.log(`${logP} stopping reason=${stoppedReason} cycles=${cycle + 1}`);
      return {
        stoppedReason,
        cycles: cycle + 1,
        pending: pendingBefore ?? 0,
        finalStatus,
        error: msg,
      };
    }

    lastResult = result;
    const pendingAfter = arlingtonAttachmentPendingCount(result.pendingByReason);
    const downloaded = Number(result.downloadedThisRun) || 0;

    console.log(
      `${logP} cycle=${cycle + 1} downloadedThisRun=${downloaded} pendingAfter=${pendingAfter} status=${result.status}`,
    );

    if (result.status === "complete" || pendingAfter === 0) {
      stoppedReason = "complete";
      finalStatus = "complete";
      session.arlingtonAttachmentsPartialPending = false;
      console.log(`${logP} stopping reason=complete pending=0`);
      break;
    }

    if (downloaded > 0) {
      noProgressCycles = 0;
    } else {
      noProgressCycles += 1;
    }

    if (noProgressCycles >= maxNoProgressCycles) {
      stoppedReason = "no_progress";
      finalStatus = "partial_success_attachments_pending";
      session.arlingtonAttachmentsPartialPending = true;
      break;
    }

    if (cycle + 1 >= maxCycles) {
      stoppedReason = "max_cycles";
      finalStatus = "partial_success_attachments_pending";
      session.arlingtonAttachmentsPartialPending = true;
      break;
    }

    finalStatus = "partial_success_attachments_pending";
    session.arlingtonAttachmentsPartialPending = true;
    session.arlingtonAttachmentsCheckpointSaved = true;
    cycle += 1;
  }

  const pendingEnd = lastResult?.pendingByReason
    ? arlingtonAttachmentPendingCount(
        /** @type {Record<string, number>} */ (lastResult.pendingByReason),
      )
    : Number(lastResult?.pending) || 0;

  console.log(
    `${logP} stopping reason=${stoppedReason} cycles=${cycle + (lastResult ? 1 : 0)} pending=${pendingEnd}`,
  );

  return {
    stoppedReason,
    cycles: cycle + (lastResult ? 1 : 0),
    pending: pendingEnd,
    finalStatus,
    lastResult,
  };
}

const ARLINGTON_WORKER_CYCLE_MS = 8 * 60 * 1000;

function arlingtonWorkerBuildInfoTabSlice(header, details) {
  const ar = details?.arlingtonRecordInfo;
  const recordStatusDisplay = (header?.record_status || "")
    .replace(/^Record Status:\s*/i, "")
    .trim();
  const expirationDisplay = (header?.expiration_date || "")
    .replace(/^Expiration Date:\s*/i, "")
    .trim();
  if (ar?.workLocation && Array.isArray(ar.workLocation.lines) && ar.workLocation.lines.length > 0) {
    return {
      title: "Record Info",
      jurisdiction: "arlington_county_va",
      tables: details.tables || [],
      fields: header,
      keyValues: [
        { key: "Record Number", value: header.record_number || "" },
        { key: "Record Type", value: header.record_type || "" },
        { key: "Record Status", value: recordStatusDisplay },
        { key: "Expiration Date", value: expirationDisplay },
        { key: "Work Location", value: ar.workLocation?.text || "" },
        {
          key: "Applicant",
          value: ar.applicant?.text || (ar.applicant?.lines || []).join("\n") || "",
        },
        {
          key: "Licensed Professional",
          value:
            ar.licensedProfessional?.text ||
            (ar.licensedProfessional?.lines || []).join("\n") ||
            "",
        },
        {
          key: "Owner",
          value: ar.owner?.text || (ar.owner?.lines || []).join("\n") || "",
        },
      ],
      arlingtonRecordInfo: ar,
      screenshot: details.screenshot,
    };
  }
  return {
    tables: details.tables || [],
    fields: header,
    screenshot: details.screenshot,
  };
}

function arlingtonWorkerResolveNextPhase(tabSet, currentPhase, states) {
  const order = [
    "record_info",
    "attachments",
    "project_information",
    "plan_review",
    "verify",
  ];
  const idx = order.indexOf(currentPhase);
  if (idx < 0) return "verify";
  if (currentPhase === "attachments" && states.attachmentsPending > 0) {
    return "attachments";
  }
  if (
    currentPhase === "plan_review" &&
    Number(states.planReviewPending) > 0
  ) {
    return "plan_review";
  }
  for (let i = idx + 1; i < order.length; i += 1) {
    const phase = order[i];
    if (phase === "attachments" && !tabSet.has("attachments")) continue;
    if (phase === "project_information" && !tabSet.has("plan_review")) continue;
    if (phase === "plan_review" && !tabSet.has("plan_review")) continue;
    return phase;
  }
  return "verify";
}

/**
 * Run one bounded Arlington worker phase (single claim cycle).
 * @param {object} session Playwright session (recreated per worker claim).
 * @param {object} opts
 */
async function runArlingtonWorkerBoundedPhase(session, opts) {
  const {
    job,
    userId,
    supabase,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
    requestedScope,
    phase: phaseIn,
    onHeartbeat,
    isCancelRequested,
  } = opts;

  const cancelPoll =
    typeof isCancelRequested === "function"
      ? isCancelRequested
      : async () => false;

  const stopIfCancelled = async () => {
    if (await cancelPoll()) {
      result.cancelled = true;
      return true;
    }
    return false;
  };

  const permitNumber = `${job.permit_number || ""}`.trim();
  const projectId = `${job.project_id || ""}`.trim();
  const page = session?.page;
  if (!page) throw new Error("worker_session_no_page");

  const portalUrl = session.portalUrl || session.dashboardUrl;
  const accelaTenantProfile = resolveAccelaTenantProfile(portalUrl);
  page._accelaTenantProfile = accelaTenantProfile;
  page._isArlington = accelaTenantProfile?.key === "arlington_county_va";

  const tabList = requestedScope?.tabs || ["info", "attachments", "plan_review"];
  const tabSet = new Set(tabList);
  const workerCycleDeadlineMs = Date.now() + ARLINGTON_WORKER_CYCLE_MS;
  const phase = `${phaseIn || job.phase || "record_info"}`.trim();

  session.arlingtonDurableMode = true;
  session._scrapeJobId = job.id;
  session._scrapeProjectId = projectId;
  session._scrapePermitNumber = permitNumber;
  session.userId = userId;

  const result = {
    phase,
    nextPhase: phase,
    rateLimited: false,
    verify: false,
    done: false,
    cancelled: false,
    cycleTimedOut: false,
    attachments_state: job.attachments_state || "not_started",
    project_info_state: job.project_info_state || "not_started",
    plan_review_state: job.plan_review_state || "not_started",
    checkpoint_version: Number(job.checkpoint_version) || 0,
    error: null,
  };

  const cycleExpired = () => Date.now() >= workerCycleDeadlineMs;

  const maybeHeartbeat = async () => {
    if (await stopIfCancelled()) return false;
    if (typeof onHeartbeat === "function") await onHeartbeat();
    return true;
  };

  if (phase === "verify") {
    result.verify = true;
    result.verifyPersistedOnly = true;
    result.nextPhase = "complete";
    return result;
  }

  if (await stopIfCancelled()) return result;

  if (!isArlingtonCapDetailPage(page)) {
    mirrorSessionProgress(session, `${permitNumber} → Searching...`);
    await searchPermit(page, portalUrl, permitNumber);
  }
  await maybeHeartbeat();
  if (await stopIfCancelled()) return result;

  if (phase === "record_info") {
    mirrorSessionProgress(session, `${permitNumber} → Record Header`);
    const header = await extractRecordHeader(page);
    const mode = arlingtonOrchestration.detectArlingtonRecordMode(header, permitNumber);
    session.arlingtonRecordMode = mode;

    let details = { fields: {}, tables: [], screenshot: null };
    if (tabSet.has("info")) {
      try {
        mirrorSessionProgress(session, `${permitNumber} → Record Details`);
        details = await extractRecordDetails(page);
      } catch (err) {
        console.log(`[Arlington][Worker] record details: ${err.message}`);
      }
    }

    const infoTab = arlingtonWorkerBuildInfoTabSlice(header, details);
    const persistResult = await arlingtonJobStore.persistPortalDataPatch(
      supabase,
      userId,
      projectId,
      permitNumber,
      hashPortalData,
      (prior) => {
        const scrapedSlice = {
          portalType: "accela",
          schemaVersion: 2,
          name: header.record_number || permitNumber,
          projectNum: header.record_number || permitNumber,
          tabs: { info: infoTab },
        };
        const merged = mergeArlingtonPartialPortalData(prior, scrapedSlice, new Set(["info"]));
        merged.arlingtonSectionStates = arlingtonOrchestration.mergeArlingtonSectionStates(
          prior,
          { recordInfo: "complete" },
        );
        return merged;
      },
    );
    if (persistResult.ok) {
      result.checkpoint_version = persistResult.checkpointVersion;
    }

    result.nextPhase = arlingtonWorkerResolveNextPhase(tabSet, "record_info", {
      attachmentsPending: 0,
      planReviewPending: 0,
    });
    return result;
  }

  if (await stopIfCancelled()) return result;

  if (phase === "attachments") {
    if (!tabSet.has("attachments")) {
      result.nextPhase = arlingtonWorkerResolveNextPhase(tabSet, "attachments", {
        attachmentsPending: 0,
        planReviewPending: 0,
      });
      return result;
    }

    result.attachments_state = "downloading";
    const priorPortal = await arlingtonFetchLatestPortalDataRow(
      supabase,
      userId,
      projectId,
      permitNumber,
    );
    const priorRows = arlingtonPriorAttachmentRowsFromPortalData(priorPortal);
    const DOWNLOADS_ROOT = path.join(__dirname, "downloads");
    if (!fs.existsSync(DOWNLOADS_ROOT)) {
      fs.mkdirSync(DOWNLOADS_ROOT, { recursive: true });
    }

    if (priorRows.length === 0) {
      const attResult = await extractAttachments(
        page,
        session,
        projectId,
        supabase,
        uploadToSupabaseStorage,
        sanitizeStorageKey,
        {
          DOWNLOADS_DIR: DOWNLOADS_ROOT,
          supabaseProjectId: projectId,
          uploadFn: uploadToSupabaseStorage,
          sanitizeFn: sanitizeStorageKey,
          permitNumber,
          priorPortalData: priorPortal,
          supabase,
          userId,
          hashPortalData,
          workerCycleDeadlineMs,
          scrapeDeadlineMs: workerCycleDeadlineMs,
          reserveMsForFinalSave: ARLINGTON_ATTACHMENTS_RESUME_RESERVE_FINAL_SAVE_MS,
          touchSessionKeepalive:
            typeof session.touchSessionKeepalive === "function"
              ? session.touchSessionKeepalive.bind(session)
              : null,
          _arlingtonSession: session,
          isCancelRequested: cancelPoll,
        },
      );
      if (attResult?.cancelled === true || (await stopIfCancelled())) {
        result.cancelled = true;
        return result;
      }
      if (attResult?.rateLimited === true) {
        result.rateLimited = true;
        result.attachments_state = "rate_limited";
        return result;
      }
    } else if (!cycleExpired()) {
      await continueArlingtonAttachmentsDownloads(session, {
        projectId,
        permitNumber,
        userId,
        supabase,
        hashPortalData,
        uploadToSupabaseStorage,
        sanitizeStorageKey,
        workerCycleDeadlineMs,
        isCancelRequested: cancelPoll,
      });
      if (await stopIfCancelled()) {
        result.cancelled = true;
        return result;
      }
    }

    await maybeHeartbeat();
    const latestPortal = await arlingtonFetchLatestPortalDataRow(
      supabase,
      userId,
      projectId,
      permitNumber,
    );
    const rows = arlingtonPriorAttachmentRowsFromPortalData(latestPortal);
    const pending = arlingtonOrchestration.arlingtonAttachmentPendingCount(rows);
    result.attachments_state =
      pending > 0 ? (cycleExpired() ? "partial" : "partial") : "complete";
    result.checkpoint_version =
      arlingtonOrchestration.readCheckpointVersion(latestPortal) ||
      result.checkpoint_version;
    result.cycleTimedOut = cycleExpired() && pending > 0;
    result.nextPhase = arlingtonWorkerResolveNextPhase(tabSet, "attachments", {
      attachmentsPending: pending,
      planReviewPending: 0,
    });
    return result;
  }

  if (phase === "project_information") {
    if (!tabSet.has("plan_review")) {
      result.nextPhase = "verify";
      return result;
    }

    session.arlingtonPlanReviewScope = "projectInformation";
    session.arlingtonDownloadDocuments = false;

    const priorPortal = await arlingtonFetchLatestPortalDataRow(
      supabase,
      userId,
      projectId,
      permitNumber,
    );
    const piSection =
      priorPortal?.tabs?.planReview?.tabs?.projectInformation ||
      priorPortal?.tabs?.planReview?.projectInformation;
    const piState = `${piSection?.sectionState || ""}`.trim();
    const piFields = Array.isArray(piSection?.fields) ? piSection.fields : [];
    const piOnlyJob =
      requestedScope?.planReviewScope === "projectInformation" ||
      session.arlingtonPlanReviewScope === "projectInformation";

    if (
      piState !== "complete" &&
      (piState !== "weak_extraction" || piOnlyJob) &&
      !cycleExpired()
    ) {
      const DOWNLOADS_ROOT = path.join(__dirname, "downloads");
      if (!fs.existsSync(DOWNLOADS_ROOT)) {
        fs.mkdirSync(DOWNLOADS_ROOT, { recursive: true });
      }
      const planReviewHashes = new Map();
      await extractPlanReviewArlington(page, getExtractionContext(page), {
        DOWNLOADS_DIR: DOWNLOADS_ROOT,
        supabaseProjectId: projectId,
        uploadFn: uploadToSupabaseStorage,
        sanitizeFn: sanitizeStorageKey,
        downloadedHashes: planReviewHashes,
        attachmentRows: [],
        permitNumber,
        priorPortalData: priorPortal,
        supabase,
        userId,
        hashPortalData,
        scrapeDeadlineMs: workerCycleDeadlineMs,
        reserveMsForFinalSave: ARLINGTON_PLAN_REVIEW_RESUME_RESERVE_FINAL_SAVE_MS,
        touchSessionKeepalive:
          typeof session.touchSessionKeepalive === "function"
            ? session.touchSessionKeepalive.bind(session)
            : null,
        _arlingtonSession: session,
        planReviewScope: "projectInformation",
        downloadDocuments: false,
      });
    }

    await maybeHeartbeat();
    const latestPortal = await arlingtonFetchLatestPortalDataRow(
      supabase,
      userId,
      projectId,
      permitNumber,
    );
    const latestPi =
      latestPortal?.tabs?.planReview?.tabs?.projectInformation ||
      latestPortal?.tabs?.planReview?.projectInformation;
    const latestState = `${latestPi?.sectionState || ""}`.trim();
    const latestFields = Array.isArray(latestPi?.fields) ? latestPi.fields : [];
    result.project_info_state =
      latestState === "weak_extraction" || latestFields.length < 3
        ? "weak_extraction"
        : latestState || (latestFields.length > 0 ? "complete" : "not_started");
    result.checkpoint_version =
      arlingtonOrchestration.readCheckpointVersion(latestPortal) ||
      result.checkpoint_version;
    result.nextPhase = "plan_review";
    return result;
  }

  if (phase === "plan_review") {
    if (!tabSet.has("plan_review")) {
      result.nextPhase = "verify";
      return result;
    }

    const prScope = requestedScope?.planReviewScope || "all";
    session.arlingtonPlanReviewScope = prScope;
    session.arlingtonDownloadDocuments = requestedScope?.downloadDocuments !== false;

    const priorPortal = await arlingtonFetchLatestPortalDataRow(
      supabase,
      userId,
      projectId,
      permitNumber,
    );
    const integratedTabs =
      arlingtonPlanReviewHydrateIntegratedTabsFromPortalData(priorPortal);

    let continueResponse = null;
    if (!integratedTabs && !cycleExpired()) {
      const DOWNLOADS_ROOT = path.join(__dirname, "downloads");
      if (!fs.existsSync(DOWNLOADS_ROOT)) {
        fs.mkdirSync(DOWNLOADS_ROOT, { recursive: true });
      }
      const planReviewHashes = new Map();
      const attRows = arlingtonPriorAttachmentRowsFromPortalData(priorPortal);
      await extractPlanReviewArlington(page, getExtractionContext(page), {
        DOWNLOADS_DIR: DOWNLOADS_ROOT,
        supabaseProjectId: projectId,
        uploadFn: uploadToSupabaseStorage,
        sanitizeFn: sanitizeStorageKey,
        downloadedHashes: planReviewHashes,
        attachmentRows: attRows,
        permitNumber,
        priorPortalData: priorPortal,
        supabase,
        userId,
        hashPortalData,
        scrapeDeadlineMs: workerCycleDeadlineMs,
        reserveMsForFinalSave: ARLINGTON_PLAN_REVIEW_RESUME_RESERVE_FINAL_SAVE_MS,
        touchSessionKeepalive:
          typeof session.touchSessionKeepalive === "function"
            ? session.touchSessionKeepalive.bind(session)
            : null,
        _arlingtonSession: session,
        planReviewScope: prScope,
        downloadDocuments: session.arlingtonDownloadDocuments,
      });
    } else if (!cycleExpired()) {
      const continueScope = arlingtonPlanReviewMapScrapeScopeToContinueScope(prScope);
      continueResponse = await continueArlingtonPlanReviewDownloads(session, {
        projectId,
        permitNumber,
        userId,
        supabase,
        hashPortalData,
        uploadToSupabaseStorage,
        sanitizeStorageKey,
        scope: continueScope,
        workerCycleDeadlineMs,
      });
    }

    await maybeHeartbeat();
    const latestPortal = await arlingtonFetchLatestPortalDataRow(
      supabase,
      userId,
      projectId,
      permitNumber,
    );
    const prAnalysis = arlingtonOrchestration.analyzePlanReviewPendingDocuments(
      latestPortal?.tabs?.planReview,
    );
    const retryablePending = prAnalysis.retryable.total;
    const metadataOnlyPending = prAnalysis.metadataOnly.total;
    const integratedAfter =
      arlingtonPlanReviewHydrateIntegratedTabsFromPortalData(latestPortal);
    const pendingByReason = integratedAfter
      ? arlingtonPlanReviewPendingByReason(integratedAfter, prScope)
      : metadataOnlyPending > 0
        ? { metadata_only: metadataOnlyPending }
        : {};
    const downloadedThisRun = Number(continueResponse?.downloadedThisRun) || 0;

    result.downloadedThisRun = downloadedThisRun;
    result.pendingByReason = pendingByReason;
    result.planReviewRetryablePending = retryablePending;
    result.planReviewMetadataOnly = metadataOnlyPending;
    result.metadataOnlyDocumentNames = prAnalysis.metadataOnly.names;

    const metadataOnlyTerminal =
      downloadedThisRun === 0 &&
      retryablePending === 0 &&
      metadataOnlyPending > 0;

    result.plan_review_state =
      metadataOnlyTerminal || retryablePending === 0 ? "complete" : "partial";
    result.checkpoint_version =
      arlingtonOrchestration.readCheckpointVersion(latestPortal) ||
      result.checkpoint_version;
    result.cycleTimedOut = cycleExpired() && retryablePending > 0;
    if (metadataOnlyTerminal) {
      result.terminalMetadataOnly = true;
      result.nextPhase = "verify";
    } else {
      result.nextPhase = arlingtonWorkerResolveNextPhase(tabSet, "plan_review", {
        attachmentsPending: 0,
        planReviewPending: retryablePending,
      });
    }
    return result;
  }

  result.nextPhase = "verify";
  return result;
}

module.exports = {
  accelaLogin,
  scrapeAccelaRecord,
  runArlingtonWorkerBoundedPhase,
  continueArlingtonPlanReviewDownloads,
  resumeArlingtonPlanReviewPendingDownloads,
  continueArlingtonAttachmentsDownloads,
  arlingtonPlanReviewScopeSupportsAutoContinue,
  arlingtonPlanReviewSessionBrowserUsable,
  detectAccelaHumanLoginRequired,
  findLinkInAnyContext,
  clickAndWaitForContent,
  navigateToRecordInfoSection,
  navigateToPaymentsSection,
  resolveAccelaTenantProfile,
  isArlingtonPortal,
};

/*
 * Example usage (do not execute on module load):
 *
 *   const allFrames = page.frames();
 *   const recordFrame = page._recordFrame || page.mainFrame();
 *   const childFrames = allFrames.filter((f) => f !== page.mainFrame());
 *   const r = await findLinkInAnyContext(page, childFrames, "Processing Status");
 *   if (r) {
 *     await clickAndWaitForContent(r.context, r.element, recordFrame, 8000);
 *   }
 */
