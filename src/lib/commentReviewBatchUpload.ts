import {
  isLegacyXlsFile,
  LEGACY_XLS_ERROR_MESSAGE,
} from "@/utils/extractDocumentText";

export type BatchFileStatus =
  | "pending"
  | "uploading"
  | "converting"
  | "extracting"
  | "parsing"
  | "success"
  | "failed";

export interface PendingUploadFile {
  id: string;
  file: File;
  status: BatchFileStatus;
  error?: string;
  commentCount?: number;
  sourceDocumentId?: string;
  parseMethod?: string;
}

export function newBatchFileId(): string {
  return crypto.randomUUID();
}

export function createPendingUploadFile(file: File): PendingUploadFile {
  return {
    id: newBatchFileId(),
    file,
    status: "pending",
  };
}

export type CommentLetterValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export function validateCommentLetterFile(file: File): CommentLetterValidationResult {
  if (isLegacyXlsFile(file) || file.type === "application/vnd.ms-excel") {
    return { valid: false, error: LEGACY_XLS_ERROR_MESSAGE };
  }
  return { valid: true };
}

/** Map errors to user-safe messages without exposing internal details. */
export function formatBatchParseError(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message.trim();
    if (!message) return "Processing failed";
    if (/^(Missing|Select|Failed to|Unsupported|Legacy|Authentication|Conversion|Document|File)/i.test(message)) {
      return message;
    }
    if (message.length <= 200 && !/stack|supabase|postgres|internal/i.test(message)) {
      return message;
    }
  }
  return "Processing failed. Check the file format and try again.";
}

export function batchFileStatusLabel(status: BatchFileStatus): string {
  switch (status) {
    case "pending":
      return "Ready";
    case "uploading":
      return "Uploading…";
    case "converting":
      return "Converting legacy Word document…";
    case "extracting":
      return "Extracting text…";
    case "parsing":
      return "Parsing & classifying…";
    case "success":
      return "Complete";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}
