# Railway Production Status

**Snapshot date:** 2026-08-27  
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

## 2. Active deployment (**verified** Railway CLI, 2026-08-27)

| Field | Value |
|-------|-------|
| Status | **SUCCESS** |
| Commit | `331fa802453a` (`331fa80`) |
| Branch | `main` |
| Message | Document QuickBooks production E2E status and deployment verification |

**Current production is healthy** on the latest documented `main` commit including QuickBooks hardening path.

---

## 3. Historical Friday failures (2026-08-22 area)

| Observation | Classification |
|-------------|----------------|
| Ian reported **two failed production builds** on Friday evening | **Client confirmed** |
| Exact failure logs from that window | **Unavailable** for specific root-cause attribution in this audit |
| Likely context | Failures occurred during **active deployment work** while fixes were landing |
| Current state | **SUCCESS** deploy on `331fa80` — production running on good build |
| Partial deployment served traffic | **Not proven** without serve-window metadata — do not claim either way |

---

## 4. Health checks (reachability only)

| Endpoint | Result | Meaning |
|----------|--------|---------|
| `GET /` | HTTP 200 | Process reachable |
| `GET /health` | HTTP 404 | No dedicated health route |
| `GET /api/quickbooks/status` | HTTP 200 | Route responds; reports stored connection **state** |

**Root HTTP 200 is not full application health** (Playwright, workers, DB latency not tested).

---

## 5. Related

- [DEPLOY.md](./DEPLOY.md)
- [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md)
