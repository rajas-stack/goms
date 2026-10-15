# Installed Libraries Inventory

Generated on: 2026-10-15 (Asia/Calcutta)
Project scanned: `E:\goms\goms`

## Scope

This inventory lists the direct libraries declared by the project manifests:

- `package.json`
- `apps/api/package.json`
- `packages/domain/package.json`
- Android Gradle files under `android/`

Versions are the installed versions reported by `npm ls --depth=0`, workspace-aware lockfile entries in `package-lock.json`, and the Gradle version constants in `android/variables.gradle` and `android/build.gradle`.

Every lockfile package is included in [transitive-libraries.md](transitive-libraries.md) and [dependency-inventory.json](dependency-inventory.json). Indirect libraries inherit their functionality and UI locations from the direct libraries shown below. Optional packages for other operating systems are identified separately; lockfile inclusion does not mean they are installed on Windows.

## Frontend And Shared Runtime Libraries

| Library | Installed version | Manifest | Used for | Dependent UI functionality / location |
| --- | --- | --- | --- | --- |
| `react` | `19.3.1` | root dependency | Component model, hooks, rendering application state. | Entire web UI. Entry points include `src/main.tsx`, `src/app/router.tsx`, `src/app/AppLayout.tsx`, and all route components under `src/app/routes/`. |
| `react-dom` | `19.3.1` | root dependency | Browser DOM rendering and portals. | App boot in `src/main.tsx`; portals for overlays/popovers in `src/components/ui/popover/Portal.tsx`; context menu portal in `src/modules/bid-tracker/components/GridContextMenu.tsx`. |
| `react-router-dom` | `7.18.4` | root dependency | Route tree, navigation, nested layouts, redirects, route params. | All app navigation. Main route map in `src/app/router.tsx`; shell routing in `src/app/AppLayout.tsx`; routes include `/map`, `/directory`, `/meetings`, `/sales`, `/teams`, `/commercial-calculator`, `/bid-tracker`, `/settings/*`, `/documents/:module`, and `/document-maker`. |
| `@tanstack/react-query` | `5.104.2` | root dependency | Client-side query cache, mutation state, refetching, async server state. | Remote-data UI across the app: directory, geography/map, DMS, integrations, tender websites, commercial calculator, bid tracker, admin import, and RBAC pages. Representative files: `src/features/directory/PeopleDirectory.tsx`, `src/features/map/IndiaMap.tsx`, `src/modules/admin-data-import/*`, `src/modules/rbac-tree/*`. |
| `@trpc/client` | `11.19.0` | root dependency; API dev dependency | Type-safe frontend calls to the API and test clients. | Remote repository access in `src/data/remote/repository.ts`; auth prompt links in `src/data/remote/authPromptLink.ts`; integrations settings in `src/features/integrations/settings.ts`; admin data import API in `src/modules/admin-data-import/api.ts`. |
| `@goms/domain` | `0.1.0` | root and API dependency | Shared domain types, constants, validation helpers, RBAC/commercial/business rules. | Shared by most UI modules and API routers. UI examples: bid tracker custom fields, commercial calculator rules, document maker file types, RBAC access matrices. Source package: `packages/domain/src/`. |
| `framer-motion` | `14.2.0` | root dependency | UI animation, layout transitions, drawers, dialogs, tabs, menus. | App shell and interaction polish in `src/components/CommandPalette.tsx`, `src/components/GlobalFab.tsx`, `src/components/MobileNavDrawer.tsx`, `src/components/ui/Dialog.tsx`, `src/components/ui/Menu.tsx`, `src/components/ui/Tabs.tsx`, plus route pages such as `src/app/routes/Home.tsx` and `src/app/routes/SalesWorkspace.tsx`. |
| `lucide-react` | `1.57.0` | root dependency | Icon set used by reusable UI and feature screens. | Icon rendering through `src/components/ui/Icon.tsx`; DMS pages in `src/features/dms/*`; settings pages such as `src/app/routes/DmsSettingsPage.tsx`; bid synopsis screens in `src/modules/bid-tracker/synopsis/*`. |
| `clsx` | `2.1.1` | root dependency | Conditional class-name composition. | Shared `cn()` utility in `src/lib/utils.ts`; used by reusable UI controls, layout components, cards, tables, dialogs, and feature pages. |
| `tailwind-merge` | `3.7.0` | root dependency | Resolves conflicting Tailwind utility classes in composed UI class names. | Shared `cn()` utility in `src/lib/utils.ts`; affects styling across components using merged class names. |
| `d3-geo` | `3.1.1` | root dependency | Geographic projection and SVG path generation. | India/state geography UI in `src/features/map/IndiaMap.tsx` and `src/features/geography/GeoMapView.tsx`; user-facing routes `/map`, `/state/:code`, and geography explorer panels. |
| `@tanstack/react-table` | `9.3.1` | root dependency | Column definitions, sorting, row model, table rendering helpers. | Bid Tracker Master Grid at `/bid-tracker/master`; implementation in `src/modules/bid-tracker/components/MasterGrid.tsx`. |
| `@tanstack/react-virtual` | `3.14.19` | root dependency | Virtualized long lists and grids. | Meetings list in `src/app/routes/Meetings.tsx`; people directory in `src/features/directory/PeopleDirectory.tsx`; Bid Tracker Master Grid in `src/modules/bid-tracker/components/MasterGrid.tsx`. |
| `xlsx` | `0.20.3` | root dependency from SheetJS tarball URL | Reading and writing Excel workbooks. | Classic import dialog in `src/features/import/ImportDialog.tsx` via `src/features/import/workbookToCsv.ts`; Admin Data Import workbook upload in `src/modules/admin-data-import/SessionImportWizard.tsx` and `src/modules/admin-data-import/sessionUpload.ts`; Bid Synopsis grid import/export in `src/modules/bid-tracker/synopsis/grid/GridTab.tsx`; generated templates in `src/modules/admin-data-import/templates.ts`. |
| `tesseract.js` | `7.0.0` | root dependency | OCR for visiting-card/contact extraction. | Employee contact capture: `src/features/employees/contact-ocr.ts`, used by `src/features/employees/EmployeeFormDialog.tsx` and `src/features/employees/VisitingCard.tsx` through the "Pick up contact" style OCR action. |
| `firebase` | `13.0.0` | root dependency | Client Firebase authentication and token/session handling. | Login/authentication and Google account binding. Files include `src/lib/auth/firebaseProvider.ts`, `src/lib/firebaseAuth.ts`, `src/lib/useSignedIn.ts`, `src/features/integrations/GoogleAccountBinder.tsx`, and `src/features/tender-websites/TenderCredentialsDialog.tsx`. |
| `@aparajita/capacitor-secure-storage` | `8.0.1` | root dependency | Secure token storage in the Android/native shell. | Native OAuth/session persistence in `src/lib/auth/native.ts`; affects login and Google integration flows when running inside the GOMS Android shell. |
| `@capacitor/core` | `8.5.3` | root dependency | Native-platform detection and Capacitor plugin availability. | Android shell capability checks in `src/lib/nativeShell.ts`; app shell back-button support in `src/app/AppLayout.tsx`; native export handling in `src/lib/file-export.ts`. |
| `@capacitor/app` | `8.1.2` | root dependency | Android hardware back-button and app/deep-link events. | Back-button behavior in `src/app/AppLayout.tsx`; OAuth deep-link and launch URL handling in `src/lib/auth/native.ts`. |
| `@capacitor/browser` | `8.0.5` | root dependency | Opens OAuth flows in the native browser/custom tab. | Native Google sign-in flow in `src/lib/auth/native.ts`; user-facing login/auth prompts and Google integration binding. |
| `@capacitor/filesystem` | `8.1.4` | root dependency | Writes exported files on Android devices. | Export/download behavior in native shell via `src/lib/file-export.ts`; used by app export actions such as `src/features/import/ExportDialog.tsx`. |
| `@capacitor/share` | `8.0.3` | root dependency | Opens the Android share/open-with dialog for exported files. | Native export completion in `src/lib/file-export.ts`; user-facing export/download flows. |
| `@capacitor/android` | `8.5.3` | root dependency | Android platform package for the Capacitor app. | Entire Android WebView shell under `android/`; all web UI routes when packaged as the native app. |
| `@tiptap/react` | `3.32.0` | root dependency | React bindings for the rich-text editor. | Bid Synopsis rich-text editor in `src/modules/bid-tracker/synopsis/SynopsisTab.tsx`, reached from Bid Detail/Synopsis flows. |
| `@tiptap/core` | `3.32.0` | root dependency | Core editor primitives/extensions. | Bid Synopsis editor extension setup in `src/modules/bid-tracker/synopsis/extensions.ts`. |
| `@tiptap/starter-kit` | `3.32.0` | root dependency | Base rich-text editor toolkit. | Bid Synopsis editor formatting in `src/modules/bid-tracker/synopsis/extensions.ts`. |
| `@tiptap/extension-highlight` | `3.32.0` | root dependency | Highlight formatting extension. | Bid Synopsis rich-text formatting in `src/modules/bid-tracker/synopsis/extensions.ts`. |
| `@tiptap/extension-table` | `3.32.0` | root dependency | Table support inside rich-text content. | Bid Synopsis rich-text/table editing in `src/modules/bid-tracker/synopsis/extensions.ts`. |
| `@tiptap/extension-text-align` | `3.32.0` | root dependency | Text alignment extension. | Bid Synopsis rich-text alignment controls through `src/modules/bid-tracker/synopsis/extensions.ts`. |
| `@tiptap/extension-text-style` | `3.32.0` | root dependency | Text style marks used by richer editor formatting. | Bid Synopsis editor setup in `src/modules/bid-tracker/synopsis/extensions.ts`. |
| `@tiptap/pm` | `3.32.0` | root dependency | ProseMirror packages used by TipTap extensions. | Bid Synopsis editor internals in `src/modules/bid-tracker/synopsis/extensions.ts`. |
| `@floating-ui/dom` | `1.8.0` | root dependency | Floating element positioning library. | No direct import was found outside `package.json`; no current UI function appears to depend on it. It is likely reserved or legacy for menus/popovers. |

