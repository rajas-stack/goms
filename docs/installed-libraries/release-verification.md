# Release Verification

Date: 2026-10-15 (Asia/Calcutta). Earlier local suites used portable Node
26.11.1; final browser verification, CI and runtime use Node 26.12.0.
The system Node installation was not replaced.

## Completed

- Logic/domain: 120 files, 1,221 tests passed.
- API: the broad run passed 1,520 tests with two fixture timing failures.
  A 60-second SQL fixture hook timeout prevents unfinished setup from racing
  subsequent cleanup; all five tests in that affected file passed on recheck.
  Three focused API regression files also passed all 78 tests.
- Components: 118 files passed in the broad run. Its other 26 files were
  affected by Windows worker startup/time limits or stale expectations.
  All 26 files and 194 tests passed on the final two-worker recheck.
- HTTP repository integration: all 11 tests passed against disposable PostgreSQL.
- Complete Chromium browser suite: all 110 tests passed in one clean run,
  including the additional 81 route/navigation/mobile/theme/settings tests.
- Script tests: the original 5 files passed, plus all 8 sync-lock regressions
  in the new sixth test file. Incomplete lock metadata is not treated as stale;
  stale-owner recovery is serialized so competing publishers cannot both acquire it.
- Tracked-source credential pattern scan and Firebase CSP checks passed.
- All 68 external direct dependencies match their latest stable/vendor releases;
  the internal workspace retains its own version. All 69 direct libraries have
  purpose and UI-location mappings. The inventory covers 711 resolved entries.
- npm audit: zero known vulnerabilities. Runtime Trivy scan: zero HIGH/CRITICAL
  vulnerabilities and zero detected secrets in the validated Node 26.12.0 image.
- Domain, API and production frontend builds passed in the local snapshot pipeline.

## Final CI Gate

The clean full application suites and native Android checks run in the
[Complete tests workflow](https://github.com/rajas-stack/goms/actions/workflows/tests.yml).
The [release pull request](https://github.com/rajas-stack/goms/pull/12) records the
exact tested commit, all check conclusions, and the eventual merge state.
Successful local retries are not represented as a clean single full-suite run.

## Environment Limits

Browser tests use an isolated local-data build with the real public assets and
Admin Import/Bid Tracker enabled. They do not modify live production records or
bypass deployed authentication. Signed-out access gates remain asserted.

Android asset/plugin sync passed. Native Gradle compilation and instrumentation
require Java 21 and Android SDK 37.0; neither is configured on this workstation.
The CI Android job builds the debug APK, runs native unit tests, and runs the
instrumentation test on an API 36 emulator. Native success must be verified in
that workflow; asset sync alone is not a native build result.

Saved source from the shared worktree is published through an isolated Git index
using the verified noreply commit identity. Local HEAD/index and application
email values are preserved. The repository branches are Shubham_Side and main,
not shubham_branch and master.
