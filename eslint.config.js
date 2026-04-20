import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import globals from 'globals'

export default tseslint.config(
  // Global ignores (replaces "ignorePatterns")
  {
    ignores: [
      'dist/**',
      'out/**',
      'release/**',
      'node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended
  ...tseslint.configs.recommended,

  // React flat configs
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],

  // React hooks (recommended-latest uses flat config object format)
  reactHooksPlugin.configs['recommended-latest'],

  // Project config
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-this-alias': 'warn',
      'react/prop-types': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Test file overrides
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Prettier must be last
  eslintConfigPrettier,
)
