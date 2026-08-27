# Ian Requirement Coverage Matrix

**Document date:** 2026-08-27  
**Scope:** PermitPilot and UCI only — Comprovare asks listed for completeness but marked N/A

Index: [IAN_DILIGENCE_RESPONSE_DRAFT.md](./IAN_DILIGENCE_RESPONSE_DRAFT.md)

---

| Ian's ask | Email section | Document / evidence | Addressed? |
|-----------|---------------|---------------------|------------|
| Push everything to org repos by Friday | §1 Repository push | `REPOSITORY_AND_ACCOUNT_INVENTORY.md`; branches on `origin` | **Yes** — PermitPilot/UCI complete; Comprovare N/A |
| In-flight list per platform | §3 What breaks first | `IN_FLIGHT_STATUS.md` | **Yes** |
| What's deployed but undocumented | §3, §4 | `IN_FLIGHT_STATUS.md`; core four docs | **Yes** |
| What breaks first if work paused | §3 | `IN_FLIGHT_STATUS.md` §3 (PermitPilot + UCI) | **Yes** |
| List accounts/keys under developer email | §2 Platform identity | `REPOSITORY_AND_ACCOUNT_INVENTORY.md` §6 — placeholder for IDs | **Partial** — placeholder for Javeria |
| Move secrets to shared vault | §2 | Vault manually confirmed by Javeria; `ENV.md` | **Yes** — manual confirmation |
| PermitPilot recorded session (30 min QB) | §11 Availability | Email §5 QB detail; walkthrough in remaining scope | **Partial** — agenda done; session not yet held |
| QuickBooks/n8n integration explanation | §5 | `QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md` — **no n8n** | **Yes** |
| n8n JSON export into repo | §5 | Repo search — not applicable | **Yes** — N/A (not used) |
| Replit production code confirmation | §8 | `REPLIT_RETIREMENT_AUDIT.md` | **Yes** — none |
| Four docs: ARCHITECTURE, DEPLOY, RESTORE, ENV | §4 | All four in `docs/diligence-readiness/` | **Yes** |
| Five session availability slots | §11 | Placeholders in email draft | **Partial** — placeholders |
| Estimate for diligence scope | §10B | `TECHNICAL_EFFORT_ESTIMATES.md` §A | **Yes** — 32–56 h remaining |
| Actual completed hours | §10A | `[MANUAL ENTRY REQUIRED]` | **Partial** |
| UCI priced separately | §10D | `TECHNICAL_EFFORT_ESTIMATES.md` §B — 88–156 h | **Yes** |
| UCI in in-flight list with mock pipeline | §3 | `IN_FLIGHT_STATUS.md` §2–3 | **Yes** |
| UCI not in personal namespace / Replit | §3, §9 | `REPOSITORY_AND_ACCOUNT_INVENTORY.md` §7 | **Yes** |
| UCI blocked on Ian's documents | §9 | Email §9; estimates §B | **Yes** |
| Railway Friday failure follow-up | §6 | `RAILWAY_PRODUCTION_STATUS.md`; email §6 | **Yes** |
| Confirm production on good build | §6 | Railway SUCCESS `331fa80` | **Yes** |
| Partial deployment attribution | §6 | Stated as not proven | **Yes** — honest gap |
| UCI sequencing: PP session → UCI after sessions | §9 | Email §9 | **Yes** |
| UCI docs updated as built | §9 | Standing condition acknowledged | **Yes** — committed |
| 30-day transition assistance | §12 | Email §12 | **Yes** — acknowledged |
| Documentation as standing delivery condition | §12 | Email §12 | **Yes** — acknowledged |
| Comprovare AWS walkthrough | — | — | **N/A** — out of scope |
| Comprovare monitoring agents walkthrough | — | — | **N/A** — out of scope |
| Supabase backups verified | §7 | `RESTORE.md` — 7 daily physical | **Yes** |
| PITR status | §7 | `RESTORE.md` — disabled | **Yes** |
| Storage recovery gap | §7 | `RESTORE.md` §3 | **Yes** |
| QuickBooks dry-run verified | §5 | `QUICKBOOKS_PRODUCTION_E2E.md` | **Yes** |
| QuickBooks live blocked | §5 | Email §5; E2E doc | **Yes** |
| 360° production audit | §10C | `PERMITPILOT_360_PRODUCTION_AUDIT.md` + matrix + estimates | **Yes** |
| AI-assisted production roadmap estimate | §10C | `PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md` | **Yes** |

---

## Coverage summary

| Status | Count |
|--------|------:|
| **Yes** | 28 |
| **Partial** (placeholders / session not held) | 4 |
| **N/A** (Comprovare) | 2 |

No PermitPilot/UCI ask omitted. Partial items require Javeria manual insert or scheduled sessions.
