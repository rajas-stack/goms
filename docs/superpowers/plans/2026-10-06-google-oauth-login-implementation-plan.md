# Google OAuth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side Google OAuth login (web + Android) that issues GOMS-signed Bearer sessions, behind `AUTH_PROVIDER=firebase|both|oauth`, so the verified `@amnex.com` email feeds RBAC exactly as the Firebase email does today.

**Architecture:** A new `apps/api/src/auth/oauth/` module owns the Google authorization-code flow (state + PKCE + nonce toward Google), a one-time GOMS exchange code, rotating refresh tokens stored hashed in Postgres (atomic compare-and-set), and a 15-minute HS256 access JWT. `verifyIdentity` replaces `verifyFirebaseToken` at its six call sites and returns the same `{uid, email}`, so RBAC, allow-lists and Admin Data Import are untouched. On the client a small `src/lib/auth/` facade hides Firebase vs. the new session; `VITE_AUTH_PROVIDER` picks one at build time. On Android the app is a **thin shell that loads the hosted GOMS web app** (approved thin-shell architecture): sign-in runs in the system browser, returns through the HTTPS callback and a per-flavor deep link, and tokens live in Android secure storage. Native work for that shell is in Phase C; a normal web deploy updates installed apps without a new APK.

**Tech Stack:** TypeScript (NodeNext ESM), Fastify 5, tRPC 11, Postgres via node-pg-migrate, `jose` 6 (new), Vitest 2 (real shared Postgres for API tests, `fileParallelism: false`), React 18, Vite, Capacitor 8 (`@capacitor/browser`, `@aparajita/capacitor-secure-storage`, new).

**Spec:** [docs/superpowers/specs/2026-10-06-google-oauth-login-design.md](../specs/2026-10-06-google-oauth-login-design.md) (final, approved 2026-10-06). Read it first; this plan implements it and argues from it.

**Android shell design:** [docs/superpowers/specs/2026-10-06-android-thin-shell-design.md](../specs/2026-10-06-android-thin-shell-design.md) (approved architecture; Q1, Q3, Q4 decided, **Q2 OPEN**). Phase C implements its native part. The OAuth security model is unchanged; the one additive item is the per-environment `OAUTH_APP_SCHEME` (thin-shell §6.4).

## Global Constraints

Copied from the spec / the owner's instructions. Every task's requirements include these.

- `AUTH_PROVIDER=firebase` is the default; the first deployment is behaviourally a **no-op** (OAuth routes answer 404, Firebase behaves exactly as today).
- Dev uses `both` before any cutover to `oauth`. **Production is completely out of scope** for this plan.
- **No Firebase removal** in the first OAuth release. No RBAC redesign or permission change.
- **Never put access or refresh tokens in URLs.** The only credential that may appear in a URL is the one-time exchange code (60 s, single use), stripped from history immediately.
- **Exchange codes are not PKCE-bound** and are never described as such. PKCE protects only the API ↔ Google hop (server-held verifier). Exchange-code protection = 256-bit random + SHA-256 hashed at rest + 60-second expiry + atomic single use + bound to verified identity, `family_id` and client kind (`web`|`app`). No client-side PKCE is added.
- **Refresh rotation is atomic**: one conditional `UPDATE … WHERE refresh_hash=$1 AND replaced_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING …`; zero rows ⇒ not rotated; reuse of an already-replaced token revokes the whole `family_id`.
- **Do not put RBAC roles/permissions in JWT claims.** Access-token claims are exactly `iss=goms`, `aud=goms-api`, `sub=<uid>`, `email`, `sid` (= `family_id`), `iat`, `exp`.
- Access token **15 minutes**, refresh token **30 days** (rotating, reuse detection). Both configurable (`AUTH_ACCESS_TTL_SECONDS`, `AUTH_REFRESH_TTL_DAYS`).
- Google side: server-side `state`, PKCE (S256), `nonce`, **exact** redirect-URI match, `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud` = client id, `exp`, `email_verified === true`, `@amnex.com` enforced **server-side** (`hd=amnex.com` is only a hint). `alg` must be `RS256`.
- Sessions travel as `Authorization: Bearer`; no cookies. Android refresh token lives in Android-backed secure storage, web refresh token in `localStorage`, access token only in memory. **Inside the Android shell tokens are never written to WebView `localStorage`, cookies or Capacitor Preferences, and there is no `localStorage` fallback**: if secure storage is unavailable the shell refuses sign-in and asks the user to update the app.
- Web: single-flight refresh within a tab **and** `navigator.locks` across tabs.
- Secrets (`GOOGLE_OAUTH_CLIENT_SECRET`, `AUTH_SESSION_SECRET`) never reach git, the browser bundle, logs or error responses. OAuth failures return generic messages / reason codes only.
- **Android thin shell:** the production app loads the hosted GOMS origin; it does not bundle a second copy of the React app. Capacitor's development-only `server.url` is **never** used as a shortcut: `capacitor.config.ts` and the generated `capacitor.config.json` contain no `server` block, `server.url`, `cleartext`, wildcard `allowNavigation` or `androidScheme: http` (a guard test fails the build otherwise, Task 15). The remote origin is a per-flavor **compile-time constant** (`BuildConfig.GOMS_ORIGIN`) validated at start, and an exact-origin navigation policy decides what the WebView may load.
- The WebView only ever shows the pinned origin. Google sign-in runs **only in the system browser**; `/api/oauth/**` main-frame navigations are never loaded in the WebView.
- Prod and dev APKs install side by side: `applicationId` `com.gorms.app` / `com.gorms.app.dev`, deep-link scheme `com.gorms.app` / `com.gorms.app.dev` (per-environment API setting `OAUTH_APP_SCHEME`, allow-list of exactly those two). Never an arbitrary scheme.
- **Native first, web second.** Web code decides native availability only through `hasCapability` (Task 11), never `Capacitor.isNativePlatform()`.
- **Q2 (stranded local data in existing installs) is OPEN** and gates only the production APK; this plan does not decide it and the dev flavor cannot affect an existing install.
- Local/dev environment values, Secret Manager, migrations, deploys and Android builds are **separate approvals** (see the rollout checklist). **Executing this plan writes code and runs only local tests; it does not touch goms-dev or goms-prod.**
- The three local-only RBAC rules still apply while implementing: do not push to GitLab, do not touch `ADMIN_ALLOWED_EMAILS` / `RBAC_MODE`, never run API tests against anything but the local test DB.

## Plan-level decisions beyond the spec text (owner may veto)

