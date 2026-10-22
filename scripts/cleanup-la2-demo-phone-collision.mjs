#!/usr/bin/env node
/**
 * Optional cleanup: clear obsolete Try Demo Visitor binding for the LA2
 * dedicated tenant test handset (+19088843069) so Demo roster no longer
 * collides with LA2 SMS journey traffic.
 *
 * Does NOT touch Limited Alpha 1 rows.
 *
 * Usage (report only):
 *   node scripts/cleanup-la2-demo-phone-collision.mjs
 *
 * Apply (requires explicit flag):
 *   APPLY=1 node scripts/cleanup-la2-demo-phone-collision.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEMO = 'de300000-0000-4000-8000-000000000001'
const LA1 = 'de300000-0000-4000-8000-000000000003'
const LA2 = 'de300000-0000-4000-8000-000000000004'
const TENANT = '+19088843069'
const APPLY = process.env.APPLY === '1'

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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
}

loadEnvFile(resolve(process.cwd(), '.env'))
loadEnvFile(resolve(process.cwd(), '.env.local'))

const URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!URL || !SERVICE) {
  console.error('Missing SUPABASE URL / service role')
  process.exit(2)
}

const sb = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const digits = TENANT.slice(-10)

console.log(APPLY ? 'APPLY mode' : 'REPORT only (set APPLY=1 to write)')
console.log('Target tenant phone', TENANT)
console.log('LA1 untouched:', LA1)

const { data: demoUsers } = await sb
  .from('users')
  .select('id, full_name, phone, landlord_id')
  .eq('landlord_id', DEMO)
  .or(`phone.eq.${TENANT},phone.ilike.%${digits}%`)

const { data: demoIds } = await sb
  .from('sms_identities')
  .select('id, phone_number, landlord_id, resident_id, identity_type')
  .eq('landlord_id', DEMO)
  .ilike('phone_number', `%${digits}%`)

const { data: la2Users } = await sb
  .from('users')
  .select('id, full_name, phone, landlord_id')
  .eq('landlord_id', LA2)
  .or(`phone.eq.${TENANT},phone.ilike.%${digits}%`)

console.log('\nDemo users matching phone:', demoUsers)
console.log('Demo sms_identities:', demoIds)
console.log('LA2 users matching phone (must remain):', la2Users)

if (!APPLY) {
  console.log('\nProposed writes (not applied):')
  console.log('- Clear phone on Demo Try Demo Visitor user(s) matching', TENANT)
  console.log('- Clear phone_number on Demo sms_identities for that phone (unlink only)')
  console.log('- Leave LA1 / LA2 / other landlords untouched')
  process.exit(0)
}

if (!la2Users?.length) {
  console.error('Refusing APPLY: no LA2 resident with this phone — not a confirmed LA2 test collision')
  process.exit(1)
}

for (const user of demoUsers ?? []) {
  const { error } = await sb
    .from('users')
    .update({ phone: null })
    .eq('id', user.id)
    .eq('landlord_id', DEMO)
  if (error) {
    console.error('Failed clearing demo user phone', user.id, error.message)
    process.exit(1)
  }
  console.log('Cleared phone on demo user', user.id)
}

for (const identity of demoIds ?? []) {
  // Soft-unlink: blank phone so Demo no longer matches this handset.
  // Do not delete the row (audit / history).
  const { error } = await sb
    .from('sms_identities')
    .update({ phone_number: `retired-demo-${identity.id.slice(0, 8)}` })
    .eq('id', identity.id)
    .eq('landlord_id', DEMO)
  if (error) {
    console.error('Failed retiring demo identity phone', identity.id, error.message)
    process.exit(1)
  }
  console.log('Retired demo sms_identity phone', identity.id)
}

console.log('\nDone. LA1 untouched. Re-run SMS identity routing probe after deploy.')
