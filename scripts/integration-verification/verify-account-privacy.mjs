#!/usr/bin/env node
/**
 * P1 — Account access & data privacy (live / staging).
 *
 * Uses Limited Alpha 1 + 2 only. Never targets production customer portfolios
 * outside those designated test landlord ids.
 *
 * Required:
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   VITE_SUPABASE_ANON_KEY
 *   INTEGRATION_LA1_PASSWORD
 *   INTEGRATION_LA2_PASSWORD
 *
 * Optional:
 *   SUPABASE_SERVICE_ROLE_KEY — only for reporting auth user existence (no writes)
 *
 * Exit: 0 passed | 1 failed | 2 blocked
 */
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT_DIR = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT_DIR, { recursive: true })

const LA1 = 'de300000-0000-4000-8000-000000000003'
const LA2 = 'de300000-0000-4000-8000-000000000004'
const LA1_EMAIL = 'limitedalpha1@ulohome.io'
const LA2_EMAIL = 'limitedalpha2@ulohome.io'

function loadEnvFiles() {
  for (const name of ['.env', '.env.local']) {
    const path = resolve(ROOT, name)
    if (!existsSync(path)) continue
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
}

loadEnvFiles()

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const LA1_PASSWORD = (process.env.INTEGRATION_LA1_PASSWORD || '').trim()
const LA2_PASSWORD = (process.env.INTEGRATION_LA2_PASSWORD || '').trim()

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}

function finish(overall, code) {
  let host = 'missing'
  try {
    if (SUPABASE_URL) host = new URL(SUPABASE_URL).host
  } catch {
    host = 'invalid_url'
  }
  const payload = {
    area: 'P1-account-privacy',
    overall,
    finishedAt: new Date().toISOString(),
    environment: host,
    results,
    boundaries: [
      'Does not exercise Google OAuth UI or email OTP inbox delivery.',
      'Does not modify live customer records outside LA1/LA2 test landlords.',
      'App-layer emailMayAccessLandlordId is covered by Deno unit tests separately.',
    ],
  }
  writeFileSync(
    resolve(OUT_DIR, 'P1-account-privacy.json'),
    JSON.stringify(payload, null, 2) + '\n',
  )
  console.log(`\nOverall P1: ${overall} (exit ${code})`)
  process.exit(code)
}

