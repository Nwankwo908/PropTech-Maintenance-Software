#!/usr/bin/env node
/**
 * Report-only: find single-family properties whose lease/resident/unit rows
 * still store an invented unit label ("1" / "Unit 1") from DEFAULT_LEASE_UNIT.
 *
 * Usage:
 *   node scripts/audit-sfh-invented-unit-one.mjs
 *   LANDLORD_ID=... node scripts/audit-sfh-invented-unit-one.mjs
 *
 * Does not heal. Review the report before any data correction.
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const __dirname = dirname(fileURLToPath(import.meta.url))
const LANDLORD_ID = (process.env.LANDLORD_ID ?? '').trim() || null

try {
  for (const line of readFileSync(resolve(__dirname, '../.env'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
} catch {
  // optional .env
}

async function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }
  const out = execSync(
    `npx supabase projects api-keys --project-ref ${PROJECT_REF} -o json`,
    { encoding: 'utf8' },
  )
  const keys = JSON.parse(out)
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('service_role key not found')
  return sr.api_key
}

function isInventedUnitOne(raw) {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^unit\s+/, '')
    .replace(/^#/, '')
    .trim()
  return t === '1'
}

function isSfhType(raw) {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return (
    t === 'single_family' ||
    t === 'single_family_home' ||
    t === 'sfr' ||
    t === 'sfh' ||
    t === 'singlefamily' ||
    t === 'single_family_residence'
  )
}

const supabase = createClient(
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim(),
  await serviceRoleKey(),
  { auth: { persistSession: false } },
)

let propQuery = supabase
  .from('properties')
  .select('id, name, property_type, landlord_id, street_address')
  .limit(5000)
if (LANDLORD_ID) propQuery = propQuery.eq('landlord_id', LANDLORD_ID)

const { data: properties, error: propErr } = await propQuery
if (propErr) throw propErr

const sfh = (properties ?? []).filter((p) => isSfhType(p.property_type))
const sfhIds = sfh.map((p) => p.id)
const sfhById = new Map(sfh.map((p) => [p.id, p]))

console.log(
  JSON.stringify(
    {
      scope: LANDLORD_ID ?? 'all_landlords',
      sfh_property_count: sfh.length,
      invented_unit_one_note:
        'Matches stored unit labels that normalize to "1" on SFH properties (DEFAULT_LEASE_UNIT invention).',
    },
    null,
    2,
  ),
)

if (sfhIds.length === 0) {
  console.log(JSON.stringify({ residents: [], units: [], summary: { residents: 0, units: 0 } }, null, 2))
  process.exit(0)
}

const { data: units, error: unitsErr } = await supabase
  .from('units')
  .select('id, unit_label, property_id, landlord_id, building')
  .in('property_id', sfhIds)
  .limit(10000)
if (unitsErr) throw unitsErr

const inventedUnits = (units ?? []).filter((u) => isInventedUnitOne(u.unit_label))

const landlordIds = [...new Set(sfh.map((p) => p.landlord_id).filter(Boolean))]
const { data: residents, error: resErr } = await supabase
  .from('users')
  .select('id, full_name, unit, building, landlord_id')
  .in('landlord_id', landlordIds)
  .limit(20000)
if (resErr) throw resErr

const inventedResidents = []
for (const r of residents ?? []) {
  if (!isInventedUnitOne(r.unit)) continue
  const building = String(r.building ?? '')
    .trim()
    .toLowerCase()
  if (!building) continue
  const match = sfh.find((p) => {
    if (p.landlord_id !== r.landlord_id) return false
    const name = String(p.name ?? '')
      .trim()
      .toLowerCase()
    const street = String(p.street_address ?? '')
      .trim()
      .toLowerCase()
    return (
      (name && (building === name || building.includes(name) || name.includes(building))) ||
      (street && (building === street || building.includes(street) || street.includes(building)))
    )
  })
  if (match) {
    inventedResidents.push({
      resident_id: r.id,
      full_name: r.full_name,
      unit: r.unit,
      building: r.building,
      landlord_id: r.landlord_id,
      property_id: match.id,
      property_name: match.name,
      match: 'building_name',
    })
  }
}

const unitReport = inventedUnits.map((u) => ({
  unit_id: u.id,
  unit_label: u.unit_label,
  property_id: u.property_id,
  property_name: sfhById.get(u.property_id)?.name ?? null,
  landlord_id: u.landlord_id,
  building: u.building,
}))

console.log(
  JSON.stringify(
    {
      summary: {
        sfh_properties: sfh.length,
        invented_unit_rows: unitReport.length,
        invented_resident_rows: inventedResidents.length,
      },
      units: unitReport,
      residents: inventedResidents,
    },
    null,
    2,
  ),
)
