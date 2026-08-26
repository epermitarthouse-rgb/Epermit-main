/** Read project ID from URL query (?projectId=, ?project=, ?project_id=). */
export function getProjectIdFromSearchParams(
  searchParams: URLSearchParams,
): string | null {
  const val =
    searchParams.get("projectId") ??
    searchParams.get("project") ??
    searchParams.get("project_id");
  return val && val !== "null" ? val : null;
}

/** Live URL read — context may update ?projectId= before React Router searchParams refresh. */
export function getProjectIdFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return getProjectIdFromSearchParams(new URLSearchParams(window.location.search));
}
