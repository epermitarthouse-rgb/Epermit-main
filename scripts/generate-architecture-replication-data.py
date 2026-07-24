#!/usr/bin/env python3
"""Generate src/data/architectureReplicationMatrix.json from the architecture matrix CSV/MD.

Run from repo root:
  python3 scripts/generate-architecture-replication-data.py
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "reference/lovable-ui/lovable-permitpilot-architecture-matrix.csv"
MD_PATH = ROOT / "reference/lovable-ui/lovable-permitpilot-architecture-matrix.md"
OUT_PATH = ROOT / "src/data/architectureReplicationMatrix.json"


def backend_status(raw: str) -> str:
    s = (raw or "").lower()
    if s in ("yes", "true", "fully", "connected", "working"):
        return "Fully working"
    if "partial" in s:
        return "Partially working"
    if s in ("no", "false", "none", "—", "-", "") or "not" in s:
        return "Not connected"
    return raw or "Unverified"


def map_lovable_row(r: dict) -> dict:
    backend = r.get("PP Backend Connected") or r.get("PP Functional Status") or ""
    match = r.get("Match Status") or ""
    return {
        "rowId": r["Matrix Row ID"],
        "rowKind": "lovable",
        "priority": r.get("Priority") or "P3",
        "risk": r.get("Risk") or "Medium",
        "lovable": {
            "area": r.get("Area") or "",
            "parent": r.get("Parent") or "",
            "name": r.get("Name") or "",
            "route": r.get("Route") or "",
            "routeType": r.get("Type") or "",
            "params": r.get("Params") or "",
            "entryPoints": r.get("Entry Points") or "",
            "secondaryEntries": r.get("Secondary Entries") or "",
            "auth": r.get("Auth") or "",
            "context": r.get("Context") or "",
            "purpose": r.get("Purpose") or "",
            "functionality": r.get("Functionality") or "",
            "actions": r.get("Actions") or "",
            "tabs": r.get("Tabs") or "",
            "modals": r.get("Modals") or "",
            "dataSource": r.get("Data Source") or "",
            "backend": r.get("Backend") or "",
            "status": r.get("Status") or "",
            "visibility": r.get("Visibility") or "",
            "sourceFile": r.get("Source File") or "",
            "routeFile": r.get("Route File") or "",
            "notes": r.get("Notes") or "",
        },
        "permitPilot": {
            "matchStatus": match,
            "featureName": r.get("PP Equivalent Name") or "",
            "route": r.get("PP Route(s) Today") or "",
            "routeExists": r.get("PP Route Exists") or "",
            "sourceFiles": r.get("PP Source File(s)") or "",
            "navEntry": r.get("PP Nav Entry Point") or "",
            "auth": r.get("PP Auth / Role Gate") or "",
            "dataSource": r.get("PP Data Source") or "",
            "backendEndpoint": r.get("PP Backend Endpoint / Function") or "",
            "backendConnected": r.get("PP Backend Connected") or "",
            "functionalStatus": r.get("PP Functional Status") or "",
            "uiParity": r.get("UI Parity") or "",
            "functionalParity": r.get("Functional Parity") or "",
        },
        "decisions": {
            "routeDecision": r.get("Route Decision") or "",
            "targetRoute": r.get("Target PP Route (Decided)") or "",
            "namingDecision": r.get("Naming Decision (Label To Use)") or "",
            "navPlacement": r.get("Nav Placement Decision") or "",
            "deepLinkPattern": r.get("Deep Link Pattern") or "",
            "dataIntegration": r.get("Required Backend Work") or "",
            "entryPointDecision": r.get("Nav Placement Decision") or "",
        },
        "work": {
            "preserve": r.get("Preserve-PermitPilot-Logic Notes") or "",
            "lovableOnly": r.get("Lovable-Only Feature") or "",
            "doNotReplicate": r.get("Do-Not-Replicate Reason") or "",
            "requiredBackend": r.get("Required Backend Work") or "",
            "requiredFrontend": r.get("Required Frontend Work") or "",
            "dependencies": r.get("Blocking Dependencies") or "",
            "fakeBackendRisk": r.get("Fake-Backend Risk") or "",
            "phase": r.get("Phase") or "",
            "effort": r.get("Effort") or "",
            "acceptanceCriteria": r.get("Acceptance Criteria") or "",
            "verificationHook": r.get("Test / Verification Hook") or "",
            "ownerDecisionNeeded": r.get("Owner Decision Needed") or "",
            "auditNotes": r.get("Audit Notes") or "",
            "matchConfidence": r.get("Match Confidence") or "",
        },
        "defaults": {
            "implementationStatus": "Audited",
            "verificationStatus": "Not tested",
        },
        "derived": {
            "uiStatus": r.get("UI Parity") or "Unverified",
            "backendStatus": backend_status(backend),
            "hasPreserve": bool(
                (r.get("Preserve-PermitPilot-Logic Notes") or "").strip()
                and (r.get("Preserve-PermitPilot-Logic Notes") or "").strip() not in ("—", "-")
            ),
            "isMissing": "missing" in match.lower(),
            "isBackendConnected": any(
                x in str(backend).lower()
                for x in ("yes", "true", "partial", "connected", "working", "fully")
            ),
            "isUiOnly": "ui match only" in match.lower(),
        },
    }


def parse_pp_only(md: str) -> list[dict]:
    start = md.find("## PermitPilot-only surfaces")
    end = md.find("## Gap summary", start)
    section = md[start:end] if start != -1 else ""
    out: list[dict] = []
    for line in section.splitlines():
        if not line.startswith("| PP"):
            continue
        cols = [c.strip() for c in line.strip("|").split("|")]
        if len(cols) < 8 or not re.match(r"^PP\d+$", cols[0]):
            continue
        num = int(cols[0][2:])
        stable = f"PP{num:03d}"
        out.append(
            {
                "rowId": stable,
                "legacyId": cols[0],
                "rowKind": "permitpilot_only",
                "priority": cols[7] if len(cols) > 7 else "P2",
                "risk": cols[8] if len(cols) > 8 else "Medium",
                "lovable": {
                    "area": "PermitPilot-only",
                    "parent": "—",
                    "name": "No Lovable equivalent",
                    "route": "No Lovable equivalent",
                    "routeType": "—",
                    "params": "—",
                    "entryPoints": "—",
                    "secondaryEntries": "—",
                    "auth": "—",
                    "context": "—",
                    "purpose": "—",
                    "functionality": "—",
                    "actions": "—",
                    "tabs": "—",
                    "modals": "—",
                    "dataSource": "—",
                    "backend": "—",
                    "status": "—",
                    "visibility": "—",
                    "sourceFile": "No Lovable equivalent",
                    "routeFile": "No Lovable equivalent",
                    "notes": cols[5] if len(cols) > 5 else "",
                },
                "permitPilot": {
                    "matchStatus": "Not applicable",
                    "featureName": cols[1],
                    "route": cols[2],
                    "routeExists": "yes",
                    "sourceFiles": "",
                    "navEntry": cols[2],
                    "auth": "varies",
                    "dataSource": cols[4],
                    "backendEndpoint": cols[4],
                    "backendConnected": cols[4],
                    "functionalStatus": cols[3],
                    "uiParity": cols[3],
                    "functionalParity": cols[3],
                },
                "decisions": {
                    "routeDecision": cols[6] if len(cols) > 6 else "Keep PermitPilot route",
                    "targetRoute": cols[2],
                    "namingDecision": cols[1],
                    "navPlacement": "Keep existing",
                    "deepLinkPattern": cols[2],
                    "dataIntegration": "Reuse current PermitPilot backend",
                    "entryPointDecision": "Keep existing entry point",
                },
                "work": {
                    "preserve": cols[5] if len(cols) > 5 else "",
                    "lovableOnly": "—",
                    "doNotReplicate": "—",
                    "requiredBackend": "None — preserve existing",
                    "requiredFrontend": "Optional visual alignment only",
                    "dependencies": "none",
                    "fakeBackendRisk": "Low",
                    "phase": "Preserve",
                    "effort": "S",
                    "acceptanceCriteria": "Behavior unchanged through UI replication",
                    "verificationHook": "Regression on existing route",
                    "ownerDecisionNeeded": "No",
                    "auditNotes": cols[5] if len(cols) > 5 else "",
                    "matchConfidence": "High",
                },
                "defaults": {
                    "implementationStatus": "Audited",
                    "verificationStatus": "Not tested",
                },
                "derived": {
                    "uiStatus": cols[3],
                    "backendStatus": cols[4],
                    "hasPreserve": True,
                    "isMissing": False,
                    "isBackendConnected": True,
                    "isUiOnly": False,
                },
            }
        )
    return out


def main() -> None:
    lovable = [map_lovable_row(r) for r in csv.DictReader(CSV_PATH.open())]
    pp = parse_pp_only(MD_PATH.read_text())
    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "branch": "feat/lovable-ui-replication",
        "sourceCsv": str(CSV_PATH.relative_to(ROOT)),
        "sourceMd": str(MD_PATH.relative_to(ROOT)),
        "lovableRowCount": len(lovable),
        "permitPilotOnlyRowCount": len(pp),
        "rows": lovable + pp,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {OUT_PATH} ({len(lovable)} Lovable + {len(pp)} PP-only)")


if __name__ == "__main__":
    main()
