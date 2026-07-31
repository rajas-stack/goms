/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { compression } from 'vite-plugin-compression2'

// The village-shapes/villages glob imports (~6,450 files each, one per
// taluka) each become their own Rollup chunk when left ungrouped — that's
// ~12,800 chunks for Rollup to render, which is what OOM-kills the CI build
// (see the pages job's NODE_OPTIONS comment) even at an 8GB heap: the limit
// is chunk-graph overhead, not JSON payload size, so a bigger heap flag
// doesn't help. Bucketing them into a fixed number of chunks keeps the same
// lazy-loading behavior (only the bucket containing the requested taluka is
// fetched) while cutting the chunk count to something Rollup can render.
const GEO_GLOB_BUCKETS = 40
function geoGlobBucket(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return hash % GEO_GLOB_BUCKETS
}

export default defineConfig({
  plugins: [react(), compression()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/assets/village-shapes/')) return `geo-village-shapes-${geoGlobBucket(id)}`
          if (id.includes('/assets/villages/') && id.endsWith('.json')) return `geo-villages-${geoGlobBucket(id)}`
        },
      },
    },
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
