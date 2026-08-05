import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getExpandedReportCardLayoutClasses,
  reportCardLayoutAvoidsOverflow,
} from "./portalReportCardLayout.ts";

describe("portalReportCardLayout", () => {
  it("uses responsive full-width classes without fixed pixel widths/heights", () => {
    const classes = getExpandedReportCardLayoutClasses();
    assert.equal(reportCardLayoutAvoidsOverflow(classes), true);
    assert.match(classes.title, /break-words/);
    assert.match(classes.actionRow, /flex-col/);
    assert.match(classes.previewImg, /w-full/);
    assert.match(classes.previewImg, /h-auto/);
    assert.match(classes.previewWrap, /overflow-x-hidden/);
  });

  it("rejects layouts with fixed width overflow risks", () => {
    const bad = getExpandedReportCardLayoutClasses();
    bad.root = "w-[720px] h-[400px]";
    assert.equal(reportCardLayoutAvoidsOverflow(bad), false);
  });
});
