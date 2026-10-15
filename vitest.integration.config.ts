/// <reference types="vitest" />
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
  },
})
