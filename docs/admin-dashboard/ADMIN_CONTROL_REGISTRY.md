# Admin Control Registry — Governance Scope

Parent: [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)

---

| Control ID | Module | UI label | Purpose | Role | Preconditions | Backend action | Audit event | Risk |
|------------|--------|----------|---------|------|---------------|----------------|-------------|------|
| ACC-001 | Access | Activate user | Restore login | platform_admin | User deactivated | `POST /api/admin/v1/access/users/:id/activate` | `user.activated` | medium |
| ACC-002 | Access | Deactivate user | Ban/suspend access | platform_admin | Not last admin | `POST .../deactivate` | `user.deactivated` | high |
| ACC-003 | Access | Grant platform admin | Full governance | platform_admin | Target not already admin | RPC grant role | `platform_role.granted` | critical |
| ACC-004 | Access | Revoke platform admin | Remove governance | platform_admin | Not last admin; not self if last | RPC revoke | `platform_role.revoked` | critical |
| ACC-005 | Access | Set project role | Team membership | platform_admin | Project exists | Team invitation RPC or direct insert | `project_access.changed` | medium |
| ACC-006 | Access | Remove project access | Remove member | platform_admin | Not sole owner without transfer | Delete team row | `project_access.removed` | medium |
| ACC-007 | Access | Set feature permission | Feature R/W/none | platform_admin | Project membership exists if project-scoped | Upsert `user_feature_permissions` | `feature_permission.changed` | high |
| ACC-008 | Access | Set scraped-data scope | Limit portal data visibility | platform_admin | Membership on scoped projects | Upsert `user_scraped_data_scope` | `scraped_data_scope.changed` | high |
| ACC-009 | Access | Grant credential use | Allow backend decrypt use | platform_admin | Credential exists; user has project access | Upsert `user_portal_credential_grants` | `credential_grant.changed` | high |
| ACC-010 | Access | Grant credential manage | Allow CRUD metadata | platform_admin | Same | Upsert grant level manage | `credential_grant.changed` | critical |
| ACC-011 | Access | Copy permissions from user | Template copy | platform_admin | Source user selected | RPC bulk copy | `permissions.copied` | medium |
| ACC-012 | Access | Mark access reviewed | Bulk review sign-off | platform_admin | — | Update review timestamp | `access_review.completed` | low |
| ACC-013 | Access | Export access report | CSV for review | platform_admin | — | `GET .../export` | `access.export` | low |
| PLT-001 | Platform | Save jurisdiction | Catalog CRUD | platform_admin | — | Existing jurisdiction API | `jurisdiction.saved` | low |
| PLT-002 | Platform | Send notification | Jurisdiction email | platform_admin | Subscribers exist | Existing AdminPanel flow | `notification.sent` | medium |
| PLT-003 | Platform | Schedule notification | Future send | platform_admin | — | Existing schedule insert | `notification.scheduled` | low |
| PLT-004 | Platform | Save branding | Email branding | platform_admin | — | Existing branding save | `branding.updated` | low |
| PLT-005 | Platform | Manage drip campaign | Marketing email | platform_admin | — | Edge admin-drip-campaigns | `campaign.changed` | medium |
| AUD-001 | Audit | Export audit CSV | Compliance export | platform_admin | Date range | `GET /api/admin/v1/audit/export` | `audit.exported` | low |

**Excluded controls:** scrape retry, ingestion enqueue, filing submit, invoice create — remain in main product with feature permissions enforced there.

**Confirmation tiers:** ACC-003/004/002/010 → typed `CONFIRM` + reason field.
