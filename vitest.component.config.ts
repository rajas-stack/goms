// Separate from vite.config.ts's test block on purpose: that one is
// pure-logic-only by design (no DOM — see its own comment). This config
// adds a jsdom environment specifically for the new interactive Commercial
// Calculator UI (pricing-level cards, bulk-edit, dashboard filters,
// collapsible sections) introduced by the 2026-08-19 pricing overhaul —
// it never runs as part of the default `npm test` gate.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

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
  },
})
