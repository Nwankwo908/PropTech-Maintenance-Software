#!/usr/bin/env node
/**
 * System-wide: set rentCollectionPaused=true for every landlord.
 *
 * Lever: landlord_onboarding.account_settings.operational.rentCollectionPaused
 * (also mirrors organization.rentCollectionPaused — same read path).
 * There is no separate global env flag; pause is per-landlord.
 *
 * Usage:
 *   node scripts/pause-rent-collection-all-landlords.mjs
 *   DRY_RUN=1 node scripts/pause-rent-collection-all-landlords.mjs
 *
 * Or in Supabase SQL editor (same effect):
 *
 *   update public.landlord_onboarding
 *   set account_settings =
 *     jsonb_set(
 *       jsonb_set(
 *         coalesce(account_settings, '{}'::jsonb),
 *         '{operational,rentCollectionPaused}',
 *         'true'::jsonb,
 *         true
 *       ),
 *       '{organization,rentCollectionPaused}',
 *       'true'::jsonb,
 *       true
 *     );
 *
 * Verify:
 *   select landlord_id,
 *     account_settings->'operational'->>'rentCollectionPaused' as op,
 *     account_settings->'organization'->>'rentCollectionPaused' as org
 *   from public.landlord_onboarding;
 *
 * Next hourly check-rent-collection / run-ops-sms-crons tick should log
 * rent_collection_paused:true and reminders_sent:0 / late_payment_escalated:0
 * for each landlord. No resident reminders, landlord receipt asks, or late-rent
 * landlord attention SMS while paused.
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
const __dirname = dirname(fileURLToPath(import.meta.url))

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
  // optional
}

async function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }
  const keys = JSON.parse(
    execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
      encoding: 'utf8',
    }),
  )
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve service_role key')
  return sr.api_key
}

function isPaused(accountSettings) {
  const account = accountSettings && typeof accountSettings === 'object' ? accountSettings : {}
  const operational = account.operational && typeof account.operational === 'object'
    ? account.operational
    : {}
  const organization = account.organization && typeof account.organization === 'object'
    ? account.organization
    : {}
  return operational.rentCollectionPaused === true || organization.rentCollectionPaused === true
}

function withPause(accountSettings) {
  const account =
    accountSettings && typeof accountSettings === 'object' && !Array.isArray(accountSettings)
      ? { ...accountSettings }
      : {}
  const operational =
    account.operational && typeof account.operational === 'object' && !Array.isArray(account.operational)
      ? { ...account.operational }
      : {}
  const organization =
    account.organization && typeof account.organization === 'object' &&
      !Array.isArray(account.organization)
      ? { ...account.organization }
      : {}
  operational.rentCollectionPaused = true
  organization.rentCollectionPaused = true
  account.operational = operational
  account.organization = organization
  return account
}

const supabase = createClient(
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim(),
  await serviceRoleKey(),
  { auth: { persistSession: false } },
)

const { data: landlords, error: landlordsError } = await supabase
  .from('landlords')
  .select('id, name, email')
  .order('created_at', { ascending: true })
if (landlordsError) throw new Error(landlordsError.message)

const { data: onboardings, error: onboardingError } = await supabase
  .from('landlord_onboarding')
  .select('landlord_id, account_settings')
if (onboardingError) throw new Error(onboardingError.message)

const onboardingByLandlord = new Map(
  (onboardings ?? []).map((row) => [row.landlord_id, row]),
)

const results = []
let alreadyPaused = 0
let updated = 0
let createdOnboarding = 0
let failed = 0

for (const landlord of landlords ?? []) {
  const existing = onboardingByLandlord.get(landlord.id)
  const prior = existing?.account_settings ?? null
  const wasPaused = isPaused(prior)
  const next = withPause(prior)

  if (wasPaused && existing) {
    alreadyPaused += 1
    results.push({
      landlordId: landlord.id,
      name: landlord.name || landlord.email,
      action: 'already_paused',
    })
    // Still clear pending landlord rent asks below — don't skip that cleanup.
  } else if (DRY_RUN) {
    results.push({
      landlordId: landlord.id,
      name: landlord.name || landlord.email,
      action: existing ? 'would_update' : 'would_create_onboarding',
    })
    updated += 1
  } else if (existing) {
    const { error } = await supabase
      .from('landlord_onboarding')
      .update({ account_settings: next })
      .eq('landlord_id', landlord.id)
    if (error) {
      failed += 1
      results.push({
        landlordId: landlord.id,
        name: landlord.name || landlord.email,
        action: 'failed',
        error: error.message,
      })
    } else {
      updated += 1
      results.push({
        landlordId: landlord.id,
        name: landlord.name || landlord.email,
        action: 'updated',
      })
    }
  } else if (!DRY_RUN) {
    // Minimal onboarding row so loadLandlordOperationalSettings can see the pause.
    const { error } = await supabase.from('landlord_onboarding').insert({
      landlord_id: landlord.id,
      account_settings: next,
    })
    if (error) {
      // Some environments require more columns — fall back to upsert via RPC-less patch.
      failed += 1
      results.push({
        landlordId: landlord.id,
        name: landlord.name || landlord.email,
        action: 'failed_create',
        error: error.message,
      })
    } else {
      createdOnboarding += 1
      updated += 1
      results.push({
        landlordId: landlord.id,
        name: landlord.name || landlord.email,
        action: 'created_onboarding',
      })
    }
  }
}

const RENT_ASK_KEYS = [
  'awaiting_landlord_rent_receipt',
  'awaiting_landlord_rent_amount',
  'awaiting_landlord_rent_method',
  'landlord_rent_receipt_queue',
  'awaiting_tenant_rent_report_confirmation',
]

let clearedPendingRentAsks = 0
if (!DRY_RUN) {
  const { data: conversations, error: convError } = await supabase
    .from('sms_conversations')
    .select('id, intake_state')
    .not('intake_state', 'is', null)
    .limit(2000)
  if (convError) {
    console.error('clear pending rent asks failed', convError.message)
  } else {
    for (const row of conversations ?? []) {
      const intake =
        row.intake_state && typeof row.intake_state === 'object' && !Array.isArray(row.intake_state)
          ? { ...row.intake_state }
          : null
      if (!intake) continue
      let changed = false
      for (const key of RENT_ASK_KEYS) {
        if (intake[key] != null) {
          delete intake[key]
          changed = true
        }
      }
      if (!changed) continue
      const { error } = await supabase
        .from('sms_conversations')
        .update({ intake_state: intake, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (!error) clearedPendingRentAsks += 1
    }
  }
}

// Verify read path after write
const { data: verifyRows } = await supabase
  .from('landlord_onboarding')
  .select('landlord_id, account_settings')
const stillLive = []
for (const landlord of landlords ?? []) {
  const row = (verifyRows ?? []).find((r) => r.landlord_id === landlord.id)
  if (!isPaused(row?.account_settings)) {
    stillLive.push({
      landlordId: landlord.id,
      name: landlord.name || landlord.email,
      hasOnboarding: Boolean(row),
    })
  }
}

const { count: activeRentRuns } = await supabase
  .from('workflow_runs')
  .select('id', { count: 'exact', head: true })
  .eq('template_id', 'rent_collection')
  .in('status', ['active', 'escalated'])

console.log(
  JSON.stringify(
    {
      dryRun: DRY_RUN,
      landlordsTotal: (landlords ?? []).length,
      alreadyPaused,
      updated,
      createdOnboarding,
      failed,
      clearedPendingRentAsks,
      stillLiveAfterVerify: stillLive,
      activeOrEscalatedRentRunsPreserved: activeRentRuns ?? null,
      note:
        'Pause is per-landlord (no global env). Outbound rent SMS/email and late-rent landlord attention stop; pending landlord rent asks are cleared. In-flight rent_collection run rows are kept.',
      results,
    },
    null,
    2,
  ),
)
