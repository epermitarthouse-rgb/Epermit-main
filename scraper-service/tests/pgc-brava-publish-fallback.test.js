"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const pgc = require("../pgc-eplan-scraper.js");

const SAMPLE_PDF_URL =
  "https://projectdox.example.com:8443/BravaServer/publishtoformat/5113098/export1/pdf";
const SAMPLE_PDF_URL_B =
  "https://projectdox.example.com:8443/BravaServer/publishtoformat/5113099/export2/pdf";
const NOISE_URL =
  "https://projectdox.example.com:8443/BravaServer/searchindices/foo";

describe("isPgcBravaPublishToPdfUrl", () => {
  it("accepts Brava publishtoformat PDF paths", () => {
    assert.equal(pgc.isPgcBravaPublishToPdfUrl(SAMPLE_PDF_URL), true);
  });

  it("rejects non-publish Brava URLs", () => {
    assert.equal(pgc.isPgcBravaPublishToPdfUrl(NOISE_URL), false);
  });
});

describe("pgcPickBravaPublishPdfFromFallbackChannels", () => {
  it("prefers primary-style empty result when no channels have a publish URL", () => {
    const r = pgc.pgcPickBravaPublishPdfFromFallbackChannels({
      events: [{ url: NOISE_URL, source: "response", capturedAt: Date.now() }],
      pageUrls: ["https://projectdox.example.com/ActiveXViewer.aspx"],
      frameUrls: ["about:blank"],
    });
    assert.equal(r.found, null);
    assert.equal(r.channelsChecked.capture_events, 1);
    assert.equal(r.channelsChecked.page_urls, 1);
    assert.equal(r.channelsChecked.frame_urls, 1);
  });

  it("captures URL from popup/new-page network response when primary would miss", () => {
    const r = pgc.pgcPickBravaPublishPdfFromFallbackChannels({
      events: [
        {
          url: SAMPLE_PDF_URL,
          source: "response",
          capturedAt: Date.now(),
          status: 200,
        },
      ],
      pageUrls: [],
      frameUrls: [],
    });
    assert.ok(r.found);
    assert.equal(r.found.url, SAMPLE_PDF_URL);
    assert.match(r.found.source, /fallback_response/);
    assert.equal(r.found.status, 200);
  });

  it("captures URL from popup/new page URL channel", () => {
    const r = pgc.pgcPickBravaPublishPdfFromFallbackChannels({
      events: [],
      pageUrls: [SAMPLE_PDF_URL_B],
      frameUrls: [],
    });
    assert.ok(r.found);
    assert.equal(r.found.url, SAMPLE_PDF_URL_B);
    assert.equal(r.found.source, "fallback_tab");
  });

  it("captures URL from frame URL on a non-viewer page", () => {
    const r = pgc.pgcPickBravaPublishPdfFromFallbackChannels({
      events: [],
      pageUrls: ["https://projectdox.example.com/ActiveXViewer.aspx"],
      frameUrls: [SAMPLE_PDF_URL],
    });
    assert.ok(r.found);
    assert.equal(r.found.url, SAMPLE_PDF_URL);
    assert.equal(r.found.source, "fallback_frame");
  });

  it("ignores pre-publish snapshot and already-used publish URLs", () => {
    const norm = pgc.pgcNormalizePublishUrl(SAMPLE_PDF_URL);
    const r = pgc.pgcPickBravaPublishPdfFromFallbackChannels(
      {
        events: [
          { url: SAMPLE_PDF_URL, source: "response", capturedAt: Date.now() },
        ],
        pageUrls: [SAMPLE_PDF_URL],
        frameUrls: [],
      },
      {
        prePublishSnapshot: new Set([norm]),
        usedPublishedPdfUrls: new Set(),
      },
    );
    assert.equal(r.found, null);

    const r2 = pgc.pgcPickBravaPublishPdfFromFallbackChannels(
      {
        events: [
          { url: SAMPLE_PDF_URL, source: "response", capturedAt: Date.now() },
        ],
      },
      { usedPublishedPdfUrls: new Set([norm]) },
    );
    assert.equal(r2.found, null);
  });

  it("ignores network events captured before exportStartedAt", () => {
    const exportStartedAt = Date.now();
    const r = pgc.pgcPickBravaPublishPdfFromFallbackChannels(
      {
        events: [
          {
            url: SAMPLE_PDF_URL,
            source: "response",
            capturedAt: exportStartedAt - 5000,
          },
        ],
      },
      { exportStartedAt },
    );
    assert.equal(r.found, null);
  });

  it("documents that primary path is separate: empty fallback does not invent a URL", () => {
    // Simulates successful primary detection: responseRecords would have the URL,
    // but fallback channels are empty — picker must not fabricate a hit.
    const r = pgc.pgcPickBravaPublishPdfFromFallbackChannels({
      events: [],
      pageUrls: [],
      frameUrls: [],
    });
    assert.equal(r.found, null);
    assert.deepEqual(r.channelsChecked, {
      capture_events: 0,
      page_urls: 0,
      frame_urls: 0,
    });
  });
});

describe("pgcFallbackSourceToLogSource", () => {
  it("maps channel labels onto tab/frame/network", () => {
    assert.equal(pgc.pgcFallbackSourceToLogSource("fallback_response"), "network");
    assert.equal(pgc.pgcFallbackSourceToLogSource("fallback_request"), "network");
    assert.equal(pgc.pgcFallbackSourceToLogSource("fallback_frame"), "frame");
    assert.equal(pgc.pgcFallbackSourceToLogSource("fallback_tab"), "tab");
    assert.equal(pgc.pgcFallbackSourceToLogSource("popup_or_new_page"), "tab");
  });
});
