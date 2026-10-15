# Complete Lockfile Inventory

Includes runtime, development, nested and optional platform packages. Each row gives the exact resolved version and the direct libraries that consume it. UI locations and purposes are defined in [installed-libraries.md](installed-libraries.md); this avoids claiming that infrastructure packages have independent UI controls.

| Library | Version | Lockfile path | Direct consumers / dependent UI | Scope |
| --- | --- | --- | --- | --- |
| @adobe/css-tools | 4.5.0 | node_modules/@adobe/css-tools | @testing-library/jest-dom | Development |
| @alloc/quick-lru | 5.3.0 | node_modules/@alloc/quick-lru | @tailwindcss/postcss | Development |
| @aparajita/capacitor-secure-storage | 8.0.1 | node_modules/@aparajita/capacitor-secure-storage | @aparajita/capacitor-secure-storage | Runtime/shared |
| @asamuzakjp/css-color | 7.1.5 | node_modules/@asamuzakjp/css-color | @testing-library/jest-dom, jsdom, vitest | Development |
| @asamuzakjp/dom-selector | 9.2.4 | node_modules/@asamuzakjp/dom-selector | @testing-library/jest-dom, jsdom, vitest | Development |
| @babel/code-frame | 7.29.7 | node_modules/@babel/code-frame | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| @babel/helper-validator-identifier | 7.29.7 | node_modules/@babel/helper-validator-identifier | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| @babel/runtime | 7.29.10 | node_modules/@babel/runtime | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| @bramus/specificity | 2.4.3 | node_modules/@bramus/specificity | @testing-library/jest-dom, jsdom, vitest | Development |
| @capacitor/android | 8.5.3 | node_modules/@capacitor/android | @aparajita/capacitor-secure-storage, @capacitor/android | Runtime/shared |
| @capacitor/app | 8.1.2 | node_modules/@capacitor/app | @aparajita/capacitor-secure-storage, @capacitor/app | Runtime/shared |
| @capacitor/browser | 8.0.5 | node_modules/@capacitor/browser | @capacitor/browser | Runtime/shared |
| @capacitor/cli | 8.5.3 | node_modules/@capacitor/cli | @capacitor/cli | Development |
| @capacitor/core | 8.5.3 | node_modules/@capacitor/core | @aparajita/capacitor-secure-storage, @capacitor/android, @capacitor/app, @capacitor/browser, @capacitor/core, @capacitor/filesystem, @capacitor/share | Runtime/shared |
| @capacitor/filesystem | 8.1.4 | node_modules/@capacitor/filesystem | @capacitor/filesystem | Runtime/shared |
| @capacitor/ios | 8.5.3 | node_modules/@capacitor/ios | @aparajita/capacitor-secure-storage | Runtime/shared |
| @capacitor/keyboard | 8.0.6 | node_modules/@capacitor/keyboard | @aparajita/capacitor-secure-storage | Runtime/shared |
| @capacitor/share | 8.0.3 | node_modules/@capacitor/share | @capacitor/share | Runtime/shared |
| @capacitor/synapse | 1.0.4 | node_modules/@capacitor/synapse | @capacitor/filesystem | Runtime/shared |
| @csstools/color-helpers | 6.1.2 | node_modules/@csstools/color-helpers | @testing-library/jest-dom, jsdom, vitest | Development |
| @csstools/css-calc | 3.4.3 | node_modules/@csstools/css-calc | @testing-library/jest-dom, jsdom, vitest | Development |
| @csstools/css-color-parser | 4.2.6 | node_modules/@csstools/css-color-parser | @testing-library/jest-dom, jsdom, vitest | Development |
| @csstools/css-parser-algorithms | 4.0.2 | node_modules/@csstools/css-parser-algorithms | @testing-library/jest-dom, jsdom, vitest | Development |
| @csstools/css-syntax-patches-for-csstree | 1.1.15 | node_modules/@csstools/css-syntax-patches-for-csstree | @testing-library/jest-dom, jsdom, vitest | Development |
| @csstools/css-tokenizer | 4.0.2 | node_modules/@csstools/css-tokenizer | @testing-library/jest-dom, jsdom, vitest | Development |
| @esbuild/aix-ppc64 | 0.28.2 | node_modules/@esbuild/aix-ppc64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/android-arm | 0.28.2 | node_modules/@esbuild/android-arm | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/android-arm64 | 0.28.2 | node_modules/@esbuild/android-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/android-x64 | 0.28.2 | node_modules/@esbuild/android-x64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/darwin-arm64 | 0.28.2 | node_modules/@esbuild/darwin-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/darwin-x64 | 0.28.2 | node_modules/@esbuild/darwin-x64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/freebsd-arm64 | 0.28.2 | node_modules/@esbuild/freebsd-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/freebsd-x64 | 0.28.2 | node_modules/@esbuild/freebsd-x64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-arm | 0.28.2 | node_modules/@esbuild/linux-arm | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-arm64 | 0.28.2 | node_modules/@esbuild/linux-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-ia32 | 0.28.2 | node_modules/@esbuild/linux-ia32 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-loong64 | 0.28.2 | node_modules/@esbuild/linux-loong64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-mips64el | 0.28.2 | node_modules/@esbuild/linux-mips64el | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-ppc64 | 0.28.2 | node_modules/@esbuild/linux-ppc64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-riscv64 | 0.28.2 | node_modules/@esbuild/linux-riscv64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-s390x | 0.28.2 | node_modules/@esbuild/linux-s390x | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/linux-x64 | 0.28.2 | node_modules/@esbuild/linux-x64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/netbsd-arm64 | 0.28.2 | node_modules/@esbuild/netbsd-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/netbsd-x64 | 0.28.2 | node_modules/@esbuild/netbsd-x64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/openbsd-arm64 | 0.28.2 | node_modules/@esbuild/openbsd-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/openbsd-x64 | 0.28.2 | node_modules/@esbuild/openbsd-x64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/openharmony-arm64 | 0.28.2 | node_modules/@esbuild/openharmony-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/sunos-x64 | 0.28.2 | node_modules/@esbuild/sunos-x64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/win32-arm64 | 0.28.2 | node_modules/@esbuild/win32-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/win32-ia32 | 0.28.2 | node_modules/@esbuild/win32-ia32 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @esbuild/win32-x64 | 0.28.2 | node_modules/@esbuild/win32-x64 | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| @exodus/bytes | 1.16.0 | node_modules/@exodus/bytes | @testing-library/jest-dom, jsdom, vitest | Development |
| @fastify/ajv-compiler | 4.0.7 | node_modules/@fastify/ajv-compiler | fastify | Runtime/shared |
| @fastify/busboy | 3.2.3 | node_modules/@fastify/busboy | firebase-admin | Runtime/shared |
| @fastify/cors | 11.3.1 | node_modules/@fastify/cors | @fastify/cors | Runtime/shared |
| @fastify/deepmerge | 3.2.2 | node_modules/@fastify/deepmerge | fastify | Runtime/shared |
| @fastify/error | 4.2.1 | node_modules/@fastify/error | fastify | Runtime/shared |
| @fastify/fast-json-stringify-compiler | 5.1.1 | node_modules/@fastify/fast-json-stringify-compiler | fastify | Runtime/shared |
| @fastify/forwarded | 3.1.1 | node_modules/@fastify/forwarded | fastify | Runtime/shared |
| @fastify/merge-json-schemas | 0.2.2 | node_modules/@fastify/merge-json-schemas | fastify | Runtime/shared |
| @fastify/proxy-addr | 5.1.2 | node_modules/@fastify/proxy-addr | fastify | Runtime/shared |
| @fastify/rate-limit | 11.2.1 | node_modules/@fastify/rate-limit | @fastify/rate-limit | Runtime/shared |
| @firebase/ai | 3.0.0 | node_modules/@firebase/ai | firebase | Runtime/shared |
| @firebase/analytics | 0.10.25 | node_modules/@firebase/analytics | firebase | Runtime/shared |
| @firebase/analytics-compat | 0.2.31 | node_modules/@firebase/analytics-compat | firebase | Runtime/shared |
| @firebase/analytics-types | 0.8.5 | node_modules/@firebase/analytics-types | firebase | Runtime/shared |
| @firebase/app | 0.16.3 | node_modules/@firebase/app | firebase, firebase-admin | Runtime/shared |
| @firebase/app-check | 0.13.1 | node_modules/@firebase/app-check | firebase | Runtime/shared |
| @firebase/app-check-compat | 0.4.7 | node_modules/@firebase/app-check-compat | firebase | Runtime/shared |
| @firebase/app-check-interop-types | 0.3.5 | node_modules/@firebase/app-check-interop-types | firebase, firebase-admin | Runtime/shared |
| @firebase/app-check-types | 0.5.5 | node_modules/@firebase/app-check-types | firebase | Runtime/shared |
| @firebase/app-compat | 0.5.19 | node_modules/@firebase/app-compat | firebase, firebase-admin | Runtime/shared |
| @firebase/app-types | 0.9.6 | node_modules/@firebase/app-types | firebase, firebase-admin | Runtime/shared |
| @firebase/auth | 1.13.7 | node_modules/@firebase/auth | firebase | Runtime/shared |
| @firebase/auth-compat | 0.6.12 | node_modules/@firebase/auth-compat | firebase | Runtime/shared |
| @firebase/auth-interop-types | 0.2.6 | node_modules/@firebase/auth-interop-types | firebase, firebase-admin | Runtime/shared |
| @firebase/auth-types | 0.13.2 | node_modules/@firebase/auth-types | firebase | Runtime/shared |
| @firebase/component | 0.7.5 | node_modules/@firebase/component | firebase, firebase-admin | Runtime/shared |
| @firebase/data-connect | 0.7.4 | node_modules/@firebase/data-connect | firebase | Runtime/shared |
| @firebase/database | 1.1.5 | node_modules/@firebase/database | firebase, firebase-admin | Runtime/shared |
| @firebase/database-compat | 2.1.7 | node_modules/@firebase/database-compat | firebase, firebase-admin | Runtime/shared |
| @firebase/database-types | 1.0.22 | node_modules/@firebase/database-types | firebase, firebase-admin | Runtime/shared |
| @firebase/firestore | 4.18.0 | node_modules/@firebase/firestore | firebase | Runtime/shared |
| @firebase/firestore-compat | 0.4.15 | node_modules/@firebase/firestore-compat | firebase | Runtime/shared |
| @firebase/firestore-types | 3.0.5 | node_modules/@firebase/firestore-types | firebase | Runtime/shared |
| @firebase/functions | 0.14.0 | node_modules/@firebase/functions | firebase | Runtime/shared |
| @firebase/functions-compat | 0.5.0 | node_modules/@firebase/functions-compat | firebase | Runtime/shared |
| @firebase/functions-types | 0.6.5 | node_modules/@firebase/functions-types | firebase | Runtime/shared |
| @firebase/installations | 0.6.24 | node_modules/@firebase/installations | firebase | Runtime/shared |
| @firebase/installations-compat | 0.2.24 | node_modules/@firebase/installations-compat | firebase | Runtime/shared |
| @firebase/installations-types | 0.5.5 | node_modules/@firebase/installations-types | firebase | Runtime/shared |
| @firebase/logger | 0.5.2 | node_modules/@firebase/logger | firebase, firebase-admin | Runtime/shared |
| @firebase/messaging | 0.13.3 | node_modules/@firebase/messaging | firebase | Runtime/shared |
| @firebase/messaging-compat | 0.2.30 | node_modules/@firebase/messaging-compat | firebase | Runtime/shared |
| @firebase/messaging-interop-types | 0.2.6 | node_modules/@firebase/messaging-interop-types | firebase | Runtime/shared |
| @firebase/performance | 0.7.14 | node_modules/@firebase/performance | firebase | Runtime/shared |
| @firebase/performance-compat | 0.2.27 | node_modules/@firebase/performance-compat | firebase | Runtime/shared |
| @firebase/performance-types | 0.2.5 | node_modules/@firebase/performance-types | firebase | Runtime/shared |
| @firebase/remote-config | 0.9.3 | node_modules/@firebase/remote-config | firebase | Runtime/shared |
| @firebase/remote-config-compat | 0.2.30 | node_modules/@firebase/remote-config-compat | firebase | Runtime/shared |
| @firebase/remote-config-types | 0.5.2 | node_modules/@firebase/remote-config-types | firebase | Runtime/shared |
| @firebase/storage | 0.14.6 | node_modules/@firebase/storage | firebase | Runtime/shared |
| @firebase/storage-compat | 0.4.6 | node_modules/@firebase/storage-compat | firebase | Runtime/shared |
| @firebase/storage-types | 0.8.5 | node_modules/@firebase/storage-types | firebase | Runtime/shared |
| @firebase/util | 1.15.3 | node_modules/@firebase/util | firebase, firebase-admin | Runtime/shared |
| @firebase/webchannel-wrapper | 1.0.7 | node_modules/@firebase/webchannel-wrapper | firebase | Runtime/shared |
| @floating-ui/core | 1.8.0 | node_modules/@floating-ui/core | @floating-ui/dom, @tiptap/react | Runtime/shared |
| @floating-ui/dom | 1.8.0 | node_modules/@floating-ui/dom | @floating-ui/dom, @tiptap/react | Runtime/shared |
| @floating-ui/utils | 0.2.12 | node_modules/@floating-ui/utils | @floating-ui/dom, @tiptap/react | Runtime/shared |
| @goms/api | 0.1.0 | apps/api | Workspace/build infrastructure; no resolved direct consumer | Runtime/shared |
| @goms/domain | 0.1.0 | packages/domain | @goms/domain | Runtime/shared |
| @google-cloud/firestore | 9.3.1 | node_modules/@google-cloud/firestore | firebase-admin | Optional platform |
| @google-cloud/firestore-api | 0.2.0 | node_modules/@google-cloud/firestore-api | firebase-admin | Optional platform |
| @google-cloud/paginator | 7.2.0 | node_modules/@google-cloud/paginator | @google-cloud/storage, firebase-admin | Runtime/shared |
| @google-cloud/projectify | 6.2.0 | node_modules/@google-cloud/projectify | @google-cloud/storage, firebase-admin | Runtime/shared |
| @google-cloud/promisify | 6.2.0 | node_modules/@google-cloud/promisify | @google-cloud/storage, firebase-admin | Runtime/shared |
| @google-cloud/storage | 8.4.0 | node_modules/@google-cloud/storage | @google-cloud/storage, firebase-admin | Runtime/shared |
| @grpc/grpc-js | 1.14.6 | node_modules/@grpc/grpc-js | firebase, firebase-admin | Runtime/shared |
| @grpc/proto-loader | 0.8.1 | node_modules/@google-cloud/firestore-api/node_modules/@grpc/proto-loader | firebase-admin | Optional platform |
| @grpc/proto-loader | 0.8.1 | node_modules/@grpc/grpc-js/node_modules/@grpc/proto-loader | firebase, firebase-admin | Runtime/shared |
| @grpc/proto-loader | 0.7.15 | node_modules/@grpc/proto-loader | firebase | Runtime/shared |
| @grpc/proto-loader | 0.8.1 | node_modules/google-gax/node_modules/@grpc/proto-loader | firebase-admin | Optional platform |
| @ionic/cli-framework-output | 2.2.8 | node_modules/@ionic/cli-framework-output | @capacitor/cli | Development |
| @ionic/utils-array | 2.1.6 | node_modules/@ionic/utils-array | @capacitor/cli | Development |
| @ionic/utils-fs | 3.1.7 | node_modules/@ionic/utils-fs | @capacitor/cli | Development |
| @ionic/utils-object | 2.1.6 | node_modules/@ionic/utils-object | @capacitor/cli | Development |
| @ionic/utils-process | 2.1.12 | node_modules/@ionic/utils-process | @capacitor/cli | Development |
| @ionic/utils-stream | 3.1.7 | node_modules/@ionic/utils-stream | @capacitor/cli | Development |
| @ionic/utils-subprocess | 3.0.1 | node_modules/@ionic/utils-subprocess | @capacitor/cli | Development |
| @ionic/utils-terminal | 2.3.5 | node_modules/@ionic/utils-terminal | @capacitor/cli | Development |
| @isaacs/cliui | 8.0.2 | node_modules/@isaacs/cliui | firebase-admin | Optional platform |
| @isaacs/fs-minipass | 4.0.1 | node_modules/@isaacs/fs-minipass | @capacitor/cli | Development |
| @jridgewell/gen-mapping | 0.3.13 | node_modules/@jridgewell/gen-mapping | @tailwindcss/postcss | Development |
| @jridgewell/remapping | 2.3.5 | node_modules/@jridgewell/remapping | @tailwindcss/postcss | Development |
| @jridgewell/resolve-uri | 3.1.2 | node_modules/@jridgewell/resolve-uri | @tailwindcss/postcss, @testing-library/jest-dom, vitest | Development |
| @jridgewell/sourcemap-codec | 1.6.0 | node_modules/@jridgewell/sourcemap-codec | @tailwindcss/postcss, @testing-library/jest-dom, vitest | Development |
| @jridgewell/trace-mapping | 0.3.31 | node_modules/@jridgewell/trace-mapping | @tailwindcss/postcss, @testing-library/jest-dom, vitest | Development |
| @js-sdsl/ordered-map | 4.4.2 | node_modules/@js-sdsl/ordered-map | firebase, firebase-admin | Runtime/shared |
| @lukeed/ms | 2.0.2 | node_modules/@lukeed/ms | @fastify/rate-limit | Runtime/shared |
| @nodable/entities | 3.1.0 | node_modules/@nodable/entities | @google-cloud/storage, firebase-admin | Runtime/shared |
| @opentelemetry/api | 1.9.1 | node_modules/@opentelemetry/api | @testing-library/jest-dom, firebase-admin, vitest | Optional platform |
| @oxc-project/types | 0.154.0 | node_modules/@oxc-project/types | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Development |
| @pinojs/redact | 0.4.0 | node_modules/@pinojs/redact | fastify | Runtime/shared |
| @pkgjs/parseargs | 0.11.0 | node_modules/@pkgjs/parseargs | firebase-admin | Optional platform |
| @playwright/test | 1.64.1 | node_modules/@playwright/test | @playwright/test | Development |
| @protobufjs/aspromise | 1.1.2 | node_modules/@protobufjs/aspromise | firebase, firebase-admin | Runtime/shared |
| @protobufjs/base64 | 1.1.2 | node_modules/@protobufjs/base64 | firebase, firebase-admin | Runtime/shared |
| @protobufjs/codegen | 2.0.5 | node_modules/@protobufjs/codegen | firebase, firebase-admin | Runtime/shared |
| @protobufjs/eventemitter | 1.1.1 | node_modules/@protobufjs/eventemitter | firebase, firebase-admin | Runtime/shared |
| @protobufjs/fetch | 1.1.1 | node_modules/@protobufjs/fetch | firebase, firebase-admin | Runtime/shared |
| @protobufjs/float | 1.0.2 | node_modules/@protobufjs/float | firebase, firebase-admin | Runtime/shared |
| @protobufjs/path | 1.1.2 | node_modules/@protobufjs/path | firebase, firebase-admin | Runtime/shared |
| @protobufjs/pool | 1.1.0 | node_modules/@protobufjs/pool | firebase, firebase-admin | Runtime/shared |
| @protobufjs/utf8 | 1.1.2 | node_modules/@protobufjs/utf8 | firebase, firebase-admin | Runtime/shared |
| @rolldown/binding-android-arm-eabi | 1.2.14 | node_modules/@rolldown/binding-android-arm-eabi | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-android-arm64 | 1.2.14 | node_modules/@rolldown/binding-android-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-darwin-arm64 | 1.2.14 | node_modules/@rolldown/binding-darwin-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-darwin-x64 | 1.2.14 | node_modules/@rolldown/binding-darwin-x64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-freebsd-x64 | 1.2.14 | node_modules/@rolldown/binding-freebsd-x64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.14 | node_modules/@rolldown/binding-linux-arm-gnueabihf | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-linux-arm64-gnu | 1.2.14 | node_modules/@rolldown/binding-linux-arm64-gnu | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-linux-arm64-musl | 1.2.14 | node_modules/@rolldown/binding-linux-arm64-musl | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-linux-ppc64-gnu | 1.2.14 | node_modules/@rolldown/binding-linux-ppc64-gnu | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-linux-s390x-gnu | 1.2.14 | node_modules/@rolldown/binding-linux-s390x-gnu | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-linux-x64-gnu | 1.2.14 | node_modules/@rolldown/binding-linux-x64-gnu | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-linux-x64-musl | 1.2.14 | node_modules/@rolldown/binding-linux-x64-musl | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-openharmony-arm64 | 1.2.14 | node_modules/@rolldown/binding-openharmony-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-win32-arm64-msvc | 1.2.14 | node_modules/@rolldown/binding-win32-arm64-msvc | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/binding-win32-x64-msvc | 1.2.14 | node_modules/@rolldown/binding-win32-x64-msvc | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| @rolldown/pluginutils | 1.0.1 | node_modules/@rolldown/pluginutils | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Development |
| @rollup/pluginutils | 5.4.0 | node_modules/@rollup/pluginutils | vite-plugin-compression2 | Development |
| @tailwindcss/node | 4.3.3 | node_modules/@tailwindcss/node | @tailwindcss/postcss | Development |
| @tailwindcss/oxide | 4.3.3 | node_modules/@tailwindcss/oxide | @tailwindcss/postcss | Development |
| @tailwindcss/oxide-android-arm64 | 4.3.3 | node_modules/@tailwindcss/oxide-android-arm64 | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-darwin-arm64 | 4.3.3 | node_modules/@tailwindcss/oxide-darwin-arm64 | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-darwin-x64 | 4.3.3 | node_modules/@tailwindcss/oxide-darwin-x64 | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-freebsd-x64 | 4.3.3 | node_modules/@tailwindcss/oxide-freebsd-x64 | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-linux-arm-gnueabihf | 4.3.3 | node_modules/@tailwindcss/oxide-linux-arm-gnueabihf | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-linux-arm64-gnu | 4.3.3 | node_modules/@tailwindcss/oxide-linux-arm64-gnu | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-linux-arm64-musl | 4.3.3 | node_modules/@tailwindcss/oxide-linux-arm64-musl | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-linux-x64-gnu | 4.3.3 | node_modules/@tailwindcss/oxide-linux-x64-gnu | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-linux-x64-musl | 4.3.3 | node_modules/@tailwindcss/oxide-linux-x64-musl | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-wasm32-wasi | 4.3.3 | node_modules/@tailwindcss/oxide-wasm32-wasi | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-win32-arm64-msvc | 4.3.3 | node_modules/@tailwindcss/oxide-win32-arm64-msvc | @tailwindcss/postcss | Optional platform |
| @tailwindcss/oxide-win32-x64-msvc | 4.3.3 | node_modules/@tailwindcss/oxide-win32-x64-msvc | @tailwindcss/postcss | Optional platform |
| @tailwindcss/postcss | 4.3.3 | node_modules/@tailwindcss/postcss | @tailwindcss/postcss | Development |
| @tanstack/query-core | 5.104.2 | node_modules/@tanstack/query-core | @tanstack/react-query | Runtime/shared |
| @tanstack/react-query | 5.104.2 | node_modules/@tanstack/react-query | @tanstack/react-query | Runtime/shared |
| @tanstack/react-store | 0.11.2 | node_modules/@tanstack/react-store | @tanstack/react-table | Runtime/shared |
| @tanstack/react-table | 9.3.1 | node_modules/@tanstack/react-table | @tanstack/react-table | Runtime/shared |
| @tanstack/react-virtual | 3.14.19 | node_modules/@tanstack/react-virtual | @tanstack/react-virtual | Runtime/shared |
| @tanstack/store | 0.11.2 | node_modules/@tanstack/store | @tanstack/react-table | Runtime/shared |
| @tanstack/table-core | 9.3.1 | node_modules/@tanstack/table-core | @tanstack/react-table | Runtime/shared |
| @tanstack/virtual-core | 3.19.4 | node_modules/@tanstack/virtual-core | @tanstack/react-virtual | Runtime/shared |
| @testing-library/dom | 10.4.2 | node_modules/@testing-library/dom | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| @testing-library/jest-dom | 7.0.1 | node_modules/@testing-library/jest-dom | @testing-library/jest-dom | Development |
| @testing-library/react | 16.3.3 | node_modules/@testing-library/react | @testing-library/react | Development |
| @testing-library/user-event | 14.6.8 | node_modules/@testing-library/user-event | @testing-library/user-event | Development |
| @tiptap/core | 3.32.0 | node_modules/@tiptap/core | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-blockquote | 3.32.0 | node_modules/@tiptap/extension-blockquote | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-bold | 3.32.0 | node_modules/@tiptap/extension-bold | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-bubble-menu | 3.32.0 | node_modules/@tiptap/extension-bubble-menu | @tiptap/react | Optional platform |
| @tiptap/extension-bullet-list | 3.32.0 | node_modules/@tiptap/extension-bullet-list | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-code | 3.32.0 | node_modules/@tiptap/extension-code | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-code-block | 3.32.0 | node_modules/@tiptap/extension-code-block | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-document | 3.32.0 | node_modules/@tiptap/extension-document | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-dropcursor | 3.32.0 | node_modules/@tiptap/extension-dropcursor | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-floating-menu | 3.32.0 | node_modules/@tiptap/extension-floating-menu | @tiptap/react | Optional platform |
| @tiptap/extension-gapcursor | 3.32.0 | node_modules/@tiptap/extension-gapcursor | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-hard-break | 3.32.0 | node_modules/@tiptap/extension-hard-break | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-heading | 3.32.0 | node_modules/@tiptap/extension-heading | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-highlight | 3.32.0 | node_modules/@tiptap/extension-highlight | @tiptap/extension-highlight | Runtime/shared |
| @tiptap/extension-horizontal-rule | 3.32.0 | node_modules/@tiptap/extension-horizontal-rule | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-italic | 3.32.0 | node_modules/@tiptap/extension-italic | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-link | 3.32.0 | node_modules/@tiptap/extension-link | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-list | 3.32.0 | node_modules/@tiptap/extension-list | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-list-item | 3.32.0 | node_modules/@tiptap/extension-list-item | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-list-keymap | 3.32.0 | node_modules/@tiptap/extension-list-keymap | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-ordered-list | 3.32.0 | node_modules/@tiptap/extension-ordered-list | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-paragraph | 3.32.0 | node_modules/@tiptap/extension-paragraph | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-strike | 3.32.0 | node_modules/@tiptap/extension-strike | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-table | 3.32.0 | node_modules/@tiptap/extension-table | @tiptap/extension-table | Runtime/shared |
| @tiptap/extension-text | 3.32.0 | node_modules/@tiptap/extension-text | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extension-text-align | 3.32.0 | node_modules/@tiptap/extension-text-align | @tiptap/extension-text-align | Runtime/shared |
| @tiptap/extension-text-style | 3.32.0 | node_modules/@tiptap/extension-text-style | @tiptap/extension-text-style | Runtime/shared |
| @tiptap/extension-underline | 3.32.0 | node_modules/@tiptap/extension-underline | @tiptap/starter-kit | Runtime/shared |
| @tiptap/extensions | 3.32.0 | node_modules/@tiptap/extensions | @tiptap/starter-kit | Runtime/shared |
| @tiptap/pm | 3.32.0 | node_modules/@tiptap/pm | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| @tiptap/react | 3.32.0 | node_modules/@tiptap/react | @tiptap/react | Runtime/shared |
| @tiptap/starter-kit | 3.32.0 | node_modules/@tiptap/starter-kit | @tiptap/starter-kit | Runtime/shared |
| @trpc/client | 11.19.0 | node_modules/@trpc/client | @trpc/client | Runtime/shared |
| @trpc/server | 11.19.0 | node_modules/@trpc/server | @trpc/client, @trpc/server | Runtime/shared |
| @turf/boolean-point-on-line | 7.4.0 | node_modules/@turf/boolean-point-on-line | @turf/simplify | Development |
| @turf/clean-coords | 7.4.0 | node_modules/@turf/clean-coords | @turf/simplify | Development |
| @turf/clone | 7.4.0 | node_modules/@turf/clone | @turf/simplify | Development |
| @turf/helpers | 7.4.0 | node_modules/@turf/helpers | @turf/simplify | Development |
| @turf/invariant | 7.4.0 | node_modules/@turf/invariant | @turf/simplify | Development |
| @turf/meta | 7.4.0 | node_modules/@turf/meta | @turf/simplify | Development |
| @turf/simplify | 7.4.0 | node_modules/@turf/simplify | @turf/simplify | Development |
| @types/aria-query | 5.0.4 | node_modules/@types/aria-query | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| @types/chai | 5.2.3 | node_modules/@types/chai | @testing-library/jest-dom, vitest | Development |
| @types/d3-geo | 3.1.1 | node_modules/@types/d3-geo | @types/d3-geo | Development |
| @types/deep-eql | 4.0.2 | node_modules/@types/deep-eql | @testing-library/jest-dom, vitest | Development |
| @types/estree | 1.0.9 | node_modules/@types/estree | @testing-library/jest-dom, vite-plugin-compression2, vitest | Development |
| @types/fs-extra | 8.1.5 | node_modules/@types/fs-extra | @capacitor/cli | Development |
| @types/geojson | 7946.0.16 | node_modules/@types/geojson | @turf/simplify, @types/d3-geo, @types/geojson | Development |
| @types/jsonwebtoken | 9.0.10 | node_modules/@types/jsonwebtoken | firebase-admin | Runtime/shared |
| @types/ms | 2.1.0 | node_modules/@types/ms | firebase-admin | Runtime/shared |
| @types/node | 26.6.5 | node_modules/@types/node | @capacitor/cli, @testing-library/jest-dom, @types/node, @types/pg, @vitejs/plugin-react, firebase, firebase-admin, node-pg-migrate, vite, vitest | Runtime/shared |
| @types/pg | 8.23.1 | node_modules/@types/pg | @types/pg, node-pg-migrate | Runtime/shared |
| @types/react | 19.3.0 | node_modules/@types/react | @testing-library/react, @tiptap/react, @types/react, @types/react-dom, lucide-react | Runtime/shared |
| @types/react-dom | 19.3.0 | node_modules/@types/react-dom | @testing-library/react, @tiptap/react, @types/react-dom | Runtime/shared |
| @types/slice-ansi | 4.0.0 | node_modules/@types/slice-ansi | @capacitor/cli | Development |
| @types/use-sync-external-store | 0.0.6 | node_modules/@types/use-sync-external-store | @tiptap/react | Runtime/shared |
| @typescript/typescript-aix-ppc64 | 7.0.2 | node_modules/@typescript/typescript-aix-ppc64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-darwin-arm64 | 7.0.2 | node_modules/@typescript/typescript-darwin-arm64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-darwin-x64 | 7.0.2 | node_modules/@typescript/typescript-darwin-x64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-freebsd-arm64 | 7.0.2 | node_modules/@typescript/typescript-freebsd-arm64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-freebsd-x64 | 7.0.2 | node_modules/@typescript/typescript-freebsd-x64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-linux-arm | 7.0.2 | node_modules/@typescript/typescript-linux-arm | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-linux-arm64 | 7.0.2 | node_modules/@typescript/typescript-linux-arm64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-linux-loong64 | 7.0.2 | node_modules/@typescript/typescript-linux-loong64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-linux-mips64el | 7.0.2 | node_modules/@typescript/typescript-linux-mips64el | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-linux-ppc64 | 7.0.2 | node_modules/@typescript/typescript-linux-ppc64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-linux-riscv64 | 7.0.2 | node_modules/@typescript/typescript-linux-riscv64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-linux-s390x | 7.0.2 | node_modules/@typescript/typescript-linux-s390x | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-linux-x64 | 7.0.2 | node_modules/@typescript/typescript-linux-x64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-netbsd-arm64 | 7.0.2 | node_modules/@typescript/typescript-netbsd-arm64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-netbsd-x64 | 7.0.2 | node_modules/@typescript/typescript-netbsd-x64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-openbsd-arm64 | 7.0.2 | node_modules/@typescript/typescript-openbsd-arm64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-openbsd-x64 | 7.0.2 | node_modules/@typescript/typescript-openbsd-x64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-sunos-x64 | 7.0.2 | node_modules/@typescript/typescript-sunos-x64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-win32-arm64 | 7.0.2 | node_modules/@typescript/typescript-win32-arm64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @typescript/typescript-win32-x64 | 7.0.2 | node_modules/@typescript/typescript-win32-x64 | @trpc/client, @trpc/server, typescript | Optional platform |
| @vitejs/plugin-react | 6.1.2 | node_modules/@vitejs/plugin-react | @vitejs/plugin-react | Development |
| @vitest/mocker | 5.0.4 | node_modules/@vitest/mocker | @testing-library/jest-dom, vitest | Development |
| @vitest/spy | 5.0.4 | node_modules/@vitest/spy | @testing-library/jest-dom, vitest | Development |
| @xmldom/xmldom | 0.9.12 | node_modules/@xmldom/xmldom | @capacitor/cli | Development |
| 7zip-bin | 5.1.1 | node_modules/7zip-bin | 7zip-min | Development |
| 7zip-min | 3.0.1 | node_modules/7zip-min | 7zip-min | Development |
| abort-controller | 3.0.0 | node_modules/abort-controller | @google-cloud/storage, firebase-admin | Runtime/shared |
| abstract-logging | 2.0.1 | node_modules/abstract-logging | fastify | Runtime/shared |
| agent-base | 7.1.4 | node_modules/agent-base | @google-cloud/storage, firebase-admin | Runtime/shared |
| ajv | 8.20.0 | node_modules/ajv | fastify | Runtime/shared |
| ajv-formats | 3.0.1 | node_modules/ajv-formats | fastify | Runtime/shared |
| ansi-regex | 6.4.0 | node_modules/@isaacs/cliui/node_modules/ansi-regex | firebase-admin | Optional platform |
| ansi-regex | 5.0.1 | node_modules/ansi-regex | @capacitor/cli, @testing-library/jest-dom, @testing-library/react, @testing-library/user-event, firebase, firebase-admin | Runtime/shared |
| ansi-regex | 6.4.0 | node_modules/node-pg-migrate/node_modules/ansi-regex | node-pg-migrate | Runtime/shared |
| ansi-styles | 6.2.3 | node_modules/@isaacs/cliui/node_modules/ansi-styles | firebase-admin | Optional platform |
| ansi-styles | 5.2.0 | node_modules/ansi-styles | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| ansi-styles | 6.2.3 | node_modules/node-pg-migrate/node_modules/ansi-styles | node-pg-migrate | Runtime/shared |
| ansi-styles | 4.3.0 | node_modules/slice-ansi/node_modules/ansi-styles | @capacitor/cli | Development |
| ansi-styles | 4.3.0 | node_modules/wrap-ansi-cjs/node_modules/ansi-styles | firebase-admin | Optional platform |
| ansi-styles | 4.3.0 | node_modules/wrap-ansi/node_modules/ansi-styles | @capacitor/cli, firebase, firebase-admin | Runtime/shared |
| anynum | 1.0.1 | node_modules/anynum | @google-cloud/storage, firebase-admin | Runtime/shared |
| aria-query | 5.3.0 | node_modules/aria-query | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| array-source | 0.0.4 | node_modules/array-source | shapefile | Development |
| assertion-error | 2.0.1 | node_modules/assertion-error | @testing-library/jest-dom, vitest | Development |
| astral-regex | 2.0.0 | node_modules/astral-regex | @capacitor/cli | Development |
| async-retry | 1.3.3 | node_modules/async-retry | @google-cloud/storage, firebase-admin | Runtime/shared |
| at-least-node | 1.0.0 | node_modules/at-least-node | @capacitor/cli | Development |
| atomic-sleep | 1.0.0 | node_modules/atomic-sleep | fastify | Runtime/shared |
| autoprefixer | 10.6.1 | node_modules/autoprefixer | autoprefixer | Development |
| avvio | 9.3.1 | node_modules/avvio | fastify | Runtime/shared |
| balanced-match | 1.0.2 | node_modules/@google-cloud/firestore-api/node_modules/balanced-match | firebase-admin | Optional platform |
| balanced-match | 4.0.4 | node_modules/balanced-match | @capacitor/cli, node-pg-migrate | Runtime/shared |
| base64-js | 1.5.1 | node_modules/base64-js | @capacitor/cli, @google-cloud/storage, firebase-admin | Runtime/shared |
| baseline-browser-mapping | 2.11.28 | node_modules/baseline-browser-mapping | autoprefixer | Development |
| bidi-js | 1.1.0 | node_modules/bidi-js | @testing-library/jest-dom, jsdom, vitest | Development |
| big-integer | 1.6.52 | node_modules/big-integer | @capacitor/cli | Development |
| bignumber.js | 9.3.1 | node_modules/bignumber.js | @google-cloud/storage, firebase-admin | Runtime/shared |
| bmp-js | 0.1.0 | node_modules/bmp-js | tesseract.js | Runtime/shared |
| bplist-creator | 0.1.0 | node_modules/bplist-creator | @capacitor/cli | Development |
| bplist-parser | 0.3.2 | node_modules/bplist-parser | @capacitor/cli | Development |
| bplist-parser | 0.3.1 | node_modules/simple-plist/node_modules/bplist-parser | @capacitor/cli | Development |
| brace-expansion | 2.1.7 | node_modules/@google-cloud/firestore-api/node_modules/brace-expansion | firebase-admin | Optional platform |
| brace-expansion | 5.0.12 | node_modules/brace-expansion | @capacitor/cli, node-pg-migrate | Runtime/shared |
| browserslist | 4.29.3 | node_modules/browserslist | autoprefixer | Development |
| buffer-crc32 | 0.2.13 | node_modules/buffer-crc32 | @capacitor/cli | Development |
| buffer-equal-constant-time | 1.0.1 | node_modules/buffer-equal-constant-time | @google-cloud/storage, firebase-admin | Runtime/shared |
| caniuse-lite | 1.0.30001816 | node_modules/caniuse-lite | autoprefixer | Development |
| chai | 6.3.0 | node_modules/chai | @testing-library/jest-dom, vitest | Development |
| chownr | 3.0.0 | node_modules/chownr | @capacitor/cli | Development |
| cliui | 8.0.1 | node_modules/cliui | firebase, firebase-admin | Runtime/shared |
| cliui | 9.0.1 | node_modules/node-pg-migrate/node_modules/cliui | node-pg-migrate | Runtime/shared |
| clsx | 2.1.1 | node_modules/clsx | clsx | Runtime/shared |
| color-convert | 2.0.1 | node_modules/color-convert | @capacitor/cli, firebase, firebase-admin | Runtime/shared |
| color-name | 1.1.4 | node_modules/color-name | @capacitor/cli, firebase, firebase-admin | Runtime/shared |
| commander | 12.1.0 | node_modules/commander | @capacitor/cli | Development |
| commander | 2.20.3 | node_modules/shapefile/node_modules/commander | shapefile | Development |
| cookie | 1.1.1 | node_modules/cookie | react-router-dom | Runtime/shared |
| cookie | 2.0.1 | node_modules/light-my-request/node_modules/cookie | fastify | Runtime/shared |
| cross-spawn | 7.0.6 | node_modules/cross-spawn | @capacitor/cli, firebase-admin | Runtime/shared |
| css-tree | 3.2.1 | node_modules/css-tree | @testing-library/jest-dom, jsdom, vitest | Development |
| css.escape | 1.5.1 | node_modules/css.escape | @testing-library/jest-dom | Development |
| csstype | 3.2.3 | node_modules/csstype | @testing-library/react, @tiptap/react, @types/react, @types/react-dom, lucide-react | Runtime/shared |
| d3-array | 3.2.4 | node_modules/d3-array | d3-geo | Runtime/shared |
| d3-geo | 3.1.1 | node_modules/d3-geo | d3-geo | Runtime/shared |
| data-uri-to-buffer | 4.0.1 | node_modules/data-uri-to-buffer | @google-cloud/storage, firebase-admin | Runtime/shared |
| data-urls | 8.0.0 | node_modules/data-urls | @testing-library/jest-dom, jsdom, vitest | Development |
| debug | 4.4.3 | node_modules/debug | @capacitor/cli, @google-cloud/storage, firebase-admin | Runtime/shared |
| decimal.js | 10.6.0 | node_modules/decimal.js | @testing-library/jest-dom, jsdom, vitest | Development |
| define-lazy-prop | 2.0.0 | node_modules/define-lazy-prop | @capacitor/cli | Development |
| dequal | 2.0.3 | node_modules/dequal | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event, fastify | Runtime/shared |
| detect-libc | 2.1.2 | node_modules/detect-libc | @tailwindcss/postcss, @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Development |
| dom-accessibility-api | 0.6.3 | node_modules/@testing-library/jest-dom/node_modules/dom-accessibility-api | @testing-library/jest-dom | Development |
| dom-accessibility-api | 0.5.16 | node_modules/dom-accessibility-api | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| duplexify | 4.1.3 | node_modules/duplexify | @google-cloud/storage, firebase-admin | Runtime/shared |
| eastasianwidth | 0.2.0 | node_modules/eastasianwidth | firebase-admin | Optional platform |
| ecdsa-sig-formatter | 1.0.11 | node_modules/ecdsa-sig-formatter | @google-cloud/storage, firebase-admin | Runtime/shared |
| electron-to-chromium | 1.5.456 | node_modules/electron-to-chromium | autoprefixer | Development |
| elementtree | 0.1.7 | node_modules/elementtree | @capacitor/cli | Development |
| emoji-regex | 9.2.2 | node_modules/@isaacs/cliui/node_modules/emoji-regex | firebase-admin | Optional platform |
| emoji-regex | 8.0.0 | node_modules/emoji-regex | @capacitor/cli, firebase, firebase-admin | Runtime/shared |
| emoji-regex | 10.6.0 | node_modules/node-pg-migrate/node_modules/emoji-regex | node-pg-migrate | Runtime/shared |
| end-of-stream | 1.4.5 | node_modules/end-of-stream | @google-cloud/storage, firebase-admin | Runtime/shared |
| enhanced-resolve | 5.26.0 | node_modules/enhanced-resolve | @tailwindcss/postcss | Development |
| entities | 8.1.0 | node_modules/entities | @testing-library/jest-dom, jsdom, vitest | Development |
| env-paths | 2.2.1 | node_modules/env-paths | @capacitor/cli | Development |
| es-module-lexer | 2.3.2 | node_modules/es-module-lexer | @testing-library/jest-dom, vitest | Development |
| esbuild | 0.28.2 | node_modules/esbuild | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Development |
| escalade | 3.2.0 | node_modules/escalade | autoprefixer, firebase, firebase-admin, node-pg-migrate | Runtime/shared |
| estree-walker | 3.0.3 | node_modules/@vitest/mocker/node_modules/estree-walker | @testing-library/jest-dom, vitest | Development |
| estree-walker | 2.0.2 | node_modules/estree-walker | vite-plugin-compression2 | Development |
| event-target-shim | 5.0.1 | node_modules/event-target-shim | @google-cloud/storage, firebase-admin | Runtime/shared |
| expect-type | 1.4.0 | node_modules/expect-type | @testing-library/jest-dom, vitest | Development |
| extend | 3.0.2 | node_modules/extend | @google-cloud/storage, firebase-admin | Runtime/shared |
| fast-decode-uri-component | 1.0.1 | node_modules/fast-decode-uri-component | fastify | Runtime/shared |
| fast-deep-equal | 3.1.3 | node_modules/fast-deep-equal | fastify, firebase-admin | Runtime/shared |
| fast-equals | 5.4.5 | node_modules/fast-equals | @tiptap/react | Runtime/shared |
| fast-json-stringify | 7.1.0 | node_modules/fast-json-stringify | fastify | Runtime/shared |
| fast-querystring | 1.1.2 | node_modules/fast-querystring | fastify | Runtime/shared |
| fast-uri | 3.1.8 | node_modules/ajv/node_modules/fast-uri | fastify | Runtime/shared |
| fast-uri | 4.2.2 | node_modules/fast-uri | fastify | Runtime/shared |
| fast-xml-builder | 1.3.1 | node_modules/fast-xml-builder | @google-cloud/storage, firebase-admin | Runtime/shared |
| fast-xml-parser | 5.11.2 | node_modules/fast-xml-parser | @google-cloud/storage, firebase-admin | Runtime/shared |
| fastify | 5.12.7 | node_modules/fastify | fastify | Runtime/shared |
| fastify-plugin | 6.0.1 | node_modules/fastify-plugin | @fastify/cors, @fastify/rate-limit | Runtime/shared |
| fastq | 1.20.3 | node_modules/fastq | fastify | Runtime/shared |
| faye-websocket | 0.11.4 | node_modules/faye-websocket | firebase, firebase-admin | Runtime/shared |
| fd-slicer | 1.1.0 | node_modules/fd-slicer | @capacitor/cli | Development |
| fdir | 6.5.0 | node_modules/fdir | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Development |
| fetch-blob | 3.2.0 | node_modules/fetch-blob | @google-cloud/storage, firebase-admin | Runtime/shared |
| file-source | 0.6.1 | node_modules/file-source | shapefile | Development |
| find-my-way | 9.10.0 | node_modules/find-my-way | fastify | Runtime/shared |
| firebase | 13.0.0 | node_modules/firebase | firebase | Runtime/shared |
| firebase-admin | 14.5.0 | node_modules/firebase-admin | firebase-admin | Runtime/shared |
| foreground-child | 3.3.1 | node_modules/foreground-child | firebase-admin | Optional platform |
| formdata-polyfill | 4.0.10 | node_modules/formdata-polyfill | @google-cloud/storage, firebase-admin | Runtime/shared |
| fraction.js | 5.3.4 | node_modules/fraction.js | autoprefixer | Development |
| framer-motion | 14.2.0 | node_modules/framer-motion | framer-motion | Runtime/shared |
| fs-extra | 9.1.0 | node_modules/@ionic/utils-fs/node_modules/fs-extra | @capacitor/cli | Development |
| fs-extra | 11.4.1 | node_modules/fs-extra | @capacitor/cli | Development |
| fsevents | 2.3.3 | node_modules/fsevents | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Optional platform |
| functional-red-black-tree | 1.0.1 | node_modules/functional-red-black-tree | firebase-admin | Optional platform |
| gaxios | 7.1.3 | node_modules/@google-cloud/firestore-api/node_modules/gaxios | firebase-admin | Optional platform |
| gaxios | 7.3.1 | node_modules/gaxios | @google-cloud/storage, firebase-admin | Runtime/shared |
| gcp-metadata | 8.1.4 | node_modules/@google-cloud/firestore-api/node_modules/gcp-metadata | firebase-admin | Optional platform |
| gcp-metadata | 9.2.0 | node_modules/gcp-metadata | @google-cloud/storage, firebase-admin | Runtime/shared |
| get-caller-file | 2.0.5 | node_modules/get-caller-file | firebase, firebase-admin, node-pg-migrate | Runtime/shared |
| get-east-asian-width | 1.7.0 | node_modules/get-east-asian-width | node-pg-migrate | Runtime/shared |
| glob | 10.5.0 | node_modules/@google-cloud/firestore-api/node_modules/glob | firebase-admin | Optional platform |
| glob | 13.0.6 | node_modules/glob | @capacitor/cli, node-pg-migrate | Runtime/shared |
| google-auth-library | 10.5.0 | node_modules/@google-cloud/firestore-api/node_modules/google-auth-library | firebase-admin | Optional platform |
| google-auth-library | 11.3.0 | node_modules/google-auth-library | @google-cloud/storage, firebase-admin | Runtime/shared |
| google-gax | 5.0.8 | node_modules/@google-cloud/firestore-api/node_modules/google-gax | firebase-admin | Optional platform |
| google-gax | 6.12.1 | node_modules/google-gax | firebase-admin | Optional platform |
| google-logging-utils | 1.1.3 | node_modules/@google-cloud/firestore-api/node_modules/google-logging-utils | firebase-admin | Optional platform |
| google-logging-utils | 2.1.0 | node_modules/google-logging-utils | @google-cloud/storage, firebase-admin | Runtime/shared |
| graceful-fs | 4.2.11 | node_modules/graceful-fs | @capacitor/cli, @tailwindcss/postcss | Development |
| gtoken | 8.0.0 | node_modules/gtoken | firebase-admin | Optional platform |
| html-encoding-sniffer | 7.0.0 | node_modules/html-encoding-sniffer | @testing-library/jest-dom, jsdom, vitest | Development |
| html-entities | 2.6.0 | node_modules/html-entities | @google-cloud/storage, firebase-admin | Runtime/shared |
| http-parser-js | 0.5.10 | node_modules/http-parser-js | firebase, firebase-admin | Runtime/shared |
| http-proxy-agent | 7.0.2 | node_modules/http-proxy-agent | @google-cloud/storage, firebase-admin | Runtime/shared |
| https-proxy-agent | 7.0.6 | node_modules/https-proxy-agent | @google-cloud/storage, firebase-admin | Runtime/shared |
| idb | 7.1.1 | node_modules/idb | firebase, firebase-admin | Runtime/shared |
| idb-keyval | 6.3.0 | node_modules/idb-keyval | tesseract.js | Runtime/shared |
| indent-string | 4.0.0 | node_modules/indent-string | @testing-library/jest-dom | Development |
| inherits | 2.0.4 | node_modules/inherits | @capacitor/cli, @google-cloud/storage, firebase-admin | Runtime/shared |
| ini | 4.1.3 | node_modules/ini | @capacitor/cli | Development |
| internmap | 2.0.3 | node_modules/internmap | d3-geo | Runtime/shared |
| ip-address | 10.7.4 | node_modules/ip-address | @fastify/rate-limit | Runtime/shared |
| ipaddr.js | 2.5.0 | node_modules/ipaddr.js | fastify | Runtime/shared |
| is-docker | 2.2.1 | node_modules/is-docker | @capacitor/cli | Development |
| is-fullwidth-code-point | 3.0.0 | node_modules/is-fullwidth-code-point | @capacitor/cli, firebase, firebase-admin | Runtime/shared |
| is-potential-custom-element-name | 1.0.1 | node_modules/is-potential-custom-element-name | @testing-library/jest-dom, jsdom, vitest | Development |
| is-unsafe | 2.0.2 | node_modules/is-unsafe | @google-cloud/storage, firebase-admin | Runtime/shared |
| is-url | 1.2.4 | node_modules/is-url | tesseract.js | Runtime/shared |
| is-wsl | 2.2.0 | node_modules/is-wsl | @capacitor/cli | Development |
| isexe | 2.0.0 | node_modules/isexe | @capacitor/cli, firebase-admin | Runtime/shared |
| jackspeak | 3.4.3 | node_modules/jackspeak | firebase-admin | Optional platform |
| jiti | 2.7.0 | node_modules/jiti | @tailwindcss/postcss, @testing-library/jest-dom, @vitejs/plugin-react, node-pg-migrate, vite, vitest | Runtime/shared |
| jose | 6.2.12 | node_modules/jose | firebase-admin, jose | Runtime/shared |
| js-tokens | 4.0.0 | node_modules/js-tokens | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| jsdom | 30.1.2 | node_modules/jsdom | @testing-library/jest-dom, jsdom, vitest | Development |
| json-bigint | 1.0.0 | node_modules/json-bigint | @google-cloud/storage, firebase-admin | Runtime/shared |
| json-schema-ref-resolver | 3.0.1 | node_modules/json-schema-ref-resolver | fastify | Runtime/shared |
| json-schema-traverse | 1.0.0 | node_modules/json-schema-traverse | fastify | Runtime/shared |
| jsonfile | 6.2.1 | node_modules/jsonfile | @capacitor/cli | Development |
| jsonwebtoken | 9.0.3 | node_modules/jsonwebtoken | firebase-admin | Runtime/shared |
| jwa | 2.0.1 | node_modules/jwa | @google-cloud/storage, firebase-admin | Runtime/shared |
| jwks-rsa | 4.1.0 | node_modules/jwks-rsa | firebase-admin | Runtime/shared |
| jws | 4.0.1 | node_modules/jws | @google-cloud/storage, firebase-admin | Runtime/shared |
| kleur | 4.1.5 | node_modules/kleur | @capacitor/cli | Development |
| kleur | 3.0.3 | node_modules/prompts/node_modules/kleur | @capacitor/cli | Development |
| light-my-request | 6.8.0 | node_modules/light-my-request | fastify | Runtime/shared |
| lightningcss | 1.32.0 | node_modules/lightningcss | @tailwindcss/postcss | Development |
| lightningcss | 1.33.0 | node_modules/vite/node_modules/lightningcss | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Development |
| lightningcss-android-arm64 | 1.32.0 | node_modules/lightningcss-android-arm64 | @tailwindcss/postcss | Optional platform |
| lightningcss-android-arm64 | 1.33.0 | node_modules/vite/node_modules/lightningcss-android-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-darwin-arm64 | 1.32.0 | node_modules/lightningcss-darwin-arm64 | @tailwindcss/postcss | Optional platform |
| lightningcss-darwin-arm64 | 1.33.0 | node_modules/vite/node_modules/lightningcss-darwin-arm64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-darwin-x64 | 1.32.0 | node_modules/lightningcss-darwin-x64 | @tailwindcss/postcss | Optional platform |
| lightningcss-darwin-x64 | 1.33.0 | node_modules/vite/node_modules/lightningcss-darwin-x64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-freebsd-x64 | 1.32.0 | node_modules/lightningcss-freebsd-x64 | @tailwindcss/postcss | Optional platform |
| lightningcss-freebsd-x64 | 1.33.0 | node_modules/vite/node_modules/lightningcss-freebsd-x64 | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-linux-arm-gnueabihf | 1.32.0 | node_modules/lightningcss-linux-arm-gnueabihf | @tailwindcss/postcss | Optional platform |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | node_modules/vite/node_modules/lightningcss-linux-arm-gnueabihf | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-linux-arm64-gnu | 1.32.0 | node_modules/lightningcss-linux-arm64-gnu | @tailwindcss/postcss | Optional platform |
| lightningcss-linux-arm64-gnu | 1.33.0 | node_modules/vite/node_modules/lightningcss-linux-arm64-gnu | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-linux-arm64-musl | 1.32.0 | node_modules/lightningcss-linux-arm64-musl | @tailwindcss/postcss | Optional platform |
| lightningcss-linux-arm64-musl | 1.33.0 | node_modules/vite/node_modules/lightningcss-linux-arm64-musl | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-linux-x64-gnu | 1.32.0 | node_modules/lightningcss-linux-x64-gnu | @tailwindcss/postcss | Optional platform |
| lightningcss-linux-x64-gnu | 1.33.0 | node_modules/vite/node_modules/lightningcss-linux-x64-gnu | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-linux-x64-musl | 1.32.0 | node_modules/lightningcss-linux-x64-musl | @tailwindcss/postcss | Optional platform |
| lightningcss-linux-x64-musl | 1.33.0 | node_modules/vite/node_modules/lightningcss-linux-x64-musl | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-win32-arm64-msvc | 1.32.0 | node_modules/lightningcss-win32-arm64-msvc | @tailwindcss/postcss | Optional platform |
| lightningcss-win32-arm64-msvc | 1.33.0 | node_modules/vite/node_modules/lightningcss-win32-arm64-msvc | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| lightningcss-win32-x64-msvc | 1.32.0 | node_modules/lightningcss-win32-x64-msvc | @tailwindcss/postcss | Optional platform |
| lightningcss-win32-x64-msvc | 1.33.0 | node_modules/vite/node_modules/lightningcss-win32-x64-msvc | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Optional platform |
| limiter | 1.1.5 | node_modules/limiter | firebase-admin | Runtime/shared |
| linkifyjs | 4.3.3 | node_modules/linkifyjs | @tiptap/starter-kit | Runtime/shared |
| lodash.camelcase | 4.3.0 | node_modules/lodash.camelcase | firebase, firebase-admin | Runtime/shared |
| lodash.clonedeep | 4.5.0 | node_modules/lodash.clonedeep | firebase-admin | Runtime/shared |
| lodash.includes | 4.3.0 | node_modules/lodash.includes | firebase-admin | Runtime/shared |
| lodash.isboolean | 3.0.3 | node_modules/lodash.isboolean | firebase-admin | Runtime/shared |
| lodash.isinteger | 4.0.4 | node_modules/lodash.isinteger | firebase-admin | Runtime/shared |
| lodash.isnumber | 3.0.3 | node_modules/lodash.isnumber | firebase-admin | Runtime/shared |
| lodash.isplainobject | 4.0.6 | node_modules/lodash.isplainobject | firebase-admin | Runtime/shared |
| lodash.isstring | 4.0.1 | node_modules/lodash.isstring | firebase-admin | Runtime/shared |
| lodash.once | 4.1.1 | node_modules/lodash.once | firebase-admin | Runtime/shared |
| long | 5.3.2 | node_modules/long | firebase, firebase-admin | Runtime/shared |
| lru-cache | 10.4.3 | node_modules/@google-cloud/firestore-api/node_modules/lru-cache | firebase-admin | Optional platform |
| lru-cache | 11.5.3 | node_modules/lru-cache | @capacitor/cli, @testing-library/jest-dom, firebase-admin, jsdom, node-pg-migrate, vitest | Runtime/shared |
| lru-memoizer | 3.0.0 | node_modules/lru-memoizer | firebase-admin | Runtime/shared |
| lucide-react | 1.57.0 | node_modules/lucide-react | lucide-react | Runtime/shared |
| lz-string | 1.5.0 | node_modules/lz-string | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| magic-string | 1.4.3 | node_modules/@vitest/mocker/node_modules/magic-string | @testing-library/jest-dom, vitest | Development |
| magic-string | 0.30.21 | node_modules/magic-string | @tailwindcss/postcss | Development |
| magic-string | 1.4.3 | node_modules/vitest/node_modules/magic-string | @testing-library/jest-dom, vitest | Development |
| mdn-data | 2.27.1 | node_modules/mdn-data | @testing-library/jest-dom, jsdom, vitest | Development |
| mgrs | 1.0.0 | node_modules/mgrs | proj4 | Development |
| mime | 3.0.0 | node_modules/mime | @google-cloud/storage, firebase-admin | Runtime/shared |
| min-indent | 1.0.1 | node_modules/min-indent | @testing-library/jest-dom | Development |
| minimatch | 9.0.9 | node_modules/@google-cloud/firestore-api/node_modules/minimatch | firebase-admin | Optional platform |
| minimatch | 10.2.6 | node_modules/minimatch | @capacitor/cli, node-pg-migrate | Runtime/shared |
| minipass | 7.1.3 | node_modules/minipass | @capacitor/cli, firebase-admin, node-pg-migrate | Runtime/shared |
| minizlib | 3.1.0 | node_modules/minizlib | @capacitor/cli | Development |
| motion-dom | 14.2.0 | node_modules/motion-dom | framer-motion | Runtime/shared |
| motion-utils | 14.1.1 | node_modules/motion-utils | framer-motion | Runtime/shared |
| ms | 2.1.3 | node_modules/ms | @capacitor/cli, @google-cloud/storage, firebase-admin | Runtime/shared |
| nanoid | 3.3.20 | node_modules/nanoid | @tailwindcss/postcss, @testing-library/jest-dom, @vitejs/plugin-react, autoprefixer, postcss, vite, vitest | Development |
| native-run | 2.0.3 | node_modules/native-run | @capacitor/cli | Development |
| node-domexception | 1.0.0 | node_modules/node-domexception | @google-cloud/storage, firebase-admin | Runtime/shared |
| node-fetch | 3.3.2 | node_modules/@google-cloud/firestore-api/node_modules/node-fetch | firebase-admin | Optional platform |
| node-fetch | 3.3.2 | node_modules/gaxios/node_modules/node-fetch | @google-cloud/storage, firebase-admin | Runtime/shared |
| node-fetch | 3.3.2 | node_modules/google-gax/node_modules/node-fetch | firebase-admin | Optional platform |
| node-fetch | 2.7.0 | node_modules/node-fetch | tesseract.js | Runtime/shared |
| node-fetch | 3.3.2 | node_modules/teeny-request/node_modules/node-fetch | @google-cloud/storage, firebase-admin | Runtime/shared |
| node-pg-migrate | 9.0.0 | node_modules/node-pg-migrate | node-pg-migrate | Runtime/shared |
| node-releases | 2.0.58 | node_modules/node-releases | autoprefixer | Development |
| object-hash | 3.0.0 | node_modules/object-hash | firebase-admin | Optional platform |
| obug | 3.0.0 | node_modules/obug | @testing-library/jest-dom, vitest | Development |
| on-exit-leak-free | 2.1.2 | node_modules/on-exit-leak-free | fastify | Runtime/shared |
| once | 1.4.0 | node_modules/once | @google-cloud/storage, firebase-admin | Runtime/shared |
| open | 8.4.2 | node_modules/open | @capacitor/cli | Development |
| opencollective-postinstall | 2.0.3 | node_modules/opencollective-postinstall | tesseract.js | Runtime/shared |
| orderedmap | 2.1.1 | node_modules/orderedmap | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| p-limit | 3.1.0 | node_modules/p-limit | @google-cloud/storage, firebase-admin | Runtime/shared |
| package-json-from-dist | 1.0.1 | node_modules/package-json-from-dist | @capacitor/cli, firebase-admin | Runtime/shared |
| parse5 | 8.0.1 | node_modules/parse5 | @testing-library/jest-dom, jsdom, vitest | Development |
| path-expression-matcher | 1.6.2 | node_modules/path-expression-matcher | @google-cloud/storage, firebase-admin | Runtime/shared |
| path-key | 3.1.1 | node_modules/path-key | @capacitor/cli, firebase-admin | Runtime/shared |
| path-scurry | 1.11.1 | node_modules/@google-cloud/firestore-api/node_modules/path-scurry | firebase-admin | Optional platform |
| path-scurry | 2.0.2 | node_modules/path-scurry | @capacitor/cli, node-pg-migrate | Runtime/shared |
| path-source | 0.1.3 | node_modules/path-source | shapefile | Development |
| pend | 1.2.0 | node_modules/pend | @capacitor/cli | Development |
| pg | 8.23.1 | node_modules/pg | node-pg-migrate, pg | Runtime/shared |
| pg-cloudflare | 1.4.1 | node_modules/pg-cloudflare | node-pg-migrate, pg | Optional platform |
| pg-connection-string | 2.14.1 | node_modules/pg-connection-string | node-pg-migrate, pg | Runtime/shared |
| pg-int8 | 1.0.1 | node_modules/pg-int8 | @types/pg, node-pg-migrate, pg | Runtime/shared |
| pg-pool | 3.14.0 | node_modules/pg-pool | node-pg-migrate, pg | Runtime/shared |
| pg-protocol | 1.16.1 | node_modules/pg-protocol | @types/pg, node-pg-migrate, pg | Runtime/shared |
| pg-types | 2.2.0 | node_modules/pg-types | @types/pg, node-pg-migrate, pg | Runtime/shared |
| pgpass | 1.0.5 | node_modules/pgpass | node-pg-migrate, pg | Runtime/shared |
| picocolors | 1.1.1 | node_modules/picocolors | @tailwindcss/postcss, @testing-library/jest-dom, @testing-library/react, @testing-library/user-event, @vitejs/plugin-react, autoprefixer, postcss, vite, vitest | Development |
| picomatch | 4.0.7 | node_modules/picomatch | @testing-library/jest-dom, @vitejs/plugin-react, vite, vite-plugin-compression2, vitest | Development |
| pino | 10.4.0 | node_modules/pino | fastify | Runtime/shared |
| pino-abstract-transport | 3.0.0 | node_modules/pino-abstract-transport | fastify | Runtime/shared |
| pino-std-serializers | 7.1.0 | node_modules/pino-std-serializers | fastify | Runtime/shared |
| playwright | 1.64.1 | node_modules/playwright | @playwright/test | Development |
| playwright-core | 1.64.1 | node_modules/playwright-core | @playwright/test | Development |
| plist | 3.1.1 | node_modules/plist | @capacitor/cli | Development |
| polygon-clipping | 0.15.7 | node_modules/polygon-clipping | polygon-clipping | Development |
| postcss | 8.5.30 | node_modules/postcss | @tailwindcss/postcss, @testing-library/jest-dom, @vitejs/plugin-react, autoprefixer, postcss, vite, vitest | Development |
| postcss-value-parser | 4.2.0 | node_modules/postcss-value-parser | autoprefixer | Development |
| postgres-array | 2.0.0 | node_modules/postgres-array | @types/pg, node-pg-migrate, pg | Runtime/shared |
| postgres-bytea | 1.0.1 | node_modules/postgres-bytea | @types/pg, node-pg-migrate, pg | Runtime/shared |
| postgres-date | 1.0.7 | node_modules/postgres-date | @types/pg, node-pg-migrate, pg | Runtime/shared |
| postgres-interval | 1.2.0 | node_modules/postgres-interval | @types/pg, node-pg-migrate, pg | Runtime/shared |
| pretty-format | 27.5.1 | node_modules/pretty-format | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| process-warning | 5.1.1 | node_modules/process-warning | fastify | Runtime/shared |
| proj4 | 2.22.0 | node_modules/proj4 | proj4 | Development |
| prompts | 2.4.2 | node_modules/prompts | @capacitor/cli | Development |
| prosemirror-changeset | 2.4.4 | node_modules/prosemirror-changeset | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-commands | 1.7.2 | node_modules/prosemirror-commands | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-dropcursor | 1.8.4 | node_modules/prosemirror-dropcursor | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-gapcursor | 1.4.1 | node_modules/prosemirror-gapcursor | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-history | 1.5.1 | node_modules/prosemirror-history | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-inputrules | 1.5.1 | node_modules/prosemirror-inputrules | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-keymap | 1.2.3 | node_modules/prosemirror-keymap | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-model | 1.25.12 | node_modules/prosemirror-model | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-schema-list | 1.5.1 | node_modules/prosemirror-schema-list | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-state | 1.4.4 | node_modules/prosemirror-state | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-tables | 1.8.5 | node_modules/prosemirror-tables | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-transform | 1.12.2 | node_modules/prosemirror-transform | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| prosemirror-view | 1.42.6 | node_modules/prosemirror-view | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| proto3-json-serializer | 3.0.4 | node_modules/@google-cloud/firestore-api/node_modules/proto3-json-serializer | firebase-admin | Optional platform |
| proto3-json-serializer | 4.1.0 | node_modules/proto3-json-serializer | firebase-admin | Optional platform |
| protobufjs | 7.6.6 | node_modules/protobufjs | firebase, firebase-admin | Runtime/shared |
| punycode | 2.3.1 | node_modules/punycode | @testing-library/jest-dom, jsdom, vitest | Development |
| quick-format-unescaped | 4.0.4 | node_modules/quick-format-unescaped | fastify | Runtime/shared |
| re2js | 2.8.6 | node_modules/re2js | firebase | Runtime/shared |
| react | 19.3.1 | node_modules/react | @tanstack/react-query, @tanstack/react-table, @tanstack/react-virtual, @testing-library/react, @tiptap/react, framer-motion, lucide-react, react, react-dom, react-router-dom | Runtime/shared |
| react-dom | 19.3.1 | node_modules/react-dom | @tanstack/react-table, @tanstack/react-virtual, @testing-library/react, @tiptap/react, framer-motion, react-dom, react-router-dom | Runtime/shared |
| react-is | 17.0.2 | node_modules/react-is | @testing-library/jest-dom, @testing-library/react, @testing-library/user-event | Development |
| react-router | 7.18.4 | node_modules/react-router | react-router-dom | Runtime/shared |
| react-router-dom | 7.18.4 | node_modules/react-router-dom | react-router-dom | Runtime/shared |
| readable-stream | 3.6.2 | node_modules/readable-stream | @capacitor/cli, @google-cloud/storage, firebase-admin | Runtime/shared |
| real-require | 1.0.0 | node_modules/real-require | fastify | Runtime/shared |
| redent | 3.0.0 | node_modules/redent | @testing-library/jest-dom | Development |
| regenerator-runtime | 0.13.11 | node_modules/regenerator-runtime | tesseract.js | Runtime/shared |
| require-directory | 2.1.1 | node_modules/require-directory | firebase, firebase-admin | Runtime/shared |
| require-from-string | 2.0.2 | node_modules/require-from-string | @testing-library/jest-dom, fastify, jsdom, vitest | Runtime/shared |
| ret | 0.5.0 | node_modules/ret | fastify | Runtime/shared |
| retry | 0.13.1 | node_modules/retry | @google-cloud/storage, firebase-admin | Runtime/shared |
| retry-request | 8.0.4 | node_modules/@google-cloud/firestore-api/node_modules/retry-request | firebase-admin | Optional platform |
| retry-request | 9.1.0 | node_modules/retry-request | @google-cloud/storage, firebase-admin | Runtime/shared |
| reusify | 1.1.0 | node_modules/reusify | fastify | Runtime/shared |
| rfdc | 1.4.1 | node_modules/rfdc | fastify | Runtime/shared |
| rimraf | 5.0.10 | node_modules/@google-cloud/firestore-api/node_modules/rimraf | firebase-admin | Optional platform |
| rimraf | 6.1.3 | node_modules/rimraf | @capacitor/cli | Development |
| robust-predicates | 3.0.3 | node_modules/robust-predicates | polygon-clipping | Development |
| rolldown | 1.2.14 | node_modules/rolldown | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Development |
| rope-sequence | 1.3.4 | node_modules/rope-sequence | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| safe-buffer | 5.2.1 | node_modules/safe-buffer | @capacitor/cli, @google-cloud/storage, firebase, firebase-admin | Runtime/shared |
| safe-regex2 | 5.1.2 | node_modules/safe-regex2 | fastify | Runtime/shared |
| safe-stable-stringify | 2.5.0 | node_modules/safe-stable-stringify | fastify | Runtime/shared |
| sax | 1.1.4 | node_modules/sax | @capacitor/cli | Development |
| saxes | 6.0.0 | node_modules/saxes | @testing-library/jest-dom, jsdom, vitest | Development |
| scheduler | 0.28.0 | node_modules/scheduler | @tanstack/react-table, @tanstack/react-virtual, @testing-library/react, @tiptap/react, framer-motion, react-dom, react-router-dom | Runtime/shared |
| secure-json-parse | 4.1.1 | node_modules/secure-json-parse | fastify | Runtime/shared |
| semver | 7.8.5 | node_modules/semver | @capacitor/cli, fastify, firebase-admin | Runtime/shared |
| set-cookie-parser | 3.1.3 | node_modules/light-my-request/node_modules/set-cookie-parser | fastify | Runtime/shared |
| set-cookie-parser | 2.7.2 | node_modules/set-cookie-parser | react-router-dom | Runtime/shared |
| shapefile | 0.6.6 | node_modules/shapefile | shapefile | Development |
| shebang-command | 2.0.0 | node_modules/shebang-command | @capacitor/cli, firebase-admin | Runtime/shared |
| shebang-regex | 3.0.0 | node_modules/shebang-regex | @capacitor/cli, firebase-admin | Runtime/shared |
| signal-exit | 4.1.0 | node_modules/foreground-child/node_modules/signal-exit | firebase-admin | Optional platform |
| signal-exit | 3.0.7 | node_modules/signal-exit | @capacitor/cli | Development |
| simple-plist | 1.3.1 | node_modules/simple-plist | @capacitor/cli | Development |
| sisteransi | 1.0.5 | node_modules/sisteransi | @capacitor/cli | Development |
| slice-ansi | 4.0.0 | node_modules/slice-ansi | @capacitor/cli | Development |
| slice-source | 0.4.1 | node_modules/slice-source | shapefile | Development |
| sonic-boom | 4.2.1 | node_modules/sonic-boom | fastify | Runtime/shared |
| source-map-js | 1.2.2 | node_modules/source-map-js | @tailwindcss/postcss, @testing-library/jest-dom, @vitejs/plugin-react, autoprefixer, jsdom, postcss, vite, vitest | Development |
| splaytree | 3.2.3 | node_modules/splaytree | polygon-clipping | Development |
| split2 | 4.2.0 | node_modules/split2 | @capacitor/cli, fastify, node-pg-migrate, pg | Runtime/shared |
| std-env | 4.3.0 | node_modules/std-env | @testing-library/jest-dom, vitest | Development |
| stream-buffers | 2.2.0 | node_modules/stream-buffers | @capacitor/cli | Development |
| stream-events | 1.0.5 | node_modules/stream-events | @google-cloud/storage, firebase-admin | Runtime/shared |
| stream-shift | 1.0.3 | node_modules/stream-shift | @google-cloud/storage, firebase-admin | Runtime/shared |
| stream-source | 0.3.5 | node_modules/stream-source | shapefile | Development |
| string_decoder | 1.3.0 | node_modules/string_decoder | @capacitor/cli, @google-cloud/storage, firebase-admin | Runtime/shared |
| string-width | 5.1.2 | node_modules/@isaacs/cliui/node_modules/string-width | firebase-admin | Optional platform |
| string-width | 7.2.0 | node_modules/node-pg-migrate/node_modules/string-width | node-pg-migrate | Runtime/shared |
| string-width | 4.2.3 | node_modules/string-width | @capacitor/cli, firebase, firebase-admin | Runtime/shared |
| string-width | 4.2.3 | node_modules/string-width-cjs | firebase-admin | Optional platform |
| strip-ansi | 7.2.0 | node_modules/@isaacs/cliui/node_modules/strip-ansi | firebase-admin | Optional platform |
| strip-ansi | 7.2.0 | node_modules/node-pg-migrate/node_modules/strip-ansi | node-pg-migrate | Runtime/shared |
| strip-ansi | 6.0.1 | node_modules/strip-ansi | @capacitor/cli, firebase, firebase-admin | Runtime/shared |
| strip-ansi | 6.0.1 | node_modules/strip-ansi-cjs | firebase-admin | Optional platform |
| strip-indent | 3.0.0 | node_modules/strip-indent | @testing-library/jest-dom | Development |
| strnum | 2.5.1 | node_modules/strnum | @google-cloud/storage, firebase-admin | Runtime/shared |
| stubs | 3.0.0 | node_modules/stubs | @google-cloud/storage, firebase-admin | Runtime/shared |
| tailwind-merge | 3.7.0 | node_modules/tailwind-merge | tailwind-merge | Runtime/shared |
| tailwindcss | 4.3.3 | node_modules/tailwindcss | @tailwindcss/postcss, tailwindcss | Development |
| tapable | 2.3.3 | node_modules/tapable | @tailwindcss/postcss | Development |
| tar | 7.5.22 | node_modules/tar | @capacitor/cli | Development |
| tar-mini | 0.2.0 | node_modules/tar-mini | vite-plugin-compression2 | Development |
| teeny-request | 10.1.4 | node_modules/@google-cloud/firestore-api/node_modules/teeny-request | firebase-admin | Optional platform |
| teeny-request | 11.1.0 | node_modules/teeny-request | @google-cloud/storage, firebase-admin | Runtime/shared |
| tesseract.js | 7.0.0 | node_modules/tesseract.js | tesseract.js | Runtime/shared |
| tesseract.js-core | 7.0.0 | node_modules/tesseract.js-core | tesseract.js | Runtime/shared |
| text-encoding | 0.6.4 | node_modules/text-encoding | shapefile | Development |
| thread-stream | 4.2.0 | node_modules/thread-stream | fastify | Runtime/shared |
| through2 | 4.0.2 | node_modules/through2 | @capacitor/cli | Development |
| tinybench | 6.2.2 | node_modules/tinybench | @testing-library/jest-dom, vitest | Development |
| tinyexec | 1.3.1 | node_modules/tinyexec | @testing-library/jest-dom, vitest | Development |
| tinyglobby | 0.2.17 | node_modules/tinyglobby | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Development |
| tldts | 7.4.18 | node_modules/tldts | @testing-library/jest-dom, jsdom, vitest | Development |
| tldts-core | 7.4.18 | node_modules/tldts-core | @testing-library/jest-dom, jsdom, vitest | Development |
| toad-cache | 3.7.4 | node_modules/toad-cache | @fastify/cors, @fastify/rate-limit, fastify | Runtime/shared |
| tough-cookie | 6.0.2 | node_modules/tough-cookie | @testing-library/jest-dom, jsdom, vitest | Development |
| tr46 | 0.0.3 | node_modules/node-fetch/node_modules/tr46 | tesseract.js | Runtime/shared |
| tr46 | 7.0.0 | node_modules/tr46 | @testing-library/jest-dom, jsdom, vitest | Development |
| tree-kill | 1.2.2 | node_modules/tree-kill | @capacitor/cli | Development |
| tslib | 2.8.1 | node_modules/tslib | @aparajita/capacitor-secure-storage, @capacitor/android, @capacitor/app, @capacitor/browser, @capacitor/cli, @capacitor/core, @capacitor/filesystem, @capacitor/share, @tailwindcss/postcss, @turf/simplify, firebase, firebase-admin, framer-motion | Runtime/shared |
| tsx | 4.23.15 | node_modules/tsx | @testing-library/jest-dom, @vitejs/plugin-react, tsx, vite, vitest | Development |
| typescript | 7.0.2 | node_modules/typescript | @trpc/client, @trpc/server, typescript | Runtime/shared |
| undici | 8.12.1 | node_modules/undici | @testing-library/jest-dom, jsdom, vitest | Development |
| undici-types | 8.9.0 | node_modules/undici-types | @capacitor/cli, @testing-library/jest-dom, @types/node, @types/pg, @vitejs/plugin-react, firebase, firebase-admin, node-pg-migrate, vite, vitest | Runtime/shared |
| universalify | 2.0.1 | node_modules/universalify | @capacitor/cli | Development |
| untildify | 4.0.0 | node_modules/untildify | @capacitor/cli | Development |
| update-browserslist-db | 1.3.4 | node_modules/update-browserslist-db | autoprefixer | Development |
| use-sync-external-store | 1.7.0 | node_modules/use-sync-external-store | @tanstack/react-table, @tiptap/react | Runtime/shared |
| util-deprecate | 1.0.2 | node_modules/util-deprecate | @capacitor/cli, @google-cloud/storage, firebase-admin | Runtime/shared |
| uuid | 14.0.3 | node_modules/uuid | @capacitor/cli | Development |
| vite | 8.3.4 | node_modules/vite | @testing-library/jest-dom, @vitejs/plugin-react, vite, vitest | Development |
| vite-plugin-compression2 | 2.5.3 | node_modules/vite-plugin-compression2 | vite-plugin-compression2 | Development |
| vitest | 5.0.4 | node_modules/vitest | @testing-library/jest-dom, vitest | Development |
| w3c-keyname | 2.2.8 | node_modules/w3c-keyname | @tiptap/core, @tiptap/extension-highlight, @tiptap/extension-table, @tiptap/extension-text-align, @tiptap/extension-text-style, @tiptap/pm, @tiptap/react, @tiptap/starter-kit | Runtime/shared |
| w3c-xmlserializer | 6.0.0 | node_modules/w3c-xmlserializer | @testing-library/jest-dom, jsdom, vitest | Development |
| wasm-feature-detect | 1.9.0 | node_modules/wasm-feature-detect | tesseract.js | Runtime/shared |
| web-streams-polyfill | 3.3.3 | node_modules/web-streams-polyfill | @google-cloud/storage, firebase-admin | Runtime/shared |
| web-vitals | 4.2.4 | node_modules/web-vitals | firebase | Runtime/shared |
| webidl-conversions | 3.0.1 | node_modules/node-fetch/node_modules/webidl-conversions | tesseract.js | Runtime/shared |
| webidl-conversions | 8.0.1 | node_modules/webidl-conversions | @testing-library/jest-dom, jsdom, vitest | Development |
| websocket-driver | 0.7.5 | node_modules/websocket-driver | firebase, firebase-admin | Runtime/shared |
| websocket-extensions | 0.1.4 | node_modules/websocket-extensions | firebase, firebase-admin | Runtime/shared |
| whatwg-mimetype | 5.0.0 | node_modules/whatwg-mimetype | @testing-library/jest-dom, jsdom, vitest | Development |
| whatwg-url | 5.0.0 | node_modules/node-fetch/node_modules/whatwg-url | tesseract.js | Runtime/shared |
| whatwg-url | 17.3.0 | node_modules/whatwg-url | @testing-library/jest-dom, jsdom, vitest | Development |
| which | 2.0.2 | node_modules/which | @capacitor/cli, firebase-admin | Runtime/shared |
| why-is-node-running | 3.2.1 | node_modules/why-is-node-running | @testing-library/jest-dom, vitest | Development |
| wkt-parser | 1.6.0 | node_modules/wkt-parser | proj4 | Development |
| wrap-ansi | 8.1.0 | node_modules/@isaacs/cliui/node_modules/wrap-ansi | firebase-admin | Optional platform |
| wrap-ansi | 9.0.2 | node_modules/node-pg-migrate/node_modules/wrap-ansi | node-pg-migrate | Runtime/shared |
| wrap-ansi | 7.0.0 | node_modules/wrap-ansi | @capacitor/cli, firebase, firebase-admin | Runtime/shared |
| wrap-ansi | 7.0.0 | node_modules/wrap-ansi-cjs | firebase-admin | Optional platform |
| wrappy | 1.0.2 | node_modules/wrappy | @google-cloud/storage, firebase-admin | Runtime/shared |
| xcode | 3.0.1 | node_modules/xcode | @capacitor/cli | Development |
| xlsx | 0.20.3 | node_modules/xlsx | xlsx | Runtime/shared |
| xml-name-validator | 5.0.0 | node_modules/xml-name-validator | @testing-library/jest-dom, jsdom, vitest | Development |
| xml-naming | 0.3.0 | node_modules/xml-naming | @google-cloud/storage, firebase-admin | Runtime/shared |
| xml2js | 0.6.2 | node_modules/xml2js | @capacitor/cli | Development |
| xmlbuilder | 11.0.1 | node_modules/xml2js/node_modules/xmlbuilder | @capacitor/cli | Development |
| xmlbuilder | 15.1.1 | node_modules/xmlbuilder | @capacitor/cli | Development |
| xmlchars | 2.2.0 | node_modules/xmlchars | @testing-library/jest-dom, jsdom, vitest | Development |
| xtend | 4.0.2 | node_modules/xtend | @types/pg, node-pg-migrate, pg | Runtime/shared |
| y18n | 5.0.8 | node_modules/y18n | firebase, firebase-admin, node-pg-migrate | Runtime/shared |
| yallist | 5.0.0 | node_modules/yallist | @capacitor/cli | Development |
| yargs | 18.0.0 | node_modules/node-pg-migrate/node_modules/yargs | node-pg-migrate | Runtime/shared |
| yargs | 17.7.3 | node_modules/yargs | firebase, firebase-admin | Runtime/shared |
| yargs-parser | 22.0.0 | node_modules/node-pg-migrate/node_modules/yargs-parser | node-pg-migrate | Runtime/shared |
| yargs-parser | 21.1.1 | node_modules/yargs-parser | firebase, firebase-admin | Runtime/shared |
| yauzl | 2.10.0 | node_modules/yauzl | @capacitor/cli | Development |
| yocto-queue | 0.1.0 | node_modules/yocto-queue | @google-cloud/storage, firebase-admin | Runtime/shared |
| zlibjs | 0.3.1 | node_modules/zlibjs | tesseract.js | Runtime/shared |
| zod | 4.6.7 | node_modules/zod | zod | Runtime/shared |
