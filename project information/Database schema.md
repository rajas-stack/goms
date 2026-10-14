# Database schema reference

PostgreSQL stores the server data. The API uses `pg`, parameterized SQL and transactions; `node-pg-migrate` tracks schema changes. This document is generated from migration source, not a live database inspection. Tables can gain columns, constraints and indexes in later migrations; read the ordered SQL reference for those changes.

## Table creation index

| Table | Creation migration |
| --- | --- |
| `customers` | [1787561719008_customers.sql](../apps/api/migrations/1787561719008_customers.sql) |
| `hierarchy_nodes` | [1787631449862_hierarchy-nodes.sql](../apps/api/migrations/1787631449862_hierarchy-nodes.sql) |
| `employees` | [1787635740835_employees.sql](../apps/api/migrations/1787635740835_employees.sql) |
| `employee_charges` | [1787635740835_employees.sql](../apps/api/migrations/1787635740835_employees.sql) |
| `timeline_events` | [1787635740835_employees.sql](../apps/api/migrations/1787635740835_employees.sql) |
| `transfers` | [1787635740835_employees.sql](../apps/api/migrations/1787635740835_employees.sql) |
| `employee_merge_audit` | [1787635740835_employees.sql](../apps/api/migrations/1787635740835_employees.sql) |
| `sales_persons` | [1787639705341_sales.sql](../apps/api/migrations/1787639705341_sales.sql) |
| `sales_postings` | [1787639705341_sales.sql](../apps/api/migrations/1787639705341_sales.sql) |
| `commercial_masters` | [1787645325426_commercial-masters.sql](../apps/api/migrations/1787645325426_commercial-masters.sql) |
| `edition_features` | [1787645325426_commercial-masters.sql](../apps/api/migrations/1787645325426_commercial-masters.sql) |
| `commercial_skus` | [1787647096930_commercial-skus-bom.sql](../apps/api/migrations/1787647096930_commercial-skus-bom.sql) |
| `commercial_bom_items` | [1787647096930_commercial-skus-bom.sql](../apps/api/migrations/1787647096930_commercial-skus-bom.sql) |
| `commercial_boq_number_sequences` | [1787650774037_commercial-boq.sql](../apps/api/migrations/1787650774037_commercial-boq.sql) |
| `commercial_boqs` | [1787650774037_commercial-boq.sql](../apps/api/migrations/1787650774037_commercial-boq.sql) |
| `commercial_boq_line_items` | [1787650774037_commercial-boq.sql](../apps/api/migrations/1787650774037_commercial-boq.sql) |
| `commercial_audit_logs` | [1787650774037_commercial-boq.sql](../apps/api/migrations/1787650774037_commercial-boq.sql) |
| `opportunities` | [1787654497473_opportunities-ownership-followups.sql](../apps/api/migrations/1787654497473_opportunities-ownership-followups.sql) |
| `opportunity_stage_changes` | [1787654497473_opportunities-ownership-followups.sql](../apps/api/migrations/1787654497473_opportunities-ownership-followups.sql) |
| `ownership_assignments` | [1787654497473_opportunities-ownership-followups.sql](../apps/api/migrations/1787654497473_opportunities-ownership-followups.sql) |
| `follow_ups` | [1787654497473_opportunities-ownership-followups.sql](../apps/api/migrations/1787654497473_opportunities-ownership-followups.sql) |
| `admin_import_runs` | [1787741760367_admin-import-runs.sql](../apps/api/migrations/1787741760367_admin-import-runs.sql) |
| `bid_number_sequences` | [1788400000000_bid-number-sequences-and-bids.sql](../apps/api/migrations/1788400000000_bid-number-sequences-and-bids.sql) |
| `bids` | [1788400000000_bid-number-sequences-and-bids.sql](../apps/api/migrations/1788400000000_bid-number-sequences-and-bids.sql) |
| `bid_milestones` | [1788500000000_bid-milestones.sql](../apps/api/migrations/1788500000000_bid-milestones.sql) |
| `documents` | [1788600000000_documents.sql](../apps/api/migrations/1788600000000_documents.sql) |
| `document_citations` | [1788600000000_documents.sql](../apps/api/migrations/1788600000000_documents.sql) |
| `bid_corrigenda` | [1788700000000_bid-corrigenda.sql](../apps/api/migrations/1788700000000_bid-corrigenda.sql) |
| `bid_corrigendum_changes` | [1788700000000_bid-corrigenda.sql](../apps/api/migrations/1788700000000_bid-corrigenda.sql) |
| `protected_values` | [1788800000000_protected-values.sql](../apps/api/migrations/1788800000000_protected-values.sql) |
| `bid_saved_views` | [1788900000000_bid-saved-views.sql](../apps/api/migrations/1788900000000_bid-saved-views.sql) |
| `bid_custom_fields` | [1789200000000_bid-custom-fields.sql](../apps/api/migrations/1789200000000_bid-custom-fields.sql) |
| `bid_custom_field_values` | [1789300000000_bid-custom-field-values.sql](../apps/api/migrations/1789300000000_bid-custom-field-values.sql) |
| `delivery_team_members` | [1790100000000_delivery-teams-opportunity-assignments.sql](../apps/api/migrations/1790100000000_delivery-teams-opportunity-assignments.sql) |
| `opportunity_code_sequences` | [1790400000000_opportunity-code.sql](../apps/api/migrations/1790400000000_opportunity-code.sql) |
| `org_people` | [1790700000000_org-people.sql](../apps/api/migrations/1790700000000_org-people.sql) |
| `user_role_overrides` | [1790800000000_rbac-role-overrides.sql](../apps/api/migrations/1790800000000_rbac-role-overrides.sql) |
| `rbac_seen_users` | [1791000000000_rbac-seen-users.sql](../apps/api/migrations/1791000000000_rbac-seen-users.sql) |
| `auth_flows` | [1791100000000_oauth-sessions.sql](../apps/api/migrations/1791100000000_oauth-sessions.sql) |
| `auth_exchange_codes` | [1791100000000_oauth-sessions.sql](../apps/api/migrations/1791100000000_oauth-sessions.sql) |
| `auth_sessions` | [1791100000000_oauth-sessions.sql](../apps/api/migrations/1791100000000_oauth-sessions.sql) |
| `bid_synopsis_sections` | [1791244800000_bid-synopsis.sql](../apps/api/migrations/1791244800000_bid-synopsis.sql) |
| `tender_websites` | [1791417600000_tender-websites.sql](../apps/api/migrations/1791417600000_tender-websites.sql) |
| `credential_passphrases` | [1791763500000_credential-passphrases.sql](../apps/api/migrations/1791763500000_credential-passphrases.sql) |
| `google_integration_settings` | [1791763800000_google-integrations.sql](../apps/api/migrations/1791763800000_google-integrations.sql) |
| `security_events` | [1791764000000_security-events.sql](../apps/api/migrations/1791764000000_security-events.sql) |
| `maker_documents` | [1791764300000_maker-documents.sql](../apps/api/migrations/1791764300000_maker-documents.sql) |

