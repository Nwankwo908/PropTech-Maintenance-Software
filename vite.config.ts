import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname)

// https://vite.dev/config/
export default defineConfig({
  root,
  envDir: root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
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
})
