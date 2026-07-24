#!/usr/bin/env python3
"""Generate the Lovable ↔ PermitPilot architecture matrix (CSV + Markdown).

Input : reference/lovable-ui/architecture-inventory.md  (Lovable columns 1-22, 90 rows)
Output: reference/lovable-ui/lovable-permitpilot-architecture-matrix.csv  (all 57 columns)
        reference/lovable-ui/lovable-permitpilot-architecture-matrix.md   (human-readable)

Documentation only. This script never touches src/ or any application code.

The PermitPilot decision columns (23-57) are hand-curated from the 2026-07-25 audit of
src/App.tsx, src/lib/uciNavSections.ts, src/pages/*, supabase/functions/* and
scraper-service/*. They are data, not inference: edit PP_ROWS below and re-run.
"""

from __future__ import annotations

import csv
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
INVENTORY = REPO / "reference" / "lovable-ui" / "architecture-inventory.md"
OUT_DIR = REPO / "reference" / "lovable-ui"
OUT_CSV = OUT_DIR / "lovable-permitpilot-architecture-matrix.csv"
OUT_MD = OUT_DIR / "lovable-permitpilot-architecture-matrix.md"

BRANCH = "feat/lovable-ui-replication"
AUDIT_DATE = "2026-07-25"

# --------------------------------------------------------------------------------------
# Column contract: 22 Lovable columns + 35 PermitPilot columns = 57
# --------------------------------------------------------------------------------------

LOVABLE_COLS = [
    "Area", "Parent", "Name", "Route", "Type", "Params", "Entry Points",
    "Secondary Entries", "Auth", "Context", "Purpose", "Functionality", "Actions",
    "Tabs", "Modals", "Data Source", "Backend", "Status", "Visibility",
    "Source File", "Route File", "Notes",
]

PP_COLS = [
    "Matrix Row ID",                    # 23
    "PP Equivalent Name",               # 24
    "PP Route(s) Today",                # 25
    "PP Route Exists",                  # 26
    "PP Source File(s)",                # 27
    "PP Nav Entry Point",               # 28
    "PP Auth / Role Gate",              # 29
    "PP Data Source",                   # 30
    "PP Backend Endpoint / Function",   # 31
    "PP Backend Connected",             # 32
    "PP Functional Status",             # 33
    "Match Status",                     # 34
    "Match Confidence",                 # 35
    "UI Parity",                        # 36
    "Functional Parity",                # 37
    "Route Decision",                   # 38
    "Target PP Route (Decided)",        # 39
    "Naming Decision (Label To Use)",   # 40
    "Nav Placement Decision",           # 41
    "Deep Link Pattern",                # 42
    "Lovable-Only Feature",             # 43
    "Fake-Backend Risk",                # 44
    "Preserve-PermitPilot-Logic Notes", # 45
    "Do-Not-Replicate Reason",          # 46
    "Required Backend Work",            # 47
    "Required Frontend Work",           # 48
    "Blocking Dependencies",            # 49
    "Priority",                         # 50
    "Risk",                             # 51
    "Effort",                           # 52
    "Phase",                            # 53
    "Acceptance Criteria",              # 54
    "Test / Verification Hook",         # 55
    "Owner Decision Needed",            # 56
    "Audit Notes",                      # 57
]

ALL_COLS = LOVABLE_COLS + PP_COLS
assert len(ALL_COLS) == 57, f"expected 57 columns, got {len(ALL_COLS)}"

# Short keys used by the PP_ROWS table below, in column order 23-57.
PP_KEYS = [
    "id", "pp_name", "pp_routes", "pp_exists", "pp_files", "pp_nav", "pp_auth",
    "pp_data", "pp_backend", "pp_connected", "pp_status", "match", "confidence",
    "ui_parity", "func_parity", "route_decision", "target_route", "naming",
    "nav_placement", "deep_link", "lovable_only", "fake_risk", "preserve",
    "do_not", "backend_work", "frontend_work", "blockers", "priority", "risk",
    "effort", "phase", "acceptance", "test_hook", "owner_decision", "audit",
]
assert len(PP_KEYS) == len(PP_COLS)

MATCH_ENUM = {
    "Exact match",
    "Strong functional match",
    "Partial match",
    "Same purpose different architecture",
    "UI match only",
    "Backend match only",
    "Missing in PermitPilot",
}
ROUTE_ENUM = {
    "Keep PP route",
    "Add PP route",
    "Alias to PP route",
    "Fold into existing PP surface",
    "Deep link (query param)",
    "Do not build",
    "Defer",
}
PRIORITY_ENUM = {"P0", "P1", "P2", "P3"}
RISK_ENUM = {"Low", "Medium", "High"}
EFFORT_ENUM = {"S", "M", "L", "XL"}

# --------------------------------------------------------------------------------------
# Reusable templates
# --------------------------------------------------------------------------------------

NONE_PP = dict(
    pp_name="— (no PermitPilot equivalent)",
    pp_routes="— (none)",
    pp_exists="No",
    pp_files="— (none)",
    pp_nav="Not present in PermitPilot navigation",
    pp_auth="n/a — surface does not exist",
    pp_data="— (none)",
    pp_backend="None",
    pp_connected="None",
    pp_status="Not implemented",
    match="Missing in PermitPilot",
    confidence="High",
    ui_parity="None — no PermitPilot surface to compare",
    func_parity="None — no PermitPilot domain behind it",
    route_decision="Do not build",
    target_route="— (no route)",
    naming="n/a — label not adopted",
    nav_placement="Omit from PermitPilot navigation",
    deep_link="n/a",
    lovable_only="Yes",
    fake_risk="High — Lovable page is mock; replicating it would ship a convincing but empty surface",
    preserve="No PermitPilot logic exists on this path, so nothing to preserve.",
    backend_work="New domain model, tables, RLS and service layer would be required before any UI work.",
    frontend_work="None. Do not build the UI ahead of a real backend.",
    blockers="No PermitPilot data model; no confirmed client requirement; no owner.",
    priority="P3",
    risk="High",
    effort="XL",
    phase="Out of scope — deferred indefinitely",
    acceptance="No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.",
    test_hook="n/a — nothing to test until scope changes",
    owner_decision="No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.",
)

DEFER_PP = dict(
    NONE_PP,
    route_decision="Defer",
    fake_risk="Medium — plausible future surface, but building it now would require mock data",
    priority="P3",
    risk="Medium",
    effort="L",
    phase="Backlog — revisit after visual alignment phases complete",
    acceptance="No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.",
    owner_decision="Yes — needs a product decision on whether PermitPilot should own this domain",
)


def row(**kw):
    """Build a PP row, defaulting anything unspecified to explicit 'not applicable' text."""
    base = {k: "" for k in PP_KEYS}
    base.update(kw)
    for k in PP_KEYS:
        if not base[k]:
            base[k] = "—"
    return base


def missing(id_, *, reason, **kw):
    d = dict(NONE_PP)
    d["do_not"] = reason
    d.update(kw)
    return row(id=id_, **d)


def deferred(id_, *, reason, **kw):
    d = dict(DEFER_PP)
    d["do_not"] = reason
    d.update(kw)
    return row(id=id_, **d)


UCI_FILES = "src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx"
UCI_AUTH = "Signed-in via ProtectedLayoutRoute; UCI data scoped per project"


def uci_section(id_, *, section, pp_name, support, match, confidence, ui_parity,
                func_parity, priority, risk, effort, phase, preserve, backend_work,
                frontend_work, acceptance, audit, drawer_tab=None, do_not="—",
                blockers="Requires an open coordination record before the drawer tab can render.",
                test_hook="npx vitest run src/pages/uciDashboard.*.test.ts", owner_decision="No",
                route_decision="Deep link (query param)", fake_risk=None, naming=None,
                pp_data=None, pp_backend=None, pp_connected=None):
    """UCI rows all resolve to /uci?section= deep links — never to new /uci/* routes."""
    return row(
        id=id_,
        pp_name=pp_name,
        pp_routes=f"/uci?section={section}" + (f"&tab={drawer_tab}" if drawer_tab else ""),
        pp_exists="Partial — section of /uci, not a standalone route",
        pp_files=UCI_FILES,
        pp_nav=f"Expandable sidebar → Utility Coordination › {pp_name} (UciSidebarNav, support=\"{support}\")",
        pp_auth=UCI_AUTH,
        pp_data=pp_data or "Live scraper + Supabase UCI coordination records (per project)",
        pp_backend=pp_backend or "scraper-service /api/uci; check-portal-status",
        pp_connected=pp_connected or ("Yes" if support == "active" else "Partial"),
        pp_status={"active": "Working", "partial": "Partial", "mock": "Coming-soon panel (labelled, no data)"}[support],
        match=match,
        confidence=confidence,
        ui_parity=ui_parity,
        func_parity=func_parity,
        route_decision=route_decision,
        target_route=f"/uci?section={section}",
        naming=naming or f'Use Lovable label "{pp_name}" in the UCI sidebar',
        nav_placement="UCI expandable sidebar group; no top-level nav entry",
        deep_link=f"uciSectionHref(\"{section}\")" + (f" → tab \"{drawer_tab}\"" if drawer_tab else ""),
        lovable_only="No",
        fake_risk=fake_risk or ("Low — deep link lands on real data" if support != "mock"
                                else "High — must stay a labelled coming-soon panel, never a mock data table"),
        preserve=preserve,
        do_not=do_not,
        backend_work=backend_work,
        frontend_work=frontend_work,
        blockers=blockers,
        priority=priority,
        risk=risk,
        effort=effort,
        phase=phase,
        acceptance=acceptance,
        test_hook=test_hook,
        owner_decision=owner_decision,
        audit=audit,
    )


# --------------------------------------------------------------------------------------
# PermitPilot decision data, keyed by Lovable row id (L001-L090)
# --------------------------------------------------------------------------------------

PP_ROWS = {}


def add(r):
    PP_ROWS[r["id"]] = r


# ---- Public ---------------------------------------------------------------------------

add(row(
    id="L001",
    pp_name="Home (marketing homepage inside app shell)",
    pp_routes="/",
    pp_exists="Yes",
    pp_files="src/components/auth/HomeRoute.tsx; src/pages/Home.tsx; src/components/layout/DashboardLayout.tsx",
    pp_nav="Header → Home; sidebar logo; direct URL",
    pp_auth="Public. Signed-in users are redirected to /dashboard by HomeRoute.",
    pp_data="Static marketing content + LeadCaptureContext",
    pp_backend="None for render; lead capture writes via Supabase",
    pp_connected="Partial",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — both render the homepage inside the authenticated shell; typography, hero and CTA styling differ",
    func_parity="Strong — same purpose, and PermitPilot adds a signed-in redirect Lovable does not have",
    route_decision="Keep PP route",
    target_route="/",
    naming='Keep "Home"',
    nav_placement="Header Home link + logo click; keep out of the primary sidebar list",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="None — static marketing copy is legitimately static",
    preserve="Preserve HomeRoute's signed-in → /dashboard redirect and the LeadCapture modal wiring. Lovable renders Home unconditionally; do not copy that.",
    do_not="Do not copy Lovable's fabricated metrics or logos into PermitPilot marketing copy.",
    backend_work="None.",
    frontend_work="Align hero, section spacing, card and CTA styling with the Lovable homepage using existing PermitPilot components.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="S",
    phase="Phase 2 — public / marketing shell",
    acceptance="Anonymous visit to / renders the restyled homepage inside DashboardLayout; a signed-in visit still redirects to /dashboard; lead capture modal still fires.",
    test_hook="Manual smoke of / signed-out and signed-in; npm run build",
    owner_decision="No",
    audit="Confirmed in src/App.tsx line 80 and HomeRoute.tsx.",
))

add(row(
    id="L002",
    pp_name="Auth (unified sign-in / sign-up page)",
    pp_routes="/auth (with /login redirecting to it)",
    pp_exists="Yes",
    pp_files="src/pages/Auth.tsx; src/App.tsx (redirect at /login)",
    pp_nav="Auth redirect from protected routes; sign-out flow; direct URL",
    pp_auth="Public",
    pp_data="Supabase auth",
    pp_backend="Supabase auth; send-welcome-email",
    pp_connected="Yes",
    pp_status="Working",
    match="Same purpose different architecture",
    confidence="High",
    ui_parity="Partial — Lovable uses a dedicated Login page, PermitPilot uses one Auth page with a view switch",
    func_parity="Strong — email/password sign-in with rejected/pending handling on both sides",
    route_decision="Alias to PP route",
    target_route="/auth (alias /login already in place)",
    naming='Use "Sign in" for the nav/CTA label; keep the route at /auth',
    nav_placement="Not a sidebar entry; reached via redirect and the header sign-in CTA",
    deep_link="/login → /auth (Navigate replace, already implemented)",
    lovable_only="No",
    fake_risk="None",
    preserve="Preserve the whole Supabase auth path: session handling, rejected-member messaging, invite acceptance and the /signup view state. Never restyle by rebuilding the form.",
    do_not="Do not split /auth into separate /login and /signup pages just because Lovable does.",
    backend_work="None.",
    frontend_work="Apply Lovable card, spacing and input styling to the existing Auth form.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="S",
    phase="Phase 1 — foundation / auth surfaces",
    acceptance="Sign-in, sign-up and rejected-member paths all still work; /login still redirects to /auth; no auth logic changed.",
    test_hook="Manual sign-in with a demo account on the Vercel Preview build",
    owner_decision="No",
    audit="src/App.tsx lines 81-83. /login is a Navigate redirect, not a page.",
))

add(row(
    id="L003",
    pp_name="Auth (sign-up view)",
    pp_routes="/signup → /auth with state.authView = \"signup\"",
    pp_exists="Yes",
    pp_files="src/pages/Auth.tsx; src/App.tsx (redirect at /signup)",
    pp_nav="Auth page → Sign up toggle; direct URL",
    pp_auth="Public",
    pp_data="Supabase auth + user_roles pending approval",
    pp_backend="Supabase auth; send-welcome-email",
    pp_connected="Yes",
    pp_status="Working",
    match="Same purpose different architecture",
    confidence="High",
    ui_parity="Partial — same fields, different container (view state vs standalone page)",
    func_parity="Strong — both create a pending auth user awaiting admin approval",
    route_decision="Alias to PP route",
    target_route="/auth (alias /signup already in place)",
    naming='Use "Create account"; keep the route at /auth',
    nav_placement="Reached from the Auth page toggle only",
    deep_link="/signup → /auth with authView=signup (already implemented)",
    lovable_only="No",
    fake_risk="None",
    preserve="Preserve pending-approval semantics and the state-based view switch; do not introduce a second auth component.",
    do_not="Do not create a standalone Signup page.",
    backend_work="None.",
    frontend_work="Style the sign-up view to match Lovable's registration card.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="S",
    phase="Phase 1 — foundation / auth surfaces",
    acceptance="/signup lands on the Auth page already showing the sign-up view; account creation still produces a pending user.",
    test_hook="Manual sign-up with a throwaway demo address on Preview",
    owner_decision="No",
    audit="src/App.tsx line 83 passes state={{ authView: \"signup\" }}.",
))

add(row(
    id="L004",
    pp_name="Contact",
    pp_routes="/contact",
    pp_exists="Yes",
    pp_files="src/pages/Contact.tsx; src/components/layout/MarketingLayout.tsx",
    pp_nav="Marketing nav → Contact; Home CTA; direct URL",
    pp_auth="Public",
    pp_data="Supabase contact_submissions",
    pp_backend="send-contact-email edge function",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — same form intent; PermitPilot wraps it in MarketingLayout, Lovable in PermitPilotShell",
    func_parity="Strong — both write a submission row and trigger a notification email",
    route_decision="Keep PP route",
    target_route="/contact",
    naming='Keep "Contact"',
    nav_placement="Marketing header/footer, matching the other public pages",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="None",
    preserve="Preserve the contact_submissions insert and the send-contact-email invocation exactly.",
    do_not="—",
    backend_work="None.",
    frontend_work="Align form field, label and button styling with Lovable's contact card.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="S",
    phase="Phase 2 — public / marketing shell",
    acceptance="Submitting the restyled form still creates a contact_submissions row and sends the notification email.",
    test_hook="Manual submit on Preview, then verify the row in Supabase",
    owner_decision="No",
    audit="src/App.tsx lines 100-107; supabase/functions/send-contact-email.",
))

# ---- Command --------------------------------------------------------------------------

add(row(
    id="L005",
    pp_name="Dashboard",
    pp_routes="/dashboard",
    pp_exists="Yes",
    pp_files="src/pages/Dashboard.tsx; src/components/auth/ProtectedRoute.tsx; src/components/layout/DashboardLayout.tsx",
    pp_nav="Sidebar → Dashboard; header Home; post-sign-in landing",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Supabase projects, permit applications, deadlines (real user data)",
    pp_backend="Supabase queries; fetch-permit-data; permit-status-monitor",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable adds a KPI band, alert strip and portfolio table styling PermitPilot does not have",
    func_parity="Strong, and PermitPilot is ahead: Lovable's dashboard is entirely fabricated demo data",
    route_decision="Keep PP route",
    target_route="/dashboard",
    naming='Keep "Dashboard"',
    nav_placement="First sidebar entry, as today",
    deep_link="n/a — PermitPilot has no /dashboard/* children",
    lovable_only="No",
    fake_risk="High — the Lovable KPI values are invented; every restyled tile must bind to a real PermitPilot query or be omitted",
    preserve="Preserve all existing Supabase queries, the active-project context and ProtectedLayoutRoute gating. Restyle containers only.",
    do_not="Do not import Lovable's mock dashboard dataset, and do not add nested /dashboard child routes.",
    backend_work="None. Any tile without a real query must be dropped rather than faked.",
    frontend_work="Adopt Lovable's KPI card band, alert strip and portfolio table styling on top of the existing data hooks.",
    blockers="None.",
    priority="P0",
    risk="Medium",
    effort="M",
    phase="Phase 3 — core authenticated surfaces",
    acceptance="/dashboard shows the Lovable-style layout, every number traces to a real query, and no tile renders placeholder values.",
    test_hook="Manual smoke with a demo account that has projects; npm run build; npx tsc --noEmit",
    owner_decision="No",
    audit="src/App.tsx line 122. PermitPilot has no dashboard tab shell.",
))

