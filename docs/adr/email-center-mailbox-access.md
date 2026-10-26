# Decision: shared Email Center with recipient-owned copies

Status: implemented. Scope: Email Center functional requirements v1.0 and the user's clarification that email visibility follows actual delivery.

GOMS keeps one email implementation, using server-side OAuth for each employee mailbox. Gmail content is read live. The database stores encrypted credentials, provider/RFC message identifiers, entity links, explicit supervisory grants and minimal audit events. Bodies and attachment bytes are not replicated into application records.

Normal context sharing discovers the current user's copy using RFC Message-ID, after fresh business-record and involvement checks. It never serves the original owner's copy to ordinary teammates. This satisfies the requirement that an omitted recipient cannot read a new reply through an Opportunity. Sharing a portal association is distinct from forwarding, delivery or granting Gmail access.

Cross-mailbox oversight uses separately requested, organizationally approved, expiring owner-consented scopes. Every privileged read is audited, current hierarchy and permissions are rechecked, and sending remains confined to the user's verified mailbox identity. Global application roles cannot silently acquire mailbox access.

Entity adapters supply current existence, authorization and navigation paths, keeping the binding model extensible. Existing tRPC and RBAC-tree infrastructure are reused. The existing OAuth callback dispatches a distinct browser-bound mail flow, preserving login behavior. Existing masters remain the only people/reference-data authorities.

Alternatives considered: browser-held Gmail tokens cannot satisfy server synchronization or the approved credential boundary; copying shared thread bodies complicates retention and leaks newly excluded replies; application-role-only delegation violates the approved mailbox access model. These were rejected.

Consequences: employees must connect their own account; provider availability affects reads; Google/Workspace consent policy may need administrator setup; reconciliation polls once per minute; recipient discovery adds bounded Gmail searches. Encryption key changes require reconnection. Automated verification uses mocked Google and an isolated transactional migration check; real mailbox acceptance remains a separate employee-driven exercise.
