import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Test files share one real Postgres database (no per-file schema/mock
    // isolation), and now that both hierarchy.test.ts and employees.test.ts
    // reset hierarchy_nodes in beforeEach, running files in parallel races
    // one file's DELETE against another's mid-test rows. Sequential file
    // execution trades some wall-clock time for correctness against shared
    // state — the same trade-off `customers`/`hierarchy` never needed to
    // make because only one file touched shared tables until now.
    fileParallelism: false,
    setupFiles: ['./src/testHelpers/setupFirebaseAdminMock.ts'],
  },
})
