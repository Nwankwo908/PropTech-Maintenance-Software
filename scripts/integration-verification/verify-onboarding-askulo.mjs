#!/usr/bin/env node
/**
 * Onboarding inventory + Ask Ulo priorities against saved LA2 records (read-mostly).
 *
 * - Asserts LA2 has durable properties/units/residents consistent with roster reads.
 * - Runs Ask Ulo gold-set / reasoning-first Deno suites (no live chat SMS).
 * - Does not modify Limited Alpha 1.
 *
 * Exit: 0 passed | 1 failed | 2 blocked
 */
import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT_DIR = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT_DIR, { recursive: true })

const LA2 = 'de300000-0000-4000-8000-000000000004'
const LA2_EMAIL = 'limitedalpha2@ulohome.io'

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
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value
  }
}

loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const LA2_PASSWORD = (process.env.INTEGRATION_LA2_PASSWORD || '').trim()

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}

function finish(overall, code) {
  const payload = {
    area: 'onboarding-askulo',
    overall,
    finishedAt: new Date().toISOString(),
    landlordId: LA2,
    results,
    boundaries: [
      'LA2 read/session only — LA1 never used.',
      'Ask Ulo suites are deterministic routing evidence, not live SMS/chat retrieval of today’s priorities.',
      'Lease import live Gemini extract not claimed here.',
    ],
  }
  writeFileSync(resolve(OUT_DIR, 'onboarding-askulo.json'), JSON.stringify(payload, null, 2) + '\n')
  console.log(`\nOverall onboarding-askulo: ${overall} (exit ${code})`)
  process.exit(code)
}

if (!SUPABASE_URL || !SERVICE || !ANON || !LA2_PASSWORD) {
  record('prereq', 'blocked', 'Need URL, service role, anon key, INTEGRATION_LA2_PASSWORD')
  finish('blocked', 2)
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: props, error: pErr } = await admin
  .from('properties')
  .select('id,name,street_address,landlord_id')
  .eq('landlord_id', LA2)
if (pErr) {
  record('saved_properties', 'failed', pErr.message)
  finish('failed', 1)
}
if (!props?.length) {
  record('saved_properties', 'failed', 'LA2 has no saved properties')
  finish('failed', 1)
}
record('saved_properties', 'passed', `LA2 has ${props.length} property row(s)`, {
  count: props.length,
})

const { data: units } = await admin
  .from('units')
  .select('id,property_id,unit_label,landlord_id')
  .eq('landlord_id', LA2)
const orphanUnits = (units || []).filter((u) => !props.some((p) => p.id === u.property_id))
if (orphanUnits.length) {
  record('saved_units_scope', 'failed', 'LA2 units point at unknown properties', {
    orphan: orphanUnits.length,
  })
} else {
  record('saved_units_scope', 'passed', `LA2 units (${units?.length || 0}) match properties`)
}

const { data: residents } = await admin
  .from('users')
  .select('id,full_name,phone,landlord_id,role')
  .eq('landlord_id', LA2)
  .eq('role', 'resident')
record('saved_residents', 'passed', `LA2 residents: ${residents?.length || 0}`, {
  count: residents?.length || 0,
})

{
  const c = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await c.auth.signInWithPassword({
    email: LA2_EMAIL,
    password: LA2_PASSWORD,
  })
  if (error || !data.session) {
    record('la2_session', 'failed', error?.message || 'no session')
  } else {
    const { data: sessionProps, error: spErr } = await c
      .from('properties')
      .select('id,landlord_id')
    if (spErr) {
      record('la2_session_properties', 'failed', spErr.message)
    } else if ((sessionProps || []).some((r) => r.landlord_id !== LA2)) {
      record('la2_session_properties', 'failed', 'Session returned foreign landlord_id')
    } else {
      record('la2_session_properties', 'passed', 'LA2 session properties scoped to LA2', {
        count: sessionProps?.length || 0,
      })
    }
    await c.auth.signOut()
  }
}

{
  const onboarding = await admin
    .from('landlord_onboarding')
    .select('landlord_id,completed_at,onboarding_status')
    .eq('landlord_id', LA2)
    .maybeSingle()
  if (onboarding.error) {
    record('onboarding_row', 'failed', onboarding.error.message)
  } else if (!onboarding.data?.completed_at) {
    record(
      'onboarding_row',
      'partial',
      'LA2 landlord_onboarding not completed — inventory may still be partial',
      onboarding.data,
    )
  } else {
    record('onboarding_row', 'passed', 'LA2 onboarding completed_at present', {
      completedAt: onboarding.data.completed_at,
      onboardingStatus: onboarding.data.onboarding_status,
    })
  }
}

record(
  'lease_imports_live',
  'not_run',
  'Live Gemini multi-page lease extract against fixtures not executed in this run',
)

{
  const gold = spawnSync(
    'deno',
    [
      'test',
      '--no-check',
      '--allow-read',
      '--allow-env',
      'supabase/functions/_shared/ask_ulo/tests/misc/askUloGoldSet_test.ts',
      'supabase/functions/_shared/ask_ulo/tests/tools/reasoningFirst_test.ts',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  if (gold.status === 0) {
    record(
      'ask_ulo_priorities_routing',
      'passed',
      'Gold-set + reasoning-first: prioritize-today → executive_briefing (unit routing only)',
    )
  } else {
    record('ask_ulo_priorities_routing', 'failed', gold.stderr?.slice(-500) || gold.stdout?.slice(-500) || 'deno failed')
  }
  record(
    'ask_ulo_live_retrieval',
    'not_run',
    'Cross-system SMS/chat retrieval of emergencies/deadlines/visits against live LA2 data not executed',
  )
}

const failed = results.some((r) => r.status === 'failed')
const blocked = results.some((r) => r.status === 'blocked')
if (failed) finish('failed', 1)
if (blocked) finish('blocked', 2)
finish(
  results.some((r) => r.status === 'partial' || r.status === 'not_run') ? 'partial' : 'passed',
  0,
)
