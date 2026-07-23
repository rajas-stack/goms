# Android Build (GORMS)

This directory is a Capacitor Android project wrapping the GORMS web app for
**internal/sideload distribution**. There is no Play Store listing, no
data-safety disclosure, and no staged-rollout config in this repo — none of
that is in scope.

## Everyday development build

No signing setup is required for this. From the repo root:

```
npm run build
npx cap sync android
```

(If you hit an out-of-memory error during `npm run build`, use
`NODE_OPTIONS="--max-old-space-size=4096" npm run build` instead.)

This copies the freshly built web app into `android/app/src/main/assets/public`
and updates the native project. You can then open `android/` in Android
Studio, or run `./gradlew assembleDebug` for an unsigned debug APK you can
install directly on a device (`adb install`).

## Producing a signed release build

Release signing is **not configured out of the box** — `android/app/build.gradle`
reads the signing properties below, and if they're absent the `release`
build type simply falls back to Android's default (unsigned) signing, so
`assembleRelease` still succeeds without them. To produce an APK/AAB that's
actually installable as a release build, follow these steps on a machine
with the Android/Java toolchain (`keytool`, `gradle`/`gradlew`, Android SDK).

### 1. Generate a keystore (one-time, do this yourself — keep it secret)

```
keytool -genkeypair -v \
  -keystore my-release-key.jks \
  -alias my-key-alias \
  -keyalg RSA -keysize 2048 -validity 10000
```

- Replace `my-release-key.jks` and `my-key-alias` with your own values.
- `-validity 10000` is ~27 years; adjust if you want something shorter.
- You'll be prompted for a store password and a key password — pick strong,
  unique values and store them somewhere safe (password manager, secrets
  vault). **Do not commit this file or these passwords to git.**
- Keep the resulting `.jks` file outside the repo, or inside `android/` with
  a name covered by `android/.gitignore` (any `*.jks`/`*.keystore`).

### 2. Provide the signing properties

`android/app/build.gradle` looks for four values: the keystore file path,
the store password, the key alias, and the key password. You can supply
them either of two ways:

**Option A — `android/keystore.properties` (git-ignored, recommended for
local/CI use where the file itself is protected):**

Create `android/keystore.properties` (this file is already covered by
`android/.gitignore` — verify with `git status` that it never shows up as
trackable):

```properties
MYAPP_RELEASE_STORE_FILE=/absolute/or/relative/path/to/my-release-key.jks
MYAPP_RELEASE_STORE_PASSWORD=your-store-password
MYAPP_RELEASE_KEY_ALIAS=my-key-alias
MYAPP_RELEASE_KEY_PASSWORD=your-key-password
```

**Option B — environment variables / Gradle project properties (recommended
for CI secrets managers):**

```bash
export MYAPP_RELEASE_STORE_FILE=/absolute/path/to/my-release-key.jks
export MYAPP_RELEASE_STORE_PASSWORD=your-store-password
export MYAPP_RELEASE_KEY_ALIAS=my-key-alias
export MYAPP_RELEASE_KEY_PASSWORD=your-key-password
```

or pass them as `-P` Gradle project properties on the command line:

```bash
./gradlew assembleRelease \
  -PMYAPP_RELEASE_STORE_FILE=/absolute/path/to/my-release-key.jks \
  -PMYAPP_RELEASE_STORE_PASSWORD=your-store-password \
  -PMYAPP_RELEASE_KEY_ALIAS=my-key-alias \
  -PMYAPP_RELEASE_KEY_PASSWORD=your-key-password
```

If none of these are set, `assembleRelease`/`bundleRelease` still run — the
output just won't be signed with your release key.

**Footgun: partial configuration.** All four properties must be set
*together* — if you set only some of them (e.g. you set the keystore path
and both passwords but forget the key alias), the build does **not** fail
and does **not** get signed either; it silently falls back to the same
unsigned output as the "nothing configured" case. To catch this,
`build.gradle` prints a `logger.warn(...)` diagnostic during Gradle
evaluation (visible in the `./gradlew assembleRelease` output, even without
`--info`/`--debug`) whenever some but not all four properties are set,
naming exactly which ones are missing. If you don't see a signed APK and
suspect this, re-run the build and check the top of the Gradle output for a
line starting with `WARNING: Partial release-signing configuration
detected`.

### 3. Build

From the repo root, rebuild the web assets and sync them into the native
project, then build the release artifact:

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleRelease      # produces an .apk
# or
./gradlew bundleRelease        # produces an .aab (Play Store bundle format)
```

Output locations:

- APK: `android/app/build/outputs/apk/release/app-release.apk`
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`

Since distribution is internal/sideload only, the `.apk` is what you'll
normally want — copy it to the target device and install it directly
(`adb install app-release.apk`), no Play Store submission needed.

## Versioning

`versionCode`/`versionName` in `android/app/build.gradle` are currently `1`
and `"1.0"` — reasonable starting values for a first internal release. Bump
`versionCode` (an integer) on every release you distribute, and
`versionName` (a human-readable string) whenever you want the visible
version to change.
