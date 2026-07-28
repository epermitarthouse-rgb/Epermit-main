/**
 * Select Content portals outside PopoverContent. Callers can use this to avoid
 * treating select-menu clicks as popover "outside" dismiss events.
 *
 * Note: Radix Select does not set `data-radix-select-content` — the content node
 * uses role="listbox" and the viewport uses `data-radix-select-viewport`.
 */
export function isRadixSelectPortalTarget(target: EventTarget | null): boolean {
  const el = resolveElement(target);
  if (!el) return false;
  return Boolean(
    el.closest("[data-radix-select-viewport]") ||
      el.closest("[data-radix-select-content]") ||
      el.closest('[role="listbox"]') ||
      el.closest('[role="option"]') ||
      el.closest("[data-radix-popper-content-wrapper]"),
  );
}

function resolveElement(target: EventTarget | null): Element | null {
  if (!target) return null;
  if (typeof (target as Element).closest === "function") {
    return target as Element;
  }
  // Text node inside an option
  const parent = (target as Node).parentElement;
  return parent && typeof parent.closest === "function" ? parent : null;
}
