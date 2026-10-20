# GORMS Email Center — Functional Requirements v1.0

**Status:** Feature scope locked
**Integration:** Google Workspace Gmail
**Principle:** Personal mailbox ownership + business-record involvement + hierarchical oversight.

## A. Core Email Experience

1. Integrate each employee's company Gmail through Google OAuth.
2. Support Inbox, Sent, Drafts, Starred, labels, search, compose, reply, reply-all, forward, attachments and conversation threads.
3. Support multiple employee mailboxes without merging their underlying email records.
4. Keep Gmail as the authoritative mailbox. Changes should synchronize between Gmail and GORMS.
5. Allow access through the central Email Center or from a contextual email panel within a GORMS record.
6. Preserve the existing GORMS UI, theme, navigation and unrelated features.

## B. Universal Email Binding

1. Allow users to link an individual email or complete thread to an Opportunity, Meeting, Department, Contact or future GORMS entity.
2. Permit multiple links per message/thread and multiple messages/threads per entity.
3. Support linking from both directions: Email → Record and Record → Email.
4. Store and use persistent provider identifiers and relationship references, not Gmail URLs alone. Provide an Open in Gmail link.
5. Linked threads must automatically include future replies and attachments.
6. Individual-message bindings remain fixed to the selected message.
7. Prevent duplicate links while retaining mailbox-specific copies/ownership.
8. Linking and unlinking must not delete, forward or modify original Gmail messages.

## C. Involvement and Access Control

1. Employees have access to their own connected mailboxes.
2. Opportunity involvement determines access to its business-context communications.
3. Explicitly linked/shared emails are visible to authorized Opportunity participants where organizational mailbox-sharing permissions allow.
4. Unlinked mailbox emails remain private to their authorized users.
5. Access follows existing Bid Tracker involvement, organizational hierarchy and RBAC.
6. A user not authorized for an Opportunity must not see that Opportunity or its associations through email links.
7. The same thread linked to multiple Opportunities must reveal only links the current user is authorized to access.
8. Separate permissions for View, Link, Unlink, Send/Reply, Attachment Download, Share, Team View, Supervisory View and Manage Access.
9. Revoking Opportunity involvement must revoke the associated contextual access immediately.
10. Sending email must always use an authenticated, authorized sending identity.

## D. HOD and Superadmin Oversight

1. Add a supervisory view inside Opportunity → Communications.
2. Display mailboxes and conversations separately by employee.
3. HOD sees communications within their authorized BU/team scope.
4. Superadmin sees organization-wide communications only within an explicitly approved privileged-access scope.
5. Privileged views may include mailbox emails not yet linked to the Opportunity only when separately authorized. Do not silently include all employee emails merely because they work on the bid.
6. Provide filters by mailbox owner, date, thread, sender, recipient, linked/unlinked status and Opportunity.
7. Highlight potentially missing participants using available message recipients and known bid involvement.
8. Allow authorized users to suggest adding a missing stakeholder or linking a conversation; do not automatically grant bid access or add email recipients.
9. Log every privileged email-content access and supervisory permission change.
10. Portal Superadmin does not, by itself, grant Gmail delegation rights.

## E. Contextual Communications UI

Use a reusable Communications component throughout GORMS.

**Views:**

- My Mailbox — current user's own messages.
- Opportunity Communications — authorized linked correspondence.
- Team Communications — shared messages organized by mailbox owner.
- Supervisor View — restricted cross-mailbox oversight.

**Actions:**

- Open conversation.
- Reply, Reply All or Forward using an authorized account.
- Link/Unlink message or thread.
- Navigate to associated business record.
- Preview/download authorized attachments.
- Search, filter and sort correspondence.
- Open source message in Gmail.
- View correspondence and relationship history.

Opening an email from another module should preserve the originating record, selected tab, filters and navigation context.

## F. Suggested Relationships

1. Suggest Contact and Meeting associations based on participant addresses, existing records, subject and relevant context.
2. Require explicit user confirmation before creating a suggested link.
3. Do not automatically expose restricted records as suggestions.
4. Reserve extension points for future AI classification, summarization, document binding, action extraction and follow-up workflows.

