// Separate from vite.config.ts's test block on purpose: that one is
// pure-logic-only by design (no DOM, no IndexedDB, no network). Integration
// tests here talk to the real local Supabase Postgres instance — they only
// run when `supabase start` is up, and are never part of the default
// `npm test` gate.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/data/supabase/**/*.integration.test.ts'],
  },
})
