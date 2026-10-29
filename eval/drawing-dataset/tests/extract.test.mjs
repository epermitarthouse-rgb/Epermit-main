import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyPdfFailure, extractPdfFile, linesFromItems } from "../lib/pdfExtract.mjs";
import { drawingPdf } from "./helpers.mjs";

describe("pdf extraction", () => {
  it("keeps symbols in line text and splits wide gaps", () => {
    const lines = linesFromItems([
      { text: "36\"", x: 10, y: 100, w: 12, h: 8 },
      { text: "CLEAR", x: 28, y: 100, w: 30, h: 8 },
      { text: "Ø12", x: 200, y: 100, w: 20, h: 8 },
    ]);
    assert.equal(lines.length, 2);
    assert.match(lines[0].text, /36"/);
    assert.match(lines[1].text, /Ø12/);
  });

  it("classifies password and corrupt failures without treating them as empty extracts", () => {
    assert.equal(classifyPdfFailure({ name: "PasswordException", message: "No password given" }).status, "password_protected");
    assert.equal(classifyPdfFailure({ name: "InvalidPDFException", message: "Invalid PDF structure." }).status, "unreadable");
  });

  it("accounts for every page of a multi-page file, including a graphic page and a corrupt file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "drawing-extract-"));
    try {
      const pdfPath = path.join(root, "A-1.00-00.pdf");
      await writeFile(pdfPath, await drawingPdf());
      const extracted = await extractPdfFile(pdfPath);
      assert.equal(extracted.openStatus, "opened");
      assert.equal(extracted.pageCount, 2);
      assert.equal(extracted.pages.length, 2);
      const notes = extracted.pages[0];
      assert.ok(notes.textChars > 20);
      assert.match(notes.pageText, /A-1\.00-00/);
      assert.match(notes.pageText, /36 IN/);
      assert.equal(notes.items.every((item) => item.origin === "machine_extracted"), true);
      const graphic = extracted.pages[1];
      assert.equal(graphic.textChars, 0);
      assert.equal(graphic.visualStatus, "measured");
      assert.ok(graphic.unresolvedRegions.length > 0);
      assert.equal(graphic.captureClass, "partial_unread_ink");

      const corruptPath = path.join(root, "corrupt.pdf");
      await writeFile(corruptPath, Buffer.from("%PDF-1.4\nthis is not a pdf"));
      const corrupt = await extractPdfFile(corruptPath);
      assert.equal(corrupt.openStatus, "unreadable");
      assert.equal(corrupt.pages.length, 0);
      assert.equal(corrupt.pageCount, null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
