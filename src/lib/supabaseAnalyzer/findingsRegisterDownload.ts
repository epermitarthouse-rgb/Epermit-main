import { buildArchitectReviewModel, fingerprintArchitectReview } from "@/lib/supabaseAnalyzer/architectReview";
import { jpegBase64FromLogo, loadLogo } from "@/lib/supabaseAnalyzer/brandedReportDownload";
import type { AnalyzerRunDataset } from "@/lib/supabaseAnalyzer/client";
import {
  buildFindingsRegisterWorkbook,
  findingsRegisterFileName,
  resolveExcelJS,
} from "@/lib/supabaseAnalyzer/findingsRegister";

/** Builds the branded Excel register for the loaded dataset and saves it. exceljs is loaded only here. */
export async function downloadFindingsRegisterExcel(
  dataset: AnalyzerRunDataset,
  projectName?: string | null,
): Promise<{ reportVersion: string; logoIncluded: boolean }> {
  const [exceljs, model, fingerprint, logo] = await Promise.all([
    import("exceljs").then(resolveExcelJS),
    Promise.resolve(buildArchitectReviewModel(dataset)),
    fingerprintArchitectReview(dataset),
    loadLogo().catch((error) => {
      console.error("[supabase-analyzer] register logo could not be loaded", error);
      return null;
    }),
  ]);
  const { workbook } = buildFindingsRegisterWorkbook(exceljs, {
    dataset,
    model,
    fingerprint,
    projectName,
    generatedAt: new Date(),
    logoBase64: logo ? jpegBase64FromLogo(logo) : null,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = findingsRegisterFileName(dataset.run.id, fingerprint);
  link.click();
  URL.revokeObjectURL(url);
  return { reportVersion: fingerprint.label, logoIncluded: Boolean(logo) };
}
