#!/usr/bin/env node
/**
 * Seed Twilio as the primary SMS provider and assign a Twilio number as the
 * landlord_main line. Mirror of scripts/seed-telnyx-primary.mjs, but env-driven
 * (no hardcoded number) so it works with whatever Twilio number you provision.
 *
 * Required env (from .env or shell):
 *   TWILIO_FROM_NUMBER            E.164 Twilio number, e.g. +14155551234
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY     (or resolved via `supabase projects api-keys`)
 * Optional env:
 *   TWILIO_MESSAGING_SERVICE_SID  set instead of / alongside the number
 *   SMS_LANDLORD_ID               target landlord uuid (defaults below)
 *
 * Usage:
 *   TWILIO_FROM_NUMBER=+1415... SMS_LANDLORD_ID=<uuid> node scripts/seed-twilio-primary.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
/** Ulo Operations — default staff tenant (matches VITE_DEFAULT_LANDLORD_ID). */
const ULO_OPERATIONS_LANDLORD_ID = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
/** New Landlord (empty) showcase account — post-onboarding activation target. */
const EMPTY_LANDLORD_ID = 'de300000-0000-4000-8000-000000000002'

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

const TWILIO_NUMBER = process.env.TWILIO_FROM_NUMBER?.trim()
const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null
const SMS_LANDLORD_ID =
  process.env.SMS_LANDLORD_ID?.trim() ||
  process.env.VITE_DEFAULT_LANDLORD_ID?.trim() ||
  ULO_OPERATIONS_LANDLORD_ID

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

async function resolveServiceRoleKey() {
  if (SERVICE_ROLE_KEY) return SERVICE_ROLE_KEY
  const { execSync } = await import('node:child_process')
  const json = execSync(
    `supabase projects api-keys --project-ref ${PROJECT_REF} -o json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const keys = JSON.parse(json)
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve Supabase service_role key')
  return sr.api_key
}

async function main() {
  if (!TWILIO_NUMBER) {
    throw new Error('Missing TWILIO_FROM_NUMBER (E.164, e.g. +14155551234)')
  }
  if (!SUPABASE_URL) {
    throw new Error('Missing SUPABASE_URL / VITE_SUPABASE_URL')
  }

  const serviceRoleKey = await resolveServiceRoleKey()
  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Flip provider precedence: Telnyx off, Twilio on (primary).
  await supabase.from('sms_providers').update({ active: false }).eq('name', 'telnyx')

  const { error: providerError } = await supabase.from('sms_providers').upsert(
    {
      name: 'twilio',
      active: true,
      config: {
        from_number: TWILIO_NUMBER,
        messaging_service_sid: MESSAGING_SERVICE_SID,
        primary: true,
      },
    },
    { onConflict: 'name' },
  )
  if (providerError) throw new Error(`sms_providers: ${providerError.message}`)

  const { data: existing, error: lookupError } = await supabase
    .from('sms_numbers')
    .select('id, landlord_id, purpose, status')
    .eq('phone_number', TWILIO_NUMBER)
    .maybeSingle()

  if (lookupError) throw new Error(`sms_numbers lookup: ${lookupError.message}`)

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('sms_numbers')
      .update({
        provider: 'twilio',
        purpose: 'landlord_main',
        status: 'active',
        landlord_id: SMS_LANDLORD_ID,
        provider_messaging_service_sid: MESSAGING_SERVICE_SID,
      })
      .eq('id', existing.id)
    if (updateError) throw new Error(`sms_numbers update: ${updateError.message}`)
    console.log(
      `OK    ${TWILIO_NUMBER} active on landlord ${SMS_LANDLORD_ID} (provider: twilio)`,
    )
    return
  }

  const { error: insertError } = await supabase.from('sms_numbers').upsert(
    {
      phone_number: TWILIO_NUMBER,
      provider: 'twilio',
      status: 'active',
      purpose: 'landlord_main',
      landlord_id: SMS_LANDLORD_ID,
      provider_number_sid: null,
      provider_messaging_service_sid: MESSAGING_SERVICE_SID,
    },
    { onConflict: 'phone_number' },
  )
  if (insertError) throw new Error(`sms_numbers: ${insertError.message}`)

  console.log(
    `OK    Twilio number ${TWILIO_NUMBER} assigned as landlord_main for ${SMS_LANDLORD_ID}`,
  )
  console.log(`      (New Landlord empty account id = ${EMPTY_LANDLORD_ID})`)
}

main().catch((err) => {
  console.error(`FAIL  ${err.message}`)
  process.exit(1)
})
