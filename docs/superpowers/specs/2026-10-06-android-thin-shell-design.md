# GOMS Android app as a thin native shell around the hosted web app — design

**Status:** Draft for review (2026-10-06). Design and implementation plan only; nothing has been built, installed or changed in `android/`.
**Related:** [Google OAuth login design](2026-10-06-google-oauth-login-design.md) — preserved unchanged except one optional, additive item (§6.4). [RBAC design](2026-10-06-rbac-design.md) — untouched.

## 1. Purpose and scope

The Android app should be a **thin Capacitor shell**: it loads the hosted GOMS web application, so a normal frontend deploy to Firebase Hosting updates the UI inside installed apps without a new APK. The shell owns only what a web page cannot do: the OAuth deep link, secure token storage, the hardware back button, file export/share, and the rules about which content may run inside it.

**Goals**
- A normal `npm run build` + Hosting deploy changes what installed apps show, with no APK.
- The finalized OAuth architecture works end to end in the shell: system browser → HTTPS Google callback → one-time GOMS exchange code → `com.gorms.app://auth` → `POST /api/oauth/exchange` → tokens in Android-backed secure storage.
- The WebView can only ever show the GOMS origin for its flavor; everything else leaves the app.
- A written, testable boundary between "needs a new APK" and "web release only", with a runtime guard for the cases where the two drift.

**Non-goals**
- Duplicating any GOMS UI in Android, or offline-first behaviour. The app already requires the API in connected mode, so offline means a clear "can't reach GOMS" page, not cached data.
- Play Store distribution (sideload/internal only, as in `android/README.md`).
- iOS.
- Changing OAuth, RBAC or any API contract beyond §6.4.
- Building the APK. This document stops at the plan.

## 2. Verified facts about the current setup

Everything below was read from the repo and from `node_modules/@capacitor/android` (Capacitor **8.4.2**), not assumed.

| # | Fact | Source | Consequence |
|---|---|---|---|
| F1 | Today the shell bundles `dist` and serves it from `https://localhost` (`webDir: 'dist'`, no `server` block). | `capacitor.config.ts`, `android/app/src/main/assets/` | Every UI change currently needs a new APK. |
| F2 | The native bridge script (`window.Capacitor`, plugin headers) is injected with `WebViewCompat.addDocumentStartJavaScript` for **one origin only: the origin of `appUrl`** (the local origin, or `server.url` when set). | `Bridge.java` ~L264-274, L620-643 | A remote page reached only through `server.allowNavigation` gets **no** `window.Capacitor`: `Capacitor.isNativePlatform()` is `false` there and every plugin falls back to its web implementation. `allowNavigation` alone cannot give a hosted page native features. |
| F3 | The `androidBridge` message listener is registered for `allowedOriginRules` = local origin + `server.url` + each `allowNavigation` host. | `Bridge.java` L236-255, `MessageHandler.java` L36 | Plugin calls are origin-filtered by this list, so the list must be exact: one hosted origin, no wildcards. |
| F4 | Default navigation policy: a main-frame URL whose host is not the app host and not in the `allowNavigation` mask is handed to `ACTION_VIEW` (any scheme); everything else loads in the WebView. | `Bridge.launchIntent`, `BridgeWebViewClient.shouldOverrideUrlLoading` | Defaults are permissive about schemes (`intent:`, `file:`…) and the mask supports wildcards. A custom policy is needed. |
| F5 | `server.errorPath` is resolved against the **local** origin (`getHost()`/`getScheme()`), not `server.url`. | `Bridge.getErrorUrl` L547-557 | An offline/error page bundled in the APK still works when the main origin is remote. |
| F6 | `BridgeActivity.config` is a `protected CapConfig` that `load()` passes to the bridge; `CapConfig.Builder` exposes `setServerUrl`, `setAllowNavigation`, `setErrorPath`, `setAppendedUserAgentString`, `setWebContentsDebuggingEnabled`, `setAllowMixedContent`. | `BridgeActivity.java` L13-19, 45-48; `CapConfig.java` L614-704 | The remote origin can be set in native code at build time instead of in editable JSON. |
| F7 | `MainActivity` is `singleTask`, has no deep-link filter, `allowBackup="true"`, INTERNET only; there are no flavors, and `applicationId` is `com.gorms.app`, versionCode 1. | `AndroidManifest.xml`, `app/build.gradle` | Manifest, flavor and backup changes are all native-release items. |
| F8 | Hosting already serves `index.html` with `no-cache` and hashed assets `immutable`; a stale-chunk reload recovery exists. There is **no CSP header**. | `firebase.json`, `src/lib/staleChunkRecovery.ts` | New web releases reach the WebView on the next load; the stale-chunk case is handled; XSS hardening is missing and matters more once the origin has native access (§7). |
| F9 | The hosted prod build already uses `VITE_API_BASE_URL=https://goms-prod.web.app` (same origin as the site). | `.env.example` | Running the shell on the hosted origin makes the API same-origin: no CORS entry for the shell is needed. |
| F10 | Plugins present: `@capacitor/app`, `filesystem`, `share`. The OAuth spec adds `@capacitor/browser` and a secure-storage plugin. `AppLayout.tsx` already wires the hardware back button behind `Capacitor.isNativePlatform()`. | `package.json`, `AppLayout.tsx` | Back-button/export code keeps working only if the hosted origin receives the bridge (F2). |