## G. Exception Handling

| Scenario                                     | Required behavior                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| Same thread exists in two employee mailboxes | Preserve separate mailbox records; optionally group them visually by conversation |
| One email linked to multiple Opportunities   | Validate access independently for each Opportunity                                |
| New reply or attachment arrives              | Synchronize automatically for linked threads                                      |
| New participant joins conversation           | Update thread; do not automatically change GORMS roles                            |
| Email is unlinked                            | Remove relationship only, retain Gmail message                                    |
| User loses Opportunity access                | Revoke contextual access immediately                                              |
| Gmail account disconnects                    | Suspend synchronization and handle cached content per retention policy            |
| Original Gmail message is deleted            | Indicate unavailable/deleted; preserve authorized relationship history            |
| Opportunity is archived                      | Preserve links under existing archive and retention rules                         |
| Opportunity is deleted                       | Follow record retention/deletion policy; do not delete Gmail messages             |
| Google authorization expires or is revoked   | Require reconnect when renewal is unavailable                                     |
| Sender has multiple Gmail identities         | Use only authorized identities                                                    |
| Reply contains sensitive content             | Apply the selected sharing policy before displaying to other members              |
| Synchronization temporarily fails            | Show last-sync status and retry without creating duplicates                       |

## H. Development Phases

**Phase 1 — Gmail Integration**

- OAuth connection/disconnection.
- Native email interface.
- Inbox, Sent, Drafts, search, threads, compose and attachments.
- Individual mailbox isolation.

**Phase 2 — Universal Binding**

- Message/thread links.
- Bidirectional navigation.
- Communications tab and quick side panel.
- Integration with existing Opportunity, Meeting, Department and Contact records.

**Phase 3 — Permissions and Supervision**

- Involvement-based access.
- Existing RBAC integration.
- HOD/Superadmin supervisory view.
- Employee-wise correspondence visibility.
- Audit logging.

**Phase 4 — Synchronization and Reliability**

- Automatic reply/attachment synchronization.
- Multi-mailbox handling.
- Access revocation.
- Failure recovery.
- Relationship suggestions and acceptance tests.

## I. Acceptance Criteria

- [ ] Employee connects only an approved company Google Workspace account.
- [ ] Employee reads, searches, composes, replies and manages Gmail within GORMS.
- [ ] Email sent through GORMS appears in Gmail.
- [ ] User can link one email or an entire thread to multiple authorized records.
- [ ] Linked threads automatically display future replies and attachments.
- [ ] Emails can be opened from both Email Center and associated business records.
- [ ] Different employees' mailbox records remain independently represented.
- [ ] Unauthorized users cannot discover restricted Opportunities through email relationships.
- [ ] Shared linked emails are readable only under applicable business and mailbox permissions.
- [ ] Removing a user from an Opportunity removes their contextual access.
- [ ] HOD can use a separately authorized supervisory view for their assigned scope.
- [ ] Superadmin privileged access requires explicit organizational authorization.
- [ ] Supervisory view distinguishes linked and unlinked correspondence where accessible.
- [ ] Missing stakeholders can be identified and suggested without automatic role changes.
- [ ] Linking/unlinking never changes the original Gmail message.
- [ ] Existing GORMS modules, UI, RBAC and navigation remain unaffected.

## J. Implementation Constraints

- Do not use Gmail SMTP/app passwords for user mailbox integration.
- Do not expose OAuth tokens or Gmail credentials to the frontend.
- Do not assume an application role can bypass Google Workspace mailbox authorization.
- Do not duplicate full email content in GORMS unless explicitly required by the approved sharing/retention model.
- Do not build separate email implementations for each GORMS module.
- Keep entity linking extensible and independent of specific module names.
- Preserve existing application functionality and database integrity.
- Do not start coding until the existing GORMS authentication, RBAC and relevant entity interfaces have been inspected.

**Feature lock:** The above defines the target product behavior. Any later enhancement must extend the shared Email Center and universal binding model rather than create a parallel email system.
