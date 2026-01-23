import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { join } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/renderer/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
    setupFiles: [join(__dirname, 'src/renderer/src/test/setup.ts')],

    // Memory and performance controls
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1,
        singleFork: false
      }
    },
    maxWorkers: 4,

    coverage: {
      enabled: false, // Enable with --coverage flag in CI
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      exclude: [
        'src/renderer/src/**/*.{test,spec}.{ts,tsx}',
        'src/renderer/src/**/__tests__/**',
        'src/renderer/src/test/**',
        'src/renderer/src/main.tsx', // Entry point
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@renderer': join(__dirname, 'src/renderer/src'),
    },
  },
})

