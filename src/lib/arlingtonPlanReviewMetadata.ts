/** True when portal_data already has Arlington Plan Review integrated-tab metadata. */
export function arlingtonPortalDataHasPlanReviewMetadata(
  portalData: Record<string, unknown> | null | undefined,
): boolean {
  const tabsRoot = portalData?.tabs;
  if (!tabsRoot || typeof tabsRoot !== "object" || Array.isArray(tabsRoot)) {
    return false;
  }
  const planReview = (tabsRoot as Record<string, unknown>).planReview;
  if (!planReview || typeof planReview !== "object" || Array.isArray(planReview)) {
    return false;
  }
  const integrated = (planReview as Record<string, unknown>).tabs;
  if (!integrated || typeof integrated !== "object" || Array.isArray(integrated)) {
    return false;
  }
  const t = integrated as Record<string, unknown>;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const ps = (
    t.plansAndDocuments as { sections?: { planSetDocuments?: { documents?: unknown[] } } }
  )?.sections?.planSetDocuments?.documents;
  const rr = (t.reviewResultsAndMarkups as { documents?: unknown[] })?.documents;
  const ad = (t.approvedDocuments as { documents?: unknown[] })?.documents;
  const pi = (t.projectInformation as { fields?: unknown[] })?.fields;
  return (
    len(ps) > 0 ||
    len(rr) > 0 ||
    len(ad) > 0 ||
    len(pi) > 0
  );
}
