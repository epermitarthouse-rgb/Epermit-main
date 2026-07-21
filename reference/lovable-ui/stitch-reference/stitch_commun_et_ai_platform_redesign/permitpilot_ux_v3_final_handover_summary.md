# PermitPilot Platform UX v3 — Final Handover Summary

This document serves as the master technical index for the **PermitPilot** platform transition to the **UX v3 "Guided Mission Control"** standard. These designs and logic requirements are ready for implementation via the **Railway + Cursor + Vercel** development track.

---

## 1. Technical Core & Mission Control
These screens establish the high-fidelity framework for the guided project journey.

- **Mission Control (Master Dashboard):** [{{DATA:SCREEN:SCREEN_210}}] - The high-level entry point for all active projects.
- **Master Unified Task Matrix (AI Workflow):** [{{DATA:SCREEN:SCREEN_200}}] - Integration of all 8 technical tracks with AI status indicators.
- **Guided Project View (Permit Filing):** [{{DATA:SCREEN:SCREEN_243}}] - Step-by-step progress tracking for filing agents.
- **UCI Guided Intelligence:** [{{DATA:SCREEN:SCREEN_226}}] - The dedicated workflow for Utility Coordination.

## 2. AI Code Compliance & Scoring
Strategic modules rooted in ICC/Jurisdiction building codes for automated plan prescreening.

- **AI Code Compliance Analyzer:** [{{DATA:SCREEN:SCREEN_69}}] - Drawing upload and automated violation detection interface.
- **AI Scoring Intelligence Dashboard:** [{{DATA:SCREEN:SCREEN_142}}] - Logic-enhanced results hub featuring:
    - **Weighted Impact Scoring** (Life Safety vs. Administrative).
    - **Jurisdictional Pass-Gates** (Montgomery County 98% benchmark).
    - **AI Confidence Scores** & Shadow Mode validation.
    - **Predictive Delay Analysis** (Estimated schedule risk in days).

## 3. Administrative & Financial Integration
Backend tools for staff control and client billing.

- **Admin Control Center:** [{{DATA:SCREEN:SCREEN_150}}] - Master hub for platform settings and global oversight.
- **QuickBooks Client Invoicing:** [{{DATA:SCREEN:SCREEN_158}}] - Direct project-to-invoice syncing for Ian and Charlotte.
- **Portal Credentials Management:** [{{DATA:SCREEN:SCREEN_19}}] - Secure credential storage for jurisdictional portal harvesting.
- **Internal Plan Prescreen:** [{{DATA:SCREEN:SCREEN_188}}] - Workspace for staff to audit AE firm responses before submission.

## 4. Site Investigation & Field Ops
End-to-end loop between the field and the central database.

- **Executive SIR (Critical/Red Logic):** [{{DATA:SCREEN:SCREEN_249}}] - High-level reporting with "Proceed/No-Go" logic.
- **Site Feasibility Analyzer (Phase 0):** [{{DATA:SCREEN:SCREEN_124}}] - Pre-contract intelligence tool.
- **Mobile Field Companion (Survey):** [{{DATA:SCREEN:SCREEN_199}}] - On-site data entry.
- **Mobile Field Companion (Capture):** [{{DATA:SCREEN:SCREEN_247}}] - Photo evidence and annotation.
- **SIR/ESIR Sync & Reporting:** [{{DATA:SCREEN:SCREEN_121}}] - Syncing field evidence to final reports.

## 5. Implementation Documentation
Critical resources for the development team to ensure data fidelity.

- **Technical Reference Library:** [{{DATA:SCREEN:SCREEN_240}}] - Structured gallery of all original screenshots (Monday.com/Legacy).
- **Gap Analysis & Audit:** [{{DATA:DOCUMENT:DOCUMENT_148}}] - Itemized list of discovered fields, sub-tasks, andCP/NCP logic.
- **UCI Module Specification:** [{{DATA:DOCUMENT:DOCUMENT_198}}] - Detailed 12-agent architecture for the Utility module.

---

### Implementation Instructions
1. **Frontend:** Screens follow the "Intelligence Editorial" design system ({{DATA:DESIGN_SYSTEM:DESIGN_SYSTEM_1}}). Use the **"</> View Code"** button on each screen to export HTML/CSS.
2. **Backend:** Data models for UCI and Task Matrix should follow the logic outlined in the Gap Analysis and UCI Spec.
3. **AI Logic:** The compliance scoring should utilize the weighted vectors established in the Intelligence Dashboard.
