import { convertLegacyWordDocument } from "@/lib/convertLegacyWordDocument";
import { isLegacyDocFile } from "@/utils/extractDocumentText";

export async function prepareCommentLetterExtractionFile(options: {
  projectId: string;
  sourceDocumentId: string;
  originalFile: File;
  conversionTimeoutMs?: number;
}): Promise<File> {
  if (!isLegacyDocFile(options.originalFile)) {
    return options.originalFile;
  }

  const converted = await convertLegacyWordDocument({
    projectId: options.projectId,
    sourceDocumentId: options.sourceDocumentId,
    timeoutMs: options.conversionTimeoutMs,
  });

  if (converted.file.size === 0) {
    throw new Error("Legacy Word conversion returned an empty file");
  }

  return converted.file;
}
