// Separate from vite.config.ts's test block on purpose: that one is
// pure-logic-only by design (no DOM — see its own comment). This config
// adds a jsdom environment specifically for the new interactive Commercial
// Calculator UI (pricing-level cards, bulk-edit, dashboard filters,
// collapsible sections) introduced by the 2026-08-19 pricing overhaul —
// it never runs as part of the default `npm test` gate.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Node 25+ ships a built-in `localStorage` global (Web Storage, enabled by default) that shadows
// jsdom's and lacks `.clear()`, breaking component suites. Turn it off in the test workers.
// Gated on the Node major: older Node (e.g. 20) rejects the unknown flag and would crash.
const NODE_MAJOR = Number(process.versions.node.split('.')[0])
const WORKER_EXEC_ARGV = NODE_MAJOR >= 25 ? ['--no-experimental-webstorage'] : []

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup-component-tests.ts'],
    globals: true,
    // Heavy grid tests (virtualized table + userEvent) exceed the 5s default when the whole
    // suite runs in parallel; they pass alone in ~1-2s, so this only absorbs load, not hangs.
    testTimeout: 20000,
    execArgv: WORKER_EXEC_ARGV,
  },
})
