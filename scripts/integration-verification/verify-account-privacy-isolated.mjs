#!/usr/bin/env node
/**
 * Account privacy — isolated LA2 + disposable landlord B + synthetic tenant.
 *
 * Rules:
 * - Never signs into Limited Alpha 1 / never messages LA1.
 * - No real SMS.
 * - Proof uses authenticated user JWTs (anon key + password session), not
 *   service-role as evidence of user permissions. Service role is fixture
 *   setup / post-condition audit only.
 *
 * Required:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   INTEGRATION_LA2_PASSWORD
 *
 * Optional isolated override:
 *   PRIVACY_ISOLATED_SUPABASE_URL / PRIVACY_ISOLATED_ANON_KEY /
 *   PRIVACY_ISOLATED_SERVICE_ROLE_KEY
 *
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
const LA2_EMAIL = 'limitedalpha2@ulohome.io'
const LANDLORD_B = 'be300000-0000-4000-8000-00000000b001'
const LANDLORD_B_EMAIL = `privacy-b-${LANDLORD_B.slice(0, 8)}@ulohome.invalid`
const TENANT_EMAIL = `privacy-tenant-${LANDLORD_B.slice(0, 8)}@ulohome.invalid`

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

const SUPABASE_URL = (
  process.env.PRIVACY_ISOLATED_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
).trim()
const ANON = (
  process.env.PRIVACY_ISOLATED_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''
).trim()
const SERVICE = (
  process.env.PRIVACY_ISOLATED_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''
).trim()
const LA2_PASSWORD = (process.env.INTEGRATION_LA2_PASSWORD || '').trim()
const ISOLATED_FLAG = Boolean(process.env.PRIVACY_ISOLATED_SUPABASE_URL)
const FIXTURE_PASSWORD = (process.env.PRIVACY_FIXTURE_PASSWORD || `PrivTest-${randomUUID().slice(0, 8)}!aA1`).trim()

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}
function finish(overall, code) {
  writeFileSync(
    resolve(OUT, 'account-privacy-isolated.json'),
    JSON.stringify(
      {
        area: 'account-privacy-isolated',
        overall,
        finishedAt: new Date().toISOString(),
        environment: (() => {
          try {
            return new URL(SUPABASE_URL).host
          } catch {
            return 'invalid'
          }
        })(),
        isolatedBackend: ISOLATED_FLAG,
        actors: {
          la2: LA2,
          landlordB: LANDLORD_B,
          la1Touched: false,
        },
        results,
        boundaries: [
          'LA1 never used as actor; no LA1 sign-in, reset, or SMS.',
          'No real SMS sent.',
          'Service role used only for fixture setup and unchanged-row audits.',
          'OAuth / phone OTP / full tenant portal workflows: blocked or untested unless fixtures exist.',
          'Signed storage URLs treated as bearer links when minted after auth.',
        ],
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\nOverall account-privacy-isolated: ${overall} (exit ${code})`)
  process.exit(code)
}

if (!SUPABASE_URL || !ANON || !SERVICE) {
  record('prereq', 'blocked', 'Need URL, anon key, service role')
  finish('blocked', 2)
}
if (!LA2_PASSWORD) {
  record('prereq_la2', 'blocked', 'INTEGRATION_LA2_PASSWORD required for LA2 session tests')
  finish('blocked', 2)
}
if (!ISOLATED_FLAG) {
  record(
    'isolated_backend',
    'partial',
    'PRIVACY_ISOLATED_SUPABASE_URL unset — running against default project; treat deployment to isolated as blocked unless this host is the isolated mirror',
    { host: new URL(SUPABASE_URL).host },
  )
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

async function signIn(email, password) {
  const c = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(error?.message || `sign-in failed for ${email}`)
  return { client: c, session: data.session, db: userClient(data.session.access_token) }
}

// --- Fixture setup (service role only) ---
{
  try {
    await admin.from('landlords').upsert(
      {
        id: LANDLORD_B,
        name: 'Privacy Disposable B',
        email: LANDLORD_B_EMAIL,
        phone: null,
      },
      { onConflict: 'id' },
    )
    await admin.from('landlord_portal_members').upsert(
      {
        landlord_id: LANDLORD_B,
        email: LANDLORD_B_EMAIL,
        role: 'team_member',
      },
      { onConflict: 'landlord_id,email' },
    )

    // Auth user for landlord B
    const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    let bUser = (list.data?.users || []).find(
      (u) => (u.email || '').toLowerCase() === LANDLORD_B_EMAIL.toLowerCase(),
    )
    if (!bUser) {
      const created = await admin.auth.admin.createUser({
        email: LANDLORD_B_EMAIL,
        password: FIXTURE_PASSWORD,
        email_confirm: true,
        user_metadata: { ulo_landlord_id: LANDLORD_B, full_name: 'Privacy B' },
      })
      if (created.error) throw created.error
      bUser = created.data.user
    } else {
      await admin.auth.admin.updateUserById(bUser.id, { password: FIXTURE_PASSWORD })
    }

    // Property + resident on B
    const propId = 'be300000-0000-4000-8000-00000000b010'
    await admin.from('properties').upsert(
      {
        id: propId,
        landlord_id: LANDLORD_B,
        name: 'Privacy B House',
        street_address: '1 Privacy Lane',
        city: 'Testville',
        state: 'GA',
        zip_code: '30301',
        property_type: 'single_family',
      },
      { onConflict: 'id' },
    )
    const residentId = 'be300000-0000-4000-8000-00000000b020'
    await admin.from('users').upsert(
      {
        id: residentId,
        landlord_id: LANDLORD_B,
        resident_id: `PRIV-B-${residentId.slice(0, 8)}`,
        full_name: 'Synthetic Privacy Tenant',
        email: TENANT_EMAIL,
        phone: null,
        unit: '1',
        status: 'active',
        balance_due: 42,
      },
      { onConflict: 'id' },
    )

    // Seed one private storage object under B (and ensure LA2 cannot list it)
    const path = `${LANDLORD_B}/privacy-probe/readme.txt`
    await admin.storage.from('landlord-onboarding-documents').upload(
      path,
      new Blob(['privacy-probe'], { type: 'text/plain' }),
      { upsert: true, contentType: 'text/plain' },
    )

    record('fixture_setup', 'passed', 'Disposable landlord B + property + resident + storage object ready', {
      landlordB: LANDLORD_B,
      propertyId: propId,
      residentId,
      storagePath: path,
    })
  } catch (e) {
    record('fixture_setup', 'failed', e instanceof Error ? e.message : String(e))
    finish('failed', 1)
  }
}

// --- Anonymous ---
{
  const anon = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: props } = await anon.from('properties').select('id').limit(3)
  record(
    'anon_properties',
    (props || []).length === 0 ? 'passed' : 'failed',
    (props || []).length === 0 ? 'Anonymous cannot read properties' : 'Anonymous leaked properties',
    { count: (props || []).length },
  )
  const { data: users } = await anon.from('users').select('id,balance_due').limit(3)
  record(
    'anon_users_read',
    (users || []).length === 0 ? 'passed' : 'failed',
    (users || []).length === 0 ? 'Anonymous cannot read users' : 'Anonymous leaked users',
    { count: (users || []).length },
  )
  const { data: victim } = await admin
    .from('users')
    .select('id,balance_due')
    .eq('id', 'be300000-0000-4000-8000-00000000b020')
    .maybeSingle()
  if (victim) {
    const before = Number(victim.balance_due)
    await anon.from('users').update({ balance_due: before + 100 }).eq('id', victim.id)
    const { data: after } = await admin
      .from('users')
      .select('balance_due')
      .eq('id', victim.id)
      .maybeSingle()
    const unchanged = Number(after?.balance_due) === before
    record(
      'anon_users_update_balance',
      unchanged ? 'passed' : 'failed',
      unchanged
        ? 'Anonymous balance update left row unchanged'
        : 'Anonymous changed resident balance',
      { before, after: after?.balance_due },
    )
    if (!unchanged) {
      await admin.from('users').update({ balance_due: before }).eq('id', victim.id)
    }
  }
}

// --- LA2 session (must not see B / must not escalate) ---
{
  let la2
  try {
    la2 = await signIn(LA2_EMAIL, LA2_PASSWORD)
    record('la2_login', 'passed', 'LA2 password session established')
  } catch (e) {
    record('la2_login', 'failed', e instanceof Error ? e.message : String(e))
    finish('failed', 1)
  }

  const { data: bProps } = await la2.db.from('properties').select('id').eq('landlord_id', LANDLORD_B)
  record(
    'la2_cannot_read_b_properties',
    (bProps || []).length === 0 ? 'passed' : 'failed',
    (bProps || []).length === 0 ? 'LA2 cannot read landlord B properties' : 'LA2 leaked B properties',
    { count: (bProps || []).length },
  )

  const { data: bUsers } = await la2.db
    .from('users')
    .select('id,balance_due')
    .eq('landlord_id', LANDLORD_B)
  record(
    'la2_cannot_read_b_users',
    (bUsers || []).length === 0 ? 'passed' : 'failed',
    (bUsers || []).length === 0 ? 'LA2 cannot read landlord B residents' : 'LA2 leaked B residents',
    { count: (bUsers || []).length },
  )

  const { data: otherMembers } = await la2.db
    .from('landlord_portal_members')
    .select('landlord_id,email')
    .eq('landlord_id', LANDLORD_B)
  record(
    'la2_cannot_read_b_members',
    (otherMembers || []).length === 0 ? 'passed' : 'failed',
    (otherMembers || []).length === 0
      ? 'LA2 cannot read landlord B portal members'
      : 'LA2 leaked B portal members',
    { count: (otherMembers || []).length },
  )

  const attackEmail = `la2-escalation-${randomUUID().slice(0, 8)}@ulohome.invalid`
  const { data: ins } = await la2.db
    .from('landlord_portal_members')
    .insert({ landlord_id: LANDLORD_B, email: attackEmail, role: 'team_member' })
    .select()
  const { data: persisted } = await admin
    .from('landlord_portal_members')
    .select('email')
    .eq('email', attackEmail)
  const blocked = (persisted || []).length === 0
  record(
    'la2_cannot_insert_b_member',
    blocked ? 'passed' : 'failed',
    blocked
      ? 'LA2 cannot insert portal membership on landlord B'
      : 'LA2 inserted cross-account portal membership',
    { returned: ins?.length || 0 },
  )
  if (!blocked) {
    await admin.from('landlord_portal_members').delete().eq('email', attackEmail)
  }

  // Must not touch LA1 either (read-only assert; no LA1 login)
  const { data: la1Props } = await la2.db.from('properties').select('id').eq('landlord_id', LA1).limit(3)
  record(
    'la2_cannot_read_la1_properties',
    (la1Props || []).length === 0 ? 'passed' : 'failed',
    (la1Props || []).length === 0 ? 'LA2 cannot read LA1 properties' : 'LA2 leaked LA1 properties',
    { count: (la1Props || []).length },
  )

  const { data: listB } = await la2.db.storage
    .from('landlord-onboarding-documents')
    .list(LANDLORD_B, { limit: 5 })
  record(
    'la2_cannot_list_b_storage',
    (listB || []).length === 0 ? 'passed' : 'failed',
    (listB || []).length === 0
      ? 'LA2 cannot list landlord B private storage folder'
      : 'LA2 listed landlord B storage objects',
    { count: (listB || []).length },
  )

  // Owner success: LA2 can read own properties
  const { data: own } = await la2.db.from('properties').select('id').eq('landlord_id', LA2).limit(3)
  record(
    'la2_owner_read_own_properties',
    (own || []).length > 0 ? 'passed' : 'partial',
    (own || []).length > 0
      ? 'LA2 can read own properties'
      : 'LA2 returned no own properties (empty portfolio or policy too strict)',
    { count: (own || []).length },
  )

  await la2.client.auth.signOut()
}

// --- Landlord B session ---
{
  let b
  try {
    b = await signIn(LANDLORD_B_EMAIL, FIXTURE_PASSWORD)
    record('landlord_b_login', 'passed', 'Disposable landlord B session established')
  } catch (e) {
    record('landlord_b_login', 'failed', e instanceof Error ? e.message : String(e))
    finish(
      results.some((r) => r.status === 'failed') ? 'failed' : 'partial',
      results.some((r) => r.status === 'failed') ? 1 : 0,
    )
  }

  const { data: ownProps } = await b.db.from('properties').select('id,landlord_id').eq('landlord_id', LANDLORD_B)
  record(
    'b_owner_read_own_properties',
    (ownProps || []).length > 0 ? 'passed' : 'failed',
    (ownProps || []).length > 0 ? 'B can read own properties' : 'B cannot read own properties',
    { count: (ownProps || []).length },
  )

  const { data: la2Props } = await b.db.from('properties').select('id').eq('landlord_id', LA2).limit(3)
  record(
    'b_cannot_read_la2_properties',
    (la2Props || []).length === 0 ? 'passed' : 'failed',
    (la2Props || []).length === 0 ? 'B cannot read LA2 properties' : 'B leaked LA2 properties',
    { count: (la2Props || []).length },
  )

  const { data: listOwn } = await b.db.storage
    .from('landlord-onboarding-documents')
    .list(LANDLORD_B, { limit: 5 })
  record(
    'b_owner_list_own_storage',
    (listOwn || []).length > 0 ? 'passed' : 'partial',
    (listOwn || []).length > 0
      ? 'B can list own private storage folder'
      : 'B could not list own storage (policy or empty)',
    { count: (listOwn || []).length },
  )

  const { data: listLa2 } = await b.db.storage
    .from('landlord-onboarding-documents')
    .list(LA2, { limit: 5 })
  record(
    'b_cannot_list_la2_storage',
    (listLa2 || []).length === 0 ? 'passed' : 'failed',
    (listLa2 || []).length === 0
      ? 'B cannot list LA2 private storage folder'
      : 'B listed LA2 storage objects',
    { count: (listLa2 || []).length },
  )

  // Rejected change unchanged: try steal LA2 property
  const { data: victimProp } = await admin
    .from('properties')
    .select('id,landlord_id,name')
    .eq('landlord_id', LA2)
    .limit(1)
    .maybeSingle()
  if (victimProp) {
    await b.db.from('properties').update({ name: `${victimProp.name}-hijack` }).eq('id', victimProp.id)
    const { data: after } = await admin
      .from('properties')
      .select('id,name,landlord_id')
      .eq('id', victimProp.id)
      .maybeSingle()
    const unchanged = after?.name === victimProp.name && after?.landlord_id === LA2
    record(
      'b_cannot_update_la2_property',
      unchanged ? 'passed' : 'failed',
      unchanged
        ? 'Rejected cross-account property update left row unchanged'
        : 'Cross-account property update persisted',
      { propertyId: victimProp.id },
    )
  }

  await b.client.auth.signOut()
}

// --- Expired / invalid session ---
{
  const dead = userClient('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.sig')
  const { data, error } = await dead.from('properties').select('id').limit(3)
  record(
    'expired_or_invalid_jwt',
    (data || []).length === 0 ? 'passed' : 'failed',
    (data || []).length === 0
      ? 'Invalid JWT cannot read properties'
      : 'Invalid JWT returned properties',
    { error: error?.message || null, count: (data || []).length },
  )
}

// --- Synthetic tenant ---
{
  record(
    'synthetic_tenant_session',
    'blocked',
    'No resident auth user / password fixture — tenant JWT workflows untested (email OTP/OAuth also untested)',
  )
}

const failed = results.some((r) => r.status === 'failed')
const overall = failed ? 'failed' : results.some((r) => r.status === 'partial' || r.status === 'blocked') ? 'partial' : 'passed'
finish(overall, failed ? 1 : 0)