## Backend And API Runtime Libraries

| Library | Installed version | Manifest | Used for | Dependent UI functionality / location |
| --- | --- | --- | --- | --- |
| `fastify` | `5.12.7` | API dependency | HTTP server framework for the API. | All remote-backed UI screens depend on it indirectly. API app setup is in `apps/api/src/app.ts`; document-maker routes in `apps/api/src/routes/documentMakerRoutes.ts`. |
| `@fastify/cors` | `11.3.1` | API dependency | Cross-origin request handling for browser clients. | Enables browser UI calls from the Vite/frontend origin to the API. Registered in `apps/api/src/app.ts`. |
| `@fastify/rate-limit` | `11.2.1` | API dependency | Request rate limiting and abuse protection. | Protects API-backed UI actions such as sign-in, imports, saves, and data fetches. Registered in `apps/api/src/app.ts`. |
| `@trpc/server` | `11.19.0` | API dependency | Type-safe API router/procedure layer. | All tRPC-backed UI modules: access/RBAC, organization people, departments, admin import, bid tracker, commercial calculator, DMS/document flows. Router/procedure code lives under `apps/api/src/routers/` and `apps/api/src/trpc.ts`. |
| `pg` | `8.23.1` | API dependency; root dev dependency | PostgreSQL client for API persistence and local/seed scripts. | Database-backed UI modules: directory, meetings, sales/teams, bid tracker, commercial calculator, settings/admin import/RBAC. Entry points include `apps/api/src/db.ts` and routers under `apps/api/src/routers/`. |
| `zod` | `4.6.7` | API dependency | Runtime input validation and schema parsing. | Validates API inputs for user-facing workflows including admin import, filters, credentials, opportunity/bid data, and commercial data. Examples: `apps/api/src/import/domains/*`, `apps/api/src/routers/adminImport.ts`, `apps/api/src/lib/filterRuleSchema.ts`. |
| `firebase-admin` | `14.5.0` | API dependency | Server-side Firebase token verification/admin SDK. | Authenticated API access for signed-in UI users. Main file: `apps/api/src/auth/firebaseAdmin.ts`; affects all gated routes in `src/app/router.tsx`. |
| `jose` | `6.2.12` | API dependency | JWT/JWS/JWK handling for OAuth and OnlyOffice token flows. | Google OAuth server flow and document-maker/OnlyOffice security. Files include `apps/api/src/auth/oauth/accessToken.ts`, `apps/api/src/auth/oauth/googleClient.ts`, and `apps/api/src/lib/onlyoffice.ts`; UI areas: Login/Google Integration and `/document-maker`. |
| `@google-cloud/storage` | `8.4.0` | API dependency | Signed upload/download URLs and object metadata for Google Cloud Storage. | Bid Tracker document attachments/source documents in Bid Detail/Commercial & Files. Backend wrapper: `apps/api/src/lib/gcs.ts`; document router: `apps/api/src/routers/documents.ts`; UI files include `src/modules/bid-tracker/pages/CommercialAndFilesTab.tsx`. |
| `node-pg-migrate` | `9.0.0` | API dependency | Database migration runner. | No direct UI component imports it, but every persisted UI module depends on the schema it creates/updates. Migrations live in `apps/api/migrations/`. |

