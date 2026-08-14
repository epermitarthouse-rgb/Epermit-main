# ADR: UCI Hybrid Architecture with Foundation-First Delivery

- **Status:** Approved
- **Decision:** Option C — Hybrid + foundation-first
- **Date:** 2026-08-13
- **Reference:** Prior recommendation and foundation-first addendum from agent `9aea0142`

## Context

PermitPilot's UCI backend models utility coordination as a project-owned domain. A project may require multiple utility providers, service types, and scopes, so one project owns many coordination records. The product must expose that hierarchy without turning every lifecycle stage or technical capability into a competing top-level module.

The approved recommendation combines a selected-project command center, durable record workspaces, and a limited set of genuinely cross-project operational views. It also clarifies that advanced UCI areas are not out of scope merely because final client rules are unresolved.

## Decision

### Domain and navigation hierarchy

The canonical hierarchy is:

```text
Project
└── Coordination records (many)
    └── Provider + utility type + scope + ten-stage lifecycle
```

- `/uci` is the selected-project command center. It emphasizes project context, utility coverage, attention, coordination records, stage distribution/progress, next actions, and setup when records do not exist.
- A coordination record has a deep-linkable full-page workspace as its canonical authoring and operational home.
- A drawer remains available as a quick preview from project and cross-project views.
- Stages are lifecycle structure within a record, not permanent sidebar modules.
- The UCI Builder is folded into Stages 2–4: load/profile inputs, document preparation, application package construction, review, and dry-run validation. `/uci/application-builder` remains only as a secondary guided entry or alias to that record workflow.

### Cross-project operational views

Only work that is genuinely useful across projects is promoted to a durable cross-project destination:

- Portfolio
- Needs Attention
- Inbox
- Submissions
- Provider Directory
- Portal Harvest

These views deep-link back to the owning project and coordination record. Until tenant-wide aggregation APIs exist, they must clearly identify project-scoped results or show truthful foundation empty states.

Portal Harvest follows a stricter ownership boundary:

```text
Provider account harvest
→ discovered external utility applications
→ explicit, human-confirmed PermitPilot project + coordination-record link
→ coordination record consumes only its linked application data
```

An account-wide scrape is never assigned wholesale to the coordination record that initiated discovery. Match suggestions may use external IDs, addresses, and names, but ambiguous suggestions are not linked automatically.

### Foundation-first advanced areas

The following foundations remain visible and structurally represented now:

- Class of Service, including a strict advisory/predicted versus utility-issued distinction
- CIAC & Refunds, defaulting to `NOT_ASSESSED`
- Energization
- Miss Utility 811
- Knowledge/history search
- Conflicts
- Utility Territory Map

Advanced behavior defaults to manual, human-gated, and configurable. The architecture provides honest UI shells, navigation slots, typed configuration/status vocabulary, metadata or milestone extension points, and links into project/record context. It does not claim that an unsupported workflow is automated.

QuickBooks authority and portfolio permissions follow the same extension model: establish explicit authority/permission boundaries now, but require configured authorization and human confirmation before side effects.

### Working modules, foundation shells, and contextual-only capabilities

- **Working modules:** project command center, provider setup/resolution, coordination records, load/profile, documents, application preparation, communications, COS analysis, costs/equipment, meter set, closeout, lifecycle, and existing portal sync.
- **Foundation shells:** cross-project operational views and the advanced areas listed above where a complete backend is not yet available.
- **Contextual-only:** stage-specific work and provider-specific technical tools. These remain inside the coordination-record workspace and are not duplicated in the permanent sidebar.

The municipal Jurisdiction Map is not labeled or presented as a Utility Territory Map. Provider Compare remains a municipal comparison capability unless it is separately redesigned around utility providers and territory data.

## Pilot defaults and extension model

