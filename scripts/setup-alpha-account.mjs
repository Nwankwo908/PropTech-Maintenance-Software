#!/usr/bin/env node
/**
 * Prepare Alpha as the real production landlord account:
 *   1. Apply portfolio purge for Demo + Alpha (requires migration 20260731240000)
 *   2. Create ceorentalsnj@gmail.com auth user (if missing)
 *
 * Usage:
 *   node scripts/setup-alpha-account.mjs
 *   node scripts/setup-alpha-account.mjs --reset-password
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ALPHA_LANDLORD_ID = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
const DEMO_LANDLORD_ID = 'de300000-0000-4000-8000-000000000001'
const ALPHA_EMAIL = 'ceorentalsnj@gmail.com'
const RESET_PASSWORD = process.argv.includes('--reset-password')

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env')

try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value
    }
  }
} catch {
  // optional .env
}

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const ALPHA_PASSWORD =
  process.env.ALPHA_ACCOUNT_PASSWORD?.trim() || 'Alpha-Ulo-2026!'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL / VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env',
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findUserByEmail(email) {
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    })
    if (error) throw new Error(error.message)
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    )
    if (match) return match
    if (data.users.length < 200) return null
    page += 1
  }
}

async function purgeLandlord(landlordId, label) {
  const { data, error } = await supabase.rpc('purge_landlord_portfolio', {
    p_landlord_id: landlordId,
  })
  if (error) {
    throw new Error(`${label} purge: ${error.message}`)
  }
  console.log(`OK    ${label} portfolio purged — ${JSON.stringify(data)}`)
}

async function ensureAlphaAuthUser() {
  const existing = await findUserByEmail(ALPHA_EMAIL)

  if (existing) {
    if (RESET_PASSWORD) {
      const { error } = await supabase.auth.admin.updateUserById(existing.id, {
        password: ALPHA_PASSWORD,
        email_confirm: true,
      })
      if (error) throw new Error(`password reset: ${error.message}`)
      console.log(`OK    ${ALPHA_EMAIL} — exists, password reset`)
    } else {
      console.log(`OK    ${ALPHA_EMAIL} — already exists (skipped)`)
    }
    return
  }

  const { error } = await supabase.auth.admin.createUser({
    email: ALPHA_EMAIL,
    password: ALPHA_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Alpha', ulo_account_kind: 'production' },
  })
  if (error) throw new Error(`create user: ${error.message}`)
  console.log(`OK    ${ALPHA_EMAIL} — created (password: ${ALPHA_PASSWORD})`)
}

async function main() {
  await purgeLandlord(ALPHA_LANDLORD_ID, 'Alpha')

  const { error: landlordError } = await supabase
    .from('landlords')
    .update({
      name: 'Alpha',
      email: ALPHA_EMAIL,
      is_demo: false,
    })
    .eq('id', ALPHA_LANDLORD_ID)

  if (landlordError) {
    throw new Error(`landlords update: ${landlordError.message}`)
  }
  console.log(`OK    landlords row updated for Alpha (${ALPHA_LANDLORD_ID})`)

  await ensureAlphaAuthUser()

  console.log(`
Alpha is ready:
  • Log in at /admin/login with ${ALPHA_EMAIL}
  • Portfolio is empty — add properties/residents from the dashboard
  • Demo showcase (${DEMO_LANDLORD_ID}) is unchanged — re-seed with scripts/seed-demo-portfolio.mjs if needed
`)
}

main().catch((err) => {
  console.error(`FAIL  ${err.message}`)
  process.exit(1)
})
