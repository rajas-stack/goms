# API reference

Generated from the current working source. The backend uses Fastify and tRPC; the frontend consumes the exported `AppRouter` type.

## Transport and identity

The tRPC endpoint is `/api/trpc/<namespace.procedure>`. Queries use the tRPC query transport; mutations use POST. Use the application tRPC client for input encoding, batching and authenticated requests rather than inventing REST paths. Identity is sent as a Bearer token and verified through the configured Firebase or GOMS OAuth provider. Procedure-specific authentication and server RBAC still apply. `/api/trpc/health.check` verifies database connectivity.

## Router modules

| Namespace | Source | Procedure count |
| --- | --- | --- |
| `health` | [health.ts](../apps/api/src/routers/health.ts) | 1 |
| `customers` | [customers.ts](../apps/api/src/routers/customers.ts) | 5 |
| `hierarchy` | [hierarchy.ts](../apps/api/src/routers/hierarchy.ts) | 20 |
| `employees` | [employees.ts](../apps/api/src/routers/employees.ts) | 17 |
| `sales` | [sales.ts](../apps/api/src/routers/sales.ts) | 11 |
| `commercial` | [commercial.ts](../apps/api/src/routers/commercial.ts) | 0 |
| `ownership` | [ownership.ts](../apps/api/src/routers/ownership.ts) | 8 |
| `opportunities` | [opportunities.ts](../apps/api/src/routers/opportunities.ts) | 7 |
| `followUps` | [follow-ups.ts](../apps/api/src/routers/follow-ups.ts) | 5 |
| `search` | [search.ts](../apps/api/src/routers/search.ts) | 3 |
| `adminImport` | [adminImport.ts](../apps/api/src/routers/adminImport.ts) | 7 |
| `bids` | [bids.ts](../apps/api/src/routers/bids.ts) | 9 |
| `bidMilestones` | [bidMilestones.ts](../apps/api/src/routers/bidMilestones.ts) | 5 |
| `protectedValues` | [protectedValues.ts](../apps/api/src/routers/protectedValues.ts) | 3 |
| `bidCorrigenda` | [bidCorrigenda.ts](../apps/api/src/routers/bidCorrigenda.ts) | 5 |
| `documents` | [documents.ts](../apps/api/src/routers/documents.ts) | 6 |
| `bidSavedViews` | [bidSavedViews.ts](../apps/api/src/routers/bidSavedViews.ts) | 5 |
| `auditLogs` | [auditLogs.ts](../apps/api/src/routers/auditLogs.ts) | 1 |
| `bidCustomFields` | [bidCustomFields.ts](../apps/api/src/routers/bidCustomFields.ts) | 9 |
| `deliveryTeams` | [deliveryTeams.ts](../apps/api/src/routers/deliveryTeams.ts) | 5 |
| `bidSynopsis` | [bidSynopsis.ts](../apps/api/src/routers/bidSynopsis.ts) | 2 |
| `orgPeople` | [orgPeople.ts](../apps/api/src/routers/orgPeople.ts) | 4 |
| `auth` | [auth.ts](../apps/api/src/routers/auth.ts) | 1 |
| `access` | [access.ts](../apps/api/src/routers/access.ts) | 8 |
| `tenderWebsites` | [tenderWebsites.ts](../apps/api/src/routers/tenderWebsites.ts) | 6 |
| `credentialPassphrases` | [credentialPassphrases.ts](../apps/api/src/routers/credentialPassphrases.ts) | 4 |
| `googleIntegrations` | [googleIntegrations.ts](../apps/api/src/routers/googleIntegrations.ts) | 2 |
| `makerDocuments` | [makerDocuments.ts](../apps/api/src/routers/makerDocuments.ts) | 9 |

## Procedure inventory