add(row(
    id="L006",
    pp_name="Dashboard (single Operations view)",
    pp_routes="/dashboard",
    pp_exists="Partial — same page, no index/child split",
    pp_files="src/pages/Dashboard.tsx",
    pp_nav="Sidebar → Dashboard",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Supabase projects and permit applications",
    pp_backend="Supabase queries",
    pp_connected="Yes",
    pp_status="Working",
    match="Partial match",
    confidence="High",
    ui_parity="Partial — the KPI-plus-portfolio-table content exists, but not as a tab under a layout route",
    func_parity="Strong on content; PermitPilot renders it directly instead of through an index route",
    route_decision="Fold into existing PP surface",
    target_route="/dashboard",
    naming='Do not surface "Operations" as a separate label; it is simply the dashboard',
    nav_placement="No separate nav entry",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="High — Lovable explicitly marks this data fabricated",
    preserve="Preserve the single-page structure. Introducing a layout route plus index child adds routing surface for no functional gain.",
    do_not="Do not create a /dashboard index child route or a Dashboard tab bar.",
    backend_work="None.",
    frontend_work="Merge the Lovable operations layout into the existing single Dashboard page (same work as L005).",
    blockers="Depends on L005.",
    priority="P1",
    risk="Low",
    effort="S",
    phase="Phase 3 — core authenticated surfaces",
    acceptance="Operations content is visible on /dashboard with no tab shell and no new routes added.",
    test_hook="Route count check: src/App.tsx still declares exactly one /dashboard route",
    owner_decision="No",
    audit="Lovable splits this into a nested index route; PermitPilot deliberately does not.",
))

add(row(
    id="L007",
    pp_name="UCI Hub",
    pp_routes="/uci",
    pp_exists="Partial — the surface exists at /uci, not under /dashboard",
    pp_files="src/pages/UciDashboard.tsx; src/App.tsx lines 166-175",
    pp_nav="Sidebar → Utility Coordination",
    pp_auth="Signed-in via ProtectedLayoutRoute, wrapped in an ErrorBoundary",
    pp_data="Live scraper + Supabase UCI coordination records",
    pp_backend="scraper-service /api/uci",
    pp_connected="Yes",
    pp_status="Working",
    match="Same purpose different architecture",
    confidence="High",
    ui_parity="Partial — PermitPilot's hub is richer, but it is not embedded as a dashboard tab",
    func_parity="PermitPilot is ahead — Lovable's UCI tab is static mock content",
    route_decision="Fold into existing PP surface",
    target_route="/uci",
    naming='Use "Utility Coordination" in the sidebar',
    nav_placement="Its own expandable sidebar group, not a dashboard tab",
    deep_link="/uci?section=overview",
    lovable_only="No",
    fake_risk="Medium — a dashboard-embedded copy would duplicate the hub and drift from it",
    preserve="Preserve the single canonical /uci entry point and its ErrorBoundary wrapper.",
    do_not="Do not create /dashboard/uci. Lovable's own inventory notes that its /dashboard/uci copy bypasses RequireUciAccess — replicating it would reintroduce a role-gate bypass.",
    backend_work="None.",
    frontend_work="If a dashboard UCI summary is wanted, add a read-only card on /dashboard that links to /uci rather than a second mount of the hub.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="S",
    phase="Phase 3 — core authenticated surfaces",
    acceptance="UCI remains reachable only at /uci; no /dashboard/uci route exists; any dashboard UCI card is a link, not a second mount.",
    test_hook="Grep src/App.tsx for \"dashboard/uci\" — must return no matches",
    owner_decision="No",
    audit="Deliberate divergence: Lovable's alias is a documented security smell.",
))

add(row(
    id="L008",
    pp_name="Projects",
    pp_routes="/projects",
    pp_exists="Yes",
    pp_files="src/pages/Projects.tsx",
    pp_nav="Sidebar → Projects; dashboard links; active-project control",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Supabase projects (real, RLS-scoped)",
    pp_backend="Supabase queries; send-project-team-invitation",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's project cards and filter chrome are more refined",
    func_parity="PermitPilot is ahead — Lovable browses mock cards; PermitPilot does real CRUD with RLS",
    route_decision="Keep PP route",
    target_route="/projects",
    naming='Keep "Projects"',
    nav_placement="Second sidebar entry, as today",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Medium — do not add card fields that PermitPilot's projects table cannot populate",
    preserve="Preserve project CRUD, RLS scoping, team invitations and the active-project selector.",
    do_not="Do not replace the real project list with Lovable's static cards.",
    backend_work="None.",
    frontend_work="Adopt Lovable's card grid, status pills and filter bar on top of the existing project query.",
    blockers="None.",
    priority="P0",
    risk="Low",
    effort="M",
    phase="Phase 3 — core authenticated surfaces",
    acceptance="Project list, create, invite and select flows all behave as before with the new card styling; every card field maps to a real column.",
    test_hook="Manual CRUD smoke with a demo account; npx tsc --noEmit",
    owner_decision="No",
    audit="src/App.tsx line 123.",
))

add(row(
    id="L009",
    pp_name="Portal credential capture (in the filing dialog, not a page)",
    pp_routes="Modal inside /projects and /permit-wizard-filing",
    pp_exists="Partial — capability exists, no dedicated route",
    pp_files="src/components/permit-wizard/StartFilingDialog.tsx; scraper-service/app/routes/portal-credentials.routes.js",
    pp_nav="Projects → start filing; permit wizard entry",
    pp_auth="Signed-in; credentials are tenant-scoped",
    pp_data="Supabase portal_credentials (encrypted)",
    pp_backend="scraper-service portal-credentials routes; check-portal-status",
    pp_connected="Yes",
    pp_status="Working",
    match="Same purpose different architecture",
    confidence="High",
    ui_parity="Partial — Lovable uses a full onboarding page, PermitPilot uses a dialog in the filing flow",
    func_parity="PermitPilot is ahead — Lovable's page is a UI-only placeholder; PermitPilot stores encrypted credentials and validates them",
    route_decision="Fold into existing PP surface",
    target_route="/projects (StartFilingDialog)",
    naming='Use "Portal credentials" as the dialog title',
    nav_placement="No nav entry; contextual to a project",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="High — a standalone credential page that does not actually encrypt and validate would be a security-relevant fake",
    preserve="Preserve encrypted storage, tenant scoping and credential validation via check-portal-status. Credentials must never be handled by new UI code paths.",
    do_not="Do not build a /projects/new credential page; Lovable's version stores nothing.",
    backend_work="None.",
    frontend_work="Restyle the existing dialog using Lovable's form styling.",
    blockers="Security review required for any change that touches credential input.",
    priority="P2",
    risk="Medium",
    effort="M",
    phase="Phase 5 — admin and settings surfaces",
    acceptance="Credential capture still round-trips through the existing encrypted path; no new route and no new credential handling code.",
    test_hook="node --test scraper-service/tests (portal credential coverage); manual filing dialog smoke",
    owner_decision="No",
    audit="portal_credentials confirmed in supabase/migrations/20260210000000_portal_credentials.sql.",
))

add(deferred(
    "L010",
    reason="PermitPilot tracks deadlines and permit status but has no milestone timeline model, so a timeline page would render invented milestones.",
    pp_name="Project deadlines and permit status (partial data only)",
    pp_routes="/dashboard, /projects (deadline surfaces)",
    pp_exists="No — no timeline route",
    pp_files="src/pages/Dashboard.tsx (deadline widgets)",
    pp_data="Supabase deadlines and permit application status",
    pp_backend="permit-status-monitor; send-deadline-reminders",
    pp_connected="Partial",
    pp_status="Adjacent data exists, no timeline surface",
    match="Missing in PermitPilot",
    ui_parity="None — no timeline UI",
    func_parity="Weak — deadline data exists but there is no milestone schema",
    target_route="Undecided — would need /projects/:id/timeline",
    priority="P2",
    risk="Medium",
    effort="L",
    phase="Backlog — after a real /projects/:id detail route exists",
    frontend_work="None until a milestone model exists.",
    backend_work="Define a project milestone schema and derive milestones from real permit and deadline events.",
    blockers="Depends on L012 (a real project detail route) and on a milestone data model.",
    acceptance="Not scoped. Requires a milestone schema, an owner and an update to this row first.",
    audit="Lovable's timeline is mock; PermitPilot's deadline data is real but insufficient to populate it.",
))

add(deferred(
    "L011",
    reason="A Gantt chart needs task dependencies and durations that PermitPilot does not model at all.",
    match="Missing in PermitPilot",
    target_route="Undecided",
    priority="P3",
    risk="Medium",
    effort="L",
    phase="Backlog — lowest tier",
    blockers="Depends on L010 (milestone model) plus a dependency/duration model.",
    audit="No PermitPilot scheduling domain exists.",
))

add(deferred(
    "L012",
    reason="PermitPilot has no per-project detail route yet; Lovable's version is hard-coded to a fake 'alpha' project, which must not be copied.",
    pp_name="Project detail (not implemented; list-only today)",
    pp_routes="/projects (list only)",
    pp_exists="No",
    pp_files="src/pages/Projects.tsx",
    pp_data="Supabase projects",
    pp_connected="Yes (for the list)",
    pp_status="List exists, detail route missing",
    match="Missing in PermitPilot",
    ui_parity="None — no detail page",
    func_parity="Weak — real project rows exist but there is no detail view over them",
    route_decision="Add PP route",
    target_route="/projects/:id (proposed, not yet built)",
    naming='Use "Project workspace" if built',
    nav_placement="Reached from the project list, never from the sidebar",
    fake_risk="Medium — must be built over the real projects table, not a hard-coded id",
    preserve="Any detail route must read the real project by id under RLS.",
    backend_work="None — the projects table already supports a detail read.",
    frontend_work="Build a real /projects/:id detail page bound to the existing project query, replacing the list-only pattern.",
    blockers="Should follow the Phase 3 Projects restyle so the detail page inherits final styling.",
    priority="P2",
    risk="Medium",
    effort="M",
    phase="Phase 6 — structural follow-ups",
    acceptance="/projects/:id loads a real project under RLS; no hard-coded project id exists anywhere in the codebase.",
    test_hook="Manual navigation from the project list to detail with a demo account",
    owner_decision="No",
    audit="Lovable's own inventory flags the /projects/alpha hard-coding as a structural gap.",
))

add(missing(
    "L013",
    reason="Explicitly out of scope. PermitPilot has no firm-wide operations aggregate, and the user directive is to not replicate Mission Control as a fake backend.",
    match="Missing in PermitPilot",
    fake_risk="High — this is the single most convincing fake surface in the Lovable app; it would look authoritative while showing nothing real",
    do_not="Do not build. Directive: 'Do NOT replicate as fake backends: Mission Control page'. The real rollup path is the /dashboard and /uci hubs over live project data.",
    priority="P3",
    audit="Also surfaced as UCI section \"portfolio\" (see L043-style coming-soon handling) with note 'firm-wide quarterly Mission Control is not connected yet'.",
))

add(missing(
    "L014",
    reason="Duplicates /dashboard with no additional data. Two executive dashboards over the same queries is drift, not a feature.",
    match="Missing in PermitPilot",
    do_not="Do not build. Fold any executive framing into /dashboard (L005) instead.",
    priority="P3",
    risk="Medium",
    effort="L",
    audit="Lovable's Command Center exists only to link to /projects/alpha.",
))

add(row(
    id="L015",
    pp_name="Permit Queue (placeholder)",
    pp_routes="/permit-queue",
    pp_exists="Yes — placeholder page",
    pp_files="src/pages/placeholders/PermitQueuePlaceholder.tsx",
    pp_nav="Sidebar → Permit Queue",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="None — labelled placeholder",
    pp_backend="None yet; permit_applications and permit-status-monitor are the eventual source",
    pp_connected="None",
    pp_status="Placeholder (labelled)",
    match="UI match only",
    confidence="High",
    ui_parity="Weak — PermitPilot renders an honest placeholder, Lovable renders a mock queue",
    func_parity="None on both sides — Lovable's queue is fabricated",
    route_decision="Keep PP route",
    target_route="/permit-queue",
    naming='Keep "Permit Queue"',
    nav_placement="Command group in the sidebar, as today",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="High — the obvious temptation is to fill the placeholder with Lovable's mock rows",
    preserve="Preserve the placeholder's explicit 'not connected' labelling until a real query exists.",
    do_not="Do not replicate Lovable's hard-coded sidebar badge of 18; a badge must count real rows or not exist.",
    backend_work="Build a cross-project filing queue query over permit_applications with real status and owner fields.",
    frontend_work="Once the query exists, adopt Lovable's queue table styling. Until then, restyle the placeholder only.",
    blockers="Needs an agreed queue definition (which statuses belong in the queue).",
    priority="P2",
    risk="Medium",
    effort="M",
    phase="Phase 6 — structural follow-ups",
    acceptance="Either the page shows real permit rows, or it remains an explicitly labelled placeholder. No fabricated badge count.",
    test_hook="Grep for hard-coded badge counts in the sidebar; manual visit to /permit-queue",
    owner_decision="Yes — queue scope needs a product definition",
    audit="src/App.tsx line 163 uses PermitQueuePlaceholder.",
))

add(missing(
    "L016",
    reason="No critical-path or dependency model exists in PermitPilot; the chart would be entirely synthetic.",
    match="Missing in PermitPilot",
    do_not="Do not build. Depends on the same scheduling domain as L010/L011, which does not exist.",
    audit="Lovable page is mock.",
))

add(deferred(
    "L017",
    reason="Phase-0 feasibility is a genuine product idea but has no PermitPilot data model; PermitPilot's closest real capability is /permit-intelligence.",
    match="Missing in PermitPilot",
    pp_name="Permit Intelligence (adjacent, not equivalent)",
    pp_routes="/permit-intelligence",
    pp_files="src/pages/PermitIntelligence.tsx",
    pp_data="Shovels API permit history",
    pp_backend="shovels-api; property-intelligence-agent",
    pp_connected="Yes (for permit intelligence, not feasibility)",
    pp_status="Adjacent surface exists",
    func_parity="Weak — real property/permit intelligence exists but no feasibility scoring",
    priority="P3",
    blockers="Needs a feasibility scoring model and an owner.",
    audit="Consider whether /permit-intelligence already satisfies the client's feasibility intent before building anything new.",
))

add(deferred(
    "L018",
    reason="Interactive site scoring requires a scoring model PermitPilot does not have; Lovable's scores are invented.",
    match="Missing in PermitPilot",
    priority="P3",
    blockers="Depends on L017.",
    audit="Lovable page is mock.",
))

# ---- Onboarding / Delivery ------------------------------------------------------------

add(deferred(
    "L019",
    reason="PermitPilot has no client-facing LOA signing route. /admin/authorizations is a Preview placeholder only, so there is no live authorization pipeline to attach a signing page to.",
    pp_name="Admin authorizations (Preview placeholder only)",
    pp_routes="/admin/authorizations (placeholder)",
    pp_exists="No — no client signing route",
    pp_files="src/pages/placeholders/AdminPreviewPlaceholders.tsx",
    pp_nav="Admin console card",
    pp_auth="Signed-in admin area",
    pp_data="None — placeholder",
    pp_backend="None. PermitPilot has document storage and PDF paths but no client_authorizations table.",
    pp_connected="None",
    pp_status="Placeholder (labelled Preview only, PD-5)",
    match="Missing in PermitPilot",
    ui_parity="None — no signing UI",
    func_parity="None — no authorization records",
    route_decision="Defer",
    target_route="Undecided — would need /onboarding/authorization plus a real table",
    naming='If built, use "Client Authorization (LOA)"',
    nav_placement="Onboarding group, client role only",
    fake_risk="High — a signature UI that does not produce a stored, retrievable legal artifact is the worst possible fake",
    preserve="Preserve the existing placeholder's explicit 'Preview only' labelling so no one treats it as live.",
    backend_work="client_authorizations table, RLS, signature-to-PDF generation, storage bucket and retention policy.",
    frontend_work="None until the backend and legal review exist.",
    blockers="Legal review of e-signature handling; a records-retention decision; a client_authorizations schema.",
    priority="P2",
    risk="High",
    effort="L",
    phase="Backlog — requires legal sign-off before scoping",
    acceptance="Not scoped. Requires legal approval, a schema and an update to this row.",
    owner_decision="Yes — legal and product sign-off required for e-signature capture",
    audit="Directive confirmed: admin LOA/members/audit are Preview placeholders in PermitPilot and must not be presented as connected.",
))

add(missing(
    "L020",
    reason="This is a duplicate alias of L019 that Lovable's own inventory flags as an inconsistency risk. Even if LOA signing is built, the alias must not be.",
    match="Missing in PermitPilot",
    do_not="Do not build. One canonical LOA route only, if and when L019 is approved.",
    fake_risk="High — duplicate routes over legal artifacts invite divergent behavior",
    priority="P3",
    risk="Low",
    effort="S",
    audit="Lovable notes: 'Duplicate route alias — inconsistency risk.'",
))

add(deferred(
    "L021",
    reason="A Monday-style task board needs a task/group/assignment domain PermitPilot does not have. Reimbursables and scope-pricing tabs imply a financial model that also does not exist.",
    match="Missing in PermitPilot",
    priority="P3",
    risk="High",
    effort="XL",
    blockers="Needs a task domain, an assignment model and a pricing model.",
    audit="Lovable page is mock across all three tabs.",
))

add(row(
    id="L022",
    pp_name="Permit Wizard Filing",
    pp_routes="/permit-wizard-filing",
    pp_exists="Yes",
    pp_files="src/pages/PermitWizardFiling.tsx; src/components/permit-wizard/StartFilingDialog.tsx",
    pp_nav="Sidebar → Permit Filing; project filing CTA",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Supabase permit applications, project documents, portal_credentials",
    pp_backend="permitwizard-preflight; permitwizard-execute; epermit-submit; document-preparation-agent",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's stepper chrome is cleaner; the underlying steps differ because PermitPilot's are real",
    func_parity="PermitPilot is far ahead — Lovable steps through a mock packet; PermitPilot runs preflight and executes real portal submissions",
    route_decision="Keep PP route",
    target_route="/permit-wizard-filing",
    naming='Use Lovable\'s "Permit Filing" label in the sidebar, pointing at /permit-wizard-filing',
    nav_placement="Delivery group in the sidebar",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="High — this surface performs real submissions; a cosmetic rebuild that bypasses preflight could file incorrectly",
    preserve="Preserve the permitwizard-preflight → permitwizard-execute contract, credential handling, document mapping and every confirmation gate. Do not reorder or remove steps.",
    do_not="Do not replace real steps with Lovable's mock packet steps, and never submit without preflight.",
    backend_work="None.",
    frontend_work="Restyle the stepper, step headers and review panel using Lovable's visual language while leaving step logic untouched.",
    blockers="No live utility submissions during testing without explicit approval (shared Supabase on Railway development).",
    priority="P1",
    risk="High",
    effort="M",
    phase="Phase 4 — delivery and intelligence surfaces",
    acceptance="Preflight still runs before execute; every existing confirmation gate remains; step order unchanged; no live submission triggered during verification.",
    test_hook="npx vitest run (permit wizard coverage); dry-run preflight only, no execute",
    owner_decision="Yes — approval required before any live submission test",
    audit="Mapping confirmed: Lovable /matrix/guided ↔ PermitPilot /permit-wizard-filing.",
))

