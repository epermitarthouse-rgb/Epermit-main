import communEtLogoUrl from "@/assets/commun-et-logo.jpg";
import { buildArchitectReviewModel, fingerprintArchitectReview } from "@/lib/supabaseAnalyzer/architectReview";
import {
  architectReviewPdfFileName,
  renderArchitectReviewPdf,
  type ReportLogo,
} from "@/lib/supabaseAnalyzer/brandedReport";
import type { AnalyzerRunDataset } from "@/lib/supabaseAnalyzer/client";

let logoPromise: Promise<ReportLogo> | null = null;

export function jpegBase64FromLogo(logo: ReportLogo): string {
  return logo.data.includes(",") ? logo.data.slice(logo.data.indexOf(",") + 1) : logo.data;
}

export function loadLogo(): Promise<ReportLogo> {
  logoPromise ??= (async () => {
    const response = await fetch(communEtLogoUrl);
    if (!response.ok) throw new Error(`Logo request failed (${response.status})`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const logo: ReportLogo = { data, format: "JPEG", width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return logo;
  })().catch((error) => {
    logoPromise = null;
    throw error;
  });
  return logoPromise;
}

/** Builds the branded architect review for the loaded dataset and saves it. */
export async function downloadArchitectReviewPdf(
  dataset: AnalyzerRunDataset,
  projectName?: string | null,
): Promise<{ reportVersion: string; logoIncluded: boolean }> {
  const model = buildArchitectReviewModel(dataset);
  const [fingerprint, logo] = await Promise.all([
    fingerprintArchitectReview(dataset),
    loadLogo().catch((error) => {
      console.error("[supabase-analyzer] report logo could not be loaded", error);
      return null;
    }),
  ]);
  const { doc } = renderArchitectReviewPdf({
    dataset,
    model,
    fingerprint,
    projectName,
    generatedAt: new Date(),
    logo,
  });
  doc.save(architectReviewPdfFileName(dataset.run.id, fingerprint));
  return { reportVersion: fingerprint.label, logoIncluded: Boolean(logo) };
}
