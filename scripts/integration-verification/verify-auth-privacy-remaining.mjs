#!/usr/bin/env node
/**
 * Remaining auth/privacy verification (no LA1).
 *
 * 1) Tenant access — real auth.users session (password) for disposable privacy tenant
 * 2) Social login — recorded as needs_user / blocked until browser OAuth completed
 * 3) Phone verification — product uses email OTP; Auth phone OTP N/A; SMS identity separate
 *
 * Service role: fixture setup + unchanged-row audits only.
 * Exit: 0 passed|partial | 1 failed | 2 blocked
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT, { recursive: true })

const LA1 = 'de300000-0000-4000-8000-000000000003'
const LA2 = 'de300000-0000-4000-8000-000000000004'
const LANDLORD_B = 'be300000-0000-4000-8000-00000000b001'
const TENANT_EMAIL = 'privacy-tenant-be300000@ulohome.invalid'
const TENANT_ROW_ID = 'be300000-0000-4000-8000-00000000b020'
const TENANT_PHONE = '+19088843069' // LA2 dedicated test handset (SMS routing only)
const VENDOR_PHONE = '+14708880274'

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
loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const TENANT_PASSWORD = (
  process.env.INTEGRATION_PRIVACY_TENANT_PASSWORD ||
  `TenantPriv-${randomUUID().slice(0, 10)}!aA1`
).trim()

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}
function finish(overall, code) {
  writeFileSync(
    resolve(OUT, 'auth-privacy-remaining.json'),
    JSON.stringify(
      {
        area: 'auth-privacy-remaining',
        overall,
        finishedAt: new Date().toISOString(),
        environment: (() => {
          try {
            return new URL(SUPABASE_URL).host
          } catch {
            return 'invalid'
          }
        })(),
        actors: {
          tenantEmail: TENANT_EMAIL,
          landlordB: LANDLORD_B,
          dedicatedPhones: { tenantSms: TENANT_PHONE, vendorSms: VENDOR_PHONE },
          la1Touched: false,
        },
        results,
        boundaries: [
          'LA1 never signed into / modified / messaged.',
          'No simulated OAuth or phone/email OTP labeled as verified.',
          'Tenant password session is a real auth.users JWT (not a forged token).',
          'Product resident gate is email OTP; Auth phone OTP is not an app feature.',
          'SMS identity routing ≠ phone verification.',
        ],
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\nOverall auth-privacy-remaining: ${overall} (exit ${code})`)
  process.exit(code)
}

if (!SUPABASE_URL || !ANON || !SERVICE) {
  record('prereq', 'blocked', 'Missing URL / anon / service role')
  finish('blocked', 2)
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function userClient(accessToken) {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ---------------------------------------------------------------------------
// 1) Tenant access — real session
// ---------------------------------------------------------------------------
{
  try {
    // Ensure resident row exists on landlord B
    const { data: row } = await admin
      .from('users')
      .select('id,email,landlord_id,balance_due,full_name')
      .eq('id', TENANT_ROW_ID)
      .maybeSingle()
    if (!row) {
      record('tenant_fixture_row', 'blocked', 'Privacy tenant users row missing — run verify:account-privacy-isolated first')
    } else {
      record('tenant_fixture_row', 'passed', 'Privacy tenant roster row present on landlord B', {
        id: row.id,
        landlordId: row.landlord_id,
      })
    }

    // Create or reset real auth user (fixture only)
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    let authUser = (listed.data?.users || []).find(
      (u) => (u.email || '').toLowerCase() === TENANT_EMAIL.toLowerCase(),
    )
    if (!authUser) {
      const created = await admin.auth.admin.createUser({
        email: TENANT_EMAIL,
        password: TENANT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          resident_name: 'Synthetic Privacy Tenant',
          ulo_test_tenant: true,
        },
      })
      if (created.error) throw created.error
      authUser = created.data.user
      record('tenant_auth_user', 'passed', 'Created real auth.users tenant account', {
        userId: authUser.id,
      })
    } else {
      await admin.auth.admin.updateUserById(authUser.id, {
        password: TENANT_PASSWORD,
        email_confirm: true,
      })
      record('tenant_auth_user', 'passed', 'Reset password on existing tenant auth user', {
        userId: authUser.id,
      })
    }

    const browser = createClient(SUPABASE_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: signed, error: se } = await browser.auth.signInWithPassword({
      email: TENANT_EMAIL,
      password: TENANT_PASSWORD,
    })
    if (se || !signed.session) throw new Error(se?.message || 'tenant sign-in failed')
    record('tenant_signin_password', 'passed', 'Tenant signed in with real password session (JWT)', {
      userId: signed.session.user.id,
      email: signed.session.user.email,
    })

    const db = userClient(signed.session.access_token)

    // Permitted: read own resident row by email match (post-migration policy)
    const { data: ownRows, error: ownErr } = await db
      .from('users')
      .select('id,email,landlord_id,balance_due,full_name')
      .eq('email', TENANT_EMAIL)
    const ownOk =
      !ownErr &&
      (ownRows || []).length === 1 &&
      ownRows[0].id === TENANT_ROW_ID &&
      ownRows[0].landlord_id === LANDLORD_B
    record(
      'tenant_read_own_row',
      ownOk ? 'passed' : 'failed',
      ownOk ? 'Tenant can read own users row' : 'Tenant own-row read failed',
      { count: (ownRows || []).length, error: ownErr?.message || null },
    )

    // Permitted: update own non-landlord field (name) — if policy allows
    const priorName = ownRows?.[0]?.full_name || 'Synthetic Privacy Tenant'
    const probeName = `${priorName} [probe]`
    const { error: nameUpErr } = await db
      .from('users')
      .update({ full_name: probeName })
      .eq('id', TENANT_ROW_ID)
    const { data: afterName } = await admin
      .from('users')
      .select('full_name')
      .eq('id', TENANT_ROW_ID)
      .maybeSingle()
    if (afterName?.full_name === probeName) {
      record('tenant_update_own_profile', 'passed', 'Tenant can update own profile field', {})
      await admin.from('users').update({ full_name: priorName }).eq('id', TENANT_ROW_ID)
    } else {
      record(
        'tenant_update_own_profile',
        'partial',
        'Tenant own profile update not applied (policy may be landlord-only write)',
        { error: nameUpErr?.message || null },
      )
    }

    // Deny: other landlord resident by id
    const { data: la2Victim } = await admin
      .from('users')
      .select('id,balance_due,landlord_id,full_name')
      .eq('landlord_id', LA2)
      .neq('email', TENANT_EMAIL)
      .limit(1)
      .maybeSingle()
    if (la2Victim) {
      const before = Number(la2Victim.balance_due)
      const { data: leaked } = await db
        .from('users')
        .select('id,balance_due,email')
        .eq('id', la2Victim.id)
      record(
        'tenant_cannot_read_other_tenant',
        (leaked || []).length === 0 ? 'passed' : 'failed',
        (leaked || []).length === 0
          ? 'Tenant cannot read other tenant row'
          : 'Tenant leaked another tenant row',
        { count: (leaked || []).length },
      )
      await db.from('users').update({ balance_due: before + 50 }).eq('id', la2Victim.id)
      const { data: afterBal } = await admin
        .from('users')
        .select('balance_due')
        .eq('id', la2Victim.id)
        .maybeSingle()
      const unchanged = Number(afterBal?.balance_due) === before
      record(
        'tenant_cannot_update_other_balance',
        unchanged ? 'passed' : 'failed',
        unchanged
          ? 'Rejected cross-tenant balance update left row unchanged'
          : 'Cross-tenant balance change persisted',
        { before, after: afterBal?.balance_due },
      )
      if (!unchanged) {
        await admin.from('users').update({ balance_due: before }).eq('id', la2Victim.id)
      }
    } else {
      record('tenant_cannot_read_other_tenant', 'blocked', 'No LA2 victim resident for cross-tenant probe')
    }

    // Deny: landlord-only properties / portal members / storage other folder
    const { data: props } = await db.from('properties').select('id,landlord_id').limit(5)
    record(
      'tenant_cannot_list_properties',
      (props || []).length === 0 ? 'passed' : 'failed',
      (props || []).length === 0
        ? 'Tenant cannot list properties (landlord-only)'
        : 'Tenant listed properties',
      { count: (props || []).length },
    )

    const { data: members } = await db.from('landlord_portal_members').select('email').limit(5)
    record(
      'tenant_cannot_list_portal_members',
      (members || []).length === 0 ? 'passed' : 'failed',
      (members || []).length === 0
        ? 'Tenant cannot list portal members'
        : 'Tenant listed portal members',
      { count: (members || []).length },
    )

    const { data: la2Files } = await db.storage
      .from('landlord-onboarding-documents')
      .list(LA2, { limit: 5 })
    record(
      'tenant_cannot_list_landlord_files',
      (la2Files || []).length === 0 ? 'passed' : 'failed',
      (la2Files || []).length === 0
        ? 'Tenant cannot list landlord private storage'
        : 'Tenant listed landlord files',
      { count: (la2Files || []).length },
    )

    // Deny: cannot reassign own landlord_id
    const { data: beforeRow } = await admin
      .from('users')
      .select('landlord_id')
      .eq('id', TENANT_ROW_ID)
      .maybeSingle()
    await db.from('users').update({ landlord_id: LA2 }).eq('id', TENANT_ROW_ID)
    const { data: afterRow } = await admin
      .from('users')
      .select('landlord_id')
      .eq('id', TENANT_ROW_ID)
      .maybeSingle()
    record(
      'tenant_cannot_reassign_landlord_id',
      afterRow?.landlord_id === beforeRow?.landlord_id ? 'passed' : 'failed',
      afterRow?.landlord_id === beforeRow?.landlord_id
        ? 'Tenant landlord_id reassignment rejected / unchanged'
        : 'Tenant landlord_id was reassigned',
      { before: beforeRow?.landlord_id, after: afterRow?.landlord_id },
    )

    // Confirm LA1 untouched by tenant session
    const { data: la1Peek } = await db.from('properties').select('id').eq('landlord_id', LA1).limit(1)
    record(
      'tenant_cannot_read_la1',
      (la1Peek || []).length === 0 ? 'passed' : 'failed',
      (la1Peek || []).length === 0 ? 'Tenant cannot read LA1 properties' : 'Tenant leaked LA1',
    )

    await browser.auth.signOut()
  } catch (e) {
    record('tenant_access_suite', 'failed', e instanceof Error ? e.message : String(e))
  }
}

// ---------------------------------------------------------------------------
// Email OTP product path (resident gate) — needs human inbox
// ---------------------------------------------------------------------------
{
  record(
    'tenant_email_otp_send_verify',
    'blocked',
    'Product resident gate is email OTP (VerifyIdentityModal). Needs a real inbox to receive the code — ask operator to complete; do not simulate verify.',
    { feature: 'src/lib/residentAuth.ts sendEmailOtp / verifyEmailOtpAndSignIn' },
  )
}

// ---------------------------------------------------------------------------
// 2) Social login — Google enabled on admin; Apple API exists but no UI button
// ---------------------------------------------------------------------------
{
  record(
    'social_google_browser',
    'blocked',
    'Google OAuth is enabled on /admin/login (Continue with Google). Requires interactive browser login — ask operator; do not simulate.',
    { route: '/admin/login', provider: 'google' },
  )
  record(
    'social_apple',
    'not_applicable',
    'signInAdminWithOAuth supports apple in code, but AdminLoginPage UI only offers Google — no enabled Apple button to test',
  )
  record(
    'social_logout_relogin',
    'blocked',
    'Depends on completed Google browser session (logout + sign-in again)',
  )
  record(
    'social_no_wrong_account_link',
    'blocked',
    'Depends on completed Google browser session with known test Google account',
  )
}

// ---------------------------------------------------------------------------
// 3) Phone verification vs SMS identity
// ---------------------------------------------------------------------------
{
  record(
    'auth_phone_otp_feature',
    'not_applicable',
    'No Auth phone OTP / SMS OTP sign-in path in app UI. Identity verification for residents is email OTP; admin is email OTP + Google.',
  )
  record(
    'phone_verification_code_flow',
    'not_applicable',
    'No phone verification code-delivery feature to exercise (incorrect/expired/reused codes N/A)',
  )
  record(
    'sms_identity_routing_separate',
    'blocked',
    `SMS identity routing uses dedicated phones ${TENANT_PHONE} / ${VENDOR_PHONE} but receiving SMS alone is not phone verification. Needs explicit inbound routing probe with operator handset if required.`,
  )
}

const failed = results.some((r) => r.status === 'failed')
const overall = failed
  ? 'failed'
  : results.some((r) => r.status === 'partial' || r.status === 'blocked')
    ? 'partial'
    : 'passed'
finish(overall, failed ? 1 : 0)
