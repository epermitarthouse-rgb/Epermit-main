# Stitch → App Coverage Matrix

Source: `stitch-reference/stitch_commun_et_ai_platform_redesign/` (55 screen folders + 3 markdown docs).

**Legend**
- ✅ scaffold exists — page renders but needs 1:1 rebuild against Stitch export
- ❌ missing — no route in `src/App.tsx`
- 🆕 variant — additional state/revision of an already-listed screen; can share a base route

**Existing app routes:** `/login`, `/dashboard`, `/projects`, `/projects/alpha`, `/mission-control`, `/permit-queue`, `/agents`, `/messages`, `/documents`, `/utility-map`, `/compliance`, `/content-studio`, `/admin`, `/settings`.

---

## Dashboards & Overview
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 1 | permitpilot_enhanced_dashboard_ux_v2 | ✅ | `/dashboard` |
| 2 | uci_enhanced_intelligence_dashboard_ux_v2 | ❌ | `/uci` |
| 3 | ai_compliance_intelligence_dashboard_ux_v3.1 | ❌ | `/compliance/intelligence` |
| 4 | platform_architecture_user_flow_review | ❌ | internal `/architecture` |

## Project Lifecycle
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 5 | project_setup_portal_credentials_ux_v3 | ❌ | `/projects/new` |
| 6 | ai_feasibility_analyzer_phase_0 | ❌ | `/feasibility` |
| 7 | ai_site_feasibility_analyzer_phase_0 | ❌ | `/feasibility/site` |
| 8 | project_command_center_valvoline_leesburg | ✅ | `/projects/alpha` (rebuild) |
| 9 | project_command_center_multi_client_view | ❌ | `/command-center` |
| 10 | project_timeline_milestone_intelligence_ux_v3 | ❌ | `/projects/:id/timeline` |
| 11 | permitpilot_project_gantt_timeline_ux_v3 | ❌ | `/projects/:id/gantt` |
| 12 | permitpilot_critical_path_intelligence_ux_v3 | ❌ | `/critical-path` |

## Master / Task Matrices
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 13 | permitpilot_master_unified_task_matrix_ux_v3 | ❌ | `/matrix` |
| 14 | permitpilot_master_matrix_guided_flow_ux_v3 | ❌ | `/matrix/guided` |
| 15 | permitpilot_master_matrix_ai_workflow_ux_v3 | ❌ | `/matrix/ai-workflow` |
| 16 | permitpilot_unified_task_matrix_ux_v3 | ❌ | `/tasks` |
| 17 | permitpilot_unified_task_matrix_ux_v3_expanded | 🆕 | `/tasks?view=expanded` |

## Response, Compliance & Permits
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 18 | permitpilot_response_matrix_ux_v3 | ❌ | `/responses` |
| 19 | permitpilot_response_matrix_ai_scoring_ux_v3 | 🆕 | `/responses?view=ai-scoring` |
| 20 | ai_code_compliance_analyzer_ux_v3 | ✅ | `/compliance` |
| 21 | ai_code_compliance_analyzer_ux_v3.1 | 🆕 | `/compliance` |
| 22 | permitpilot_internal_plan_prescreen_ux_v3 | ❌ | `/prescreen` |
| 23 | permitpilot_raze_permit_management_ux_v3 | ✅ | `/permit-queue` (rebuild) |
| 24 | permitpilot_raze_permit_management_ux_v3.1 | 🆕 | `/permit-queue` |

## Portal & Messaging
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 25 | permitpilot_portal_harvest_ux_v3 | ❌ | `/portal-harvest` |
| 26 | messaging_portal_ux_v3 | ✅ | `/messages` |
| 27 | permitpilot_enhanced_messaging_portal_ux_v2 | 🆕 | `/messages` |

## SIR / ESIR Reporting
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 28 | site_investigation_report_sir | ❌ | `/sir` |
| 29 | site_investigation_report_ux_v3_valvoline_leesburg | 🆕 | `/sir/:id` |
| 30 | site_investigation_report_sir_technical_annex | ❌ | `/sir/:id/annex` |
| 31 | site_investigation_report_sir_technical_workspace_v3 | ❌ | `/sir/:id/workspace` |
| 32 | executive_site_investigation_report_esir | ❌ | `/esir` |
| 33 | executive_sir_critical_status_red | 🆕 | `/esir/:id` |
| 34 | sir_esir_sync_report_generator | ❌ | `/sir/sync` |