## 3. The central design decision: how a hosted origin gets native powers

F2 means there is exactly one Capacitor mechanism that gives a remote page the bridge: make the remote origin the bridge's `appUrl`. That is the same field `server.url` sets. The prohibition is therefore applied to **how and where** it is set, not to a different mechanism that does not exist.

**Approaches considered**

| | Approach | Verdict |
|---|---|---|
| **A** | **Pinned remote app origin, set in native code per Gradle flavor** (not in `capacitor.config.ts`), wrapped by a custom exact-origin navigation policy, hardened WebView settings, local error page and a CI guard that forbids `server.url` in config files. | **Recommended** |
| B | `server.url` in `capacitor.config.ts` plus wildcard `allowNavigation` | Rejected: this is the dev shortcut. It is editable JSON that `cap sync` copies into the APK, easy to leave pointing at a LAN/dev URL, with no policy beyond Capacitor defaults. |
| C | `allowNavigation` only, local shell page that navigates to the hosted origin | Rejected: F2, the hosted page would have no native bridge, so no secure storage, deep-link handler or back button. |
| D | OTA bundles (a Capgo-style updater): the app serves downloaded `dist` zips from the local origin | Credible fallback, not chosen: keeps the bridge off remote content, but adds an updater plugin, a signed-bundle publish step on every deploy, rollback logic and a CORS entry for `https://localhost`. It makes "normal website deploys update the app" depend on a second pipeline. Revisit only if the §7 residual risk is judged unacceptable. |

**What makes A different from the shortcut**
1. `capacitor.config.ts` stays free of `server.url`, `cleartext` and wildcard `allowNavigation`; a test fails the build if they appear (§9, P3).
2. The origin comes from `BuildConfig.GOMS_ORIGIN`, fixed per flavor at compile time, validated at startup (https, no path, no wildcard, matches an in-code allowlist), and the app refuses to start the WebView if validation fails.
3. A custom `WebViewClient` enforces an exact-origin policy that Capacitor's mask cannot express (§5.2).
4. `appUrl` remote means the bridge is injected for that one origin only; the plugin surface is minimised and the origin is protected by CSP (§7).
5. Offline behaviour is a deliberate local page (F5), not a blank WebView.

## 4. Release boundary

### 4.1 New APK required (native release)
- `AndroidManifest.xml` (deep-link intent filter, permissions, `allowBackup`, `usesCleartextTraffic`, network security config).
- Adding, removing or upgrading a Capacitor plugin, the Capacitor major version, or any Android plugin/native code (secure storage, Browser, Filesystem, Share, App).
- Secure-storage behaviour or schema.
- Android permissions.
- Any new native capability.
- `applicationId`, app name/icon/splash, signing key, `versionCode`/`versionName`.
- The **pinned origin or origin allowlist** (e.g. a new prod hostname), the navigation-policy code, WebView settings, the local offline page, the deep-link scheme/host.

### 4.2 No APK (web or API release only)
- All React/TypeScript/CSS, forms, dashboards, Bid Tracker, RBAC UI, routes, business logic, feature flags.
- Firebase Hosting config: headers, CSP, rewrites, cache rules.
- API and OAuth server behaviour, including the HTML of the callback page that issues the `com.gorms.app://auth?code=…` deep link, provided the scheme and host do not change.
- `shell-manifest.json` (update notice contents, §4.3).

