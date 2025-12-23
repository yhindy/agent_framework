import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.{test,spec}.ts'],
    exclude: ['src/renderer/**/*', 'node_modules/**/*'],
    globals: true,
  },
})