## Field / Mobile Companion
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 35 | mobile_field_companion_site_survey | ❌ | `/field/survey` |
| 36 | mobile_companion_field_map_locator | ✅ | `/utility-map` (rebuild) |
| 37 | mobile_companion_camera_capture | ❌ | `/field/capture` |
| 38 | field_intelligence_studio_annotation_markup | ❌ | `/field/studio` |

## Inspections, Closeout & Post-Mortem
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 39 | permitpilot_third_party_special_inspections_ux_v3 | ❌ | `/inspections` |
| 40 | permitpilot_third_party_special_inspections_ux_v3.1 | 🆕 | `/inspections` |
| 41 | permitpilot_final_site_inspections_co_ux_v3 | ❌ | `/inspections/final-co` |
| 42 | permitpilot_final_site_inspections_co_ux_v3.1 | 🆕 | `/inspections/final-co` |
| 43 | project_archive_closeout_ux_v3 | ❌ | `/closeout` |
| 44 | project_archive_closeout_ux_v3_with_archiving | 🆕 | `/closeout?mode=archive` |
| 45 | permitpilot_project_archiving_closeout_ux_v3.1 | 🆕 | `/closeout` |
| 46 | permitpilot_closeout_post_mortem_ux_v3 | ❌ | `/post-mortem` |
| 47 | permitpilot_closeout_post_mortem_ux_v3.1 | 🆕 | `/post-mortem` |
| 48 | post_mortem_analytics_ux_v3 | ❌ | `/post-mortem/analytics` |
| 49 | permitpilot_post_mortem_financial_intelligence_ux_v3.1 | ❌ | `/post-mortem/financial` |
| 50 | post_closeout_compliance_tracker_ux_v3 | ❌ | `/compliance/post-closeout` |

## Admin & Platform
| # | Stitch screen | Status | Mapped / proposed route |
|---|---|---|---|
| 51 | admin_control_center_ux_v3 | ✅ | `/admin` |
| 52 | admin_quickbooks_client_invoicing | ❌ | `/admin/invoicing` |
| 53 | platform_settings_ux_v3 | ✅ | `/settings` |
| 54 | ai_content_studio_ux_v3 | ✅ | `/content-studio` |
| 55 | technical_reference_library | ❌ | `/library` |

## Export / Marketing (out of app shell)
| # | Stitch screen | Status | Notes |
|---|---|---|---|
| 56 | export_map_marketing_site_track_a | ❌ | Public marketing site (separate track) |
| 57 | export_map_permitpilot_platform_track_b | ❌ | Platform export map (separate track) |

---

## Tally
- **Scaffolds present, need 1:1 rebuild:** 9 (#1, #8, #20, #23, #26, #36, #51, #53, #54)
- **Missing — no route at all:** 34 unique screens
- **Variants sharing a base route:** 12
- **Out-of-shell tracks:** 2

## Existing routes with no Stitch counterpart (reconcile)
| Route | Likely disposition |
|---|---|
| `/projects` | Merge into `/command-center` (multi-client view) |
| `/mission-control` | Merge into `/dashboard` (enhanced dashboard v2) |
| `/agents` | Merge into `/matrix/ai-workflow` |
| `/documents` | Merge into `/sir/:id/workspace` |

## Suggested build order
1. `/dashboard` (rebuild from `permitpilot_enhanced_dashboard_ux_v2`)
2. `/command-center` + `/projects/alpha` (Valvoline + multi-client)
3. `/matrix` + `/matrix/guided` + `/matrix/ai-workflow`
4. `/responses` (+ AI scoring variant)
5. `/portal-harvest`
6. `/sir` suite (SIR → annex → workspace → ESIR → sync)
7. `/inspections` + `/inspections/final-co`
8. `/closeout` + `/post-mortem` + analytics + financial
9. `/feasibility` (phase-0 analyzers)
10. Field/mobile suite (`/field/*`, `/utility-map` rebuild)
11. `/admin/invoicing`, `/library`, `/compliance/intelligence`, `/uci`
