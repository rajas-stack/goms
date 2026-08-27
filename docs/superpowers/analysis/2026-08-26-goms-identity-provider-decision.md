# GOMS Identity Provider Decision: Firebase Auth/Identity Platform (federated) vs. Self-Managed Email/Password

**Date:** 2026-08-26
**Status:** Decision document only. **Nothing is implemented.** This is the blocking investigation flagged in §1 of `2026-08-26-goms-stage-b-production-readiness-plan.md` — that plan's §2-§7 (rate limiting, monitoring, rollback runbook, `infra/prod` skeleton) remain approved and untouched; only §1 (auth) is paused on this decision.
**Confirmed by repo/memory search:** no evidence anywhere in this codebase or project memory of an existing Amnex corporate identity provider (Entra ID/Microsoft 365, Google Workspace, Okta, or otherwise) being used for GOMS or any related internal tool. That's an organizational fact this repo cannot establish — it has to come from Amnex IT (see §3 below).
**Current codebase state (verified, not assumed):** no auth code exists yet in either direction — no `firebase-admin`, `jsonwebtoken`, `bcrypt`, `argon2`, or `passport` in `apps/api/package.json` or the root `package.json`. Every tRPC procedure is `publicProcedure`. Both options below start from the same greenfield state.

---

## The two options

**Option A — Firebase Authentication / Google Cloud Identity Platform, federated to Amnex's IdP.** GCIP is the paid superset of Firebase Auth: enabling it in the GCP console unlocks enterprise SAML/OIDC federation (the mechanism needed to hand off login to Entra ID, Google Workspace, Okta, etc.), on top of everything Firebase Auth already does (email/password, session/ID-token issuance, a backend Admin SDK for verification). Concretely: Amnex's IdP handles the login screen and credential check; GCIP exchanges that for a Firebase ID token (a signed JWT); GOMS's backend verifies that token per-request via the Admin SDK.

**Option B — Self-managed email/password**, as already sketched in the paused §1.4 of the readiness plan: a `users` table in GOMS's own Postgres, `bcrypt`/`argon2` password hashing, a `login` tRPC procedure issuing a JWT or server-side session, and hand-written middleware to verify it.

Both are compatible with the already-approved §1.2 decision (no IAP, no load balancer): GCIP verifies tokens via a backend SDK call, the same shape as Option B's JWT verification — neither requires proxying traffic through a load balancer, so neither reopens the Firebase Hosting decision.

---

## Comparison

| Dimension | A: Firebase Auth/GCIP federated to Amnex's IdP | B: Self-managed email/password |
|---|---|---|
| **Corporate SSO support** | The reason to pick this option at all. If Amnex confirms an existing IdP (Entra ID, Google Workspace, Okta, generic SAML/OIDC), GCIP federates to it directly — users log in with their existing corporate account, no second password. If Amnex has *no* IdP, this option collapses to "GCIP running its own email/password provider," which is Option B's functionality with GCIP's operational and cost overhead on top for no SSO benefit. | None. A GOMS-specific credential, entirely separate from any corporate identity Amnex users already have. |
| **User lifecycle** (add/remove/deactivate) | Two sub-cases: (1) if Amnex's IdP supports SCIM/group sync, offboarding a user from Entra ID/Workspace can automatically revoke GOMS access — the strongest lifecycle story, but requires Amnex IT to set up that provisioning, not just confirm an IdP exists. (2) Without sync, an admin still manually invites/removes users in GCIP (via Admin SDK or console) — same manual burden as Option B, just in a different system. | Fully manual: an admin (via the `admin` role planned in §1.3) invites, deactivates, or deletes rows in GOMS's own `users` table. No dependency on Amnex IT ever setting anything up — works standalone from day one. |
| **MFA** | If Amnex's IdP already enforces MFA (common for Entra ID/Workspace corporate accounts), GOMS inherits it for free — zero GOMS-side work. GCIP also supports its own MFA (SMS/TOTP) independent of the upstream IdP, at extra per-MFA-user cost, if federation isn't used. | Not built in. Would need a separate library/flow (e.g. TOTP via `otplib`) built and maintained entirely in-house — real scope, not a checkbox, and easy to under-build (backup codes, device trust, rate-limiting the MFA endpoint itself). |
| **Password/reset responsibility** | Owned by Amnex's IdP (if federated) — GOMS never sees, stores, or resets a password, and inherits whatever password policy/reset flow the corporate IdP already has. If GCIP's own email/password provider is used instead (no federation), GCIP still owns hashing/reset email delivery, just not tied to a corporate policy. | Owned entirely by GOMS: password hashing (bcrypt/argon2), a reset-token flow, and **transactional email delivery for reset links** — the last one is a real, easy-to-underestimate new dependency (an email-sending service/API key, since nothing in this stack sends email today). |
| **Token/session handling** | Firebase ID tokens are short-lived signed JWTs (1 hour), refreshed client-side by the Firebase JS SDK automatically; backend verification is a single Admin SDK call (`verifyIdToken`) that checks the signature against Google's published public keys — no GOMS-side signing key to generate, rotate, or protect. | GOMS mints and signs its own tokens (or manages server-side session rows) — GOMS now owns a signing secret (rotation policy, storage in Secret Manager) and the token-refresh logic client-side, which §1.4 already scoped as "an implementation detail" but is real work: expiry handling, refresh-token storage (httpOnly cookie), revocation on logout. |
| **GOMS user/admin role mapping** | GCIP tokens carry Firebase custom claims (e.g. `role: 'admin'`), set via the Admin SDK — GOMS still needs its own logic to *decide* who's an admin (custom claims aren't populated by the IdP automatically unless Amnex's IdP exposes a group/role claim GOMS maps at login time) and to sync that into `protectedProcedure`/`adminProcedure` middleware (§1.4 items 2-3 stay essentially unchanged either way). | Native — `role` is just a column on GOMS's own `users` table, no external claim-syncing step. Marginally simpler because there's one fewer system in the loop. |
| **Frontend integration** | Firebase JS SDK (`firebase/auth`) handles the federated login redirect/popup flow, token refresh, and `onAuthStateChanged` — a well-trodden path, but it's a new SDK dependency and a login UI shaped around "Sign in with Amnex" rather than a plain form. | A plain login form posting to GOMS's own `auth.login` tRPC procedure — matches §1.4's existing sketch exactly, no new frontend SDK dependency, smallest frontend diff from today's app. |
| **Backend verification** | One `firebase-admin` dependency, `verifyIdToken` call in tRPC context — GOMS never implements JWT verification itself, just calls a library that does. | GOMS hand-writes JWT verification (or session-lookup) middleware in `apps/api/src/trpc.ts` per §1.4 item 3 — more code GOMS owns and must get right (expiry checks, signature verification, clock skew), though the scope is well-understood and small at this app's size. |
| **GCP cost** | Firebase Auth itself (email/password, Google OAuth) is free at any volume. **Enterprise SAML/OIDC federation requires the Identity Platform tier**, which has its own free quota (order of tens of MAU/month for SAML/OIDC as of GCP's published pricing) before per-MAU billing kicks in. GOMS is a <50-user internal tool, so this likely stays free or near-free — but this needs verifying against GCP's *current* Identity Platform pricing page at decision time, not assumed from memory, since pricing tiers change. | $0 direct GCP cost — it's app code running on the same Cloud Run service and Postgres instance GOMS already pays for. The only added cost is indirect: a transactional email service for password resets (small, but a new line item that doesn't exist today). |
| **Operational/security burden** | Lower ongoing burden: Google operates the auth service's uptime, patches its own vulnerabilities, and rotates its own signing keys — none of that is GOMS's problem. The burden shifts to *setup*: configuring the SAML/OIDC federation with Amnex's IdP is a one-time integration that needs Amnex IT's active participation (metadata exchange, redirect URI allow-listing, claims mapping) and typically the most fragile part to debug if misconfigured. | Higher ongoing burden, entirely on GOMS: password hashing must be done correctly (bcrypt/argon2, correct cost factor), the reset-flow is a real attack surface (token guessability, expiry, email-enumeration on "forgot password"), and the signing secret becomes a new sensitive credential GOMS must protect and rotate. No Amnex IT dependency, so *setup* burden is lower and entirely within GOMS's control. |

