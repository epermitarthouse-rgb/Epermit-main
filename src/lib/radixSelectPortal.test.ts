import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRadixSelectPortalTarget } from "./radixSelectPortal.ts";

function fakeElement(closestMatch: string | null): Element {
  return {
    closest(selector: string) {
      if (!closestMatch) return null;
      return selector === closestMatch ? (this as unknown as Element) : null;
    },
  } as unknown as Element;
}

describe("isRadixSelectPortalTarget", () => {
  it("detects select listbox portal nodes so popover dismiss can be blocked", () => {
    assert.equal(
      isRadixSelectPortalTarget(fakeElement('[role="listbox"]')),
      true,
    );
    assert.equal(
      isRadixSelectPortalTarget(fakeElement("[data-radix-select-content]")),
      true,
    );
  });

  it("does not treat ordinary clicks as select portal", () => {
    assert.equal(isRadixSelectPortalTarget(fakeElement(null)), false);
    assert.equal(isRadixSelectPortalTarget(null), false);
  });
});
