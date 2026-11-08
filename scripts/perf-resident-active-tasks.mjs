#!/usr/bin/env node
/**
 * Browser-console / Node-friendly timings for Active Tasks + resident profile
 * data paths. Run after signing into the admin app:
 *
 *   node scripts/perf-resident-active-tasks.mjs
 *
 * Or paste the MEASURE_SNIPPET into DevTools on /admin/workflows and a resident
 * profile, then call window.__uloPerfActiveTasks() / window.__uloPerfResident().
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const out = {}
  for (const file of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
        if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      }
    } catch {
      /* missing is fine */
    }
  }
  return out
}

const env = loadEnv()
const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
const landlordId = process.env.LANDLORD_ID?.trim() || ''
const residentId = process.env.RESIDENT_ID?.trim() || ''

if (!url || !anon) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(url, anon)

async function time(label, fn) {
  const start = performance.now()
  const value = await fn()
  const ms = Math.round(performance.now() - start)
  console.log(`${label}: ${ms}ms`)
  return { ms, value }
}

async function measureActiveTasks() {
  if (!landlordId) {
    console.log('Skip Active Tasks: set LANDLORD_ID')
    return
  }
  console.log(`\nActive Tasks (landlord=${landlordId})`)
  const runs = await time('workflow_runs (limit 250)', async () => {
    const { data, error } = await supabase
      .from('workflow_runs')
      .select('id, resident_id, unit_id, status, started_at')
      .eq('landlord_id', landlordId)
      .order('started_at', { ascending: false })
      .limit(250)
    if (error) throw error
    return data ?? []
  })
  const runIds = runs.value.map((r) => r.id).filter(Boolean)
  await time(`workflow_events (runs=${runIds.length}, limit 2000)`, async () => {
    if (!runIds.length) return []
    const { data, error } = await supabase
      .from('workflow_events')
      .select('id, workflow_run_id, event_type, created_at')
      .in('workflow_run_id', runIds.slice(0, 100))
      .order('created_at', { ascending: true })
      .limit(2000)
    if (error) throw error
    return data ?? []
  })
}

async function measureResidentProfile() {
  if (!landlordId || !residentId) {
    console.log('Skip resident profile: set LANDLORD_ID and RESIDENT_ID')
    return
  }
  console.log(`\nResident profile (landlord=${landlordId} resident=${residentId})`)
  await time('users row', async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, phone, unit, building, rent_due_day')
      .eq('landlord_id', landlordId)
      .eq('id', residentId)
      .maybeSingle()
    if (error) throw error
    return data
  })
  await time('sms_conversations (limit 10)', async () => {
    const { data, error } = await supabase
      .from('sms_conversations')
      .select('id, conversation_type, updated_at, status')
      .eq('landlord_id', landlordId)
      .eq('resident_id', residentId)
      .order('updated_at', { ascending: false })
      .limit(10)
    if (error) throw error
    return data ?? []
  })
  await time('resident-scoped workflow_runs', async () => {
    const { data, error } = await supabase
      .from('workflow_runs')
      .select('id, status, template_id, started_at')
      .eq('landlord_id', landlordId)
      .eq('resident_id', residentId)
      .in('status', ['active', 'escalated'])
      .order('started_at', { ascending: false })
      .limit(40)
    if (error) throw error
    return data ?? []
  })
  await time('operations timeline (limit 120)', async () => {
    const { data, error } = await supabase
      .from('operations_graph_events')
      .select('id, event_type, created_at')
      .eq('landlord_id', landlordId)
      .eq('resident_id', residentId)
      .order('created_at', { ascending: false })
      .limit(120)
    if (error) throw error
    return data ?? []
  })
}

const note = `
Note: anon key queries are RLS-scoped. Without a user session this may return
0 rows / RLS errors. Prefer DevTools timings after login:
  [active-tasks] dashboard hydrate …ms
  [resident-profile] background hydrate …ms
`

async function main() {
  console.log(note.trim())
  try {
    await measureActiveTasks()
    await measureResidentProfile()
  } catch (error) {
    console.error('\nProbe failed (often RLS without session):', error.message || error)
    process.exitCode = 0
  }
}

void main()
