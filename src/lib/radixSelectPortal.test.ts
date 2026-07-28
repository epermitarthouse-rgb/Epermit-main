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
  it("detects select listbox / viewport / option portal nodes so popover dismiss can be blocked", () => {
    assert.equal(
      isRadixSelectPortalTarget(fakeElement('[role="listbox"]')),
      true,
    );
    assert.equal(
      isRadixSelectPortalTarget(fakeElement("[data-radix-select-viewport]")),
      true,
    );
    assert.equal(
      isRadixSelectPortalTarget(fakeElement('[role="option"]')),
      true,
    );
    assert.equal(
      isRadixSelectPortalTarget(
        fakeElement("[data-radix-popper-content-wrapper]"),
      ),
      true,
    );
  });

  it("resolves text-node targets via parentElement", () => {
    const parent = fakeElement('[role="option"]');
    const textNode = {
      parentElement: parent,
    } as unknown as EventTarget;
    assert.equal(isRadixSelectPortalTarget(textNode), true);
  });

  it("does not treat ordinary clicks as select portal", () => {
    assert.equal(isRadixSelectPortalTarget(fakeElement(null)), false);
    assert.equal(isRadixSelectPortalTarget(null), false);
  });
});
