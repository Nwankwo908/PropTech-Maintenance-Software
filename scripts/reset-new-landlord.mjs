#!/usr/bin/env node
/**
 * Reset New Landlord showcase account to pristine empty state.
 * Mirrors supabase/seed_new_landlord_reset.sql (service-role path when psql/DATABASE_URL unavailable).
 *
 * Usage:
 *   node scripts/reset-new-landlord.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const NEW_LANDLORD_ID = 'de300000-0000-4000-8000-000000000002'

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

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL / VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env',
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function deleteEq(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value)
  if (error && !/does not exist|Could not find the table/i.test(error.message)) {
    throw new Error(`${table}: ${error.message}`)
  }
}

async function deleteIn(table, column, values) {
  if (!values.length) return
  const { error } = await supabase.from(table).delete().in(column, values)
  if (error && !/does not exist|Could not find the table/i.test(error.message)) {
    throw new Error(`${table}: ${error.message}`)
  }
}

async function main() {
  const { data: ticketRows, error: ticketLoadError } = await supabase
    .from('maintenance_requests')
    .select('id')
    .eq('landlord_id', NEW_LANDLORD_ID)

  if (ticketLoadError) {
    throw new Error(`maintenance_requests load: ${ticketLoadError.message}`)
  }

  const ticketIds = (ticketRows ?? []).map((row) => String(row.id))

  const { data: unitRows, error: unitLoadError } = await supabase
    .from('units')
    .select('id')
    .eq('landlord_id', NEW_LANDLORD_ID)

  if (unitLoadError) {
    throw new Error(`units load: ${unitLoadError.message}`)
  }

  const unitIds = (unitRows ?? []).map((row) => String(row.id))

  await deleteEq('vendor_feedback', 'landlord_id', NEW_LANDLORD_ID)
  await deleteIn('vendor_status_events', 'ticket_id', ticketIds)
  await deleteEq('maintenance_invoices', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('preventive_maintenance_tasks', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('unit_assets', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('operations_graph_events', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('workflow_events', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('workflow_runs', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('maintenance_requests', 'landlord_id', NEW_LANDLORD_ID)
  await deleteIn('occupancy', 'unit_id', unitIds)
  await deleteEq('users', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('vendors', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('units', 'landlord_id', NEW_LANDLORD_ID)
  await deleteEq('landlord_onboarding', 'landlord_id', NEW_LANDLORD_ID)

  console.log(`OK    New Landlord reset — portfolio cleared for ${NEW_LANDLORD_ID}`)
  console.log(`
Next: clear browser localStorage for this account, then refresh:
  localStorage.removeItem('ulo.landlordOnboarding.${NEW_LANDLORD_ID}')
`)
}

main().catch((err) => {
  console.error(`FAIL  ${err.message}`)
  process.exit(1)
})
