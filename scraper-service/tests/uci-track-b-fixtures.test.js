"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../fixtures/track-b");

describe("Track B synthetic fixtures", () => {
  it("ships required PDFs and classifier emails", () => {
    const pdfs = [
      "ciac-estimate-cos.pdf",
      "ciac-invoice-match.pdf",
      "ciac-invoice-8pct.pdf",
      "ciac-invoice-18pct.pdf",
      "ciac-invoice-25pct.pdf",
      "final-meter-reading.pdf",
      "commissioning-signoff.pdf",
      "paid-receipt.pdf",
    ];
    const emails = [
      "ciac-invoice.eml",
      "equipment-eta.eml",
      "inspection-release-request.eml",
      "meter-set.eml",
      "meter-set-noshow.eml",
      "energization.eml",
    ];
    for (const name of pdfs) {
      const buf = fs.readFileSync(path.join(ROOT, name));
      assert.equal(buf.slice(0, 4).toString(), "%PDF");
    }
    for (const name of emails) {
      const text = fs.readFileSync(path.join(ROOT, "emails", name), "utf8");
      assert.match(text, /Subject:/);
    }
  });
});