## Development, Build, Test, And Data Tooling

| Library | Installed version | Manifest | Used for | Dependent functionality / location |
| --- | --- | --- | --- | --- |
| `Node.js` | portable/CI/runtime `26.12.0`; system installation `25.2.1` | `.node-version`, root `engines` | Executes the API, dependency management, builds and tests. | Backend for all API-backed screens; development/build pipeline. Earlier local suites used portable 26.11.1; final CI/runtime use 26.12.0. System Node was not replaced. |
| `typescript` | `7.0.2` | root and API dev dependency | Type checking and TypeScript compilation. | Build correctness for frontend, API, and shared domain workspaces. Configs: `tsconfig.json`, `apps/api/tsconfig.json`, `packages/domain/tsconfig.json`. |
| `vite` | `8.3.4` | root dev dependency | Frontend dev server and production bundler. | Builds the complete web UI. Config: `vite.config.ts`; integration/component configs: `vitest.integration.config.ts`, `vitest.component.config.ts`. |
| `@vitejs/plugin-react` | `6.1.2` | root dev dependency | React transform and Fast Refresh integration for Vite/Vitest. | UI development/build pipeline in `vite.config.ts` and `vitest.component.config.ts`. |
| `vite-plugin-compression2` | `2.5.3` | root dev dependency | Pre-compressed production assets. | Web deployment asset compression in `vite.config.ts`; Android build excludes `.gz`/`.br` duplicates through `android/app/build.gradle`. |
| `tsx` | `4.23.15` | root and API dev dependency | Runs TypeScript scripts and API dev server without prebuild. | Scripts such as `scripts/seed-import.ts`; API dev command `tsx watch src/server.ts`; admin fixture builders. |
| `vitest` | `5.0.4` | root and API dev dependency | Unit, integration, and component test runner. | Tests across `src/**/*.test.tsx`, `apps/api/src/**/*.test.ts`, and package tests. Configs: `vitest.component.config.ts`, `vitest.integration.config.ts`, `apps/api/vitest.config.ts`. |
| `jsdom` | `30.1.2` | root dev dependency | Browser-like DOM environment for tests. | React component tests and DOM interaction tests configured through Vitest setup. |
| `@testing-library/react` | `16.3.3` | root dev dependency | React component rendering/testing utilities. | Component tests for routes and controls, including `src/app/routes/*.test.tsx`, `src/components/**/*.test.tsx`, and feature/module tests. |
| `@testing-library/user-event` | `14.6.8` | root dev dependency | Simulated user interactions in tests. | Button, form, keyboard, dialog, and grid interaction tests throughout `src/**/*.test.tsx`. |
| `@testing-library/jest-dom` | `7.0.1` | root dev dependency | DOM-specific matchers for tests. | Test setup in `src/test/setup-component-tests.ts`. |
| `@playwright/test` | `1.64.1` | root dev dependency | Browser end-to-end and visual/runtime verification. | E2E tests in `e2e/26-task-enhancements.spec.ts`; verification scripts under `.dms-build-check/`; config `playwright.config.ts`. |
| `tailwindcss` | `4.3.3` | root dev dependency | Utility CSS framework. | Styling for the complete UI. Config: `tailwind.config.ts`; global CSS: `src/index.css`. |
| `postcss` | `8.5.30` | root dev dependency | CSS transform pipeline used by Tailwind and Autoprefixer. | Frontend styling build pipeline. |
| `@tailwindcss/postcss` | `4.3.3` | root dev dependency | Tailwind 4 PostCSS integration. | Compiles styling for every UI route through `postcss.config.js` and `src/index.css`. |
| `autoprefixer` | `10.6.1` | root dev dependency | Adds vendor prefixes in generated CSS. | Frontend CSS compatibility pipeline. |
| `@capacitor/cli` | `8.5.3` | root dev dependency | Capacitor sync/build tooling. | Maintains Android native project from the web build. Config: `capacitor.config.ts`; generated Gradle integration under `android/`. |
| `@types/react` | `19.3.0` | root dev dependency | TypeScript types for React. | Compile-time typing for all React UI files. |
| `@types/react-dom` | `19.3.0` | root dev dependency | TypeScript types for React DOM APIs. | Compile-time typing for `src/main.tsx`, portals, and DOM rendering helpers. |
| `@types/node` | `26.6.5` | API dev dependency | TypeScript types for Node.js APIs. | API build/test typing and backend scripts. |
| `@types/pg` | `8.23.1` | root and API dev dependency | TypeScript types for PostgreSQL client. | API database code and seed/import scripts. |
| `@types/d3-geo` | `3.1.1` | root dev dependency | TypeScript types for `d3-geo`. | Compile-time typing for map/geography UI files. |
| `@types/geojson` | `7946.0.16` | root dev dependency | TypeScript types for GeoJSON structures. | Map/geography assets and data transformation scripts. |
| `7zip-min` | `3.0.1` | root dev dependency | Extracts `.7z` archives during geography asset builds. | Geography data build script `scripts/build-geo-from-lgd.cjs`; indirectly feeds map/geography UI assets. |
| `@turf/simplify` | `7.4.0` | root dev dependency | Simplifies GeoJSON geometry. | Geo asset simplification in `scripts/geo-simplify-lib.cjs`; indirectly supports `/map` and geography explorer performance. |
| `polygon-clipping` | `0.15.7` | root dev dependency | Polygon union/clipping operations. | Geography repair/union scripts: `scripts/repair-fragmented-talukas.cjs`, `scripts/robust-union.cjs`; indirectly supports map/geography assets. |
| `proj4` | `2.22.0` | root dev dependency | Coordinate reprojection for GIS inputs. | Geography data generation in `scripts/build-geo-from-lgd.cjs` and `scripts/generate-village-data.cjs`; indirectly supports map/geography UI. |
| `shapefile` | `0.6.6` | root dev dependency | Reads shapefile datasets. | Geography data generation scripts: `scripts/build-geo-from-lgd.cjs`, `scripts/generate-village-data.cjs`, `scripts/patch-stub-hierarchies.cjs`; indirectly supports map/geography UI. |

