# Repository Documentation Structure (Proposal)

**Audit date:** 2026-08-26  
**Status:** Proposal only — **no mass moves executed**

---

## Target layout

```text
README.md                          # Local dev entry + link to diligence package
docs/
  diligence-readiness/             # Authoritative handover bundle (this folder)
    README.md                      # Index
    ARCHITECTURE.md, DEPLOY.md, RESTORE.md, ENV.md
    …audits and estimates…
  runbooks/                        # Future: operational runbooks (mostly empty today)
  architecture/                    # Future: living architecture snapshots
  audits/                          # Existing point-in-time feature audits (keep)
  archive/                         # Future: retired reference exports
memory.md                          # Scraper handbook (keep at root)
uci/                               # UCI specs and roadmaps (keep)
reference/lovable-ui/              # Historical — see LOVABLE_RETIREMENT_AUDIT.md
```

---

## Authoritative sources of truth (recommended)

| Topic | Authoritative | Supporting / historical |
|-------|---------------|-------------------------|
| Diligence handover | `docs/diligence-readiness/*` | Prior `fd49b29` drafts (superseded by this branch) |
| Local dev | `README.md` | — |
| Scraper behavior | `memory.md` | `docs/audits/*` |
| UCI lifecycle status | `docs/uci-action-items-status.md` | `uci/*.md` |
| Schema | `supabase/migrations/` | `docs/current-data-model.md` (snapshot) |
| Architecture audit snapshot | `docs/current-system-architecture.md` (2026-07-21) | Link from diligence ARCHITECTURE |

---

## Proposed future moves (require approval)

| Source | Proposed destination | Reason | Inbound links to update | History preserved |
|--------|---------------------|--------|-------------------------|-------------------|
| `docs/lovable-ui-audit.md` | `docs/archive/lovable/lovable-ui-audit.md` | Exact duplicate of reference copy | Any doc linking to old path | Yes (git mv) |
| `reference/lovable-ui/docs/lovable-*.md` (4 files) | Delete one copy after consolidating to `docs/archive/lovable/` | SHA-256 exact duplicates | Matrix scripts if any | Yes via git |
| `reference/lovable-ui/stitch-reference/` | `docs/archive/lovable/stitch-reference/` | Historical design only | None in production code | Yes (git mv) |
| Replit-era root docs on `replit-agent` | Never merge — tag only | See REPLIT_RETIREMENT_AUDIT | N/A | Tag preserves commits |

**Risk:** Moving files breaks markdown links. Run link check before any move.

---

## Actions taken in this task

| Action | Done |
|--------|------|
| Created `docs/diligence-readiness/README.md` | Yes |
| Update root `README.md` with diligence link | Yes (one line, non-destructive) |
| Mass file moves | **No** |
| Deletions | **No** |

---

## Cleanup gate

Documentation cleanup, archival, or deletion proceeds only after:

1. This structure proposal is reviewed
2. [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) approved
3. [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md) approved
4. [DOCUMENTATION_CLEANUP_AUDIT.md](./DOCUMENTATION_CLEANUP_AUDIT.md) updated
