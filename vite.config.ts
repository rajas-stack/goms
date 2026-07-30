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
  // Without this, Vite's dep-scanner auto-discovers every index.html under
  // the project root as a separate entry — including the ones Capacitor/
  // Gradle leave behind in android/app/build/intermediates/assets/**, which
  // mirror the entire (chunk-heavy) dist output two or three times over.
  optimizeDeps: {
    entries: ['index.html'],
  },
  // The Android platform folder holds ~50k+ Gradle-generated files (merged
  // asset copies of dist, per debug/release variant). Chokidar trying to set
  // up watches across all of it is what actually made every cold `npm run
  // dev` start hang for minutes before the first page could render.
  server: {
    watch: { ignored: ['**/android/**', '**/ios/**'] },
  },
})
