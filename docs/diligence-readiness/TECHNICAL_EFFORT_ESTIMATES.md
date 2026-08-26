# Technical Effort Estimates

**Audit date:** 2026-08-26  
**Basis:** Repository condition as of commit `da66200` on `main`, plus identified gaps in `docs/uci-action-items-status.md` and diligence audits.  
**Excluded:** Hourly rates and financial cost (added manually by stakeholders).

Estimates are **engineering hours** for one senior full-stack engineer familiar with the stack, with occasional Supabase/Railway/DevOps support.

---

## 1. PermitPilot diligence-readiness sprint

**Goal:** Make the platform handover-ready for a new engineering team or acquirer — documented, owned, deployable, restorable, with known gaps explicit.

### Included tasks

| Task | Hours (range) |
|------|---------------|
| Consolidate and verify architecture/deploy/restore/env docs (this bundle + validation) | 16–24 |
| Documentation cleanup execution (archive duplicates per audit, add README pointers) | 8–12 |
| Push/sync outstanding branches (`feat/code-analyzer-async-v2`, review remote-only branches) | 4–8 |
| Vercel account transfer or team linkage + env var audit (`VITE_*`, scraper URL) | 8–16 |
| Supabase org ownership verification + apply pending migrations on production | 8–16 |
| Railway env parity review (scraper + ingestion worker) against `ENV.md` | 8–12 |
| QuickBooks production hardening (OAuth CSRF state, webhook/audit if required, operator runbook) | 16–24 |
| Backup verification: Supabase PITR/backups, Storage replication policy documented | 8–16 |
| Non-production restore drill (staging project or branch DB) | 16–24 |
| CI smoke tests: build, scraper unit tests, critical path e2e checklist | 16–24 |
| Portal scraper regression pass (1 jurisdiction per portal type) | 24–40 |
| Secrets rotation plan (document only; no rotation in sprint unless scheduled) | 4–8 |
| Stakeholder walkthroughs (QuickBooks, deploy, restore) | 8–12 |

**Total range: 144–236 hours (approx. 4–6 weeks calendar at 40 h/week)**

### Excluded tasks

- New product features (Lovable UI replication completion)
- UCI live submission enablement
- Code Mod / analyzer feature development beyond stabilization
- Legal/commercial diligence
- Production secrets rotation execution (unless explicitly in scope)
- Mobile/Capacitor release hardening

### Dependencies

- Client access: GitHub org (have), Railway (have), Vercel account, Supabase dashboard, Intuit, Azure, shared password vault
- Decision on authoritative doc home post-sprint (`docs/diligence-readiness/` vs updating `docs/current-system-architecture.md`)

### Assumptions

- One production Supabase project (`eeqxyjrcldivtpikcpvk`)
- Railway remains primary scraper host
- No Replit migration required
- Team can run staging Supabase project or disposable DB for restore test

### Main uncertainty affecting range

**Vercel + Supabase account access.** Without dashboard access, env verification and restore tests add 20–40+ hours of back-and-forth.

### Realistic completion sequence

1. Account access + env inventory verification (Week 1)
2. Migration apply + Railway/Vercel env parity (Week 1–2)
3. Backup/restore documentation + staging drill (Week 2–3)
4. Branch sync + CI smoke tests (Week 2–3)
5. QB hardening + portal regression (Week 3–4)
6. Walkthroughs + doc cleanup (Week 4–6)

---

## 2. UCI live-data hardening

**Goal:** Replace synthetic/test paths with production-grade flows using **real client utility documents**, authorized live submission where approved, and certified communications classification.

### Included tasks

| Task | Hours (range) |
|------|---------------|
| Client document intake pipeline (replace Highland synthetic set; provenance tagging) | 24–40 |
| Apply/verify all UCI migrations on production Supabase | 8–16 |
| Production territory dataset hosting (Storage + resolver) | 16–24 |
| OCR/Vision production configuration + review queue for uncertain extractions | 24–40 |
| Approved QSR/load template integration (client-provided rules) | 40–80 |
| Dominion authoritative manifest (after client delivers requirements) | 40–80 |
| PEPCO live submission hardening (selectors, MFA, incident runbook) | 40–60 |
| Email live submission production allowlists + operator training | 16–24 |
| Stage 5 classifier certification with labeled client sample set | 24–40 |
| Stage 6–10 production UAT with real utility correspondence | 40–60 |
| CIAC/QB passthrough production validation (`uci-qb-passthrough.service.js`) | 16–24 |
| Observability: persistent UCI events, alerting, runbooks | 24–40 |
| End-to-end staging UAT sign-off package | 16–24 |

**Total range: 328–552 hours (approx. 8–14 weeks at 40 h/week)**

### Excluded tasks

- Dominion portal adapter (not started; separate from manifest work)
- Miss Utility 811 / conflicts product scope
- Municipal permit filing changes
- Full firm-wide portfolio reporting (McDonald's tenant spec)

### Dependencies

- **Client P0 dependencies** from action-items: Dominion requirements, QSR standards, signature policy, live submission authorization, utility email routing
- Production Microsoft Graph mailboxes with Mail.Read/Mail.Send
- Utility portal credentials and legal authorization
- Labeled communication samples for classifier
- QuickBooks production connection (already connected per API check)

### Assumptions

- PEPCO remains first automated portal adapter
- Synthetic paths remain for regression but are isolated from production records
- One pilot project (e.g., real client site) drives UAT before broad rollout

### Main uncertainty affecting range

**Client dependency delivery timing.** Dominion requirements and QSR standards are P0 blockers; estimate variance is dominated by wait time, not coding.

### Realistic completion sequence

1. Client artifact delivery + migration apply (Weeks 1–2)
2. Real document ingestion + Stage 2 verification (Weeks 2–4)
3. Production package manifests + Stage 3 review (Weeks 4–6)
4. Controlled live submission pilot (Weeks 6–8)
5. Stage 5–6 certification with real mail (Weeks 8–10)
6. CIAC/equipment/closeout + QB passthrough (Weeks 10–12)
7. Sign-off and runbooks (Weeks 12–14)

---

## 3. Combined note

These estimates are **sequential, not additive** for staffing: diligence-readiness should complete or overlap early phases of UCI hardening (especially env, migrations, backup). Parallel teams can reduce calendar time but increase coordination overhead.