## Android Native And Gradle Libraries

| Library | Version | Source | Used for | Dependent UI/functionality |
| --- | --- | --- | --- | --- |
| `com.android.tools.build:gradle` | `9.4.1` | `android/build.gradle` | Android build plugin. | Builds the native Android shell that hosts the web UI. |
| `Gradle` | `9.8.1` | `android/gradle/wrapper/gradle-wrapper.properties` | Android build orchestration. | Produces APK/AAB artifacts for the complete Android UI. |
| `com.google.gms:google-services` | `4.5.0` | `android/build.gradle` | Google services Gradle plugin when `google-services.json` exists. | Native/Firebase integration support for Android builds. |
| `androidx.appcompat:appcompat` | `1.8.0` | `android/variables.gradle`, `android/app/build.gradle` | Android compatibility support library. | Native Android wrapper for the app. |
| `androidx.activity:activity` | `1.13.0` | `android/variables.gradle`, Capacitor Android | Activity lifecycle and result handling. | Native application lifecycle and plugin calls. |
| `androidx.core:core` | `1.19.1` | `android/variables.gradle`, Capacitor Android | Android compatibility APIs. | Native permissions and platform utilities behind plugin actions. |
| `androidx.fragment:fragment` | `1.9.1` | `android/variables.gradle`, Capacitor Android | Fragment lifecycle support. | Android shell and native plugin integration. |
| `androidx.webkit:webkit` | `1.17.1` | `android/variables.gradle`, Capacitor Android | WebView compatibility APIs. | Entire Android-hosted web UI. |
| `androidx.browser:browser` | `1.10.0` | `android/variables.gradle`, Capacitor Browser | Android Custom Tabs. | Google sign-in browser flow in `src/lib/auth/native.ts`. |
| `org.jetbrains.kotlin:kotlin-gradle-plugin` | `2.4.21` | `android/build.gradle`, `android/variables.gradle` | Compiles Kotlin in native plugin modules. | Native filesystem/export bridge used by `src/lib/file-export.ts`. |
| `org.jetbrains.kotlinx:kotlinx-coroutines-core` | `1.11.0` | `android/variables.gradle`, Capacitor Filesystem | Asynchronous Kotlin file operations. | Native file export/download flows in `src/lib/file-export.ts`. |
| `io.ionic.libs:ionfilesystem-android` | `1.1.1` | Capacitor Filesystem Gradle dependency | Native filesystem implementation. | Android exports/downloads through `src/lib/file-export.ts`. |
| `org.json:json` | `20260814` | Android library test constraint in `android/build.gradle` | JSON parsing in Capacitor native tests. | Native test tooling; no direct UI control. |
| `org.mockito:mockito-core` | `5.24.0` | Android library test constraint in `android/build.gradle` | Native Java mocks. | Native test tooling; no runtime UI control. |
| `androidx.coordinatorlayout:coordinatorlayout` | `1.3.0` | `android/variables.gradle`, `android/app/build.gradle` | Android layout behavior support. | Native Android shell layout. |
| `androidx.core:core-splashscreen` | `1.2.0` | `android/variables.gradle`, `android/app/build.gradle` | Android splash screen support. | App launch experience before the web UI loads. |
| `junit:junit` | `4.13.2` | `android/variables.gradle`, `android/app/build.gradle` | Android unit tests. | Native test tooling only; no runtime UI dependency. |
| `androidx.test.ext:junit` | `1.3.0` | `android/variables.gradle`, `android/app/build.gradle` | Android instrumentation test JUnit extension. | Native Android tests only. |
| `androidx.test.espresso:espresso-core` | `3.7.0` | `android/variables.gradle`, `android/app/build.gradle` | Android UI instrumentation test framework. | Native Android tests only. |
| `project(':capacitor-android')` | npm package `@capacitor/android` `8.5.3` | `android/capacitor.settings.gradle` | Capacitor Android bridge. | All native-shell web UI behavior. |
| `project(':capacitor-app')` | npm package `@capacitor/app` `8.1.2` | `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle` | App lifecycle/back-button plugin. | Android back button and app link handling in `src/app/AppLayout.tsx` and `src/lib/auth/native.ts`. |
| `project(':capacitor-filesystem')` | npm package `@capacitor/filesystem` `8.1.4` | `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle` | Native file write plugin. | Android export/download flow in `src/lib/file-export.ts`. |
| `project(':capacitor-share')` | npm package `@capacitor/share` `8.0.3` | `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle` | Native share/open-with plugin. | Android export/download flow in `src/lib/file-export.ts`. |
| `project(':capacitor-browser')` | npm package `@capacitor/browser` `8.0.5` | Generated Capacitor Gradle integration | Opens native browser/custom tabs. | Native Google sign-in in `src/lib/auth/native.ts`. |
| `project(':aparajita-capacitor-secure-storage')` | npm package `@aparajita/capacitor-secure-storage` `8.0.1` | Generated Capacitor Gradle integration | Encrypted native token storage. | Native login/session persistence in `src/lib/auth/native.ts`. |
| `cordovaAndroidVersion` | `15.1.0` | `android/variables.gradle` | Cordova Android compatibility for generated Capacitor plugins. | Native plugin compatibility layer. |
| `implementation fileTree(dir: 'libs', include: ['*.jar'])` | local JARs, version not fixed in manifest | `android/app/build.gradle` | Includes any manually dropped Android JARs from `android/app/libs`. | No specific UI dependency found from the manifest alone. |