---

## What this doesn't decide

Both options still land on the same §1.3 role model (`user`/`admin`, unchanged) and the same §1.2 conclusion (no IAP, no load balancer) — this comparison only changes *who authenticates the credential and issues the token*, not the authorization/role layer built on top of it in tRPC. Whichever option is chosen, §1.4's items 3-6 (tRPC middleware, `protectedProcedure`/`adminProcedure`, incremental router migration, removing Cloud Run's `allUsers` grant once auth ships) apply essentially unchanged — only item 1 (the `users` table) and item 2 (`login`/token issuance) differ between A and B.

---

## What's needed from Amnex IT before this can be decided

These are facts, not implementation questions — nothing below commits to building anything:

1. **Does Amnex have a corporate identity provider today**, and if so which one — Microsoft 365/Entra ID, Google Workspace, Okta, or something else? (This is the single fact that determines whether Option A is even available. If the answer is "no," Option A isn't meaningfully on the table and this becomes a much shorter decision.)
2. **If yes: does that IdP support SAML 2.0 or OIDC federation** to an external service, and who at Amnex IT can configure that side (metadata exchange, redirect URI registration, claims/attribute mapping)? GCIP needs a cooperating admin on the IdP side, not just its existence.
3. **If yes: does the IdP expose a role/group claim** GOMS could map to `user`/`admin` (e.g. an Azure AD security group), or would GOMS still need to manage its own role assignment independent of any group membership?
4. **Is there an existing precedent** — do any other internal Amnex tools already federate to this IdP? If so, that integration is a template (redirect URIs, claims shape) rather than a first-of-its-kind setup, which meaningfully lowers Option A's setup risk.
5. **Does Amnex IT's policy require or prefer SSO for internal tools** (a security/compliance stance), or is this purely GOMS's call? If there's a standing policy, that may settle the decision regardless of the cost/complexity trade-offs above.
6. **If MFA is already enforced at the IdP level**, confirm that — it changes Option A's MFA row above from "possible" to "already covered for free."

---

## Explicitly not decided here

No recommendation is made between A and B in this document, on purpose — the deciding fact (question 1 above) isn't yet known, and recommending before it lands would mean guessing at Amnex's IT environment rather than reasoning from it. Once the answer comes back, the choice is likely to fall out directly: a confirmed, federatable corporate IdP points at Option A; no IdP (or an IdP Amnex doesn't want to open up for a small internal tool) points at Option B, using §1.4's existing sketch essentially as written.

**Stopping here per instruction — waiting for the Amnex IT answers above before either implementing or making the identity decision.**