add(row(
    id="L023",
    pp_name="Response Matrix",
    pp_routes="/response-matrix",
    pp_exists="Yes",
    pp_files="src/pages/ResponseMatrix.tsx; src/pages/CommentReview.tsx; src/pages/ClassifiedComments.tsx",
    pp_nav="Sidebar → Response Matrix",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Supabase parsed_comments, comment responses, project documents",
    pp_backend="parse-permit-comments; comment-parser-agent; discipline-classifier-agent; generate-response; generate-grounded-response; export-response-package",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's matrix grid, row density and status chips are the target styling",
    func_parity="PermitPilot is far ahead — Lovable drafts against mock comments; PermitPilot parses real comment letters and generates grounded responses",
    route_decision="Keep PP route",
    target_route="/response-matrix",
    naming='Keep "Response Matrix"',
    nav_placement="Delivery group in the sidebar",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Medium — grid columns must map to real parsed_comments fields, not Lovable's invented ones",
    preserve="Preserve comment parsing, discipline classification, grounded response generation, citation references and the export package path. Response text generation must keep going through the existing edge functions.",
    do_not="Do not add matrix columns that parsed_comments cannot populate.",
    backend_work="None.",
    frontend_work="Adopt Lovable's matrix table shell, row grouping and status chips over the existing data hooks. This is the recommended first implementation row: highest visual payoff, real backing data, and no route or contract change.",
    blockers="None.",
    priority="P0",
    risk="Low",
    effort="M",
    phase="Phase 3 — core authenticated surfaces (recommended first row)",
    acceptance="Restyled matrix renders real parsed comments; response generation and export still work; no column shows placeholder data.",
    test_hook="npx vitest run; manual comment-to-response round trip on a demo project",
    owner_decision="No",
    audit="Recommended starting point per the audit directive. Not implemented in this documentation pass.",
))

add(row(
    id="L024",
    pp_name="Portal Data Viewer",
    pp_routes="/portal-data",
    pp_exists="Yes",
    pp_files="src/pages/PortalDataViewer.tsx; scraper-service/app/routes/*",
    pp_nav="Sidebar → Portal Data",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Live scraper output + Supabase portal records",
    pp_backend="scraper-service HTTP API; check-portal-status; fetch-permit-data; permit-status-monitor",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's harvest-run list styling is the target",
    func_parity="PermitPilot is far ahead — Lovable shows mock harvest runs; PermitPilot shows real scraper results",
    route_decision="Keep PP route",
    target_route="/portal-data",
    naming='Use "Portal Harvest" as the nav label if the client expects it, pointing at /portal-data',
    nav_placement="Delivery group in the sidebar",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Medium — run status must reflect real scraper state, never an optimistic mock",
    preserve="Preserve the scraper API contract, credential handling and portal status polling. Do not change scraper behavior for styling reasons.",
    do_not="Do not fabricate harvest-run history.",
    backend_work="None.",
    frontend_work="Adopt Lovable's run list, status badge and detail panel styling.",
    blockers="Scraper changes would need a Railway development deploy; styling alone does not.",
    priority="P1",
    risk="Medium",
    effort="M",
    phase="Phase 4 — delivery and intelligence surfaces",
    acceptance="Restyled viewer shows real scraper runs and statuses; no scraper contract change; no fabricated runs.",
    test_hook="node --test scraper-service/tests; manual /portal-data smoke",
    owner_decision="No",
    audit="Mapping confirmed: Lovable /portals/harvest ↔ PermitPilot /portal-data.",
))

add(missing(
    "L025",
    reason="An umbrella matrix landing page adds a navigation hop over surfaces that are already directly reachable in PermitPilot.",
    match="Missing in PermitPilot",
    do_not="Do not build. /response-matrix and /permit-wizard-filing are already first-class sidebar entries.",
    fake_risk="Medium — an umbrella page invites tiles for surfaces that do not exist",
    risk="Low",
    effort="S",
    audit="PermitPilot deliberately has no /matrix namespace.",
))

add(missing(
    "L026",
    reason="A unified task matrix depends on the same nonexistent task domain as L021.",
    match="Missing in PermitPilot",
    do_not="Do not build. Blocked on the task domain that L021 also requires.",
    audit="Lovable page is mock.",
))

add(deferred(
    "L027",
    reason="PermitPilot already runs a real multi-agent pipeline, but it has no run-observability schema, so a lane UI would visualise nothing. Lovable's version persists to localStorage only, which must never be copied.",
    pp_name="Agent pipeline (backend only, no workflow UI)",
    pp_routes="— (no route)",
    pp_exists="No",
    pp_files="supabase/functions/intake-pipeline-agent; auto-router-agent; permit-classifier-agent; guardian-quality-agent; validate-completeness-agent",
    pp_nav="Not user-facing",
    pp_auth="Service-side",
    pp_data="Supabase (per-agent tables) — no unified run log",
    pp_backend="intake-pipeline-agent; auto-router-agent; permit-classifier-agent; discipline-classifier-agent; guardian-quality-agent; validate-completeness-agent; license-validation-agent",
    pp_connected="Yes (backend)",
    pp_status="Real backend, no UI",
    match="Backend match only",
    ui_parity="None — no workflow lane UI",
    func_parity="Inverted — PermitPilot has the real agents, Lovable has only the UI",
    route_decision="Defer",
    target_route="Undecided — would need an agent run observability page",
    naming='If built, prefer "Agent runs" over "AI Workflow"',
    fake_risk="High — lanes with no run data would be pure decoration",
    preserve="Preserve every existing agent edge function and its invocation path.",
    do_not="Do not replicate Lovable's localStorage persistence. Workflow state must live in Supabase or not exist.",
    backend_work="An agent_runs table with status, timing and error capture, written by the existing agent functions.",
    frontend_work="None until run data is persisted.",
    blockers="Needs an agent_runs schema and a decision on retention.",
    priority="P2",
    risk="Medium",
    effort="L",
    phase="Backlog — pairs with L033",
    acceptance="Not scoped. Requires an agent_runs schema first.",
    audit="This row and L033 are the same underlying gap: real agents, no observability surface.",
))

add(missing(
    "L028",
    reason="Demolition permits are not a PermitPilot workflow; there is no raze permit type in the schema.",
    match="Missing in PermitPilot",
    do_not="Do not build. If demolition permits become a requirement, extend the existing permit application domain rather than adding a separate page.",
    audit="Lovable page is mock.",
))

# ---- Intelligence ---------------------------------------------------------------------

add(row(
    id="L029",
    pp_name="Code Compliance",
    pp_routes="/code-compliance",
    pp_exists="Yes",
    pp_files="src/pages/CodeCompliance.tsx",
    pp_nav="Sidebar → Code Compliance",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Supabase compliance findings + uploaded drawings",
    pp_backend="analyze-drawing; ingest-project-document; context-reference-engine",
    pp_connected="Yes",
    pp_status="Working",
    match="Partial match",
    confidence="High",
    ui_parity="Partial — Lovable splits landing and analyzer into two pages; PermitPilot has one",
    func_parity="PermitPilot is ahead — Lovable's landing page is mock, PermitPilot's findings are real",
    route_decision="Fold into existing PP surface",
    target_route="/code-compliance",
    naming='Use "DesignCheck" only if the client insists; otherwise keep "Code Compliance"',
    nav_placement="Intelligence group in the sidebar",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Medium — an overview band must summarise real findings, not invented counts",
    preserve="Preserve the analyze-drawing invocation, findings queries and document ingestion path.",
    do_not="Do not replicate Lovable's hard-coded sidebar badge of 8, and do not split the page in two just to mirror Lovable's structure.",
    backend_work="None.",
    frontend_work="Adopt Lovable's overview band and findings-card styling on the single existing page.",
    blockers="None.",
    priority="P2",
    risk="Low",
    effort="M",
    phase="Phase 4 — delivery and intelligence surfaces",
    acceptance="One /code-compliance page carries both overview and analyzer content; every count derives from a real query.",
    test_hook="Manual drawing upload and analysis smoke on a demo project",
    owner_decision="No",
    audit="L029 and L031 both resolve to /code-compliance; PermitPilot deliberately does not split them.",
))

add(deferred(
    "L030",
    reason="A separate compliance scoring dashboard would need a scoring model; PermitPilot's compliance data is finding-level, not scored.",
    match="Missing in PermitPilot",
    pp_name="Code Compliance findings (unscored)",
    pp_routes="/code-compliance",
    pp_files="src/pages/CodeCompliance.tsx",
    pp_data="Supabase compliance findings",
    pp_backend="analyze-drawing",
    pp_connected="Partial",
    pp_status="Findings exist, no scoring",
    func_parity="Weak — real findings, no score model",
    priority="P3",
    blockers="Needs an agreed compliance scoring methodology.",
    audit="Lovable page is mock.",
))

add(row(
    id="L031",
    pp_name="Code Compliance (drawing analyzer)",
    pp_routes="/code-compliance",
    pp_exists="Yes",
    pp_files="src/pages/CodeCompliance.tsx; supabase/functions/analyze-drawing",
    pp_nav="Sidebar → Code Compliance",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Uploaded drawings in Supabase Storage + analysis results",
    pp_backend="analyze-drawing; ingest-project-document; document-ingestion-worker",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's upload panel and results list styling is the target",
    func_parity="Strong on both sides, and PermitPilot's ingestion path is more complete",
    route_decision="Fold into existing PP surface",
    target_route="/code-compliance",
    naming='Use "Code Analyzer" as a section heading inside /code-compliance',
    nav_placement="Section of the Code Compliance page; no separate nav entry",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Low — both sides call a real analysis function",
    preserve="Preserve the analyze-drawing contract, upload validation, storage paths and the document ingestion worker handoff.",
    do_not="Do not persist analyzer presets to localStorage the way Lovable does; PermitPilot settings belong in Supabase.",
    backend_work="None.",
    frontend_work="Adopt Lovable's upload dropzone, preset panel and results list styling.",
    blockers="None.",
    priority="P1",
    risk="Medium",
    effort="M",
    phase="Phase 4 — delivery and intelligence surfaces",
    acceptance="Upload and analysis still complete end to end; results bind to real analysis output; no preset stored outside Supabase.",
    test_hook="Manual upload and analyze on a demo project; check the analyze-drawing function logs",
    owner_decision="No",
    audit="Directive confirmed: Lovable Code Analyzer ↔ PermitPilot /code-compliance.",
))

add(deferred(
    "L032",
    reason="PermitPilot has the validation agents but no staff prescreen review queue or reviewer assignment model.",
    pp_name="Validation agents (backend only)",
    pp_routes="— (no route)",
    pp_exists="No",
    pp_files="supabase/functions/validate-completeness-agent; guardian-quality-agent",
    pp_nav="Not user-facing",
    pp_auth="Service-side",
    pp_data="Agent outputs, no review queue",
    pp_backend="validate-completeness-agent; guardian-quality-agent; license-validation-agent",
    pp_connected="Yes (backend)",
    pp_status="Real backend, no review UI",
    match="Backend match only",
    ui_parity="None — no prescreen UI",
    func_parity="Inverted — PermitPilot has real validation, Lovable has only the review screen",
    route_decision="Defer",
    target_route="Undecided",
    fake_risk="Medium — a review queue without assignment or state would be decorative",
    preserve="Preserve the validation agent invocations already wired into intake.",
    backend_work="A prescreen queue with reviewer assignment and review state.",
    frontend_work="None until the queue exists.",
    blockers="Needs a staff review workflow definition.",
    priority="P2",
    risk="Medium",
    effort="M",
    phase="Backlog",
    acceptance="Not scoped. Requires a review queue schema.",
    audit="Real validation agents exist; only the human review surface is missing.",
))

add(deferred(
    "L033",
    reason="PermitPilot runs 12+ real agent functions but persists no run history, so an agent registry page would list capabilities without status.",
    pp_name="Agent functions (backend only, no registry UI)",
    pp_routes="— (no route)",
    pp_exists="No",
    pp_files="supabase/functions/* (auto-router-agent, comment-parser-agent, permit-classifier-agent, discipline-classifier-agent, intake-pipeline-agent, property-intelligence-agent, guardian-quality-agent, validate-completeness-agent, license-validation-agent, document-preparation-agent)",
    pp_nav="Not user-facing",
    pp_auth="Service-side",
    pp_data="Per-agent outputs; no unified registry or run log",
    pp_backend="10+ agent edge functions",
    pp_connected="Yes (backend)",
    pp_status="Real backend, no UI",
    match="Backend match only",
    ui_parity="None — no registry UI",
    func_parity="Inverted — PermitPilot's agents are real; Lovable's registry is a static list",
    route_decision="Defer",
    target_route="Undecided — pairs with L027",
    fake_risk="High — a registry showing 'healthy' without real telemetry would actively mislead",
    preserve="Preserve all agent functions and their invocation paths.",
    backend_work="Shared agent_runs telemetry (status, duration, error) written by every agent function.",
    frontend_work="None until telemetry exists.",
    blockers="Same agent_runs schema as L027.",
    priority="P2",
    risk="Medium",
    effort="L",
    phase="Backlog — pairs with L027",
    acceptance="Not scoped. Requires agent run telemetry.",
    audit="Strongest example of PermitPilot being ahead of Lovable on the backend and behind on the UI.",
))

add(deferred(
    "L034",
    reason="PermitPilot stores and ingests documents for real, but exposes them contextually (UCI drawer, portal views) rather than through a global vault page.",
    pp_name="Project documents (contextual, no vault page)",
    pp_routes="/uci?section=application-builder (Documents drawer tab); /portal-data",
    pp_exists="Partial — document surfaces exist, no vault route",
    pp_files="src/pages/UciDashboard.tsx (documents tab); document-ingestion-worker/; supabase/functions/ingest-project-document",
    pp_nav="Inside the UCI coordination drawer",
    pp_auth="Signed-in; documents RLS-scoped per project",
    pp_data="Supabase project documents + Storage",
    pp_backend="ingest-project-document; document-ingestion-worker; document-preparation-agent",
    pp_connected="Yes",
    pp_status="Working (contextual)",
    match="Backend match only",
    ui_parity="Weak — no cross-project document browser",
    func_parity="Strong on storage and ingestion; missing only the aggregate view",
    route_decision="Defer",
    target_route="Undecided — a cross-project document view could be added later",
    naming='If built, use "Documents"',
    fake_risk="Low — real documents exist; the risk is only scope creep",
    preserve="Preserve ingestion, storage paths, RLS scoping and the document mapping used by permit filing.",
    do_not="Do not build a vault that bypasses per-project RLS scoping.",
    backend_work="A cross-project document listing query respecting RLS.",
    frontend_work="Deferred: a document browser page over that query.",
    blockers="Needs a decision on cross-project document visibility rules.",
    priority="P2",
    risk="Medium",
    effort="M",
    phase="Backlog",
    acceptance="Not scoped. Any vault must respect existing RLS scoping.",
    owner_decision="Yes — cross-project document visibility is a permissions decision",
    audit="Documents are real in PermitPilot; only the aggregate browser is absent.",
))

add(missing(
    "L035",
    reason="Content authoring is not a PermitPilot capability and has no owner.",
    match="Missing in PermitPilot",
    do_not="Do not build. Lovable's Content Studio is a UI-only placeholder with local state.",
    risk="Medium",
    effort="L",
    audit="Lovable status is Placeholder, backend UI only.",
))

add(row(
    id="L036",
    pp_name="MVP Documentation + API Documentation",
    pp_routes="/mvp-documentation; /api-docs",
    pp_exists="Yes",
    pp_files="src/pages/MVPDocumentation.tsx; src/pages/APIDocumentation.tsx",
    pp_nav="Direct URL; documentation links",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Static curated documentation",
    pp_backend="None",
    pp_connected="None (static by design)",
    pp_status="Working",
    match="Partial match",
    confidence="Medium",
    ui_parity="Partial — both are static reference pages with different structure",
    func_parity="Comparable — both are documentation surfaces, legitimately static",
    route_decision="Fold into existing PP surface",
    target_route="/mvp-documentation",
    naming='Keep "MVP Documentation"; do not introduce "Platform Architecture"',
    nav_placement="Documentation links only; not a primary sidebar entry",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="None — static documentation is honestly static",
    preserve="Preserve the existing documentation content; restyling must not drop sections.",
    do_not="Do not add a third architecture page. This matrix is the architecture source of truth.",
    backend_work="None.",
    frontend_work="Optional low-priority typography and layout alignment.",
    blockers="None.",
    priority="P3",
    risk="Low",
    effort="S",
    phase="Phase 7 — documentation and polish",
    acceptance="Documentation pages keep all content after restyling; no new architecture page added.",
    test_hook="Manual visit to /mvp-documentation and /api-docs",
    owner_decision="No",
    audit="Lovable has both /architecture and /architecture-inventory; PermitPilot consolidates into repo docs plus these two pages.",
))

# ---- Utility Coordination -------------------------------------------------------------

