# PermitPilot & Commun-ET: Integrated Handoff Guide
## Frameworks: Lovable, Vercel, and Supabase

This document provides the definitive architectural map for implementing the Commun-ET and PermitPilot ecosystem across the three requested environments.

---

## 1. Track A: Lovable (Marketing Site — `commun-et.com`)
The public-facing marketing site is designed for high-impact visual performance and lead generation. 

### Core Screen Index
- **Home Hero (8.1):** [{{DATA:SCREEN:SCREEN_214}}] - Establishes grid-overlay brand style.
- **Service Hubs:**
    - **Permit Strategy:** [{{DATA:SCREEN:SCREEN_234}}]
    - **Utility Coordination:** [{{DATA:SCREEN:SCREEN_113}}]
    - **External Project Management:** [{{DATA:SCREEN:SCREEN_221}}]
- **Jurisdiction Intelligence:**
    - **Washington D.C.:** [{{DATA:SCREEN:SCREEN_226}}]
    - **Montgomery County:** [{{DATA:SCREEN:SCREEN_197}}]
    - **Baltimore City:** [{{DATA:SCREEN:SCREEN_220}}]
- **Lead Generation:**
    - **Conversational Quote Form (8.5):** [{{DATA:SCREEN:SCREEN_21}}]
    - **Meet an Expert (Contact):** [{{DATA:SCREEN:SCREEN_91}}]
- **Content & Performance:**
    - **Insights & News (Blog):** [{{DATA:SCREEN:SCREEN_191}}]
    - **Past Performance Overview:** [{{DATA:SCREEN:SCREEN_116}}]
    - **Case Study Detail:** [{{DATA:SCREEN:SCREEN_231}}]

### Lovable Export Instructions
1. Open the screen on the Stitch canvas.
2. Click **"</> View Code"** in the top toolbar.
3. Copy the clean HTML/Tailwind CSS.
4. Paste into your Lovable component file.

---

## 2. Track B: Vercel & Supabase (Platform — `app.permitpilot.com`)
The PermitPilot internal platform requires a robust backend (Supabase) and performant frontend (Vercel). These screens follow the **UX v3 "Guided Mission Control"** standard.

### Technical Screen Index
#### Mission Control & Task Management
- **Master Unified Task Matrix (AI Workflow):** [{{DATA:SCREEN:SCREEN_201}}] - Central dashboard for all 8 tracks.
- **Project Setup (Portal Credentials):** [{{DATA:SCREEN:SCREEN_19}}] - Secure credential vault.
- **Guided Filing Flow:** [{{DATA:SCREEN:SCREEN_244}}] - Step-by-step agent tracking.

#### AI Intelligence Modules
- **AI Code Compliance Analyzer:** [{{DATA:SCREEN:SCREEN_69}}] - Drawing upload & detection.
- **AI Compliance Dashboard (UX v3.1):** [{{DATA:SCREEN:SCREEN_142}}] - Weighted scoring & delay risk logic.
- **Response Matrix & AI Scoring:** [{{DATA:SCREEN:SCREEN_106}}] - AE response verification.

#### Administrative & Utility (UCI)
- **QuickBooks Invoicing Module:** [{{DATA:SCREEN:SCREEN_159}}] - Financial sync for staff.
- **UCI Guided Intelligence:** [{{DATA:SCREEN:SCREEN_227}}] - Multi-utility pipeline management.
- **Predictive Schedule Impact:** [{{DATA:SCREEN:SCREEN_126}}] - Probability-weighted projections.

---

## 3. Data & Logic Specifications (Supabase Layer)
Engineers building the Supabase database and Vercel edge functions should refer to the following technical blueprints:

### Database Schema & API Routes
- **UCI Module Data Model:** Refer to **{{DATA:DOCUMENT:DOCUMENT_199}}** (§5) for the SQL table definitions for `utility_providers`, `project_utility_coordination`, `utility_communications`, and `long_lead_equipment`.
- **Field Mappings & Metadata:** Refer to the **Technical Gap Analysis ({{DATA:DOCUMENT:DOCUMENT_148}})** for required fields in the Site Investigation Reports (SIR) and Critical Path (CP) logic.

### AI Scoring Logic (Edge Functions)
- **Weighted Impact Vectors:** Implement scoring logic that prioritizes **Life Safety** codes. A single "Critical" violation must override overall percentage scores to trigger a "No-Go" status.
- **Predictive Delay Calculation:** Utilize the jurisdictional benchmarks (e.g., Montgomery County 98%) to calculate estimated risk days as shown in **{{DATA:SCREEN:SCREEN_142}}**.

---

## 4. Implementation Documentation Package
Final resources for the development team:
- **Technical Reference Library:** [{{DATA:SCREEN:SCREEN_241}}] - Legacy cross-reference gallery.
- **UCI Architectural Spec:** {{DATA:DOCUMENT:DOCUMENT_199}}
- **Final Handover Summary:** {{DATA:DOCUMENT:DOCUMENT_157}}