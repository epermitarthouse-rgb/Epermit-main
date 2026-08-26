/**
 * Measure-agnostic evidence polarity classification for Code Mod synthesis.
 */

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const NEGATIVE_EVIDENCE =
  /\b(not included|not shown|not provided|not indicated|not present|not depicted|not mentioned|absent|omitted|excluded|without|no evidence(?:\s+of|\s+on|\s+for)?|no information(?:\s+(?:about|regarding|on|for))?|does not include|does not show|does not indicate|does not mention|are not mentioned|is not mentioned)\b/;

const INCOMPLETE_EVIDENCE =
  /\b(cannot (?:determine|verify|confirm)|unclear|insufficient|unable to (?:determine|verify)|not enough (?:information|evidence)|cannot assess|does not establish|does not provide(?: full details?)?)\b/;

const POSITIVE_EVIDENCE =
  /\b(included|shown|provided|indicated|present|installed|depicted|noted|provided for|designed for|class i|class 1|class ii|class 2)\b/;

export function isIncompleteEvidenceLanguage(text: string): boolean {
  return INCOMPLETE_EVIDENCE.test(normalizeText(text));
}

export function isAbsenceLanguage(text: string): boolean {
  return NEGATIVE_EVIDENCE.test(normalizeText(text));
}

export function evidencePolarity(text: string): "negative" | "positive" | "neutral" {
  const normalized = normalizeText(text);
  if (!normalized) return "neutral";
  const negative = NEGATIVE_EVIDENCE.test(normalized);
  const positive = POSITIVE_EVIDENCE.test(normalized);
  if (negative && !positive) return "negative";
  if (positive && !negative) return "positive";
  if (negative && positive) {
    const negPosPhrases: Array<[string, string]> = [
      ["not included", "included"],
      ["not shown", "shown"],
      ["not provided", "provided"],
      ["not indicated", "indicated"],
      ["not present", "present"],
      ["not depicted", "depicted"],
      ["not mentioned", "noted"],
    ];
    for (const [negPhrase, posWord] of negPosPhrases) {
      if (
        new RegExp(`\\b${negPhrase}\\b`).test(normalized) &&
        new RegExp(`\\b${posWord}\\b`).test(normalized)
      ) {
        return "negative";
      }
    }
    return "neutral";
  }
  return "neutral";
}

export function excerptsContradict(left: string, right: string): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b || a === b) return false;
  if (isIncompleteEvidenceLanguage(a) || isIncompleteEvidenceLanguage(b)) return false;

  const leftPolarity = evidencePolarity(a);
  const rightPolarity = evidencePolarity(b);
  if (leftPolarity === "negative" && rightPolarity === "positive") return true;
  if (leftPolarity === "positive" && rightPolarity === "negative") return true;

  return (
    (/\bnot included\b/.test(a) && /\bincluded\b/.test(b)) ||
    (/\bincluded\b/.test(a) && /\bnot included\b/.test(b))
  );
}
