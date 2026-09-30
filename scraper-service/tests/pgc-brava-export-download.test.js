"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const pgc = require("../pgc-eplan-scraper.js");

const PUBLISH_URL =
  "https://eplans.princegeorgescountymd.gov:8443/BravaServer/publishtoformat/DOC/export1/pdf";
const PUBLISH_URL_B =
  "https://eplans.princegeorgescountymd.gov:8443/BravaServer/publishtoformat/DOC/export2/pdf";
const FILE = { name: "S-001 - GENERAL NOTES.pdf", fileId: "4997841" };

function pdfBuffer() {
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.alloc(600, 0x20),
  ]);
}

describe("pgcSelectBravaExportCapture", () => {
  it("keeps the legacy publishtoformat PDF response path", () => {
    const selected = pgc.pgcSelectBravaExportCapture({
      publishUrl: PUBLISH_URL,
      fileMeta: FILE,
    });
    assert.equal(selected.action, "publish_url");
    assert.equal(selected.url, PUBLISH_URL);
    assert.equal(selected.buffer, undefined);
    assert.equal(selected.fileId, "4997841");
    assert.equal(selected.fileName, FILE.name);
    const valid = pgc.isValidPgcPublishedPdf(
      {
        url: selected.url,
        status: 200,
        contentType: "application/pdf",
        byteLength: pdfBuffer().length,
        buffer: pdfBuffer(),
      },
      FILE,
    );
    assert.equal(valid.ok, true);
  });

  it("accepts a browser download of the publishtoformat PDF", () => {
    const buf = pdfBuffer();
    const selected = pgc.pgcSelectBravaExportCapture({
      downloadUrl: PUBLISH_URL,
      downloadBuffer: buf,
      fileMeta: FILE,
    });
    assert.equal(selected.action, "browser_download");
    assert.equal(selected.url, PUBLISH_URL);
    assert.equal(selected.buffer, buf);
    assert.ok(selected.buffer.length > 0);
    assert.equal(selected.fileId, "4997841");
    const valid = pgc.isValidPgcPublishedPdf(
      {
        url: selected.url,
        status: 200,
        contentType: "application/pdf",
        contentDisposition: 'inline; filename="S-001 - GENERAL NOTES.pdf V1.pdf"',
        byteLength: buf.length,
        buffer: buf,
      },
      FILE,
    );
    assert.equal(valid.ok, true);
  });

  it("selects nothing when neither mechanism produced a PDF", () => {
    assert.equal(
      pgc.pgcSelectBravaExportCapture({ fileMeta: FILE }).action,
      "none",
    );
    assert.equal(
      pgc.pgcSelectBravaExportCapture({
        downloadUrl: PUBLISH_URL,
        downloadBuffer: Buffer.alloc(0),
        fileMeta: FILE,
      }).action,
      "none",
    );
    assert.equal(
      pgc.pgcSelectBravaExportCapture({
        downloadUrl: "https://eplans.example/BravaServer/searchindices/foo",
        downloadBuffer: pdfBuffer(),
        fileMeta: FILE,
      }).action,
      "none",
    );
    assert.equal(
      pgc.pgcSelectBravaExportCapture({
        downloadUrl: PUBLISH_URL,
        downloadBuffer: Buffer.from("<html>not a pdf</html>"),
        fileMeta: FILE,
      }).action,
      "none",
    );
  });

  it("uses only the legacy URL when both mechanisms fire", () => {
    const buf = pdfBuffer();
    const selected = pgc.pgcSelectBravaExportCapture({
      publishUrl: PUBLISH_URL,
      downloadUrl: PUBLISH_URL,
      downloadBuffer: buf,
      fileMeta: FILE,
    });
    assert.equal(selected.action, "publish_url");
    assert.equal(selected.buffer, undefined);
  });

  it("does not select a publish URL or download that was already captured", () => {
    const norm = pgc.pgcNormalizePublishUrl(PUBLISH_URL);
    const used = new Set([norm]);
    const selected = pgc.pgcSelectBravaExportCapture({
      publishUrl: PUBLISH_URL,
      downloadUrl: PUBLISH_URL,
      downloadBuffer: pdfBuffer(),
      usedPublishedPdfUrls: used,
      fileMeta: FILE,
    });
    assert.equal(selected.action, "duplicate");
    assert.equal(selected.norm, norm);
    assert.equal(selected.fileId, "4997841");
  });

  it("still accepts a new download when a different publish URL was already used", () => {
    const used = new Set([pgc.pgcNormalizePublishUrl(PUBLISH_URL)]);
    const buf = pdfBuffer();
    const selected = pgc.pgcSelectBravaExportCapture({
      publishUrl: PUBLISH_URL,
      downloadUrl: PUBLISH_URL_B,
      downloadBuffer: buf,
      usedPublishedPdfUrls: used,
      fileMeta: FILE,
    });
    assert.equal(selected.action, "browser_download");
    assert.equal(selected.url, PUBLISH_URL_B);
    assert.equal(selected.buffer, buf);
  });
});
