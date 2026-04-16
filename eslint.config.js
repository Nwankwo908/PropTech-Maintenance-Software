import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
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
