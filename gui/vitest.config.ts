import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.{test,spec}.ts'],
    exclude: ['src/renderer/**/*', 'node_modules/**/*'],
    globals: true,
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
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
})

