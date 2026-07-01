import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import { supabase } from "@/lib/supabase";

export interface ConvertLegacyWordResult {
  originalFileName: string;
  convertedFileName: string;
  contentType: string;
  file: File;
}

function base64ToFile(base64: string, fileName: string, contentType: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: contentType });
}

export async function convertLegacyWordDocument(options: {
  projectId: string;
  sourceDocumentId: string;
  timeoutMs?: number;
}): Promise<ConvertLegacyWordResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("Authentication required");
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getScraperBaseUrl()}/api/documents/convert-legacy-word`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: options.projectId,
        sourceDocumentId: options.sourceDocumentId,
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          originalFileName?: string;
          convertedFileName?: string;
          contentType?: string;
          fileBase64?: string;
        }
      | null;

    if (response.status === 401) {
      throw new Error("Authentication failed");
    }

    if (!response.ok) {
      throw new Error(payload?.error || "Legacy Word conversion failed");
    }

    if (!payload?.fileBase64 || !payload.convertedFileName || !payload.contentType) {
      throw new Error("Legacy Word conversion returned an invalid response");
    }

    const file = base64ToFile(payload.fileBase64, payload.convertedFileName, payload.contentType);
    if (file.size === 0) {
      throw new Error("Legacy Word conversion returned an empty file");
    }

    return {
      originalFileName: payload.originalFileName || options.sourceDocumentId,
      convertedFileName: payload.convertedFileName,
      contentType: payload.contentType,
      file,
    };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Timed out during conversion");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
