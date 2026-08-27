import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { prerenderPublicPagesPlugin } from './src/prerender/prerenderPublicPagesPlugin.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname)

// https://vite.dev/config/
export default defineConfig({
  root,
  envDir: root,
  plugins: [react(), tailwindcss(), prerenderPublicPagesPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@shared': path.resolve(root, 'shared'),
    },
  },
  // Lets Cursor / tunnel URLs and LAN IPs open the app; avoids "host is not allowed" on dev/preview.
  // Dev default: 5173. Preview (production bundle): 4173 — use the URL printed by the terminal, or /admin/login on that origin.
  server: {
    host: true,
    allowedHosts: true,
    port: 5173,
  },
  preview: {
    host: true,
    allowedHosts: true,
    port: 4173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