if (!SUPABASE_URL || !ANON) {
  record('prereq', 'blocked', 'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  finish('blocked', 2)
}

if (!LA1_PASSWORD || !LA2_PASSWORD) {
  record(
    'prereq_passwords',
    'blocked',
    'Set INTEGRATION_LA1_PASSWORD and INTEGRATION_LA2_PASSWORD for Limited Alpha test logins',
  )
  // Still verify unauthenticated rejection.
}

const anon = createClient(SUPABASE_URL, ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// --- Unauthenticated must not read portfolio tables ---
{
  const { data, error } = await anon.from('properties').select('id,landlord_id').limit(5)
  const leaked = (data ?? []).length > 0
  if (leaked) {
    record('anon_properties', 'failed', 'Anonymous client returned properties rows', {
      count: data.length,
    })
  } else {
    record('anon_properties', 'passed', 'Anonymous select on properties returned no rows', {
      error: error?.message ?? null,
      count: 0,
    })
  }
}

{
  const { data, error } = await anon
    .from('maintenance_requests')
    .select('id,landlord_id')
    .limit(5)
  const leaked = (data ?? []).length > 0
  if (leaked) {
    record('anon_tickets', 'failed', 'Anonymous client returned maintenance_requests', {
      count: data.length,
    })
  } else {
    record('anon_tickets', 'passed', 'Anonymous select on maintenance_requests returned no rows', {
      error: error?.message ?? null,
    })
  }
}

if (!LA1_PASSWORD || !LA2_PASSWORD) {
  finish('blocked', 2)
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(error?.message || 'No session')
  }
  return client
}

let la1
let la2
try {
  la1 = await signIn(LA1_EMAIL, LA1_PASSWORD)
  record('login_la1', 'passed', `Signed in as ${LA1_EMAIL}`)
} catch (e) {
  record('login_la1', 'failed', `LA1 login failed: ${e.message}`)
  finish('failed', 1)
}

try {
  la2 = await signIn(LA2_EMAIL, LA2_PASSWORD)
  record('login_la2', 'passed', `Signed in as ${LA2_EMAIL}`)
} catch (e) {
  record('login_la2', 'failed', `LA2 login failed: ${e.message}`)
  finish('failed', 1)
}

// Correct account scope: each user should see only their landlord's properties (after RLS migration).
async function landlordIdsFrom(client, table) {
  const { data, error } = await client.from(table).select('landlord_id').limit(200)
  if (error) return { error: error.message, ids: [] }
  const ids = [...new Set((data ?? []).map((r) => r.landlord_id).filter(Boolean))]
  return { error: null, ids, count: (data ?? []).length }
}

const la1Props = await landlordIdsFrom(la1, 'properties')
const la2Props = await landlordIdsFrom(la2, 'properties')

if (la1Props.error) {
  record('la1_properties_query', 'failed', la1Props.error)
} else if (la1Props.ids.some((id) => id !== LA1)) {
  record('la1_properties_isolation', 'failed', 'LA1 session returned another landlord_id', {
    ids: la1Props.ids,
  })
} else {
  record('la1_properties_isolation', 'passed', 'LA1 properties scoped to LA1 only', {
    count: la1Props.count,
  })
}

if (la2Props.error) {
  record('la2_properties_query', 'failed', la2Props.error)
} else if (la2Props.ids.some((id) => id !== LA2)) {
  record('la2_properties_isolation', 'failed', 'LA2 session returned another landlord_id', {
    ids: la2Props.ids,
  })
} else {
  record('la2_properties_isolation', 'passed', 'LA2 properties scoped to LA2 only', {
    count: la2Props.count,
  })
}

// Direct cross-tenant read by id (if the other account has any property)
{
  const { data: other } = await la2.from('properties').select('id,landlord_id').eq('landlord_id', LA2).limit(1)
  const targetId = other?.[0]?.id
  if (!targetId) {
    record('cross_read_property', 'blocked', 'LA2 has no property row to probe cross-read')
  } else {
    const { data, error } = await la1
      .from('properties')
      .select('id,landlord_id')
      .eq('id', targetId)
      .maybeSingle()
    if (data?.id) {
      record('cross_read_property', 'failed', 'LA1 read LA2 property by id', { targetId })
    } else {
      record('cross_read_property', 'passed', 'LA1 cannot read LA2 property by id', {
        targetId,
        error: error?.message ?? null,
      })
    }
  }
}

// Cross-tenant update attempt (no-op safe: update name to same value only if wrongly allowed)
{
  const { data: other } = await la2.from('properties').select('id,name,landlord_id').eq('landlord_id', LA2).limit(1)
  const row = other?.[0]
  if (!row) {
    record('cross_update_property', 'blocked', 'LA2 has no property row to probe cross-update')
  } else {
    const { data, error } = await la1
      .from('properties')
      .update({ name: row.name })
      .eq('id', row.id)
      .select('id')
    if ((data ?? []).length > 0) {
      record('cross_update_property', 'failed', 'LA1 updated LA2 property', { id: row.id })
    } else {
      record('cross_update_property', 'passed', 'LA1 cannot update LA2 property', {
        id: row.id,
        error: error?.message ?? null,
      })
    }
  }
}

// Tickets isolation
{
  const t1 = await landlordIdsFrom(la1, 'maintenance_requests')
  const t2 = await landlordIdsFrom(la2, 'maintenance_requests')
  if (!t1.error && t1.ids.some((id) => id !== LA1)) {
    record('la1_tickets_isolation', 'failed', 'LA1 saw foreign landlord tickets', { ids: t1.ids })
  } else if (!t1.error) {
    record('la1_tickets_isolation', 'passed', 'LA1 tickets scoped to LA1', { count: t1.count })
  } else {
    record('la1_tickets_isolation', 'failed', t1.error)
  }
  if (!t2.error && t2.ids.some((id) => id !== LA2)) {
    record('la2_tickets_isolation', 'failed', 'LA2 saw foreign landlord tickets', { ids: t2.ids })
  } else if (!t2.error) {
    record('la2_tickets_isolation', 'passed', 'LA2 tickets scoped to LA2', { count: t2.count })
  } else {
    record('la2_tickets_isolation', 'failed', t2.error)
  }
}

await la1.auth.signOut()
await la2.auth.signOut()

const failed = results.some((r) => r.status === 'failed')
const blocked = results.some((r) => r.status === 'blocked')
if (failed) finish('failed', 1)
if (blocked) finish('blocked', 2)
finish('passed', 0)
