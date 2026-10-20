# Shared Email Center

The locked [functional requirements](email-center-requirements-v1.md) define this feature. One `EmailWorkspace` is used by E-mail, Opportunity → Communication, and quick panels on Meetings, Departments and Contacts. Existing tabs and the native people/master review workflow are retained. Attachments remain excluded from the Opportunity Communication tab's unrelated tender-document section.

## Connection

Choose **Connect Gmail** while signed into GOMS. Consent must use the same approved `@amnex.com` Workspace account. The server requests `openid email gmail.modify`, stores access/refresh credentials with mailbox-bound AES-256-GCM encryption, and never returns them to JavaScript. Google remains authoritative; bodies and attachments are fetched live, rendered as plain text, and are not persisted in GOMS.

The existing web OAuth configuration and registered `/api/oauth/google/callback` are reused: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and `AUTH_SESSION_SECRET`. Optional dedicated overrides are `EMAIL_GOOGLE_CLIENT_ID`, `EMAIL_GOOGLE_CLIENT_SECRET`, `EMAIL_GOOGLE_REDIRECT_URI`, and `EMAIL_TOKEN_ENCRYPTION_KEY` (at least 32 bytes). Secrets belong in server secret configuration. An explicit encryption key is preferred for independent rotation; otherwise HKDF derives a distinct email key from the existing session secret. Changing that key requires reconnecting mailboxes. Reconnection with a newly issued refresh token works even if an old key is unavailable.

The OAuth client must permit Gmail API access and its consent application must permit the employee's account. Workspace policy or Google's verification requirements may require administrator setup. The ordinary sign-in scope and other Google integrations are unchanged.

## Visibility and involvement

Normal record and Team views read only the current user's own delivered Gmail copies. A shared link uses provider IDs plus RFC Message-ID to find that user's copy; it never reads another employee's token. If a later reply omits a person, the source owner's later message is not copied into that person's Opportunity view. Mentioning someone in the body or adding them to a bid does not deliver email or grant mailbox access. Bcc identities of other recipients are not exposed.

Opportunity context additionally requires current record RBAC, the Communication permission, and current ownership/creation/team assignment or organizational supervision. A global Bid or administrator role alone does not count as involvement. Role/tree caches are bypassed on every request. Access and credential revisions are rechecked after provider reads, so a removed assignment, revoked grant or disconnect prevents the response. Each association is checked independently; restricted records are omitted from links and suggestions.

Supervisory access requires owner consent through **Manage access**, then explicit System Admin approval recording the organizational authorization reference, scope, expiry, unlinked-mail permission and download permission. Current reporting lines are rechecked for HOD grants. Superadmin grants require the existing allowlist and a currently involved mailbox owner for scoped Opportunity context. Portal admin status alone supplies no Gmail delegation. Supervisory content access and grant changes are audited. Oversight is read-only; sending always uses the user's own authenticated mailbox and a Gmail-verified send-as identity.

The Supervisor view separates mailboxes by owner and offers selected-record correspondence or unlinked correspondence. Unlinked means no association visible to the current user; restricted associations are never disclosed through the filter. Accessing unlinked correspondence requires the grant's separate unlinked permission, including when scoped to a selected Opportunity.

## Binding and synchronization

Links support Opportunity, Meeting, Department and Contact via extensible record adapters. A unique mailbox/item/entity key prevents duplicates. Message links remain fixed; thread links pick up replies and attachments present in that mailbox. Multiple associations and mailbox-specific copies are retained. Link/unlink never calls Gmail modify/send/delete. A server reconciler refreshes provider identifiers every minute with an advisory lock and bounded retries; open views refresh automatically. Deleted messages remain indicated as unavailable with relationship history retained. Record-delete triggers remove relationships and record history without deleting Gmail messages.

Participant categories use exact addresses from existing people masters. Name-only matches and unknown participants require human review. Existing nonempty emails cannot be overwritten through that review. Missing-stakeholder suggestions compare known Opportunity involvement against the latest available headers and persist a review request without sending, adding recipients, or changing roles. Suggested record links likewise require explicit confirmation.

Compose supports reply/all/forward, verified aliases, live attachments and Gmail drafts. Draft edits check the current Gmail draft message identifier before replacing content and preserve attachments unless explicitly deselected. Sending requires an explicit action and a server idempotency reservation; an uncertain network result is never automatically retried. Check Gmail Sent before creating another send after an uncertain outcome. Compose attachments are bounded to 5 MB total, downloads to 25 MB. HTML is displayed as safe text; remote tracking content is not loaded.

## Validation and practical limits

Automated tests mock Google and the database for OAuth browser binding/replay/account checks, encrypted credentials, recipient copy isolation, involvement revocation, per-link redaction, privileged grant checks, sender identity, send idempotency, draft conflicts, MIME and attachment safety. Migration validation runs in an isolated schema inside a rolled-back transaction, including the retention trigger. Production domain/API/frontend builds and localhost smoke checks are required before release. Real mailbox consent, Workspace approval and an actual Gmail send/read acceptance exercise require an employee's connection; tests do not claim those have occurred.

Queries are paginated. Search within record correspondence filters loaded pages; Gmail mailbox search uses Gmail's query syntax. The server's one-minute reconciliation is polling rather than Google Pub/Sub. Extension points for AI classification, summaries, documents, actions and follow-ups are declarations only; no unapproved AI content processing runs.

Provider references: [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail threads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get), [send-as identities](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/list), [sending mail](https://developers.google.com/workspace/gmail/api/guides/sending).
