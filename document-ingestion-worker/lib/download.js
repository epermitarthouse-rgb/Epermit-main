"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

const BUCKET = "project-documents";

async function downloadToTempFile(supabase, filePath, fileName, tempDir) {
  const dir = tempDir || os.tmpdir();
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const tempPath = path.join(dir, `ingest_${Date.now()}_${safeName}`);

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, 3600);

  if (signError || !signed?.signedUrl) {
    throw new Error(signError?.message ?? "Failed to create signed download URL");
  }

  let response;
  try {
    response = await fetch(signed.signedUrl);
  } catch (err) {
    const { summarizeFetchError, formatFetchErrorLine } = require("./netErrors");
    const summary = summarizeFetchError(err, signed.signedUrl);
    const wrapped = new Error(`Storage download fetch failed: ${formatFetchErrorLine(summary)}`);
    wrapped.cause = err;
    wrapped.workerFetchSummary = summary;
    throw wrapped;
  }
  if (!response.ok || !response.body) {
    let bodyPrefix = "";
    try {
      bodyPrefix = (await response.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Storage download failed (${response.status})${bodyPrefix ? `: ${bodyPrefix}` : ""}`,
    );
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath));
  return tempPath;
}

async function removeTempFile(tempPath) {
  if (!tempPath) return;
  try {
    await fs.promises.unlink(tempPath);
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.warn("[worker] temp cleanup failed:", err.message);
    }
  }
}

module.exports = { downloadToTempFile, removeTempFile };