### 4.3 Keeping the two honest: a capability contract
The web is deployed to a fleet of old and new APKs at once, so the web must never assume a native feature exists.

- The shell appends `GOMSShell/<versionCode>` to the WebView user agent (`setAppendedUserAgentString`). The server can log it; the web reads it synchronously.
- New `src/lib/nativeShell.ts` exposes `isGomsShell()`, `shellVersion()`, `hasCapability(name)` (`Capacitor.isPluginAvailable` plus a version table), and is the only place native availability is decided. Features that need a native capability use `hasCapability`, never `isNativePlatform()` directly (existing uses are migrated in P2).
- Hosting serves `/shell-manifest.json` (`Cache-Control: no-cache`): `{ "latest": { versionCode, versionName, apkUrl, sha256 }, "minSupported": <versionCode> }`.
  - Installed `versionCode` < `latest`: a dismissible "Update available" banner.
  - Installed < `minSupported`: a blocking "Update required" screen (used when a web release depends on a native capability or a security fix).
  - Because this is data on Hosting, shipping a new APK is: publish the APK, then bump the manifest. No APK is needed to *announce* an APK.
- Ordering rule: **native first, web second.** Roll the APK out (and bump `latest`), then ship the web release that uses it, gated by `hasCapability`. Only raise `minSupported` once adoption is acceptable.
- `docs/` gets a short release-matrix page (this section) so a developer can answer "does this need an APK?" from the file list of the change.

## 5. Architecture

```
 Android device
 ┌───────────────────────────────────────────────────────────────────┐
 │ MainActivity (BridgeActivity, singleTask)                         │
 │   config = CapConfig.Builder(...).setServerUrl(GOMS_ORIGIN)       │
 │             .setAllowNavigation([])   // exact policy is in client│
 │             .setErrorPath("offline.html") .setAppendedUserAgent() │
 │   WebViewClient = GomsWebViewClient → NavigationPolicy (pure Java)│
 │ ┌───────────────────────────────────────────────────────────────┐ │
 │ │ WebView  — only ever shows  https://goms-<env> origin         │ │
 │ │   window.Capacitor bridge injected for that origin only (F2)  │ │
 │ │   plugins: App, Browser, Filesystem, Share, SecureStorage     │ │
 │ └───────────────────────────────────────────────────────────────┘ │
 │ assets/public/ : offline.html (+ tiny CSS)   ← the only bundled UI│
 │ Custom Tab (system browser): OAuth start → Google → callback      │
 │ Deep link  com.gorms.app://auth?code=…  → MainActivity → appUrlOpen│
 └───────────────────────────────────────────────────────────────────┘
        │ HTTPS (same origin)                       ▲ 302 / deep link
        ▼                                           │
 Firebase Hosting (dist, /shell-manifest.json) ── /api/** ──► Cloud Run goms-api
```

### 5.1 Flavors and pinned origins

| Flavor | `applicationId` | `GOMS_ORIGIN` (exact, https, no path) | Deep-link scheme |
|---|---|---|---|
| `prod` | `com.gorms.app` | `https://goms-prod.web.app` | `com.gorms.app` |
| `dev` | `com.gorms.app.dev` (installs beside prod) | `https://goms-dev.firebaseapp.com` | see §6.4 |

The origin must equal the origin registered as the Google OAuth redirect host. The site's other Hosting aliases (e.g. `goms-prod.firebaseapp.com`) serve identical content but are **not** allowlisted; if a link points at one, it opens in the system browser, never in the WebView. `debug` builds use the `dev` flavor; there is no flavor or build type that reads an origin from `capacitor.config`.

### 5.2 Navigation policy (`NavigationPolicy`, a plain-Java class, unit-tested without Android)

`GomsWebViewClient extends BridgeWebViewClient` and overrides `shouldOverrideUrlLoading`, delegating to `NavigationPolicy.decide(url, isMainFrame, flavorOrigin)` which returns one of `LOAD_IN_WEBVIEW`, `OPEN_EXTERNAL_BROWSER`, `HAND_TO_CUSTOM_TAB`, `HAND_TO_SYSTEM_APP`, `BLOCK`.

