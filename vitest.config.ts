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
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        'src/main/index.ts',
        'src/renderer/src/main.tsx',
      ],
      thresholds: {
        lines: 24,
        functions: 17,
        branches: 16,
        statements: 24,
        // Risk-weighted floors for the value-moving / signing code, so it can
        // never silently regress behind the renderer-heavy global gate. Set
        // below current coverage as ratchet floors, not aspirational targets.
        'src/main/wallet/**': { statements: 50, lines: 50, functions: 45, branches: 45 },
        'src/main/wallet/payment-*.ts': { statements: 70, lines: 70, functions: 70, branches: 65 },
        'src/main/cocoon/**': { statements: 35, lines: 35, functions: 35, branches: 28 },
        'src/main/tonconnect/**': { statements: 50, lines: 50, functions: 50, branches: 45 },
      },
    },
  },
})
