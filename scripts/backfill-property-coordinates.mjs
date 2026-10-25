/**
 * One-time Census geocode for properties that have no coordinates.
 *
 *   node scripts/backfill-property-coordinates.mjs --dry-run
 *   node scripts/backfill-property-coordinates.mjs --write
 *
 * Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment.
 * Limited Alpha 1 is never updated. Failures are logged and skipped.
 * The address lookup matches geocodeUsAddress in propertyOutdoorTemp.ts.
 */
import { createClient } from '@supabase/supabase-js'

const LA1 = 'de300000-0000-4000-8000-000000000003'
const dryRun = !process.argv.includes('--write')

const url = process.env.SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}

const US = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
])

async function geocode(address) {
  const endpoint =
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
    `?address=${encodeURIComponent(address)}` +
    '&benchmark=Public_AR_Current&vintage=Current_Current&format=json'
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } })
  if (!response.ok) return null
  const body = await response.json()
  const coords = body?.result?.addressMatches?.[0]?.coordinates
  if (typeof coords?.y !== 'number' || typeof coords?.x !== 'number') return null
  return { lat: coords.y, lon: coords.x }
}

const supabase = createClient(url, key)
const { data, error } = await supabase
  .from('properties')
  .select('id, landlord_id, name, street_address, city, state, zip_code, latitude, longitude')
  .limit(5000)
if (error) {
  console.error(error.message)
  process.exit(1)
}

let saved = 0
let skipped = 0
for (const row of data ?? []) {
  if (row.landlord_id === LA1) {
    console.log(`skip LA1 ${row.id}`)
    skipped += 1
    continue
  }
  if (row.latitude != null && row.longitude != null) {
    skipped += 1
    continue
  }
  const address = [row.street_address, row.city, row.state, row.zip_code].filter(Boolean).join(', ')
  const state = String(row.state ?? '').trim().toUpperCase()
  let status = 'not_found'
  let coords = null
  if (state && !US.has(state)) status = 'non_us'
  else if (address) {
    try {
      coords = await geocode(address)
      status = coords ? 'ok' : 'not_found'
    } catch (err) {
      console.error(`geocode failed ${row.id}`, err instanceof Error ? err.message : err)
      continue
    }
  }
  console.log(`${dryRun ? 'dry-run' : 'save'} ${row.name ?? row.id} ${status}`)
  if (dryRun) continue
  const { error: updateError } = await supabase
    .from('properties')
    .update({
      latitude: coords?.lat ?? null,
      longitude: coords?.lon ?? null,
      geocoded_at: new Date().toISOString(),
      geocode_status: status,
    })
    .eq('id', row.id)
  if (updateError) {
    console.error(`save failed ${row.id}`, updateError.message)
    continue
  }
  saved += 1
}

console.log(JSON.stringify({ dryRun, saved, skipped, scanned: (data ?? []).length }))