1. `OAUTH_WEB_ORIGIN` (optional env): the origin the web callback redirects back to. Default = origin of `GOOGLE_OAUTH_REDIRECT_URI`, which is correct on Firebase Hosting (same origin). Needed only for local dev (API on `:8080`, Vite on `:5173`). It is config, never user input; it must equal the redirect-URI origin, `http://localhost:5173`, or a `CORS_ALLOWED_ORIGINS` entry, so it cannot become an open redirect.
2. OAuth route failures redirect (web) or deep-link (app) with a **reason code only** (`state`, `domain`, `unverified`, `google`, `denied`), never details.
3. The oauth session shows the **email** as the display name and a generic avatar (the spec's token/response contract carries no name or photo). Adding profile data would need a spec change; not done.
4. Refresh-token expiry is sliding (each rotation issues a generation valid for a fresh 30 days).
5. Custom-scheme deep links (`<scheme>://auth`) are used for the Android return (spec D6). Any app can register the same scheme; the 60-second single-use exchange code is the control, and each flavor accepts only its own scheme. Verified Android App Links would be stronger and are noted as a future hardening, not built here.
6. **`OAUTH_APP_SCHEME`** (API env, approved with Q1): the scheme the callback page deep-links to. Default `com.gorms.app`; allow-list `com.gorms.app`, `com.gorms.app.dev`; set per API deployment (dev API `com.gorms.app.dev`). It is additive to the OAuth spec and changes none of its security properties.
7. **`src/lib/nativeShell.ts`** (`isGomsShell`, `shellVersion`, `shellScheme`, `hasCapability`) is created here in Task 11 because the OAuth client needs it first. If the thin-shell web phase (P2) has already created it, reuse that file and only add what is missing. Migrating `AppLayout.tsx` / `file-export.ts` off `Capacitor.isNativePlatform()`, the update banner, `shell-manifest.json` and the CSP report-only header are thin-shell P2 items and are **not** in this plan.
8. The Android web code reads its API/origin from `window.location.origin` (the WebView can only ever be on the pinned origin), never from a value the page supplies.

## Android thin shell: native changes and the release boundary

The shell loads the hosted web app, so most OAuth work ships as a normal web or API release. Only the items in the first table need a new APK.

**Native Android changes required (new APK)**

| # | Change | Why OAuth needs it | Where |
|---|---|---|---|
| N1 | Gradle `prod` / `dev` flavors: `applicationId` (`com.gorms.app` / `com.gorms.app.dev`), per-flavor `GOMS_ORIGIN`, `GOMS_SCHEME`, manifest placeholder `gomsScheme`; `versionCode` 2 | Pins the one origin the WebView may show; lets dev and prod coexist with separate deep-link schemes | `android/app/build.gradle` |
| N2 | `MainActivity` builds the pinned `CapConfig` in native code (`setServerUrl(GOMS_ORIGIN)`, no allow-navigation, error page, UA token `GOMSShell/<versionCode> GOMSScheme/<scheme>`); refuses to start on an invalid origin | Gives the hosted page the Capacitor bridge (the only mechanism that does) without any editable `server.url` | `MainActivity.java` |
| N3 | `NavigationPolicy` (pure Java) + `GomsWebViewClient` | Exact-origin navigation: Google and every other host leave the WebView; `/api/oauth/**` is never loaded in it; look-alike hosts, `http`, `intent:`, `file:` are blocked | new Java files + JUnit tests |
| N4 | Manifest: deep-link intent filter `${gomsScheme}://auth`, `allowBackup=false`, `usesCleartextTraffic=false`, network security config, data-extraction rules | Receives the one-time code; keeps tokens out of backups; no cleartext | `AndroidManifest.xml`, `res/xml/*` |
| N5 | Plugins `@capacitor/browser` and `@aparajita/capacitor-secure-storage` (with `@capacitor/app` already present) | System-browser sign-in; Keystore-backed refresh-token storage; `appUrlOpen` | `package.json`, Gradle autolink via `cap sync` |
| N6 | `webDir` becomes `android-shell/www` containing only `offline.html`; `capacitor.config.ts` has no `server` block | No second copy of the React app in the APK; offline page when the origin is unreachable | `capacitor.config.ts`, `android-shell/www/offline.html` |
| N7 | Dev flavor resources (`app_name` "GORMS Dev") | Tell the two apps apart on one device | `android/app/src/dev/res/values/strings.xml` |

**Web or API release only (no APK rebuild)**

| Change | Release |
|---|---|
| Everything under `src/` (OAuth client, session, `nativeShell.ts`, sign-in UI, bootstrap) | Hosting deploy |
| `/api/oauth/*` routes, the callback page HTML, `verifyIdentity`, migration, the **value** of `OAUTH_APP_SCHEME` within the allow-list | API deploy / env-only revision |
| `AUTH_PROVIDER`, secrets, `VITE_AUTH_PROVIDER` | env / build variables |
| `firebase.json` headers (CSP report-only → enforce), `shell-manifest.json` | Hosting deploy |

**Rules that keep the two honest**
- Changing the deep-link **scheme or host**, the pinned origin, the navigation policy, a plugin, the manifest or permissions is a native release. Changing what the callback page *contains* (not the scheme) is not.
- Ordering: **native first, web second.** The web build that depends on `secureStorage` / `browser` / `appLinks` is gated by `hasCapability`; an older shell that lacks them gets "update the app" at sign-in, never a degraded token store.
- Existing installs: the prod flavor upgrades `com.gorms.app` in place and moves its origin from `https://localhost` to the hosted site, which strands WebView storage. **Q2 is open**, so no prod APK is released to an existing install until it is resolved (conditional gate in the rollout checklist). The dev flavor has a different `applicationId`, installs beside the old app, and cannot strand anything.
- No CORS entry: the shell is same-origin with the API, so `https://localhost` is **not** added to `CORS_ALLOWED_ORIGINS`.

---

## Review Focus

Failure modes the spec implies but no feature task would otherwise exercise, most likely first. Each has a test in the task that owns the code.

1. **Two tabs (or a batch of requests) refresh at once** → exactly one rotation; a loser must not silently sign everyone out when the client lock is working. (Tasks 5, 10: concurrent refresh on real Postgres; client single-flight + `navigator.locks`.)
2. **Network failure during refresh must not wipe the stored refresh token** (offline ≠ revoked); only an explicit 401 clears it. (Task 10.)
3. **Callback visited twice / back button / pasted URL** → `state` is consumed once; the second visit gets a reason-code failure and **no** code or token. (Tasks 4, 7.)
4. **Signing in with a non-`@amnex.com` or unverified Google account** → no exchange code is ever created; the UI shows a clear "not an @amnex.com account" message, not a blank dialog. (Tasks 6, 7, 12.)
5. **`return_to` tricks**: absolute URLs, `//host`, backslashes, control characters, existing query/hash, `auth_code` already present. (Tasks 2, 7, 12.)

6. **Inside the shell, an old or incomplete APK must fail closed**: no secure storage ⇒ sign-in refuses with "update the app" and nothing is written to `localStorage`. (Tasks 11, 13.)
7. **Look-alike and hostile navigations** in the WebView (`goms-prod.web.app.evil.com`, `user@host` tricks, other ports, `http`, `intent:`, `/api/oauth/*` paths including encoded and dot-segment forms). (Task 14 JUnit.)
8. **Deep-link input**: another flavor's scheme, extra or repeated parameters, wrong code format, unknown error reason. (Task 13.)

Known residual risks, accepted by the spec and recorded in the plan: custom-scheme hijack on Android (decision 5); access tokens are not individually revocable (≤15 min); the hosted origin has plugin access in the shell (thin-shell §7; CSP report-only → enforce is the web-side control and is outside this plan).

---

## File Structure

**API — create**
- `apps/api/migrations/1791100000000_oauth-sessions.sql` — `auth_flows`, `auth_exchange_codes`, `auth_sessions`.
- `apps/api/src/auth/oauth/config.ts` — `authProvider()`, accept helpers, `oauthConfig()`, `sessionKey()`.
- `apps/api/src/auth/oauth/crypto.ts` — `randomToken`, `sha256Hex`, `pkceChallenge`.
- `apps/api/src/auth/oauth/redirect.ts` — `safeReturnTo`, `parseClient`, `webRedirectUrl`.
- `apps/api/src/auth/oauth/accessToken.ts` — `signAccessToken`, `verifyAccessToken`, `isGomsToken`.
- `apps/api/src/auth/oauth/flows.ts` — `createFlow`, `consumeFlow`.
- `apps/api/src/auth/oauth/exchangeCodes.ts` — `createExchangeCode`, `redeemExchangeCode`.
- `apps/api/src/auth/oauth/sessions.ts` — `startSession`, `rotateRefreshToken`, `revokeFamilyByRefreshToken`, `SessionError`.
- `apps/api/src/auth/oauth/googleClient.ts` — `GoogleGateway`, `buildAuthUrl`, `verifyGoogleIdToken`, real `googleGateway`.
- `apps/api/src/auth/oauth/routes.ts` — Fastify routes under `/api/oauth/`.
- `apps/api/src/testHelpers/oauthTestHelpers.ts` — env, DB cleanup, GOMS context, fake Google.
- (`config.ts` also exports `appScheme()` / `APP_SCHEMES`; `routes.ts` uses them for the app callback page.)
- Tests next to each module (`*.test.ts`).

**API — modify**
- `apps/api/src/auth/identity.ts` — add `verifyIdentity`.
- `apps/api/src/trpc.ts`, `apps/api/src/auth/rbac/guard.ts`, `apps/api/src/routers/auth.ts`, `apps/api/src/auth/verifyAdminImportToken.ts` — call `verifyIdentity`.
- `apps/api/src/app.ts` — register OAuth routes; `BuildAppOptions.oauth`.
- `apps/api/package.json` — `jose`.

**Client — create**
- `src/lib/auth/types.ts`, `firebaseProvider.ts`, `oauthProvider.ts`, `authApi.ts` (picks the provider), `session.ts`, `authFetch.ts`, `bootstrap.ts`, `native.ts` (Android only, lazy-loaded), `stores.ts`, `errors.ts`, `useAuthUser.ts`, `index.ts` (re-exports); `src/lib/nativeShell.ts`; `src/lib/shell/androidConfigGuard.test.ts` (+ `*.test.ts[x]`).

**Android native — create/modify (Phase C)**
- Create: `android/app/src/main/java/com/gorms/app/NavigationPolicy.java`, `GomsWebViewClient.java`; `android/app/src/test/java/com/gorms/app/NavigationPolicyTest.java`; `android/app/src/main/res/xml/network_security_config.xml`, `data_extraction_rules.xml`; `android/app/src/dev/res/values/strings.xml`; `android-shell/www/offline.html`.
- Modify: `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/gorms/app/MainActivity.java`, `capacitor.config.ts`, `android/README.md`.

**Client — modify**
- `src/data/remote/authHeaders.ts`, `src/data/remote/repository.ts` (`fetch`), `src/modules/admin-data-import/api.ts`, `src/components/AuthStatus.tsx`, `src/components/AuthPromptDialog.tsx`, `src/modules/admin-data-import/auth/AdminImportAuthGate.tsx`, `src/modules/admin-data-import/AdminImportModal.tsx`, `src/lib/authPrompt.ts`, `src/main.tsx`, `src/vite-env.d.ts`, `.env.example`, `package.json`.

**Docs/config — create/modify**
- `apps/api/.env.oauth.example`, `.gitignore` (exception), `.env.example`.

---

## Execution environment (read before Task 0)

- Implement on branch **`feat/google-oauth`** in a **separate worktree** (`../goms-oauth`). The main working folder must stay on `feat/rbac` (the dev deployment is commit `d31f9dd9`; later commits on that branch are docs only).
- All API tests run against the **local** Postgres (`apps/api/.env` → `localhost`). Task 0 adds a guard that aborts on any non-local `DATABASE_URL`.
- Define once per shell:

```bash
apitest() { (cd apps/api && set -a && . ./.env && set +a && case "$DATABASE_URL" in *localhost*|*127.0.0.1*) npx vitest run "$@";; *) echo "ABORT: DATABASE_URL is not local"; return 1;; esac); }
```

---

### Task 0: Worktree, dependencies, baseline

**Files:** none committed.

- [ ] **Step 1: Create the worktree on the spec branch**

```bash
cd /c/Users/rajas.saji/Desktop/goms
git worktree add ../goms-oauth feat/google-oauth
cd ../goms-oauth && git log --oneline -3
# One branch can be checked out in only one worktree: if ../goms-oauth-docs still exists, run `git worktree remove ../goms-oauth-docs` first.
```
Expected: top commits are the two spec commits, then `d31f9dd9`.

- [ ] **Step 2: Install and copy the ignored env files** (never commit them)

```bash
npm ci
cp ../goms/apps/api/.env apps/api/.env
cp ../goms/apps/api/.env.oauth apps/api/.env.oauth
cp ../goms/.env.local .env.local
npm --workspace packages/domain run build
```

- [ ] **Step 3: Define `apitest` (above) and prove it only runs against a local DB**

```bash
apitest src/auth/identity.test.ts
```
Expected: PASS. If it prints `ABORT: DATABASE_URL is not local`, stop and fix `apps/api/.env`.

- [ ] **Step 4: Record the baseline**

```bash
apitest                      # whole API suite
npx vitest run               # frontend unit
npx vitest run --config vitest.component.config.ts
```
Expected (from the RBAC baseline `d31f9dd9`): API 68 files / 973 tests, unit 65 files / 686 tests, component 93 files / 714 tests, all passing. Write the three counts down; later tasks must only add to them.

---

## Phase A — API

### Task 1: Additive migration `auth_flows`, `auth_exchange_codes`, `auth_sessions`

**Files:**
- Create: `apps/api/migrations/1791100000000_oauth-sessions.sql`
- Test: `apps/api/src/auth/oauth/migrations.test.ts`

**Interfaces:**
- Produces: three tables used by Tasks 4–5 exactly as defined below. No existing table changes.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/auth/oauth/migrations.test.ts
import { describe, expect, it } from 'vitest'
import { pool } from '../../db.js'

const exists = async (t: string) => (await pool.query('SELECT to_regclass($1) AS r', [t])).rows[0].r !== null
const isoIn = (s: number) => `now() + interval '${s} seconds'`

describe('OAuth migration 1791100000000', () => {
  it('creates the three tables', async () => {
    for (const t of ['auth_flows', 'auth_exchange_codes', 'auth_sessions']) expect(await exists(t), t).toBe(true)
  })
  it('auth_sessions.refresh_hash is unique (the compare-and-set and reuse lookup rely on it)', async () => {
    const fam = '11111111-1111-1111-1111-111111111111'
    const ins = (h: string) => pool.query(
      `INSERT INTO auth_sessions (uid, email, refresh_hash, family_id, expires_at) VALUES ('g:t','mig@amnex.com',$1,$2,${isoIn(60)})`, [h, fam])
    await ins('hash-a')
    await expect(ins('hash-a')).rejects.toThrow(/unique|duplicate/i)
    await pool.query(`DELETE FROM auth_sessions WHERE email='mig@amnex.com'`)
  })
  it('rejects an unknown client kind and a non-normalised email', async () => {
    await expect(pool.query(
      `INSERT INTO auth_flows (state_hash, code_verifier, nonce, client, expires_at) VALUES ('s','v','n','tablet',${isoIn(60)})`)).rejects.toThrow(/check/i)
    await expect(pool.query(
      `INSERT INTO auth_exchange_codes (code_hash, uid, email, family_id, client, expires_at)
       VALUES ('c','g:t','Mixed@Amnex.com','11111111-1111-1111-1111-111111111111','web',${isoIn(60)})`)).rejects.toThrow(/check/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `apitest src/auth/oauth/migrations.test.ts`
Expected: FAIL (`auth_flows` etc. do not exist).

- [ ] **Step 3: Write the migration**

```sql
-- apps/api/migrations/1791100000000_oauth-sessions.sql
-- Up Migration

-- Google OAuth login (spec 2026-10-06-google-oauth-login-design.md §4.4). Purely additive: no existing table changes.

-- One row per in-flight authorization request. Consumed atomically (DELETE ... RETURNING) by the callback.
CREATE TABLE auth_flows (
  state_hash    TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,           -- server-held PKCE verifier (API <-> Google hop only)
  nonce         TEXT NOT NULL,
  client        TEXT NOT NULL CHECK (client IN ('web', 'app')),
  return_to     TEXT NOT NULL DEFAULT '/',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_flows_expires_idx ON auth_flows (expires_at);

-- The GOMS one-time exchange code, hash only. NOT PKCE-bound: bound to the verified identity, family and client kind.
CREATE TABLE auth_exchange_codes (
  code_hash  TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  email      TEXT NOT NULL CHECK (email = lower(btrim(email))),
  family_id  UUID NOT NULL,
  client     TEXT NOT NULL CHECK (client IN ('web', 'app')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX auth_exchange_codes_expires_idx ON auth_exchange_codes (expires_at);

-- One row per refresh-token generation; family_id groups the generations of one sign-in.
CREATE TABLE auth_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid          TEXT NOT NULL,
  email        TEXT NOT NULL CHECK (email = lower(btrim(email))),
  refresh_hash TEXT NOT NULL UNIQUE,
  family_id    UUID NOT NULL,
  replaced_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  user_agent   TEXT
);
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);
CREATE INDEX auth_sessions_email_idx  ON auth_sessions (email);

-- Down Migration

DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_exchange_codes;
DROP TABLE IF EXISTS auth_flows;
```

- [ ] **Step 4: Apply to the LOCAL test DB only, prove down/up, re-run**

```bash
(cd apps/api && set -a && . ./.env && set +a && case "$DATABASE_URL" in *localhost*|*127.0.0.1*) npx node-pg-migrate up && npx node-pg-migrate down && npx node-pg-migrate up;; *) echo ABORT; exit 1;; esac)
apitest src/auth/oauth/migrations.test.ts
```
Expected: migrate up/down/up succeed; test PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/1791100000000_oauth-sessions.sql apps/api/src/auth/oauth/migrations.test.ts
git commit -m "feat(oauth): additive migration for auth_flows, auth_exchange_codes, auth_sessions"
```

---

### Task 2: Pure helpers — config, crypto, redirect

**Files:**
- Create: `apps/api/src/auth/oauth/config.ts`, `crypto.ts`, `redirect.ts`
- Test: `apps/api/src/auth/oauth/config.test.ts`, `crypto.test.ts`, `redirect.test.ts`

**Interfaces:**
- Produces (used by every later API task):
  - `type AuthProvider = 'firebase' | 'both' | 'oauth'`; `authProvider(): AuthProvider`; `oauthEnabled(): boolean` (provider ≠ firebase); `gomsAccepted(): boolean` (≠ firebase); `firebaseAccepted(): boolean` (≠ oauth).
  - `APP_SCHEMES = ['com.gorms.app', 'com.gorms.app.dev'] as const`; `appScheme(): (typeof APP_SCHEMES)[number]` (from `OAUTH_APP_SCHEME`, default `com.gorms.app`, throws `OAuthConfigError` for anything outside the allow-list).
  - `class OAuthConfigError extends Error`; `sessionKey(): Uint8Array` (≥ 32 bytes or throws); `interface OAuthConfig { clientId; clientSecret; redirectUri; webOrigin; accessTtlSeconds; refreshTtlDays }`; `oauthConfig(): OAuthConfig`.
  - `randomToken(bytes = 32): string` (base64url); `sha256Hex(v: string): string`; `pkceChallenge(verifier: string): string`.
  - `type ClientKind = 'web' | 'app'`; `parseClient(raw: unknown): ClientKind | null`; `safeReturnTo(raw: unknown): string`; `webRedirectUrl(webOrigin: string, returnTo: string, params: Record<string, string>): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/auth/oauth/crypto.test.ts
import { describe, expect, it } from 'vitest'
import { pkceChallenge, randomToken, sha256Hex } from './crypto.js'

describe('crypto helpers', () => {
  it('randomToken is url-safe, 43 chars for 32 bytes, and never repeats', () => {
    const a = randomToken(), b = randomToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })
  it('sha256Hex is the standard hex digest', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('pkceChallenge matches the RFC 7636 S256 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})
```

```ts
// apps/api/src/auth/oauth/redirect.test.ts
import { describe, expect, it } from 'vitest'
import { parseClient, safeReturnTo, webRedirectUrl } from './redirect.js'

describe('safeReturnTo', () => {
  it.each(['/', '/sales/roster', '/bid-tracker?sheet=pipeline#top', '/a%2Fb'])('keeps %s', (p) => expect(safeReturnTo(p)).toBe(p))
  it.each([
    undefined, null, '', 'sales', '//evil.example', '///evil', 'https://evil.example', 'javascript:alert(1)',
    '/\\evil', '/a\\b', '/path\u0000x', '/path\nx', '/\t/evil', 'x'.repeat(600), 7,
  ])('falls back to / for %j', (p) => expect(safeReturnTo(p as unknown)).toBe('/'))
})

describe('parseClient', () => {
  it('accepts only web and app', () => {
    expect(parseClient('web')).toBe('web'); expect(parseClient('app')).toBe('app')
    for (const v of ['', 'WEB', 'tablet', undefined, null, 1]) expect(parseClient(v as unknown)).toBeNull()
  })
})

describe('webRedirectUrl', () => {
  const origin = 'https://goms-dev.firebaseapp.com'
  it('appends params to the path, preserving existing query and hash', () => {
    expect(webRedirectUrl(origin, '/bid-tracker?sheet=x#top', { auth_code: 'C1' }))
      .toBe('https://goms-dev.firebaseapp.com/bid-tracker?sheet=x&auth_code=C1#top')
  })
  it('replaces an auth_code already in return_to instead of stacking two', () => {
    expect(webRedirectUrl(origin, '/?auth_code=OLD', { auth_code: 'NEW' })).toBe('https://goms-dev.firebaseapp.com/?auth_code=NEW')
  })
  it('can never leave the configured origin', () => {
    expect(new URL(webRedirectUrl(origin, '//evil.example/x', { auth_code: 'C' })).origin).toBe(origin)
  })
})
```

```ts
// apps/api/src/auth/oauth/config.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_SCHEMES, OAuthConfigError, appScheme, authProvider, firebaseAccepted, gomsAccepted, oauthConfig, oauthEnabled, sessionKey } from './config.js'

const KEYS = ['AUTH_PROVIDER', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'AUTH_SESSION_SECRET',
  'OAUTH_WEB_ORIGIN', 'AUTH_ACCESS_TTL_SECONDS', 'AUTH_REFRESH_TTL_DAYS', 'CORS_ALLOWED_ORIGINS', 'OAUTH_APP_SCHEME']
afterEach(() => { for (const k of KEYS) delete process.env[k]; vi.restoreAllMocks() })
const full = () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'shh'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://goms-dev.firebaseapp.com/api/oauth/google/callback'
  process.env.AUTH_SESSION_SECRET = 'x'.repeat(48)
}

describe('authProvider', () => {
  it('defaults to firebase and treats OAuth as disabled', () => {
    expect(authProvider()).toBe('firebase')
    expect(oauthEnabled()).toBe(false); expect(gomsAccepted()).toBe(false); expect(firebaseAccepted()).toBe(true)
  })
  it.each([['both', true, true], ['oauth', true, false]] as const)('%s', (value, goms, firebase) => {
    process.env.AUTH_PROVIDER = ` ${value.toUpperCase()} `
    expect(authProvider()).toBe(value); expect(gomsAccepted()).toBe(goms); expect(firebaseAccepted()).toBe(firebase)
  })
  it('falls back to firebase (and says so) for an unknown value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.AUTH_PROVIDER = 'okta'
    expect(authProvider()).toBe('firebase')
    expect(warn).toHaveBeenCalled()
  })
})

describe('sessionKey', () => {
  it('requires at least 32 bytes', () => {
    process.env.AUTH_SESSION_SECRET = 'short'
    expect(() => sessionKey()).toThrow(OAuthConfigError)
    process.env.AUTH_SESSION_SECRET = 'y'.repeat(32)
    expect(sessionKey()).toHaveLength(32)
  })
})

describe('oauthConfig', () => {
  it('names the missing variables but never their values', () => {
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'super-secret-value'
    let message = ''
    try { oauthConfig() } catch (e) { message = (e as Error).message }
    expect(message).toMatch(/GOOGLE_OAUTH_CLIENT_ID/)
    expect(message).not.toMatch(/super-secret-value/)
  })
  it('reads a complete configuration with defaults (900 s / 30 d, web origin = redirect origin)', () => {
    full()
    expect(oauthConfig()).toMatchObject({
      clientId: 'cid.apps.googleusercontent.com', webOrigin: 'https://goms-dev.firebaseapp.com', accessTtlSeconds: 900, refreshTtlDays: 30,
    })
  })
  it('accepts configured TTLs and ignores nonsense', () => {
    full(); process.env.AUTH_ACCESS_TTL_SECONDS = '600'; process.env.AUTH_REFRESH_TTL_DAYS = 'abc'
    expect(oauthConfig()).toMatchObject({ accessTtlSeconds: 600, refreshTtlDays: 30 })
  })
  it.each([
    'http://goms-dev.firebaseapp.com/api/oauth/google/callback', // plain http, non-local
    'https://goms-dev.firebaseapp.com/other',                    // wrong path
    'https://goms-dev.firebaseapp.com/api/oauth/google/callback?x=1',
    'not a url',
  ])('rejects redirect URI %s', (uri) => {
    full(); process.env.GOOGLE_OAUTH_REDIRECT_URI = uri
    expect(() => oauthConfig()).toThrow(OAuthConfigError)
  })
  it('allows an http localhost redirect URI for local development', () => {
    full(); process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:8080/api/oauth/google/callback'
    expect(oauthConfig().webOrigin).toBe('http://localhost:8080')
  })
  it('OAUTH_WEB_ORIGIN must be the redirect origin, the Vite origin or a CORS origin — nothing else', () => {
    full()
    process.env.OAUTH_WEB_ORIGIN = 'http://localhost:5173'
    expect(oauthConfig().webOrigin).toBe('http://localhost:5173')
    process.env.OAUTH_WEB_ORIGIN = 'https://evil.example'
    expect(() => oauthConfig()).toThrow(OAuthConfigError)
    process.env.CORS_ALLOWED_ORIGINS = 'https://evil.example'
    expect(oauthConfig().webOrigin).toBe('https://evil.example') // an operator-approved origin is allowed
  })
})

describe('appScheme (per-environment deep-link scheme, Q1)', () => {
  it('defaults to the prod scheme so an unset variable changes nothing', () => {
    expect(appScheme()).toBe('com.gorms.app')
    process.env.OAUTH_APP_SCHEME = '  '
    expect(appScheme()).toBe('com.gorms.app')
  })
  it('accepts exactly the two allowed schemes', () => {
    expect([...APP_SCHEMES]).toEqual(['com.gorms.app', 'com.gorms.app.dev'])
    for (const v of APP_SCHEMES) { process.env.OAUTH_APP_SCHEME = v; expect(appScheme()).toBe(v) }
  })
  it.each(['evil.app', 'com.gorms.app.staging', 'COM.GORMS.APP', 'javascript', 'com.gorms.app://', 'https'])('refuses %s (never an arbitrary scheme)', (v) => {
    process.env.OAUTH_APP_SCHEME = v
    expect(() => appScheme()).toThrow(OAuthConfigError)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `apitest src/auth/oauth/crypto.test.ts src/auth/oauth/redirect.test.ts src/auth/oauth/config.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

```ts
// apps/api/src/auth/oauth/crypto.ts
import { createHash, randomBytes } from 'node:crypto'

/** Cryptographically random, URL-safe. 32 bytes -> 43 chars (also a valid RFC 7636 verifier length). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')

/** Only this hash of a refresh token / exchange code / state is ever stored. */
export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

/** RFC 7636 S256. Used ONLY between the API and Google. */
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')
```

```ts
// apps/api/src/auth/oauth/redirect.ts
export type ClientKind = 'web' | 'app'

export const parseClient = (raw: unknown): ClientKind | null => (raw === 'web' || raw === 'app' ? raw : null)

/** Same-origin relative path only; anything else becomes '/'. */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/'
  try {
    if (new URL(raw, 'https://origin.invalid').origin !== 'https://origin.invalid') return '/'
  } catch {
    return '/'
  }
  return raw
}

/** `webOrigin` + `returnTo` with `params` set on the query. The result can never leave `webOrigin`. */
export function webRedirectUrl(webOrigin: string, returnTo: string, params: Record<string, string>): string {
  const base = new URL(webOrigin)
  const url = new URL(safeReturnTo(returnTo), base)
  if (url.origin !== base.origin) return new URL('/', base).toString()
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}
```

```ts
// apps/api/src/auth/oauth/config.ts
export type AuthProvider = 'firebase' | 'both' | 'oauth'

/** Read on every call so tests (and an env-only Cloud Run revision) take effect without a restart of module state. */
export function authProvider(): AuthProvider {
  const raw = (process.env.AUTH_PROVIDER ?? 'firebase').trim().toLowerCase()
  if (raw === 'both' || raw === 'oauth') return raw
  if (raw !== '' && raw !== 'firebase') console.warn(JSON.stringify({ event: 'auth.invalid_provider', using: 'firebase' }))
  return 'firebase'
}
export const oauthEnabled = (): boolean => authProvider() !== 'firebase'
export const gomsAccepted = (): boolean => authProvider() !== 'firebase'
export const firebaseAccepted = (): boolean => authProvider() !== 'oauth'

export class OAuthConfigError extends Error {}

/** The deep-link scheme this API deployment hands the Android app (thin-shell design §6.4). A fixed allow-list: the dev API sets
 *  `com.gorms.app.dev`, prod leaves it unset. Anything else is a configuration error, never passed through. */
export const APP_SCHEMES = ['com.gorms.app', 'com.gorms.app.dev'] as const
export function appScheme(): (typeof APP_SCHEMES)[number] {
  const raw = (process.env.OAUTH_APP_SCHEME ?? '').trim()
  if (raw === '') return 'com.gorms.app'
  if ((APP_SCHEMES as readonly string[]).includes(raw)) return raw as (typeof APP_SCHEMES)[number]
  throw new OAuthConfigError('OAUTH_APP_SCHEME is not an allowed value')
}

/** HS256 signing key. Needed to verify GOMS tokens in `both`/`oauth`, so it does not require the Google credentials. */
export function sessionKey(): Uint8Array {
  const raw = process.env.AUTH_SESSION_SECRET ?? ''
  if (Buffer.byteLength(raw) < 32) throw new OAuthConfigError('AUTH_SESSION_SECRET must be at least 32 bytes')
  return new TextEncoder().encode(raw)
}

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Where the web callback sends the browser back to (default: the redirect URI's own origin). */
  webOrigin: string
  accessTtlSeconds: number
  refreshTtlDays: number
}

const positive = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function oauthConfig(): OAuthConfig {
  const required = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'AUTH_SESSION_SECRET']
  const missing = required.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) throw new OAuthConfigError(`Missing configuration: ${missing.join(', ')}`)
  sessionKey()

  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI!.trim()
  let redirect: URL
  try { redirect = new URL(redirectUri) } catch { throw new OAuthConfigError('GOOGLE_OAUTH_REDIRECT_URI is not a URL') }
  const local = redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1'
  if (redirect.protocol !== 'https:' && !(local && redirect.protocol === 'http:')) {
    throw new OAuthConfigError('GOOGLE_OAUTH_REDIRECT_URI must be https (http only for localhost)')
  }
  if (redirect.pathname !== '/api/oauth/google/callback' || redirect.search || redirect.hash) {
    throw new OAuthConfigError('GOOGLE_OAUTH_REDIRECT_URI must be exactly <origin>/api/oauth/google/callback')
  }

  const cors = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  const allowedWebOrigins = new Set([redirect.origin, 'http://localhost:5173', ...cors])
  const webOrigin = (process.env.OAUTH_WEB_ORIGIN?.trim() || redirect.origin).replace(/\/$/, '')
  if (!allowedWebOrigins.has(webOrigin)) throw new OAuthConfigError('OAUTH_WEB_ORIGIN is not an allowed origin')

  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    redirectUri,
    webOrigin,
    accessTtlSeconds: positive(process.env.AUTH_ACCESS_TTL_SECONDS, 900),
    refreshTtlDays: positive(process.env.AUTH_REFRESH_TTL_DAYS, 30),
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `apitest src/auth/oauth/crypto.test.ts src/auth/oauth/redirect.test.ts src/auth/oauth/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/oauth/config.ts apps/api/src/auth/oauth/crypto.ts apps/api/src/auth/oauth/redirect.ts apps/api/src/auth/oauth/config.test.ts apps/api/src/auth/oauth/crypto.test.ts apps/api/src/auth/oauth/redirect.test.ts
git commit -m "feat(oauth): AUTH_PROVIDER config, crypto helpers and safe return_to handling"
```

---

### Task 3: Access JWT (sign / verify), `jose` dependency, test helpers

**Files:**
- Modify: `apps/api/package.json` (adds `jose`)
- Create: `apps/api/src/auth/oauth/accessToken.ts`, `apps/api/src/testHelpers/oauthTestHelpers.ts`
- Test: `apps/api/src/auth/oauth/accessToken.test.ts`

**Interfaces:**
- Consumes: `sessionKey()` (Task 2). The access TTL is read privately inside `accessToken.ts` from `AUTH_ACCESS_TTL_SECONDS` so signing/verifying never needs the Google credentials.
- Produces:
  - `interface AccessClaims { uid: string; email: string; familyId: string }`
  - `signAccessToken(c: AccessClaims, now?: Date): Promise<{ token: string; expiresIn: number }>`
  - `verifyAccessToken(token: string): Promise<AccessClaims>` — throws `AccessTokenError` with `kind: 'expired' | 'invalid'`.
  - `isGomsToken(token: string): boolean` — unverified peek (`iss === 'goms'`); never trusts the token, the caller must still `verifyAccessToken`.
  - Test helpers: `useOauthEnv(provider)`, `clearOauthEnv()`, `cleanupOauthTables()`, `gomsContextForEmail(email, uid?)`, `TEST_SESSION_SECRET`.

- [ ] **Step 1: Install the dependency**

```bash
npm install jose@^6.2.12 --workspace apps/api
```
Expected: `apps/api/package.json` gains `"jose": "^6.2.12"`; lockfile updates.

- [ ] **Step 2: Write the test helpers and the failing test**

```ts
// apps/api/src/testHelpers/oauthTestHelpers.ts
import { randomUUID } from 'node:crypto'
import { pool } from '../db.js'
import { signAccessToken } from '../auth/oauth/accessToken.js'
import type { AuthProvider } from '../auth/oauth/config.js'

export const TEST_SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
const KEYS = ['AUTH_PROVIDER', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'AUTH_SESSION_SECRET',
  'OAUTH_WEB_ORIGIN', 'AUTH_ACCESS_TTL_SECONDS', 'AUTH_REFRESH_TTL_DAYS', 'OAUTH_APP_SCHEME']

/** A complete, fake OAuth environment. Nothing here is a real credential. */
export function useOauthEnv(provider: AuthProvider = 'both'): void {
  process.env.AUTH_PROVIDER = provider
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://goms.test/api/oauth/google/callback'
  process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET
}
export function clearOauthEnv(): void { for (const k of KEYS) delete process.env[k] }

export async function cleanupOauthTables(): Promise<void> {
  await pool.query('DELETE FROM auth_sessions')
  await pool.query('DELETE FROM auth_exchange_codes')
  await pool.query('DELETE FROM auth_flows')
}

/** A tRPC context carrying a real GOMS access token for `email` (the OAuth analogue of contextForEmail). */
export async function gomsContextForEmail(email: string, uid = `g:${email}`): Promise<{ authHeader: string }> {
  const { token } = await signAccessToken({ uid, email: email.trim().toLowerCase(), familyId: randomUUID() })
  return { authHeader: `Bearer ${token}` }
}
```

```ts
// apps/api/src/auth/oauth/accessToken.test.ts
import { SignJWT, decodeJwt } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearOauthEnv, TEST_SESSION_SECRET, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { AccessTokenError, isGomsToken, signAccessToken, verifyAccessToken } from './accessToken.js'

beforeEach(() => useOauthEnv('both'))
afterEach(clearOauthEnv)
const claims = { uid: 'g:123', email: 'someone@amnex.com', familyId: '22222222-2222-2222-2222-222222222222' }

describe('access token', () => {
  it('round-trips the identity and lives 15 minutes by default', async () => {
    const { token, expiresIn } = await signAccessToken(claims)
    expect(expiresIn).toBe(900)
    await expect(verifyAccessToken(token)).resolves.toEqual(claims)
  })
  it('carries exactly iss/aud/sub/email/sid/iat/exp — no roles, no permissions', async () => {
    const { token } = await signAccessToken(claims)
    expect(Object.keys(decodeJwt(token)).sort()).toEqual(['aud', 'email', 'exp', 'iat', 'iss', 'sid', 'sub'])
    expect(decodeJwt(token)).toMatchObject({ iss: 'goms', aud: 'goms-api', sub: 'g:123', sid: claims.familyId })
  })
  it('honours AUTH_ACCESS_TTL_SECONDS', async () => {
    process.env.AUTH_ACCESS_TTL_SECONDS = '120'
    expect((await signAccessToken(claims)).expiresIn).toBe(120)
  })
  it('rejects an expired token as expired', async () => {
    const { token } = await signAccessToken(claims, new Date(Date.now() - 3600_000))
    await expect(verifyAccessToken(token)).rejects.toMatchObject({ name: 'AccessTokenError', kind: 'expired' })
  })
  it('rejects a token signed with another key, another issuer/audience, or alg=none', async () => {
    const key = new TextEncoder().encode('z'.repeat(40))
    const forged = await new SignJWT({ email: claims.email, sid: claims.familyId }).setProtectedHeader({ alg: 'HS256' })
      .setIssuer('goms').setAudience('goms-api').setSubject('g:1').setIssuedAt().setExpirationTime('5m').sign(key)
    await expect(verifyAccessToken(forged)).rejects.toBeInstanceOf(AccessTokenError)
    const secret = new TextEncoder().encode(TEST_SESSION_SECRET)
    for (const [iss, aud] of [['evil', 'goms-api'], ['goms', 'other']]) {
      const t = await new SignJWT({ email: claims.email, sid: claims.familyId }).setProtectedHeader({ alg: 'HS256' })
        .setIssuer(iss).setAudience(aud).setSubject('g:1').setIssuedAt().setExpirationTime('5m').sign(secret)
      await expect(verifyAccessToken(t)).rejects.toBeInstanceOf(AccessTokenError)
    }
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'goms', aud: 'goms-api', sub: 'g:1', email: 'a@amnex.com', sid: 'x', exp: 9999999999 })).toString('base64url')}.`
    await expect(verifyAccessToken(none)).rejects.toBeInstanceOf(AccessTokenError)
  })
  it('rejects a token missing email or sid', async () => {
    const secret = new TextEncoder().encode(TEST_SESSION_SECRET)
    const t = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer('goms').setAudience('goms-api').setSubject('g:1').setIssuedAt().setExpirationTime('5m').sign(secret)
    await expect(verifyAccessToken(t)).rejects.toBeInstanceOf(AccessTokenError)
  })
})

describe('isGomsToken (unverified peek used only to route verification)', () => {
  it('is true for a GOMS-looking JWT and false for Firebase-style or garbage tokens', async () => {
    expect(isGomsToken((await signAccessToken(claims)).token)).toBe(true)
    expect(isGomsToken('fake.eyJ1aWQiOiJ4In0')).toBe(false)
    expect(isGomsToken('not-a-jwt')).toBe(false)
    expect(isGomsToken('')).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `apitest src/auth/oauth/accessToken.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
// apps/api/src/auth/oauth/accessToken.ts
import { SignJWT, decodeJwt, errors, jwtVerify } from 'jose'
import { sessionKey } from './config.js'

const ISSUER = 'goms'
const AUDIENCE = 'goms-api'

export interface AccessClaims { uid: string; email: string; familyId: string }

export class AccessTokenError extends Error {
  readonly kind: 'expired' | 'invalid'
  constructor(kind: 'expired' | 'invalid') { super(kind); this.name = 'AccessTokenError'; this.kind = kind }
}

const accessTtlSeconds = (): number => {
  const n = Number(process.env.AUTH_ACCESS_TTL_SECONDS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 900
}

/** Identity only. Roles and permissions are deliberately NOT claims: RBAC is resolved from the email on every request. */
export async function signAccessToken(c: AccessClaims, now = new Date()): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = accessTtlSeconds()
  const iat = Math.floor(now.getTime() / 1000)
  const token = await new SignJWT({ email: c.email, sid: c.familyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(c.uid)
    .setIssuedAt(iat).setExpirationTime(iat + expiresIn)
    .sign(sessionKey())
  return { token, expiresIn }
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.sid !== 'string') throw new AccessTokenError('invalid')
    return { uid: payload.sub, email: payload.email, familyId: payload.sid }
  } catch (e) {
    if (e instanceof AccessTokenError) throw e
    throw new AccessTokenError(e instanceof errors.JWTExpired ? 'expired' : 'invalid')
  }
}

/** Unverified: only decides WHICH verifier to run. Never trust the result for authorisation. */
export function isGomsToken(token: string): boolean {
  try { return decodeJwt(token).iss === ISSUER } catch { return false }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `apitest src/auth/oauth/accessToken.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/auth/oauth/accessToken.ts apps/api/src/auth/oauth/accessToken.test.ts apps/api/src/testHelpers/oauthTestHelpers.ts
git commit -m "feat(oauth): HS256 access token (identity claims only) and OAuth test helpers"
```

---

### Task 4: Flow state and atomic single-use exchange codes

**Files:**
- Create: `apps/api/src/auth/oauth/flows.ts`, `apps/api/src/auth/oauth/exchangeCodes.ts`
- Test: `apps/api/src/auth/oauth/flows.test.ts`, `apps/api/src/auth/oauth/exchangeCodes.test.ts`

**Interfaces:**
- Consumes: `randomToken`, `sha256Hex`, `pkceChallenge` (Task 2); `ClientKind`.
- Produces:
  - `createFlow(client: ClientKind, returnTo: string): Promise<{ state: string; verifier: string; nonce: string; challenge: string }>` — stores hashes/server-only values; valid 10 minutes; opportunistically deletes expired flows.
  - `consumeFlow(state: unknown): Promise<{ verifier: string; nonce: string; client: ClientKind; returnTo: string } | null>` — `DELETE … RETURNING`, so a `state` works once.
  - `createExchangeCode(i: { uid: string; email: string; familyId: string; client: ClientKind }): Promise<string>` — 60-second life.
  - `redeemExchangeCode(code: unknown, client: unknown): Promise<{ uid: string; email: string; familyId: string } | null>` — one atomic `UPDATE … RETURNING`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/auth/oauth/flows.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'
import { cleanupOauthTables } from '../../testHelpers/oauthTestHelpers.js'
import { pkceChallenge, sha256Hex } from './crypto.js'
import { consumeFlow, createFlow } from './flows.js'

beforeEach(cleanupOauthTables)
afterEach(cleanupOauthTables)

describe('flows', () => {
  it('stores the state only as a hash, and returns a verifier whose S256 challenge it hands out', async () => {
    const f = await createFlow('web', '/sales/roster')
    expect(f.challenge).toBe(pkceChallenge(f.verifier))
    const row = (await pool.query('SELECT * FROM auth_flows')).rows[0]
    expect(row.state_hash).toBe(sha256Hex(f.state))
    expect(JSON.stringify(row)).not.toContain(f.state)
    expect(row).toMatchObject({ client: 'web', return_to: '/sales/roster', nonce: f.nonce })
  })
  it('consumeFlow returns the server-held values exactly once', async () => {
    const f = await createFlow('app', '/')
    await expect(consumeFlow(f.state)).resolves.toEqual({ verifier: f.verifier, nonce: f.nonce, client: 'app', returnTo: '/' })
    await expect(consumeFlow(f.state)).resolves.toBeNull()
  })
  it('two simultaneous callbacks for one state: exactly one wins', async () => {
    for (let i = 0; i < 20; i++) {
      const f = await createFlow('web', '/')
      const results = await Promise.all([consumeFlow(f.state), consumeFlow(f.state)])
      expect(results.filter(Boolean)).toHaveLength(1)
    }
  })
  it('refuses an expired, unknown or non-string state', async () => {
    const f = await createFlow('web', '/')
    await pool.query(`UPDATE auth_flows SET expires_at = now() - interval '1 second'`)
    await expect(consumeFlow(f.state)).resolves.toBeNull()
    for (const bad of [undefined, null, 5, '', 'nope', 'x'.repeat(500)]) await expect(consumeFlow(bad)).resolves.toBeNull()
  })
  it('sweeps expired flows when a new one is created', async () => {
    await createFlow('web', '/')
    await pool.query(`UPDATE auth_flows SET expires_at = now() - interval '1 hour'`)
    await createFlow('web', '/')
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_flows')).rows[0].n).toBe(1)
  })
})
```

```ts
// apps/api/src/auth/oauth/exchangeCodes.test.ts
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'
import { cleanupOauthTables } from '../../testHelpers/oauthTestHelpers.js'
import { sha256Hex } from './crypto.js'
import { createExchangeCode, redeemExchangeCode } from './exchangeCodes.js'

beforeEach(cleanupOauthTables)
afterEach(cleanupOauthTables)
const identity = () => ({ uid: 'g:42', email: 'user@amnex.com', familyId: randomUUID() })

describe('exchange codes', () => {
  it('are random, stored only as a hash, and expire in 60 seconds', async () => {
    const i = identity()
    const code = await createExchangeCode({ ...i, client: 'web' })
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const row = (await pool.query(`SELECT *, expires_at - created_at AS life FROM auth_exchange_codes`)).rows[0]
    expect(row.code_hash).toBe(sha256Hex(code))
    expect(JSON.stringify(row)).not.toContain(code)
    expect(row.life.seconds).toBe(60)
  })
  it('redeems once and returns the recorded identity and family', async () => {
    const i = identity()
    const code = await createExchangeCode({ ...i, client: 'web' })
    await expect(redeemExchangeCode(code, 'web')).resolves.toEqual(i)
    await expect(redeemExchangeCode(code, 'web')).resolves.toBeNull()
  })
  it('is bound to the client kind it was issued for (the code is NOT PKCE-bound)', async () => {
    const code = await createExchangeCode({ ...identity(), client: 'app' })
    await expect(redeemExchangeCode(code, 'web')).resolves.toBeNull()
    await expect(redeemExchangeCode(code, 'app')).resolves.not.toBeNull()
  })
  it('two simultaneous redemptions of one code: exactly one succeeds, against the real database', async () => {
    for (let i = 0; i < 25; i++) {
      const code = await createExchangeCode({ ...identity(), client: 'web' })
      const results = await Promise.all([redeemExchangeCode(code, 'web'), redeemExchangeCode(code, 'web'), redeemExchangeCode(code, 'web')])
      expect(results.filter(Boolean), `iteration ${i}`).toHaveLength(1)
    }
  })
  it('refuses expired, unknown and malformed codes, and a malformed client', async () => {
    const code = await createExchangeCode({ ...identity(), client: 'web' })
    await pool.query(`UPDATE auth_exchange_codes SET expires_at = now() - interval '1 second'`)
    await expect(redeemExchangeCode(code, 'web')).resolves.toBeNull()
    for (const bad of [undefined, null, 5, '', 'x'.repeat(300)]) await expect(redeemExchangeCode(bad, 'web')).resolves.toBeNull()
    const fresh = await createExchangeCode({ ...identity(), client: 'web' })
    for (const badClient of [undefined, 'tablet', 7]) await expect(redeemExchangeCode(fresh, badClient)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `apitest src/auth/oauth/flows.test.ts src/auth/oauth/exchangeCodes.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

```ts
// apps/api/src/auth/oauth/flows.ts
import { pool } from '../../db.js'
import { pkceChallenge, randomToken, sha256Hex } from './crypto.js'
import type { ClientKind } from './redirect.js'

/** An in-flight authorization request, valid for 10 minutes. `state` is stored hashed; the PKCE verifier and nonce stay server-side. */
export async function createFlow(client: ClientKind, returnTo: string) {
  await pool.query('DELETE FROM auth_flows WHERE expires_at < now()')
  const state = randomToken(), verifier = randomToken(), nonce = randomToken()
  await pool.query(
    `INSERT INTO auth_flows (state_hash, code_verifier, nonce, client, return_to, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
    [sha256Hex(state), verifier, nonce, client, returnTo],
  )
  return { state, verifier, nonce, challenge: pkceChallenge(verifier) }
}

/** Single-use: the row is deleted by the same statement that reads it, so concurrent callbacks cannot both succeed. */
export async function consumeFlow(state: unknown): Promise<{ verifier: string; nonce: string; client: ClientKind; returnTo: string } | null> {
  if (typeof state !== 'string' || state.length === 0 || state.length > 128) return null
  const { rows } = await pool.query(
    `DELETE FROM auth_flows WHERE state_hash = $1 AND expires_at > now() RETURNING code_verifier, nonce, client, return_to`,
    [sha256Hex(state)],
  )
  const row = rows[0]
  return row ? { verifier: row.code_verifier, nonce: row.nonce, client: row.client, returnTo: row.return_to } : null
}
```

```ts
// apps/api/src/auth/oauth/exchangeCodes.ts
import { pool } from '../../db.js'
import { randomToken, sha256Hex } from './crypto.js'
import { parseClient, type ClientKind } from './redirect.js'

/** The GOMS one-time exchange code. NOT PKCE-bound: protected by randomness, hashing at rest, a 60 s life, atomic single use,
 *  and binding to the verified identity, family and client kind. No token exists until it is redeemed. */
export async function createExchangeCode(i: { uid: string; email: string; familyId: string; client: ClientKind }): Promise<string> {
  await pool.query(`DELETE FROM auth_exchange_codes WHERE expires_at < now() - interval '1 hour'`)
  const code = randomToken()
  await pool.query(
    `INSERT INTO auth_exchange_codes (code_hash, uid, email, family_id, client, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '60 seconds')`,
    [sha256Hex(code), i.uid, i.email, i.familyId, i.client],
  )
  return code
}

/** One statement, so two simultaneous redemptions cannot both get a row. A wrong client kind is indistinguishable from an unknown code. */
export async function redeemExchangeCode(code: unknown, client: unknown): Promise<{ uid: string; email: string; familyId: string } | null> {
  const kind = parseClient(client)
  if (!kind || typeof code !== 'string' || code.length === 0 || code.length > 128) return null
  const { rows } = await pool.query(
    `UPDATE auth_exchange_codes SET used_at = now()
      WHERE code_hash = $1 AND client = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING uid, email, family_id`,
    [sha256Hex(code), kind],
  )
  const row = rows[0]
  return row ? { uid: row.uid, email: row.email, familyId: row.family_id } : null
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `apitest src/auth/oauth/flows.test.ts src/auth/oauth/exchangeCodes.test.ts`
Expected: PASS (including the 20/25-iteration concurrency loops).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/oauth/flows.ts apps/api/src/auth/oauth/exchangeCodes.ts apps/api/src/auth/oauth/flows.test.ts apps/api/src/auth/oauth/exchangeCodes.test.ts
git commit -m "feat(oauth): single-use flow state and atomically redeemed exchange codes"
```

---

### Task 5: Sessions — atomic refresh rotation, reuse detection, family revocation

**Files:**
- Create: `apps/api/src/auth/oauth/sessions.ts`
- Test: `apps/api/src/auth/oauth/sessions.test.ts`

**Interfaces:**
- Consumes: `randomToken`, `sha256Hex`; `oauthConfig().refreshTtlDays` is NOT used (the TTL is read from `AUTH_REFRESH_TTL_DAYS` directly, Step 3) so sessions work without Google credentials; `isAmnexAccount` from `../identity.js`.
- Produces:
  - `class SessionError extends Error { kind: 'invalid' | 'reuse' | 'not_amnex' }`
  - `startSession(i: { uid: string; email: string; familyId: string; userAgent?: string }): Promise<{ refreshToken: string }>` — generation 1 of the family.
  - `rotateRefreshToken(refreshToken: unknown, userAgent?: string): Promise<{ uid: string; email: string; familyId: string; refreshToken: string }>` — the atomic compare-and-set; throws `SessionError`.
  - `revokeFamilyByRefreshToken(refreshToken: unknown): Promise<void>` — idempotent, reveals nothing.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/auth/oauth/sessions.test.ts
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'
import { cleanupOauthTables } from '../../testHelpers/oauthTestHelpers.js'
import { sha256Hex } from './crypto.js'
import { SessionError, revokeFamilyByRefreshToken, rotateRefreshToken, startSession } from './sessions.js'

beforeEach(cleanupOauthTables)
afterEach(async () => { delete process.env.AUTH_REFRESH_TTL_DAYS; await cleanupOauthTables() })
const sign = (email = 'user@amnex.com') => { const familyId = randomUUID(); return startSession({ uid: 'g:1', email, familyId }).then((s) => ({ ...s, familyId })) }
const rows = async (familyId: string) => (await pool.query('SELECT * FROM auth_sessions WHERE family_id=$1 ORDER BY created_at', [familyId])).rows
const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof SessionError ? e.kind : 'other'))

describe('startSession', () => {
  it('stores only the hash of the refresh token and expires in 30 days by default', async () => {
    const { refreshToken, familyId } = await sign()
    const [row] = await rows(familyId)
    expect(row.refresh_hash).toBe(sha256Hex(refreshToken))
    expect(JSON.stringify(row)).not.toContain(refreshToken)
    const days = (new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(30)
  })
  it('honours AUTH_REFRESH_TTL_DAYS', async () => {
    process.env.AUTH_REFRESH_TTL_DAYS = '7'
    const { familyId } = await sign()
    const [row] = await rows(familyId)
    expect(Math.round((new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000)).toBe(7)
  })
})

describe('rotateRefreshToken', () => {
  it('rotates: new token, same family, old generation marked replaced, new one live', async () => {
    const { refreshToken, familyId } = await sign()
    const next = await rotateRefreshToken(refreshToken)
    expect(next).toMatchObject({ uid: 'g:1', email: 'user@amnex.com', familyId })
    expect(next.refreshToken).not.toBe(refreshToken)
    const [old, fresh] = await rows(familyId)
    expect(old.replaced_at).not.toBeNull()
    expect(fresh).toMatchObject({ replaced_at: null, revoked_at: null, refresh_hash: sha256Hex(next.refreshToken) })
  })
  it('chains: each new token rotates again', async () => {
    const s = await sign()
    const a = await rotateRefreshToken(s.refreshToken)
    const b = await rotateRefreshToken(a.refreshToken)
    expect(b.familyId).toBe(s.familyId)
    expect(await rows(s.familyId)).toHaveLength(3)
  })
  it('reuse of an already-rotated token revokes the WHOLE family, including the newest generation', async () => {
    const s = await sign()
    const a = await rotateRefreshToken(s.refreshToken)
    expect(await kindOf(rotateRefreshToken(s.refreshToken))).toBe('reuse')
    expect((await rows(s.familyId)).every((r) => r.revoked_at !== null)).toBe(true)
    expect(await kindOf(rotateRefreshToken(a.refreshToken))).toBe('invalid') // the newest token is dead too
  })
  it('does not touch other families when one is revoked', async () => {
    const x = await sign(), y = await sign('other@amnex.com')
    await rotateRefreshToken(x.refreshToken)
    await kindOf(rotateRefreshToken(x.refreshToken))
    expect((await rows(y.familyId))[0].revoked_at).toBeNull()
    await expect(rotateRefreshToken(y.refreshToken)).resolves.toBeTruthy()
  })
  it('refuses unknown, expired and revoked tokens with the same generic error and no side effects', async () => {
    expect(await kindOf(rotateRefreshToken('unknown'.padEnd(43, 'x')))).toBe('invalid')
    const s = await sign()
    await pool.query(`UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE family_id=$1`, [s.familyId])
    expect(await kindOf(rotateRefreshToken(s.refreshToken))).toBe('invalid')
    expect((await rows(s.familyId))).toHaveLength(1)
    for (const bad of [undefined, null, 5, '', 'x'.repeat(300)]) expect(await kindOf(rotateRefreshToken(bad))).toBe('invalid')
  })
  it('a token whose account is no longer @amnex.com cannot rotate and its family is revoked', async () => {
    const s = await startSession({ uid: 'g:9', email: 'ex@gmail.com', familyId: randomUUID() })
    const fam = (await pool.query('SELECT family_id FROM auth_sessions')).rows[0].family_id
    expect(await kindOf(rotateRefreshToken(s.refreshToken))).toBe('not_amnex')
    expect((await rows(fam)).every((r) => r.revoked_at !== null)).toBe(true)
  })

  it('TWO SIMULTANEOUS refreshes with the same current token: exactly one rotates; the other fails and revokes the family (real Postgres)', async () => {
    for (let i = 0; i < 25; i++) {
      const s = await sign()
      const [a, b] = await Promise.allSettled([rotateRefreshToken(s.refreshToken), rotateRefreshToken(s.refreshToken)])
      const won = [a, b].filter((r) => r.status === 'fulfilled')
      const lost = [a, b].filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
      expect(won, `iteration ${i}: winners`).toHaveLength(1)
      expect(lost, `iteration ${i}: losers`).toHaveLength(1)
      expect(lost[0].reason).toBeInstanceOf(SessionError)
      expect((lost[0].reason as SessionError).kind).toBe('reuse')
      const family = await rows(s.familyId)
      expect(family.every((r) => r.revoked_at !== null), `iteration ${i}: family revoked`).toBe(true)
      expect(family.filter((r) => r.replaced_at === null && r.revoked_at === null)).toHaveLength(0) // no usable token survives
    }
  })
  it('five simultaneous refreshes: still exactly one winner and one new generation in the table', async () => {
    const s = await sign()
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => rotateRefreshToken(s.refreshToken)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await rows(s.familyId)).toHaveLength(2) // original + the single new generation
  })
})

describe('revokeFamilyByRefreshToken (logout)', () => {
  it('revokes every generation of the family and is idempotent', async () => {
    const s = await sign()
    const a = await rotateRefreshToken(s.refreshToken)
    await revokeFamilyByRefreshToken(a.refreshToken)
    expect((await rows(s.familyId)).every((r) => r.revoked_at !== null)).toBe(true)
    await expect(revokeFamilyByRefreshToken(a.refreshToken)).resolves.toBeUndefined()
    expect(await kindOf(rotateRefreshToken(a.refreshToken))).toBe('invalid')
  })
  it('says nothing for an unknown token', async () => {
    await expect(revokeFamilyByRefreshToken('nope')).resolves.toBeUndefined()
    await expect(revokeFamilyByRefreshToken(undefined)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `apitest src/auth/oauth/sessions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/api/src/auth/oauth/sessions.ts
import { pool } from '../../db.js'
import { isAmnexAccount } from '../identity.js'
import { randomToken, sha256Hex } from './crypto.js'

export class SessionError extends Error {
  readonly kind: 'invalid' | 'reuse' | 'not_amnex'
  constructor(kind: 'invalid' | 'reuse' | 'not_amnex') { super(kind); this.name = 'SessionError'; this.kind = kind }
}

const refreshTtlDays = (): number => {
  const n = Number(process.env.AUTH_REFRESH_TTL_DAYS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30
}
const plausible = (t: unknown): t is string => typeof t === 'string' && t.length >= 16 && t.length <= 128

const REVOKE_FAMILY = `UPDATE auth_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`

/** Generation 1 of a family. Only the SHA-256 of the refresh token is stored. */
export async function startSession(i: { uid: string; email: string; familyId: string; userAgent?: string }): Promise<{ refreshToken: string }> {
  const refreshToken = randomToken()
  await pool.query(
    `INSERT INTO auth_sessions (uid, email, refresh_hash, family_id, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)`,
    [i.uid, i.email, sha256Hex(refreshToken), i.familyId, String(refreshTtlDays()), i.userAgent?.slice(0, 200) ?? null],
  )
  return { refreshToken }
}

/**
 * Atomic rotation (spec §4.3). The compare-and-set is ONE statement that only the current, live token can satisfy:
 * two concurrent requests presenting the same token serialise on the row lock, the second re-evaluates the WHERE after the
 * first commits, finds `replaced_at` set, and gets zero rows. Exactly one rotates. Never read-then-write.
 */
export async function rotateRefreshToken(
  refreshToken: unknown, userAgent?: string,
): Promise<{ uid: string; email: string; familyId: string; refreshToken: string }> {
  if (!plausible(refreshToken)) throw new SessionError('invalid')
  const hash = sha256Hex(refreshToken)
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const won = await db.query(
      `UPDATE auth_sessions SET replaced_at = now(), last_used_at = now()
        WHERE refresh_hash = $1 AND replaced_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING uid, email, family_id`,
      [hash],
    )
    if (won.rowCount === 1) {
      const { uid, email, family_id: familyId } = won.rows[0]
      if (!isAmnexAccount(email)) {
        await db.query(REVOKE_FAMILY, [familyId])
        await db.query('COMMIT')
        throw new SessionError('not_amnex')
      }
      const next = randomToken()
      await db.query(
        `INSERT INTO auth_sessions (uid, email, refresh_hash, family_id, expires_at, user_agent)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)`,
        [uid, email, sha256Hex(next), familyId, String(refreshTtlDays()), userAgent?.slice(0, 200) ?? null],
      )
      await db.query('COMMIT')
      return { uid, email, familyId, refreshToken: next }
    }
    // Did not rotate. A token that WAS rotated is a reuse: revoke the whole family. Anything else is just invalid.
    const seen = await db.query('SELECT family_id, replaced_at FROM auth_sessions WHERE refresh_hash = $1', [hash])
    if (seen.rows[0]?.replaced_at) {
      await db.query(REVOKE_FAMILY, [seen.rows[0].family_id])
      await db.query('COMMIT')
      throw new SessionError('reuse')
    }
    await db.query('ROLLBACK')
    throw new SessionError('invalid')
  } catch (e) {
    if (!(e instanceof SessionError)) await db.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    db.release()
  }
}

/** Logout. Idempotent and silent: an unknown token is indistinguishable from a revoked one. */
export async function revokeFamilyByRefreshToken(refreshToken: unknown): Promise<void> {
  if (!plausible(refreshToken)) return
  await pool.query(
    `UPDATE auth_sessions SET revoked_at = now()
      WHERE family_id = (SELECT family_id FROM auth_sessions WHERE refresh_hash = $1) AND revoked_at IS NULL`,
    [sha256Hex(refreshToken)],
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `apitest src/auth/oauth/sessions.test.ts`
Expected: PASS, including the 25-iteration simultaneous-refresh test and the five-way test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/oauth/sessions.ts apps/api/src/auth/oauth/sessions.test.ts
git commit -m "feat(oauth): rotating refresh sessions with atomic compare-and-set and family revocation"
```

- [ ] **Step 6: Prove the test would catch a non-atomic implementation** (mutation check; the implementation is already committed, so it is safe to revert)

Temporarily replace the rotation's `UPDATE … RETURNING` with a `SELECT … WHERE replaced_at IS NULL` followed by a separate `UPDATE`. Run `apitest src/auth/oauth/sessions.test.ts`.
Expected: the simultaneous-refresh tests FAIL (two winners). Then restore: `git checkout -- apps/api/src/auth/oauth/sessions.ts` and re-run to PASS.

---

### Task 6: Google client — authorize URL, code exchange, ID-token validation

**Files:**
- Create: `apps/api/src/auth/oauth/googleClient.ts`
- Test: `apps/api/src/auth/oauth/googleClient.test.ts`

**Interfaces:**
- Consumes: `oauthConfig()` (Task 2), `isAmnexAccount`.
- Produces:
  - `class GoogleAuthError extends Error { reason: 'exchange' | 'token' | 'nonce' | 'unverified' | 'domain' }`
  - `interface GoogleClaims { sub: string; email: string }`
  - `interface GoogleGateway { exchangeCode(i: { code: string; verifier: string }): Promise<string>; verifyIdToken(idToken: string, nonce: string): Promise<GoogleClaims> }`
  - `buildAuthUrl(f: { state: string; nonce: string; challenge: string }): string`
  - `verifyGoogleIdToken(idToken: string, nonce: string, deps: { clientId: string; keys: JWTVerifyGetKey; now?: Date }): Promise<GoogleClaims>` (pure, injectable keys for tests)
  - `googleGateway: GoogleGateway` — the real one (token endpoint via `fetch`, JWKS from `https://www.googleapis.com/oauth2/v3/certs`).
  - Test helper `fakeGoogle(...)` added to `oauthTestHelpers.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/auth/oauth/googleClient.test.ts
import { SignJWT, generateKeyPair } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearOauthEnv, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { GoogleAuthError, buildAuthUrl, verifyGoogleIdToken } from './googleClient.js'

const CLIENT = 'test-client.apps.googleusercontent.com'
let privateKey: CryptoKey, publicKey: CryptoKey
beforeAll(async () => { ({ privateKey, publicKey } = await generateKeyPair('RS256')) })
const keys = async () => publicKey

const mint = (over: Record<string, unknown> = {}, o: { iss?: string; aud?: string; exp?: number | string; alg?: string } = {}) =>
  new SignJWT({ email: 'Someone@Amnex.com', email_verified: true, nonce: 'N1', ...over })
    .setProtectedHeader({ alg: o.alg ?? 'RS256' }).setIssuer(o.iss ?? 'https://accounts.google.com').setAudience(o.aud ?? CLIENT)
    .setSubject('1234567890').setIssuedAt().setExpirationTime(o.exp ?? '5m').sign(privateKey)
const reason = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof GoogleAuthError ? e.reason : `other:${(e as Error).message}`))

describe('verifyGoogleIdToken', () => {
  it('accepts a valid token and lower-cases the email', async () => {
    await expect(verifyGoogleIdToken(await mint(), 'N1', { clientId: CLIENT, keys })).resolves.toEqual({ sub: '1234567890', email: 'someone@amnex.com' })
  })
  it('accepts the bare accounts.google.com issuer', async () => {
    await expect(verifyGoogleIdToken(await mint({}, { iss: 'accounts.google.com' }), 'N1', { clientId: CLIENT, keys })).resolves.toBeTruthy()
  })
  it.each([
    ['wrong issuer', () => mint({}, { iss: 'https://evil.example' }), 'token'],
    ['wrong audience', () => mint({}, { aud: 'someone-elses-client' }), 'token'],
    ['expired', () => mint({}, { exp: Math.floor(Date.now() / 1000) - 60 }), 'token'],
    ['wrong nonce', () => mint({ nonce: 'OTHER' }), 'nonce'],
    ['missing nonce', () => mint({ nonce: undefined }), 'nonce'],
    ['email not verified', () => mint({ email_verified: false }), 'unverified'],
    ['email_verified as a string', () => mint({ email_verified: 'true' }), 'unverified'],
    ['non-amnex account', () => mint({ email: 'person@gmail.com' }), 'domain'],
    ['lookalike domain', () => mint({ email: 'person@amnex.com.evil.io' }), 'domain'],
    ['no email', () => mint({ email: undefined }), 'unverified'],
  ])('rejects %s', async (_n, make, why) => {
    expect(await reason(verifyGoogleIdToken(await make(), 'N1', { clientId: CLIENT, keys }))).toBe(why)
  })
  it('rejects a token signed by a different key', async () => {
    const other = await generateKeyPair('RS256')
    const t = await new SignJWT({ email: 'a@amnex.com', email_verified: true, nonce: 'N1' }).setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://accounts.google.com').setAudience(CLIENT).setSubject('1').setExpirationTime('5m').sign(other.privateKey)
    expect(await reason(verifyGoogleIdToken(t, 'N1', { clientId: CLIENT, keys }))).toBe('token')
  })
  it('rejects a symmetric (HS256) token even if someone guessed a key', async () => {
    const t = await new SignJWT({ email: 'a@amnex.com', email_verified: true, nonce: 'N1' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://accounts.google.com').setAudience(CLIENT).setSubject('1').setExpirationTime('5m').sign(new TextEncoder().encode('k'.repeat(40)))
    expect(await reason(verifyGoogleIdToken(t, 'N1', { clientId: CLIENT, keys }))).toBe('token')
  })
  it('rejects garbage', async () => { expect(await reason(verifyGoogleIdToken('not.a.jwt', 'N1', { clientId: CLIENT, keys }))).toBe('token') })
})

describe('buildAuthUrl', () => {
  beforeEach(() => useOauthEnv('both'))
  afterEach(clearOauthEnv)
  it('asks Google for a code with S256 PKCE, state, nonce, the exact redirect URI, and the domain hint', () => {
    const u = new URL(buildAuthUrl({ state: 'S', nonce: 'N', challenge: 'C' }))
    expect(`${u.origin}${u.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'test-client.apps.googleusercontent.com', redirect_uri: 'https://goms.test/api/oauth/google/callback', response_type: 'code',
      scope: 'openid email profile', state: 'S', nonce: 'N', code_challenge: 'C', code_challenge_method: 'S256', hd: 'amnex.com', prompt: 'select_account',
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `apitest src/auth/oauth/googleClient.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/api/src/auth/oauth/googleClient.ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { isAmnexAccount } from '../identity.js'
import { oauthConfig } from './config.js'

export class GoogleAuthError extends Error {
  readonly reason: 'exchange' | 'token' | 'nonce' | 'unverified' | 'domain'
  constructor(reason: GoogleAuthError['reason']) { super(reason); this.name = 'GoogleAuthError'; this.reason = reason }
}

export interface GoogleClaims { sub: string; email: string }
export interface GoogleGateway {
  /** Authorization code -> raw ID token (server-side, with the client secret and PKCE verifier). */
  exchangeCode(i: { code: string; verifier: string }): Promise<string>
  verifyIdToken(idToken: string, nonce: string): Promise<GoogleClaims>
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export function buildAuthUrl(f: { state: string; nonce: string; challenge: string }): string {
  const cfg = oauthConfig()
  const url = new URL(AUTH_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: 'openid email profile',
    state: f.state, nonce: f.nonce, code_challenge: f.challenge, code_challenge_method: 'S256',
    hd: 'amnex.com', // a hint only: the @amnex.com check below is what enforces the domain
    prompt: 'select_account',
  }).toString()
  return url.toString()
}

/** Pure and key-injectable so every rule is unit-testable with locally generated keys. */
export async function verifyGoogleIdToken(
  idToken: string, nonce: string, deps: { clientId: string; keys: JWTVerifyGetKey; now?: Date },
): Promise<GoogleClaims> {
  let payload: Record<string, unknown>
  try {
    ;({ payload } = await jwtVerify(idToken, deps.keys, { issuer: ISSUERS, audience: deps.clientId, algorithms: ['RS256'], currentDate: deps.now }))
  } catch {
    throw new GoogleAuthError('token')
  }
  if (typeof payload.nonce !== 'string' || payload.nonce !== nonce) throw new GoogleAuthError('nonce')
  if (typeof payload.email !== 'string' || payload.email_verified !== true) throw new GoogleAuthError('unverified')
  const email = payload.email.trim().toLowerCase()
  if (!isAmnexAccount(email)) throw new GoogleAuthError('domain')
  if (typeof payload.sub !== 'string' || payload.sub === '') throw new GoogleAuthError('token')
  return { sub: payload.sub, email }
}

let jwks: JWTVerifyGetKey | undefined
const googleKeys: JWTVerifyGetKey = (header, token) => (jwks ??= createRemoteJWKSet(JWKS_URL))(header, token)

export const googleGateway: GoogleGateway = {
  async exchangeCode({ code, verifier }) {
    const cfg = oauthConfig()
    let res: Response
    try {
      res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code', code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new GoogleAuthError('exchange')
    }
    if (!res.ok) throw new GoogleAuthError('exchange')
    const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null
    if (typeof body?.id_token !== 'string') throw new GoogleAuthError('exchange')
    return body.id_token
  },
  verifyIdToken: (idToken, nonce) => verifyGoogleIdToken(idToken, nonce, { clientId: oauthConfig().clientId, keys: googleKeys }),
}
```

Append the fake gateway to `apps/api/src/testHelpers/oauthTestHelpers.ts`:

```ts
import { GoogleAuthError, type GoogleClaims, type GoogleGateway } from '../auth/oauth/googleClient.js'

/** A Google stand-in that records what the API sent it. `fail` makes the matching step reject like the real one would. */
export function fakeGoogle(over: { email?: string; sub?: string; fail?: GoogleAuthError['reason'] } = {}) {
  const calls = { exchange: [] as { code: string; verifier: string }[], verify: [] as { idToken: string; nonce: string }[] }
  const gateway: GoogleGateway = {
    async exchangeCode(i) {
      calls.exchange.push(i)
      if (over.fail === 'exchange') throw new GoogleAuthError('exchange')
      return `fake-id-token:${i.code}`
    },
    async verifyIdToken(idToken, nonce): Promise<GoogleClaims> {
      calls.verify.push({ idToken, nonce })
      if (over.fail && over.fail !== 'exchange') throw new GoogleAuthError(over.fail)
      return { sub: over.sub ?? '1234567890', email: (over.email ?? 'someone@amnex.com').toLowerCase() }
    },
  }
  return { gateway, calls }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `apitest src/auth/oauth/googleClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/oauth/googleClient.ts apps/api/src/auth/oauth/googleClient.test.ts apps/api/src/testHelpers/oauthTestHelpers.ts
git commit -m "feat(oauth): Google authorize URL, code exchange and strict ID-token validation"
```

---

### Task 7: OAuth routes and Fastify registration

**Files:**
- Create: `apps/api/src/auth/oauth/routes.ts`
- Modify: `apps/api/src/app.ts` (register after the rate limiter, before the tRPC plugin; add `BuildAppOptions.oauth`)
- Test: `apps/api/src/auth/oauth/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6 (`authProvider`/`oauthEnabled`, `oauthConfig`, `safeReturnTo`, `parseClient`, `webRedirectUrl`, `createFlow`, `consumeFlow`, `createExchangeCode`, `redeemExchangeCode`, `startSession`, `rotateRefreshToken`, `revokeFamilyByRefreshToken`, `signAccessToken`, `buildAuthUrl`, `GoogleGateway`).
- Produces:
  - `interface OAuthDeps { google: GoogleGateway }`; `registerOAuthRoutes(app: FastifyInstance, deps: OAuthDeps): void`
  - `BuildAppOptions.oauth?: { google?: GoogleGateway }`
  - HTTP contract: `GET /api/oauth/google/start`, `GET /api/oauth/google/callback`, `POST /api/oauth/exchange`, `POST /api/oauth/refresh`, `POST /api/oauth/logout` (spec §4.2). Failure reason codes: `state | domain | unverified | google | denied`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/auth/oauth/routes.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { pool } from '../../db.js'
import { cleanupOauthTables, clearOauthEnv, fakeGoogle, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { verifyAccessToken } from './accessToken.js'
import { pkceChallenge } from './crypto.js'

let app: Awaited<ReturnType<typeof buildApp>>
let google: ReturnType<typeof fakeGoogle>
const ORIGIN = 'https://goms.test'

async function boot(over?: Parameters<typeof fakeGoogle>[0]) {
  google = fakeGoogle(over)
  app = await buildApp({ oauth: { google: google.gateway }, rateLimit: { max: 10_000, timeWindow: '1 minute' } })
}
beforeEach(async () => { useOauthEnv('both'); await cleanupOauthTables() })
afterEach(async () => { await app?.close(); clearOauthEnv(); await cleanupOauthTables() })

const loc = (r: { headers: Record<string, unknown> }) => String(r.headers.location)
async function start(client: 'web' | 'app', returnTo = '/sales/roster') {
  const r = await app.inject({ method: 'GET', url: `/api/oauth/google/start?client=${client}&return_to=${encodeURIComponent(returnTo)}` })
  const u = new URL(loc(r))
  return { r, u, state: u.searchParams.get('state')!, nonce: u.searchParams.get('nonce')!, challenge: u.searchParams.get('code_challenge')! }
}
const callback = (state: string, code = 'google-code') =>
  app.inject({ method: 'GET', url: `/api/oauth/google/callback?code=${code}&state=${encodeURIComponent(state)}` })
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object })

describe('AUTH_PROVIDER=firebase (the default) is a no-op: every OAuth route answers 404', () => {
  it('404s all five routes and creates nothing', async () => {
    process.env.AUTH_PROVIDER = 'firebase'
    await boot()
    for (const [method, url] of [['GET', '/api/oauth/google/start?client=web'], ['GET', '/api/oauth/google/callback?state=x&code=y'],
      ['POST', '/api/oauth/exchange'], ['POST', '/api/oauth/refresh'], ['POST', '/api/oauth/logout']] as const) {
      expect((await app.inject({ method, url, payload: {} })).statusCode, url).toBe(404)
    }
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_flows')).rows[0].n).toBe(0)
  })
  it('is also a 404 when AUTH_PROVIDER is unset', async () => {
    delete process.env.AUTH_PROVIDER
    await boot()
    expect((await app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web' })).statusCode).toBe(404)
  })
})

describe('start', () => {
  beforeEach(() => boot())
  it('redirects to Google with state, nonce and an S256 challenge, and never caches', async () => {
    const { r, u } = await start('web')
    expect(r.statusCode).toBe(302)
    expect(r.headers['cache-control']).toMatch(/no-store/)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/oauth/google/callback`)
  })
  it('rejects a missing or unknown client kind with 400', async () => {
    for (const q of ['', '?client=tablet', '?client=']) expect((await app.inject({ method: 'GET', url: `/api/oauth/google/start${q}` })).statusCode).toBe(400)
  })
  it.each(['//evil.example', 'https://evil.example', '/\\evil', 'javascript:alert(1)'])('stores a safe return_to for %s', async (bad) => {
    await start('web', bad)
    expect((await pool.query('SELECT return_to FROM auth_flows')).rows[0].return_to).toBe('/')
  })
})

describe('full WEB flow', () => {
  beforeEach(() => boot())
  it('start -> callback -> exchange -> refresh -> logout, with tokens never in a URL', async () => {
    const s = await start('web', '/bid-tracker?sheet=pipeline#top')
    const cb = await callback(s.state)
    expect(cb.statusCode).toBe(302)
    const back = new URL(loc(cb))
    expect(back.origin).toBe(ORIGIN)
    expect(back.pathname + back.search.replace(/auth_code=[^&]+/, 'auth_code=X')).toBe('/bid-tracker?sheet=pipeline&auth_code=X')
    expect(back.hash).toBe('#top')
    expect(loc(cb)).not.toMatch(/access|refresh|token/i)
    const code = back.searchParams.get('auth_code')!

    // PKCE and nonce really were sent to Google the way start announced them
    expect(google.calls.exchange).toHaveLength(1)
    expect(pkceChallenge(google.calls.exchange[0].verifier)).toBe(s.challenge)
    expect(google.calls.verify[0].nonce).toBe(s.nonce)

    const ex = await post('/api/oauth/exchange', { code, client: 'web' })
    expect(ex.statusCode).toBe(200)
    expect(ex.headers['cache-control']).toMatch(/no-store/)
    const tokens = ex.json() as { accessToken: string; refreshToken: string; expiresIn: number }
    expect(tokens.expiresIn).toBe(900)
    await expect(verifyAccessToken(tokens.accessToken)).resolves.toMatchObject({ uid: 'g:1234567890', email: 'someone@amnex.com' })

    const rf = await post('/api/oauth/refresh', { refreshToken: tokens.refreshToken })
    expect(rf.statusCode).toBe(200)
    const next = rf.json() as typeof tokens
    expect(next.refreshToken).not.toBe(tokens.refreshToken)

    expect((await post('/api/oauth/refresh', { refreshToken: tokens.refreshToken })).statusCode).toBe(401) // reuse
    expect((await post('/api/oauth/refresh', { refreshToken: next.refreshToken })).statusCode).toBe(401)    // family revoked
  })
  it('logout revokes the session', async () => {
    const s = await start('web'); const code = new URL(loc(await callback(s.state))).searchParams.get('auth_code')!
    const t = (await post('/api/oauth/exchange', { code, client: 'web' })).json() as { refreshToken: string }
    expect((await post('/api/oauth/logout', { refreshToken: t.refreshToken })).statusCode).toBe(204)
    expect((await post('/api/oauth/refresh', { refreshToken: t.refreshToken })).statusCode).toBe(401)
    expect((await post('/api/oauth/logout', { refreshToken: 'nope' })).statusCode).toBe(204) // silent for unknown tokens
  })
})

describe('full APP flow', () => {
  beforeEach(() => boot())
  it('the callback is an HTML page that deep-links com.gorms.app://auth?code=… and nothing else secret', async () => {
    const s = await start('app')
    const cb = await callback(s.state)
    expect(cb.statusCode).toBe(200)
    expect(cb.headers['content-type']).toMatch(/text\/html/)
    expect(cb.headers['cache-control']).toMatch(/no-store/)
    expect(cb.headers['referrer-policy']).toBe('no-referrer')
    const m = cb.body.match(/com\.gorms\.app:\/\/auth\?code=([A-Za-z0-9_-]{43})/)
    expect(m).not.toBeNull()
    expect(cb.body).not.toMatch(/accessToken|refreshToken/)
    const ex = await post('/api/oauth/exchange', { code: m![1], client: 'app' })
    expect(ex.statusCode).toBe(200)
  })
  it('the dev API deep-links to the DEV scheme and never to the prod one (side-by-side installs, Q1)', async () => {
    process.env.OAUTH_APP_SCHEME = 'com.gorms.app.dev'
    const s = await start('app')
    const cb = await callback(s.state)
    expect(cb.body).toMatch(/com\.gorms\.app\.dev:\/\/auth\?code=[A-Za-z0-9_-]{43}/)
    expect(cb.body).not.toMatch(/com\.gorms\.app:\/\/auth/)
  })
  it('an unsupported OAUTH_APP_SCHEME is a generic 503 and issues no code', async () => {
    process.env.OAUTH_APP_SCHEME = 'evil.app'
    const s = await start('app')
    const cb = await callback(s.state)
    expect(cb.statusCode).toBe(503)
    expect(cb.body).not.toMatch(/evil|OAUTH_APP_SCHEME/)
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_exchange_codes')).rows[0].n).toBe(0)
  })
  it('an app code cannot be redeemed as web (and vice versa)', async () => {
    const s = await start('app'); const code = (await callback(s.state)).body.match(/code=([A-Za-z0-9_-]{43})/)![1]
    expect((await post('/api/oauth/exchange', { code, client: 'web' })).statusCode).toBe(401)
    expect((await post('/api/oauth/exchange', { code, client: 'app' })).statusCode).toBe(200)
  })
})

describe('failure paths never issue a code or a token', () => {
  const codes = async () => (await pool.query('SELECT count(*)::int AS n FROM auth_exchange_codes')).rows[0].n
  const sessions = async () => (await pool.query('SELECT count(*)::int AS n FROM auth_sessions')).rows[0].n
  const reasonOf = (r: { headers: Record<string, unknown>; body: string }) =>
    r.headers.location ? new URL(String(r.headers.location)).searchParams.get('auth_error') : r.body.match(/auth\?error=([a-z]+)/)?.[1]

  it('unknown / replayed state -> reason "state", and the second visit of a good callback gets nothing', async () => {
    await boot()
    expect(reasonOf(await callback('forged-state'))).toBe('state')
    const s = await start('web')
    expect((await callback(s.state)).statusCode).toBe(302)
    const again = await callback(s.state) // back button / pasted URL
    expect(reasonOf(again)).toBe('state')
    expect(await codes()).toBe(1)
  })
  it('expired flow -> "state"', async () => {
    await boot()
    const s = await start('web')
    await pool.query(`UPDATE auth_flows SET expires_at = now() - interval '1 second'`)
    expect(reasonOf(await callback(s.state))).toBe('state')
    expect(await codes()).toBe(0)
  })
  it('the user denied consent at Google -> "denied"', async () => {
    await boot()
    const s = await start('web')
    const r = await app.inject({ method: 'GET', url: `/api/oauth/google/callback?error=access_denied&state=${encodeURIComponent(s.state)}` })
    expect(reasonOf(r)).toBe('denied')
    expect(await codes()).toBe(0)
  })
  it.each([['domain', 'domain'], ['unverified', 'unverified'], ['token', 'google'], ['nonce', 'google'], ['exchange', 'google']] as const)(
    'Google check "%s" -> reason "%s", no code, no session', async (fail, reason) => {
      await boot({ fail })
      const s = await start('web')
      expect(reasonOf(await callback(s.state))).toBe(reason)
      expect(await codes()).toBe(0); expect(await sessions()).toBe(0)
    })
  it('the app flow reports failures through the same deep link, with a reason only', async () => {
    await boot({ fail: 'domain' })
    const s = await start('app')
    const cb = await callback(s.state)
    expect(cb.body).toContain('com.gorms.app://auth?error=domain')
    expect(cb.body).not.toMatch(/code=/)
  })
  it('exchange refuses unknown, malformed and missing bodies with one generic 401/400', async () => {
    await boot()
    expect((await post('/api/oauth/exchange', { code: 'nope', client: 'web' })).statusCode).toBe(401)
    expect((await post('/api/oauth/exchange', {})).statusCode).toBe(400)
    expect((await post('/api/oauth/refresh', {})).statusCode).toBe(400)
  })
  it('two simultaneous exchanges of one code: exactly one gets tokens', async () => {
    await boot()
    const s = await start('web'); const code = new URL(loc(await callback(s.state))).searchParams.get('auth_code')!
    const rs = await Promise.all([post('/api/oauth/exchange', { code, client: 'web' }), post('/api/oauth/exchange', { code, client: 'web' })])
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 401])
    expect(await sessions()).toBe(1)
  })
  it('simultaneous refreshes over HTTP: one 200, the rest 401, family revoked', async () => {
    await boot()
    const s = await start('web'); const code = new URL(loc(await callback(s.state))).searchParams.get('auth_code')!
    const t = (await post('/api/oauth/exchange', { code, client: 'web' })).json() as { refreshToken: string }
    const rs = await Promise.all([1, 2, 3].map(() => post('/api/oauth/refresh', { refreshToken: t.refreshToken })))
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1)
    expect(rs.filter((r) => r.statusCode === 401)).toHaveLength(2)
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE revoked_at IS NULL')).rows[0].n).toBe(0)
  })
  it('a misconfigured server answers a generic 503 and leaks no variable values', async () => {
    await boot()
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    const r = await app.inject({ method: 'GET', url: '/api/oauth/google/start?client=web' })
    expect(r.statusCode).toBe(503)
    expect(r.body).not.toMatch(/GOOGLE_OAUTH|test-client|secret/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `apitest src/auth/oauth/routes.test.ts`
Expected: FAIL (`buildApp` has no `oauth` option / routes missing — the 404 tests may pass by accident; the flow tests must FAIL).

- [ ] **Step 3: Implement the routes**

```ts
// apps/api/src/auth/oauth/routes.ts
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { signAccessToken } from './accessToken.js'
import { OAuthConfigError, appScheme, oauthConfig, oauthEnabled } from './config.js'
import { createExchangeCode, redeemExchangeCode } from './exchangeCodes.js'
import { consumeFlow, createFlow } from './flows.js'
import { GoogleAuthError, buildAuthUrl, type GoogleGateway } from './googleClient.js'
import { parseClient, safeReturnTo, webRedirectUrl, type ClientKind } from './redirect.js'
import { SessionError, revokeFamilyByRefreshToken, rotateRefreshToken, startSession } from './sessions.js'

export interface OAuthDeps { google: GoogleGateway }

type Reason = 'state' | 'domain' | 'unverified' | 'google' | 'denied'
const reasonFor = (e: unknown): Reason => {
  if (e instanceof GoogleAuthError) return e.reason === 'domain' ? 'domain' : e.reason === 'unverified' ? 'unverified' : 'google'
  return 'google'
}

const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').header('Referrer-Policy', 'no-referrer')
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'Not found' })

/** The page an Android Custom Tab lands on. `scheme` is this deployment's own app scheme (`appScheme()`), so a dev API can only open the dev app. A meta refresh plus a visible link (browsers may refuse an unprompted custom-scheme
 *  redirect). It carries a one-time code or a reason code — never a token. Values are base64url or a fixed word, so no escaping is needed. */
function appPage(scheme: string, query: string): string {
  const href = `${scheme}://auth?${query}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="refresh" content="0;url=${href}"><title>Return to GOMS</title>`
    + `<style>body{font:16px system-ui;margin:2rem;text-align:center}a{display:inline-block;margin-top:1rem;padding:.8rem 1.4rem;background:#111;color:#fff;border-radius:.5rem;text-decoration:none}</style>`
    + `</head><body><p>Returning to GOMS…</p><a href="${href}">Open GOMS</a></body></html>`
}

export function registerOAuthRoutes(app: FastifyInstance, deps: OAuthDeps): void {
  // Tighter than the global limiter: these are the only unauthenticated, state-creating endpoints.
  const limited = { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } }

  /** Runs `fn` only when OAuth is switched on; maps misconfiguration to a generic 503 that never names a value. */
  const guarded = (fn: (req: any, reply: FastifyReply) => Promise<unknown>) => async (req: any, reply: FastifyReply) => {
    if (!oauthEnabled()) return notFound(reply)
    noStore(reply)
    try {
      return await fn(req, reply)
    } catch (e) {
      if (e instanceof OAuthConfigError) {
        console.error(JSON.stringify({ event: 'oauth.misconfigured', message: e.message })) // names the missing variables, never values
        return reply.code(503).send({ error: 'Sign-in is temporarily unavailable.' })
      }
      throw e
    }
  }

  function fail(reply: FastifyReply, client: ClientKind, reason: Reason) {
    if (client === 'app') return reply.code(200).type('text/html; charset=utf-8').send(appPage(appScheme(), `error=${reason}`))
    return reply.code(302).header('Location', webRedirectUrl(oauthConfig().webOrigin, '/', { auth_error: reason })).send()
  }

  app.get('/api/oauth/google/start', limited, guarded(async (req, reply) => {
    const client = parseClient(req.query?.client)
    if (!client) return reply.code(400).send({ error: 'invalid_request' })
    oauthConfig() // fail fast with a 503 before any state is stored
    const flow = await createFlow(client, safeReturnTo(req.query?.return_to))
    return reply.code(302).header('Location', buildAuthUrl(flow)).send()
  }))

  app.get('/api/oauth/google/callback', limited, guarded(async (req, reply) => {
    const flow = await consumeFlow(req.query?.state)
    if (!flow) return fail(reply, 'web', 'state') // unknown, replayed or expired; we cannot know which client it was
    if (flow.client === 'app') appScheme() // validate the deployment's scheme BEFORE anything is issued (throws -> generic 503)
    if (typeof req.query?.error === 'string') return fail(reply, flow.client, 'denied')
    const code = req.query?.code
    if (typeof code !== 'string' || code.length === 0 || code.length > 2048) return fail(reply, flow.client, 'google')

    let claims
    try {
      const idToken = await deps.google.exchangeCode({ code, verifier: flow.verifier })
      claims = await deps.google.verifyIdToken(idToken, flow.nonce)
    } catch (e) {
      return fail(reply, flow.client, reasonFor(e))
    }
    // Only now, after every Google check, does anything exist: a one-time code. No session or token yet.
    const exchange = await createExchangeCode({ uid: `g:${claims.sub}`, email: claims.email, familyId: randomUUID(), client: flow.client })
    if (flow.client === 'app') return reply.code(200).type('text/html; charset=utf-8').send(appPage(appScheme(), `code=${exchange}`))
    return reply.code(302).header('Location', webRedirectUrl(oauthConfig().webOrigin, flow.returnTo, { auth_code: exchange })).send()
  }))

  app.post('/api/oauth/exchange', limited, guarded(async (req, reply) => {
    const { code, client } = (req.body ?? {}) as { code?: unknown; client?: unknown }
    if (typeof code !== 'string' || !parseClient(client)) return reply.code(400).send({ error: 'invalid_request' })
    const identity = await redeemExchangeCode(code, client)
    if (!identity) return reply.code(401).send({ error: 'invalid_code' })
    const { refreshToken } = await startSession({ ...identity, userAgent: req.headers['user-agent'] })
    const { token, expiresIn } = await signAccessToken(identity)
    return reply.code(200).send({ accessToken: token, refreshToken, expiresIn })
  }))

  app.post('/api/oauth/refresh', limited, guarded(async (req, reply) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: unknown }
    if (typeof refreshToken !== 'string') return reply.code(400).send({ error: 'invalid_request' })
    try {
      const next = await rotateRefreshToken(refreshToken, req.headers['user-agent'])
      const { token, expiresIn } = await signAccessToken(next)
      return reply.code(200).send({ accessToken: token, refreshToken: next.refreshToken, expiresIn })
    } catch (e) {
      if (e instanceof SessionError) return reply.code(401).send({ error: 'session_expired' }) // same body for invalid / reuse / not_amnex
      throw e
    }
  }))

  app.post('/api/oauth/logout', limited, guarded(async (req, reply) => {
    await revokeFamilyByRefreshToken(((req.body ?? {}) as { refreshToken?: unknown }).refreshToken)
    return reply.code(204).send()
  }))
}
```

`apps/api/src/app.ts` — three edits:

```ts
// imports (top)
import { googleGateway, type GoogleGateway } from './auth/oauth/googleClient.js'
import { registerOAuthRoutes } from './auth/oauth/routes.js'

// BuildAppOptions: add
  // Override for tests only — the real Google gateway is used in every deployed process.
  oauth?: { google?: GoogleGateway }

// after `await app.register(rateLimit, {...})` and before `app.register(fastifyTRPCPlugin, ...)`:
  // Google OAuth login (docs/superpowers/specs/2026-10-06-google-oauth-login-design.md). Every handler answers 404 unless
  // AUTH_PROVIDER is `both` or `oauth`, so registering it is a no-op in the default `firebase` mode.
  registerOAuthRoutes(app, { google: opts.oauth?.google ?? googleGateway })
```

- [ ] **Step 4: Run to verify it passes**

Run: `apitest src/auth/oauth/routes.test.ts src/app.test.ts`
Expected: PASS. (`app.test.ts` proves the existing app tests are unaffected.)


- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/oauth/routes.ts apps/api/src/auth/oauth/routes.test.ts apps/api/src/app.ts
git commit -m "feat(oauth): /api/oauth routes (404 unless AUTH_PROVIDER enables them)"
```

---

### Task 8: The `verifyIdentity` seam and call-site swap

**Files:**
- Modify: `apps/api/src/auth/identity.ts` (add `verifyIdentity`), `apps/api/src/trpc.ts` (2 sites, lines ~76 and ~108), `apps/api/src/auth/rbac/guard.ts` (~31), `apps/api/src/routers/auth.ts` (~25), `apps/api/src/auth/verifyAdminImportToken.ts` (~12)
- Test: `apps/api/src/auth/oauth/identitySeam.test.ts`, `apps/api/src/auth/oauth/identitySeam.rbac.test.ts`

**Interfaces:**
- Consumes: `authProvider`/`gomsAccepted`/`firebaseAccepted`, `isGomsToken`, `verifyAccessToken`, `AccessTokenError`.
- Produces: `verifyIdentity(authHeader: string | undefined): Promise<AuthenticatedUser>` — same type and same error codes/messages as `verifyFirebaseToken`. `verifyFirebaseToken` stays exported and unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/auth/oauth/identitySeam.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeIdToken } from '../../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { signAccessToken } from './accessToken.js'
import { verifyAdminImportToken } from '../verifyAdminImportToken.js'
import { verifyIdentity } from '../identity.js'

afterEach(() => { clearOauthEnv(); delete process.env.ADMIN_IMPORT_ALLOWED_EMAILS })
const firebase = (email = 'someone@amnex.com') => `Bearer ${fakeIdToken({ uid: 'fb-1', email })}`
const goms = async (email = 'someone@amnex.com') => (await gomsContextForEmail(email, 'g:1')).authHeader

describe.each([
  ['firebase', true, false], ['both', true, true], ['oauth', false, true],
] as const)('verifyIdentity with AUTH_PROVIDER=%s', (provider, acceptsFirebase, acceptsGoms) => {
  beforeEach(() => useOauthEnv(provider))

  it(`${acceptsFirebase ? 'accepts' : 'rejects'} a Firebase token`, async () => {
    const r = verifyIdentity(firebase())
    if (acceptsFirebase) await expect(r).resolves.toEqual({ uid: 'fb-1', email: 'someone@amnex.com' })
    else await expect(r).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it(`${acceptsGoms ? 'accepts' : 'rejects'} a GOMS token`, async () => {
    const r = verifyIdentity(await goms())
    if (acceptsGoms) await expect(r).resolves.toEqual({ uid: 'g:1', email: 'someone@amnex.com' })
    else await expect(r).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it('keeps today\'s errors for a missing header and for garbage', async () => {
    await expect(verifyIdentity(undefined)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
    await expect(verifyIdentity('Bearer not-a-real-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(verifyIdentity('Basic abc')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('GOMS tokens in `both` never fall through to Firebase', () => {
  beforeEach(() => useOauthEnv('both'))
  it('an expired GOMS token is "session expired", not a second chance as a Firebase token', async () => {
    const { token } = await signAccessToken({ uid: 'g:1', email: 'a@amnex.com', familyId: '33333333-3333-3333-3333-333333333333' }, new Date(Date.now() - 3600_000))
    await expect(verifyIdentity(`Bearer ${token}`)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
  })
  it('a token claiming iss=goms but signed with another key is refused', async () => {
    process.env.AUTH_SESSION_SECRET = 'q'.repeat(40) // sign with one secret ...
    const { token } = await signAccessToken({ uid: 'g:1', email: 'a@amnex.com', familyId: '33333333-3333-3333-3333-333333333333' })
    useOauthEnv('both')                                  // ... verify with another
    await expect(verifyIdentity(`Bearer ${token}`)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('Admin Data Import allow-list works identically for both token kinds', () => {
  beforeEach(() => { useOauthEnv('both'); process.env.ADMIN_IMPORT_ALLOWED_EMAILS = 'admin@amnex.com' })
  it('allow-listed -> ok; anyone else -> FORBIDDEN, for Firebase and GOMS tokens alike', async () => {
    await expect(verifyAdminImportToken(firebase('admin@amnex.com'))).resolves.toMatchObject({ email: 'admin@amnex.com' })
    await expect(verifyAdminImportToken(await goms('admin@amnex.com'))).resolves.toMatchObject({ email: 'admin@amnex.com' })
    await expect(verifyAdminImportToken(firebase('rando@amnex.com'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(verifyAdminImportToken(await goms('rando@amnex.com'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
```

```ts
// apps/api/src/auth/oauth/identitySeam.rbac.test.ts
// RBAC must be BLIND to which kind of token carried the email: same roles, same decisions, same masks.
import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appRouter } from '../../index.js'
import { contextForEmail } from '../../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { addSalesPerson, cleanupRbacFixtures, makeBid, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { RbacDenial } from '../rbac/denial.js'

const callers = async (label: string) => ({
  firebase: appRouter.createCaller(contextForEmail(rbacEmail(label))),
  goms: appRouter.createCaller(await gomsContextForEmail(rbacEmail(label))),
})
const outcome = async (p: Promise<unknown>) => p.then(() => 'allowed', (e) => (e instanceof TRPCError ? `${e.code}${e.cause instanceof RbacDenial ? ':rbac' : ''}` : 'thrown'))

beforeEach(async () => {
  await cleanupRbacFixtures()
  useOauthEnv('both')
  process.env.AUTH_ENFORCEMENT_ENABLED = 'true'; process.env.RBAC_MODE = 'enforce'
  await addSalesPerson('sales'); await setRole('legal', 'legal'); await setRole('it', 'it'); makeSystemAdmin('root')
})
afterEach(async () => {
  delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE; delete process.env.ADMIN_ALLOWED_EMAILS
  clearOauthEnv(); await cleanupRbacFixtures()
})

describe('RBAC enforce: a Firebase token and a GOMS token for the same email get the same answer', () => {
  it.each(['sales', 'legal', 'it', 'root', 'nobody'])('%s', async (label) => {
    const { opportunityId } = await makeBid({ withBid: false })
    const { firebase, goms } = await callers(label)
    for (const call of [
      (c: typeof firebase) => c.bids.listForGrid(),
      (c: typeof firebase) => c.opportunities.update({ id: opportunityId, patch: { city: 'Pune' } }),
      (c: typeof firebase) => c.access.listOverrides(),
      (c: typeof firebase) => c.auth.me(),
    ]) {
      expect(await outcome(call(goms)), label).toBe(await outcome(call(firebase)))
    }
  })
  it('auth.me reports identical roles and facts for both token kinds', async () => {
    const { firebase, goms } = await callers('legal')
    expect(await goms.auth.me()).toEqual(await firebase.auth.me())
    expect((await goms.auth.me()).roles).toEqual(['legal'])
  })
  it('a GOMS token for a non-@amnex.com email is still refused by the existing domain gate', async () => {
    const ctx = await gomsContextForEmail('person@gmail.com')
    expect(await outcome(appRouter.createCaller(ctx).bids.listForGrid())).toBe('FORBIDDEN')
  })
  it('System Admin membership still comes only from ADMIN_ALLOWED_EMAILS (a token cannot claim it)', async () => {
    const { goms } = await callers('legal')
    expect((await goms.auth.me()).roles).not.toContain('system_admin')
    expect((await (await callers('root')).goms.auth.me()).roles).toEqual(['system_admin'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `apitest src/auth/oauth/identitySeam.test.ts src/auth/oauth/identitySeam.rbac.test.ts`
Expected: FAIL (`verifyIdentity` is not exported).

- [ ] **Step 3: Implement**

Add to `apps/api/src/auth/identity.ts` (below `verifyFirebaseToken`; add imports at the top):

```ts
import { AccessTokenError, isGomsToken, verifyAccessToken } from './oauth/accessToken.js'
import { authProvider, firebaseAccepted, gomsAccepted } from './oauth/config.js'

/** The ONE place identity is established (RBAC spec §3.4 / OAuth spec §4.1). Returns the same `{uid, email}` whichever kind of
 *  token carried it, so authorisation downstream (the @amnex.com gate, RBAC roles, allow-lists, Admin Data Import) cannot tell.
 *    firebase: Firebase only (today's behaviour).   both: GOMS token or Firebase token.   oauth: GOMS only.
 *  A GOMS-looking token is verified as GOMS and never falls through to Firebase. */
export async function verifyIdentity(authHeader: string | undefined): Promise<AuthenticatedUser> {
  if (authProvider() === 'firebase') return verifyFirebaseToken(authHeader)
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  if (!token) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
  if (gomsAccepted() && isGomsToken(token)) {
    try {
      const c = await verifyAccessToken(token)
      return { uid: c.uid, email: c.email }
    } catch (e) {
      if (e instanceof AccessTokenError) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
      throw e
    }
  }
  if (firebaseAccepted()) return verifyFirebaseToken(authHeader)
  throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' })
}
```

Then swap the call sites (import `verifyIdentity` instead of `verifyFirebaseToken`; call it with the same argument):
- `apps/api/src/trpc.ts` — the import on line 3 and the two `await verifyFirebaseToken(ctx.authHeader)` calls (`protectedProcedure`, `protectedReadProcedure`).
- `apps/api/src/auth/rbac/guard.ts` — import and `verifyFirebaseToken(ctx.authHeader)` in `evaluateCall`.
- `apps/api/src/routers/auth.ts` — import and `verifyFirebaseToken(ctx.authHeader)` in `me`.
- `apps/api/src/auth/verifyAdminImportToken.ts` — import and the call (also update its doc comment to say "verifyIdentity").

Do not change any behaviour, message or error code beyond the function name.

- [ ] **Step 4: Run to verify they pass, and prove the swap is behaviour-neutral by default**

```bash
apitest src/auth/oauth/identitySeam.test.ts src/auth/oauth/identitySeam.rbac.test.ts
apitest src/auth/identity.test.ts src/trpc.test.ts src/auth src/routers/auth.test.ts
```
Expected: PASS. Then run the **entire** API suite with `AUTH_PROVIDER` unset: `apitest` → all pre-existing tests still pass (baseline 973 + the new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/identity.ts apps/api/src/trpc.ts apps/api/src/auth/rbac/guard.ts apps/api/src/routers/auth.ts apps/api/src/auth/verifyAdminImportToken.ts apps/api/src/auth/oauth/identitySeam.test.ts apps/api/src/auth/oauth/identitySeam.rbac.test.ts
git commit -m "feat(oauth): verifyIdentity seam (firebase|both|oauth) replacing verifyFirebaseToken at all call sites"
```

---

## Phase B — Clients

### Task 9: Client auth facade with the Firebase implementation (no behaviour change)

**Files:**
- Create: `src/lib/auth/types.ts`, `src/lib/auth/firebaseProvider.ts`, `src/lib/auth/authApi.ts`, `src/lib/auth/useAuthUser.ts`, `src/lib/auth/index.ts`
- Modify: `src/data/remote/authHeaders.ts`, `src/modules/admin-data-import/api.ts`, `src/components/AuthStatus.tsx`, `src/components/AuthPromptDialog.tsx`, `src/modules/admin-data-import/auth/AdminImportAuthGate.tsx`, `src/modules/admin-data-import/AdminImportModal.tsx`, `src/vite-env.d.ts`
- Test: `src/lib/auth/firebaseProvider.test.ts`, `src/lib/auth/useAuthUser.test.tsx`; all existing tests for the modified files must still pass **unchanged**.

**Interfaces:**
- Produces (used by Tasks 10–13):
  - `interface AuthUser { email: string | null; displayName: string | null; photoUrl: string | null }`
  - `interface AuthProviderApi { kind: 'firebase' | 'oauth'; readonly configured: boolean; subscribe(cb: (user: AuthUser | null, loading: boolean) => void): () => void; signIn(): Promise<void>; signOut(): Promise<void>; getAuthorizationHeaders(): Promise<Record<string, string>>; fetch: typeof fetch; bootstrap(): Promise<void> }`
  - `authApi: AuthProviderApi` and `AUTH_KIND` from `src/lib/auth/authApi.ts` (re-exported by `index.ts`); `useAuthUser(): { user: AuthUser | null; loading: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/auth/firebaseProvider.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fb } = vi.hoisted(() => ({ fb: { auth: null as null | { currentUser: null | { getIdToken: () => Promise<string> } }, listeners: [] as ((u: unknown) => void)[], signIn: vi.fn(), signOut: vi.fn() } }))
vi.mock('@/lib/firebaseAuth', () => ({ get auth() { return fb.auth }, googleProvider: { id: 'google' } }))
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => { fb.listeners.push(cb); return () => {} },
  signInWithPopup: (...a: unknown[]) => fb.signIn(...a),
  signOut: (...a: unknown[]) => fb.signOut(...a),
}))
import { firebaseProvider } from './firebaseProvider'

beforeEach(() => { fb.auth = { currentUser: null }; fb.listeners.length = 0; fb.signIn.mockReset(); fb.signOut.mockReset() })

describe('firebaseProvider (must behave exactly like the pre-facade code)', () => {
  it('is configured only when Firebase is', () => {
    expect(firebaseProvider.configured).toBe(true)
    fb.auth = null
    expect(firebaseProvider.configured).toBe(false)
  })
  it('maps a Firebase user and reports loading=false once Firebase answers', () => {
    const seen: unknown[] = []
    firebaseProvider.subscribe((u, loading) => seen.push([u, loading]))
    fb.listeners[0]({ email: 'a@amnex.com', displayName: 'Asha', photoURL: 'p.png' })
    fb.listeners[0](null)
    expect(seen).toEqual([[{ email: 'a@amnex.com', displayName: 'Asha', photoUrl: 'p.png' }, false], [null, false]])
  })
  it('with no Firebase config: immediately signed-out and not loading (never throws)', () => {
    fb.auth = null
    const seen: unknown[] = []
    firebaseProvider.subscribe((u, l) => seen.push([u, l]))
    expect(seen).toEqual([[null, false]])
  })
  it('signIn opens the Google popup; signOut signs out; both are no-ops without Firebase', async () => {
    await firebaseProvider.signIn(); expect(fb.signIn).toHaveBeenCalledWith(fb.auth, { id: 'google' })
    await firebaseProvider.signOut(); expect(fb.signOut).toHaveBeenCalledWith(fb.auth)
    fb.auth = null; fb.signIn.mockReset()
    await firebaseProvider.signIn(); expect(fb.signIn).not.toHaveBeenCalled()
  })
  it('authorization headers: Bearer <Firebase ID token>, or {} when signed out / refresh fails / unconfigured', async () => {
    await expect(firebaseProvider.getAuthorizationHeaders()).resolves.toEqual({})
    fb.auth = { currentUser: { getIdToken: async () => 'id-tok' } }
    await expect(firebaseProvider.getAuthorizationHeaders()).resolves.toEqual({ Authorization: 'Bearer id-tok' })
    fb.auth = { currentUser: { getIdToken: async () => { throw new Error('revoked') } } }
    await expect(firebaseProvider.getAuthorizationHeaders()).resolves.toEqual({})
    fb.auth = null
    await expect(firebaseProvider.getAuthorizationHeaders()).resolves.toEqual({})
  })
})
```

```tsx
// src/lib/auth/useAuthUser.test.tsx
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { api } = vi.hoisted(() => ({ api: { cb: null as null | ((u: unknown, l: boolean) => void), configured: true } }))
vi.mock('./authApi', () => ({
  authApi: { get configured() { return api.configured }, subscribe: (cb: (u: unknown, l: boolean) => void) => { api.cb = cb; return () => { api.cb = null } } },
}))
import { useAuthUser } from './useAuthUser'

describe('useAuthUser', () => {
  it('starts loading when configured, then follows the provider', () => {
    api.configured = true
    const { result, unmount } = renderHook(() => useAuthUser())
    expect(result.current).toEqual({ user: null, loading: true })
    act(() => api.cb!({ email: 'a@amnex.com', displayName: null, photoUrl: null }, false))
    expect(result.current).toEqual({ user: { email: 'a@amnex.com', displayName: null, photoUrl: null }, loading: false })
    unmount(); expect(api.cb).toBeNull()
  })
  it('is not loading when sign-in is not configured', () => {
    api.configured = false
    expect(renderHook(() => useAuthUser()).result.current).toEqual({ user: null, loading: false })
  })
})
```

> `useAuthUser.test.tsx` runs under the **component** config (`vitest.component.config.ts`); `firebaseProvider.test.ts` under the unit config.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/auth/firebaseProvider.test.ts` and `npx vitest run --config vitest.component.config.ts src/lib/auth/useAuthUser.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the facade**

```ts
// src/lib/auth/types.ts
export interface AuthUser { email: string | null; displayName: string | null; photoUrl: string | null }

/** What the rest of the app may know about "who is signed in". Firebase and the GOMS OAuth session both implement it,
 *  and `VITE_AUTH_PROVIDER` picks one at build time. */
export interface AuthProviderApi {
  readonly kind: 'firebase' | 'oauth'
  /** False when this build cannot sign anyone in (no Firebase config / no API base URL). */
  readonly configured: boolean
  /** `loading` is true until the provider knows whether anyone is signed in. Returns an unsubscribe function. */
  subscribe(cb: (user: AuthUser | null, loading: boolean) => void): () => void
  signIn(): Promise<void>
  signOut(): Promise<void>
  getAuthorizationHeaders(): Promise<Record<string, string>>
  /** The `fetch` the tRPC links use (the OAuth provider adds one refresh-and-retry on a 401). */
  fetch: typeof fetch
  /** Runs once at startup, before the first render needs identity. */
  bootstrap(): Promise<void>
}
```

```ts
// src/lib/auth/firebaseProvider.ts
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebaseAuth'
import type { AuthProviderApi, AuthUser } from './types'

const toUser = (u: User): AuthUser => ({ email: u.email, displayName: u.displayName, photoUrl: u.photoURL })

/** The existing Firebase behaviour, unchanged, behind the facade. */
export const firebaseProvider: AuthProviderApi = {
  kind: 'firebase',
  get configured() { return Boolean(auth) },
  subscribe(cb) {
    if (!auth) { cb(null, false); return () => {} }
    return onAuthStateChanged(auth, (u) => cb(u ? toUser(u) : null, false))
  },
  async signIn() { if (auth) await signInWithPopup(auth, googleProvider) },
  async signOut() { if (auth) await signOut(auth) },
  // getIdToken() transparently refreshes a token that is about to expire; if the user is signed out or the refresh fails
  // the request simply goes out unauthenticated and the server's 401/403 triggers the sign-in prompt.
  async getAuthorizationHeaders() {
    try {
      const token = await auth?.currentUser?.getIdToken()
      return token ? { Authorization: `Bearer ${token}` } : {}
    } catch {
      return {}
    }
  },
  fetch: (...args) => globalThis.fetch(...args),
  async bootstrap() {},
}
```

```ts
// src/lib/auth/useAuthUser.ts
import { useEffect, useState } from 'react'
import { authApi } from './authApi'
import type { AuthUser } from './types'

export function useAuthUser(): { user: AuthUser | null; loading: boolean } {
  const [state, setState] = useState<{ user: AuthUser | null; loading: boolean }>({ user: null, loading: authApi.configured })
  useEffect(() => authApi.subscribe((user, loading) => setState({ user, loading })), [])
  return state
}
```

```ts
// src/lib/auth/authApi.ts
import { firebaseProvider } from './firebaseProvider'
import type { AuthProviderApi } from './types'

/** Chosen at build time. Only 'oauth' switches it on; anything else (including unset) is Firebase — the default and a no-op. */
export const AUTH_KIND: 'firebase' | 'oauth' = import.meta.env.VITE_AUTH_PROVIDER === 'oauth' ? 'oauth' : 'firebase'
export const authApi: AuthProviderApi = firebaseProvider
```

```ts
// src/lib/auth/index.ts
export { AUTH_KIND, authApi } from './authApi'
export { useAuthUser } from './useAuthUser'
export type { AuthUser, AuthProviderApi } from './types'
```

`src/vite-env.d.ts`: add `readonly VITE_AUTH_PROVIDER?: string` to `ImportMetaEnv` (follow the file's existing pattern).

- [ ] **Step 4: Switch the consumers to the facade** (mechanical; keep every visible string and behaviour)

1. `src/data/remote/authHeaders.ts` — body becomes `export const getAuthHeaders = () => authApi.getAuthorizationHeaders()` (keep the doc comment; import `authApi` from `@/lib/auth`). **Note:** `authHeaders.test.ts` mocks `@/lib/firebaseAuth`; it must still pass untouched because `firebaseProvider` reads that module.
2. `src/modules/admin-data-import/api.ts` — replace `import { auth } from '@/lib/firebaseAuth'` with `import { authApi } from '@/lib/auth'`; the `headers:` option becomes `headers: () => authApi.getAuthorizationHeaders()`; add `fetch: authApi.fetch`.
3. `src/data/remote/repository.ts` line ~39 — `httpBatchLink({ url: …, headers: getAuthHeaders, fetch: authApi.fetch })` (import `authApi`).
4. `src/components/AuthStatus.tsx` — replace the `useState<User>` + `onAuthStateChanged` effect with `const { user } = useAuthUser()`; `if (!authApi.configured) return null`; sign-out calls `void authApi.signOut()`; use `user.email`, `user.displayName`, `user.photoUrl` (was `photoURL`). Remove the `firebase/auth` and `firebaseAuth` imports.
5. `src/components/AuthPromptDialog.tsx` — same: `const { user } = useAuthUser()`; `handleSignIn` → `authApi.signIn().catch(() => setSignInError(true))`; `!auth` → `!authApi.configured`; `{user?.email}` unchanged; keep the refetch-errored-queries effect keyed on `user`.
6. `src/modules/admin-data-import/auth/AdminImportAuthGate.tsx` — `useAdminImportUser` becomes `useAuthUser`; type `User` → `AuthUser`; `AccountName` uses `user.photoUrl`; sign-in → `authApi.signIn()`; sign-out → `authApi.signOut()`; `!auth` → `!authApi.configured`; `onPhaseChange(phase, user: AuthUser | null)`.
7. `src/modules/admin-data-import/AdminImportModal.tsx` — drop `signOut`/`auth` imports; `onSignOut={() => { void authApi.signOut(); handleClose() }}`; adjust the `user` type from `User` to `AuthUser`.

- [ ] **Step 5: Run everything that touches these files**

```bash
npx tsc -b
npx vitest run src/lib/auth src/data/remote
npx vitest run --config vitest.component.config.ts src/lib/auth src/components src/modules/admin-data-import src/app
```
Expected: `tsc` clean; all PASS. The pre-existing tests (`AuthPromptDialog.test.tsx`, `AdminImportAuthGate.test.tsx`, `AdminImportModal.test.tsx`, `authHeaders.test.ts`, `api.test.ts`) pass **without edits** — if one needs an edit, the facade changed behaviour; fix the facade instead. (A test that asserts on `photoURL` of a Firebase `User` mock may need the fixture key adjusted — that is the only acceptable test change, and only if the assertion is about the mapped field.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth src/data/remote src/modules/admin-data-import src/components/AuthStatus.tsx src/components/AuthPromptDialog.tsx src/vite-env.d.ts
git commit -m "refactor(auth): client auth facade with the Firebase implementation (no behaviour change)"
```

---

### Task 10: Session core — single-flight, cross-tab lock, refresh, offline safety

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/stores.ts`
- Test: `src/lib/auth/session.test.ts`

**Interfaces:**
- Consumes: HTTP contract of Task 7.
- Produces:
  - `interface TokenStore { get(): Promise<string | null>; set(token: string): Promise<void>; clear(): Promise<void> }`
  - `interface LockManagerLike { request<T>(name: string, cb: () => Promise<T>): Promise<T> }`
  - `createSession(deps: { apiBase: string; fetchFn: typeof fetch; store: TokenStore; locks: LockManagerLike | null; now: () => number }): Session` where `Session` exposes `subscribe(cb: (user: { email: string } | null, loading: boolean) => void): () => void`, `init(): Promise<void>`, `getAccessToken(): Promise<string | null>`, `forceRefresh(): Promise<string | null>`, `redeem(code: string, client: 'web' | 'app'): Promise<void>`, `signOut(): Promise<void>`.
  - `createLocalStorageStore(key?: string): TokenStore` (in `stores.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/session.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createLocalStorageStore } from './stores'
import { createSession, type LockManagerLike, type TokenStore } from './session'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (email: string, expSec: number) => `${b64({ alg: 'HS256' })}.${b64({ email, exp: expSec })}.sig`
const memoryStore = (initial: string | null = null): TokenStore & { value: string | null } => {
  const s = { value: initial, get: async () => s.value, set: async (t: string) => { s.value = t }, clear: async () => { s.value = null } }
  return s
}
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(opts: { store?: ReturnType<typeof memoryStore>; locks?: LockManagerLike | null; fetchFn?: typeof fetch; nowMs?: number } = {}) {
  const store = opts.store ?? memoryStore('R1')
  const clock = { t: opts.nowMs ?? 1_000_000 }
  const fetchFn = opts.fetchFn ?? vi.fn(async () => json(500))
  const session = createSession({ apiBase: 'https://api.test', fetchFn: fetchFn as typeof fetch, store, locks: opts.locks ?? null, now: () => clock.t })
  return { store, clock, fetchFn: fetchFn as ReturnType<typeof vi.fn>, session }
}
const fresh = (email = 'a@amnex.com', ms = 1_000_000) => jwt(email, Math.floor(ms / 1000) + 900)

describe('init / getAccessToken', () => {
  it('with a stored refresh token it refreshes once at startup and reports the signed-in user', async () => {
    const f = vi.fn(async () => json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }))
    const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
    const seen: unknown[] = []
    session.subscribe((u, l) => seen.push([u, l]))
    await session.init()
    expect(store.value).toBe('R2')
    expect(seen.at(-1)).toEqual([{ email: 'a@amnex.com' }, false])
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({ refreshToken: 'R1' })
  })
  it('with nothing stored it is signed out and does not call the network', async () => {
    const { session, fetchFn } = setup({ store: memoryStore(null) })
    await session.init()
    expect(await session.getAccessToken()).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('serves the in-memory access token until 60 s before expiry, then refreshes', async () => {
    let n = 0
    const f = vi.fn(async () => json(200, { accessToken: fresh(`u${++n}@amnex.com`), refreshToken: `R${n + 1}`, expiresIn: 900 }))
    const { session, clock } = setup({ fetchFn: f as unknown as typeof fetch })
    await session.init()
    expect(f).toHaveBeenCalledTimes(1)
    clock.t += 800_000
    await session.getAccessToken(); expect(f).toHaveBeenCalledTimes(1)          // 100 s left: still served
    clock.t += 45_000
    await session.getAccessToken(); expect(f).toHaveBeenCalledTimes(2)          // 55 s left: refreshed
  })
})

describe('single-flight and cross-tab lock', () => {
  it('a batch of simultaneous callers causes ONE refresh request', async () => {
    let resolve!: (r: Response) => void
    const f = vi.fn(() => new Promise<Response>((r) => { resolve = r }))
    const { session } = setup({ fetchFn: f as unknown as typeof fetch })
    const calls = [session.forceRefresh(), session.forceRefresh(), session.forceRefresh()]
    await Promise.resolve()
    resolve(json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }))
    const tokens = await Promise.all(calls)
    expect(f).toHaveBeenCalledTimes(1)
    expect(new Set(tokens).size).toBe(1)
  })
  it('takes the navigator.locks lock named goms-auth-refresh and re-reads the stored token INSIDE it', async () => {
    const order: string[] = []
    const locks: LockManagerLike = { request: async (name, cb) => { order.push(`lock:${name}`); return cb() } }
    const store = memoryStore('R1')
    const f = vi.fn(async (_u: unknown, init: RequestInit) => { order.push(`post:${JSON.parse(init.body as string).refreshToken}`); return json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }) })
    const { session } = setup({ store, locks, fetchFn: f as unknown as typeof fetch })
    // another tab rotated the token while this one waited for the lock
    const realGet = store.get; store.get = async () => { order.push('read'); return realGet() }
    await session.forceRefresh()
    expect(order).toEqual(['lock:goms-auth-refresh', 'read', 'post:R1'])
  })
  it('two "tabs" sharing one store and a real mutual-exclusion lock rotate sequentially: the second uses the first one\'s new token, so nothing is reused', async () => {
    const store = memoryStore('R1')
    let chain: Promise<unknown> = Promise.resolve()
    const mutex: LockManagerLike = { request: (_n, cb) => { const r = chain.then(cb); chain = r.catch(() => {}); return r as Promise<never> } }
    let gen = 1
    const valid = new Set(['R1'])
    const server = vi.fn(async (_u: unknown, init: RequestInit) => {
      const sent = JSON.parse(init.body as string).refreshToken as string
      if (!valid.has(sent)) return json(401)
      valid.delete(sent); const next = `R${++gen}`; valid.add(next)
      return json(200, { accessToken: fresh(), refreshToken: next, expiresIn: 900 })
    })
    const a = setup({ store, locks: mutex, fetchFn: server as unknown as typeof fetch }).session
    const b = setup({ store, locks: mutex, fetchFn: server as unknown as typeof fetch }).session
    const [ta, tb] = await Promise.all([a.forceRefresh(), b.forceRefresh()])
    expect(ta).toBeTruthy(); expect(tb).toBeTruthy()
    expect(store.value).toBe('R3')
    expect(server).toHaveBeenCalledTimes(2)
  })
  it('works without navigator.locks (single-flight only)', async () => {
    const { session } = setup({ locks: null, fetchFn: vi.fn(async () => json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 })) as unknown as typeof fetch })
    await expect(session.forceRefresh()).resolves.toBeTruthy()
  })
})

describe('failure handling', () => {
  it('a 401 from the server means the session is gone: the stored token is cleared and the user is signed out', async () => {
    const { session, store } = setup({ fetchFn: vi.fn(async () => json(401, { error: 'session_expired' })) as unknown as typeof fetch })
    const seen: unknown[] = []
    session.subscribe((u) => seen.push(u))
    await session.init()
    expect(store.value).toBeNull()
    expect(seen.at(-1)).toBeNull()
  })
  it('a NETWORK failure or a 5xx must NOT wipe the stored refresh token (offline is not revoked)', async () => {
    for (const f of [vi.fn(async () => { throw new TypeError('offline') }), vi.fn(async () => json(503))]) {
      const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
      await expect(session.forceRefresh()).resolves.toBeNull()
      expect(store.value).toBe('R1')
    }
  })
  it('a failed refresh does not poison later ones (the in-flight slot is released)', async () => {
    let n = 0
    const f = vi.fn(async () => (++n === 1 ? json(503) : json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 })))
    const { session } = setup({ fetchFn: f as unknown as typeof fetch })
    expect(await session.forceRefresh()).toBeNull()
    expect(await session.forceRefresh()).toBeTruthy()
  })
})

describe('redeem (web handoff / app deep link) and sign-out', () => {
  it('exchanges the one-time code with the client kind, stores only the refresh token, and signs the user in', async () => {
    const f = vi.fn(async () => json(200, { accessToken: fresh('z@amnex.com'), refreshToken: 'RX', expiresIn: 900 }))
    const { session, store } = setup({ store: memoryStore(null), fetchFn: f as unknown as typeof fetch })
    await session.redeem('CODE', 'web')
    expect(f.mock.calls[0][0]).toBe('https://api.test/api/oauth/exchange')
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({ code: 'CODE', client: 'web' })
    expect(store.value).toBe('RX')
    expect(await session.getAccessToken()).toBeTruthy()
  })
  it('a rejected code throws and leaves the user signed out', async () => {
    const { session, store } = setup({ store: memoryStore(null), fetchFn: vi.fn(async () => json(401)) as unknown as typeof fetch })
    await expect(session.redeem('BAD', 'web')).rejects.toThrow()
    expect(store.value).toBeNull()
  })
  it('signOut clears local state first, then tells the server (best effort)', async () => {
    const f = vi.fn(async () => json(204))
    const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
    await session.signOut()
    expect(store.value).toBeNull()
    expect(f.mock.calls[0][0]).toBe('https://api.test/api/oauth/logout')
    const failing = setup({ fetchFn: vi.fn(async () => { throw new Error('down') }) as unknown as typeof fetch })
    await expect(failing.session.signOut()).resolves.toBeUndefined()
    expect(failing.store.value).toBeNull()
  })
})

describe('localStorage store', () => {
  it('round-trips under one key and clears', async () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) })
    const s = createLocalStorageStore('k')
    expect(await s.get()).toBeNull()
    await s.set('T'); expect(await s.get()).toBe('T')
    await s.clear(); expect(await s.get()).toBeNull()
    vi.unstubAllGlobals()
  })
  it('never throws when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    const s = createLocalStorageStore('k')
    expect(await s.get()).toBeNull()
    await expect(s.set('T')).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/auth/stores.ts
import type { TokenStore } from './session'

/** Web refresh-token storage. The access token is never stored. Blocked storage degrades to "signed out", never to a crash. */
export function createLocalStorageStore(key = 'goms.auth.refresh'): TokenStore {
  return {
    async get() { try { return localStorage.getItem(key) } catch { return null } },
    async set(token) { try { localStorage.setItem(key, token) } catch { /* private mode / blocked: stay signed in for this page only */ } },
    async clear() { try { localStorage.removeItem(key) } catch { /* nothing to clear */ } },
  }
}
```

```ts
// src/lib/auth/session.ts
export interface TokenStore { get(): Promise<string | null>; set(token: string): Promise<void>; clear(): Promise<void> }
export interface LockManagerLike { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
export interface SessionDeps {
  apiBase: string
  fetchFn: typeof fetch
  store: TokenStore
  /** `navigator.locks` on the web (cross-tab); null where unavailable (then only single-flight protects the token). */
  locks: LockManagerLike | null
  now: () => number
}
export interface SessionUser { email: string }
type Listener = (user: SessionUser | null, loading: boolean) => void

const REFRESH_SKEW_MS = 60_000
const LOCK_NAME = 'goms-auth-refresh'

function decodeAccess(jwt: string): { email: string; expiresAt: number } {
  const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  return { email: String(payload.email), expiresAt: Number(payload.exp) * 1000 }
}

/** The browser/app side of the GOMS session. Access token: memory only. Refresh token: the injected store. Pure of globals so it
 *  is unit-testable; `oauthProvider.ts` wires the real fetch, storage and locks. */
export function createSession(deps: SessionDeps) {
  let access: { token: string; expiresAt: number; email: string } | null = null
  let loading = true
  let inflight: Promise<string | null> | null = null
  let ready: Promise<void> = Promise.resolve()
  const listeners = new Set<Listener>()
  const emit = () => listeners.forEach((l) => l(access ? { email: access.email } : null, loading))
  const setAccess = (token: string) => { access = { token, ...decodeAccess(token) } }
  const post = (path: string, body: unknown) =>
    deps.fetchFn(`${deps.apiBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  /** One rotation. Reads the stored token INSIDE the lock so a refresh by another tab is never replayed. */
  async function rotate(): Promise<string | null> {
    const refreshToken = await deps.store.get()
    if (!refreshToken) { access = null; emit(); return null }
    let res: Response
    try { res = await post('/api/oauth/refresh', { refreshToken }) } catch { return null }   // offline: keep everything, try later
    if (res.status === 401 || res.status === 400) { await deps.store.clear(); access = null; emit(); return null } // genuinely gone
    if (!res.ok) return null                                                                   // 5xx: transient, keep the token
    const body = (await res.json()) as { accessToken: string; refreshToken: string }
    await deps.store.set(body.refreshToken)
    setAccess(body.accessToken)
    emit()
    return body.accessToken
  }

  /** Single-flight within the tab; navigator.locks serialises across tabs. */
  function refresh(): Promise<string | null> {
    inflight ??= (deps.locks ? deps.locks.request(LOCK_NAME, rotate) : rotate()).finally(() => { inflight = null })
    return inflight
  }

  return {
    subscribe(cb: Listener): () => void { listeners.add(cb); cb(access ? { email: access.email } : null, loading); return () => { listeners.delete(cb) } },
    async init(): Promise<void> {
      ready = (async () => { try { if (await deps.store.get()) await refresh() } finally { loading = false; emit() } })()
      await ready
    },
    async getAccessToken(): Promise<string | null> {
      await ready
      if (access && access.expiresAt - deps.now() > REFRESH_SKEW_MS) return access.token
      return refresh()
    },
    forceRefresh: refresh,
    async redeem(code: string, client: 'web' | 'app'): Promise<void> {
      const res = await post('/api/oauth/exchange', { code, client })
      if (!res.ok) throw new Error('Sign-in could not be completed.')
      const body = (await res.json()) as { accessToken: string; refreshToken: string }
      await deps.store.set(body.refreshToken)
      setAccess(body.accessToken)
      loading = false
      emit()
    },
    async signOut(): Promise<void> {
      const token = await deps.store.get()
      access = null
      emit()
      await deps.store.clear()
      if (token) { try { await post('/api/oauth/logout', { refreshToken: token }) } catch { /* the session expires on its own */ } }
    },
  }
}
export type Session = ReturnType<typeof createSession>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/session.ts src/lib/auth/stores.ts src/lib/auth/session.test.ts
git commit -m "feat(oauth): client session core with single-flight, navigator.locks and offline-safe refresh"
```

---

### Task 11: OAuth provider, `nativeShell`, 401 refresh-and-retry fetch, web sign-in

**Files:**
- Create: `src/lib/nativeShell.ts`, `src/lib/auth/errors.ts`, `src/lib/auth/authFetch.ts`, `src/lib/auth/oauthProvider.ts`
- Modify: `src/lib/auth/stores.ts`, `src/lib/auth/authApi.ts` (select the provider)
- Test: `src/lib/nativeShell.test.ts`, `src/lib/auth/authFetch.test.ts`, `src/lib/auth/stores.test.ts`, `src/lib/auth/oauthProvider.test.ts`

**Interfaces:**
- Consumes: `createSession`, `createLocalStorageStore`, `TokenStore`, `AuthProviderApi`.
- Produces:
  - `shellVersion(ua?): number | null`, `shellScheme(ua?): 'com.gorms.app' | 'com.gorms.app.dev' | null`, `isGomsShell(ua?): boolean`, `hasCapability(name: 'secureStorage' | 'browser' | 'appLinks', ua?, isPluginAvailable?): boolean`, `KNOWN_SHELL_SCHEMES` (the only place the web decides native availability, thin-shell §4.3).
  - `class ShellUpdateRequiredError extends Error` (`message === 'shell_update_required'`).
  - `createNativeStore(): TokenStore` (lazy), `createShellUpdateRequiredStore(): TokenStore`, `selectTokenStore(o: { inShell: boolean; secureStorage: boolean }): TokenStore`.
  - `createAuthFetch(session: { forceRefresh(): Promise<string | null> }, baseFetch?: typeof fetch): typeof fetch`; `oauthProvider: AuthProviderApi` (+ exported `session`, `inShell`); `authApi` selects by `AUTH_KIND`. The in-shell sign-in and deep-link bootstrap are added in Task 13.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/nativeShell.test.ts
import { describe, expect, it } from 'vitest'
import { KNOWN_SHELL_SCHEMES, hasCapability, isGomsShell, shellScheme, shellVersion } from './nativeShell'

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'
const SHELL2_PROD = `${CHROME} GOMSShell/2 GOMSScheme/com.gorms.app`
const SHELL2_DEV = `${CHROME} GOMSShell/2 GOMSScheme/com.gorms.app.dev`

describe('shell detection (a plain browser and an old APK are not the shell)', () => {
  it('reads the version and scheme the native shell appends to the user agent', () => {
    expect(shellVersion(SHELL2_PROD)).toBe(2); expect(shellScheme(SHELL2_PROD)).toBe('com.gorms.app'); expect(isGomsShell(SHELL2_PROD)).toBe(true)
    expect(shellScheme(SHELL2_DEV)).toBe('com.gorms.app.dev')
  })
  it('is null / false for a browser, the old bundled-app APK (no token) and garbage', () => {
    for (const ua of [CHROME, '', 'GOMSShell/', 'GOMSShell/x', 'XGOMSShell/2']) { expect(shellVersion(ua)).toBeNull(); expect(isGomsShell(ua)).toBe(false) }
  })
  it('only knows the two real schemes', () => {
    expect([...KNOWN_SHELL_SCHEMES]).toEqual(['com.gorms.app', 'com.gorms.app.dev'])
    expect(shellScheme(`${CHROME} GOMSShell/2 GOMSScheme/evil.app`)).toBeNull()
    expect(shellScheme(`${CHROME} GOMSShell/2`)).toBeNull()
  })
})

describe('hasCapability needs BOTH a shell new enough AND the plugin actually present', () => {
  const plugins = (...names: string[]) => (p: string) => names.includes(p)
  it('true only when version >= since and the plugin is available', () => {
    expect(hasCapability('secureStorage', SHELL2_PROD, plugins('SecureStorage'))).toBe(true)
    expect(hasCapability('browser', SHELL2_PROD, plugins('Browser'))).toBe(true)
    expect(hasCapability('appLinks', SHELL2_PROD, plugins('App'))).toBe(true)
  })
  it('false for a missing plugin, an older shell, or no shell at all', () => {
    expect(hasCapability('secureStorage', SHELL2_PROD, plugins())).toBe(false)
    expect(hasCapability('secureStorage', `${CHROME} GOMSShell/1 GOMSScheme/com.gorms.app`, plugins('SecureStorage'))).toBe(false)
    expect(hasCapability('secureStorage', CHROME, plugins('SecureStorage'))).toBe(false)
  })
})
```

```ts
// src/lib/auth/authFetch.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createAuthFetch } from './authFetch'

const res = (status: number) => new Response('{}', { status })
const hdr = (init?: RequestInit) => new Headers(init?.headers).get('Authorization')

describe('createAuthFetch', () => {
  it('passes a successful response straight through without touching the session', async () => {
    const base = vi.fn(async () => res(200)); const session = { forceRefresh: vi.fn() }
    await createAuthFetch(session, base as unknown as typeof fetch)('https://x/api/trpc/a', { headers: { Authorization: 'Bearer OLD' } })
    expect(session.forceRefresh).not.toHaveBeenCalled(); expect(base).toHaveBeenCalledTimes(1)
  })
  it('on a 401 refreshes ONCE and retries once with the new token, same method and body', async () => {
    const base = vi.fn().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200))
    const session = { forceRefresh: vi.fn(async () => 'NEW') }
    const r = await createAuthFetch(session, base as unknown as typeof fetch)('https://x/api/trpc/a', { method: 'POST', body: '{"batch":1}', headers: { Authorization: 'Bearer OLD', 'Content-Type': 'application/json' } })
    expect(r.status).toBe(200)
    expect(session.forceRefresh).toHaveBeenCalledTimes(1)
    const retry = base.mock.calls[1][1] as RequestInit
    expect(hdr(retry)).toBe('Bearer NEW'); expect(retry.method).toBe('POST'); expect(retry.body).toBe('{"batch":1}')
    expect(new Headers(retry.headers).get('Content-Type')).toBe('application/json')
  })
  it('returns the original 401 when the refresh fails (so the sign-in prompt appears) — and does not loop', async () => {
    const base = vi.fn(async () => res(401))
    const session = { forceRefresh: vi.fn(async () => null) }
    expect((await createAuthFetch(session, base as unknown as typeof fetch)('https://x', {})).status).toBe(401)
    expect(base).toHaveBeenCalledTimes(1)
  })
  it('a second 401 after a successful refresh is returned, not retried again', async () => {
    const base = vi.fn(async () => res(401)); const session = { forceRefresh: vi.fn(async () => 'NEW') }
    expect((await createAuthFetch(session, base as unknown as typeof fetch)('https://x', {})).status).toBe(401)
    expect(base).toHaveBeenCalledTimes(2)
  })
  it('only 401 triggers a refresh (403 / RBAC denials do not)', async () => {
    const base = vi.fn(async () => res(403)); const session = { forceRefresh: vi.fn() }
    await createAuthFetch(session, base as unknown as typeof fetch)('https://x', {})
    expect(session.forceRefresh).not.toHaveBeenCalled()
  })
})
```

```ts
// src/lib/auth/stores.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const { native } = vi.hoisted(() => ({ native: { value: null as string | null } }))
vi.mock('./native', () => ({
  createSecureTokenStore: () => ({ get: async () => native.value, set: async (t: string) => { native.value = t }, clear: async () => { native.value = null } }),
}))
import { ShellUpdateRequiredError } from './errors'
import { selectTokenStore } from './stores'

afterEach(() => { native.value = null; vi.unstubAllGlobals() })
const stubLocalStorage = () => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) })
  return data
}

describe('selectTokenStore', () => {
  it('a plain browser keeps the refresh token in localStorage', async () => {
    const data = stubLocalStorage()
    const store = selectTokenStore({ inShell: false, secureStorage: false })
    await store.set('R'); expect([...data.values()]).toEqual(['R'])
  })
  it('inside the shell with secure storage, tokens go to the secure store and NEVER to localStorage', async () => {
    const data = stubLocalStorage()
    const store = selectTokenStore({ inShell: true, secureStorage: true })
    await store.set('R'); expect(native.value).toBe('R'); expect(await store.get()).toBe('R'); expect(data.size).toBe(0)
    await store.clear(); expect(native.value).toBeNull()
  })
  it('inside an old shell WITHOUT secure storage there is no fallback: set throws, nothing is written anywhere', async () => {
    const data = stubLocalStorage()
    const store = selectTokenStore({ inShell: true, secureStorage: false })
    await expect(store.set('R')).rejects.toBeInstanceOf(ShellUpdateRequiredError)
    expect(await store.get()).toBeNull(); expect(data.size).toBe(0); expect(native.value).toBeNull()
    await expect(store.clear()).resolves.toBeUndefined()
  })
})
```

```ts
// src/lib/auth/oauthProvider.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ES imports are hoisted above plain statements, so the globals the module reads at load time must be stubbed inside vi.hoisted.
const { env } = vi.hoisted(() => {
  const assign = vi.fn()
  vi.stubGlobal('window', { location: { pathname: '/sales/roster', search: '?a=1', href: 'https://goms.test/sales/roster?a=1', origin: 'https://goms.test', assign }, history: { replaceState: vi.fn(), state: null } })
  vi.stubEnv('VITE_API_BASE_URL', 'https://goms.test/')
  return { env: { assign } }
})
vi.mock('@capacitor/core', () => ({ Capacitor: { isPluginAvailable: () => false } }))
import { inShell, oauthProvider } from './oauthProvider'

beforeEach(() => env.assign.mockReset())

describe('oauthProvider (plain browser)', () => {
  it('is not the shell, and is configured whenever an API base URL is set', () => {
    expect(inShell).toBe(false); expect(oauthProvider.configured).toBe(true); expect(oauthProvider.kind).toBe('oauth')
  })
  it('signIn navigates to /start with client=web and the CURRENT path as return_to (relative only)', async () => {
    await oauthProvider.signIn()
    const url = new URL(env.assign.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://goms.test/api/oauth/google/start')
    expect(url.searchParams.get('client')).toBe('web')
    expect(url.searchParams.get('return_to')).toBe('/sales/roster?a=1')
  })
  it('with no stored session, headers are {} and the user is signed out', async () => {
    await expect(oauthProvider.getAuthorizationHeaders()).resolves.toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/nativeShell.test.ts src/lib/auth/authFetch.test.ts src/lib/auth/stores.test.ts src/lib/auth/oauthProvider.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/nativeShell.ts
import { Capacitor } from '@capacitor/core'

/** The ONE place the web app decides whether it runs inside the GOMS Android shell and what that shell can do (thin-shell design
 *  §4.3). Other code must not call `Capacitor.isNativePlatform()` to decide native availability. If the thin-shell web phase already
 *  created this file, keep its API and add only what is missing. */
export const KNOWN_SHELL_SCHEMES = ['com.gorms.app', 'com.gorms.app.dev'] as const
export type ShellCapability = 'secureStorage' | 'browser' | 'appLinks'

/** `since` = the first shell versionCode that contains the native pieces; `plugin` = the Capacitor plugin that must also be present. */
const CAPABILITIES: Record<ShellCapability, { since: number; plugin: string }> = {
  secureStorage: { since: 2, plugin: 'SecureStorage' },
  browser: { since: 2, plugin: 'Browser' },
  appLinks: { since: 2, plugin: 'App' },
}
const currentUa = (): string => (typeof navigator === 'undefined' ? '' : navigator.userAgent)

export function shellVersion(ua: string = currentUa()): number | null {
  const m = /(?:^|\s)GOMSShell\/(\d+)(?:\s|$)/.exec(ua)
  return m ? Number(m[1]) : null
}
export function shellScheme(ua: string = currentUa()): (typeof KNOWN_SHELL_SCHEMES)[number] | null {
  const m = /(?:^|\s)GOMSScheme\/([a-z0-9.]+)(?:\s|$)/.exec(ua)
  return m && (KNOWN_SHELL_SCHEMES as readonly string[]).includes(m[1]) ? (m[1] as (typeof KNOWN_SHELL_SCHEMES)[number]) : null
}
export const isGomsShell = (ua?: string): boolean => shellVersion(ua) !== null

export function hasCapability(
  name: ShellCapability, ua: string = currentUa(), isPluginAvailable: (plugin: string) => boolean = (p) => Capacitor.isPluginAvailable(p),
): boolean {
  const version = shellVersion(ua)
  const c = CAPABILITIES[name]
  return version !== null && version >= c.since && isPluginAvailable(c.plugin)
}
```

```ts
// src/lib/auth/errors.ts
/** Thrown inside the Android shell when the installed APK predates the native pieces sign-in needs (secure storage, system browser,
 *  deep links). The shell never falls back to localStorage; the user must update the app. */
export class ShellUpdateRequiredError extends Error {
  constructor() { super('shell_update_required'); this.name = 'ShellUpdateRequiredError' }
}
```

Append to `src/lib/auth/stores.ts`:

```ts
import { ShellUpdateRequiredError } from './errors'

/** Android: the platform keystore. Each call loads `./native` on demand, so the web bundle and node tests never import the plugins eagerly. */
export function createNativeStore(): TokenStore {
  const real = () => import('./native').then((m) => m.createSecureTokenStore())
  return { get: async () => (await real()).get(), set: async (t) => (await real()).set(t), clear: async () => (await real()).clear() }
}

/** An old shell without secure storage: refuse to hold a token at all. Never localStorage. */
export function createShellUpdateRequiredStore(): TokenStore {
  return { async get() { return null }, async set() { throw new ShellUpdateRequiredError() }, async clear() {} }
}

export function selectTokenStore(o: { inShell: boolean; secureStorage: boolean }): TokenStore {
  if (!o.inShell) return createLocalStorageStore()
  return o.secureStorage ? createNativeStore() : createShellUpdateRequiredStore()
}
```

```ts
// src/lib/auth/authFetch.ts
/** One refresh-and-retry on a 401 (spec §5.1). Anything else — including a 403 RBAC denial — passes through untouched. The retry
 *  re-sends the same request (tRPC batches carry a string body), changing only the Authorization header. */
export function createAuthFetch(session: { forceRefresh(): Promise<string | null> }, baseFetch: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    const first = await baseFetch(input, init)
    if (first.status !== 401) return first
    const token = await session.forceRefresh()
    if (!token) return first
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return baseFetch(input, { ...init, headers })
  }
}
```

```ts
// src/lib/auth/oauthProvider.ts
import { hasCapability, isGomsShell } from '@/lib/nativeShell'
import { createAuthFetch } from './authFetch'
import { createSession, type LockManagerLike } from './session'
import { selectTokenStore } from './stores'
import type { AuthProviderApi } from './types'

const apiBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')
/** True only inside the GOMS Android shell (user-agent token set by native code), never merely "some Capacitor webview". */
export const inShell = isGomsShell()

export const session = createSession({
  apiBase,
  fetchFn: (...args) => fetch(...args),
  store: selectTokenStore({ inShell, secureStorage: hasCapability('secureStorage') }),
  locks: typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator.locks as unknown as LockManagerLike) : null,
  now: () => Date.now(),
})

export function webSignInUrl(): string {
  const returnTo = `${window.location.pathname}${window.location.search}`
  return `${apiBase}/api/oauth/google/start?client=web&return_to=${encodeURIComponent(returnTo)}`
}

export const oauthProvider: AuthProviderApi = {
  kind: 'oauth',
  get configured() { return apiBase !== '' },
  subscribe: (cb) => session.subscribe((u, loading) => cb(u ? { email: u.email, displayName: null, photoUrl: null } : null, loading)),
  async signIn() { window.location.assign(webSignInUrl()) }, // the in-shell (system browser) path is added in Task 13
  signOut: () => session.signOut(),
  async getAuthorizationHeaders() {
    const token = await session.getAccessToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  },
  fetch: createAuthFetch(session),
  async bootstrap() { await session.init() }, // replaced by the full bootstrap in Tasks 12 and 13
}
```

`src/lib/auth/authApi.ts` — replace the `authApi` line (and import `oauthProvider`):

```ts
import { oauthProvider } from './oauthProvider'
// ...
export const authApi: AuthProviderApi = AUTH_KIND === 'oauth' ? oauthProvider : firebaseProvider
```

> Bundle note: `oauthProvider` is imported in every build, but with `VITE_AUTH_PROVIDER` unset it is never *used*; `createSession` runs but touches no network and no storage until `init()`/`signIn()`. Task 17 proves a default build performs **no** request to `/api/oauth/*`.

- [ ] **Step 4: Run to verify they pass and nothing regressed**

```bash
npx vitest run src/lib
npx tsc -b
npx vitest run --config vitest.component.config.ts src/components src/modules/admin-data-import
```
Expected: PASS; with `VITE_AUTH_PROVIDER` unset every existing component test still passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nativeShell.ts src/lib/nativeShell.test.ts src/lib/auth
git commit -m "feat(oauth): OAuth client provider, nativeShell capabilities and 401 refresh-and-retry (no shell token fallback)"
```

---

### Task 12: Web handoff — `auth_code` consumption, `history.replaceState`, error surfacing

**Files:**
- Create: `src/lib/auth/bootstrap.ts`
- Modify: `src/lib/auth/oauthProvider.ts` (`bootstrap` uses it), `src/lib/authPrompt.ts` (pending reason), `src/components/AuthPromptDialog.tsx` (copy when there is no signed-in user), `src/main.tsx` (start auth bootstrap before render)
- Test: `src/lib/auth/bootstrap.test.ts`, extend `src/lib/authPrompt` tests, `src/components/AuthPromptDialog.test.tsx`

**Interfaces:**
- Consumes: `session.redeem`, `session.init`, `notifyAuthRequired`.
- Produces: `takeAuthParams(href: string, history: Pick<History, 'replaceState' | 'state'>): { code?: string; error?: string }` (synchronous; strips both params from the address bar); `bootstrapAuth(session, win: { location: { href: string }; history: History }): Promise<void>`; `setPendingAuthReason(reason: AuthPromptReason): void` and `subscribeAuthRequired` delivering a pending reason to the first subscriber.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/auth/bootstrap.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prompt } = vi.hoisted(() => ({ prompt: { pending: vi.fn() } }))
vi.mock('@/lib/authPrompt', () => ({ setPendingAuthReason: prompt.pending }))
import { bootstrapAuth, takeAuthParams } from './bootstrap'

const hist = () => ({ state: { s: 1 }, replaceState: vi.fn() })
beforeEach(() => prompt.pending.mockReset())

describe('takeAuthParams', () => {
  it('extracts auth_code and removes it from the address bar, keeping the rest of the URL', () => {
    const h = hist()
    expect(takeAuthParams('https://goms.test/bid-tracker?sheet=x&auth_code=ABC#top', h)).toEqual({ code: 'ABC', error: undefined })
    expect(h.replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/bid-tracker?sheet=x#top')
  })
  it('extracts auth_error and strips it the same way', () => {
    const h = hist()
    expect(takeAuthParams('https://goms.test/?auth_error=domain', h)).toEqual({ code: undefined, error: 'domain' })
    expect(h.replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/')
  })
  it('touches nothing when neither parameter is present', () => {
    const h = hist()
    expect(takeAuthParams('https://goms.test/a?b=1', h)).toEqual({ code: undefined, error: undefined })
    expect(h.replaceState).not.toHaveBeenCalled()
  })
})

describe('bootstrapAuth', () => {
  const win = (href: string) => ({ location: { href }, history: hist() as unknown as History })
  it('strips the code from the URL BEFORE any network call, then redeems it as a web code', async () => {
    const order: string[] = []
    const w = win('https://goms.test/?auth_code=ABC')
    ;(w.history.replaceState as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('replaceState'))
    const session = { redeem: vi.fn(async () => { order.push('redeem') }), init: vi.fn(async () => { order.push('init') }) }
    await bootstrapAuth(session, w)
    expect(order).toEqual(['replaceState', 'redeem'])
    expect(session.redeem).toHaveBeenCalledWith('ABC', 'web')
    expect(session.init).not.toHaveBeenCalled()
  })
  it('without a code it restores the stored session', async () => {
    const session = { redeem: vi.fn(), init: vi.fn(async () => {}) }
    await bootstrapAuth(session, win('https://goms.test/'))
    expect(session.init).toHaveBeenCalled(); expect(session.redeem).not.toHaveBeenCalled()
  })
  it('a rejected code does not break startup: it falls back to the stored session and asks the user to sign in', async () => {
    const session = { redeem: vi.fn(async () => { throw new Error('bad') }), init: vi.fn(async () => {}) }
    await expect(bootstrapAuth(session, win('https://goms.test/?auth_code=BAD'))).resolves.toBeUndefined()
    expect(session.init).toHaveBeenCalled()
    expect(prompt.pending).toHaveBeenCalledWith('unauthorized')
  })
  it('a non-amnex sign-in (auth_error=domain|unverified) surfaces as "forbidden"; other errors as "unauthorized"', async () => {
    for (const [err, reason] of [['domain', 'forbidden'], ['unverified', 'forbidden'], ['state', 'unauthorized'], ['google', 'unauthorized'], ['denied', 'unauthorized']] as const) {
      prompt.pending.mockReset()
      await bootstrapAuth({ redeem: vi.fn(), init: vi.fn(async () => {}) }, win(`https://goms.test/?auth_error=${err}`))
      expect(prompt.pending, err).toHaveBeenCalledWith(reason)
    }
  })
})
```

```tsx
// additions to src/components/AuthPromptDialog.test.tsx (follow the file's existing mocking style)
// 1) a pending reason set before the dialog mounts is shown on mount
//    setPendingAuthReason('forbidden'); render(<AuthPromptDialog />) -> expect(screen.getByText(/isn't authorized/i)).toBeInTheDocument()
// 2) with reason 'forbidden' and NO signed-in user the copy must not start with a blank email:
//    expect(screen.getByText(/@amnex\.com Google account/i)).toBeInTheDocument()
//    expect(screen.queryByText(/^ is signed in/)).not.toBeInTheDocument()
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/auth/bootstrap.test.ts` and `npx vitest run --config vitest.component.config.ts src/components/AuthPromptDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/auth/bootstrap.ts
import { setPendingAuthReason } from '@/lib/authPrompt'

/** SYNCHRONOUS on purpose: the one-time code is removed from the address bar (and so from history, Referer and screenshots)
 *  before any await. Only the exchange code ever appears in a URL — never an access or refresh token. */
export function takeAuthParams(href: string, history: Pick<History, 'replaceState' | 'state'>): { code?: string; error?: string } {
  const url = new URL(href)
  const code = url.searchParams.get('auth_code') ?? undefined
  const error = url.searchParams.get('auth_error') ?? undefined
  if (code !== undefined || error !== undefined) {
    url.searchParams.delete('auth_code')
    url.searchParams.delete('auth_error')
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return { code, error }
}

export async function bootstrapAuth(
  session: { redeem(code: string, client: 'web' | 'app'): Promise<void>; init(): Promise<void> },
  win: { location: { href: string }; history: History },
): Promise<void> {
  const { code, error } = takeAuthParams(win.location.href, win.history)
  if (error) setPendingAuthReason(error === 'domain' || error === 'unverified' ? 'forbidden' : 'unauthorized')
  if (code) {
    try {
      await session.redeem(code, 'web')
      return
    } catch {
      setPendingAuthReason('unauthorized')
    }
  }
  await session.init()
}
```

`src/lib/authPrompt.ts` — add (keep existing exports):

```ts
let pending: AuthPromptReason | null = null
/** For a reason raised before the dialog has mounted (e.g. a failed sign-in redirect). The first subscriber receives it. */
export function setPendingAuthReason(reason: AuthPromptReason): void { pending = reason }
```
and change `subscribeAuthRequired` so that after `listeners.add(listener)` it does `if (pending) { const r = pending; pending = null; queueMicrotask(() => listener(r)) }`.

`src/components/AuthPromptDialog.tsx` — in the `'forbidden'` branch: if `user?.email` render the existing sentence; otherwise render `That Google account isn't an @amnex.com account. GOMS needs a verified @amnex.com Google account for this action — sign in with a different one.`

`src/lib/auth/oauthProvider.ts` — `bootstrap` becomes `() => bootstrapAuth(session, window)`.

`src/main.tsx` — before the existing `if (import.meta.env.VITE_API_BASE_URL) { render() } else { ... }` block add `void authApi.bootstrap()` (imported from `@/lib/auth`); the call is synchronous up to its first await, so the URL is cleaned before React renders. For the Firebase provider `bootstrap()` is a no-op.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/lib/auth
npx vitest run --config vitest.component.config.ts src/components/AuthPromptDialog.test.tsx src/main.test.tsx
npx tsc -b
```
Expected: PASS (`main.test.tsx` still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth src/lib/authPrompt.ts src/components/AuthPromptDialog.tsx src/components/AuthPromptDialog.test.tsx src/main.tsx
git commit -m "feat(oauth): web handoff — consume auth_code, replaceState, surface sign-in failures"
```

---

### Task 13: Android shell — web-side sign-in (system browser, deep link, secure storage)

This is the **web** half of the shell integration; it ships with the hosted web app. The native half is Task 14. The code runs inside the WebView on the pinned origin, where the Capacitor bridge exists only because native code made that origin the bridge's app URL (Task 14).

**Files:**
- Modify: `package.json` / `package-lock.json` (dependencies), `src/lib/auth/oauthProvider.ts`, `src/lib/auth/bootstrap.ts`, `src/components/AuthPromptDialog.tsx`
- Create: `src/lib/auth/native.ts`
- Test: `src/lib/auth/native.test.ts`; extend `src/lib/auth/bootstrap.test.ts`, `src/components/AuthPromptDialog.test.tsx`

**Interfaces:**
- Consumes: `session.redeem(code, 'app')`, `TokenStore`, `shellScheme()`, `hasCapability()`, `ShellUpdateRequiredError`, `setPendingAuthReason`.
- Produces:
  - `parseAuthDeepLink(url: string, scheme: string | null): { code?: string } | { error?: string } | null` — accepts ONLY `<scheme>://auth` with exactly one `code` (43 base64url chars) or exactly one `error` from the fixed reason list; `scheme` must be this app's own scheme.
  - `openNativeSignIn(origin?: string): Promise<void>` — opens `<origin>/api/oauth/google/start?client=app` in the system browser; `origin` defaults to `window.location.origin` and is refused unless it equals it.
  - `listenForAuthDeepLinks(scheme: string, handler: (r: { code?: string; error?: string }) => Promise<void>): Promise<void>` — warm links and the cold-start launch URL.
  - `createSecureTokenStore(key?: string): TokenStore`.
  - `bootstrapNativeAuth(session, scheme): Promise<void>` in `bootstrap.ts`.

- [ ] **Step 1: Install and verify the plugin APIs**

```bash
npm install @capacitor/browser@^8.0.5 @aparajita/capacitor-secure-storage@^8.0.1
sed -n 1,80p node_modules/@aparajita/capacitor-secure-storage/README.md
```
Confirm in the README the exact method names and return types of `SecureStorage.get/set/remove` (expected: `set(key, value)`, `get(key)` → value or `null`, `remove(key)`) and the registered plugin name (`hasCapability` expects `SecureStorage`; `@capacitor/browser` registers `Browser`, `@capacitor/app` registers `App`). **If any differ, adapt `createSecureTokenStore` and the `CAPABILITIES` plugin names** — the unit tests mock these modules, so a wrong signature would otherwise only surface on a device. Also read the plugin's Android section for minSdk / Gradle requirements and compare with `android/variables.gradle` (minSdk 24).

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/auth/native.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cap } = vi.hoisted(() => ({
  cap: {
    open: vi.fn(), close: vi.fn(async () => {}), listener: null as null | ((e: { url: string }) => void), launchUrl: null as null | { url: string },
    store: new Map<string, string>(),
  },
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: cap.open, close: cap.close } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async (_e: string, cb: (e: { url: string }) => void) => { cap.listener = cb; return { remove: async () => {} } }, getLaunchUrl: async () => cap.launchUrl } }))
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: { get: async (k: string) => cap.store.get(k) ?? null, set: async (k: string, v: string) => void cap.store.set(k, v), remove: async (k: string) => void cap.store.delete(k) },
}))
import { createSecureTokenStore, listenForAuthDeepLinks, openNativeSignIn, parseAuthDeepLink } from './native'

const CODE = 'A'.repeat(43)
beforeEach(() => {
  cap.open.mockReset(); cap.close.mockClear(); cap.listener = null; cap.launchUrl = null; cap.store.clear()
  vi.stubGlobal('window', { location: { origin: 'https://goms-dev.firebaseapp.com' } })
})

describe('parseAuthDeepLink — strict, and only for THIS flavor\'s own scheme', () => {
  it('reads a well-formed code or a known error reason', () => {
    expect(parseAuthDeepLink(`com.gorms.app://auth?code=${CODE}`, 'com.gorms.app')).toEqual({ code: CODE })
    expect(parseAuthDeepLink('com.gorms.app.dev://auth?error=domain', 'com.gorms.app.dev')).toEqual({ error: 'domain' })
  })
  it('the dev app ignores a prod link and the prod app ignores a dev link (side-by-side installs)', () => {
    expect(parseAuthDeepLink(`com.gorms.app://auth?code=${CODE}`, 'com.gorms.app.dev')).toBeNull()
    expect(parseAuthDeepLink(`com.gorms.app.dev://auth?code=${CODE}`, 'com.gorms.app')).toBeNull()
  })
  it.each([
    `https://evil.example/auth?code=${CODE}`, `com.gorms.app://other?code=${CODE}`, `com.other.app://auth?code=${CODE}`, 'not a url', 'com.gorms.app://auth',
    'com.gorms.app://auth?code=ABC',                                   // wrong length
    `com.gorms.app://auth?code=${'A'.repeat(42)}!`,                    // wrong alphabet
    `com.gorms.app://auth?code=${CODE}&code=${CODE}`,                  // repeated
    `com.gorms.app://auth?code=${CODE}&x=1`,                           // extra parameter
    `com.gorms.app://auth?code=${CODE}&error=domain`,                  // both
    'com.gorms.app://auth?error=anything-else',                        // unknown reason
    `com.gorms.app://auth/extra?code=${CODE}`, `com.gorms.app://auth?code=${CODE}#frag`, `com.gorms.app://user@auth?code=${CODE}`,
  ])('ignores %s', (u) => { expect(parseAuthDeepLink(u, 'com.gorms.app')).toBeNull() })
  it('ignores everything when the shell reports no scheme', () => { expect(parseAuthDeepLink(`com.gorms.app://auth?code=${CODE}`, null)).toBeNull() })
})

describe('openNativeSignIn', () => {
  it('opens the system browser at /start?client=app on the page\'s own (pinned) origin', async () => {
    await openNativeSignIn()
    expect(cap.open).toHaveBeenCalledWith({ url: 'https://goms-dev.firebaseapp.com/api/oauth/google/start?client=app' })
  })
  it('refuses any origin other than the page\'s own', async () => {
    await expect(openNativeSignIn('https://evil.example')).rejects.toThrow()
    expect(cap.open).not.toHaveBeenCalled()
  })
})

describe('listenForAuthDeepLinks', () => {
  it('handles a warm deep link, closes the browser, and ignores unrelated or foreign-scheme URLs', async () => {
    const handler = vi.fn(async () => {})
    await listenForAuthDeepLinks('com.gorms.app.dev', handler)
    cap.listener!({ url: 'https://elsewhere.example/' })
    cap.listener!({ url: `com.gorms.app://auth?code=${CODE}` }) // the OTHER flavor's scheme
    expect(handler).not.toHaveBeenCalled()
    cap.listener!({ url: `com.gorms.app.dev://auth?code=${CODE}` })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ code: CODE }))
    expect(cap.close).toHaveBeenCalled()
  })
  it('also handles the link that cold-started the app', async () => {
    cap.launchUrl = { url: `com.gorms.app://auth?code=${'B'.repeat(43)}` }
    const handler = vi.fn(async () => {})
    await listenForAuthDeepLinks('com.gorms.app', handler)
    expect(handler).toHaveBeenCalledWith({ code: 'B'.repeat(43) })
  })
  it('never logs the code, even when the handler fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {}); const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    cap.launchUrl = { url: `com.gorms.app://auth?code=${'S'.repeat(43)}` }
    await listenForAuthDeepLinks('com.gorms.app', async () => { throw new Error('boom') })
    expect(JSON.stringify([...log.mock.calls, ...err.mock.calls])).not.toContain('S'.repeat(43))
  })
})

describe('createSecureTokenStore', () => {
  it('stores the refresh token in the platform secure store, not localStorage', async () => {
    const s = createSecureTokenStore('k')
    expect(await s.get()).toBeNull()
    await s.set('R1'); expect(cap.store.get('k')).toBe('R1'); expect(await s.get()).toBe('R1')
    await s.clear(); expect(await s.get()).toBeNull()
  })
})
```

Add to `src/lib/auth/bootstrap.test.ts`:

```ts
describe('bootstrapNativeAuth', () => {
  it('registers the deep-link listener for THIS flavor\'s scheme BEFORE restoring the stored session, and redeems an app code', async () => {
    const order: string[] = []
    const listen = vi.fn(async (_scheme: string, handler: (r: { code?: string; error?: string }) => Promise<void>) => { order.push('listen'); await handler({ code: 'C'.repeat(43) }) })
    vi.doMock('./native', () => ({ listenForAuthDeepLinks: listen }))
    const { bootstrapNativeAuth } = await import('./bootstrap')
    const session = { redeem: vi.fn(async () => { order.push('redeem') }), init: vi.fn(async () => { order.push('init') }) }
    await bootstrapNativeAuth(session, 'com.gorms.app.dev')
    expect(listen).toHaveBeenCalledWith('com.gorms.app.dev', expect.any(Function))
    expect(session.redeem).toHaveBeenCalledWith('C'.repeat(43), 'app')
    expect(order).toEqual(['listen', 'redeem', 'init'])
  })
  it('an error deep link becomes a sign-in prompt: domain/unverified -> forbidden, others -> unauthorized', async () => {
    let handler!: (r: { code?: string; error?: string }) => Promise<void>
    vi.doMock('./native', () => ({ listenForAuthDeepLinks: async (_s: string, h: typeof handler) => { handler = h } }))
    const { bootstrapNativeAuth } = await import('./bootstrap')
    await bootstrapNativeAuth({ redeem: vi.fn(), init: vi.fn(async () => {}) }, 'com.gorms.app')
    await handler({ error: 'domain' }); expect(prompt.pending).toHaveBeenLastCalledWith('forbidden')
    await handler({ error: 'google' }); expect(prompt.pending).toHaveBeenLastCalledWith('unauthorized')
  })
})
```

Add to `src/components/AuthPromptDialog.test.tsx` (follow the file's mocking style): clicking **Sign in with Google** when `authApi.signIn` rejects with `ShellUpdateRequiredError` shows `This version of the GOMS app can't sign you in. Update the app and try again.` and not the generic `Sign-in failed. Try again.`; any other rejection still shows the generic text.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/lib/auth/native.test.ts src/lib/auth/bootstrap.test.ts` and `npx vitest run --config vitest.component.config.ts src/components/AuthPromptDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

```ts
// src/lib/auth/native.ts
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import type { TokenStore } from './session'

const CODE_FORMAT = /^[A-Za-z0-9_-]{43}$/
const ERROR_REASONS = new Set(['state', 'domain', 'unverified', 'google', 'denied'])

/** Accepts ONLY `<scheme>://auth` for this app's own scheme, carrying exactly one `code` (43 base64url chars) or exactly one known
 *  `error`. Anything else — another flavor's scheme, extra/repeated parameters, a fragment, a path — is ignored. */
export function parseAuthDeepLink(url: string, scheme: string | null): { code?: string; error?: string } | null {
  if (!scheme) return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== `${scheme}:` || u.host !== 'auth' || u.username || u.password || u.hash) return null
  if (u.pathname !== '' && u.pathname !== '/') return null
  const keys = [...u.searchParams.keys()]
  if (keys.length !== 1) return null
  const key = keys[0]
  const values = u.searchParams.getAll(key)
  if (values.length !== 1) return null
  if (key === 'code' && CODE_FORMAT.test(values[0])) return { code: values[0] }
  if (key === 'error' && ERROR_REASONS.has(values[0])) return { error: values[0] }
  return null
}

/** The sign-in URL is built from the page's own origin — the WebView can only ever be on the pinned origin — never from a value the
 *  page was handed. */
export async function openNativeSignIn(origin: string = window.location.origin): Promise<void> {
  const url = new URL('/api/oauth/google/start', origin)
  url.searchParams.set('client', 'app')
  if (url.origin !== window.location.origin) throw new Error('Unexpected sign-in origin')
  await Browser.open({ url: url.toString() })
}

/** Registers once at startup. Handles links delivered while the app runs AND the link that launched it. The code is never logged. */
export async function listenForAuthDeepLinks(scheme: string, handler: (r: { code?: string; error?: string }) => Promise<void>): Promise<void> {
  const handle = async (url: string) => {
    const parsed = parseAuthDeepLink(url, scheme)
    if (!parsed) return
    try { await Browser.close() } catch { /* already closed */ }
    try { await handler(parsed) } catch { console.error('Sign-in could not be completed.') }
  }
  await App.addListener('appUrlOpen', (e) => { void handle(e.url) })
  const launch = await App.getLaunchUrl()
  if (launch?.url) await handle(launch.url)
}

/** The refresh token lives in the platform keystore (Android Keystore-backed), never in WebView localStorage. */
export function createSecureTokenStore(key = 'goms.auth.refresh'): TokenStore {
  return {
    async get() { try { const v = await SecureStorage.get(key); return typeof v === 'string' ? v : null } catch { return null } },
    async set(token) { await SecureStorage.set(key, token) },
    async clear() { try { await SecureStorage.remove(key) } catch { /* nothing stored */ } },
  }
}
```

`src/lib/auth/bootstrap.ts` — add (the plugins load lazily, so the browser build never imports them):

```ts
export async function bootstrapNativeAuth(
  session: { redeem(code: string, client: 'web' | 'app'): Promise<void>; init(): Promise<void> }, scheme: string,
): Promise<void> {
  const { listenForAuthDeepLinks } = await import('./native')
  await listenForAuthDeepLinks(scheme, async ({ code, error }) => {
    if (error) setPendingAuthReason(error === 'domain' || error === 'unverified' ? 'forbidden' : 'unauthorized')
    if (code) await session.redeem(code, 'app')
  })
  await session.init()
}
```

`src/lib/auth/oauthProvider.ts` — complete the in-shell paths:

```ts
import { shellScheme } from '@/lib/nativeShell'
import { ShellUpdateRequiredError } from './errors'
import { bootstrapAuth, bootstrapNativeAuth } from './bootstrap'

// signIn:
async signIn() {
  if (!inShell) { window.location.assign(webSignInUrl()); return }
  // Inside the shell a missing native piece means an old APK: refuse (no degraded token storage) and ask for an update.
  if (!(hasCapability('browser') && hasCapability('appLinks') && hasCapability('secureStorage'))) throw new ShellUpdateRequiredError()
  await (await import('./native')).openNativeSignIn()
},
// bootstrap:
bootstrap: () => {
  if (!inShell) return bootstrapAuth(session, window)
  const scheme = shellScheme()
  // An old shell, or one that reports no scheme, cannot receive a deep link: stay signed out; signIn() tells the user to update.
  if (!scheme || !hasCapability('appLinks') || !hasCapability('secureStorage')) return Promise.resolve()
  return bootstrapNativeAuth(session, scheme)
},
```

`src/components/AuthPromptDialog.tsx` — keep one error state but distinguish the update case: store the caught error; render `This version of the GOMS app can't sign you in. Update the app and try again.` when `err instanceof ShellUpdateRequiredError`, else the existing `Sign-in failed. Try again.`

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run src/lib/auth
npx vitest run --config vitest.component.config.ts src/components/AuthPromptDialog.test.tsx
npx tsc -b
```
Expected: PASS. Do **not** run `npx cap sync` here; the native project is Task 14's.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/auth src/components/AuthPromptDialog.tsx src/components/AuthPromptDialog.test.tsx
git commit -m "feat(oauth): Android shell sign-in on the web side — system browser, strict per-flavor deep link, secure token storage"
```

---

## Phase C — Android thin shell (native)

These tasks change `android/` and the shell's configuration. They are a **native release**: they need a new APK and cannot be delivered by a web deploy. They do not change the OAuth security model.

### Task 14: Native Android shell — pinned origin, navigation policy, manifest, flavors

**Files:**
- Create: `android/app/src/main/java/com/gorms/app/NavigationPolicy.java`, `GomsWebViewClient.java`, `android/app/src/test/java/com/gorms/app/NavigationPolicyTest.java`, `android/app/src/main/res/xml/network_security_config.xml`, `android/app/src/main/res/xml/data_extraction_rules.xml`, `android/app/src/dev/res/values/strings.xml`, `android-shell/www/offline.html`
- Modify: `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/gorms/app/MainActivity.java`, `capacitor.config.ts`, `android/README.md`

**Interfaces:**
- Produces (Java): `NavigationPolicy(String pinnedOrigin)` (throws `IllegalArgumentException` unless it is an exact `https` origin with no path) and `Decision decide(String url, boolean isMainFrame)` returning `LOAD_IN_WEBVIEW | OPEN_EXTERNAL_BROWSER | HAND_TO_CUSTOM_TAB | HAND_TO_SYSTEM_APP | BLOCK`. `BuildConfig.GOMS_ORIGIN`, `BuildConfig.GOMS_SCHEME` per flavor.
- Consumed by the web side: the user-agent token `GOMSShell/<versionCode> GOMSScheme/<scheme>` (Task 11 `nativeShell.ts`), the deep link `<scheme>://auth?...` (Task 13), the Capacitor bridge on the pinned origin.
- Release type: **native (new APK)**. Nothing here is delivered by a web deploy.

- [ ] **Step 1: Write the failing JUnit test** (the policy is plain Java, so it runs on the JVM without Android)

```java
// android/app/src/test/java/com/gorms/app/NavigationPolicyTest.java
package com.gorms.app;

import static com.gorms.app.NavigationPolicy.Decision.BLOCK;
import static com.gorms.app.NavigationPolicy.Decision.HAND_TO_CUSTOM_TAB;
import static com.gorms.app.NavigationPolicy.Decision.HAND_TO_SYSTEM_APP;
import static com.gorms.app.NavigationPolicy.Decision.LOAD_IN_WEBVIEW;
import static com.gorms.app.NavigationPolicy.Decision.OPEN_EXTERNAL_BROWSER;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import org.junit.Test;

public class NavigationPolicyTest {
    private final NavigationPolicy p = new NavigationPolicy("https://goms-prod.web.app");

    private NavigationPolicy.Decision d(String url) { return p.decide(url, true); }

    @Test public void loadsThePinnedOriginOnly() {
        assertEquals(LOAD_IN_WEBVIEW, d("https://goms-prod.web.app/"));
        assertEquals(LOAD_IN_WEBVIEW, d("https://goms-prod.web.app/sales/roster?a=1#top"));
        assertEquals(LOAD_IN_WEBVIEW, d("HTTPS://GOMS-PROD.WEB.APP/x"));          // case-insensitive scheme and host
        assertEquals(LOAD_IN_WEBVIEW, d("https://goms-prod.web.app:443/x"));      // default port normalised
    }

    @Test public void googleSignInStartGoesToTheBrowserNeverTheWebView() {
        assertEquals(HAND_TO_CUSTOM_TAB, d("https://goms-prod.web.app/api/oauth/google/start?client=app"));
        assertEquals(BLOCK, d("https://goms-prod.web.app/api/oauth/google/start?client=web"));
        assertEquals(BLOCK, d("https://goms-prod.web.app/api/oauth/google/start"));
        assertEquals(BLOCK, d("https://goms-prod.web.app/api/oauth/google/start?client=app&client=web"));
    }

    @Test public void everyOtherOauthPathIsBlockedIncludingEncodedAndDotSegmentForms() {
        for (String path : new String[] {
            "/api/oauth/google/callback?code=x&state=y", "/api/oauth/exchange", "/api/oauth/refresh", "/api/oauth", "/api/oauth/",
            "/api/%6Fauth/google/callback", "/x/../api/oauth/google/callback", "//api/oauth/google/callback", "/API/OAuth/google/callback" }) {
            assertEquals(path, BLOCK, d("https://goms-prod.web.app" + path));
        }
        assertEquals(LOAD_IN_WEBVIEW, d("https://goms-prod.web.app/api/trpc/health.check")); // ordinary API calls are not navigations we block
    }

    @Test public void otherHostsLeaveTheApp() {
        for (String url : new String[] {
            "https://accounts.google.com/o/oauth2/v2/auth", "https://goms-prod.firebaseapp.com/", "https://goms-prod.web.app.evil.com/",
            "https://evil.com/goms-prod.web.app", "https://goms-prod.web.app@evil.com/", "https://evil.com@goms-prod.web.app/",
            "https://goms-prod.web.app:8443/", "https://goms-prod.web.app./", "https://goms-dev.firebaseapp.com/" }) {
            assertEquals(url, OPEN_EXTERNAL_BROWSER, d(url));
        }
    }

    @Test public void cleartextAndDangerousSchemesAreBlocked() {
        for (String url : new String[] {
            "http://goms-prod.web.app/", "intent://x#Intent;end", "file:///sdcard/x.html", "content://x/y", "javascript:alert(1)",
            "data:text/html,hi", "blob:https://goms-prod.web.app/abc", "android-app://com.x", "foo://bar", "", "not a url", null }) {
            assertEquals(String.valueOf(url), BLOCK, d(url));
        }
    }

    @Test public void mailAndPhoneGoToTheSystem() {
        assertEquals(HAND_TO_SYSTEM_APP, d("mailto:a@amnex.com"));
        assertEquals(HAND_TO_SYSTEM_APP, d("tel:+911234567890"));
    }

    @Test public void subFramesNeverLoadForeignContent() {
        assertEquals(BLOCK, p.decide("https://evil.example/", false));
        assertEquals(BLOCK, p.decide("https://goms-prod.web.app/api/oauth/google/start?client=app", false));
        assertEquals(LOAD_IN_WEBVIEW, p.decide("https://goms-prod.web.app/embed", false));
    }

    @Test public void theDevOriginIsPinnedIndependently() {
        NavigationPolicy dev = new NavigationPolicy("https://goms-dev.firebaseapp.com");
        assertEquals(LOAD_IN_WEBVIEW, dev.decide("https://goms-dev.firebaseapp.com/x", true));
        assertEquals(OPEN_EXTERNAL_BROWSER, dev.decide("https://goms-prod.web.app/x", true));
    }

    @Test public void refusesToBeBuiltFromAnythingButAnExactHttpsOrigin() {
        for (String bad : new String[] {
            "http://goms-prod.web.app", "https://goms-prod.web.app/path", "https://goms-prod.web.app/", "https://*.web.app", "https://user@goms-prod.web.app",
            "https://goms-prod.web.app?x=1", "https://goms-prod.web.app#f", "", "goms-prod.web.app", null }) {
            try { new NavigationPolicy(bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) { /* ok */ }
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd android && ./gradlew :app:testDevDebugUnitTest --tests com.gorms.app.NavigationPolicyTest`
Expected: FAIL to compile — `NavigationPolicy` and the `dev` flavor do not exist yet. (Needs the Android SDK path in `android/local.properties` and network access for Gradle dependencies. If the SDK is unavailable, say so in the task report: the policy is plain Java and can be run with `javac` + the JUnit 4.13.2 jar as a fallback.)

- [ ] **Step 3: Implement the policy**

```java
// android/app/src/main/java/com/gorms/app/NavigationPolicy.java
package com.gorms.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Decides what the WebView may do with a URL. Plain Java (no Android types) so it is unit-tested on the JVM. Host comparison is on the
 *  parsed authority, never startsWith/contains. */
public final class NavigationPolicy {
    public enum Decision { LOAD_IN_WEBVIEW, OPEN_EXTERNAL_BROWSER, HAND_TO_CUSTOM_TAB, HAND_TO_SYSTEM_APP, BLOCK }

    private final String host;
    private final int port;

    public NavigationPolicy(String pinnedOrigin) {
        URI o = parse(pinnedOrigin);
        boolean exact = o != null
            && "https".equals(lower(o.getScheme()))
            && o.getHost() != null
            && !o.getHost().contains("*")
            && o.getRawUserInfo() == null
            && (o.getRawPath() == null || o.getRawPath().isEmpty())
            && o.getRawQuery() == null
            && o.getRawFragment() == null;
        if (!exact) throw new IllegalArgumentException("GOMS_ORIGIN must be an exact https origin with no path");
        this.host = o.getHost().toLowerCase(Locale.ROOT);
        this.port = effectivePort(o);
    }

    public Decision decide(String url, boolean isMainFrame) {
        URI u = parse(url);
        if (u == null) return Decision.BLOCK;
        String scheme = lower(u.getScheme());
        if (scheme == null) return Decision.BLOCK;
        switch (scheme) {
            case "https": return decideHttps(u, isMainFrame);
            case "mailto":
            case "tel": return isMainFrame ? Decision.HAND_TO_SYSTEM_APP : Decision.BLOCK;
            default: return Decision.BLOCK; // http, intent, file, content, javascript, data, blob, android-app, anything unknown
        }
    }

    private Decision decideHttps(URI u, boolean isMainFrame) {
        String h = u.getHost();
        boolean pinned = h != null && h.toLowerCase(Locale.ROOT).equals(host) && effectivePort(u) == port && u.getRawUserInfo() == null;
        if (!pinned) return isMainFrame ? Decision.OPEN_EXTERNAL_BROWSER : Decision.BLOCK;
        String decoded = u.normalize().getPath();
        if (decoded == null) return Decision.BLOCK;
        String path = decoded.replaceAll("/+", "/").toLowerCase(Locale.ROOT);
        if (path.equals("/api/oauth") || path.startsWith("/api/oauth/")) {
            boolean start = path.equals("/api/oauth/google/start") && hasSingleParam(u.getRawQuery(), "client", "app");
            return start && isMainFrame ? Decision.HAND_TO_CUSTOM_TAB : Decision.BLOCK; // callbacks are reached only from the browser
        }
        return Decision.LOAD_IN_WEBVIEW;
    }

    private static boolean hasSingleParam(String rawQuery, String key, String value) {
        if (rawQuery == null) return false;
        int count = 0;
        boolean matches = false;
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            String k = eq < 0 ? pair : pair.substring(0, eq);
            String v = eq < 0 ? "" : pair.substring(eq + 1);
            if (k.equals(key)) { count++; matches = v.equals(value); }
        }
        return count == 1 && matches;
    }

    private static int effectivePort(URI u) { return u.getPort() == -1 ? 443 : u.getPort(); }
    private static String lower(String s) { return s == null ? null : s.toLowerCase(Locale.ROOT); }
    private static URI parse(String s) {
        if (s == null || s.isEmpty()) return null;
        try { return new URI(s); } catch (URISyntaxException e) { return null; }
    }
}
```

- [ ] **Step 4: Gradle flavors, BuildConfig, per-flavor scheme** — edit `android/app/build.gradle`:

Inside `android { ... }`, after `compileSdk = rootProject.ext.compileSdkVersion`, add:

```groovy
    buildFeatures {
        buildConfig = true
    }
    flavorDimensions "env"
    productFlavors {
        prod {
            dimension "env"
            buildConfigField "String", "GOMS_ORIGIN", "\"https://goms-prod.web.app\""
            buildConfigField "String", "GOMS_SCHEME", "\"com.gorms.app\""
            manifestPlaceholders = [gomsScheme: "com.gorms.app"]
        }
        dev {
            dimension "env"
            applicationIdSuffix ".dev"
            versionNameSuffix "-dev"
            buildConfigField "String", "GOMS_ORIGIN", "\"https://goms-dev.firebaseapp.com\""
            buildConfigField "String", "GOMS_SCHEME", "\"com.gorms.app.dev\""
            manifestPlaceholders = [gomsScheme: "com.gorms.app.dev"]
        }
    }
```
and in `defaultConfig`: `versionCode 1` → `versionCode 2`; `versionName "1.0"` → `versionName "2.0"`. `applicationId "com.gorms.app"` stays (the dev flavor appends `.dev`). Create `android/app/src/dev/res/values/strings.xml`:

```xml
<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">GORMS Dev</string>
    <string name="title_activity_main">GORMS Dev</string>
    <string name="custom_url_scheme">com.gorms.app.dev</string>
</resources>
```

- [ ] **Step 5: `MainActivity`, `GomsWebViewClient`, manifest and resources**

```java
// android/app/src/main/java/com/gorms/app/MainActivity.java
package com.gorms.app;

import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        NavigationPolicy policy;
        try {
            policy = new NavigationPolicy(BuildConfig.GOMS_ORIGIN); // refuses anything but an exact https origin
        } catch (IllegalArgumentException e) {
            Log.e("GOMS", "Invalid pinned origin; refusing to start the WebView");
            finish();
            return;
        }
        // The remote origin is set HERE, in native code, from a compile-time per-flavor constant — never from capacitor.config.*.
        config = new CapConfig.Builder(this)
            .setServerUrl(BuildConfig.GOMS_ORIGIN)
            .setAllowNavigation(new String[0])
            .setErrorPath("offline.html")
            .setAllowMixedContent(false)
            .setAppendedUserAgentString("GOMSShell/" + BuildConfig.VERSION_CODE + " GOMSScheme/" + BuildConfig.GOMS_SCHEME)
            .setWebContentsDebuggingEnabled(BuildConfig.DEBUG && "dev".equals(BuildConfig.FLAVOR))
            .create();
        super.load();
        bridge.setWebViewClient(new GomsWebViewClient(bridge, policy, this, BuildConfig.GOMS_ORIGIN));
    }
}
```

```java
// android/app/src/main/java/com/gorms/app/GomsWebViewClient.java
package com.gorms.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/** Enforces NavigationPolicy for every main-frame navigation. SSL errors are never overridden to proceed (the default cancels). */
public class GomsWebViewClient extends BridgeWebViewClient {
    private final Bridge bridge;
    private final NavigationPolicy policy;
    private final Activity activity;
    private final String origin;

    public GomsWebViewClient(Bridge bridge, NavigationPolicy policy, Activity activity, String origin) {
        super(bridge);
        this.bridge = bridge;
        this.policy = policy;
        this.activity = activity;
        this.origin = origin;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        switch (policy.decide(url.toString(), request.isForMainFrame())) {
            case LOAD_IN_WEBVIEW: return false;
            case OPEN_EXTERNAL_BROWSER:
            case HAND_TO_CUSTOM_TAB: open(url); return true;     // the system browser; Google never renders inside the WebView
            case HAND_TO_SYSTEM_APP: open(url); return true;
            default: return true;                                  // BLOCK
        }
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (!request.isForMainFrame()) return;
        String errorUrl = bridge.getErrorUrl();                    // local offline.html (resolved against the local origin)
        if (errorUrl != null) view.loadUrl(errorUrl + "#" + origin);
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        activity.recreate();
        return true;
    }

    private void open(Uri uri) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
        } catch (ActivityNotFoundException ignored) { /* nothing can handle it: drop it */ }
    }
}
```

Replace `android/app/src/main/AndroidManifest.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="false"
        android:fullBackupContent="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:usesCleartextTraffic="false"
        android:networkSecurityConfig="@xml/network_security_config"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- OAuth return: <flavor scheme>://auth?code=...  (com.gorms.app for prod, com.gorms.app.dev for dev) -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${gomsScheme}" android:host="auth" />
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths"></meta-data>
        </provider>
    </application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
```

```xml
<!-- android/app/src/main/res/xml/network_security_config.xml : system CAs only, no cleartext, no user-added CAs, no pinning -->
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

```xml
<!-- android/app/src/main/res/xml/data_extraction_rules.xml : nothing leaves the device by backup or transfer -->
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </device-transfer>
</data-extraction-rules>
```

- [ ] **Step 6: Offline page and `capacitor.config.ts`**

`android-shell/www/offline.html` — the only bundled UI; no network, no remote assets; "Try again" navigates to the origin passed in the URL fragment, but only if it is one of the two known GOMS origins:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GORMS</title>
  <style>
    body { font: 16px system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; background: #fff; color: #111; }
    main { padding: 2rem; max-width: 22rem; }
    h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
    p { color: #555; margin: 0 0 1.5rem; }
    button { font: inherit; padding: .8rem 1.4rem; border: 0; border-radius: .5rem; background: #111; color: #fff; }
  </style>
</head>
<body>
  <main>
    <h1>Can't reach GORMS</h1>
    <p>Check your connection, then try again.</p>
    <button id="retry" type="button">Try again</button>
  </main>
  <script>
    document.getElementById('retry').addEventListener('click', function () {
      var origin = location.hash.slice(1);
      if (/^https:\/\/goms-(dev\.firebaseapp\.com|prod\.web\.app)$/.test(origin)) location.replace(origin + '/');
    });
  </script>
</body>
</html>
```

`capacitor.config.ts` becomes (note: **no `server` block**):

```ts
import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is a thin shell that loads the hosted GOMS origin. That origin is a per-flavor compile-time constant in native code
// (android/app/build.gradle -> BuildConfig.GOMS_ORIGIN, applied in MainActivity). Do NOT add a `server` block, `server.url`, cleartext
// or allowNavigation here: a guard test fails the build if any appear. Only the offline page is bundled.
const config: CapacitorConfig = {
  appId: 'com.gorms.app',
  appName: 'GORMS',
  webDir: 'android-shell/www',
};

export default config;
```

`android/README.md` — replace the "Everyday development build" section with: the web app is **not** synced into the APK any more (`webDir` is only `android-shell/www`); build with `cd android && ./gradlew assembleDevDebug` (dev flavor, installs as `com.gorms.app.dev`) or `assembleProdRelease` (prod flavor); `npx cap sync android` is needed only after adding or upgrading a Capacitor plugin; a normal Hosting deploy updates installed apps; the release-boundary table from this plan's section is copied under "Does this change need a new APK?".

- [ ] **Step 7: Run to verify**

```bash
cd android && ./gradlew :app:testDevDebugUnitTest --tests com.gorms.app.NavigationPolicyTest      # JUnit: PASS
cd android && ./gradlew :app:assembleDevDebug :app:assembleProdDebug                              # compile only; do not install or distribute
rm -rf android/app/src/main/assets/public && npx cap sync android                                  # generated, git-ignored; now copies only the offline page
```
Expected: JUnit PASS; both flavors compile; `cap sync` lists `@capacitor/app`, `browser`, `filesystem`, `share`, secure storage and `android/app/src/main/assets/public` contains only `offline.html`. (A device run — loading the hosted dev origin, bridge present, deep link, offline page — is manual validation, below.)

- [ ] **Step 8: Commit** (native release)

```bash
git add android android-shell capacitor.config.ts
git commit -m "feat(android): thin shell — pinned per-flavor origin, navigation policy, deep-link manifest, side-by-side dev/prod"
```

---

### Task 15: Shell configuration guards (a native or config change that drifts fails the build)

**Files:**
- Create: `src/lib/shell/androidConfigGuard.test.ts`
- Modify: `apps/api/src/auth/oauth/config.ts` is read, not changed.

**Interfaces:** Consumes the files from Task 14, `KNOWN_SHELL_SCHEMES` (Task 11) and `APP_SCHEMES` (Task 2).

- [ ] **Step 1: Write the guard test** (it fails if anyone reintroduces a `server.url` shortcut, edits an origin, or lets the three scheme lists drift apart)

```ts
// src/lib/shell/androidConfigGuard.test.ts
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KNOWN_SHELL_SCHEMES } from '../nativeShell'

const read = (p: string) => readFileSync(p, 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
const flavor = (gradle: string, name: string) => {
  const block = new RegExp(`\\b${name}\\s*\\{([^}]*)\\}`).exec(gradle)?.[1] ?? ''
  const field = (n: string) => new RegExp(`"${n}",\\s*"\\\\"([^"\\\\]+)\\\\""`).exec(block)?.[1]
  return { origin: field('GOMS_ORIGIN'), scheme: field('GOMS_SCHEME'), placeholder: /gomsScheme:\s*"([^"]+)"/.exec(block)?.[1], suffix: /applicationIdSuffix\s+"([^"]+)"/.exec(block)?.[1] }
}

describe('capacitor config: no remote shortcut, only the offline page is bundled', () => {
  const src = stripComments(read('capacitor.config.ts'))
  it('has no server block, url, cleartext, allowNavigation or http scheme', () => {
    expect(src).not.toMatch(/\bserver\s*:/)
    expect(src).not.toMatch(/\bcleartext\b/i)
    expect(src).not.toMatch(/allowNavigation/)
    expect(src).not.toMatch(/androidScheme\s*:\s*['"]http['"]/)
  })
  it('bundles android-shell/www and nothing else', () => { expect(src).toMatch(/webDir:\s*'android-shell\/www'/) })
  it('the generated config copied into the APK has no server block either (when present)', () => {
    const generated = 'android/app/src/main/assets/capacitor.config.json'
    if (!existsSync(generated)) return
    const json = JSON.parse(read(generated))
    expect(json.server).toBeUndefined()
    expect(json.webDir).toBe('android-shell/www')
  })
})

describe('Gradle flavors', () => {
  const gradle = read('android/app/build.gradle')
  const prod = flavor(gradle, 'prod'), dev = flavor(gradle, 'dev')
  it('pins exact https origins with no path', () => {
    expect(prod.origin).toBe('https://goms-prod.web.app')
    expect(dev.origin).toBe('https://goms-dev.firebaseapp.com')
    for (const o of [prod.origin!, dev.origin!]) { const u = new URL(o); expect(u.protocol).toBe('https:'); expect(u.pathname).toBe('/'); expect(`${u.origin}`).toBe(o) }
  })
  it('each origin is the host of the Google OAuth callback registered for that environment', () => {
    expect(new URL('/api/oauth/google/callback', prod.origin).origin).toBe(prod.origin)
    expect(new URL('/api/oauth/google/callback', dev.origin).origin).toBe(dev.origin)
  })
  it('prod and dev install side by side with their OWN applicationId and scheme', () => {
    expect(prod.suffix).toBeUndefined(); expect(dev.suffix).toBe('.dev')
    expect(prod.scheme).toBe('com.gorms.app'); expect(dev.scheme).toBe('com.gorms.app.dev')
    expect(prod.placeholder).toBe(prod.scheme); expect(dev.placeholder).toBe(dev.scheme)
    expect(read('android/app/build.gradle')).toMatch(/applicationId\s+"com\.gorms\.app"/)
  })
  it('the three scheme lists agree: Gradle flavors, the web shell detector and the API allow-list', () => {
    const api = /APP_SCHEMES\s*=\s*\[([^\]]+)\]/.exec(read('apps/api/src/auth/oauth/config.ts'))?.[1].match(/'([^']+)'/g)?.map((x) => x.slice(1, -1))
    expect([...KNOWN_SHELL_SCHEMES].sort()).toEqual([prod.scheme, dev.scheme].sort())
    expect(api?.slice().sort()).toEqual([prod.scheme, dev.scheme].sort())
  })
})

describe('manifest hardening', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml')
  it('takes its deep-link scheme from the flavor placeholder, never a literal', () => {
    expect(manifest).toMatch(/android:scheme="\$\{gomsScheme\}"\s+android:host="auth"/)
    expect(manifest).not.toMatch(/android:scheme="com\.gorms\.app/)
  })
  it('disables backup and cleartext and names the security configs', () => {
    expect(manifest).toMatch(/android:allowBackup="false"/)
    expect(manifest).toMatch(/android:usesCleartextTraffic="false"/)
    expect(manifest).toMatch(/android:networkSecurityConfig="@xml\/network_security_config"/)
    expect(manifest).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/)
  })
  it('declares no permission beyond INTERNET', () => {
    expect([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1])).toEqual(['android.permission.INTERNET'])
  })
})
```

- [ ] **Step 2: Run to verify** (it passes only once Task 14's files exist; run it first with Task 14's gradle/manifest reverted to see it fail)

```bash
npx vitest run src/lib/shell
```
Expected before Task 14's edits: FAIL (no flavors / literal scheme). After: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shell
git commit -m "test(android): guard against server.url shortcuts and flavor/scheme drift"
```

---

## Phase D — Configuration, verification

### Task 16: Local development configuration and docs

**Files:**
- Create: `apps/api/.env.oauth.example`
- Modify: `.gitignore`, `.env.example`
- Test: none (config); verified in Step 3.

- [ ] **Step 1: Allow the tracked example through the ignore rules**

Append to `.gitignore` directly below the existing `!.env.example` line:

```
!apps/api/.env.oauth.example
```

- [ ] **Step 2: Create `apps/api/.env.oauth.example`** (placeholders only; the real `.env.oauth` stays ignored)

```bash
# Copy to apps/api/.env.oauth (git-ignored) and fill in. NEVER commit real values.
#   Create the client: Google Cloud console -> APIs & Services -> Credentials -> OAuth client ID (Web application).
#   Authorized redirect URI (local):  http://localhost:8080/api/oauth/google/callback
#   Authorized redirect URI (dev):    https://goms-dev.firebaseapp.com/api/oauth/google/callback

GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8080/api/oauth/google/callback

# Local development only: the API runs on :8080 but the Vite app on :5173, so the web callback must send the browser back to Vite.
# Leave unset on Firebase Hosting (same origin as the redirect URI).
OAUTH_WEB_ORIGIN=http://localhost:5173

# Generate once per environment:  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
AUTH_SESSION_SECRET=

# firebase (default, OAuth routes answer 404) | both | oauth
AUTH_PROVIDER=both

# The Android app's deep-link scheme this API hands out. Unset = com.gorms.app (prod). The DEV API sets com.gorms.app.dev.
# Only those two values are accepted.
# OAUTH_APP_SCHEME=com.gorms.app.dev
```

- [ ] **Step 3: Document the frontend variable in `.env.example`**

```bash
# VITE_AUTH_PROVIDER — optional. `oauth` signs users in through the GOMS Google OAuth flow (needs VITE_API_BASE_URL and an API with
# AUTH_PROVIDER=both|oauth). Unset or `firebase` keeps today's Firebase Google sign-in (the default; a build without it is unchanged).
#
# VITE_AUTH_PROVIDER=
```

Local run recipe (also add as a short comment block at the top of `apps/api/.env.oauth.example`):

```bash
# terminal 1 — API (needs the local test DB env AND the OAuth env)
cd apps/api && set -a && . ./.env && . ./.env.oauth && set +a && npm run dev        # PORT defaults to 8080
# terminal 2 — web app
VITE_API_BASE_URL=http://localhost:8080 VITE_AUTH_PROVIDER=oauth npm run dev        # http://localhost:5173
```
Check: `curl -i "http://localhost:8080/api/oauth/google/start?client=web"` returns `302` to `accounts.google.com`; with `AUTH_PROVIDER` unset it returns `404`.

Also fix the existing local `apps/api/.env.oauth`: its default redirect URI (`…:3000/…`) predates this plan; change it to the `:8080` URI above and register that exact URI in the Google console (the API's default port is 8080).

- [ ] **Step 4: Verify the ignore rules and commit**

```bash
git check-ignore -v apps/api/.env.oauth        # ignored
git add --dry-run apps/api/.env.oauth.example        # must be listed as 'add' (not ignored)
git add .gitignore .env.example apps/api/.env.oauth.example
git commit -m "docs(oauth): local development configuration for the OAuth flow"
```

---

### Task 17: Full verification and the no-op proof

**Files:** none (verification only; fix anything it finds in the owning task's files).

- [ ] **Step 1: Whole suites**

```bash
apitest                                   # API: baseline 68 files / 973 tests + all new OAuth tests
npx vitest run                            # unit: baseline 65 / 686 + new
npx vitest run --config vitest.component.config.ts   # component: baseline 93 / 714 + new
(cd apps/api && npx tsc -p tsconfig.json --noEmit)
npm run build                             # tsc -b && vite build
(cd android && ./gradlew :app:testDevDebugUnitTest :app:assembleDevDebug :app:assembleProdDebug)   # JUnit + compile only (needs the Android SDK)
npx vitest run src/lib/shell              # guard tests: no server.url shortcut, flavor/scheme drift
```
Expected: all green; counts ≥ baseline; build exit 0. Any pre-existing test that needed editing must be listed in the final report with the reason.

- [ ] **Step 2: Prove `AUTH_PROVIDER=firebase` is a behavioural no-op** (the first-deployment requirement)

With `AUTH_PROVIDER` **unset**, run the complete RBAC e2e suites unchanged: `apitest src/auth/rbac src/trpc.test.ts src/routers/auth.test.ts`. Then run `apitest src/auth/oauth/routes.test.ts -t "no-op"`. Expected: PASS; all OAuth routes 404; a GOMS token is refused (`identitySeam.test.ts`, `firebase` row).

- [ ] **Step 3: Prove a default frontend build never touches the OAuth endpoints**

`main.tsx` calls `authApi.bootstrap()`, which for the Firebase provider is an empty function, so a build without `VITE_AUTH_PROVIDER=oauth` never reaches `session.init()` or any `/api/oauth/*` URL. Prove the selection with `src/lib/auth/authApi.test.ts` (create it if absent):

```ts
import { describe, expect, it, vi } from 'vitest'
describe('auth provider selection', () => {
  it('defaults to the Firebase provider and does not call bootstrap of the OAuth one', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', '')
    const mod = await import('./authApi')
    expect(mod.AUTH_KIND).toBe('firebase'); expect(mod.authApi.kind).toBe('firebase')
  })
  it('selects the OAuth provider only for VITE_AUTH_PROVIDER=oauth', async () => {
    vi.resetModules(); vi.stubEnv('VITE_AUTH_PROVIDER', 'oauth'); vi.stubEnv('VITE_API_BASE_URL', 'https://goms.test')
    const mod = await import('./authApi')
    expect(mod.authApi.kind).toBe('oauth')
  })
})
```

- [ ] **Step 4: Secrets hygiene scan**

```bash
git diff d31f9dd9 --stat
git grep -n -i "client_secret\|AUTH_SESSION_SECRET" -- . ':!docs' ':!*.test.ts' ':!apps/api/src/auth/oauth' ':!apps/api/src/testHelpers' ':!apps/api/.env.oauth.example'
git ls-files | grep -E "\.env\.oauth$|\.env\.local$" && echo "BAD: secret file tracked" || echo "no secret files tracked"
```
Expected: no hits outside the OAuth module, tests, docs and the example; no secret files tracked; the diff contains no real credential (search for `GOCSPX-`).

- [ ] **Step 5: Manual validation before any deploy** — see "Manual validation" below; local web sign-in against the real Google client, using your own `.env.oauth`.

- [ ] **Step 6: Commit anything verification produced**, then stop. Do **not** push, deploy, create secrets, apply migrations anywhere but the local DB, or change any environment.

---

## Secret Manager configuration (NOT executed by this plan — rollout approval #1)

Project `goms-dev` only. Values are piped from files/stdin and never printed or placed in shell history arguments.

```bash
# 0. who runs the API (read-only; to know which principal needs access)
gcloud run services describe goms-api --project=goms-dev --region=asia-south1 --format='value(spec.template.spec.serviceAccountName)'

# 1. the Google OAuth client secret (from the owner's local .env.oauth, without echoing it)
grep '^GOOGLE_OAUTH_CLIENT_SECRET=' apps/api/.env.oauth | cut -d= -f2- | tr -d '\r\n' \
  | gcloud secrets create goms-google-oauth-client-secret --project=goms-dev --replication-policy=automatic --data-file=-

# 2. a NEW, unrelated session-signing secret (48 random bytes)
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))" \
  | gcloud secrets create goms-auth-session-secret --project=goms-dev --replication-policy=automatic --data-file=-

# 3. let only the runtime service account read them
for S in goms-google-oauth-client-secret goms-auth-session-secret; do
  gcloud secrets add-iam-policy-binding $S --project=goms-dev \
    --member="serviceAccount:<RUNTIME_SA_FROM_STEP_0>" --role=roles/secretmanager.secretAccessor
done
```
Verify without reading values: `gcloud secrets versions list goms-auth-session-secret --project=goms-dev` shows version 1 `enabled`. Rotation later = add a new version; the session secret rotating signs everyone out within 15 minutes (existing refresh tokens keep working; only access tokens are invalidated).

## Rollback

| Layer | Action | Effect |
|---|---|---|
| Fastest (API) | `gcloud run services update goms-api --project=goms-dev --region=asia-south1 --update-env-vars=AUTH_PROVIDER=firebase` (env-only revision) | OAuth routes 404; GOMS tokens rejected; Firebase unchanged. Existing Firebase sessions were never affected. |
| Frontend | Firebase Hosting rollback to the version recorded before the deploy (`firebase hosting:clone` / console "Rollback"), or redeploy a build with `VITE_AUTH_PROVIDER` unset | Users return to Firebase sign-in. |
| Code | Route traffic back to the previous Cloud Run revision (`gcloud run services update-traffic … --to-revisions=<prev>=100`) | Pre-OAuth API. The three new tables are unused, harmless. |
| Data | `npx node-pg-migrate down` through the `goms-migrate` job drops the three OAuth tables | Only OAuth session data is lost; nothing else references them. Take a Cloud SQL backup first (as in the RBAC deploy). |
| Secrets | Disable the secret versions | The routes answer 503 (misconfigured), never leak. |
| Android web side | Roll back the Hosting release (installed shells follow on next load) | No APK involved. |
| Android native | Keep the previous APK file; the dev flavor is a separate app and can simply be uninstalled | A bad shell cannot be fixed remotely except by what the pinned origin serves, which is why the shell logic is kept small. |

---

## Manual validation (cannot be automated here)

**Local web** (own Google account on the owner's `.env.oauth`): (1) Sign in → returns to the page you were on, address bar shows no `auth_code`, `localStorage['goms.auth.refresh']` exists, no access token in storage. (2) Reload → still signed in. (3) Sign out → returns to signed-out; refresh token cleared. (4) A non-`@amnex.com` Google account → "isn't an @amnex.com account" dialog, nothing stored. (5) Edit `AUTH_ACCESS_TTL_SECONDS=60`, wait → next action refreshes silently (Network tab shows one `/api/oauth/refresh`). (6) Open two tabs, idle past expiry, trigger both at once → both stay signed in (cross-tab lock). (7) Copy the refresh token, sign out in the UI, replay it with `curl -X POST …/api/oauth/refresh` → 401. (8) Admin Data Import still gated by `ADMIN_IMPORT_ALLOWED_EMAILS`.
**Dev web** (after approvals #1–#5): repeat 1–8 on `goms-dev.firebaseapp.com`; additionally confirm a Firebase-signed-in browser (old build tab) keeps working while `AUTH_PROVIDER=both`.
**Android** (after approval #6; dev flavor on a test device — it installs beside any existing GORMS app and cannot touch its data): (1) `adb install` the dev APK; the app loads the **hosted dev origin**, `window.Capacitor` exists, the user agent contains `GOMSShell/2 GOMSScheme/com.gorms.app.dev`. (2) A trivial visible web change deployed to dev Hosting appears after relaunch **with the same installed APK**. (3) Sign in → system browser → Google → "Open GOMS" (auto or button) → back in the app, signed in; nothing sign-in-related in WebView `localStorage`. (4) Kill and reopen → still signed in (secure storage); airplane mode then reopen → still signed in (offline ≠ revoked) and the offline page shows "Try again" for an unreachable origin and recovers. (5) Sign out; non-amnex account shows the forbidden message. (6) Links: another host opens the browser; `http://`, `intent:` and a look-alike host do not load in the WebView; `/api/oauth/google/callback` typed into the WebView is blocked. (7) Install the **prod** flavor beside it (separate app, separate scheme): a dev deep link does not open prod and vice versa. (8) Old-shell simulation: a build without the secure-storage plugin refuses sign-in with "Update the app" and writes nothing to storage. (9) `adb shell dumpsys package com.gorms.app.dev` shows the `com.gorms.app.dev://auth` filter; `chrome://inspect` is refused on a release build. (10) Back button closes overlays, then navigates, then exits; export/share still work.

---

## Staging / rollout checklist — each item is a **separate approval**

Nothing below is performed by executing Tasks 0–17. Production is not part of this plan.

**Open decision carried into the rollout: Q2 (stranded local data in existing installs) is OPEN.** It gates only the *production* APK (item 7). Inventory procedure: install register + per-device check (no tools, or `adb run-as` on debug builds) with one outcome per install — **Nothing to keep / Keep / Unknown**. Gate: any **Keep** requires its CSV export before that device is upgraded; any **Unknown** keeps Q2 open and the production APK blocked.

1. **Secret Manager secrets** — create `goms-google-oauth-client-secret` and `goms-auth-session-secret` in `goms-dev`; grant the runtime service account `secretAccessor` (commands above). *Precondition:* the owner confirms `.env.oauth` holds the intended client; the Google console lists the dev redirect URI. *Verify:* version listing; no value printed.
2. **Migration** — build the API image from the reviewed commit (Cloud Build from a `git archive`), take an on-demand Cloud SQL backup, point `goms-migrate` at the image and run it; confirm `pgmigrations` gains exactly `1791100000000_oauth-sessions`; row counts of all existing tables unchanged. *Rollback:* migrate down (above).
3. **Dev API configuration** — one env-only revision on the **current** image: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI=https://goms-dev.firebaseapp.com/api/oauth/google/callback`, **`OAUTH_APP_SCHEME=com.gorms.app.dev`**, `--update-secrets` for the two secrets, and `AUTH_PROVIDER=firebase` stated explicitly. **No CORS change**: the shell is same-origin with the API, so `https://localhost` is *not* added to `CORS_ALLOWED_ORIGINS`. Old code ignores all of it, so this is a no-op. *Verify:* revision ready; `auth.me` unchanged.
4. **Dev frontend configuration** — decide the build variables for the dev hosting build: `VITE_AUTH_PROVIDER=oauth` (all other dev variables exactly as in `.gitlab-ci.yml`'s `deploy-dev`; `VITE_API_BASE_URL` stays the hosted dev origin); record the current Hosting version id for rollback. No deploy yet.
5. **Dev deployment** — three gated sub-steps, each needing its own yes: **5a** deploy the new API image with `AUTH_PROVIDER=firebase` (no-op proof: health, Firebase sign-in, RBAC smoke, `/api/oauth/*` → 404); **5b** flip `AUTH_PROVIDER=both` (env-only) and smoke-test OAuth routes with curl; **5c** deploy the Hosting build from approval 4 and run the dev web manual validation. Dev's `RBAC_MODE` is not touched at any point.
6. **Android dev build and testing** — **native first, web second**: build the **dev flavor** APK (`com.gorms.app.dev`, pinned to `https://goms-dev.firebaseapp.com`, versionCode 2) per Task 14 and install it on a test device; it installs beside, and cannot affect, any existing GORMS app. Distribution is a **private** GCS object or internal share (never public Hosting). Run the Android manual validation. Needs 5a and 5b in place for sign-in to work; the hosted web (5c) is feature-gated by `hasCapability`.
7. **Later: production rollout** — **out of scope for this plan.** It requires its own spec addendum and plan (prod secrets, prod redirect URI in the Google client, prod `OAUTH_APP_SCHEME` left unset, prod `AUTH_PROVIDER` staging, prod frontend and the **production APK**) and its own approvals, and the prod APK additionally requires **Q2 resolved** (the conditional gate above). Cutover of dev from `both` to `oauth`, and any removal of Firebase code, are likewise later, separately approved changes.

**Owned by the thin-shell plan, not this one:** `shell-manifest.json` (public, no APK link, private distribution text only), the update-available / update-required UI, migrating `AppLayout.tsx` and `file-export.ts` to `hasCapability`, and the CSP header (report-only for one release, a report-collection endpoint, enforce only after reviewing real reports; during `AUTH_PROVIDER=both` its `connect-src` must still allow the Firebase endpoints, and the server-side OAuth flow adds no browser-side Google host).

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| Server-side code flow; state, PKCE (to Google), nonce | 4 (`createFlow`/`consumeFlow`), 6 (`buildAuthUrl`, exchange), 7 (callback) |
| Exact redirect-URI match; `https`/localhost only; exact path | 2 (`oauthConfig`), 6 (`redirect_uri` sent verbatim), 7 |
| Google ID-token validation (JWKS, iss, aud, exp, nonce, email_verified, `@amnex.com`, RS256 only) | 6 |
| GOMS exchange code: random, hashed, 60 s, atomic single use, bound to identity/family/client; **not** PKCE-bound | 1, 4, 7 |
| Web handoff `?auth_code=` + `history.replaceState` before any await | 7 (redirect), 12 |
| Android system browser + per-flavor deep link + secure storage, loaded from the hosted origin | 7 (app page, `OAUTH_APP_SCHEME`), 11 (`nativeShell`), 13 (web side), 14 (native shell), 15 (guards) |
| Thin shell: no `server.url` shortcut, pinned per-flavor origin, exact-origin navigation policy, side-by-side dev/prod | 14, 15 |
| Web-only vs native release boundary; native first, web second; Q2 gates the production APK | boundary section, rollout checklist |
| No `localStorage` fallback inside the shell; old APK fails closed | 11 (`selectTokenStore`), 13 |
| `auth_flows` / `auth_exchange_codes` / `auth_sessions` additive migration | 1 |
| Access JWT 15 min HS256, claims exactly iss/aud/sub/email/sid/iat/exp, no RBAC | 3 |
| Refresh rotation = one atomic compare-and-set; reuse revokes the family; concurrent test on real Postgres | 5, 7 |
| Logout / family revocation | 5, 7 |
| Web single-flight + `navigator.locks`; offline ≠ revoked | 10 |
| `verifyIdentity` seam + `AUTH_PROVIDER` modes; RBAC/Admin Import unchanged | 8 |
| Bearer tokens, no cookies, tokens never in URLs | 7, 10, 11, 12 |
| `AUTH_PROVIDER=firebase` default and no-op first deploy; no Firebase removal | 2, 7, 8, 9, 17 |
| Client auth/session changes behind `VITE_AUTH_PROVIDER` | 9, 11 |
| Dependencies (`jose`, `@capacitor/browser`, secure storage) | 3, 13 |
| Secret Manager, local dev config, rollback, manual validation, 7-item approval checklist | sections above, 16 |

**Deliberately not in this plan:** production; Firebase removal; profile name/photo for OAuth sessions (spec change needed); verified Android App Links; RBAC changes; the thin-shell web items (update banner, `shell-manifest.json`, CSP, `AppLayout`/`file-export` migration); deciding Q2.