add(row(
    id="L037",
    pp_name="UCI Hub (Utility Coordination)",
    pp_routes="/uci",
    pp_exists="Yes",
    pp_files="src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx",
    pp_nav="Sidebar → Utility Coordination (expandable group)",
    pp_auth="Signed-in via ProtectedLayoutRoute, inside an ErrorBoundary",
    pp_data="Live scraper + Supabase UCI coordination records, per project",
    pp_backend="scraper-service /api/uci; uci-pepco-discovery.service; check-portal-status",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — PermitPilot's hub already exceeds Lovable's; alignment is about chrome, not content",
    func_parity="PermitPilot is far ahead — Lovable's hub is static mock KPIs",
    route_decision="Keep PP route",
    target_route="/uci",
    naming='Use "Utility Coordination" as the group label and "Overview" for this section',
    nav_placement="Expandable sidebar group with section children",
    deep_link="/uci?section=overview",
    lovable_only="No",
    fake_risk="Medium — KPI tiles must stay bound to live rollups",
    preserve="Preserve the live scraper integration, coordination records, stage rail, attention queue, per-project scoping and the ErrorBoundary wrapper.",
    do_not="Do not split the hub into Lovable's nine separate /uci/* routes.",
    backend_work="None.",
    frontend_work="Align KPI band, stage rail and record table styling with Lovable's UCI hub.",
    blockers="None.",
    priority="P0",
    risk="Medium",
    effort="M",
    phase="Phase 3 — core authenticated surfaces",
    acceptance="Hub renders live coordination data with the new styling; all existing UCI vitest suites pass; no new /uci/* route added.",
    test_hook="npx vitest run src/pages/uciDashboard.*.test.ts",
    owner_decision="No",
    audit="src/App.tsx lines 166-175; the expandable nav vocabulary is already in src/lib/uciNavSections.ts.",
))

add(uci_section(
    "L038", section="submissions", pp_name="Submissions", support="partial",
    drawer_tab="application-prep",
    match="Partial match", confidence="High",
    ui_parity="Partial — per-record submission tracking exists; no cross-project submissions table",
    func_parity="Partial — real per-record submissions, no portfolio-wide view",
    priority="P1", risk="Low", effort="S", phase="Phase 3 — core authenticated surfaces",
    preserve="Preserve per-record submission and tracking behavior in the Application prep drawer tab.",
    do_not="Do not create a /uci/submissions route. The directive is explicit: use ?section= instead.",
    backend_work="A cross-project submissions rollup query, if a portfolio view is later required.",
    frontend_work="Ensure the sidebar entry deep-links to ?section=submissions and the partial-support banner stays visible.",
    acceptance="Clicking Submissions lands on the Application prep tab of a real record and the 'cross-project hub not connected' note remains visible.",
    audit="UCI_NAV_SECTIONS declares support=\"partial\" with target drawer-tab application-prep.",
))

add(uci_section(
    "L039", section="communications", pp_name="Communications / Inbox", support="partial",
    drawer_tab="communications",
    match="Partial match", confidence="High",
    ui_parity="Partial — per-record portal communications exist; no cross-project inbox",
    func_parity="Partial — real portal messages per record, no unified inbox",
    priority="P1", risk="Low", effort="S", phase="Phase 3 — core authenticated surfaces",
    preserve="Preserve per-record portal communications retrieval.",
    do_not="Do not create /uci/communications, and do not present a cross-project inbox that does not exist.",
    backend_work="A cross-project message rollup, if an inbox is later required.",
    frontend_work="Style the communications drawer tab; keep the partial-support banner.",
    acceptance="Communications deep link opens the real per-record thread with the not-connected note intact.",
    audit="UCI_NAV_SECTIONS support=\"partial\", target drawer-tab communications.",
))

add(uci_section(
    "L040", section="class-of-service", pp_name="Class of Service", support="partial",
    drawer_tab="cos",
    match="Partial match", confidence="High",
    ui_parity="Partial — per-record COS analysis exists; no predictive portfolio table",
    func_parity="Partial — real COS per record, no portfolio prediction",
    priority="P1", risk="Low", effort="S", phase="Phase 3 — core authenticated surfaces",
    preserve="Preserve per-record COS analysis logic.",
    do_not="Do not create /uci/class-of-service, and do not fabricate a predictive portfolio COS table.",
    backend_work="A portfolio COS model, only if the client requires prediction.",
    frontend_work="Style the COS drawer tab; keep the partial-support banner.",
    acceptance="COS deep link opens the real per-record analysis; no predictive table is shown.",
    audit="UCI_NAV_SECTIONS support=\"partial\", target drawer-tab cos.",
))

add(uci_section(
    "L041", section="ciac", pp_name="CIAC & Refunds", support="partial",
    drawer_tab="costs",
    match="Partial match", confidence="Medium",
    ui_parity="Weak — CIAC appears as generic cost rows, not a dedicated refund tracker",
    func_parity="Partial — CIAC amounts can be recorded; refund windows are not tracked",
    priority="P2", risk="Low", effort="S", phase="Phase 4 — delivery and intelligence surfaces",
    preserve="Preserve the existing cost-row model that CIAC entries use today.",
    do_not="Do not create /uci/ciac, and do not show refund-window countdowns that nothing computes.",
    backend_work="A refund-window model (deposit date, refund deadline, status) before any tracker UI.",
    frontend_work="Style the Costs drawer tab; keep the 'refund tracker not connected' note.",
    acceptance="CIAC deep link opens the real Costs tab; no refund-window UI appears without a backing model.",
    owner_decision="Yes — a refund-window model needs a product decision",
    audit="UCI_NAV_SECTIONS note: 'Dedicated refund-window tracker is not connected yet.'",
))

add(uci_section(
    "L042", section="energization", pp_name="Energization", support="partial",
    drawer_tab="costs",
    match="Partial match", confidence="Medium",
    ui_parity="Weak — energization dates exist; no multi-party choreography timeline",
    func_parity="Partial — real dates and meter-set/closeout data, no orchestration view",
    priority="P2", risk="Low", effort="S", phase="Phase 4 — delivery and intelligence surfaces",
    preserve="Preserve energization dates and the meter-set/closeout checklist generation.",
    do_not="Do not create /uci/energization, and do not render a choreography timeline with invented participants.",
    backend_work="A multi-party scheduling model, if choreography is required.",
    frontend_work="Style the Costs drawer tab; keep the partial-support note.",
    acceptance="Energization deep link opens real dates; no fabricated timeline.",
    audit="UCI_NAV_SECTIONS note: 'Multi-party choreography timeline is not connected yet.'",
))

add(uci_section(
    "L043", section="miss-utility", pp_name="Miss Utility", support="mock",
    match="Missing in PermitPilot", confidence="High",
    ui_parity="None — labelled coming-soon panel only",
    func_parity="None — no 811 ticket domain in PermitPilot",
    route_decision="Do not build",
    priority="P3", risk="High", effort="L", phase="Out of scope — coming-soon panel only",
    pp_data="None — labelled coming-soon panel", pp_backend="None", pp_connected="None",
    preserve="Preserve the coming-soon panel's explicit 'no backend yet' labelling.",
    do_not="Do not build an 811 ticket table. There is no PermitPilot backend for Miss Utility tickets, and 811 is a regulated notification process — a fake ticket UI could imply a locate request was filed when it was not.",
    backend_work="An 811 ticket domain plus a real integration with the state notification centre.",
    frontend_work="None. Keep the coming-soon panel.",
    blockers="No 811 integration; regulatory implications.",
    acceptance="?section=miss-utility continues to render the labelled coming-soon panel and nothing that looks like a real ticket list.",
    test_hook="Manual visit to /uci?section=miss-utility",
    owner_decision="Yes — regulated process; needs explicit approval",
    audit="UCI_NAV_SECTIONS note: 'No PermitPilot backend for 811 / Miss Utility tickets yet.'",
))

add(uci_section(
    "L044", section="knowledge-graph", pp_name="Knowledge Graph", support="mock",
    match="Missing in PermitPilot", confidence="High",
    ui_parity="None — labelled coming-soon panel only",
    func_parity="None — no graph/nodes backend",
    route_decision="Do not build",
    priority="P3", risk="High", effort="XL", phase="Out of scope — coming-soon panel only",
    pp_data="None — labelled coming-soon panel", pp_backend="None", pp_connected="None",
    preserve="Preserve the coming-soon labelling.",
    do_not="Do not build a graph explorer. PermitPilot has no graph or node storage; every edge would be invented.",
    backend_work="A graph schema plus an entity-resolution pipeline.",
    frontend_work="None.",
    blockers="No graph domain; no owner.",
    acceptance="?section=knowledge-graph stays a labelled coming-soon panel.",
    test_hook="Manual visit to /uci?section=knowledge-graph",
    owner_decision="Yes",
    audit="UCI_NAV_SECTIONS note: 'No PermitPilot graph/nodes backend yet.'",
))

add(uci_section(
    "L045", section="application-builder", pp_name="Application Builder", support="active",
    drawer_tab="application-prep",
    match="Strong functional match", confidence="High",
    ui_parity="Partial — PermitPilot's Application prep is richer than Lovable's builder",
    func_parity="PermitPilot is far ahead — Lovable's builder is a UI-only placeholder; PermitPilot builds, maps documents, reviews and submits",
    priority="P1", risk="Medium", effort="S", phase="Phase 3 — core authenticated surfaces",
    preserve="Preserve the build / map documents / review / submit flow and its document mapping logic, which has dedicated vitest coverage.",
    do_not="Do not create /uci/application-builder, and do not simplify the real four-step flow to match Lovable's placeholder.",
    backend_work="None.",
    frontend_work="Style the Application prep drawer tab to match Lovable's builder chrome.",
    blockers="Requires an open coordination record.",
    acceptance="Application prep still builds, maps documents, reviews and submits; document-mapping tests pass.",
    test_hook="npx vitest run src/pages/uciDashboard.documentMapping.test.ts",
    audit="UCI_NAV_SECTIONS support=\"active\": 'Real Application prep (build / map docs / review / submit).'",
))

add(row(
    id="L046",
    pp_name="Jurisdiction Map",
    pp_routes="/jurisdictions/map",
    pp_exists="Yes",
    pp_files="src/pages/JurisdictionMapPage.tsx; scraper-service/data/territory/electric-full-v2/*",
    pp_nav="Sidebar → Jurisdiction Map; also /uci?section=provider-map redirects here",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Real utility territory GeoJSON (19 states) + county-utility reconciliation datasets",
    pp_backend="get-mapbox-token; scraper-service territory datasets",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's map chrome and legend styling is the target",
    func_parity="PermitPilot is far ahead — Lovable's map is static; PermitPilot renders real service-territory geometry",
    route_decision="Keep PP route",
    target_route="/jurisdictions/map",
    naming='Keep "Jurisdiction Map"',
    nav_placement="Intelligence group in the sidebar; also the target of the UCI Provider Map section",
    deep_link="/uci?section=provider-map navigates here (kind: external)",
    lovable_only="No",
    fake_risk="Low — the territory data is real and validated",
    preserve="Preserve the Mapbox token flow (get-mapbox-token), territory GeoJSON loading and the footprint validation datasets.",
    do_not="Do not hard-code a Mapbox token or bundle a reduced territory dataset for styling convenience.",
    backend_work="None.",
    frontend_work="Align map container, legend and filter styling with Lovable's map view.",
    blockers="None.",
    priority="P1",
    risk="Medium",
    effort="M",
    phase="Phase 4 — delivery and intelligence surfaces",
    acceptance="Map renders all territory layers with the new chrome; token retrieval unchanged; UCI provider-map deep link still lands here.",
    test_hook="node --test scraper-service/tests (territory footprint suites); manual map smoke",
    owner_decision="No",
    audit="uciNavSections provider-map target is { kind: 'external', href: '/jurisdictions/map' } — explicitly 'not a mock provider map'.",
))

add(row(
    id="L047",
    pp_name="Jurisdiction Comparison",
    pp_routes="/jurisdictions/compare (alias /jurisdiction-comparison)",
    pp_exists="Yes",
    pp_files="src/pages/JurisdictionComparison.tsx",
    pp_nav="Sidebar → Compare Jurisdictions",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Real jurisdiction dataset + utility provider directory",
    pp_backend="Supabase jurisdiction tables; scraper-service provider directory",
    pp_connected="Yes",
    pp_status="Working",
    match="Partial match",
    confidence="Medium",
    ui_parity="Partial — Lovable compares utility providers, PermitPilot compares jurisdictions; the comparison-table pattern is shared",
    func_parity="Partial — PermitPilot's comparison is real but oriented to jurisdictions rather than providers",
    route_decision="Fold into existing PP surface",
    target_route="/jurisdictions/compare",
    naming='Keep "Compare Jurisdictions"; use "Provider Map" only for the UCI section that links to the map',
    nav_placement="Intelligence group in the sidebar",
    deep_link="/jurisdiction-comparison is an existing alias of the same page",
    lovable_only="No",
    fake_risk="Medium — do not add provider comparison columns the directory cannot fill",
    preserve="Preserve the jurisdiction comparison queries and the provider directory metadata.",
    do_not="Do not build a second provider-comparison page; the UCI Provider Map section already routes to the real map.",
    backend_work="Provider-level comparison fields, only if the client specifically needs provider-vs-provider comparison.",
    frontend_work="Adopt Lovable's comparison-table styling on the existing page.",
    blockers="None.",
    priority="P2",
    risk="Medium",
    effort="M",
    phase="Phase 4 — delivery and intelligence surfaces",
    acceptance="Comparison table restyled with real jurisdiction data; both existing route aliases still resolve.",
    test_hook="Manual visit to /jurisdictions/compare and /jurisdiction-comparison",
    owner_decision="Yes — confirm whether the client wants jurisdiction or provider comparison",
    audit="src/App.tsx lines 125-126 declare both routes for the same component.",
))

add(uci_section(
    "L048", section="conflict-hunter", pp_name="Conflict Hunter", support="mock",
    match="Missing in PermitPilot", confidence="High",
    ui_parity="None — labelled coming-soon panel only",
    func_parity="None — no conflict-detection service",
    route_decision="Do not build",
    priority="P3", risk="High", effort="L", phase="Out of scope — coming-soon panel only",
    pp_data="None — labelled coming-soon panel", pp_backend="None", pp_connected="None",
    preserve="Preserve the coming-soon labelling.",
    do_not="Do not build. A conflict detector that reports 'no conflicts' without analysing anything is actively dangerous on a utility coordination platform.",
    backend_work="A cross-utility conflict detection service with real geometry and schedule inputs.",
    frontend_work="None.",
    blockers="No conflict-detection service.",
    acceptance="?section=conflict-hunter stays a labelled coming-soon panel.",
    test_hook="Manual visit to /uci?section=conflict-hunter",
    owner_decision="Yes",
    audit="UCI_NAV_SECTIONS note: 'No conflict-detection service yet.'",
))

add(uci_section(
    "L049", section="easement", pp_name="Easement / Right of Way", support="mock",
    match="Missing in PermitPilot", confidence="High",
    ui_parity="None — labelled coming-soon panel only",
    func_parity="None — no easement/ROW domain",
    route_decision="Do not build",
    priority="P3", risk="High", effort="L", phase="Out of scope — coming-soon panel only",
    pp_data="None — labelled coming-soon panel", pp_backend="None", pp_connected="None",
    preserve="Preserve the coming-soon labelling.",
    do_not="Do not build. Easements are legal instruments; a tracker with no records could imply rights that were never secured.",
    backend_work="An easement/ROW domain with document linkage.",
    frontend_work="None.",
    blockers="No easement domain; legal review needed.",
    acceptance="?section=easement stays a labelled coming-soon panel.",
    test_hook="Manual visit to /uci?section=easement",
    owner_decision="Yes",
    audit="UCI_NAV_SECTIONS note: 'No easement / ROW domain yet.'",
))

add(uci_section(
    "L050", section="load-profile", pp_name="Load Profile", support="active",
    drawer_tab="load-profile",
    match="Strong functional match", confidence="High",
    ui_parity="Partial — PermitPilot's load profile lives in a drawer tab rather than a page",
    func_parity="Strong on both sides; PermitPilot's version is real and has test coverage",
    priority="P1", risk="Low", effort="S", phase="Phase 3 — core authenticated surfaces",
    preserve="Preserve load-profile upload, parsing and analysis logic, including its existing vitest coverage.",
    do_not="Do not create /utility/load-profile as a separate route.",
    backend_work="None.",
    frontend_work="Style the Load profile drawer tab to match Lovable's analyzer panel.",
    acceptance="Load profile upload and analysis still work in the drawer tab; existing tests pass.",
    audit="UCI_NAV_SECTIONS support=\"active\". Lovable also records vitest coverage on its own version.",
))

add(uci_section(
    "L051", section="meter-set", pp_name="Meter Set", support="partial",
    drawer_tab="costs",
    match="Partial match", confidence="Medium",
    ui_parity="Weak — checklist generation exists; no sequencing/scheduling UI",
    func_parity="Partial — real meter-set and closeout checklist generation, no choreography",
    priority="P3", risk="Medium", effort="M", phase="Backlog",
    preserve="Preserve meter-set and closeout checklist generation.",
    do_not="Do not create /utility/meter-set, and do not build a sequencing board over data that does not exist.",
    backend_work="A scheduling model before any sequencing UI.",
    frontend_work="Keep the partial-support note; no new UI.",
    acceptance="Meter Set deep link opens the real Costs tab with the partial-support note intact.",
    owner_decision="Yes — sequencing scope needs a product decision",
    audit="UCI_NAV_SECTIONS note: 'Richer scheduling UI is not connected yet.'",
))

add(missing(
    "L052",
    reason="No equipment or procurement domain exists in PermitPilot; every ETA would be invented.",
    match="Missing in PermitPilot",
    do_not="Do not build. Long-lead equipment tracking needs a procurement domain PermitPilot does not have.",
    audit="Lovable page is mock.",
))

add(missing(
    "L053",
    reason="A schedule risk model requires the scheduling domain that L010, L011 and L016 also lack.",
    match="Missing in PermitPilot",
    do_not="Do not build. A predictive model with no inputs would output invented risk.",
    audit="Lovable page is mock.",
))

add(deferred(
    "L054",
    reason="PermitPilot sends real inspection reminders but does not model inspection release state, so a tracker would show status it cannot compute.",
    pp_name="Inspection reminders (backend only)",
    pp_routes="— (no route)",
    pp_exists="No",
    pp_files="supabase/functions/send-inspection-reminders",
    pp_nav="Not user-facing",
    pp_auth="Service-side",
    pp_data="Deadline and reminder data; no inspection release state",
    pp_backend="send-inspection-reminders",
    pp_connected="Yes (reminders only)",
    pp_status="Reminders real, no tracker",
    match="Backend match only",
    ui_parity="None — no tracker UI",
    func_parity="Weak — reminders exist but inspection release is not modelled",
    priority="P3",
    blockers="Needs an inspection state model.",
    audit="send-inspection-reminders is real; the tracker surface is not.",
))

