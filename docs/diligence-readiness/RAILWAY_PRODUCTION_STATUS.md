# Railway Production Status

**Audit date:** 2026-08-26  
**Method:** Railway CLI (`railway status`, `railway deployment list --json`), HTTP health checks. **No deploy actions performed.**

---

## 1. Workspace and services

| Field | Value |
|-------|-------|
| Workspace | `PermitPilot` |
| Project | `PermitPilot` |
| Project ID | `41f0067a-ffb7-4b15-99e0-25ed8555438f` |
| Environment | `production` |
| Region | US East (`us-east4-eqdc4a`) |

| Service | Status | URL |
|---------|--------|-----|
| `Epermit-main` (scraper/UCI API) | **Online** | `https://epermit-main-production.up.railway.app` |
| `document-ingestion-worker` | **Online** | (internal worker; no public URL verified) |

Railway repo linkage for active scraper service: **`epermitarthouse-rgb/Epermit-main`**, root directory **`/scraper-service`**, builder **Dockerfile** via `scraper-service/railway.toml`.

---

## 2. Active production deployment

| Field | Value |
|-------|-------|
| Deployment ID | `decd72b1-5f78-4366-a612-f33c620b5bba` |
| Status | **SUCCESS** |
| Created (UTC) | `2026-08-26T05:46:33.777Z` |
| Branch | `main` |
| Commit hash | `da66200bde35c59ae4577acb308f3100eff07759` |
| Commit message (first line) | Add Analysis Instructions safety and anti-hallucination regression tests |
| Commit author (metadata) | `epermitarthouse-rgb` |
| Image digest | `sha256:41cc246df3a278a38eb842e581af7f2a7f6d5b5ba74c7fe30fc4332d22374464` |

Local `main` HEAD matches this commit (`da66200`) — production is deployed from current org `main` tip at audit time.

---

## 3. Application health checks

| Endpoint | HTTP | Result |
|----------|------|--------|
| `GET /` | 200 | Service responds |
| `GET /health` | 404 | No dedicated health route (404 HTML) |
| `GET /api/quickbooks/status` | 200 | JSON: `connected: true`, `environment: production` |

**Health interpretation:** Root path and API routes respond. Railway reports service **Online**. No Railway-configured healthcheck path (`healthcheckPath: null` in deployment manifest).

---

## 4. Recent deployment history pattern

Recent deployments (same day, 2026-08-26) show a **rapid sequence of deploys** during active development:

| Time (UTC) | Status | Notes |
|------------|--------|-------|
| 05:46:33 | **SUCCESS** (active) | GitHub `main` commit `da66200` |
| 05:31:16 | REMOVED | CLI deploy (`cliCaller: cursor`) — superseded |
| 05:31:12 | REMOVED | GitHub `main` commit `47952cdc` — superseded |
| 05:10:56 | REMOVED | CLI deploy — superseded |
| 05:10:51 | REMOVED | (paired deploy) — superseded |

Prior day (2026-08-25): multiple REMOVED deployments at ~17:14–22:39 UTC, consistent with iterative deploys during Code Mod / analyzer work.

### Failed build notifications — assessment

Within the **20 most recent deployments returned by CLI**, statuses observed were only **`SUCCESS`** and **`REMOVED`**. No `FAILED` or `CRASHED` entries appeared in that window.

**Verified:** Superseded deployment attempts exist (REMOVED status) from both GitHub-triggered and CLI-triggered deploys during active development on 2026-08-25 and 2026-08-26.

**Limitation:** Full historical failure log beyond CLI list depth was not retrieved. Cannot rule out older failed builds outside the returned window.

---

## 5. Partial release claim

**Cannot claim zero partial releases.** Evidence shows multiple deployments within minutes on 2026-08-26 before the current SUCCESS deployment. Each superseded deployment may have briefly served traffic until replaced.

The **currently active** deployment is SUCCESS at commit `da66200`.

---

## 6. Production configuration notes (non-secret)

- Config-as-code: `scraper-service/railway.toml` (Railway warns this format is deprecated after 2026-12-01)
- Replicas: 1 in `us-east4-eqdc4a`
- Restart policy: ON_FAILURE, max 10 retries
- No volume mounts on scraper service

---

## 7. Blockers and manual follow-ups

| Item | Blocker | Next action |
|------|---------|-------------|
| Vercel ↔ Railway URL alignment | Vercel CLI not authenticated on audit machine | Confirm production `VITE_API_BASE_URL` points to `epermit-main-production.up.railway.app` |
| Dedicated health endpoint | `/health` returns 404 | Optional: add health route or configure Railway healthcheck |
| Ingestion worker health | No HTTP check performed | Confirm worker logs/metrics in Railway dashboard |
| Historical failed builds | CLI list limited | Review Railway dashboard notifications for failures outside recent window |
