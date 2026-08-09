#!/usr/bin/env node
/**
 * Re-seed Demo Property Management showcase data on the linked Supabase project.
 *
 * Usage:
 *   node scripts/seed-demo-portfolio.mjs
 *
 * Requires Supabase CLI logged in and project linked (`supabase link`).
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const SEED_FILES = [
  'supabase/seed_demo_landlord_account.sql',
  'supabase/seed_demo_communication.sql',
  'supabase/seed_demo_preventive_maintenance.sql',
  'supabase/seed_demo_maintenance_spend.sql',
]

function runSeed(relativePath) {
  const file = resolve(root, relativePath)
  console.log(`\n→ ${relativePath}`)
  const result = spawnSync(
    'npx',
    ['--yes', 'supabase@2.113.0', 'db', 'query', '--linked', '-f', file],
    { cwd: root, stdio: 'inherit', env: process.env },
  )
  if (result.status !== 0) {
    throw new Error(`Seed failed: ${relativePath}`)
  }
}

console.log('Seeding Demo Property Management (de300000-0000-4000-8000-000000000001)…')
for (const file of SEED_FILES) {
  runSeed(file)
}
console.log('\nOK    Demo showcase re-seeded. Sign in as demo@ulohome.io to verify.')
