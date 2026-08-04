# McDonald's executive demo — screenshot coverage

Copied from the completed package (`mcdonals demo package/images/`) on 2026-07-31.

## Present (24 files)

| Set | Files | Notes |
| --- | --- | --- |
| Desktop 1280×1800 | `desktop-01…04` | `01` = tour auto-start |
| Tablet 834×1500 | `tablet-01…03` only | **Missing `tablet-04…06`** |
| Mobile 390×1400 | `mobile-01…08` | Duplicates named `(1)` omitted |
| Guided tour | `tour-step-01…09` | All nine steps |

## Missing tablet frames (do not invent)

Package is missing `tablet-04-scroll.png`, `tablet-05-scroll.png`, and `tablet-06-scroll.png`.

Conservative derivation from adjacent evidence (not shipped as fabricated screenshots):

- **tablet-04** — Likely mid-page agent lanes / utility board after `tablet-03` (agents begin stacking on tablet). Align with `desktop-03` + `mobile-04…05` section order.
- **tablet-05** — Likely portfolio table + ROI cards. Align with `desktop-03…04` and `mobile-06…07`.
- **tablet-06** — Likely rollout + bottom CTA. Align with `desktop-04` and `mobile-08`.

**Uncertainty:** Exact tablet breakpoints, column counts, and scroll offsets for frames 04–06 are unverified. Use live responsive layout (`DemoMcDonalds.tsx`) as source of truth until recaptured.

## Brand / legal

Screenshots show McDonald's branding and illustrative KPIs. Brand clearance is **not confirmed** — keep internal-only.
