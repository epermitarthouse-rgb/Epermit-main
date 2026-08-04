# Technical Gap Analysis & Audit: PermitPilot UX v3

This document identifies technical sub-tasks, field labels, and logic discovered in the original system screenshots that require verification or deeper integration into the new UX v3 "Guided Mission Control" designs.

## 1. Site Investigation Report (SIR) Granularity
Based on screenshots `IMG_2155` through `IMG_2175`, the following specific data points should be verified in the v3 Technical Workspace:
- **Proffer Tracking:** The original system has detailed "approved proffers" logic for Landscaping and Site Lighting that needs explicit data fields.
- **Agency Contact Logs:** "Contact List of AHJ" requires a dedicated directory structure beyond a simple list, capturing names, roles, and verified timestamps.
- **Fee Schedules:** Jurisdictional fee calculations (e.g., $425 x 3 for Building Plan Review) should be itemized in the "SIR/ESIR Sync" module.

## 2. Intake Pipeline & AI Agent States
Screenshots `IMG_1984` and `IMG_2130` show specific agent lifecycle states that should be reflected in the "Master Matrix - AI Workflow" view:
- **Agent Roles:** "Context & Reference Engine," "Discipline Classifier," and "Portal Monitor."
- **Status Indicators:** "Idle," "Waiting for Doc," "In Flight," and "Shadow Match."
- **Validation Gates:** The "Total Shadow Comments" and "Validation Gate Progress" logic from the shadow mode dashboard should be accessible to Admin users to monitor AI performance.

## 3. Monday.com logic for Task Matrix
From screenshots `IMG_2210` to `IMG_2224`, several operational columns are critical for implementation:
- **Critical Path Labels:** Explicit labeling of "CP" (Critical Path) vs "NCP" (Non-Critical Path) is essential for the predictive engine.
- **Dependency Mapping:** The "Dependent On" field needs a visual connector or sidebar link in the Unified Task Matrix to show cross-track blockers.
- **Approval Checkpoints:** Specific "N/A" vs "Approved" vs "Completed" logic per sub-item.

## 4. Utility Coordination (UCI) Details
The UCI screenshots (`IMG_1988`, `IMG_2222`) highlight:
- **Provider-Specific Forms:** Links to "Meter Set Request Form" and portal session tokens (PEPCO/BGE).
- **Equipment Procurement:** Explicit tracking of "Transformer Order" as a long-lead blocker for "Final Inspections."

## 5. Portal Harvest Logic
- **Credential Storage:** `IMG_2148` shows a detailed "Portal Credentials" management view. The v3 design should ensure this is linked directly from the specific project track it serves.
- **Scrape Schedule:** Displaying "Last Checked" timestamps for automated portal scrapes.
