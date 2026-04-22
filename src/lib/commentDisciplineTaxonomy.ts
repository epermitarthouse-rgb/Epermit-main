/**
 * Canonical review-comment taxonomy — must match `DISCIPLINE_ENUM` in
 * `supabase/functions/discipline-classifier-agent/index.ts` (LLM output).
 * Used to tell real classification apart from non-taxonomy text (e.g. reviewer org lines).
 */
export const TAXONOMY_DISCIPLINES = [
  "Architectural",
  "Structural",
  "Mechanical",
  "Electrical",
  "Plumbing",
  "Fire",
  "Civil",
  "Energy",
  "Zoning",
  "Environmental",
  "Administrative",
  "Other",
] as const;

const TAXONOMY_SET = new Set<string>(TAXONOMY_DISCIPLINES as readonly string[]);

export function isTaxonomyDiscipline(
  s: string | null | undefined,
): s is (typeof TAXONOMY_DISCIPLINES)[number] {
  const t = String(s ?? "").trim();
  return t.length > 0 && TAXONOMY_SET.has(t);
}
