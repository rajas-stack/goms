/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { compression } from 'vite-plugin-compression2'

export default defineConfig({
  plugins: [react(), compression()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    // Pure-logic tests only — no DOM, no IndexedDB. Anything needing those
    // is verified manually; see the plan's Task 4 and Task 5.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    watch: { ignored: ['**/android/**', '**/ios/**'] },
  },
})
