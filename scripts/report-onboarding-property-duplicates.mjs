#!/usr/bin/env node
/**
 * Readonly report of duplicate/equivalent onboarding properties for a landlord.
 * Does NOT delete or merge rows — review before any heal.
 *
 * Usage:
 *   LANDLORD_ID=de300000-0000-4000-8000-000000000004 \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/report-onboarding-property-duplicates.mjs
 */
import { createClient } from '@supabase/supabase-js'

function normalizeStreet(street) {
  let s = String(street ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
  const reps = [
    [/\b(street|st)\b/g, 'st'],
    [/\b(avenue|ave)\b/g, 'ave'],
    [/\b(boulevard|blvd)\b/g, 'blvd'],
    [/\b(drive|dr)\b/g, 'dr'],
    [/\b(road|rd)\b/g, 'rd'],
  ]
  for (const [re, to] of reps) s = s.replace(re, to)
  return s.replace(/\s+/g, ' ').trim()
}

function addressKey(row) {
  const street = normalizeStreet(row.street_address)
  if (!street) return ''
  const city = String(row.city ?? '')
    .trim()
    .toLowerCase()
  const state = String(row.state ?? '')
    .trim()
    .toUpperCase()
  const zip = String(row.zip_code ?? '')
    .replace(/\D/g, '')
    .slice(0, 5)
  return `${street}|${city}|${state}|${zip}`
}

async function main() {
  const landlordId = process.env.LANDLORD_ID?.trim()
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!landlordId || !url || !key) {
    console.error('Need LANDLORD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data: properties, error } = await supabase
    .from('properties')
    .select(
      'id, name, street_address, city, state, zip_code, onboarding_session_id, created_at, updated_at',
    )
    .eq('landlord_id', landlordId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error.message)
    process.exit(1)
  }

  const byAddress = new Map()
  for (const row of properties ?? []) {
    const keyAddr = addressKey(row)
    if (!keyAddr) continue
    const list = byAddress.get(keyAddr) ?? []
    list.push(row)
    byAddress.set(keyAddr, list)
  }

  const groups = [...byAddress.entries()].filter(([, rows]) => rows.length > 1)
  console.log(
    JSON.stringify(
      {
        landlordId,
        propertyCount: (properties ?? []).length,
        duplicateAddressGroups: groups.length,
        groups: groups.map(([keyAddr, rows]) => ({
          addressKey: keyAddr,
          recommendedSurvivorId: rows[0].id,
          reason: 'Keep earliest stable id for equivalent verified address; do not pick newest-only.',
          rows: rows.map((row) => ({
            id: row.id,
            name: row.name,
            street_address: row.street_address,
            city: row.city,
            state: row.state,
            zip_code: row.zip_code,
            onboarding_session_id: row.onboarding_session_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
          })),
        })),
        nameOnlyProperties: (properties ?? [])
          .filter((row) => !addressKey(row))
          .map((row) => ({
            id: row.id,
            name: row.name,
            onboarding_session_id: row.onboarding_session_id,
            created_at: row.created_at,
          })),
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
