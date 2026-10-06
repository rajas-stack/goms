# Google OAuth login (replacing Firebase sign-in) — design

**Status:** Draft for review (2026-10-06). Design approved in conversation; this spec awaits written review before any plan or code.
**Related:** [RBAC design](2026-10-06-rbac-design.md) — this change is deliberately invisible to RBAC (§4.1).

## 1. Purpose and scope

GOMS users sign in with Google through the Firebase Web SDK today; the API verifies the resulting Firebase ID token. The project owner has created a Google Cloud OAuth client (type *Web application*) and wants sign-in to run on it directly, **replacing Firebase sign-in**, for the **web app and the Android (Capacitor) app**. The verified `@amnex.com` email it yields must feed RBAC exactly as the Firebase email does now.

**Goals**
- A server-side OAuth 2.0 authorization-code flow with PKCE using the owner's Google Cloud OAuth client.
- API-issued sessions the web and Android clients both carry as `Authorization: Bearer`.
- Staged cut-over behind `AUTH_PROVIDER`, so dev can run both methods and nobody is locked out mid-RBAC-validation.
- Admin Data Import, the access API and every RBAC path keep working unchanged.

**Non-goals**
- Calling Google APIs on a user's behalf (Drive, Calendar, Gmail): scopes stay `openid email profile`.
- Changing RBAC, role derivation, `ADMIN_ALLOWED_EMAILS` or `ADMIN_IMPORT_ALLOWED_EMAILS`.
- Cookies or server-rendered sessions (Firebase Hosting forwards only `__session` to Cloud Run, and cookies are unreliable in the native shell).
- Production. Production rollout is a separate approval after dev is proven.
- Removing the Firebase dependency in the first release (§7, step 4).

## 2. Context (what exists)

- `apps/api/src/auth/identity.ts` — `verifyFirebaseToken(authHeader)` returns `{uid, email}`; `isAmnexAccount`, `isAllowListed`.
- Every procedure tier in `apps/api/src/trpc.ts` (`protectedProcedure`, `protectedReadProcedure`, `adminProcedure`, `accessProcedure`, `rbacGate`) and `verifyAdminImportToken` reach identity through that one function; `routers/auth.ts#me` also calls it.
- Frontend: `src/lib/firebaseAuth.ts`, `src/data/remote/authHeaders.ts` (attaches the Bearer token), `AuthStatus`, `AuthPromptDialog`, `AdminImportAuthGate`, `AdminImportModal`.
- Capacitor shell `com.gorms.app` (`capacitor.config.ts`, `android/`).
- Browser traffic reaches the API through Firebase Hosting's `/api/**` rewrite to Cloud Run (`firebase.json`).

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Server-side code flow + PKCE; the API issues its own session | Uses the client secret the owner created; no hourly Google ID-token expiry; works for web and Android |
| D2 | Sessions travel as Bearer tokens, never cookies | Hosting forwards only `__session`; cookies fail in the Capacitor webview; keeps the existing header contract |
| D3 | Identity seam: `verifyFirebaseToken` → `verifyIdentity`, same `{uid, email}` result | RBAC and all gates untouched |
| D4 | `AUTH_PROVIDER` = `firebase` (default) \| `both` \| `oauth` | Zero-risk deploy; dev can run both; clean rollback |
| D5 | `@amnex.com` and `email_verified` enforced server-side; `hd=amnex.com` is only a hint | `hd` can be bypassed by a crafted request |
| D6 | Android returns via an `https` callback that deep-links into the app with a one-time code | Google web clients cannot redirect to a custom URL scheme |
| D7 | Access token 15 min, refresh token 30 days rotating with reuse detection (defaults, configurable) | Short blast radius, no daily re-login |

## 4. Architecture

### 4.1 Identity seam (what RBAC sees)

`verifyIdentity(authHeader)` replaces `verifyFirebaseToken` at every call site and returns `{ uid, email }`:

- `AUTH_PROVIDER=firebase`: Firebase only (today's behaviour; the new routes answer 404).
- `both`: if the Bearer token is a GOMS token (`iss=goms`, `alg=HS256`), verify it; otherwise verify it as Firebase.
- `oauth`: GOMS tokens only; a Firebase token is `UNAUTHORIZED` ("Your session has expired. Please sign in again.").

`uid` for a GOMS identity is `g:<google sub>`. Email is lower-cased. Everything downstream — `isAmnexAccount`, `loadUserFacts`, `ADMIN_ALLOWED_EMAILS`, overrides, readiness — keys on email and is unchanged. Error messages and codes for missing/expired/unverified tokens keep their current wording so the client's auth-prompt link keeps working.

### 4.2 Routes (Fastify, outside tRPC, under `/api/oauth/`)

| Route | Purpose |
|---|---|
| `GET /api/oauth/google/start?client=web\|app&return_to=/path` | Creates a flow record (`state`, PKCE verifier, nonce, client kind, validated `return_to`) valid 10 minutes; 302 to Google with `scope=openid email profile`, `hd=amnex.com`, `prompt=select_account`, `code_challenge_method=S256` |
| `GET /api/oauth/google/callback` | Looks up and **deletes** the flow by `state`; exchanges `code` (+ secret + verifier) at Google's token endpoint; validates the ID token (signature via Google JWKS, `iss`, `aud`=client id, `exp`, `nonce`, `email_verified`, `@amnex.com`); creates a session. Creates a one-time exchange code. `client=web`: 302 to `${return_to}?auth_code=<code>` (§ Web handoff below). `client=app`: renders a small page that deep-links `com.gorms.app://auth?code=<code>` |
| `POST /api/oauth/exchange` | `{ code, code_verifier? }` → `{ accessToken, refreshToken, expiresIn }`. One-time code, 60 s, single use |
| `POST /api/oauth/refresh` | `{ refreshToken }` → new pair; the old refresh token is marked replaced |
| `POST /api/oauth/logout` | `{ refreshToken }` → revokes the session family |

**Web handoff.** The callback never puts long-lived tokens in a URL. It redirects to `${return_to}` with a one-time `?auth_code=<code>`; the SPA immediately POSTs it to `/api/oauth/exchange`, strips the parameter with `history.replaceState`, and stores the result. Web and app therefore share the same exchange mechanism (the code is bound to the flow's PKCE challenge in both).

`return_to` must be a same-origin relative path (`/…`, no `//`, no scheme, no backslash); anything else becomes `/`.

### 4.3 Tokens and sessions

- **Access token:** JWT, `HS256`, signed with `AUTH_SESSION_SECRET` (≥ 32 random bytes, from Secret Manager), claims `iss=goms`, `aud=goms-api`, `sub=g:<sub>`, `email`, `sid` (session id), `iat`, `exp` (15 min). Stateless; not individually revocable (bounded by its life).
- **Refresh token:** 256-bit random, opaque; only its SHA-256 is stored.
- **Rotation and reuse detection:** each refresh issues a new refresh token and marks the old one replaced. Presenting an already-replaced token revokes the whole session family (`revoked_at`) — the signal that a token leaked.
- **Re-checks at refresh:** the email must still be `@amnex.com` and the session unexpired and unrevoked.

### 4.4 Data model (one additive migration; next number after `1791000000000`)

- `auth_flows(state_hash PK, code_verifier, nonce, client, return_to, created_at, expires_at)` — deleted on callback; a sweep removes expired rows.
- `auth_exchange_codes(code_hash PK, session_id, code_challenge, created_at, expires_at, used_at)`.
- `auth_sessions(id uuid PK, uid, email, refresh_hash UNIQUE, family_id uuid, replaced_at, revoked_at, created_at, expires_at, last_used_at, user_agent)`; index on `family_id` and `email`.

No existing table changes. Down migration drops the three tables.

### 4.5 Configuration

| Variable | Where | Notes |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | API (secret via Secret Manager on Cloud Run; `apps/api/.env.oauth` locally) | Redirect URI is the Hosting-origin callback, e.g. `https://goms-dev.firebaseapp.com/api/oauth/google/callback` |
| `AUTH_SESSION_SECRET` | API (Secret Manager) | New; generated, never reused from any other secret |
| `AUTH_PROVIDER` | API | Default `firebase` |
| `AUTH_ACCESS_TTL_SECONDS` (900), `AUTH_REFRESH_TTL_DAYS` (30) | API | Optional |
| `VITE_AUTH_PROVIDER` | Frontend build | `firebase` (default) \| `oauth`; picks the sign-in UI |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Frontend (optional) | Not needed by the server-side flow; present in `.env.local` for tooling only |

The Google Cloud OAuth client must list as **Authorized redirect URIs**: the dev Hosting callback, `http://localhost:<api port>/api/oauth/google/callback`, and (only when prod is approved) the prod callback.

## 5. Clients

### 5.1 Web

- New `src/lib/session.ts`: in-memory access token; refresh token in `localStorage`; `signIn()` (full-page redirect to `/api/oauth/google/start`), `signOut()`, `getAccessToken()` (refreshes when < 60 s remain, single-flight), `onSessionChange(cb)`.
- `getAuthHeaders` uses `session.getAccessToken()` when `VITE_AUTH_PROVIDER=oauth`; otherwise today's Firebase path. On a `401`, one refresh-and-retry, then the existing `authPromptLink` prompt.
- `AuthStatus`, `AuthPromptDialog`, `AdminImportAuthGate`, `AdminImportModal` swap the Firebase hooks for `session` equivalents, keeping their UI and copy. No popups.

### 5.2 Android (Capacitor)

- Sign-in opens the system browser (`@capacitor/browser`) at `start?client=app`; the callback page deep-links `com.gorms.app://auth?code=…`; `@capacitor/app`'s `appUrlOpen` receives it and POSTs `/api/oauth/exchange`.
- `AndroidManifest.xml` gains an intent filter for the `com.gorms.app` scheme.
- Tokens are held in Android-backed secure storage (a Capacitor secure-storage plugin), not `localStorage`.
- The API's `CORS_ALLOWED_ORIGINS` must already admit the shell's origin; verified in the plan.

## 6. Security

- `state` is single-use and bound to the flow record; PKCE (S256), nonce and exact `aud`/`iss` checks are mandatory; no step is skippable by a client parameter.
- Exchange codes: 60 s, single use, bound to the PKCE challenge, stored hashed.
- Only SHA-256 of refresh tokens and codes is stored; the client secret and signing key never leave the server and never enter git or the browser bundle.
- OAuth routes sit behind the existing rate limiter; failures return a generic message and log a reason code only (never tokens, codes or emails of rejected attempts beyond the domain).
- `@amnex.com` and `email_verified` are re-validated server-side at callback and at every refresh.
- Logout and reuse detection revoke at the session-family level.
- Token-in-URL exposure is limited to a 60-second single-use code, stripped from history immediately.

## 7. Staging and rollback

1. Ship the code with `AUTH_PROVIDER=firebase` (no behaviour change; routes 404). Migration applied first (additive).
2. goms-dev: store the secrets in Secret Manager, set `AUTH_PROVIDER=both`, build the web app with `VITE_AUTH_PROVIDER=oauth`; run the signed-in checks (§8).
3. Prove the Android flow on a dev build.
4. Later, separately approved: `oauth` mode, then remove Firebase sign-in code, the Firebase client config and the `goms-dev-auth` dependency.
5. Production only after dev is proven, with its own approvals.

**Rollback:** set `AUTH_PROVIDER=firebase` (env-only revision change) and rebuild the frontend with `VITE_AUTH_PROVIDER=firebase`. Existing Firebase sessions are unaffected throughout `both`. Sessions in `auth_sessions` simply stop being accepted.

Each env change, secret creation and deploy is a separate approval; none is implied by this spec.

## 8. Testing

- **API (real Postgres, Google endpoints stubbed):** full web flow; full app flow; wrong/missing/reused `state`; bad nonce; wrong `aud`/`iss`; expired ID token; `@gmail.com`; `email_verified=false`; replayed or expired exchange code; refresh rotation; refresh-token reuse revokes the family; logout; `return_to` open-redirect attempts (`//evil`, `https://evil`, `\\evil`).
- **Identity seam:** in each `AUTH_PROVIDER` mode, a Firebase token and a GOMS token each resolve to the same `loadUserFacts`; `oauth` rejects Firebase; `firebase` rejects GOMS; System Admin allow-list and Admin Import allow-list behave identically across both.
- **Unaffected paths:** the existing RBAC suites run unchanged with `AUTH_PROVIDER=firebase` and `both`.
- **Client:** `session.ts` refresh/single-flight/401-retry; auth components in signed-in/out states; Admin Import gate.
- **Manual, before any dev deploy (cannot be automated here):** signed-in web click-through, sign-out, expiry/refresh, and the Android sign-in.

## 9. Assumptions to confirm

1. The OAuth client the owner created is type *Web application* and is in the same Google Cloud project that owns the consent screen (internal user type, so only the Amnex Workspace can sign in).
2. Adding `@capacitor/browser` and a secure-storage plugin (and `jose` on the API) is acceptable; each new dependency is confirmed in the plan.
3. The Hosting origin is the single callback origin for dev (`goms-dev.firebaseapp.com`) so the browser never sees a second API origin.
4. 15-minute access and 30-day refresh lifetimes are acceptable defaults.
