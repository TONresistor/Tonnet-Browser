import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    clearMocks: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/__tests__/**',
        'src/**/*.d.ts',
        'src/main/index.ts',
        'src/preload/**',
        'src/renderer/src/main.tsx',
      ],
      thresholds: {
        lines: 24,
        functions: 17,
        branches: 16,
        statements: 24,
      },
    },
  },
})