## Principal relationships

Hierarchy nodes form a parent/child tree. Employees belong to hierarchy nodes and may report to other employees. Charges, timeline events and transfers link to employees. Sales postings link to sales persons. Opportunities link to department hierarchy nodes, and bids link to opportunities. Milestones, corrigenda, custom field values and synopsis records extend bid/opportunity workflows. Commercial BOQs have line items, SKUs have BOM items, documents have citations, and OAuth session tables support authentication. Polymorphic links such as ownership and entity-based documents must be interpreted using their entity-type fields, not assumed to be conventional foreign keys.

## Complete migration order

- [1787561719008_customers.sql](../apps/api/migrations/1787561719008_customers.sql)
- [1787631449862_hierarchy-nodes.sql](../apps/api/migrations/1787631449862_hierarchy-nodes.sql)
- [1787635740835_employees.sql](../apps/api/migrations/1787635740835_employees.sql)
- [1787639705341_sales.sql](../apps/api/migrations/1787639705341_sales.sql)
- [1787645325426_commercial-masters.sql](../apps/api/migrations/1787645325426_commercial-masters.sql)
- [1787647096930_commercial-skus-bom.sql](../apps/api/migrations/1787647096930_commercial-skus-bom.sql)
- [1787650774037_commercial-boq.sql](../apps/api/migrations/1787650774037_commercial-boq.sql)
- [1787654497473_opportunities-ownership-followups.sql](../apps/api/migrations/1787654497473_opportunities-ownership-followups.sql)
- [1787660000000_ownership-one-open-owner.sql](../apps/api/migrations/1787660000000_ownership-one-open-owner.sql)
- [1787741760367_admin-import-runs.sql](../apps/api/migrations/1787741760367_admin-import-runs.sql)
- [1787750000000_admin-import-hardening.sql](../apps/api/migrations/1787750000000_admin-import-hardening.sql)
- [1788000000000_admin-import-actor-email.sql](../apps/api/migrations/1788000000000_admin-import-actor-email.sql)
- [1788100000000_timeline-events-agenda-outcome-nextsteps.sql](../apps/api/migrations/1788100000000_timeline-events-agenda-outcome-nextsteps.sql)
- [1788200000000_sales-postings-gm-override.sql](../apps/api/migrations/1788200000000_sales-postings-gm-override.sql)
- [1788300000000_sales-persons-photo.sql](../apps/api/migrations/1788300000000_sales-persons-photo.sql)
- [1788400000000_bid-number-sequences-and-bids.sql](../apps/api/migrations/1788400000000_bid-number-sequences-and-bids.sql)
- [1788500000000_bid-milestones.sql](../apps/api/migrations/1788500000000_bid-milestones.sql)
- [1788600000000_documents.sql](../apps/api/migrations/1788600000000_documents.sql)
- [1788700000000_bid-corrigenda.sql](../apps/api/migrations/1788700000000_bid-corrigenda.sql)
- [1788800000000_protected-values.sql](../apps/api/migrations/1788800000000_protected-values.sql)
- [1788900000000_bid-saved-views.sql](../apps/api/migrations/1788900000000_bid-saved-views.sql)
- [1789000000000_commercial-boqs-opportunity-id.sql](../apps/api/migrations/1789000000000_commercial-boqs-opportunity-id.sql)
- [1789100000000_ownership-one-open-solution-lead.sql](../apps/api/migrations/1789100000000_ownership-one-open-solution-lead.sql)
- [1789200000000_bid-custom-fields.sql](../apps/api/migrations/1789200000000_bid-custom-fields.sql)
- [1789300000000_bid-custom-field-values.sql](../apps/api/migrations/1789300000000_bid-custom-field-values.sql)
- [1789400000000_opportunities-city.sql](../apps/api/migrations/1789400000000_opportunities-city.sql)
- [1789500000000_bid-custom-fields-has-held-value.sql](../apps/api/migrations/1789500000000_bid-custom-fields-has-held-value.sql)
- [1789600000000_opportunities-department-optional.sql](../apps/api/migrations/1789600000000_opportunities-department-optional.sql)
- [1789700000000_bid-custom-field-types.sql](../apps/api/migrations/1789700000000_bid-custom-field-types.sql)
- [1789800000000_bid-saved-view-sheet.sql](../apps/api/migrations/1789800000000_bid-saved-view-sheet.sql)
- [1789900000000_bid-custom-field-sheet.sql](../apps/api/migrations/1789900000000_bid-custom-field-sheet.sql)
- [1790000000000_opportunities-reference-assignment.sql](../apps/api/migrations/1790000000000_opportunities-reference-assignment.sql)
- [1790100000000_delivery-teams-opportunity-assignments.sql](../apps/api/migrations/1790100000000_delivery-teams-opportunity-assignments.sql)
- [1790200000000_delivery-team-members-manager.sql](../apps/api/migrations/1790200000000_delivery-team-members-manager.sql)
- [1790300000000_pre-sales-roster.sql](../apps/api/migrations/1790300000000_pre-sales-roster.sql)
- [1790400000000_opportunity-code.sql](../apps/api/migrations/1790400000000_opportunity-code.sql)
- [1790500000000_bid-sheet.sql](../apps/api/migrations/1790500000000_bid-sheet.sql)
- [1790600000000_legal-roster.sql](../apps/api/migrations/1790600000000_legal-roster.sql)
- [1790700000000_org-people.sql](../apps/api/migrations/1790700000000_org-people.sql)
- [1790800000000_rbac-role-overrides.sql](../apps/api/migrations/1790800000000_rbac-role-overrides.sql)
- [1790900000000_rbac-created-by-and-email-indexes.sql](../apps/api/migrations/1790900000000_rbac-created-by-and-email-indexes.sql)
- [1791000000000_rbac-seen-users.sql](../apps/api/migrations/1791000000000_rbac-seen-users.sql)
- [1791100000000_oauth-sessions.sql](../apps/api/migrations/1791100000000_oauth-sessions.sql)
- [1791244800000_bid-synopsis.sql](../apps/api/migrations/1791244800000_bid-synopsis.sql)
- [1791331200000_bid-synopsis-general.sql](../apps/api/migrations/1791331200000_bid-synopsis-general.sql)
- [1791417600000_tender-websites.sql](../apps/api/migrations/1791417600000_tender-websites.sql)
- [1791504000000_bid-corrigendum-register.sql](../apps/api/migrations/1791504000000_bid-corrigendum-register.sql)
- [1791590400000_tender-website-credentials.sql](../apps/api/migrations/1791590400000_tender-website-credentials.sql)
- [1791676800000_tender-website-edit-lock.sql](../apps/api/migrations/1791676800000_tender-website-edit-lock.sql)
- [1791763200000_website-kind.sql](../apps/api/migrations/1791763200000_website-kind.sql)
- [1791763500000_credential-passphrases.sql](../apps/api/migrations/1791763500000_credential-passphrases.sql)
- [1791763800000_google-integrations.sql](../apps/api/migrations/1791763800000_google-integrations.sql)
- [1791763900000_bid-document-batches.sql](../apps/api/migrations/1791763900000_bid-document-batches.sql)
- [1791764000000_security-events.sql](../apps/api/migrations/1791764000000_security-events.sql)
- [1791764300000_maker-documents.sql](../apps/api/migrations/1791764300000_maker-documents.sql)

The authoritative forward DDL is collected in [Database migrations.sql](<Database migrations.sql>). For the exact schema actually installed on a running server, use PostgreSQL schema inspection or a schema-only `pg_dump` against that database.
