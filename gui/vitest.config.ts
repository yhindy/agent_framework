import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.{test,spec}.ts'],
    exclude: ['src/renderer/**/*', 'node_modules/**/*'],
    globals: true,

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
      include: ['src/main/**/*.ts'],
      exclude: [
        'src/main/**/*.{test,spec}.ts',
        'src/main/**/__tests__/**',
        'src/main/index.ts', // Entry point
      ],
      thresholds: {
        lines: 59,
        functions: 60,
        branches: 60,
        statements: 59,
      },
    },
  },
})