| Procedure | Operation |
| --- | --- |
| `health.check` | query |
| `customers.list` | query |
| `customers.get` | query |
| `customers.create` | mutation |
| `customers.update` | mutation |
| `customers.delete` | mutation |
| `hierarchy.listStates` | query |
| `hierarchy.getState` | query |
| `hierarchy.getNode` | query |
| `hierarchy.listChildren` | query |
| `hierarchy.listOrgRoots` | query |
| `hierarchy.listDepartments` | query |
| `hierarchy.listPostingNodes` | query |
| `hierarchy.breadcrumb` | query |
| `hierarchy.childCount` | query |
| `hierarchy.geoRoot` | query |
| `hierarchy.childCounts` | query |
| `hierarchy.createNode` | mutation |
| `hierarchy.updateNode` | mutation |
| `hierarchy.setNodeStatus` | mutation |
| `hierarchy.deleteNode` | mutation |
| `hierarchy.moveNode` | mutation |
| `hierarchy.duplicateNode` | mutation |
| `hierarchy.importChildren` | mutation |
| `hierarchy.moveTargets` | query |
| `hierarchy.reorderNode` | mutation |
| `employees.listUnder` | query |
| `employees.listDirect` | query |
| `employees.listByState` | query |
| `employees.listAll` | query |
| `employees.listDepartments` | query |
| `employees.get` | query |
| `employees.directReports` | query |
| `employees.reportingChain` | query |
| `employees.create` | mutation |
| `employees.update` | mutation |
| `employees.setManager` | mutation |
| `employees.delete` | mutation |
| `employees.merge` | mutation |
| `employees.listMergeAudit` | query |
| `employees.addCharge` | mutation |
| `employees.removeCharge` | mutation |
| `employees.import` | mutation |
| `sales.listPersons` | query |
| `sales.getPerson` | query |
| `sales.listPostings` | query |
| `sales.currentPostings` | query |
| `sales.create` | mutation |
| `sales.update` | mutation |
| `sales.setStatus` | mutation |
| `sales.delete` | mutation |
| `sales.transfer` | mutation |
| `sales.updatePostingDates` | mutation |
| `sales.updatePostingManager` | mutation |
| `ownership.listAssignments` | query |
| `ownership.listFor` | query |
| `ownership.listOwnedBy` | query |
| `ownership.resolveOwner` | query |
| `ownership.resolveOwners` | query |
| `ownership.assign` | mutation |
| `ownership.end` | mutation |
| `ownership.transferBookOfBusiness` | mutation |
| `opportunities.list` | query |
| `opportunities.listByDepartment` | query |
| `opportunities.get` | query |
| `opportunities.listStageChanges` | query |
| `opportunities.create` | mutation |
| `opportunities.update` | mutation |
| `opportunities.delete` | mutation |
| `followUps.listForEntity` | query |
| `followUps.listOpen` | query |
| `followUps.create` | mutation |
| `followUps.setStatus` | mutation |
| `followUps.delete` | mutation |
| `search.search` | query |
| `search.relatedRecords` | query |
| `search.relationshipAnalytics` | query |
| `adminImport.session.validate` | mutation |
| `adminImport.session.commit` | mutation |
| `adminImport.session.history` | query |
| `adminImport.history` | query |
| `adminImport.previewGeographyLoad` | mutation |
| `adminImport.commitGeographyLoad` | mutation |
| `adminImport.listDomains` | query |
| `bids.get` | query |
| `bids.getForOpportunity` | query |
| `bids.listForGrid` | query |
| `bids.create` | mutation |
| `bids.update` | mutation |
| `bids.archive` | mutation |
| `bids.markVerified` | mutation |
| `bids.unarchive` | mutation |
| `bids.delete` | mutation |
| `bidMilestones.listForBid` | query |
| `bidMilestones.listAll` | query |
| `bidMilestones.create` | mutation |
| `bidMilestones.update` | mutation |
| `bidMilestones.delete` | mutation |
| `protectedValues.listFor` | query |
| `protectedValues.freeze` | mutation |
| `protectedValues.unfreeze` | mutation |
| `bidCorrigenda.listForBid` | query |
| `bidCorrigenda.create` | mutation |
| `bidCorrigenda.addChanges` | mutation |
| `bidCorrigenda.updateRegister` | mutation |
| `bidCorrigenda.reviewChange` | mutation |
| `documents.requestUploadUrl` | mutation |
| `documents.confirmUpload` | mutation |
| `documents.listFor` | query |
| `documents.getDownloadUrl` | query |
| `documents.updateFiling` | mutation |
| `documents.delete` | mutation |
| `bidSavedViews.list` | query |
| `bidSavedViews.get` | query |
| `bidSavedViews.create` | mutation |
| `bidSavedViews.update` | mutation |
| `bidSavedViews.delete` | mutation |
| `auditLogs.list` | query |
| `bidCustomFields.list` | query |
| `bidCustomFields.create` | mutation |
| `bidCustomFields.update` | mutation |
| `bidCustomFields.reorder` | mutation |
| `bidCustomFields.archive` | mutation |
| `bidCustomFields.unarchive` | mutation |
| `bidCustomFields.delete` | mutation |
| `bidCustomFields.setValue` | mutation |
| `bidCustomFields.valuesForBid` | query |
| `deliveryTeams.list` | query |
| `deliveryTeams.create` | mutation |
| `deliveryTeams.update` | mutation |
| `deliveryTeams.setStatus` | mutation |
| `deliveryTeams.delete` | mutation |
| `bidSynopsis.get` | query |
| `bidSynopsis.save` | mutation |
| `orgPeople.list` | query |
| `orgPeople.create` | mutation |
| `orgPeople.update` | mutation |
| `orgPeople.delete` | mutation |
| `auth.me` | query |
| `access.listOverrides` | query |
| `access.setOverride` | mutation |
| `access.removeOverride` | mutation |
| `access.unmatchedOverrides` | query |
| `access.overrideHistory` | query |
| `access.permissionMatrix` | query |
| `access.effectivePermissions` | query |
| `access.readiness` | query |
| `tenderWebsites.dscEmployees` | query |
| `tenderWebsites.list` | query |
| `tenderWebsites.create` | mutation |
| `tenderWebsites.update` | mutation |
| `tenderWebsites.delete` | mutation |
| `tenderWebsites.setEditingLock` | mutation |
| `credentialPassphrases.list` | query |
| `credentialPassphrases.create` | mutation |
| `credentialPassphrases.update` | mutation |
| `credentialPassphrases.remove` | mutation |
| `googleIntegrations.get` | query |
| `googleIntegrations.save` | mutation |
| `makerDocuments.list` | query |
| `makerDocuments.create` | mutation |
| `makerDocuments.upload` | mutation |
| `makerDocuments.replace` | mutation |
| `makerDocuments.rename` | mutation |
| `makerDocuments.duplicate` | mutation |
| `makerDocuments.delete` | mutation |
| `makerDocuments.editorConfig` | query |
| `makerDocuments.downloadUrl` | query |

## Additional HTTP routes

- `GET /api/oauth/google/start` — [routes.ts](../apps/api/src/auth/oauth/routes.ts)
- `GET /api/oauth/google/callback` — [routes.ts](../apps/api/src/auth/oauth/routes.ts)
- `POST /api/oauth/exchange` — [routes.ts](../apps/api/src/auth/oauth/routes.ts)
- `POST /api/oauth/refresh` — [routes.ts](../apps/api/src/auth/oauth/routes.ts)
- `POST /api/oauth/logout` — [routes.ts](../apps/api/src/auth/oauth/routes.ts)

Routes may be registered conditionally, depending on provider/configuration. For full input schemas, return types, pagination and validation rules, read the linked router source and `apps/api/src/trpc.ts`; this inventory does not replace those contracts.
