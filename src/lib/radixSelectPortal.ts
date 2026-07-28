/**
 * Select Content portals outside PopoverContent. Callers can use this to avoid
 * treating select-menu clicks as popover "outside" dismiss events.
 */
export function isRadixSelectPortalTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as Element;
  return Boolean(
    el.closest("[data-radix-select-content]") ||
      el.closest("[data-radix-select-viewport]") ||
      el.closest('[role="listbox"]'),
  );
}