## Notes

- `@floating-ui/dom` is declared but no direct source import was found during the scan. If it is not planned for upcoming menu/popover work, it may be removable after a focused dependency cleanup.
- Native plugin registration is refreshed using Capacitor's Android update command. Android compilation needs a JDK and Android SDK, which are absent in this environment.
- AndroidX Core 1.19.1's published AAR metadata requires compile SDK 37 and AGP >=9.1.0. The project now uses compile SDK 37, AGP 9.4.1 and Gradle 9.8.1; target SDK remains 36. Capacitor's generated Java source/target compatibility is 21.
- `@goms/domain` is an internal workspace library rather than an external npm package, but it is installed as a workspace dependency and is central to both UI and API behavior.
- Android versions were checked against the official [Google Maven repository](https://dl.google.com/dl/android/maven2/master-index.xml), [Maven Central](https://repo.maven.apache.org/maven2/), and [Gradle releases](https://services.gradle.org/versions/current). The AGP 9 compatibility flag retains Capacitor 8's legacy DSL; the app uses the supported optimized ProGuard default. See the [AGP migration notes](https://developer.android.com/build/releases/agp-9-0-0-release-notes).
- Kotlin uses the standalone latest plugin with AGP built-in Kotlin disabled, following the [AGP Kotlin migration guidance](https://developer.android.com/build/migrate-to-built-in-kotlin). Android table versions are declared requirements, including vendor-plugin dependencies; a complete resolved native transitive graph needs the Android build toolchain and remains unverified here.
