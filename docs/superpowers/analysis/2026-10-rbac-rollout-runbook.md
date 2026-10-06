# RBAC rollout runbook

Spec: [2026-10-06-rbac-design.md](../specs/2026-10-06-rbac-design.md) · Plan: [2026-10-06-rbac-implementation-plan.md](../plans/2026-10-06-rbac-implementation-plan.md)

`RBAC_MODE` is `off` (default) | `shadow` | `enforce`, read only while `AUTH_ENFORCEMENT_ENABLED` is `"true"`. `off` is an exact no-op, so
deploying this code is a deliberate no-op release. **Nothing in this runbook has been run.** Every step that changes an
environment needs your explicit approval; the production flip needs its own, separate approval.

## 0. Prerequisite — the two System Admin accounts

System Admin membership is exactly the `ADMIN_ALLOWED_EMAILS` Cloud Run variable (spec §3.4). It is not derived, not stored in the
database and not editable in the app, so it has to be right in every environment **before** overrides are managed or `RBAC_MODE`
leaves `off`.

| Environment | Today | Needed |
|---|---|---|
| goms-dev | `ADMIN_ALLOWED_EMAILS` lists one account (see `infra/dev/cloudrun.tf`) | both System Admin accounts |
| goms-prod | variable is not set | both System Admin accounts |

Also, while `RBAC_MODE=off` the access API (`access.*`) is gated by this list alone — with it unset in prod, nobody could create the
first override. Setting it is a Cloud Run configuration change (env-only revision) and is **not** part of this plan: it needs your
approval and the second account's exact address. The Admin Data Import list (`ADMIN_IMPORT_ALLOWED_EMAILS`) is separate and must not
be reused or edited for this.

System Admin accounts need no overrides and no org-chart email: they appear as **System Admin (protected)** rows in Role & Access
Management and cannot be granted, changed or removed there.

## 1. Deploy with RBAC off (no-op release)

1. Run the migrations through the `goms-migrate` job: `1790800000000_rbac-role-overrides`, `1790900000000_rbac-created-by-and-email-indexes`,
   `1791000000000_rbac-seen-users`. They are additive (a table, nullable columns, indexes) and safe with `off`.
2. Deploy the API and hosting with `RBAC_MODE=off`. Expect no behaviour change: the 18 public queries stay public, every procedure behaves as before.

## 2. Backfill

1. Fill `org_people.email` for every person (the seed has none) and make sure every Sales person has a roster row with an official email.
2. In **Role & Access Management** (`/admin/access`, usable while RBAC is off) create overrides for: the CEO, CFO and CE&TO (CXO), every Finance, IT and
   Delivery user, and anyone whose role cannot be derived. System Admin is never an override.
3. Use **Needs attention** until no person who should have access shows `No email`, `No role` or `Duplicate email`. Users who signed in and resolved to
   no role appear once RBAC is in `shadow`/`enforce` (they are recorded by `auth.me`).

## 3. Shadow on goms-dev

Set `RBAC_MODE=shadow` (env-only revision change). Nothing is blocked; every would-be denial is logged as JSON. Cloud Logging filter:

```
jsonPayload.event="rbac.would_deny"
```

Group by `jsonPayload.email` and `jsonPayload.path`; also read `jsonPayload.module` / `atom` / `message`. Review for a few working days. Typical
causes: a missing email or override, a person on the wrong role, or a matrix cell that needs a code-reviewed change.

## 4. Fix and repeat

Fix gaps through overrides, emails or reviewed code changes (the matrix is code, spec §9). Repeat step 3 until the log is quiet for real work.

## 5. Enforce on goms-dev

Set `RBAC_MODE=enforce`. Click through each role (Sales, Pre-sales, Bid, Legal, CXO, Delivery, IT, Finance) and a System Admin. Confirm: a Sales user's stage
edit is refused with a normal "You don't have permission…" message and **no** sign-in dialog; SKU cost and floor price show "Restricted" for roles without them; a
System Admin can do everything except write a Solution Lead.

## 6. Production

Repeat 1–5 on goms-prod, in that order, **only after you explicitly approve each production step**, the `RBAC_MODE` flip last and separately.

## 7. Rollback

Set `RBAC_MODE=off` (an env-only revision change, the same mechanism as the other auth flags). `EMERGENCY_READ_ONLY` stays independent and unchanged.

## 8. Behaviour changes to expect at `enforce`

- A signed-out visitor to Home or Map gets the existing sign-in prompt instead of the page loading (the 18 formerly-public queries now need a verified `@amnex.com` login). `health.check` stays public.
- A signed-in user with no role sees "No role assigned" and Geography only.
- Roles that cannot see SKU cost or floor price get `null` plus `maskedFields` from the server; margin and "Below Cost" are hidden for them.
- Solution Lead is read-only for every role, System Admin included.