add(missing(
    "L055",
    reason="Special inspections are not modelled in PermitPilot.",
    match="Missing in PermitPilot",
    do_not="Do not build. Blocked on the same inspection state model as L054.",
    audit="Lovable page is mock.",
))

add(missing(
    "L056",
    reason="Certificate-of-occupancy tracking is not modelled in PermitPilot.",
    match="Missing in PermitPilot",
    do_not="Do not build. Blocked on the same inspection state model as L054.",
    audit="Lovable page is mock.",
))

# ---- Field ----------------------------------------------------------------------------

SIR_REASON = ("Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. "
              "PermitPilot has no site-investigation domain, no offline sync and no field evidence storage.")

for sid, label in [
    ("L057", "SIR landing"),
    ("L058", "SIR workspace"),
    ("L059", "SIR annex"),
    ("L060", "SIR executive rollup"),
    ("L061", "SIR sync"),
]:
    add(missing(
        sid,
        reason=SIR_REASON,
        match="Missing in PermitPilot",
        do_not=f"Do not build the {label}. " + SIR_REASON,
        audit="Whole SIR family is mock in Lovable and has no PermitPilot counterpart.",
    ))

add(missing(
    "L062",
    reason="Field content authoring has no PermitPilot domain and is part of the excluded field pack.",
    match="Missing in PermitPilot",
    do_not="Do not build. Part of the excluded SIR/Field mobile pack.",
    audit="Lovable page is mock.",
))

MOBILE_NOTE = ("PermitPilot already ships a real mobile shell (Capacitor config, PWA install prompt, offline indicator), "
               "so mobile capability is not the gap — the missing part is the field data domain.")

add(missing(
    "L063",
    reason="Survey data has no PermitPilot schema. " + MOBILE_NOTE,
    match="Missing in PermitPilot",
    pp_name="PWA / Capacitor mobile shell (no field surfaces)",
    pp_files="capacitor.config.ts; src/components/pwa/InstallPrompt.tsx; src/components/pwa/OfflineIndicator.tsx",
    pp_status="Mobile shell real, field surfaces absent",
    do_not="Do not build. Part of the excluded field mobile pack; Lovable's version keeps entries in local state only.",
    audit=MOBILE_NOTE,
))

add(missing(
    "L064",
    reason="Photo capture has no PermitPilot storage path for field evidence. " + MOBILE_NOTE,
    match="Missing in PermitPilot",
    do_not="Do not build. Lovable's camera page persists nothing; capturing photos with no storage would silently lose evidence.",
    audit=MOBILE_NOTE,
))

add(missing(
    "L065",
    reason="A separate mobile map is unnecessary: PermitPilot's /jurisdictions/map is the real map and is responsive.",
    match="Missing in PermitPilot",
    pp_name="Jurisdiction Map (responsive, serves mobile)",
    pp_routes="/jurisdictions/map",
    pp_files="src/pages/JurisdictionMapPage.tsx",
    pp_status="Existing map is responsive",
    do_not="Do not build a mobile-only map. Make /jurisdictions/map responsive instead (covered by L046).",
    risk="Low",
    effort="S",
    audit="Consolidating on one map avoids two divergent map implementations.",
))

# ---- Closeout -------------------------------------------------------------------------

CLOSEOUT_REASON = ("PermitPilot has no closeout domain: no closeout state, no archive model and no post-mortem records. "
                   "Lovable's entire closeout hierarchy is mock.")

for cid, label, prio in [
    ("L066", "closeout hub", "P3"),
    ("L067", "closeout archive", "P3"),
    ("L068", "closeout tracker", "P3"),
    ("L069", "post-mortem hub", "P3"),
    ("L070", "post-mortem analytics", "P3"),
    ("L071", "post-mortem financial", "P3"),
]:
    add(deferred(
        cid,
        reason=f"No PermitPilot {label} exists. " + CLOSEOUT_REASON,
        match="Missing in PermitPilot",
        priority=prio,
        blockers="Needs a closeout domain and, for the financial views, a cost model.",
        audit="Lovable's closeout tree aggregates nothing; there is no upstream data to aggregate in PermitPilot either.",
    ))

# ---- Resources ------------------------------------------------------------------------

add(row(
    id="L072",
    pp_name="Checklist History",
    pp_routes="/checklists (alias /checklist-history)",
    pp_exists="Yes",
    pp_files="src/pages/ChecklistHistory.tsx",
    pp_nav="Sidebar → Checklists",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Supabase checklist runs, reports and signatures (real)",
    pp_backend="send-checklist-report; process-scheduled-checklist-reports; send-checklist-signed-notification; send-test-scheduled-report; retry-failed-report-emails",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's list styling is the target",
    func_parity="PermitPilot is far ahead — Lovable browses mock checklists; PermitPilot has real runs, scheduled report delivery and signature notifications",
    route_decision="Keep PP route",
    target_route="/checklists",
    naming='Keep "Checklists"',
    nav_placement="Resources group in the sidebar",
    deep_link="/checklist-history is an existing alias of the same page",
    lovable_only="No",
    fake_risk="Low — the underlying data is real",
    preserve="Preserve scheduled report processing, email delivery, retry handling and signed-checklist notifications. These run on schedules; do not disturb their triggers.",
    do_not="Do not fabricate checklist history entries.",
    backend_work="None.",
    frontend_work="Adopt Lovable's checklist list and status styling.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="M",
    phase="Phase 4 — delivery and intelligence surfaces",
    acceptance="Checklist list restyled over real runs; both route aliases resolve; scheduled report functions untouched.",
    test_hook="Manual visit to /checklists and /checklist-history; confirm no changes under supabase/functions",
    owner_decision="No",
    audit="src/App.tsx lines 161-162 map both routes to ChecklistHistory.",
))

add(row(
    id="L073",
    pp_name="Code Reference Library",
    pp_routes="/code-reference",
    pp_exists="Yes",
    pp_files="src/pages/CodeReferenceLibrary.tsx",
    pp_nav="Sidebar → Code Reference",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Curated code reference content + context-reference-engine citations",
    pp_backend="context-reference-engine",
    pp_connected="Partial",
    pp_status="Working",
    match="Partial match",
    confidence="Medium",
    ui_parity="Partial — both are reference hubs; PermitPilot's is code-specific, Lovable's is a general doc index",
    func_parity="PermitPilot is ahead — its reference content feeds grounded response citations",
    route_decision="Fold into existing PP surface",
    target_route="/code-reference",
    naming='Keep "Code Reference"; do not add a generic "Reference Library" hub',
    nav_placement="Resources group in the sidebar",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Low",
    preserve="Preserve the citation linkage used by generate-grounded-response and context-reference-engine.",
    do_not="Do not add a parent /reference hub page that only links onward.",
    backend_work="None.",
    frontend_work="Adopt Lovable's reference-card and search styling.",
    blockers="None.",
    priority="P2",
    risk="Low",
    effort="S",
    phase="Phase 5 — admin and settings surfaces",
    acceptance="Code reference browsing and citation links still work with the new styling.",
    test_hook="Manual visit to /code-reference; verify a grounded response citation resolves",
    owner_decision="No",
    audit="src/App.tsx line 131.",
))

add(deferred(
    "L074",
    reason="PermitPilot's territory data is real and richer than Lovable's coverage matrix, but it is surfaced through the map rather than a coverage table.",
    pp_name="Utility territory datasets (surfaced via the map)",
    pp_routes="/jurisdictions/map",
    pp_exists="Partial — data exists, no coverage table page",
    pp_files="src/pages/JurisdictionMapPage.tsx; scraper-service/data/territory/electric-full-v2/utilities_by_state.json; county_utility.json",
    pp_nav="Sidebar → Jurisdiction Map",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Real territory GeoJSON, county-utility reconciliation and footprint validation reports across 19 states",
    pp_backend="scraper-service territory datasets",
    pp_connected="Yes",
    pp_status="Data real, no coverage table",
    match="Partial match",
    ui_parity="Weak — no tabular coverage view",
    func_parity="PermitPilot is ahead on data; behind on the tabular presentation",
    route_decision="Fold into existing PP surface",
    target_route="/jurisdictions/map (coverage table as a panel)",
    naming='Use "Utility Coverage" for the panel heading',
    nav_placement="Panel on the Jurisdiction Map page; no separate route",
    fake_risk="Low — coverage claims must come from the reconciliation reports, which exist",
    preserve="Preserve the reconciliation and footprint validation datasets as the single source for coverage claims.",
    do_not="Do not publish coverage claims that the reconciliation reports do not support.",
    backend_work="None — utilities_by_state.json and county_utility.json already back a coverage table.",
    frontend_work="Add a coverage table panel to the map page reading the existing datasets.",
    blockers="None.",
    priority="P2",
    risk="Medium",
    effort="M",
    phase="Phase 6 — structural follow-ups",
    acceptance="Any coverage figure shown traces to a reconciliation report file; no separate /reference/utility-coverage route added.",
    test_hook="node --test scraper-service/tests (county reconcile suites)",
    owner_decision="No",
    audit="Coverage claims are client-visible; they must stay tied to the validation reports.",
))

add(row(
    id="L075",
    pp_name="Glossary (placeholder)",
    pp_routes="/reference/glossary",
    pp_exists="Yes — placeholder page",
    pp_files="src/pages/placeholders/GlossaryPlaceholder.tsx",
    pp_nav="Sidebar → Glossary",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="None — labelled placeholder",
    pp_backend="None (static content by design once written)",
    pp_connected="None",
    pp_status="Placeholder (labelled)",
    match="Partial match",
    confidence="High",
    ui_parity="Weak — the route matches but PermitPilot has no terms yet",
    func_parity="Weak — Lovable has searchable static terms; PermitPilot has a placeholder",
    route_decision="Keep PP route",
    target_route="/reference/glossary",
    naming='Keep "Glossary"',
    nav_placement="Resources group in the sidebar",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="None — glossary content is legitimately static",
    preserve="Preserve the placeholder labelling until real terms are curated.",
    do_not="Do not copy Lovable's glossary terms verbatim without checking they match PermitPilot's actual vocabulary.",
    backend_work="None — static content is appropriate here.",
    frontend_work="Curate PermitPilot permitting and utility-coordination terms, then adopt Lovable's searchable list styling.",
    blockers="Needs someone to write the terms.",
    priority="P3",
    risk="Low",
    effort="S",
    phase="Phase 7 — documentation and polish",
    acceptance="Glossary shows real PermitPilot terminology with working search, or stays an explicit placeholder.",
    test_hook="Manual visit to /reference/glossary",
    owner_decision="No",
    audit="src/App.tsx line 164 uses GlossaryPlaceholder.",
))

add(row(
    id="L076",
    pp_name="Analytics",
    pp_routes="/analytics",
    pp_exists="Yes",
    pp_files="src/pages/Analytics.tsx",
    pp_nav="Sidebar → Analytics",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Real project, permit and cycle-time rollups",
    pp_backend="Supabase aggregate queries; export-weekly-report",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's executive KPI and chart styling is the target",
    func_parity="PermitPilot is far ahead — Lovable's executive KPIs are fabricated",
    route_decision="Keep PP route",
    target_route="/analytics",
    naming='Use "Analytics & Reporting" as the nav label, pointing at /analytics',
    nav_placement="Resources group in the sidebar",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="High — executive charts are the easiest place to smuggle in invented numbers",
    preserve="Preserve every aggregate query and the weekly report export path.",
    do_not="Do not add a chart without a real query behind it.",
    backend_work="None.",
    frontend_work="Adopt Lovable's executive KPI band and chart card styling.",
    blockers="None.",
    priority="P1",
    risk="Medium",
    effort="M",
    phase="Phase 4 — delivery and intelligence surfaces",
    acceptance="Every restyled chart and KPI traces to a real aggregate query; weekly export still works.",
    test_hook="Manual visit to /analytics with a demo account that has data; trigger export-weekly-report once",
    owner_decision="No",
    audit="src/App.tsx line 124.",
))

add(deferred(
    "L077",
    reason="PermitPilot has real per-record portal communications and a full transactional email layer, but no user-to-user message threads.",
    pp_name="Portal communications + transactional email (no message threads)",
    pp_routes="/uci?section=communications",
    pp_exists="No — no message-thread surface",
    pp_files="src/pages/UciDashboard.tsx (communications tab); supabase/functions/send-* (12 email functions)",
    pp_nav="UCI sidebar → Communications",
    pp_auth="Signed-in; scoped per coordination record",
    pp_data="Portal communications per record; email delivery logs",
    pp_backend="send-project-team-invitation; send-jurisdiction-notification; send-epermit-status-email; process-scheduled-notifications",
    pp_connected="Partial",
    pp_status="Portal comms real; no threads",
    match="Backend match only",
    ui_parity="Weak — no thread list UI",
    func_parity="Partial — real outbound messaging, no threaded inbox",
    route_decision="Defer",
    target_route="Undecided",
    fake_risk="High — an empty inbox that looks functional would cause users to miss real portal messages",
    preserve="Preserve all transactional email functions and per-record portal communications.",
    do_not="Do not replicate Lovable's hard-coded badge of 4. A message badge must count real unread items or not exist.",
    backend_work="A message thread domain with participants, read state and notification fan-out.",
    frontend_work="None until threads exist.",
    blockers="Needs a messaging domain and a notification policy.",
    priority="P3",
    risk="Medium",
    effort="L",
    phase="Backlog",
    acceptance="Not scoped. Requires a messaging domain.",
    owner_decision="Yes — messaging is a significant product decision",
    audit="Lovable's Messages badge of 4 is fabricated.",
))

add(row(
    id="L078",
    pp_name="Settings",
    pp_routes="/settings",
    pp_exists="Yes",
    pp_files="src/pages/Settings.tsx",
    pp_nav="Sidebar → Settings; avatar menu",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Supabase user profile and preferences (persisted)",
    pp_backend="Supabase queries",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="Medium",
    ui_parity="Partial — Lovable's settings section layout is the target",
    func_parity="PermitPilot is ahead — Lovable's settings are a client-only placeholder that persists nothing",
    route_decision="Keep PP route",
    target_route="/settings",
    naming='Keep "Settings"',
    nav_placement="Sidebar footer plus avatar menu, as today",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Medium — do not add toggles that persist nowhere",
    preserve="Preserve preference persistence, theme handling (ThemeProvider) and any notification settings already wired to Supabase.",
    do_not="Do not add a settings control without a persistence path; Lovable's placeholder pattern must not be copied.",
    backend_work="None.",
    frontend_work="Adopt Lovable's settings section and form styling on the existing persisted fields.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="M",
    phase="Phase 5 — admin and settings surfaces",
    acceptance="Every visible setting round-trips to Supabase after restyling; theme switching still works.",
    test_hook="Manual save-and-reload of each setting on Preview",
    owner_decision="No",
    audit="Settings.tsx contains 16 Supabase references, so preferences genuinely persist.",
))

# ---- Administration -------------------------------------------------------------------

add(row(
    id="L079",
    pp_name="Admin Panel",
    pp_routes="/admin",
    pp_exists="Yes",
    pp_files="src/pages/AdminPanel.tsx; src/components/admin/AdminLayout.tsx",
    pp_nav="Direct URL; admin nav",
    pp_auth="Signed-in admin area via AdminLayout",
    pp_data="Real admin data across jurisdictions, feature flags and shadow mode",
    pp_backend="Supabase admin queries; shadow-metrics; shadow-evaluator",
    pp_connected="Yes",
    pp_status="Working",
    match="Strong functional match",
    confidence="High",
    ui_parity="Partial — Lovable's admin card grid is the target styling",
    func_parity="PermitPilot is ahead — it has real jurisdiction admin, feature flags and shadow-mode tooling",
    route_decision="Keep PP route",
    target_route="/admin",
    naming='Keep "Admin"',
    nav_placement="Admin area entry; not in the main sidebar for non-admins",
    deep_link="/admin/jurisdictions, /admin/feature-flags, /admin/shadow-mode",
    lovable_only="No",
    fake_risk="Medium — the console must not link to admin surfaces that are placeholders without labelling them",
    preserve="Preserve AdminLayout gating and all real admin children (jurisdictions, feature flags, shadow mode).",
    do_not="Do not present placeholder admin children as live (see L080-L082).",
    backend_work="None.",
    frontend_work="Adopt Lovable's admin card grid; label placeholder children explicitly.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="M",
    phase="Phase 5 — admin and settings surfaces",
    acceptance="Admin console restyled; real children unchanged; placeholder children visibly marked Preview.",
    test_hook="Manual admin console smoke with an admin demo account",
    owner_decision="No",
    audit="src/App.tsx lines 134-158. PermitPilot's admin tree differs from Lovable's substantially.",
))

add(row(
    id="L080",
    pp_name="Admin · Authorizations (Preview placeholder)",
    pp_routes="/admin/authorizations",
    pp_exists="Yes — placeholder only",
    pp_files="src/pages/placeholders/AdminPreviewPlaceholders.tsx",
    pp_nav="Admin console card",
    pp_auth="Signed-in admin area via AdminLayout",
    pp_data="None — labelled Preview placeholder",
    pp_backend="None. There is no client_authorizations table in PermitPilot.",
    pp_connected="None",
    pp_status="Placeholder (labelled Preview only, PD-5)",
    match="UI match only",
    confidence="High",
    ui_parity="Weak — the route exists but renders a Preview notice, not a review table",
    func_parity="None — no authorization records exist to review",
    route_decision="Keep PP route",
    target_route="/admin/authorizations",
    naming='Keep "Authorizations" with an explicit Preview badge',
    nav_placement="Admin console card, visibly marked Preview",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="High — Lovable's version looks fully connected (search, detail dialog, CSV export) over a table PermitPilot does not have",
    preserve="Preserve the explicit 'Preview only (PD-5)' integration note. It is the guard against this being mistaken for live.",
    do_not="Do not implement search, detail dialogs or CSV export here. Directive: admin LOA/members/audit are Preview placeholders in PermitPilot and are NOT fully connected despite Lovable showing them as connected.",
    backend_work="A client_authorizations table with RLS, plus the L019 signing path, before any review UI.",
    frontend_work="Styling of the placeholder only. No functional controls.",
    blockers="Depends on L019 (LOA signing) and legal review.",
    priority="P2",
    risk="High",
    effort="M",
    phase="Blocked — placeholder styling only until L019 is approved",
    acceptance="Page still renders the Preview notice; no export or detail control exists; the PD-5 note is visible.",
    test_hook="Manual visit to /admin/authorizations; confirm the Preview note renders",
    owner_decision="Yes — blocked on the same legal decision as L019",
    audit="src/App.tsx line 139 uses AdminAuthorizationsPlaceholder.",
))

