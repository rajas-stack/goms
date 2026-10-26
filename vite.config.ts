/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { compression, defineAlgorithm } from 'vite-plugin-compression2'
import { constants } from 'node:zlib'
import { retainedPreviewAssets } from './scripts/preview-retained-assets.mjs'

export default defineConfig(({ mode }) => ({
  // Keep the live preview independent from test runners and npm's disposable cache.
  cacheDir: process.env.GOMS_DEV_CACHE_DIR ?? path.resolve(import.meta.dirname, mode === 'test' ? '../.goms-dev-server/vite-test-cache' : '../.goms-dev-server/vite-manual-cache'),
  plugins: [react(), retainedPreviewAssets(import.meta.dirname), ...(mode === 'local-preview' ? [] : [compression({
    algorithms: [
      'gzip',
      defineAlgorithm('brotliCompress', { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
    ],
    // The geography dataset contains thousands of assets; bound open files.
    scheduler: { limit: 4, isHighMemory: () => true },
  })])],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    // Pure-logic tests only — no DOM, no IndexedDB. Anything needing those
    // is verified manually; see the plan's Task 4 and Task 5.
    environment: 'node',
    include: ['src/**/*.test.ts', 'packages/domain/src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
  // Without this, Vite's dep-scanner auto-discovers every index.html under
  // the project root as a separate entry — including the ones Capacitor/
  // Gradle leave behind in android/app/build/intermediates/assets/**, which
  // mirror the entire (chunk-heavy) dist output two or three times over.
  optimizeDeps: {
    entries: ['index.html'],
    // Avoid blocking the first request on a crawl through this large workspace.
    // With discovery off, every CommonJS dependency (or one with CJS deps) must be listed below, or dev pages crash.
    noDiscovery: true,
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-router-dom',
      '@tanstack/react-query', '@tanstack/react-table', '@tanstack/react-table/legacy', '@tanstack/react-virtual', 'framer-motion',
      'firebase/app', 'firebase/auth', 'firebase/storage', 'xlsx', 'd3-geo', '@tiptap/react', 'tesseract.js'],
  },
  // The Android platform folder holds ~50k+ Gradle-generated files (merged
  // asset copies of dist, per debug/release variant). Chokidar trying to set
  // up watches across all of it is what actually made every cold `npm run
  // dev` start hang for minutes before the first page could render.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/android/**', '**/ios/**', '**/.worktrees/**', '**/.claude/**', '**/test-results/**', '**/playwright-report/**',
        // Build output is ignored — except @goms/domain's, which the app imports
        // from packages/domain/dist; ignoring it made Vite serve a stale module
        // after `npm run build` in packages/domain (missing-export crashes).
        (path: string) => /[\\/]dist[\\/]/.test(path) && !/[\\/]packages[\\/]domain[\\/]dist[\\/]/.test(path),
      ],
    },
  },
}))
