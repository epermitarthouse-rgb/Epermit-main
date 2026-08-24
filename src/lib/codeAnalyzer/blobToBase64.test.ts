import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

describe("blobToBase64", () => {
  const originalFileReader = globalThis.FileReader;

  before(() => {
    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: ((err: unknown) => void) | null = null;

      readAsDataURL(blob: Blob) {
        void blob
          .arrayBuffer()
          .then((buffer) => {
            const base64 = Buffer.from(buffer).toString("base64");
            const type = blob.type || "application/octet-stream";
            this.result = `data:${type};base64,${base64}`;
            this.onload?.();
          })
          .catch((err) => this.onerror?.(err));
      }
    }

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
  });

  after(() => {
    globalThis.FileReader = originalFileReader;
  });

  it("encodes blob bytes via FileReader without a synchronous byte loop", async () => {
    const { blobToBase64 } = await import("./blobToBase64.ts");
    const blob = new Blob([new Uint8Array([72, 101, 108, 108, 111])], { type: "text/plain" });
    const encoded = await blobToBase64(blob);
    assert.equal(encoded, Buffer.from("Hello").toString("base64"));
  });
});
