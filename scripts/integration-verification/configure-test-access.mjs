#!/usr/bin/env node
/**
 * Configure Limited Alpha integration test access.
 *
 * 1) Loads SUPABASE_SERVICE_ROLE_KEY from env / .env.local, or fetches via
 *    `supabase projects api-keys` (never prints key values).
 * 2) Ensures designated auth users exist with known INTEGRATION_* passwords
 *    written only to .env.local.
 * 3) Does not touch live customer records outside designated test landlords.
 *
 * Usage:
 *   node scripts/integration-verification/configure-test-access.mjs --la2-only
 *   node scripts/integration-verification/configure-test-access.mjs --reset-passwords --la2-only
 *
 * Default for readiness work: --la2-only (does not create/reset/sign-in Limited Alpha 1).
 * Pass --include-la1 only when an operator explicitly authorizes LA1 access.
 */
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const ENV_LOCAL = resolve(ROOT, '.env.local')
const RESET = process.argv.includes('--reset-passwords')
/** Prefer LA2-only unless an operator explicitly passes --include-la1. */
const INCLUDE_LA1 =
  process.argv.includes('--include-la1') && !process.argv.includes('--la2-only')
const LA2_ONLY = !INCLUDE_LA1
const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'

const LA1_EMAIL = 'limitedalpha1@ulohome.io'
const LA2_EMAIL = 'limitedalpha2@ulohome.io'
const DEFAULT_LA1_PASSWORD = 'Ulo-LA1-Integration-2026!'
const DEFAULT_LA2_PASSWORD = 'Ulo-LA2-Integration-2026!'

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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
}

function upsertEnvLocal(entries) {
  let text = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, 'utf8') : ''
  if (text && !text.endsWith('\n')) text += '\n'
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`
    const re = new RegExp(`^${key}=.*$`, 'm')
    if (re.test(text)) text = text.replace(re, line)
    else text += `${line}\n`
  }
  writeFileSync(ENV_LOCAL, text, { mode: 0o600 })
}

function fetchServiceRoleViaCli() {
  const out = execFileSync(
    'supabase',
    ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
    { encoding: 'utf8', cwd: ROOT },
  )
  const parsed = JSON.parse(out)
  const list = Array.isArray(parsed) ? parsed : parsed?.keys || []
  const row = list.find(
    (k) => String(k.name || k.id || '').toLowerCase() === 'service_role',
  )
  const key = row?.api_key || row?.apiKey || row?.key
  if (!key) throw new Error('service_role key not found in supabase projects api-keys')
  return key
}

loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(ENV_LOCAL)

let serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseUrl = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
).trim()

if (!supabaseUrl) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_URL')
  process.exit(1)
}

if (!serviceRole) {
  console.log('Fetching service_role via supabase CLI (value not printed)…')
  serviceRole = fetchServiceRoleViaCli()
}

const la1Password =
  (process.env.INTEGRATION_LA1_PASSWORD || '').trim() || DEFAULT_LA1_PASSWORD
const la2Password =
  (process.env.INTEGRATION_LA2_PASSWORD || '').trim() || DEFAULT_LA2_PASSWORD

const envWrites = {
  SUPABASE_SERVICE_ROLE_KEY: serviceRole,
  INTEGRATION_LA2_PASSWORD: la2Password,
}
if (INCLUDE_LA1) envWrites.INTEGRATION_LA1_PASSWORD = la1Password
upsertEnvLocal(envWrites)
console.log(
  LA2_ONLY
    ? 'Wrote SUPABASE_SERVICE_ROLE_KEY + INTEGRATION_LA2_PASSWORD to .env.local (LA1 untouched)'
    : 'Wrote SUPABASE_SERVICE_ROLE_KEY + INTEGRATION_LA*_PASSWORD to .env.local',
)

const admin = createClient(supabaseUrl, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findUserByEmail(email) {
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
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

async function ensureUser(email, password, meta) {
  const existing = await findUserByEmail(email)
  if (existing) {
    if (RESET || process.env.FORCE_RESET_INTEGRATION_PASSWORDS === '1') {
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { ...existing.user_metadata, ...meta },
      })
      if (error) throw new Error(`${email} reset: ${error.message}`)
      console.log(`OK  ${email} — password reset`)
      return
    }
    // Always reset for integration configure so known passwords work.
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { ...existing.user_metadata, ...meta },
    })
    if (error) throw new Error(`${email} reset: ${error.message}`)
    console.log(`OK  ${email} — exists, password aligned for integration`)
    return
  }
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: meta,
  })
  if (error) throw new Error(`${email} create: ${error.message}`)
  console.log(`OK  ${email} — created`)
}

if (INCLUDE_LA1) {
  await ensureUser(LA1_EMAIL, la1Password, {
    full_name: 'Limited Alpha 1',
    ulo_account_kind: 'integration_test',
    ulo_landlord_id: 'de300000-0000-4000-8000-000000000003',
  })
} else {
  console.log('SKIP Limited Alpha 1 — --la2-only (default); no LA1 user/password/sign-in')
}

await ensureUser(LA2_EMAIL, la2Password, {
  full_name: 'Limited Alpha 2',
  ulo_account_kind: 'integration_test',
  ulo_landlord_id: 'de300000-0000-4000-8000-000000000004',
})

// Smoke: password sign-in works (anon key) — LA2 only unless --include-la1
loadEnvFile(ENV_LOCAL)
const anon = (
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
).trim()
if (!anon) {
  console.error('Missing VITE_SUPABASE_ANON_KEY for sign-in smoke')
  process.exit(1)
}
const browser = createClient(supabaseUrl, anon, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const signInTargets = INCLUDE_LA1
  ? [
    [LA1_EMAIL, la1Password],
    [LA2_EMAIL, la2Password],
  ]
  : [[LA2_EMAIL, la2Password]]
for (const [email, password] of signInTargets) {
  const { data, error } = await browser.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    console.error(`FAIL sign-in ${email}: ${error?.message || 'no session'}`)
    process.exitCode = 1
  } else {
    console.log(`OK  sign-in smoke ${email}`)
    await browser.auth.signOut()
  }
}

console.log(`
Configured (${LA2_ONLY ? 'LA2-only' : 'LA1+LA2'}). Next:
  npm run verify:maintenance-workflow
  INTEGRATION_SMS_INJECT_YES=0 npm run verify:sms-journey
`)