add(row(
    id="L081",
    pp_name="Admin · Members (Preview placeholder over real role data)",
    pp_routes="/admin/members",
    pp_exists="Yes — placeholder only",
    pp_files="src/pages/placeholders/AdminPreviewPlaceholders.tsx (AdminPreviewPlaceholder)",
    pp_nav="Admin console card",
    pp_auth="Signed-in admin area via AdminLayout",
    pp_data="None on this page. PermitPilot's real data lives in user_roles and project invites.",
    pp_backend="send-project-team-invitation (real, used elsewhere); user_roles (real)",
    pp_connected="None on this page",
    pp_status="Placeholder (labelled Preview only, PD-5)",
    match="Backend match only",
    confidence="High",
    ui_parity="Weak — Lovable has a three-tab invite/approve console; PermitPilot renders a Preview notice",
    func_parity="Partial — PermitPilot really does have roles and invitations, but not a workspace approval workflow",
    route_decision="Keep PP route",
    target_route="/admin/members",
    naming='Keep "Members" with an explicit Preview badge',
    nav_placement="Admin console card, visibly marked Preview",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="High — approve/reject buttons that do not write would silently fail to grant or deny access",
    preserve="Preserve PermitPilot user_roles and project invites exactly as the placeholder note instructs. Do not migrate to a workspace_invitations model without an explicit decision.",
    do_not="Do not implement invite, approve or reject actions here. Directive: treat as Preview only, not live workspace approvals.",
    backend_work="A decision first: keep user_roles + project invites, or adopt a workspace membership model. Then RLS and audit writes.",
    frontend_work="Styling of the placeholder only. No functional controls.",
    blockers="Needs a membership model decision (user_roles vs workspace_invitations).",
    priority="P2",
    risk="High",
    effort="M",
    phase="Blocked — placeholder styling only until the membership model is decided",
    acceptance="Page still renders the Preview notice; no approve/reject/invite control exists; user_roles and project invites unchanged.",
    test_hook="Manual visit to /admin/members; confirm the Preview note renders",
    owner_decision="Yes — membership model decision required",
    audit="src/App.tsx lines 140-148; the placeholder note explicitly says to keep user_roles and project invites until decided.",
))

add(row(
    id="L082",
    pp_name="Admin · Audit log (Preview placeholder)",
    pp_routes="/admin/audit",
    pp_exists="Yes — placeholder only",
    pp_files="src/pages/placeholders/AdminPreviewPlaceholders.tsx (AdminPreviewPlaceholder)",
    pp_nav="Admin console card",
    pp_auth="Signed-in admin area via AdminLayout",
    pp_data="None — no access_audit_log writers exist yet",
    pp_backend="None",
    pp_connected="None",
    pp_status="Placeholder (labelled Preview only, PD-5)",
    match="UI match only",
    confidence="High",
    ui_parity="Weak — the route exists but renders a Preview notice, not a log table",
    func_parity="None — nothing writes audit events yet",
    route_decision="Keep PP route",
    target_route="/admin/audit",
    naming='Keep "Audit log" with an explicit Preview badge',
    nav_placement="Admin console card, visibly marked Preview",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="High — an empty audit log implies 'no suspicious activity' when the truth is 'nothing is being recorded'",
    preserve="Preserve the 'Requires access_audit_log writers before export/filter are live' note.",
    do_not="Do not implement view, filter or export here. Directive: Preview placeholder, not connected.",
    backend_work="access_audit_log writers across auth, admin and data-access paths, then a read API with RLS.",
    frontend_work="Styling of the placeholder only. No functional controls.",
    blockers="Needs audit writers before any read surface.",
    priority="P2",
    risk="High",
    effort="M",
    phase="Blocked — placeholder styling only until audit writers exist",
    acceptance="Page still renders the Preview notice; no filter or export control exists.",
    test_hook="Manual visit to /admin/audit; confirm the Preview note renders",
    owner_decision="Yes — audit scope and retention need a decision",
    audit="src/App.tsx lines 149-157; the placeholder note names the missing writers.",
))

add(deferred(
    "L083",
    reason="PermitPilot bills through Stripe, not QuickBooks. Replicating a QuickBooks invoicing page would misrepresent how billing actually works.",
    pp_name="Stripe billing (different architecture)",
    pp_routes="Stripe-hosted checkout and customer portal (no in-app invoicing page)",
    pp_exists="No — no invoicing page",
    pp_files="supabase/functions/create-checkout; customer-portal; check-subscription; stripe-webhook",
    pp_nav="Pricing page → checkout; account → customer portal",
    pp_auth="Signed-in",
    pp_data="Stripe subscriptions and invoices (held by Stripe)",
    pp_backend="create-checkout; customer-portal; check-subscription; stripe-webhook",
    pp_connected="Yes (Stripe)",
    pp_status="Billing real, via Stripe",
    match="Same purpose different architecture",
    ui_parity="None — PermitPilot delegates invoice display to Stripe's customer portal",
    func_parity="Comparable outcome, different system: real billing exists, just not as an in-app QuickBooks view",
    route_decision="Do not build",
    target_route="Stripe customer portal",
    naming='Use "Billing" and link to the Stripe customer portal',
    fake_risk="High — an in-app invoice list that does not reconcile with Stripe would be a financial-accuracy risk",
    preserve="Preserve the Stripe checkout, webhook and customer-portal flows untouched.",
    do_not="Do not build a QuickBooks invoicing page. Link to the Stripe customer portal instead.",
    backend_work="None. A QuickBooks integration is not planned.",
    frontend_work="None beyond a billing link, if one is missing.",
    blockers="None — decision is simply to stay on Stripe.",
    priority="P3",
    risk="Medium",
    effort="M",
    phase="Out of scope — Stripe is the billing system of record",
    acceptance="Billing continues to route to Stripe; no in-app invoice table exists.",
    test_hook="Manual checkout and customer-portal smoke in Stripe test mode",
    owner_decision="Yes — only if the client insists on QuickBooks",
    audit="Four real Stripe functions exist; QuickBooks does not appear anywhere in the codebase.",
))

add(missing(
    "L084",
    reason="No past-performance record model exists in PermitPilot.",
    match="Missing in PermitPilot",
    do_not="Do not build. Past-performance claims are client-facing and must never be generated from mock data.",
    audit="Lovable page is mock.",
))

add(deferred(
    "L085",
    reason="Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... CRM'. PermitPilot has lead capture and drip campaigns but no CRM domain.",
    pp_name="Lead capture + drip campaigns (not a CRM)",
    pp_routes="Lead capture modal on marketing pages",
    pp_exists="No — no CRM surface",
    pp_files="src/contexts/LeadCaptureContext.tsx; src/components/lead-capture/LeadCaptureModal.tsx; supabase/functions/admin-drip-campaigns; process-drip-emails",
    pp_nav="Marketing pages",
    pp_auth="Public for capture; admin for campaigns",
    pp_data="Supabase leads and drip campaign state",
    pp_backend="admin-drip-campaigns; process-drip-emails",
    pp_connected="Yes (lead capture and drips)",
    pp_status="Lead capture real; no CRM",
    match="Backend match only",
    ui_parity="None — no CRM UI",
    func_parity="Weak — real lead capture and nurture emails, but no accounts, contacts, deals or pipeline",
    route_decision="Do not build",
    target_route="— (no route)",
    fake_risk="High — a CRM with no pipeline model would become a shadow system of record for client relationships",
    preserve="Preserve lead capture and the drip campaign functions.",
    do_not="Do not build a CRM. Directive is explicit. If CRM is needed, integrate a real CRM rather than simulating one.",
    backend_work="A full CRM domain, or an integration with an external CRM.",
    frontend_work="None.",
    blockers="Explicit directive plus the absence of a CRM domain.",
    priority="P3",
    risk="High",
    effort="XL",
    phase="Out of scope — explicit directive",
    acceptance="No CRM surface is added.",
    owner_decision="Yes — would require a product decision to buy or build",
    audit="Real drip campaign functions exist; they are marketing automation, not a CRM.",
))

add(missing(
    "L086",
    reason="PermitPilot's billing is Stripe subscription based, with no milestone billing model.",
    match="Missing in PermitPilot",
    do_not="Do not build. Blocked on the same billing-architecture decision as L083.",
    risk="Medium",
    effort="L",
    audit="See L083: Stripe, not milestone invoicing.",
))

add(row(
    id="L087",
    pp_name="API Documentation",
    pp_routes="/api-docs",
    pp_exists="Yes",
    pp_files="src/pages/APIDocumentation.tsx",
    pp_nav="Direct URL; documentation links",
    pp_auth="Signed-in via ProtectedLayoutRoute",
    pp_data="Curated endpoint documentation",
    pp_backend="None (documentation)",
    pp_connected="None (static by design)",
    pp_status="Working",
    match="Partial match",
    confidence="Medium",
    ui_parity="Partial — both list endpoints; PermitPilot's version is real documentation, Lovable's is a placeholder registry",
    func_parity="PermitPilot is ahead — its endpoint list reflects real functions",
    route_decision="Fold into existing PP surface",
    target_route="/api-docs",
    naming='Keep "API docs"; do not add an "Endpoints" admin page',
    nav_placement="Documentation links; not an admin card",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Low",
    preserve="Preserve the documented endpoint list; keep it accurate against supabase/functions and the scraper API.",
    do_not="Do not add /admin/endpoints as a second endpoint registry.",
    backend_work="None.",
    frontend_work="Optional styling alignment.",
    blockers="None.",
    priority="P3",
    risk="Low",
    effort="S",
    phase="Phase 7 — documentation and polish",
    acceptance="API docs remain accurate; no duplicate endpoint page added.",
    test_hook="Manual visit to /api-docs",
    owner_decision="No",
    audit="src/App.tsx line 160.",
))

# ---- Demo / Internal ------------------------------------------------------------------

add(row(
    id="L088",
    pp_name="Demos",
    pp_routes="/demos",
    pp_exists="Yes",
    pp_files="src/pages/Demos.tsx; src/components/layout/MarketingLayout.tsx",
    pp_nav="Marketing nav → Demos",
    pp_auth="Public",
    pp_data="Curated demo content",
    pp_backend="None",
    pp_connected="None (marketing content)",
    pp_status="Working",
    match="Same purpose different architecture",
    confidence="Medium",
    ui_parity="Weak — Lovable has a single client-branded guided tour; PermitPilot has a public demo index",
    func_parity="Comparable intent (sales demonstration), different structure",
    route_decision="Fold into existing PP surface",
    target_route="/demos",
    naming='Keep "Demos"',
    nav_placement="Marketing nav only",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="Medium — clearly-labelled demo content is acceptable; unlabelled client-branded data is not",
    preserve="Preserve the public marketing demo index and its labelling.",
    do_not="Do not create a client-branded demo (Lovable uses a real quick-service-restaurant brand) without written approval, and never present demo figures as production data.",
    backend_work="None.",
    frontend_work="Optionally adopt Lovable's guided-tour spotlight pattern on /demos, with every screen labelled as a demo.",
    blockers="Brand usage approval for any named-client demo.",
    priority="P2",
    risk="Low",
    effort="S",
    phase="Phase 2 — public / marketing shell",
    acceptance="Demo content is visibly labelled as a demo; no unapproved client brand appears.",
    test_hook="Manual visit to /demos",
    owner_decision="Yes — brand usage approval needed for any named-client demo",
    audit="Lovable's demo is branded and signed-in; PermitPilot's is public and generic.",
))

add(row(
    id="L089",
    pp_name="This matrix (repo documentation) + /mvp-documentation",
    pp_routes="reference/lovable-ui/lovable-permitpilot-architecture-matrix.md; /mvp-documentation",
    pp_exists="Partial — documentation lives in the repo, not as an app route",
    pp_files="reference/lovable-ui/lovable-permitpilot-architecture-matrix.md; scripts/generate-lovable-permitpilot-matrix.py",
    pp_nav="Repository documentation, not application navigation",
    pp_auth="n/a — repo file",
    pp_data="Hand-curated audit data",
    pp_backend="None",
    pp_connected="n/a",
    pp_status="Working (this document)",
    match="Same purpose different architecture",
    confidence="High",
    ui_parity="None — PermitPilot keeps architecture documentation out of the shipped app",
    func_parity="Comparable — same inventory purpose, delivered as repo docs plus CSV instead of a page",
    route_decision="Do not build",
    target_route="— (repo documentation)",
    naming='Refer to it as the "Lovable ↔ PermitPilot architecture matrix"',
    nav_placement="Not in application navigation",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="None",
    preserve="Preserve this matrix as the source of truth: no status change without updating it.",
    do_not="Do not ship an in-app architecture inventory page. Documentation that lives in the app drifts from the code; documentation next to the code does not.",
    backend_work="None.",
    frontend_work="None.",
    blockers="None.",
    priority="P3",
    risk="Low",
    effort="S",
    phase="Phase 0 — this document",
    acceptance="Matrix and CSV exist, cover all 90 Lovable rows, and are regenerated by the script whenever decisions change.",
    test_hook="python3 scripts/generate-lovable-permitpilot-matrix.py (idempotent regeneration)",
    owner_decision="No",
    audit="This row is self-referential: the Lovable inventory page is replaced by this repo matrix.",
))

add(row(
    id="L090",
    pp_name="NotFound (true 404)",
    pp_routes="*",
    pp_exists="Yes",
    pp_files="src/pages/NotFound.tsx; src/App.tsx line 189",
    pp_nav="Any unmatched URL",
    pp_auth="n/a",
    pp_data="None",
    pp_backend="None",
    pp_connected="n/a",
    pp_status="Working",
    match="Same purpose different architecture",
    confidence="High",
    ui_parity="Weak — Lovable redirects to /dashboard, PermitPilot renders a 404 page",
    func_parity="PermitPilot is better — it surfaces broken links instead of hiding them",
    route_decision="Keep PP route",
    target_route="* → NotFound",
    naming='Keep "Page not found"',
    nav_placement="n/a",
    deep_link="n/a",
    lovable_only="No",
    fake_risk="None",
    preserve="Preserve the true 404 page.",
    do_not="Do not adopt Lovable's redirect-to-dashboard fallback. Lovable's own inventory admits it 'masks true 404s', which hides broken links and typo'd routes from both users and monitoring.",
    backend_work="None.",
    frontend_work="Optionally restyle the 404 page to match the Lovable visual language.",
    blockers="None.",
    priority="P1",
    risk="Low",
    effort="S",
    phase="Phase 1 — foundation / auth surfaces",
    acceptance="An unmatched URL renders the 404 page, not a dashboard redirect.",
    test_hook="Visit /this-route-does-not-exist and confirm a 404 renders",
    owner_decision="No",
    audit="Deliberate divergence where PermitPilot's behavior is correct and Lovable's is not.",
))

# --------------------------------------------------------------------------------------
# PermitPilot-only surfaces (no Lovable equivalent)
# --------------------------------------------------------------------------------------

