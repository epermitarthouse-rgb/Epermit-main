# Railway Production Status

**Snapshot date:** 2026-08-26  
**Read-only audit** — no deploy actions.

Index: [README.md](./README.md)

---

## 1. Active service

| Field | Value |
|-------|-------|
| Workspace / Project | `PermitPilot` |
| Service | `Epermit-main` — **Online** |
| URL | `https://epermit-main-production.up.railway.app` |
| Repo | `epermitarthouse-rgb/Epermit-main` / `scraper-service` |

---

## 2. Active deployment (**verified** Railway CLI JSON)

| Field | Value |
|-------|-------|
| Deployment ID | `decd72b1-5f78-4366-a612-f33c620b5bba` |
| Status | **SUCCESS** |
| Commit | `da66200bde35c59ae4577acb308f3100eff07759` |
| Branch | `main` |
| Created (UTC) | `2026-08-26T05:46:33.777Z` |

**Note:** Local `main` has since advanced to `f7b5f02` — production may lag until next deploy.

---

## 3. Recent deployment history

| Observation | Classification |
|-------------|----------------|
| Recent CLI window shows **SUCCESS** and **REMOVED** statuses | **Verified** |
| **`REMOVED`** | Superseded/removed deployment record — **not synonymous with failed build** |
| Whether a REMOVED deployment served traffic | **Not proven** without serve-window metadata |
| **`FAILED` / `CRASHED`** in recent CLI list | **Not observed** in retrieved window |
| Friday failure notifications (2) | **Outside or absent** from retrieved CLI history — **cannot attribute cause** without logs |

---

## 4. Health checks (reachability only)

| Endpoint | Result | Meaning |
|----------|--------|---------|
| `GET /` | HTTP 200 | Process reachable |
| `GET /health` | HTTP 404 | No dedicated health route |
| `GET /api/quickbooks/status` | HTTP 200 | Route responds; reports stored connection **state** |

**Root HTTP 200 is not full application health** (Playwright, workers, DB latency not tested).

**QuickBooks status** confirms route + recorded connection state — **not** a successful live Intuit API transaction.

---

## 5. Related

- [DEPLOY.md](./DEPLOY.md)
- [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md)