- Existing UCI APIs and services remain the source of working behavior.
- Electric territory resolution may provide an auditable suggestion; a human confirms it once.
- Unsupported service types use explicit manual provider selection and confirmation.
- A confirmed provider is automatically selected for record initialization. Additional providers/scopes remain explicit.
- Initialization remains idempotent and uses the existing project coordination initialization service.
- Predictive COS is advisory only until utility-issued evidence exists.
- CIAC refund status begins as `NOT_ASSESSED`; no formulas or eligibility rules are inferred.
- Miss Utility 811 is manual/human-gated; no automatic filing is claimed.
- Accounting integration does not auto-post.
- Live utility application submission remains disabled unless a future, separately approved human-confirmed workflow enables it.
- Prefer version-controlled types and configuration plus existing metadata/milestones. Add database migrations only when durable querying or integrity cannot reasonably be supported otherwise.

## Non-goals

This decision explicitly rejects:

- fake completeness or interfaces that imply unsupported behavior is live;
- invented utility, refund, prediction, filing, accounting, or permission rules;
- mock KPIs or hardcoded operational metrics;
- claims of live automation without a connected, verified service;
- enabling Stage 4 live submission in this delivery batch;
- rewriting existing backend agents or breaking existing initialization/idempotency.

## Consequences

The product gains a stable information architecture that can grow with client input without hiding important domains. Some destinations are intentionally foundation shells; they must disclose scope, data source, and human-gated status. Record work becomes easier to deep-link and less dependent on an oversized drawer, while the drawer remains useful for fast triage.

## Implementation status: architecture plan complete (foundations)

The approved product information architecture and its foundation surfaces are implemented.

- **Active:** `/uci` selected-project command center; stage + state matrix; next action, coverage, attention, and records; deep-linkable record workspaces; provider directory; best-effort cross-project Portfolio, Needs Attention, Inbox, and Submissions aggregation; existing setup, provider resolution, load/profile, document, application-package dry run, communications, issued COS analysis, costs/equipment, meter set, closeout, lifecycle, and portal-sync services.
- **Foundation:** predictive COS evidence is separated into advisory, utility-issued, and discrepancy states; Knowledge searches accessible project/record/communication history; Utility Territory Map reports utility provider-resolution evidence and territory health only.
- **Manual:** CIAC refund assessment starts at `NOT_ASSESSED`; Miss Utility 811 tickets, conflicts, Easement/ROW, and Inspection Release use lightweight browser-local persistence hooks; QuickBooks authority is `DRAFT_HUMAN_APPROVAL` and never auto-posts.
- **Cross-project limitation:** aggregation fans out over the projects visible to the current user and reports partial project-fetch failures. It does not claim tenant completeness where an API call is unavailable, and it does not derive unsupported KPIs.
- **Workspace boundary:** the full record route groups working panels by lifecycle (Setup; Load, Application & Submission; Utility Response; Costs; Energization & Closeout; Activity & Automation). The drawer remains a preview with a link to the canonical workspace.

This status means the architecture and extension points are delivered, not that later agent phases or client-specific business rules are complete. Live PEPCO submission, automatic 811 filing, predictive formulas, refund formulas, accounting auto-posting, and full Phase 1–3 agent depth remain intentionally unavailable.

## Next critical path

1. Align UCI navigation and domain boundaries.
2. Make provider setup a single-confirmation flow while preserving territory resolution and idempotent initialization.
3. Establish the full-page coordination-record workspace and retain a drawer preview.
4. Simplify `/uci` into the selected-project command center and replace furthest-stage framing with record completion/risk signals.
5. Consolidate Builder behavior into Stages 2–4 and retain dry-run-only safety.
6. Add honest cross-project foundation views that deep-link to project/record context.
7. Add scalable shells and typed/configurable hooks for COS, CIAC/refunds, energization, Miss Utility, Knowledge, Conflicts, and Utility Territory Map.
8. Validate navigation, setup, routes, working record capabilities, and the absence of live submission before advancing to later batches.
