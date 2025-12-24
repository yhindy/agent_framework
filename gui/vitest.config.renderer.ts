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
  },
  resolve: {
    alias: {
      '@renderer': join(__dirname, 'src/renderer/src'),
    },
  },
})