| URL | Decision |
|---|---|
| Scheme `https`, host and port exactly equal to the pinned origin, path **not** `/api/oauth/**` | `LOAD_IN_WEBVIEW` |
| Same origin, path `/api/oauth/google/start` with `client=app` | `HAND_TO_CUSTOM_TAB` (the sign-in must run in the system browser; Google blocks embedded WebViews, and the WebView must never see Google's pages) |
| Same origin, any other `/api/oauth/**` main-frame navigation | `BLOCK` (callbacks are reached only from the browser, never the WebView) |
| `https` to any other host (including `accounts.google.com`, other Hosting aliases, look-alike hosts such as `goms-prod.web.app.evil.com`) | `OPEN_EXTERNAL_BROWSER` |
| `http` | `BLOCK` (cleartext disabled app-wide) |
| `mailto:`, `tel:` | `HAND_TO_SYSTEM_APP` |
| `com.gorms.app://auth…` | not a WebView navigation; handled by the activity intent (§6) |
| `intent:`, `file:`, `content:`, `javascript:`, `data:` as main frame, `android-app:`, any unknown scheme | `BLOCK` |
| `blob:` / `data:` for downloads/exports the page itself created | allowed only when the initiating document is the pinned origin |

Host comparison is on the parsed `URI` authority (lower-cased, default port normalised), never `startsWith`/`contains`. Sub-frames: any non-pinned frame is blocked from loading in-app (GOMS embeds none); this also means `androidBridge` is never reachable from a third-party frame, since the origin rule list is the pinned origin only (F3).

### 5.3 Hardening (native-release items)
- `allowMixedContent=false`; `usesCleartextTraffic=false` and a `network_security_config.xml` with system CAs only and no user-added CAs in release (no certificate pinning: Hosting's Google-managed certificates rotate; pinning would turn a routine rotation into an outage).
- `WebContentsDebuggingEnabled` only in the `dev` flavor's debug build type.
- `onReceivedSslError` is never overridden to proceed.
- `android:allowBackup="false"` and `dataExtractionRules` excluding everything: refresh tokens must not enter device backups (they are Keystore-wrapped and would not restore anyway).
- Release WebView logging off; no `CapacitorHttp`/cookies plugin enabled (not used; the API call path stays plain `fetch` with the Bearer header per the OAuth spec).
- `onReceivedError`/`onReceivedHttpError` for the main frame → `offline.html` (F5): GOMS logo, "Can't reach GOMS", **Try again** (`location.replace(origin)` through the native bridge-free local page), no other behaviour. `onRenderProcessGone` recreates the WebView.
- Pull to refresh is not added; the web app already handles stale chunks (F8).

### 5.4 Bundled assets
`webDir` changes from `dist` to a tiny `android-shell/www/` containing only `offline.html`. This removes the stale copy of the app from the APK (it can never be shown by mistake), shrinks the APK, and keeps `cap sync` from copying `dist` into `android/` (this also ends the large generated-asset churn noted in the Vite watch config).

## 6. OAuth in the shell (preserved exactly)

### 6.1 Flow
1. Web code (running on the pinned origin) calls `Browser.open({ url: GOMS_ORIGIN + '/api/oauth/google/start?client=app' })`. `nativeShell.openOAuth()` builds the URL from the pinned origin it reads from the shell, never from a page-supplied value.
2. The system browser (Custom Tab) runs Google sign-in; Google redirects to the HTTPS callback on the same Hosting origin; the API callback page issues `com.gorms.app://auth?code=<one-time code>`.
3. Android routes the deep link to `MainActivity` (`singleTask`, so the existing instance resumes). `@capacitor/app` fires `appUrlOpen` in the already-loaded hosted page.
4. The handler accepts **only** `com.gorms.app://auth` with exactly one `code` parameter matching the code format (base64url, fixed length), ignores everything else, strips nothing into logs, and `POST`s `/api/oauth/exchange` with `{ code, client: 'app' }` (same-origin request).
5. Tokens go to Android-backed secure storage through a `SessionStore` adapter in `session.ts` (web uses `localStorage`; the shell uses the secure-storage plugin when `hasCapability('secureStorage')`).

### 6.2 What the shell must not do
- Never open Google in the WebView; never intercept the callback in the WebView.
- Never pass the exchange code through any other channel or log it (the OAuth spec §4.2 already requires this).
- Never persist tokens in WebView `localStorage`, cookies or Capacitor `Preferences`.

### 6.3 Why same-origin is an improvement
In the old local-origin model the app ran at `https://localhost` and needed `CORS_ALLOWED_ORIGINS` to admit it (OAuth spec §5.2 bullet 4). With the hosted origin (F9) that entry is **not needed**; the plan verifies the shell's API calls work with `https://localhost` absent from the list.

### 6.4 One optional additive OAuth item (needs your decision, §10 Q1)
So that a dev APK and a prod APK can be installed side by side, the API callback page would read the app scheme from an optional `OAUTH_APP_SCHEME` env var (default `com.gorms.app`). With it unset, behaviour is identical to the finalized spec. If side-by-side installs are not wanted, the dev flavor reuses `com.gorms.app` and this item is dropped.

## 7. Security model

The shell trades "native bridge only for code in the APK" for "native bridge for whatever the pinned origin serves". That is the real cost of the requirement, so the controls are explicit:

| Threat | Control |
|---|---|
| Navigation to an attacker page inside the WebView | Exact-origin policy (§5.2); bridge exists only for the pinned origin (F2, F3); sub-frames blocked |
| XSS on the GOMS origin reaching native plugins | **CSP header on Hosting** (web release, no APK): `default-src 'self'`; `script-src 'self'`; `connect-src 'self'` + required hosts; `frame-ancestors 'none'`; `object-src 'none'`; added in report-only first, enforced after one release of clean reports. Plugin set kept to App, Browser, Filesystem, Share, SecureStorage; no Cordova plugins; Filesystem only writes to cache/documents for exports, no storage permissions declared |
| Hostile deploy to the origin (a bad web release runs with native access) | Same trust as today's web app plus the above; CSP and Hosting access controls are the guard; `minSupported` lets an APK-side fix be forced |
| Deep-link hijack (another app claims `com.gorms.app://`) | Exchange code is 60 s, single-use, client-bound, hash-stored (OAuth spec §4.2); strict code-format check in the handler |
| Open redirect / look-alike hosts | Parsed-authority comparison with tests for `…web.app.evil.com`, `evil.com/…web.app`, userinfo tricks (`https://goms-prod.web.app@evil.com`), ports, `HTTP`/mixed case |
| Config drift to a dev/LAN URL | No `server.url` in config files (CI guard); origin is a compile-time flavor constant validated at start |
| Tokens leaking via backup/log/screenshot | `allowBackup=false`, tokens only in secure storage, no logging of codes/tokens, `FLAG_SECURE` is **not** added (users screenshot GOMS) unless you ask |
| Rooted device / debuggable release | Out of scope; release is non-debuggable, WebView debugging off |

Residual risk accepted by choosing A over D: code served by the GOMS origin has plugin access. If that is unacceptable, D is the alternative, at the cost described in §3.

## 8. Behaviour changes users will see
- **Existing installs:** the app's web origin changes from `https://localhost` to the hosted origin. WebView storage (localStorage/IndexedDB, any local-mode data, saved drafts) does **not** carry over, and users sign in again. Same `applicationId` and signing key means it installs as an upgrade (versionCode > 1). See §10 Q2.
- The Android app now always shows the exact web release currently on Hosting, including a new feature the moment it is deployed to prod. Features not yet ready must be flagged off on the web as they are today (`VITE_*_ENABLED`).
- First launch offline shows the local "Can't reach GOMS" page.

## 9. Implementation plan (phased, nothing started)

Each phase is independently verifiable. Native phases ship in the same APK; web phases ship via normal deploys. Per the project's rules, each env change, secret and deploy is its own approval.

**P0 — Prerequisites**
- Confirm §10 Q1-Q3. Confirm the OAuth plan covers `@capacitor/browser`, the secure-storage plugin and the `appUrlOpen` handler (they are owned there; this plan consumes them).

**P1 — Native shell (one APK, `dev` flavor first)**
- `android/app/build.gradle`: `productFlavors { dev, prod }` with `applicationId` suffix, `buildConfigField GOMS_ORIGIN`, `manifestPlaceholders` for the scheme; `versionCode` bump; release signing as already documented.
- `MainActivity.java`: build the pinned `CapConfig`, validate origin, append `GOMSShell/<versionCode>` UA, install `GomsWebViewClient`.
- New `NavigationPolicy.java`, `GomsWebViewClient.java`.
- `AndroidManifest.xml`: deep-link intent filter (`VIEW`, `DEFAULT`, `BROWSABLE`, scheme from placeholder, host `auth`), `allowBackup=false`, `usesCleartextTraffic=false`, `networkSecurityConfig`, `dataExtractionRules`.
- `res/xml/network_security_config.xml`, `data_extraction_rules.xml`.
- `android-shell/www/offline.html`; `capacitor.config.ts`: `webDir: 'android-shell/www'`, `errorPath: 'offline.html'`, **no `server` block**.
- JUnit tests for `NavigationPolicy` (the table in §5.2, plus the look-alike matrix in §7).

**P2 — Web changes (normal web release; works in browsers, and in old APKs because everything is feature-gated)**
- `src/lib/nativeShell.ts` (+ tests): UA parsing, `hasCapability`, version table; migrate `AppLayout.tsx` and `file-export.ts` from `Capacitor.isNativePlatform()` to it.
- `public/shell-manifest.json` (initially `latest == minSupported == installed`), update-banner and update-required components wired into the app layout, with tests.
- `firebase.json`: `Cache-Control: no-cache` for `shell-manifest.json`; CSP in report-only mode.
- `session.ts` `SessionStore` adapter hook (the OAuth plan supplies the secure-storage implementation).

**P3 — Guards and docs**
- Vitest guard test: parses `capacitor.config.ts` and the generated `android/app/src/main/assets/capacitor.config.json`; fails if `server.url`, `cleartext`, wildcard `allowNavigation` or `androidScheme: http` appear.
- Test that each flavor's `GOMS_ORIGIN` is https, pathless, and equals the origin in the OAuth redirect URI config.
- Release-matrix doc (§4) and `android/README.md` rewritten: the "npm run build → cap sync → assemble" flow becomes "assemble only; no web assets to sync", plus the shell-manifest procedure.

**P4 — Verification before any rollout**
- Unit: policy table, `nativeShell` versions, guard tests, existing web suites unchanged.
- Device/emulator (cannot be automated here): `adb install` dev flavor; app loads hosted dev origin; `window.Capacitor.isNativePlatform()` true; back button closes overlays then navigates then exits; export/share works; offline launch shows the local page and **Try again** recovers; a link to another host opens the browser; a link to `http://`, `intent:` and a look-alike host does not load in the WebView; OAuth sign-in end to end with the real dev client; token present in secure storage and absent from `localStorage`; sign-out; refresh after 15 minutes; deploy a trivial visible web change and confirm it appears after relaunch with the same installed APK; old-APK simulation: run the web release in a build without the secure-storage plugin and confirm graceful fallback / update-required screen.
- `adb shell dumpsys package` confirms the deep-link filter; `chrome://inspect` is refused on the release build.

**P5 — Rollout**
- Dev APK to a few devices; then CSP to enforce; then prod flavor APK, `shell-manifest.json` bumped, sideload instructions. Prod only after dev passes and with its own approval, consistent with the OAuth spec §7.

**Rollback**
- Web: redeploy the previous Hosting release (existing procedure); installed apps follow on next load.
- Native: users keep the previous APK; `minSupported` is lowered or `latest` pointed back. A bad shell cannot be fixed remotely except by changing what the pinned origin serves (e.g. the update-required screen), which is why §5.3 keeps the shell logic small.

## 10. Open decisions

1. **Side-by-side dev and prod installs?** Recommend yes (`com.gorms.app.dev`), which needs the optional `OAUTH_APP_SCHEME` item in §6.4. If no, dev and prod share the `com.gorms.app` scheme and cannot be installed together.
2. **Do any existing installs hold local-mode data (IndexedDB) that users need?** The repo's default build is local-mode; if installed APKs were built that way, moving to the hosted origin strands that data. If every install is in connected mode (the API holds the data), nothing is lost but drafts. Please confirm which.
3. **Where is the APK hosted for sideloading** (Hosting `/downloads`, a GCS bucket, an internal share)? This only sets `apkUrl` in `shell-manifest.json`. Recommend a private GCS object or internal share rather than the public Hosting site.
4. **CSP enforcement date.** Recommend one release in report-only mode first; the real script/connect sources need to be inventoried from the built `dist` and from Firebase/Google endpoints still in use during OAuth cut-over (`AUTH_PROVIDER=both`).

## 11. Spec self-check
- Every "new APK" item in your list maps to §4.1; every "no APK" item maps to §4.2, including the callback page HTML, which is API-served.
- `server.url` is not used as a config-file shortcut (§3, P3 guard); the remote origin is set in native code per flavor, because F2 shows no other Capacitor mechanism gives a remote origin the bridge.
- The OAuth architecture is unchanged except the optional, additive §6.4.
