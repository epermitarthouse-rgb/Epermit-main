import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inventorySource, parseZipBuffer } from "../lib/inventory.mjs";
import { storedZip } from "./helpers.mjs";

describe("source inventory", () => {
  it("records every file, duplicate bytes, duplicate names, unexpected files, and zip members", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "drawing-inventory-"));
    try {
      const pdf = Buffer.from("%PDF-1.4\n%not-a-real-body\n");
      await writeFile(path.join(root, "A-1.00-00.pdf"), pdf);
      await mkdir(path.join(root, "copy"));
      await writeFile(path.join(root, "copy", "A-1.00-00.pdf"), pdf);
      await mkdir(path.join(root, "other-name"));
      await writeFile(path.join(root, "other-name", "Sheet.pdf"), Buffer.from("%PDF-1.4\n%different\n"));
      await writeFile(path.join(root, "notes.txt"), Buffer.from("not a drawing"));
      await writeFile(path.join(root, "Archive.zip"), storedZip([{ name: "A-1.00-00.pdf", data: pdf }]));
      await mkdir(path.join(root, "empty-dir"));

      const inventory = await inventorySource(root);
      assert.equal(inventory.walkedFiles, inventory.files.length);
      assert.equal(inventory.counts.files, 5);
      assert.equal(inventory.counts.pdf, 3);
      assert.equal(inventory.counts.zip, 1);
      assert.equal(inventory.counts.other, 1);
      assert.deepEqual(inventory.emptyDirectories, ["empty-dir"]);

      const notes = inventory.files.find((file) => file.filename === "notes.txt");
      assert.equal(notes.processingStatus, "unexpected_format");
      assert.ok(notes.sha256);

      const zip = inventory.files.find((file) => file.format === "zip");
      assert.equal(zip.processingStatus, "container_indexed");
      assert.equal(zip.zipEntries.length, 1);
      assert.equal(zip.zipEntries[0].name, "A-1.00-00.pdf");
      assert.equal(zip.zipEntries[0].encrypted, false);

      assert.equal(inventory.duplicateGroups.length, 1);
      assert.equal(inventory.duplicateNames.length, 1);
      const duplicate = inventory.files.find((file) => file.relativePath === "copy/A-1.00-00.pdf");
      assert.equal(duplicate.duplicateOf, "A-1.00-00.pdf");
      const rootPdf = inventory.files.find((file) => file.relativePath === "A-1.00-00.pdf");
      assert.equal(rootPdf.duplicateOf, null);
      assert.equal(rootPdf.processingStatus, "inventoried");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports an unreadable zip instead of dropping it", () => {
    const parsed = parseZipBuffer(Buffer.from("not a zip"));
    assert.equal(parsed.parsed, false);
    assert.equal(parsed.reason, "zip_eocd_missing");
  });
});
