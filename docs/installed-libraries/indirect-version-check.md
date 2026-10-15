# Indirect Version Checks

All resolved lockfile entries, including optional platform packages, checked against npm latest tags. The version selected by an upstream library may be older than the registry latest major. Compatible updates have been applied with npm update; incompatible major versions require that upstream library to change its dependency contract. SheetJS follows its vendor distribution.

| Library | Resolved | Registry latest | Result |
| --- | --- | --- | --- |
| @adobe/css-tools | 4.5.0 | 4.5.0 | Latest |
| @alloc/quick-lru | 5.3.0 | 5.3.0 | Latest |
| @aparajita/capacitor-secure-storage | 8.0.1 | 8.0.1 | Latest |
| @asamuzakjp/css-color | 7.1.5 | 7.1.5 | Latest |
| @asamuzakjp/dom-selector | 9.2.4 | 10.0.3 | Upstream dependency constraint; compatible updates applied |
| @babel/code-frame | 7.29.7 | 8.0.6 | Upstream dependency constraint; compatible updates applied |
| @babel/helper-validator-identifier | 7.29.7 | 8.0.6 | Upstream dependency constraint; compatible updates applied |
| @babel/runtime | 7.29.10 | 8.0.7 | Upstream dependency constraint; compatible updates applied |
| @bramus/specificity | 2.4.3 | 2.4.3 | Latest |
| @capacitor/android | 8.5.3 | 8.5.3 | Latest |
| @capacitor/app | 8.1.2 | 8.1.2 | Latest |
| @capacitor/browser | 8.0.5 | 8.0.5 | Latest |
| @capacitor/cli | 8.5.3 | 8.5.3 | Latest |
| @capacitor/core | 8.5.3 | 8.5.3 | Latest |
| @capacitor/filesystem | 8.1.4 | 8.1.4 | Latest |
| @capacitor/ios | 8.5.3 | 8.5.3 | Latest |
| @capacitor/keyboard | 8.0.6 | 8.0.6 | Latest |
| @capacitor/share | 8.0.3 | 8.0.3 | Latest |
| @capacitor/synapse | 1.0.4 | 1.0.4 | Latest |
| @csstools/color-helpers | 6.1.2 | 6.1.2 | Latest |
| @csstools/css-calc | 3.4.3 | 3.4.3 | Latest |
| @csstools/css-color-parser | 4.2.6 | 4.2.6 | Latest |
| @csstools/css-parser-algorithms | 4.0.2 | 4.0.2 | Latest |
| @csstools/css-syntax-patches-for-csstree | 1.1.15 | 1.1.15 | Latest |
| @csstools/css-tokenizer | 4.0.2 | 4.0.2 | Latest |
| @esbuild/aix-ppc64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/android-arm | 0.28.2 | 0.28.2 | Latest |
| @esbuild/android-arm64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/android-x64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/darwin-arm64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/darwin-x64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/freebsd-arm64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/freebsd-x64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-arm | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-arm64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-ia32 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-loong64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-mips64el | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-ppc64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-riscv64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-s390x | 0.28.2 | 0.28.2 | Latest |
| @esbuild/linux-x64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/netbsd-arm64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/netbsd-x64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/openbsd-arm64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/openbsd-x64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/openharmony-arm64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/sunos-x64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/win32-arm64 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/win32-ia32 | 0.28.2 | 0.28.2 | Latest |
| @esbuild/win32-x64 | 0.28.2 | 0.28.2 | Latest |
| @exodus/bytes | 1.16.0 | 1.16.0 | Latest |
| @fastify/ajv-compiler | 4.0.7 | 4.0.7 | Latest |
| @fastify/busboy | 3.2.3 | 3.2.3 | Latest |
| @fastify/cors | 11.3.1 | 11.3.1 | Latest |
| @fastify/deepmerge | 3.2.2 | 3.2.2 | Latest |
| @fastify/error | 4.2.1 | 4.2.1 | Latest |
| @fastify/fast-json-stringify-compiler | 5.1.1 | 5.1.1 | Latest |
| @fastify/forwarded | 3.1.1 | 3.1.1 | Latest |
| @fastify/merge-json-schemas | 0.2.2 | 0.2.2 | Latest |
| @fastify/proxy-addr | 5.1.2 | 5.1.2 | Latest |
| @fastify/rate-limit | 11.2.1 | 11.2.1 | Latest |
| @firebase/ai | 3.0.0 | 3.0.0 | Latest |
| @firebase/analytics | 0.10.25 | 0.10.25 | Latest |
| @firebase/analytics-compat | 0.2.31 | 0.2.31 | Latest |
| @firebase/analytics-types | 0.8.5 | 0.8.5 | Latest |
| @firebase/app | 0.16.3 | 0.16.3 | Latest |
| @firebase/app-check | 0.13.1 | 0.13.1 | Latest |
| @firebase/app-check-compat | 0.4.7 | 0.4.7 | Latest |
| @firebase/app-check-interop-types | 0.3.5 | 0.3.5 | Latest |
| @firebase/app-check-types | 0.5.5 | 0.5.5 | Latest |
| @firebase/app-compat | 0.5.19 | 0.5.19 | Latest |
| @firebase/app-types | 0.9.6 | 0.9.6 | Latest |
| @firebase/auth | 1.13.7 | 1.13.7 | Latest |
| @firebase/auth-compat | 0.6.12 | 0.6.12 | Latest |
| @firebase/auth-interop-types | 0.2.6 | 0.2.6 | Latest |
| @firebase/auth-types | 0.13.2 | 0.13.2 | Latest |
| @firebase/component | 0.7.5 | 0.7.5 | Latest |
| @firebase/data-connect | 0.7.4 | 0.7.4 | Latest |
| @firebase/database | 1.1.5 | 1.1.5 | Latest |
| @firebase/database-compat | 2.1.7 | 2.1.7 | Latest |
| @firebase/database-types | 1.0.22 | 1.0.22 | Latest |
| @firebase/firestore | 4.18.0 | 4.18.0 | Latest |
| @firebase/firestore-compat | 0.4.15 | 0.4.15 | Latest |
| @firebase/firestore-types | 3.0.5 | 3.0.5 | Latest |
| @firebase/functions | 0.14.0 | 0.14.0 | Latest |
| @firebase/functions-compat | 0.5.0 | 0.5.0 | Latest |
| @firebase/functions-types | 0.6.5 | 0.6.5 | Latest |
| @firebase/installations | 0.6.24 | 0.6.24 | Latest |
| @firebase/installations-compat | 0.2.24 | 0.2.24 | Latest |
| @firebase/installations-types | 0.5.5 | 0.5.5 | Latest |
| @firebase/logger | 0.5.2 | 0.5.2 | Latest |
| @firebase/messaging | 0.13.3 | 0.13.3 | Latest |
| @firebase/messaging-compat | 0.2.30 | 0.2.30 | Latest |
| @firebase/messaging-interop-types | 0.2.6 | 0.2.6 | Latest |
| @firebase/performance | 0.7.14 | 0.7.14 | Latest |
| @firebase/performance-compat | 0.2.27 | 0.2.27 | Latest |
| @firebase/performance-types | 0.2.5 | 0.2.5 | Latest |
| @firebase/remote-config | 0.9.3 | 0.9.3 | Latest |
| @firebase/remote-config-compat | 0.2.30 | 0.2.30 | Latest |
| @firebase/remote-config-types | 0.5.2 | 0.5.2 | Latest |
| @firebase/storage | 0.14.6 | 0.14.6 | Latest |
| @firebase/storage-compat | 0.4.6 | 0.4.6 | Latest |
| @firebase/storage-types | 0.8.5 | 0.8.5 | Latest |
| @firebase/util | 1.15.3 | 1.15.3 | Latest |
| @firebase/webchannel-wrapper | 1.0.7 | 1.0.7 | Latest |
| @floating-ui/core | 1.8.0 | 1.8.0 | Latest |
| @floating-ui/dom | 1.8.0 | 1.8.0 | Latest |
| @floating-ui/utils | 0.2.12 | 0.2.12 | Latest |
| @goms/api | 0.1.0 | Local | Internal workspace |
| @goms/domain | 0.1.0 | 0.1.0 | Internal workspace |
| @google-cloud/firestore | 9.3.1 | 9.3.1 | Latest |
| @google-cloud/firestore-api | 0.2.0 | 0.7.0 | Upstream dependency constraint; compatible updates applied |
| @google-cloud/paginator | 7.2.0 | 7.2.0 | Latest |
| @google-cloud/projectify | 6.2.0 | 6.2.0 | Latest |
| @google-cloud/promisify | 6.2.0 | 6.2.0 | Latest |
| @google-cloud/storage | 8.4.0 | 8.4.0 | Latest |
| @grpc/grpc-js | 1.14.6 | 1.14.6 | Latest |
| @grpc/proto-loader | 0.8.1 | 0.8.1 | Latest |
| @grpc/proto-loader | 0.8.1 | 0.8.1 | Latest |
| @grpc/proto-loader | 0.7.15 | 0.8.1 | Upstream dependency constraint; compatible updates applied |
| @grpc/proto-loader | 0.8.1 | 0.8.1 | Latest |
| @ionic/cli-framework-output | 2.2.8 | 2.2.8 | Latest |
| @ionic/utils-array | 2.1.6 | 2.1.6 | Latest |
| @ionic/utils-fs | 3.1.7 | 3.1.7 | Latest |
| @ionic/utils-object | 2.1.6 | 2.1.6 | Latest |
| @ionic/utils-process | 2.1.12 | 2.1.12 | Latest |
| @ionic/utils-stream | 3.1.7 | 3.1.7 | Latest |
| @ionic/utils-subprocess | 3.0.1 | 3.0.1 | Latest |
| @ionic/utils-terminal | 2.3.5 | 2.3.5 | Latest |
| @isaacs/cliui | 8.0.2 | 9.0.0 | Upstream dependency constraint; compatible updates applied |
| @isaacs/fs-minipass | 4.0.1 | 4.0.1 | Latest |
| @jridgewell/gen-mapping | 0.3.13 | 0.3.13 | Latest |
| @jridgewell/remapping | 2.3.5 | 2.3.5 | Latest |
| @jridgewell/resolve-uri | 3.1.2 | 3.1.2 | Latest |
| @jridgewell/sourcemap-codec | 1.6.0 | 1.6.0 | Latest |
| @jridgewell/trace-mapping | 0.3.31 | 0.3.31 | Latest |
| @js-sdsl/ordered-map | 4.4.2 | 4.4.2 | Latest |
| @lukeed/ms | 2.0.2 | 2.0.2 | Latest |
| @nodable/entities | 3.1.0 | 3.1.0 | Latest |
| @opentelemetry/api | 1.9.1 | 1.9.1 | Latest |
| @oxc-project/types | 0.154.0 | 0.154.0 | Latest |
| @pinojs/redact | 0.4.0 | 0.4.0 | Latest |
| @pkgjs/parseargs | 0.11.0 | 0.11.0 | Latest |
| @playwright/test | 1.64.1 | 1.64.1 | Latest |
| @protobufjs/aspromise | 1.1.2 | 1.1.2 | Latest |
| @protobufjs/base64 | 1.1.2 | 1.1.2 | Latest |
| @protobufjs/codegen | 2.0.5 | 2.0.5 | Latest |
| @protobufjs/eventemitter | 1.1.1 | 1.1.1 | Latest |
| @protobufjs/fetch | 1.1.1 | 1.1.1 | Latest |
| @protobufjs/float | 1.0.2 | 1.0.2 | Latest |
| @protobufjs/path | 1.1.2 | 1.1.2 | Latest |
| @protobufjs/pool | 1.1.0 | 1.1.0 | Latest |
| @protobufjs/utf8 | 1.1.2 | 1.1.2 | Latest |
| @rolldown/binding-android-arm-eabi | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-android-arm64 | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-darwin-arm64 | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-darwin-x64 | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-freebsd-x64 | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-linux-arm64-gnu | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-linux-arm64-musl | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-linux-ppc64-gnu | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-linux-s390x-gnu | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-linux-x64-gnu | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-linux-x64-musl | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-openharmony-arm64 | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-win32-arm64-msvc | 1.2.14 | 1.2.14 | Latest |
| @rolldown/binding-win32-x64-msvc | 1.2.14 | 1.2.14 | Latest |
| @rolldown/pluginutils | 1.0.1 | 1.0.1 | Latest |
| @rollup/pluginutils | 5.4.0 | 5.4.0 | Latest |
| @tailwindcss/node | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-android-arm64 | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-darwin-arm64 | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-darwin-x64 | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-freebsd-x64 | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-linux-arm-gnueabihf | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-linux-arm64-gnu | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-linux-arm64-musl | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-linux-x64-gnu | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-linux-x64-musl | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-wasm32-wasi | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-win32-arm64-msvc | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/oxide-win32-x64-msvc | 4.3.3 | 4.3.3 | Latest |
| @tailwindcss/postcss | 4.3.3 | 4.3.3 | Latest |
| @tanstack/query-core | 5.104.2 | 5.104.2 | Latest |
| @tanstack/react-query | 5.104.2 | 5.104.2 | Latest |
| @tanstack/react-store | 0.11.2 | 0.11.2 | Latest |
| @tanstack/react-table | 9.3.1 | 9.3.1 | Latest |
| @tanstack/react-virtual | 3.14.19 | 3.14.19 | Latest |
| @tanstack/store | 0.11.2 | 0.11.2 | Latest |
| @tanstack/table-core | 9.3.1 | 9.3.1 | Latest |
| @tanstack/virtual-core | 3.19.4 | 3.19.4 | Latest |
| @testing-library/dom | 10.4.2 | 10.4.2 | Latest |
| @testing-library/jest-dom | 7.0.1 | 7.0.1 | Latest |
| @testing-library/react | 16.3.3 | 16.3.3 | Latest |
| @testing-library/user-event | 14.6.8 | 14.6.8 | Latest |
| @tiptap/core | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-blockquote | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-bold | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-bubble-menu | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-bullet-list | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-code | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-code-block | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-document | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-dropcursor | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-floating-menu | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-gapcursor | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-hard-break | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-heading | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-highlight | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-horizontal-rule | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-italic | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-link | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-list | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-list-item | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-list-keymap | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-ordered-list | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-paragraph | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-strike | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-table | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-text | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-text-align | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-text-style | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extension-underline | 3.32.0 | 3.32.0 | Latest |
| @tiptap/extensions | 3.32.0 | 3.32.0 | Latest |
| @tiptap/pm | 3.32.0 | 3.32.0 | Latest |
| @tiptap/react | 3.32.0 | 3.32.0 | Latest |
| @tiptap/starter-kit | 3.32.0 | 3.32.0 | Latest |
| @trpc/client | 11.19.0 | 11.19.0 | Latest |
| @trpc/server | 11.19.0 | 11.19.0 | Latest |
| @turf/boolean-point-on-line | 7.4.0 | 7.4.0 | Latest |
| @turf/clean-coords | 7.4.0 | 7.4.0 | Latest |
| @turf/clone | 7.4.0 | 7.4.0 | Latest |
| @turf/helpers | 7.4.0 | 7.4.0 | Latest |
| @turf/invariant | 7.4.0 | 7.4.0 | Latest |
| @turf/meta | 7.4.0 | 7.4.0 | Latest |
| @turf/simplify | 7.4.0 | 7.4.0 | Latest |
| @types/aria-query | 5.0.4 | 5.0.4 | Latest |
| @types/chai | 5.2.3 | 5.2.3 | Latest |
| @types/d3-geo | 3.1.1 | 3.1.1 | Latest |
| @types/deep-eql | 4.0.2 | 4.0.2 | Latest |
| @types/estree | 1.0.9 | 1.0.9 | Latest |
| @types/fs-extra | 8.1.5 | 11.0.4 | Upstream dependency constraint; compatible updates applied |
| @types/geojson | 7946.0.16 | 7946.0.16 | Latest |
| @types/jsonwebtoken | 9.0.10 | 9.0.10 | Latest |
| @types/ms | 2.1.0 | 2.1.0 | Latest |
| @types/node | 26.6.5 | 26.6.5 | Latest |
| @types/pg | 8.23.1 | 8.23.1 | Latest |
| @types/react | 19.3.0 | 19.3.0 | Latest |
| @types/react-dom | 19.3.0 | 19.3.0 | Latest |
| @types/slice-ansi | 4.0.0 | 7.1.0 | Upstream dependency constraint; compatible updates applied |
| @types/use-sync-external-store | 0.0.6 | 1.7.0 | Upstream dependency constraint; compatible updates applied |
| @typescript/typescript-aix-ppc64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-darwin-arm64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-darwin-x64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-freebsd-arm64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-freebsd-x64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-linux-arm | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-linux-arm64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-linux-loong64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-linux-mips64el | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-linux-ppc64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-linux-riscv64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-linux-s390x | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-linux-x64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-netbsd-arm64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-netbsd-x64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-openbsd-arm64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-openbsd-x64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-sunos-x64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-win32-arm64 | 7.0.2 | 7.0.2 | Latest |
| @typescript/typescript-win32-x64 | 7.0.2 | 7.0.2 | Latest |
| @vitejs/plugin-react | 6.1.2 | 6.1.2 | Latest |
| @vitest/mocker | 5.0.4 | 5.0.4 | Latest |
| @vitest/spy | 5.0.4 | 5.0.4 | Latest |
| @xmldom/xmldom | 0.9.12 | 0.9.12 | Latest |
| 7zip-bin | 5.1.1 | 5.2.0 | Upstream dependency constraint; compatible updates applied |
| 7zip-min | 3.0.1 | 3.0.1 | Latest |
| abort-controller | 3.0.0 | 3.0.0 | Latest |
| abstract-logging | 2.0.1 | 2.0.1 | Latest |
| agent-base | 7.1.4 | 9.0.0 | Upstream dependency constraint; compatible updates applied |
| ajv | 8.20.0 | 8.20.0 | Latest |
| ajv-formats | 3.0.1 | 3.0.1 | Latest |
| ansi-regex | 6.4.0 | 6.4.0 | Latest |
| ansi-regex | 5.0.1 | 6.4.0 | Upstream dependency constraint; compatible updates applied |
| ansi-regex | 6.4.0 | 6.4.0 | Latest |
| ansi-styles | 6.2.3 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| ansi-styles | 5.2.0 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| ansi-styles | 6.2.3 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| ansi-styles | 4.3.0 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| ansi-styles | 4.3.0 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| ansi-styles | 4.3.0 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| anynum | 1.0.1 | 1.0.1 | Latest |
| aria-query | 5.3.0 | 5.3.2 | Upstream dependency constraint; compatible updates applied |
| array-source | 0.0.4 | 0.0.4 | Latest |
| assertion-error | 2.0.1 | 2.0.1 | Latest |
| astral-regex | 2.0.0 | 2.0.0 | Latest |
| async-retry | 1.3.3 | 1.3.3 | Latest |
| at-least-node | 1.0.0 | 1.0.0 | Latest |
| atomic-sleep | 1.0.0 | 1.0.0 | Latest |
| autoprefixer | 10.6.1 | 10.6.1 | Latest |
| avvio | 9.3.1 | 9.3.1 | Latest |
| balanced-match | 1.0.2 | 4.0.4 | Upstream dependency constraint; compatible updates applied |
| balanced-match | 4.0.4 | 4.0.4 | Latest |
| base64-js | 1.5.1 | 1.5.1 | Latest |
| baseline-browser-mapping | 2.11.28 | 2.11.28 | Latest |
| bidi-js | 1.1.0 | 1.1.0 | Latest |
| big-integer | 1.6.52 | 1.6.52 | Latest |
| bignumber.js | 9.3.1 | 11.1.5 | Upstream dependency constraint; compatible updates applied |
| bmp-js | 0.1.0 | 0.1.0 | Latest |
| bplist-creator | 0.1.0 | 0.3.0 | Upstream dependency constraint; compatible updates applied |
| bplist-parser | 0.3.2 | 0.5.0 | Upstream dependency constraint; compatible updates applied |
| bplist-parser | 0.3.1 | 0.5.0 | Upstream dependency constraint; compatible updates applied |
| brace-expansion | 2.1.7 | 5.0.12 | Upstream dependency constraint; compatible updates applied |
| brace-expansion | 5.0.12 | 5.0.12 | Latest |
| browserslist | 4.29.3 | 4.29.3 | Latest |
| buffer-crc32 | 0.2.13 | 1.0.0 | Upstream dependency constraint; compatible updates applied |
| buffer-equal-constant-time | 1.0.1 | 1.0.1 | Latest |
| caniuse-lite | 1.0.30001816 | 1.0.30001816 | Latest |
| chai | 6.3.0 | 6.3.0 | Latest |
| chownr | 3.0.0 | 3.0.0 | Latest |
| cliui | 8.0.1 | 9.0.1 | Upstream dependency constraint; compatible updates applied |
| cliui | 9.0.1 | 9.0.1 | Latest |
| clsx | 2.1.1 | 2.1.1 | Latest |
| color-convert | 2.0.1 | 3.1.3 | Upstream dependency constraint; compatible updates applied |
| color-name | 1.1.4 | 2.1.1 | Upstream dependency constraint; compatible updates applied |
| commander | 12.1.0 | 15.0.0 | Upstream dependency constraint; compatible updates applied |
| commander | 2.20.3 | 15.0.0 | Upstream dependency constraint; compatible updates applied |
| cookie | 1.1.1 | 2.0.1 | Upstream dependency constraint; compatible updates applied |
| cookie | 2.0.1 | 2.0.1 | Latest |
| cross-spawn | 7.0.6 | 7.0.6 | Latest |
| css-tree | 3.2.1 | 3.2.1 | Latest |
| css.escape | 1.5.1 | 1.5.1 | Latest |
| csstype | 3.2.3 | 3.2.3 | Latest |
| d3-array | 3.2.4 | 3.2.4 | Latest |
| d3-geo | 3.1.1 | 3.1.1 | Latest |
| data-uri-to-buffer | 4.0.1 | 8.0.0 | Upstream dependency constraint; compatible updates applied |
| data-urls | 8.0.0 | 8.0.0 | Latest |
| debug | 4.4.3 | 4.4.3 | Latest |
| decimal.js | 10.6.0 | 10.6.0 | Latest |
| define-lazy-prop | 2.0.0 | 3.0.0 | Upstream dependency constraint; compatible updates applied |
| dequal | 2.0.3 | 2.0.3 | Latest |
| detect-libc | 2.1.2 | 2.1.2 | Latest |
| dom-accessibility-api | 0.6.3 | 0.7.1 | Upstream dependency constraint; compatible updates applied |
| dom-accessibility-api | 0.5.16 | 0.7.1 | Upstream dependency constraint; compatible updates applied |
| duplexify | 4.1.3 | 4.1.3 | Latest |
| eastasianwidth | 0.2.0 | 0.3.0 | Upstream dependency constraint; compatible updates applied |
| ecdsa-sig-formatter | 1.0.11 | 1.0.11 | Latest |
| electron-to-chromium | 1.5.456 | 1.5.456 | Latest |
| elementtree | 0.1.7 | 0.1.7 | Latest |
| emoji-regex | 9.2.2 | 11.0.0 | Upstream dependency constraint; compatible updates applied |
| emoji-regex | 8.0.0 | 11.0.0 | Upstream dependency constraint; compatible updates applied |
| emoji-regex | 10.6.0 | 11.0.0 | Upstream dependency constraint; compatible updates applied |
| end-of-stream | 1.4.5 | 1.4.5 | Latest |
| enhanced-resolve | 5.26.0 | 5.26.0 | Latest |
| entities | 8.1.0 | 8.1.0 | Latest |
| env-paths | 2.2.1 | 4.0.0 | Upstream dependency constraint; compatible updates applied |
| es-module-lexer | 2.3.2 | 3.0.4 | Upstream dependency constraint; compatible updates applied |
| esbuild | 0.28.2 | 0.28.2 | Latest |
| escalade | 3.2.0 | 3.2.0 | Latest |
| estree-walker | 3.0.3 | 3.0.3 | Latest |
| estree-walker | 2.0.2 | 3.0.3 | Upstream dependency constraint; compatible updates applied |
| event-target-shim | 5.0.1 | 6.0.2 | Upstream dependency constraint; compatible updates applied |
| expect-type | 1.4.0 | 1.4.0 | Latest |
| extend | 3.0.2 | 3.0.2 | Latest |
| fast-decode-uri-component | 1.0.1 | 1.0.1 | Latest |
| fast-deep-equal | 3.1.3 | 3.1.3 | Latest |
| fast-equals | 5.4.5 | 6.2.1 | Upstream dependency constraint; compatible updates applied |
| fast-json-stringify | 7.1.0 | 7.1.0 | Latest |
| fast-querystring | 1.1.2 | 1.1.2 | Latest |
| fast-uri | 3.1.8 | 4.2.2 | Upstream dependency constraint; compatible updates applied |
| fast-uri | 4.2.2 | 4.2.2 | Latest |
| fast-xml-builder | 1.3.1 | 1.3.1 | Latest |
| fast-xml-parser | 5.11.2 | 5.11.2 | Latest |
| fastify | 5.12.7 | 5.12.7 | Latest |
| fastify-plugin | 6.0.1 | 6.0.1 | Latest |
| fastq | 1.20.3 | 1.20.3 | Latest |
| faye-websocket | 0.11.4 | 0.11.4 | Latest |
| fd-slicer | 1.1.0 | 1.1.0 | Latest |
| fdir | 6.5.0 | 6.5.0 | Latest |
| fetch-blob | 3.2.0 | 4.0.0 | Upstream dependency constraint; compatible updates applied |
| file-source | 0.6.1 | 0.6.1 | Latest |
| find-my-way | 9.10.0 | 9.10.0 | Latest |
| firebase | 13.0.0 | 13.0.0 | Latest |
| firebase-admin | 14.5.0 | 14.5.0 | Latest |
| foreground-child | 3.3.1 | 4.0.3 | Upstream dependency constraint; compatible updates applied |
| formdata-polyfill | 4.0.10 | 4.0.10 | Latest |
| fraction.js | 5.3.4 | 5.3.4 | Latest |
| framer-motion | 14.2.0 | 14.2.0 | Latest |
| fs-extra | 9.1.0 | 11.4.1 | Upstream dependency constraint; compatible updates applied |
| fs-extra | 11.4.1 | 11.4.1 | Latest |
| fsevents | 2.3.3 | 2.3.3 | Latest |
| functional-red-black-tree | 1.0.1 | 1.0.1 | Latest |
| gaxios | 7.1.3 | 8.3.0 | Upstream dependency constraint; compatible updates applied |
| gaxios | 7.3.1 | 8.3.0 | Upstream dependency constraint; compatible updates applied |
| gcp-metadata | 8.1.4 | 9.2.0 | Upstream dependency constraint; compatible updates applied |
| gcp-metadata | 9.2.0 | 9.2.0 | Latest |
| get-caller-file | 2.0.5 | 2.0.5 | Latest |
| get-east-asian-width | 1.7.0 | 1.7.0 | Latest |
| glob | 10.5.0 | 13.0.6 | Upstream dependency constraint; compatible updates applied |
| glob | 13.0.6 | 13.0.6 | Latest |
| google-auth-library | 10.5.0 | 11.3.0 | Upstream dependency constraint; compatible updates applied |
| google-auth-library | 11.3.0 | 11.3.0 | Latest |
| google-gax | 5.0.8 | 6.12.1 | Upstream dependency constraint; compatible updates applied |
| google-gax | 6.12.1 | 6.12.1 | Latest |
| google-logging-utils | 1.1.3 | 2.1.0 | Upstream dependency constraint; compatible updates applied |
| google-logging-utils | 2.1.0 | 2.1.0 | Latest |
| graceful-fs | 4.2.11 | 4.2.11 | Latest |
| gtoken | 8.0.0 | 8.0.0 | Latest |
| html-encoding-sniffer | 7.0.0 | 7.0.0 | Latest |
| html-entities | 2.6.0 | 2.6.0 | Latest |
| http-parser-js | 0.5.10 | 0.5.10 | Latest |
| http-proxy-agent | 7.0.2 | 9.1.0 | Upstream dependency constraint; compatible updates applied |
| https-proxy-agent | 7.0.6 | 9.1.0 | Upstream dependency constraint; compatible updates applied |
| idb | 7.1.1 | 8.0.4 | Upstream dependency constraint; compatible updates applied |
| idb-keyval | 6.3.0 | 6.3.0 | Latest |
| indent-string | 4.0.0 | 5.0.0 | Upstream dependency constraint; compatible updates applied |
| inherits | 2.0.4 | 2.0.4 | Latest |
| ini | 4.1.3 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| internmap | 2.0.3 | 2.0.3 | Latest |
| ip-address | 10.7.4 | 10.7.4 | Latest |
| ipaddr.js | 2.5.0 | 2.5.0 | Latest |
| is-docker | 2.2.1 | 4.0.0 | Upstream dependency constraint; compatible updates applied |
| is-fullwidth-code-point | 3.0.0 | 5.1.0 | Upstream dependency constraint; compatible updates applied |
| is-potential-custom-element-name | 1.0.1 | 1.0.1 | Latest |
| is-unsafe | 2.0.2 | 2.0.2 | Latest |
| is-url | 1.2.4 | 1.2.4 | Latest |
| is-wsl | 2.2.0 | 3.1.1 | Upstream dependency constraint; compatible updates applied |
| isexe | 2.0.0 | 4.0.0 | Upstream dependency constraint; compatible updates applied |
| jackspeak | 3.4.3 | 4.2.3 | Upstream dependency constraint; compatible updates applied |
| jiti | 2.7.0 | 2.7.0 | Latest |
| jose | 6.2.12 | 6.2.12 | Latest |
| js-tokens | 4.0.0 | 10.0.0 | Upstream dependency constraint; compatible updates applied |
| jsdom | 30.1.2 | 30.1.2 | Latest |
| json-bigint | 1.0.0 | 1.0.0 | Latest |
| json-schema-ref-resolver | 3.0.1 | 3.0.1 | Latest |
| json-schema-traverse | 1.0.0 | 1.0.0 | Latest |
| jsonfile | 6.2.1 | 6.2.1 | Latest |
| jsonwebtoken | 9.0.3 | 9.0.3 | Latest |
| jwa | 2.0.1 | 2.0.1 | Latest |
| jwks-rsa | 4.1.0 | 4.1.0 | Latest |
| jws | 4.0.1 | 4.0.1 | Latest |
| kleur | 4.1.5 | 4.1.5 | Latest |
| kleur | 3.0.3 | 4.1.5 | Upstream dependency constraint; compatible updates applied |
| light-my-request | 6.8.0 | 6.8.0 | Latest |
| lightningcss | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss | 1.33.0 | 1.33.0 | Latest |
| lightningcss-android-arm64 | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-android-arm64 | 1.33.0 | 1.33.0 | Latest |
| lightningcss-darwin-arm64 | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-darwin-arm64 | 1.33.0 | 1.33.0 | Latest |
| lightningcss-darwin-x64 | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-darwin-x64 | 1.33.0 | 1.33.0 | Latest |
| lightningcss-freebsd-x64 | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-freebsd-x64 | 1.33.0 | 1.33.0 | Latest |
| lightningcss-linux-arm-gnueabihf | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | 1.33.0 | Latest |
| lightningcss-linux-arm64-gnu | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-linux-arm64-gnu | 1.33.0 | 1.33.0 | Latest |
| lightningcss-linux-arm64-musl | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-linux-arm64-musl | 1.33.0 | 1.33.0 | Latest |
| lightningcss-linux-x64-gnu | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-linux-x64-gnu | 1.33.0 | 1.33.0 | Latest |
| lightningcss-linux-x64-musl | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-linux-x64-musl | 1.33.0 | 1.33.0 | Latest |
| lightningcss-win32-arm64-msvc | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-win32-arm64-msvc | 1.33.0 | 1.33.0 | Latest |
| lightningcss-win32-x64-msvc | 1.32.0 | 1.33.0 | Upstream dependency constraint; compatible updates applied |
| lightningcss-win32-x64-msvc | 1.33.0 | 1.33.0 | Latest |
| limiter | 1.1.5 | 4.1.0 | Upstream dependency constraint; compatible updates applied |
| linkifyjs | 4.3.3 | 4.3.3 | Latest |
| lodash.camelcase | 4.3.0 | 4.3.0 | Latest |
| lodash.clonedeep | 4.5.0 | 4.5.0 | Latest |
| lodash.includes | 4.3.0 | 4.3.0 | Latest |
| lodash.isboolean | 3.0.3 | 3.0.3 | Latest |
| lodash.isinteger | 4.0.4 | 4.0.4 | Latest |
| lodash.isnumber | 3.0.3 | 3.0.3 | Latest |
| lodash.isplainobject | 4.0.6 | 4.0.6 | Latest |
| lodash.isstring | 4.0.1 | 4.0.1 | Latest |
| lodash.once | 4.1.1 | 4.1.1 | Latest |
| long | 5.3.2 | 5.3.2 | Latest |
| lru-cache | 10.4.3 | 11.5.3 | Upstream dependency constraint; compatible updates applied |
| lru-cache | 11.5.3 | 11.5.3 | Latest |
| lru-memoizer | 3.0.0 | 3.0.0 | Latest |
| lucide-react | 1.57.0 | 1.57.0 | Latest |
| lz-string | 1.5.0 | 1.5.0 | Latest |
| magic-string | 1.4.3 | 1.4.3 | Latest |
| magic-string | 0.30.21 | 1.4.3 | Upstream dependency constraint; compatible updates applied |
| magic-string | 1.4.3 | 1.4.3 | Latest |
| mdn-data | 2.27.1 | 2.37.2 | Upstream dependency constraint; compatible updates applied |
| mgrs | 1.0.0 | 2.2.0 | Upstream dependency constraint; compatible updates applied |
| mime | 3.0.0 | 4.1.1 | Upstream dependency constraint; compatible updates applied |
| min-indent | 1.0.1 | 1.0.1 | Latest |
| minimatch | 9.0.9 | 10.2.6 | Upstream dependency constraint; compatible updates applied |
| minimatch | 10.2.6 | 10.2.6 | Latest |
| minipass | 7.1.3 | 7.1.3 | Latest |
| minizlib | 3.1.0 | 3.1.0 | Latest |
| motion-dom | 14.2.0 | 14.2.0 | Latest |
| motion-utils | 14.1.1 | 14.1.1 | Latest |
| ms | 2.1.3 | 2.1.3 | Latest |
| nanoid | 3.3.20 | 6.0.2 | Upstream dependency constraint; compatible updates applied |
| native-run | 2.0.3 | 2.0.3 | Latest |
| node-domexception | 1.0.0 | 2.0.2 | Upstream dependency constraint; compatible updates applied |
| node-fetch | 3.3.2 | 3.3.2 | Latest |
| node-fetch | 3.3.2 | 3.3.2 | Latest |
| node-fetch | 3.3.2 | 3.3.2 | Latest |
| node-fetch | 2.7.0 | 3.3.2 | Upstream dependency constraint; compatible updates applied |
| node-fetch | 3.3.2 | 3.3.2 | Latest |
| node-pg-migrate | 9.0.0 | 9.0.0 | Latest |
| node-releases | 2.0.58 | 2.0.58 | Latest |
| object-hash | 3.0.0 | 3.0.0 | Latest |
| obug | 3.0.0 | 3.0.0 | Latest |
| on-exit-leak-free | 2.1.2 | 2.1.2 | Latest |
| once | 1.4.0 | 1.4.0 | Latest |
| open | 8.4.2 | 11.0.4 | Upstream dependency constraint; compatible updates applied |
| opencollective-postinstall | 2.0.3 | 2.0.3 | Latest |
| orderedmap | 2.1.1 | 2.1.1 | Latest |
| p-limit | 3.1.0 | 7.3.3 | Upstream dependency constraint; compatible updates applied |
| package-json-from-dist | 1.0.1 | 1.0.1 | Latest |
| parse5 | 8.0.1 | 8.0.1 | Latest |
| path-expression-matcher | 1.6.2 | 1.6.2 | Latest |
| path-key | 3.1.1 | 4.0.0 | Upstream dependency constraint; compatible updates applied |
| path-scurry | 1.11.1 | 2.0.2 | Upstream dependency constraint; compatible updates applied |
| path-scurry | 2.0.2 | 2.0.2 | Latest |
| path-source | 0.1.3 | 0.1.3 | Latest |
| pend | 1.2.0 | 1.2.0 | Latest |
| pg | 8.23.1 | 8.23.1 | Latest |
| pg-cloudflare | 1.4.1 | 1.4.1 | Latest |
| pg-connection-string | 2.14.1 | 2.14.1 | Latest |
| pg-int8 | 1.0.1 | 1.0.1 | Latest |
| pg-pool | 3.14.0 | 3.14.0 | Latest |
| pg-protocol | 1.16.1 | 1.16.1 | Latest |
| pg-types | 2.2.0 | 4.1.0 | Upstream dependency constraint; compatible updates applied |
| pgpass | 1.0.5 | 1.0.6 | Upstream dependency constraint; compatible updates applied |
| picocolors | 1.1.1 | 1.1.1 | Latest |
| picomatch | 4.0.7 | 4.0.7 | Latest |
| pino | 10.4.0 | 10.4.0 | Latest |
| pino-abstract-transport | 3.0.0 | 3.0.0 | Latest |
| pino-std-serializers | 7.1.0 | 7.1.0 | Latest |
| playwright | 1.64.1 | 1.64.1 | Latest |
| playwright-core | 1.64.1 | 1.64.1 | Latest |
| plist | 3.1.1 | 5.0.0 | Upstream dependency constraint; compatible updates applied |
| polygon-clipping | 0.15.7 | 0.15.7 | Latest |
| postcss | 8.5.30 | 8.5.30 | Latest |
| postcss-value-parser | 4.2.0 | 4.2.0 | Latest |
| postgres-array | 2.0.0 | 3.0.4 | Upstream dependency constraint; compatible updates applied |
| postgres-bytea | 1.0.1 | 3.0.0 | Upstream dependency constraint; compatible updates applied |
| postgres-date | 1.0.7 | 2.1.0 | Upstream dependency constraint; compatible updates applied |
| postgres-interval | 1.2.0 | 4.1.0 | Upstream dependency constraint; compatible updates applied |
| pretty-format | 27.5.1 | 30.5.1 | Upstream dependency constraint; compatible updates applied |
| process-warning | 5.1.1 | 5.1.1 | Latest |
| proj4 | 2.22.0 | 2.22.0 | Latest |
| prompts | 2.4.2 | 2.4.2 | Latest |
| prosemirror-changeset | 2.4.4 | 2.4.4 | Latest |
| prosemirror-commands | 1.7.2 | 1.7.2 | Latest |
| prosemirror-dropcursor | 1.8.4 | 1.8.4 | Latest |
| prosemirror-gapcursor | 1.4.1 | 1.4.1 | Latest |
| prosemirror-history | 1.5.1 | 1.5.1 | Latest |
| prosemirror-inputrules | 1.5.1 | 1.5.1 | Latest |
| prosemirror-keymap | 1.2.3 | 1.2.3 | Latest |
| prosemirror-model | 1.25.12 | 1.25.12 | Latest |
| prosemirror-schema-list | 1.5.1 | 1.5.1 | Latest |
| prosemirror-state | 1.4.4 | 1.4.4 | Latest |
| prosemirror-tables | 1.8.5 | 1.8.5 | Latest |
| prosemirror-transform | 1.12.2 | 1.12.2 | Latest |
| prosemirror-view | 1.42.6 | 1.42.6 | Latest |
| proto3-json-serializer | 3.0.4 | 4.1.0 | Upstream dependency constraint; compatible updates applied |
| proto3-json-serializer | 4.1.0 | 4.1.0 | Latest |
| protobufjs | 7.6.6 | 8.8.1 | Upstream dependency constraint; compatible updates applied |
| punycode | 2.3.1 | 2.3.1 | Latest |
| quick-format-unescaped | 4.0.4 | 4.0.4 | Latest |
| re2js | 2.8.6 | 2.8.6 | Latest |
| react | 19.3.1 | 19.3.1 | Latest |
| react-dom | 19.3.1 | 19.3.1 | Latest |
| react-is | 17.0.2 | 19.3.1 | Upstream dependency constraint; compatible updates applied |
| react-router | 7.18.4 | 8.4.0 | Upstream dependency constraint; compatible updates applied |
| react-router-dom | 7.18.4 | 7.18.4 | Latest |
| readable-stream | 3.6.2 | 4.8.0 | Upstream dependency constraint; compatible updates applied |
| real-require | 1.0.0 | 1.0.0 | Latest |
| redent | 3.0.0 | 4.0.0 | Upstream dependency constraint; compatible updates applied |
| regenerator-runtime | 0.13.11 | 0.14.1 | Upstream dependency constraint; compatible updates applied |
| require-directory | 2.1.1 | 2.1.1 | Latest |
| require-from-string | 2.0.2 | 2.0.2 | Latest |
| ret | 0.5.0 | 0.5.0 | Latest |
| retry | 0.13.1 | 0.13.1 | Latest |
| retry-request | 8.0.4 | 9.1.0 | Upstream dependency constraint; compatible updates applied |
| retry-request | 9.1.0 | 9.1.0 | Latest |
| reusify | 1.1.0 | 1.1.0 | Latest |
| rfdc | 1.4.1 | 1.4.1 | Latest |
| rimraf | 5.0.10 | 6.1.3 | Upstream dependency constraint; compatible updates applied |
| rimraf | 6.1.3 | 6.1.3 | Latest |
| robust-predicates | 3.0.3 | 3.0.3 | Latest |
| rolldown | 1.2.14 | 1.2.14 | Latest |
| rope-sequence | 1.3.4 | 1.3.4 | Latest |
| safe-buffer | 5.2.1 | 5.2.1 | Latest |
| safe-regex2 | 5.1.2 | 5.1.2 | Latest |
| safe-stable-stringify | 2.5.0 | 2.5.0 | Latest |
| sax | 1.1.4 | 1.6.1 | Upstream dependency constraint; compatible updates applied |
| saxes | 6.0.0 | 6.0.0 | Latest |
| scheduler | 0.28.0 | 0.28.0 | Latest |
| secure-json-parse | 4.1.1 | 4.1.1 | Latest |
| semver | 7.8.5 | 7.8.5 | Latest |
| set-cookie-parser | 3.1.3 | 3.1.3 | Latest |
| set-cookie-parser | 2.7.2 | 3.1.3 | Upstream dependency constraint; compatible updates applied |
| shapefile | 0.6.6 | 0.6.6 | Latest |
| shebang-command | 2.0.0 | 2.0.0 | Latest |
| shebang-regex | 3.0.0 | 4.0.0 | Upstream dependency constraint; compatible updates applied |
| signal-exit | 4.1.0 | 4.1.0 | Latest |
| signal-exit | 3.0.7 | 4.1.0 | Upstream dependency constraint; compatible updates applied |
| simple-plist | 1.3.1 | 1.3.1 | Latest |
| sisteransi | 1.0.5 | 2.0.0 | Upstream dependency constraint; compatible updates applied |
| slice-ansi | 4.0.0 | 9.0.1 | Upstream dependency constraint; compatible updates applied |
| slice-source | 0.4.1 | 0.4.1 | Latest |
| sonic-boom | 4.2.1 | 5.0.2 | Upstream dependency constraint; compatible updates applied |
| source-map-js | 1.2.2 | 1.2.2 | Latest |
| splaytree | 3.2.3 | 3.2.3 | Latest |
| split2 | 4.2.0 | 4.2.0 | Latest |
| std-env | 4.3.0 | 4.3.0 | Latest |
| stream-buffers | 2.2.0 | 3.0.3 | Upstream dependency constraint; compatible updates applied |
| stream-events | 1.0.5 | 1.0.5 | Latest |
| stream-shift | 1.0.3 | 1.0.3 | Latest |
| stream-source | 0.3.5 | 0.3.5 | Latest |
| string_decoder | 1.3.0 | 1.3.0 | Latest |
| string-width | 5.1.2 | 8.3.0 | Upstream dependency constraint; compatible updates applied |
| string-width | 7.2.0 | 8.3.0 | Upstream dependency constraint; compatible updates applied |
| string-width | 4.2.3 | 8.3.0 | Upstream dependency constraint; compatible updates applied |
| string-width | 4.2.3 | 8.3.0 | Upstream dependency constraint; compatible updates applied |
| strip-ansi | 7.2.0 | 7.2.0 | Latest |
| strip-ansi | 7.2.0 | 7.2.0 | Latest |
| strip-ansi | 6.0.1 | 7.2.0 | Upstream dependency constraint; compatible updates applied |
| strip-ansi | 6.0.1 | 7.2.0 | Upstream dependency constraint; compatible updates applied |
| strip-indent | 3.0.0 | 4.1.1 | Upstream dependency constraint; compatible updates applied |
| strnum | 2.5.1 | 2.5.1 | Latest |
| stubs | 3.0.0 | 3.0.0 | Latest |
| tailwind-merge | 3.7.0 | 3.7.0 | Latest |
| tailwindcss | 4.3.3 | 4.3.3 | Latest |
| tapable | 2.3.3 | 2.3.3 | Latest |
| tar | 7.5.22 | 7.5.22 | Latest |
| tar-mini | 0.2.0 | 0.2.0 | Latest |
| teeny-request | 10.1.4 | 11.1.0 | Upstream dependency constraint; compatible updates applied |
| teeny-request | 11.1.0 | 11.1.0 | Latest |
| tesseract.js | 7.0.0 | 7.0.0 | Latest |
| tesseract.js-core | 7.0.0 | 6.1.2 | Upstream dependency constraint; compatible updates applied |
| text-encoding | 0.6.4 | 0.7.0 | Upstream dependency constraint; compatible updates applied |
| thread-stream | 4.2.0 | 4.2.0 | Latest |
| through2 | 4.0.2 | 5.0.11 | Upstream dependency constraint; compatible updates applied |
| tinybench | 6.2.2 | 6.2.2 | Latest |
| tinyexec | 1.3.1 | 1.3.1 | Latest |
| tinyglobby | 0.2.17 | 0.2.17 | Latest |
| tldts | 7.4.18 | 7.4.18 | Latest |
| tldts-core | 7.4.18 | 7.4.18 | Latest |
| toad-cache | 3.7.4 | 3.7.4 | Latest |
| tough-cookie | 6.0.2 | 6.0.2 | Latest |
| tr46 | 0.0.3 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| tr46 | 7.0.0 | 7.0.0 | Latest |
| tree-kill | 1.2.2 | 1.2.2 | Latest |
| tslib | 2.8.1 | 2.8.1 | Latest |
| tsx | 4.23.15 | 4.23.15 | Latest |
| typescript | 7.0.2 | 7.0.2 | Latest |
| undici | 8.12.1 | 8.12.1 | Latest |
| undici-types | 8.9.0 | 8.12.1 | Upstream dependency constraint; compatible updates applied |
| universalify | 2.0.1 | 2.0.1 | Latest |
| untildify | 4.0.0 | 6.0.0 | Upstream dependency constraint; compatible updates applied |
| update-browserslist-db | 1.3.4 | 1.3.4 | Latest |
| use-sync-external-store | 1.7.0 | 1.7.0 | Latest |
| util-deprecate | 1.0.2 | 1.0.2 | Latest |
| uuid | 14.0.3 | 14.0.3 | Latest |
| vite | 8.3.4 | 8.3.4 | Latest |
| vite-plugin-compression2 | 2.5.3 | 2.5.3 | Latest |
| vitest | 5.0.4 | 5.0.4 | Latest |
| w3c-keyname | 2.2.8 | 2.2.8 | Latest |
| w3c-xmlserializer | 6.0.0 | 6.0.0 | Latest |
| wasm-feature-detect | 1.9.0 | 1.9.0 | Latest |
| web-streams-polyfill | 3.3.3 | 4.3.0 | Upstream dependency constraint; compatible updates applied |
| web-vitals | 4.2.4 | 6.2.3 | Upstream dependency constraint; compatible updates applied |
| webidl-conversions | 3.0.1 | 8.0.1 | Upstream dependency constraint; compatible updates applied |
| webidl-conversions | 8.0.1 | 8.0.1 | Latest |
| websocket-driver | 0.7.5 | 0.7.5 | Latest |
| websocket-extensions | 0.1.4 | 0.1.4 | Latest |
| whatwg-mimetype | 5.0.0 | 5.0.0 | Latest |
| whatwg-url | 5.0.0 | 17.3.0 | Upstream dependency constraint; compatible updates applied |
| whatwg-url | 17.3.0 | 17.3.0 | Latest |
| which | 2.0.2 | 7.0.0 | Upstream dependency constraint; compatible updates applied |
| why-is-node-running | 3.2.1 | 3.2.3 | Upstream dependency constraint; compatible updates applied |
| wkt-parser | 1.6.0 | 1.6.0 | Latest |
| wrap-ansi | 8.1.0 | 10.0.2 | Upstream dependency constraint; compatible updates applied |
| wrap-ansi | 9.0.2 | 10.0.2 | Upstream dependency constraint; compatible updates applied |
| wrap-ansi | 7.0.0 | 10.0.2 | Upstream dependency constraint; compatible updates applied |
| wrap-ansi | 7.0.0 | 10.0.2 | Upstream dependency constraint; compatible updates applied |
| wrappy | 1.0.2 | 1.0.2 | Latest |
| xcode | 3.0.1 | 3.0.1 | Latest |
| xlsx | 0.20.3 | 0.20.3 | Latest |
| xml-name-validator | 5.0.0 | 5.0.0 | Latest |
| xml-naming | 0.3.0 | 0.3.0 | Latest |
| xml2js | 0.6.2 | 0.6.2 | Latest |
| xmlbuilder | 11.0.1 | 15.1.1 | Upstream dependency constraint; compatible updates applied |
| xmlbuilder | 15.1.1 | 15.1.1 | Latest |
| xmlchars | 2.2.0 | 2.2.0 | Latest |
| xtend | 4.0.2 | 4.0.2 | Latest |
| y18n | 5.0.8 | 5.0.8 | Latest |
| yallist | 5.0.0 | 5.0.0 | Latest |
| yargs | 18.0.0 | 18.2.0 | Upstream dependency constraint; compatible updates applied |
| yargs | 17.7.3 | 18.2.0 | Upstream dependency constraint; compatible updates applied |
| yargs-parser | 22.0.0 | 22.0.0 | Latest |
| yargs-parser | 21.1.1 | 22.0.0 | Upstream dependency constraint; compatible updates applied |
| yauzl | 2.10.0 | 3.4.0 | Upstream dependency constraint; compatible updates applied |
| yocto-queue | 0.1.0 | 1.2.2 | Upstream dependency constraint; compatible updates applied |
| zlibjs | 0.3.1 | 0.3.1 | Latest |
| zod | 4.6.7 | 4.6.7 | Latest |