PP_ONLY = [
    dict(id="PP01", name="Auth (unified)", route="/auth", files="src/pages/Auth.tsx",
         status="Working", backend="Supabase auth; send-welcome-email",
         why="Lovable splits sign-in and sign-up into two pages. PermitPilot's single Auth page with a view switch is the canonical entry.",
         decision="Preserve as-is. Style only.", priority="P1", risk="Low"),
    dict(id="PP02", name="Pricing", route="/pricing", files="src/pages/Pricing.tsx",
         status="Working", backend="create-checkout; check-subscription",
         why="Lovable has no pricing or self-serve purchase surface at all.",
         decision="Preserve. Style within the marketing phase.", priority="P2", risk="Low"),
    dict(id="PP03", name="FAQ", route="/faq", files="src/pages/FAQ.tsx",
         status="Working", backend="None",
         why="Public FAQ; no Lovable counterpart.",
         decision="Preserve. Style within the marketing phase.", priority="P3", risk="Low"),
    dict(id="PP04", name="Install (PWA)", route="/install", files="src/pages/Install.tsx; src/components/pwa/InstallPrompt.tsx",
         status="Working", backend="Service worker / PWA manifest",
         why="PermitPilot ships a real installable PWA plus Capacitor config; Lovable has mobile mock pages instead.",
         decision="Preserve. Do not replace with Lovable's mock mobile pages.", priority="P2", risk="Low"),
    dict(id="PP05", name="Client Portal (tokenised)", route="/portal/:token", files="src/pages/ClientPortal.tsx",
         status="Working", backend="Supabase token validation",
         why="Token-scoped external client view. Lovable has no external sharing model.",
         decision="Preserve exactly. Token scoping is a security boundary — no styling change may widen data exposure.",
         priority="P1", risk="High"),
    dict(id="PP06", name="Embed Widget", route="/embed/:token", files="src/pages/EmbedWidget.tsx",
         status="Working", backend="Supabase token validation",
         why="Embeddable tokenised widget for client sites. No Lovable equivalent.",
         decision="Preserve exactly. Same security boundary as PP05.", priority="P1", risk="High"),
    dict(id="PP07", name="Invite Accept", route="/invite/:token", files="src/pages/InviteAccept.tsx",
         status="Working", backend="send-project-team-invitation; Supabase invite validation",
         why="Real project team invitation acceptance. Lovable's Members console implies invitations but has a different model.",
         decision="Preserve. Directive: keep PermitPilot invites. Relevant to the L081 membership decision.",
         priority="P1", risk="Medium"),
    dict(id="PP08", name="Permit Intelligence", route="/permit-intelligence", files="src/pages/PermitIntelligence.tsx",
         status="Working", backend="shovels-api; property-intelligence-agent",
         why="Real third-party permit history and property intelligence. Lovable has no equivalent.",
         decision="Preserve. Style in Phase 4. Consider it the real answer to Lovable's Feasibility pages (L017/L018).",
         priority="P1", risk="Medium"),
    dict(id="PP09", name="ROI Calculator", route="/roi-calculator", files="src/pages/ROICalculator.tsx",
         status="Working", backend="None (client-side model)",
         why="Sales calculator with no Lovable counterpart.",
         decision="Preserve. Style in the marketing phase.", priority="P3", risk="Low"),
    dict(id="PP10", name="Consolidation Calculator", route="/consolidation-calculator", files="src/pages/ConsolidationCalculator.tsx",
         status="Working", backend="None (client-side model)",
         why="Portfolio consolidation modelling; no Lovable counterpart.",
         decision="Preserve. Style in the marketing phase.", priority="P3", risk="Low"),
    dict(id="PP11", name="State Landing Pages", route="/jurisdictions/:stateCode", files="src/pages/StateLandingPage.tsx",
         status="Working", backend="Supabase jurisdiction data; territory datasets",
         why="Per-state SEO and jurisdiction detail pages. Lovable has no dynamic jurisdiction routing.",
         decision="Preserve. Do not collapse into the map page.", priority="P2", risk="Medium"),
    dict(id="PP12", name="Comment Review", route="/comment-review", files="src/pages/CommentReview.tsx",
         status="Working", backend="parse-permit-comments; parse-manual-comment-letter; comment-parser-agent",
         why="Real comment letter ingestion and review. Lovable's Response Matrix assumes comments already exist.",
         decision="Preserve. It is the upstream half of L023 and must be styled alongside it.", priority="P0", risk="Medium"),
    dict(id="PP13", name="Classified Comments", route="/classified-comments", files="src/pages/ClassifiedComments.tsx",
         status="Working", backend="discipline-classifier-agent; permit-classifier-agent",
         why="Real discipline classification output. No Lovable counterpart.",
         decision="Preserve. Style alongside L023.", priority="P1", risk="Medium"),
    dict(id="PP14", name="Admin · Jurisdictions", route="/admin/jurisdictions", files="src/pages/JurisdictionAdmin.tsx",
         status="Working", backend="Supabase jurisdiction tables",
         why="Real jurisdiction configuration admin. Lovable's admin tree has nothing comparable.",
         decision="Preserve. Style in Phase 5.", priority="P1", risk="Medium"),
    dict(id="PP15", name="Admin · Feature Flags", route="/admin/feature-flags", files="src/pages/FeatureFlagsAdmin.tsx",
         status="Working", backend="Supabase feature flag tables",
         why="Real runtime feature flagging. No Lovable counterpart.",
         decision="Preserve. Useful for gating any risky Lovable UI behind a flag.", priority="P1", risk="Medium"),
    dict(id="PP16", name="Admin · Shadow Mode", route="/admin/shadow-mode", files="src/pages/ShadowModeDashboard.tsx",
         status="Working", backend="shadow-evaluator; shadow-metrics; circuit-breaker-check",
         why="Real shadow evaluation and circuit-breaker telemetry for the automation pipeline. No Lovable counterpart.",
         decision="Preserve untouched. This is production safety tooling.", priority="P1", risk="High"),
    dict(id="PP17", name="Design System Preview", route="/design-system-preview", files="src/pages/EpermitDesignSystemPreview.tsx",
         status="Working", backend="None",
         why="Internal token and component preview. No Lovable counterpart.",
         decision="Preserve and use it as the reference surface for Lovable token alignment before touching product pages.",
         priority="P0", risk="Low"),
    dict(id="PP18", name="Baltimore Accela portal clone", route="/baltimore, /baltimore/permits, /baltimore/records, /baltimore/records/:recordId",
         files="src/pages/baltimore/*; src/components/portal/AccelaProjectView.tsx",
         status="Mock (labelled UI-only clone)", backend="None — deliberately mock",
         why="A deliberate UI reference clone of a real jurisdiction portal, used for scraper and portal-parity work.",
         decision="Preserve as an explicitly labelled mock. Do not restyle into something that looks like live Baltimore data.",
         priority="P3", risk="Medium"),
    dict(id="PP19", name="Live utility scraper service", route="scraper-service HTTP API (/api/uci and others)",
         files="scraper-service/app/routes/*; scraper-service/app/services/uci/*",
         status="Working", backend="Node scraper service on Railway",
         why="The real data engine behind UCI and portal harvest. Lovable has no backend at all.",
         decision="Preserve. Any scraper change deploys to Railway development only, never production, and never as part of a styling change.",
         priority="P0", risk="High"),
    dict(id="PP20", name="Utility territory dataset (19 states)", route="scraper-service/data/territory/electric-full-v2/*",
         files="territories_*.geojson; county_utility.json; footprint_validation_report.json",
         status="Working", backend="Generated and validated datasets",
         why="Real service-territory geometry with reconciliation and validation reports. Lovable's coverage matrix is static reference text.",
         decision="Preserve. All coverage claims must trace to the validation reports.", priority="P1", risk="Medium"),
    dict(id="PP21", name="Document ingestion worker", route="document-ingestion-worker/",
         files="document-ingestion-worker/*; supabase/functions/ingest-project-document",
         status="Working", backend="Worker + edge function",
         why="Real asynchronous document ingestion. Lovable's Document Vault is a mock browser.",
         decision="Preserve. Any document UI must go through this pipeline.", priority="P1", risk="Medium"),
    dict(id="PP22", name="Grounded response generation", route="supabase/functions/generate-grounded-response",
         files="generate-grounded-response; context-reference-engine; generate-response; export-response-package",
         status="Working", backend="Edge functions with citation grounding",
         why="Real citation-grounded response drafting behind L023. Lovable's Response Matrix has no generation backend.",
         decision="Preserve exactly. Response text must always come from these functions so citations stay verifiable.",
         priority="P0", risk="High"),
    dict(id="PP23", name="Scheduled reporting and notification layer", route="supabase/functions/process-scheduled-*",
         files="process-scheduled-checklist-reports; process-scheduled-notifications; send-deadline-reminders; retry-failed-report-emails; export-weekly-report",
         status="Working", backend="Scheduled edge functions",
         why="Real recurring delivery of reports and reminders. Lovable has no scheduling layer.",
         decision="Preserve. Do not touch schedules or triggers during UI work.", priority="P1", risk="High"),
    dict(id="PP24", name="Stripe billing", route="Stripe checkout and customer portal",
         files="create-checkout; customer-portal; check-subscription; stripe-webhook",
         status="Working", backend="Stripe + webhook",
         why="Real payment processing. Lovable shows a mock QuickBooks invoicing page instead (see L083).",
         decision="Preserve. Stripe remains the billing system of record.", priority="P1", risk="High"),
    dict(id="PP25", name="Theme system and command palette", route="Global",
         files="src/hooks/useTheme.tsx; src/components/navigation/CommandPalette.tsx",
         status="Working", backend="None",
         why="Dark mode plus a keyboard command palette that already deep-links into UCI sections. Lovable has neither.",
         decision="Preserve. Command palette entries must stay in sync with the route decisions in this matrix.",
         priority="P1", risk="Low"),
]


# --------------------------------------------------------------------------------------
# Inventory parsing
# --------------------------------------------------------------------------------------

def split_md_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def parse_inventory(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    m = re.search(r"^## Main Table\s*$", text, re.M)
    if not m:
        raise SystemExit("Could not find '## Main Table' in the inventory")
    body = text[m.end():]
    stop = re.search(r"^## ", body, re.M)
    if stop:
        body = body[: stop.start()]

    rows = []
    header_seen = False
    for line in body.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = split_md_row(line)
        if not header_seen:
            if cells[0] == "Area":
                if cells != LOVABLE_COLS:
                    raise SystemExit(
                        f"Inventory header drifted from the expected 22 Lovable columns.\n"
                        f"got: {cells}\nexpected: {LOVABLE_COLS}"
                    )
                header_seen = True
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        if len(cells) != len(LOVABLE_COLS):
            raise SystemExit(f"Row has {len(cells)} cells, expected {len(LOVABLE_COLS)}: {cells[:4]}")
        # Values are preserved verbatim; genuinely blank inventory cells (mostly Notes)
        # become an em dash so no cell in the emitted CSV is ambiguously empty.
        rows.append({k: (v if v else "—") for k, v in zip(LOVABLE_COLS, cells)})
    return rows


def build_matrix(lov_rows: list[dict]) -> list[dict]:
    out = []
    for i, lov in enumerate(lov_rows, start=1):
        rid = f"L{i:03d}"
        pp = PP_ROWS.get(rid)
        if pp is None:
            raise SystemExit(f"No PermitPilot mapping defined for {rid} ({lov['Name']} {lov['Route']})")
        rec = dict(lov)
        for key, col in zip(PP_KEYS, PP_COLS):
            rec[col] = pp[key]
        rec["Matrix Row ID"] = rid
        out.append(rec)
    return out


def validate(matrix: list[dict]) -> None:
    problems = []
    for r in matrix:
        rid = r["Matrix Row ID"]
        if r["Match Status"] not in MATCH_ENUM:
            problems.append(f"{rid}: bad Match Status {r['Match Status']!r}")
        if r["Route Decision"] not in ROUTE_ENUM:
            problems.append(f"{rid}: bad Route Decision {r['Route Decision']!r}")
        if r["Priority"] not in PRIORITY_ENUM:
            problems.append(f"{rid}: bad Priority {r['Priority']!r}")
        if r["Risk"] not in RISK_ENUM:
            problems.append(f"{rid}: bad Risk {r['Risk']!r}")
        if r["Effort"] not in EFFORT_ENUM:
            problems.append(f"{rid}: bad Effort {r['Effort']!r}")
        for col in ALL_COLS:
            if str(r.get(col, "")).strip() == "":
                problems.append(f"{rid}: empty column {col!r}")
    if problems:
        raise SystemExit("Validation failed:\n  " + "\n  ".join(problems))


# --------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------

def esc(v: str) -> str:
    return str(v).replace("|", "\\|").replace("\n", " ")


def write_csv(matrix: list[dict]) -> None:
    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=ALL_COLS, extrasaction="raise")
        w.writeheader()
        for r in matrix:
            w.writerow({c: r[c] for c in ALL_COLS})


def md_table(headers: list[str], rows: list[list[str]], align: str | None = None) -> str:
    sep = align or "|".join(["---"] * len(headers))
    lines = ["| " + " | ".join(headers) + " |", "|" + sep + "|"]
    for r in rows:
        lines.append("| " + " | ".join(esc(c) for c in r) + " |")
    return "\n".join(lines)


