/** Selective Plan Review scopes sent to POST /api/scrape (optional). */
export type ArlingtonPlanReviewScrapeScope =
  | "all"
  | "planSet"
  | "reviewResults"
  | "approvedDocuments"
  | "projectInformation";

export type ArlingtonScrapeTabOpts = {
  tabs: string[];
  planReviewScope?: ArlingtonPlanReviewScrapeScope;
  /** When true, scraper auto-continues pending Plan Review downloads in-process. */
  autoContinueDownloads?: boolean;
};

/** Body fields for Arlington Plan Review document dropdown actions. */
export function arlingtonPlanReviewDocumentScrapeOpts(
  planReviewScope: Exclude<
    ArlingtonPlanReviewScrapeScope,
    "projectInformation"
  >,
): ArlingtonScrapeTabOpts {
  return {
    tabs: ["plan_review"],
    planReviewScope,
    autoContinueDownloads: true,
  };
}

/** Project Information: metadata only, no auto-continue. */
export function arlingtonPlanReviewProjectInformationScrapeOpts(): ArlingtonScrapeTabOpts {
  return {
    tabs: ["plan_review"],
    planReviewScope: "projectInformation",
    autoContinueDownloads: false,
  };
}

/**
 * Full Arlington scrape — backend accepts tabs info, attachments, plan_review only.
 * Supplemental accordion panels (status, relatedRecords, etc.) run when all three are included.
 */
export function arlingtonScrapeAllOpts(): ArlingtonScrapeTabOpts {
  return {
    tabs: ["info", "attachments", "plan_review"],
    planReviewScope: "all",
    autoContinueDownloads: true,
  };
}
