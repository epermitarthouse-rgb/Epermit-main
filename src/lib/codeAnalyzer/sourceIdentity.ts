/**
 * Stable identity for analyzer source documents — content SHA-256 with
 * filename+size fallback for rows persisted before hashing was tracked.
 */
import { normalizeEvidenceFileName } from "@/lib/codeModification/evidenceSources";
import type { CodeAnalyzerSheet } from "./model";
import type { ProjectDocument } from "@/types/document";

export interface ExistingAnalyzerSourceRef {
  id: string;
  file_name: string;
  file_size: number;
  contentSha256?: string | null;
}

/** SHA-256 hex digest of file bytes (Web Crypto in browser, node:crypto in tests). */
export async function computeSourceFileSha256(
  file: Blob & { name?: string; size?: number },
): Promise<string> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    const { createHash } = await import("node:crypto");
    return createHash("sha256")
      .update(sourceMetadataIdentityKey(file.name, file.size))
      .digest("hex");
  }
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

/** Weak fallback key when persisted rows lack a stored content hash. */
export function sourceMetadataIdentityKey(
  fileName: string | null | undefined,
  fileSize: number | null | undefined,
): string {
  const name = normalizeEvidenceFileName(fileName);
  const size = Math.max(0, Number(fileSize) || 0);
  return `${size}:${name}`;
}

export function sheetIdentityKey(sourceDocumentId: string, pageNumber: number): string {
  return `${sourceDocumentId}:${pageNumber}`;
}

/** Root source documents already registered for this project's analyzer sheets. */
export function existingAnalyzerSourceRefs(
  sheets: ReadonlyArray<Pick<CodeAnalyzerSheet, "source_document_id">>,
  documents: ReadonlyArray<Pick<ProjectDocument, "id" | "file_name" | "file_size">>,
): ExistingAnalyzerSourceRef[] {
  const rootIds = registeredDrawingSourceIdsFromSheets(sheets);
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const refs: ExistingAnalyzerSourceRef[] = [];
  for (const id of rootIds) {
    const doc = byId.get(id);
    if (!doc) continue;
    refs.push({
      id: doc.id,
      file_name: doc.file_name,
      file_size: doc.file_size,
    });
  }
  return refs;
}

function registeredDrawingSourceIdsFromSheets(
  sheets: ReadonlyArray<Pick<CodeAnalyzerSheet, "source_document_id">>,
): Set<string> {
  return new Set(sheets.map((sheet) => sheet.source_document_id).filter(Boolean));
}

export function buildExistingSourceIdentityIndex(
  existingSources: ReadonlyArray<ExistingAnalyzerSourceRef>,
): {
  bySha256: Map<string, string>;
  byMetadataKey: Map<string, string>;
} {
  const bySha256 = new Map<string, string>();
  const byMetadataKey = new Map<string, string>();
  for (const source of existingSources) {
    if (source.contentSha256) {
      bySha256.set(source.contentSha256, source.id);
    }
    const metaKey = sourceMetadataIdentityKey(source.file_name, source.file_size);
    if (!byMetadataKey.has(metaKey)) {
      byMetadataKey.set(metaKey, source.id);
    }
  }
  return { bySha256, byMetadataKey };
}

/** Resolve a persisted source document id for an incoming file, if already registered. */
export function resolveExistingSourceDocumentId(
  index: ReturnType<typeof buildExistingSourceIdentityIndex>,
  identity: { contentSha256: string; fileName: string; fileSize: number },
): string | null {
  const byHash = index.bySha256.get(identity.contentSha256);
  if (byHash) return byHash;
  const metaKey = sourceMetadataIdentityKey(identity.fileName, identity.fileSize);
  return index.byMetadataKey.get(metaKey) ?? null;
}

export function existingSheetKeys(
  sheets: ReadonlyArray<Pick<CodeAnalyzerSheet, "source_document_id" | "page_number">>,
): Set<string> {
  return new Set(
    sheets.map((sheet) => sheetIdentityKey(sheet.source_document_id, sheet.page_number)),
  );
}

/** Dedupe evidence / included sheets by source page (DB duplicates collapse to one). */
export function dedupeSheetsBySourcePage<
  T extends Pick<CodeAnalyzerSheet, "source_document_id" | "page_number">,
>(sheets: T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const sheet of sheets) {
    const key = sheetIdentityKey(sheet.source_document_id, sheet.page_number);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(sheet);
  }
  return kept;
}
