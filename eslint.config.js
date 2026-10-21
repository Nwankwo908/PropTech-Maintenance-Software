import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    '.readiness',
    // Edge Functions use Deno lint (scripts/readiness/check-lint.sh). Browser globals
    // here would mis-flag Deno APIs and are not the backend standards gate.
    'supabase/functions/**',
    // Accidental duplicate editor copies — not part of the product surface.
    '**/* 2.ts',
    '**/* 2.tsx',
    '**/* 2.mjs',
    '**/* 2.js',
    '**/* 2.html',
    '**/* 2.txt',
  ]),
  {
    files: ['src/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}', 'vite.config.ts', 'vite/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // This rule is currently too noisy for common patterns in this app (async loads, auth gates).
      // We rely on `react-hooks/exhaustive-deps` and good review practices instead.
      'react-hooks/set-state-in-effect': 'off',
      // Fast Refresh warnings should not fail readiness; keep as warnings for review.
      'react-refresh/only-export-components': 'warn',
      // Escapes in regex/string templates are common in SMS parsers; warn only.
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.{ts,mjs,js}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: [
      'src/components/OverrideAutomationModal.tsx',
      'src/hooks/useTicketTimelineStatus.ts',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
