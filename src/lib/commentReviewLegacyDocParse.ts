import { convertLegacyWordDocument } from "@/lib/convertLegacyWordDocument";
import { isLegacyDocFile } from "@/utils/extractDocumentText";

export async function prepareCommentLetterExtractionFile(options: {
  projectId: string;
  sourceDocumentId: string;
  originalFile: File;
}): Promise<File> {
  if (!isLegacyDocFile(options.originalFile)) {
    return options.originalFile;
  }

  const converted = await convertLegacyWordDocument({
    projectId: options.projectId,
    sourceDocumentId: options.sourceDocumentId,
  });

  return converted.file;
}
