Commun-ET Insight™ — Daily Task Breakdown

PHASE 1 — Accela Cluster (Weeks 1-4)
Fairfax County (Days 1-4)

Day 1: Access PLUS portal, map login flow, test authentication, identify record search page structure
Day 2: Adapt Baltimore Accela login module, test permit search and record navigation
Day 3: Extract Record Details, Processing Status, Attachments — verify against live portal
Day 4: Test attachment download + Supabase upload, fix DOM differences, verify DB output

Arlington County (Days 5-8)

Day 5: Access Permit Arlington portal, map login and search flow
Day 6: Adapt scraper, test navigation to record detail page
Day 7: Extract all sections, compare against live portal data
Day 8: Attachment downloads, DB verification, edge case fixes

Anne Arundel County (Days 9-12)

Day 9: Access Land Use Navigator portal, map login and search flow
Day 10: Adapt scraper, test navigation
Day 11: Extract all sections, verify data
Day 12: Attachment downloads, DB verification, edge case fixes

Baltimore County (Days 13-16)

Day 13: Access Accela portal, map login and search flow
Day 14: Adapt scraper, test navigation
Day 15: Extract all sections, verify data
Day 16: Attachment downloads, DB verification, buffer day for Phase 1 fixes

Phase 1 Buffer (Days 17-20)

Day 17-18: Cross-jurisdiction testing, fix any Cloudflare blocking issues
Day 19: Frontend dashboard integration for all 4 new jurisdictions
Day 20: Client review, bug fixes, Phase 1 sign-off


PHASE 2 — Accela + ProjectDox Hybrids (Weeks 5-8)
Montgomery County (Days 21-27)

Day 21: Access eServices/Apply & ePay portal, map Accela login flow
Day 22: Build permit search and record navigation for Accela side
Day 23: Extract Record Details, Processing Status from Accela side
Day 24: Access ePlans/ProjectDox portal, map login and project search
Day 25: Extract plan review data, file listings from ProjectDox side
Day 26: Link Accela + ProjectDox data under single project record in DB
Day 27: Attachment downloads, DB verification, edge case fixes

Howard County (Days 28-34)

Day 28: Access Accela portal, map login flow
Day 29: Build permit search and record navigation
Day 30: Extract all Accela sections
Day 31: Access ProjectDox portal, map login and project search
Day 32: Extract plan review data from ProjectDox
Day 33: Link both systems under single record
Day 34: Attachment downloads, DB verification

Phase 2 Buffer (Days 35-40)

Day 35-36: Cross-jurisdiction testing
Day 37: Frontend integration for Montgomery and Howard
Day 38-39: Fix session management issues between dual systems
Day 40: Client review, Phase 2 sign-off


PHASE 3 — ProjectDox Variants (Weeks 9-11)
Prince George's County (Days 41-48)

Day 41: Access Momentum portal, map login and authentication flow
Day 42: Reverse engineer Momentum permit search — new system, expect complexity
Day 43: Extract permit record data from Momentum
Day 44: Access ePlan/ProjectDox portal, map login
Day 45: Extract plan review data from ProjectDox
Day 46: Link Momentum + ProjectDox data
Day 47: Attachment downloads, DB verification
Day 48: Buffer — Momentum is unfamiliar, expect extra debugging

Frederick County (Days 49-55)

Day 49: Access CIVICS portal, map login flow
Day 50: Extract permit data from CIVICS
Day 51: Access ProjectDox portal
Day 52: Extract plan review data
Day 53: Access Accela records/search portal for supplementary data
Day 54: Link all three systems under single record
Day 55: Attachment downloads, DB verification, Phase 3 buffer


PHASE 4 — EnerGov/Tyler Cluster (Weeks 12-16)
Research & Prototype (Days 56-60)

Day 56: Research EnerGov platform architecture, identify common DOM patterns
Day 57: Access Prince William ePortal, map authentication flow
Day 58: Reverse engineer EnerGov record search and navigation
Day 59: Build base EnerGov scraper module (reusable across all 3 jurisdictions)
Day 60: Test base module against Prince William live data

Prince William County (Days 61-66)

Day 61: Adapt base EnerGov module for Prince William
Day 62: Extract Record Details, Processing Status
Day 63: Extract attachments, inspections, fees
Day 64: Attachment downloads, Supabase upload
Day 65: DB verification, edge case fixes
Day 66: Buffer

City of Alexandria (Days 67-72)

Day 67: Access APEX portal, verify EnerGov stack
Day 68: Adapt base EnerGov module for APEX branding differences
Day 69: Extract all sections
Day 70: Attachment downloads
Day 71: DB verification, edge case fixes
Day 72: Buffer

Loudoun County (Days 73-78)

Day 73: Access LandMARC portal, map login flow
Day 74: Adapt base EnerGov module for LandMARC
Day 75: Extract all sections
Day 76: Attachment downloads
Day 77: DB verification
Day 78: Phase 4 buffer, Cloudflare/auth fixes

Phase 4 Buffer (Days 79-80)

Day 79-80: Cross-jurisdiction EnerGov testing, final fixes


PHASE 5 — Integration & QA (Weeks 17-18)

Day 81: Full end-to-end test run across all 12 jurisdictions
Day 82: Fix any broken scrapers from portal updates
Day 83: Frontend dashboard updates for all new jurisdictions
Day 84: Hash-based deduplication audit across all jurisdictions
Day 85: Error handling and Cloudflare cooldown management review
Day 86: Performance testing — scrape time per jurisdiction
Day 87: Client UAT (User Acceptance Testing) — client tests each jurisdiction
Day 88: Fix issues raised in UAT
Day 89: Final deployment, monitoring setup
Day 90: Project handover, documentation, final sign-off


Total: 90 working days / 18 weeks
Each day assumes 4-6 focused hours on scraper work. Days may slide due to Cloudflare blocks, portal downtime, or unexpected DOM changes — buffer days are built in per phase for exactly this reason.