def write_md(matrix: list[dict], generated: str) -> None:
    counts = Counter(r["Match Status"] for r in matrix)
    prio = Counter(r["Priority"] for r in matrix)
    route_dec = Counter(r["Route Decision"] for r in matrix)
    risk = Counter(r["Risk"] for r in matrix)
    phases = Counter(r["Phase"] for r in matrix)

    L = []
    A = L.append

    A("# Lovable ↔ PermitPilot Architecture Matrix")
    A("")
    A("> **Read this first.**")
    A(">")
    A("> - **Lovable is a client-facing visual reference only.** Its 90 routes are a UI prototype: 65 of them are")
    A(">   explicitly mock, 5 are placeholders, and only 8 touch a backend. Nothing in Lovable is a specification")
    A(">   for how PermitPilot should behave.")
    A("> - **PermitPilot is the real implementation.** Where the two disagree about data, routing, permissions or")
    A(">   workflow, PermitPilot wins. Several rows below deliberately diverge from Lovable because Lovable's")
    A(">   approach is worse (see L007, L090).")
    A("> - **This matrix is the source of truth** for what gets built, what gets folded into an existing surface,")
    A(">   and what must never be built. It supersedes the in-app architecture inventory page (see L089).")
    A("> - **No status change without updating this matrix.** If you implement, defer, re-scope or reject a row,")
    A(">   edit `scripts/generate-lovable-permitpilot-matrix.py` and regenerate both files in the same commit as")
    A(">   the code change. A row whose status is stale is worse than no row at all.")
    A("> - **Branch:** all work described here belongs on `" + BRANCH + "`. Never on `main`.")
    A(">")
    A(f"> **Last audited:** {AUDIT_DATE} · **Generated:** {generated}")
    A("")
    A("## Provenance")
    A("")
    A(md_table(
        ["Item", "Value"],
        [
            ["Lovable inventory (input)", "`reference/lovable-ui/architecture-inventory.md` (90 rows, columns Area…Notes)"],
            ["Lovable original", "`/Users/javerianaveed/epermit/loveable architecture /architecture-inventory.md`"],
            ["PermitPilot routing audited", "`src/App.tsx`"],
            ["PermitPilot UCI vocabulary audited", "`src/lib/uciNavSections.ts`, `src/components/layout/UciSidebarNav.tsx`"],
            ["PermitPilot backend audited", "`supabase/functions/*` (52 functions), `scraper-service/*`, `document-ingestion-worker/*`"],
            ["Full 57-column data", "`reference/lovable-ui/lovable-permitpilot-architecture-matrix.csv`"],
            ["Generator", "`scripts/generate-lovable-permitpilot-matrix.py`"],
            ["Branch", f"`{BRANCH}`"],
        ],
    ))
    A("")
    A("### Column contract")
    A("")
    A("The CSV carries all 57 columns. Columns 1–22 are the Lovable inventory columns, copied verbatim and")
    A("unmodified. Columns 23–57 are the PermitPilot decision columns added by this matrix.")
    A("")
    A(md_table(
        ["Range", "Columns"],
        [
            ["1–22 (Lovable, verbatim)", ", ".join(LOVABLE_COLS)],
            ["23–57 (PermitPilot decisions)", ", ".join(PP_COLS)],
        ],
    ))
    A("")

    # ---- Summary metrics
    A("## Summary metrics")
    A("")
    A(md_table(
        ["Metric", "Count"],
        [
            ["Lovable rows mapped", str(len(matrix))],
            ["Total columns per row", str(len(ALL_COLS))],
            ["PermitPilot-only surfaces (no Lovable equivalent)", str(len(PP_ONLY))],
            ["Rows with a PermitPilot route or section today", str(sum(1 for r in matrix if r["PP Route Exists"].startswith(("Yes", "Partial"))))],
            ["Rows with no PermitPilot surface at all", str(sum(1 for r in matrix if r["PP Route Exists"].startswith("No")))],
            ["Rows where PermitPilot's backend is ahead of Lovable's", str(sum(1 for r in matrix if r["Match Status"] == "Backend match only"))],
            ["Rows carrying High fake-backend risk", str(sum(1 for r in matrix if r["Fake-Backend Risk"].startswith("High")))],
            ["Rows needing an owner decision", str(sum(1 for r in matrix if r["Owner Decision Needed"].startswith("Yes")))],
        ],
        align="---|---:",
    ))
    A("")
    A("### Match status distribution")
    A("")
    A(md_table(
        ["Match Status", "Count", "Meaning"],
        [
            ["Exact match", str(counts.get("Exact match", 0)),
             "Reserved for byte-for-byte equivalence. Deliberately zero: nothing in Lovable is an exact match for a real implementation."],
            ["Strong functional match", str(counts.get("Strong functional match", 0)),
             "Same surface, same job, PermitPilot already does it (usually for real, where Lovable is mock)."],
            ["Partial match", str(counts.get("Partial match", 0)),
             "PermitPilot covers some of the surface; specific capability gaps are named per row."],
            ["Same purpose different architecture", str(counts.get("Same purpose different architecture", 0)),
             "Both solve the same problem via different routing or systems. PermitPilot's shape is kept."],
            ["UI match only", str(counts.get("UI match only", 0)),
             "The route exists in PermitPilot but renders a labelled placeholder with no backend."],
            ["Backend match only", str(counts.get("Backend match only", 0)),
             "PermitPilot has the real backend and Lovable has only the screen. The inverse of the usual gap."],
            ["Missing in PermitPilot", str(counts.get("Missing in PermitPilot", 0)),
             "No PermitPilot equivalent. Most of these are explicitly not to be built."],
        ],
    ))
    A("")
    A("### Route decisions")
    A("")
    A(md_table(
        ["Route Decision", "Count"],
        [[k, str(v)] for k, v in sorted(route_dec.items(), key=lambda kv: -kv[1])],
        align="---|---:",
    ))
    A("")
    A("### Priority, risk and phase")
    A("")
    A(md_table(
        ["Priority", "Count", "Definition"],
        [
            ["P0", str(prio.get("P0", 0)), "Foundational. Real PermitPilot data behind it, highest visual payoff, no contract change."],
            ["P1", str(prio.get("P1", 0)), "High value. Real backing data; restyle after the P0 surfaces set the pattern."],
            ["P2", str(prio.get("P2", 0)), "Do after P0/P1, or blocked on a decision rather than on effort."],
            ["P3", str(prio.get("P3", 0)), "Backlog or explicitly out of scope."],
        ],
        align="---|---:|---",
    ))
    A("")
    A(md_table(["Risk", "Count"], [[k, str(risk.get(k, 0))] for k in ("Low", "Medium", "High")], align="---|---:"))
    A("")
    A(md_table(
        ["Phase", "Rows"],
        [[k, str(v)] for k, v in sorted(phases.items(), key=lambda kv: (-kv[1], kv[0]))],
        align="---|---:",
    ))
    A("")

    # ---- Compact all-rows table
    A("## All 90 Lovable rows — key decisions")
    A("")
    A("Every Lovable row appears here. The remaining 45 columns for each row are in the CSV.")
    A("")
    A(md_table(
        ["ID", "Area", "Lovable Name", "Lovable Route", "Lovable Status",
         "PP Equivalent", "PP Route Today", "Match Status", "Route Decision",
         "Target PP Route", "Pri", "Risk", "Eff"],
        [[
            r["Matrix Row ID"], r["Area"], r["Name"], f"`{r['Route']}`", r["Status"],
            r["PP Equivalent Name"], r["PP Route(s) Today"], r["Match Status"],
            r["Route Decision"], r["Target PP Route (Decided)"],
            r["Priority"], r["Risk"], r["Effort"],
        ] for r in matrix],
    ))
    A("")

    # ---- Per-row detail
    A("## Per-row decisions in detail")
    A("")
    A("Grouped by Lovable area. Each block carries the decision fields that a implementer needs before")
    A("touching code; the CSV holds the full 57-column record.")
    A("")
    seen_area = None
    for r in matrix:
        if r["Area"] != seen_area:
            seen_area = r["Area"]
            A(f"### {seen_area}")
            A("")
        A(f"#### {r['Matrix Row ID']} · {r['Name']} — `{r['Route']}`")
        A("")
        A(f"- **Lovable:** {r['Purpose']} · status {r['Status']} · backend {r['Backend']} · source `{r['Source File']}`")
        A(f"- **PermitPilot:** {r['PP Equivalent Name']} · route(s) `{r['PP Route(s) Today']}` · exists: {r['PP Route Exists']} · status {r['PP Functional Status']}")
        A(f"- **PP files:** {r['PP Source File(s)']}")
        A(f"- **PP backend:** {r['PP Backend Endpoint / Function']} · connected: {r['PP Backend Connected']}")
        A(f"- **Match:** {r['Match Status']} (confidence {r['Match Confidence']}) · UI parity: {r['UI Parity']} · functional parity: {r['Functional Parity']}")
        A(f"- **Route decision:** {r['Route Decision']} → `{r['Target PP Route (Decided)']}` · nav: {r['Nav Placement Decision']} · deep link: {r['Deep Link Pattern']}")
        A(f"- **Label to use:** {r['Naming Decision (Label To Use)']}")
        A(f"- **Fake-backend risk:** {r['Fake-Backend Risk']}")
        A(f"- **Preserve:** {r['Preserve-PermitPilot-Logic Notes']}")
        A(f"- **Do not replicate:** {r['Do-Not-Replicate Reason']}")
        A(f"- **Backend work:** {r['Required Backend Work']}")
        A(f"- **Frontend work:** {r['Required Frontend Work']}")
        A(f"- **Blocked by:** {r['Blocking Dependencies']}")
        A(f"- **Priority / risk / effort / phase:** {r['Priority']} · {r['Risk']} · {r['Effort']} · {r['Phase']}")
        A(f"- **Acceptance:** {r['Acceptance Criteria']}")
        A(f"- **Verify with:** {r['Test / Verification Hook']}")
        A(f"- **Owner decision needed:** {r['Owner Decision Needed']}")
        A(f"- **Audit note:** {r['Audit Notes']}")
        A("")

    # ---- PP-only section
    A("## PermitPilot-only surfaces (no Lovable equivalent)")
    A("")
    A("These are real PermitPilot capabilities that Lovable does not model at all. They are listed because the")
    A("main risk in a visual replication project is deleting or bypassing something the reference does not show.")
    A("Every row here must survive the replication unchanged in behavior.")
    A("")
    A(md_table(
        ["ID", "Surface", "Route / Location", "Status", "Backend", "Why it has no Lovable row", "Decision", "Pri", "Risk"],
        [[p["id"], p["name"], f"`{p['route']}`", p["status"], p["backend"], p["why"], p["decision"], p["priority"], p["risk"]]
         for p in PP_ONLY],
    ))
    A("")
    A("Source files for each: " + "; ".join(f"**{p['id']}** `{p['files']}`" for p in PP_ONLY) + ".")
    A("")

    # ---- Gap summary
    high_fake = [r for r in matrix if r["Fake-Backend Risk"].startswith("High")]
    owner_needed = [r for r in matrix if r["Owner Decision Needed"].startswith("Yes")]
    backend_only = [r for r in matrix if r["Match Status"] == "Backend match only"]
    ui_only = [r for r in matrix if r["Match Status"] == "UI match only"]
    do_not_build = [r for r in matrix if r["Route Decision"] == "Do not build"]
    deep_links = [r for r in matrix if r["Route Decision"] == "Deep link (query param)"]
    folds = [r for r in matrix if r["Route Decision"] == "Fold into existing PP surface"]
    p0 = [r for r in matrix if r["Priority"] == "P0"]
    p1 = [r for r in matrix if r["Priority"] == "P1"]
    missing_rows = [r for r in matrix if r["Match Status"] == "Missing in PermitPilot"]

    A("## Gap summary")
    A("")
    A("### 1. Where PermitPilot is already ahead")
    A("")
    A("The headline finding of this audit is that the gap runs in both directions, and mostly in PermitPilot's")
    A("favour on substance. Lovable has 65 mock pages and 8 backend-connected ones. PermitPilot has 52 Supabase")
    A("edge functions, a live scraper service, a document ingestion worker, validated utility territory data for")
    A("19 states, Stripe billing and a shadow-evaluation safety layer — none of which appears in Lovable at all.")
    A(f"On {len(backend_only)} rows PermitPilot has the real backend and Lovable has only the screen: "
      + ", ".join(f"{r['Matrix Row ID']} ({r['Name']})" for r in backend_only) + ".")
    A("")
    A("### 2. Where Lovable is genuinely ahead")
    A("")
    A("Lovable's advantage is visual and organisational, not functional: card and table density, KPI band")
    A("styling, status chips, the expandable UCI navigation vocabulary, and consistent page chrome. Those are")
    A("exactly the things this replication should take. It is also ahead on a handful of *structural* ideas")
    A("worth adopting independently of styling — a real project detail route (L012) and a cross-project filing")
    A("queue (L015).")
    A("")
    A("### 3. Fake-backend risk register")
    A("")
    A(f"{len(high_fake)} rows carry High fake-backend risk — the surface would look authoritative while showing")
    A("nothing real. These are the rows most likely to cause damage if implemented enthusiastically.")
    A("")
    A(md_table(
        ["ID", "Surface", "Why the risk is High", "Decision"],
        [[r["Matrix Row ID"], r["Name"], r["Fake-Backend Risk"], r["Route Decision"]] for r in high_fake],
    ))
    A("")
    A("### 4. Explicitly do-not-build")
    A("")
    A(f"{len(do_not_build)} rows must not be built. Three are direct user directives (Mission Control, CRM, the")
    A("SIR/Field mobile pack); the rest are duplicates, or domains with no PermitPilot data model.")
    A("")
    A(md_table(
        ["ID", "Surface", "Reason"],
        [[r["Matrix Row ID"], r["Name"], r["Do-Not-Replicate Reason"]] for r in do_not_build],
    ))
    A("")
    A("### 5. Routing decisions that must not drift")
    A("")
    A("PermitPilot deliberately has fewer routes than Lovable. Three patterns carry that difference:")
    A("")
    A(f"- **UCI deep links, not routes ({len(deep_links)} rows).** Lovable exposes nine `/uci/*` pages. PermitPilot has")
    A("  one `/uci` hub with `?section=` deep links defined in `src/lib/uciNavSections.ts`, resolving to hub anchors,")
    A("  coordination-drawer tabs, external navigation, or labelled coming-soon panels. Do not add `/uci/*` routes.")
    A(f"- **Folding, not adding ({len(folds)} rows).** Lovable's landing-page-plus-detail-page pairs collapse into single")
    A("  PermitPilot pages (`/code-compliance` absorbs both L029 and L031; `/api-docs` absorbs L087).")
    A("- **Two places PermitPilot is deliberately different and better.** L007: no `/dashboard/uci`, because")
    A("  Lovable's own inventory admits that copy bypasses its UCI role gate. L090: a true 404 page instead of a")
    A("  redirect to `/dashboard`, because Lovable's fallback masks broken links.")
    A("")
    A("### 6. Placeholders that must stay labelled")
    A("")
    A(f"{len(ui_only)} rows are UI-match-only: the PermitPilot route exists but renders an explicitly labelled")
    A("placeholder. Lovable shows these as fully connected, which is the trap. The admin trio in particular")
    A("(L080 Authorizations, L081 Members, L082 Audit log) appears complete in Lovable — with search, approve")
    A("and reject actions, detail dialogs and CSV export — while PermitPilot renders `AdminPreviewPlaceholder`")
    A("with a PD-5 note. Implementing those controls without the backing tables would produce buttons that")
    A("silently do nothing on access control and audit trails.")
    A("")
    A(md_table(
        ["ID", "Surface", "PP reality", "Missing backend"],
        [[r["Matrix Row ID"], r["Name"], r["PP Functional Status"], r["Required Backend Work"]] for r in ui_only],
    ))
    A("")
    A("### 7. Missing domains, grouped")
    A("")
    A(f"{len(missing_rows)} rows have no PermitPilot equivalent. They cluster into a small number of absent domains,")
    A("which is more useful than the row count suggests:")
    A("")
    A("- **Scheduling / critical path** (L010, L011, L016, L053): no milestone, duration or dependency model.")
    A("- **Task and board management** (L021, L026): no task, group or assignment model.")
    A("- **Site investigation and field capture** (L057–L065): no field evidence domain; excluded by directive.")
    A("- **Closeout and post-mortem** (L066–L071): no closeout state, archive or retrospective records.")
    A("- **Inspections** (L054–L056): reminders exist; inspection release state does not.")
    A("- **Legal artifacts** (L019, L020, L049): LOA signing and easements need legal review before any schema.")
    A("- **Financial** (L083, L084, L086): PermitPilot bills through Stripe; QuickBooks and milestone billing are not planned.")
    A("- **Aggregate dashboards over nothing** (L013, L014, L025, L030): duplicate or unsourced rollups.")
    A("")
    A("### 8. Naming and label decisions")
    A("")
    A("Where the client expects a Lovable label, keep the label and point it at the PermitPilot route. The")
    A("mapping is: Permit Filing → `/permit-wizard-filing`, Portal Harvest → `/portal-data`, Response Matrix →")
    A("`/response-matrix`, Analytics & Reporting → `/analytics`, Code Analyzer → a section of `/code-compliance`,")
    A("Provider Map → `/jurisdictions/map`. Labels PermitPilot should *not* adopt: DesignCheck (prefer Code")
    A("Compliance), Platform Architecture and Architecture Inventory (documentation lives in the repo),")
    A("AI Workflow (prefer Agent runs, if ever built).")
    A("")
    A("### 9. Decisions needed from the product owner")
    A("")
    A(f"{len(owner_needed)} rows cannot be scoped without a human decision. Nothing below should be started until the")
    A("decision is recorded in this matrix.")
    A("")
    A(md_table(
        ["ID", "Surface", "Decision needed"],
        [[r["Matrix Row ID"], r["Name"], r["Owner Decision Needed"]] for r in owner_needed],
    ))
    A("")
    A("### 10. Shared-environment constraints")
    A("")
    A("Railway `development` currently shares the production Supabase project, so verification must use demo")
    A("accounts only, and no destructive action or live utility submission may run without explicit approval.")
    A("This directly constrains L022 (permit filing performs real portal submissions — preflight only during")
    A("verification), L024 (scraper runs), and L083/PP24 (Stripe — test mode only).")
    A("")

    # ---- Execution plan
    A("## Controlled route-by-route execution plan")
    A("")
    A("Sequenced so that each phase de-risks the next. Every phase ends with the same gate, taken from the")
    A("workspace phase-completion rule.")
    A("")
    A("### Standing rules for every phase")
    A("")
    A("1. Work only on `" + BRANCH + "`. Never commit this work to `main`, and never merge without explicit human approval.")
    A("2. Visual alignment only. No backend, auth, schema, RLS, scraper-behavior or UCI-contract change without explicit approval. No migrations.")
    A("3. No mock data on production paths. If a restyled element has no real query behind it, remove the element rather than fake the data.")
    A("4. Update this matrix in the same commit as the code change. Regenerate with `python3 scripts/generate-lovable-permitpilot-matrix.py`.")
    A("5. Phase gate before moving on: run tests, build and typecheck; smoke-test the affected routes; confirm no control or option was lost versus current PermitPilot behavior; commit; push the feature branch; report the Vercel Preview URL. Deploy Railway `development` only if a backend or scraper change was genuinely required — and never Railway `production`.")
    A("")

    def plan_rows(pred):
        return [[r["Matrix Row ID"], r["Name"], r["Target PP Route (Decided)"], r["Route Decision"], r["Effort"], r["Risk"]]
                for r in matrix if pred(r)]

    plan_headers = ["ID", "Surface", "Target route", "Decision", "Effort", "Risk"]

    A("### Phase 0 — this document (complete)")
    A("")
    A("Produce the matrix and CSV. No application code touched. Row L089 covers this phase.")
    A("")
    A("### Phase 1 — foundation and auth")
    A("")
    A("Start here because these routes are small, high-traffic, and settle the design tokens every later phase")
    A("inherits. Align tokens on `/design-system-preview` (PP17) **first**, so that later restyles are token")
    A("changes rather than per-page overrides.")
    A("")
    A(md_table(plan_headers, plan_rows(lambda r: r["Phase"].startswith("Phase 1"))))
    A("")
    A("Gate: sign-in, sign-up and rejected-member paths all verified on Preview with a demo account; an unmatched")
    A("URL still renders a 404 rather than redirecting.")
    A("")
    A("### Phase 2 — public and marketing shell")
    A("")
    A("Lowest-risk product surfaces: no authenticated data, so a styling mistake cannot expose or lose anything.")
    A("")
    A(md_table(plan_headers, plan_rows(lambda r: r["Phase"].startswith("Phase 2"))))
    A("")
    A("Gate: contact submission still writes a row and sends its email; demo content stays labelled as demo.")
    A("")
    A("### Phase 3 — core authenticated surfaces (the real payoff)")
    A("")
    A("These are the P0 rows: real PermitPilot data, no contract change, maximum visible improvement.")
    A("**Start with L023 (Response Matrix).** It is the recommended first implementation row — it is backed by")
    A("real parsed comments and grounded response generation, needs no route change, and its table and status-chip")
    A("patterns are reused by almost every later surface. Style `/comment-review` (PP12) and `/classified-comments`")
    A("(PP13) alongside it, since they are the upstream half of the same workflow.")
    A("")
    A(md_table(plan_headers, plan_rows(lambda r: r["Phase"].startswith("Phase 3"))))
    A("")
    A("Gate: all UCI vitest suites pass; every KPI and table column traces to a real query; no `/uci/*` or")
    A("`/dashboard/*` child route was added.")
    A("")
    A("### Phase 4 — delivery and intelligence")
    A("")
    A("Higher risk, because L022 performs real portal submissions and L024 reflects live scraper state. Do these")
    A("only after Phase 3 has settled the component patterns.")
    A("")
    A(md_table(plan_headers, plan_rows(lambda r: r["Phase"].startswith("Phase 4"))))
    A("")
    A("Gate: permit filing preflight still runs before execute and no step was reordered or removed; **no live")
    A("utility submission was triggered during verification**; scraper contract unchanged.")
    A("")
    A("### Phase 5 — admin and settings")
    A("")
    A("The trap phase. Lovable shows Authorizations, Members and Audit log as fully connected; PermitPilot's are")
    A("Preview placeholders. Style the placeholders, keep the PD-5 notes visible, and add no functional controls.")
    A("")
    A(md_table(plan_headers, plan_rows(lambda r: r["Phase"].startswith("Phase 5") or r["Phase"].startswith("Blocked"))))
    A("")
    A("Gate: no approve, reject, invite, filter or export control exists on any placeholder admin page; every")
    A("setting still round-trips to Supabase; `user_roles` and project invites untouched.")
    A("")
    A("### Phase 6 — structural follow-ups (needs approval)")
    A("")
    A("These add genuine structure rather than styling, so each needs sign-off before it starts.")
    A("")
    A(md_table(plan_headers, plan_rows(lambda r: r["Phase"].startswith("Phase 6"))))
    A("")
    A("Gate: each item approved individually; no hard-coded record ids anywhere; coverage claims trace to the")
    A("territory validation reports.")
    A("")
    A("### Phase 7 — documentation and polish")
    A("")
    A(md_table(plan_headers, plan_rows(lambda r: r["Phase"].startswith("Phase 7"))))
    A("")
    A("Gate: no documentation content lost; the glossary either has real terms or stays an explicit placeholder.")
    A("")
    A("### Never / blocked")
    A("")
    A("Rows in the out-of-scope and backlog phases are not scheduled. Building any of them requires a product")
    A("owner decision recorded in this matrix first. The strongest prohibitions, restated because they are the")
    A("ones most likely to be violated by an enthusiastic implementer:")
    A("")
    A("- **Mission Control (L013)** — do not build. The real rollups are `/dashboard` and `/uci`.")
    A("- **CRM (L085)** — do not build. Lead capture and drip campaigns are marketing automation, not a CRM.")
    A("- **SIR and Field mobile pack (L057–L065)** — do not build. No field evidence domain exists.")
    A("- **Admin Authorizations / Members / Audit log (L080–L082)** — placeholder styling only.")
    A("- **UCI coming-soon sections (L043, L044, L048, L049)** — must remain labelled panels, never mock tables.")
    A("")
    A("### First commit, concretely")
    A("")
    A("If you are picking this up cold: align tokens on `/design-system-preview`, then restyle `/response-matrix`")
    A("(L023) with no route, query or edge-function change, verify a comment-to-response round trip on a demo")
    A("project, update L023's row in the generator script to record what shipped, regenerate this matrix, and")
    A(f"commit both to `{BRANCH}`.")
    A("")

    OUT_MD.write_text("\n".join(L) + "\n", encoding="utf-8")


def main() -> int:
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lov = parse_inventory(INVENTORY)
    if len(lov) != 90:
        raise SystemExit(f"Expected 90 Lovable rows, parsed {len(lov)}")

    matrix = build_matrix(lov)
    validate(matrix)
    write_csv(matrix)
    write_md(matrix, generated)

    counts = Counter(r["Match Status"] for r in matrix)
    prio = Counter(r["Priority"] for r in matrix)

    print("=" * 78)
    print("Lovable ↔ PermitPilot architecture matrix — generation report")
    print("=" * 78)
    print(f"Total Lovable rows mapped : {len(matrix)}")
    print(f"Columns per row           : {len(ALL_COLS)} (22 Lovable + 35 PermitPilot)")
    print()
    print("Match status counts:")
    for k in ["Exact match", "Strong functional match", "Partial match",
              "Same purpose different architecture", "UI match only",
              "Backend match only", "Missing in PermitPilot"]:
        print(f"  {k:<38} {counts.get(k, 0)}")
    print()
    print("Priority counts:")
    for k in ("P0", "P1", "P2", "P3"):
        print(f"  {k:<38} {prio.get(k, 0)}")
    print(f"  {'P0 + P1 (actionable now)':<38} {prio.get('P0', 0) + prio.get('P1', 0)}")
    print()
    print(f"Missing in PermitPilot    : {counts.get('Missing in PermitPilot', 0)}")
    print(f"PermitPilot-only surfaces : {len(PP_ONLY)}")
    print()
    print("Files written:")
    print(f"  {OUT_MD.relative_to(REPO)}")
    print(f"  {OUT_CSV.relative_to(REPO)}")
    print(f"  {Path(__file__).resolve().relative_to(REPO)} (generator)")
    print()
    print(f"Branch                    : {BRANCH}")
    print(f"Last audited              : {AUDIT_DATE}")
    print(f"Generated                 : {generated}")
    print()
    print("No application code modified: this script only reads")
    print("reference/lovable-ui/architecture-inventory.md and writes the two matrix files")
    print("above. Nothing under src/, supabase/, or scraper-service/ is touched.")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
