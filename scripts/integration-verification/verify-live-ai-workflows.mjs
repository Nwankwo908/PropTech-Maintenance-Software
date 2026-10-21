#!/usr/bin/env node
/**
 * Live AI workflows on Limited Alpha 2 only:
 * 1) Lease extraction → durable portfolio/resident fields
 * 2) Ask Ulo “today’s priorities” → live LA2-scoped data (not another landlord)
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY, INTEGRATION_LA2_PASSWORD, and working
 * edge functions (onboarding-extract / ask-ulo) with model keys configured.
 *
 * Never uses Limited Alpha 1.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT, { recursive: true })
const LA2 = 'de300000-0000-4000-8000-000000000004'
const LA2_EMAIL = 'limitedalpha2@ulohome.io'
const LA1 = 'de300000-0000-4000-8000-000000000003'

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
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const LA2_PASSWORD = (process.env.INTEGRATION_LA2_PASSWORD || '').trim()
const FIXTURE =
  process.env.INTEGRATION_LEASE_FIXTURE_PATH?.trim() ||
  resolve(ROOT, 'scripts/integration-verification/fixtures/sample-lease.pdf')

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}
function finish(overall, code) {
  writeFileSync(
    resolve(OUT, 'live-ai-workflows.json'),
    JSON.stringify(
      {
        area: 'live-ai-workflows',
        overall,
        finishedAt: new Date().toISOString(),
        landlordId: LA2,
        results,
        boundaries: [
          'LA2 only — LA1 never queried as actor.',
          'Lease extract requires fixture PDF + edge model keys.',
          'Priorities must scope to LA2 landlord id in response/tools.',
        ],
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\nOverall live-ai-workflows: ${overall} (exit ${code})`)
  process.exit(code)
}

if (!SUPABASE_URL || !SERVICE || !ANON || !LA2_PASSWORD) {
  record('prereq', 'blocked', 'Need URL, service role, anon, INTEGRATION_LA2_PASSWORD')
  finish('blocked', 2)
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function signInLa2() {
  const c = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await c.auth.signInWithPassword({
    email: LA2_EMAIL,
    password: LA2_PASSWORD,
  })
  if (error || !data.session) throw new Error(error?.message || 'LA2 sign-in failed')
  return { client: c, session: data.session }
}

// --- Lease extraction ---
{
  if (!existsSync(FIXTURE)) {
    record(
      'lease_extract',
      'blocked',
      `Fixture missing at ${FIXTURE}. Set INTEGRATION_LEASE_FIXTURE_PATH to a multi-page lease PDF.`,
    )
  } else {
    const bytes = readFileSync(FIXTURE)
    const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    record('lease_fixture', 'passed', `Using fixture (${bytes.length} bytes, sha ${sha})`, {
      path: FIXTURE,
    })
    try {
      const { client, session } = await signInLa2()
      const fnCandidates = ['onboarding-document-extract', 'onboarding-extract', 'document-extract']
      let extractOk = null
      let lastErr = ''
      for (const name of fnCandidates) {
        const docId = randomUUID()
        const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${name}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: ANON,
            'x-ulo-access-token': session.access_token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            landlordId: LA2,
            docId,
            documentCategory: 'lease_agreement',
            fileName: `ulo-integration-lease-${sha}.pdf`,
            contentType: 'application/pdf',
            fileBase64: bytes.toString('base64'),
          }),
        })
        const text = await res.text()
        let json = null
        try {
          json = JSON.parse(text)
        } catch {
          /* ignore */
        }
        if (res.status === 404) {
          lastErr = `${name}: 404`
          continue
        }
        extractOk = { name, status: res.status, ok: res.ok, json, text: text.slice(0, 500) }
        break
      }
      if (!extractOk) {
        record('lease_extract', 'blocked', `No extract edge function responded (${lastErr})`)
      } else if (!extractOk.ok) {
        record('lease_extract', 'failed', `Extract invoke HTTP ${extractOk.status}`, {
          fn: extractOk.name,
          body: extractOk.json || extractOk.text,
        })
      } else {
        const payload = extractOk.json || {}
        const residents = payload.residents || payload.extracted?.residents || []
        const properties = payload.properties || payload.extracted?.properties || []
        const leaseReview = payload.leaseReview || payload.extracted?.leaseReview
        const hasFields =
          (Array.isArray(residents) && residents.length > 0) ||
          (Array.isArray(properties) && properties.length > 0) ||
          Boolean(leaseReview)
        if (!hasFields) {
          record('lease_extract', 'partial', 'Extract returned OK but no resident/property fields', {
            fn: extractOk.name,
            keys: Object.keys(payload),
          })
        } else {
          // Cross-landlord: ensure payload does not reference LA1 ids
          const blob = JSON.stringify(payload)
          if (blob.includes(LA1)) {
            record('lease_extract_isolation', 'failed', 'Extract payload references LA1 id')
          } else {
            record('lease_extract_isolation', 'passed', 'Extract payload does not reference LA1')
          }
          // Fixture-known fields (sample-lease.pdf) — accuracy, not just presence
          const expected = {
            addressHint: /123\s+Main/i,
            tenantHint: /Morgan/i,
            rentHint: /1500/,
            startHint: /2026-01-01|January\s+1,?\s+2026|01\/01\/2026/i,
            endHint: /2026-12-31|December\s+31,?\s+2026|12\/31\/2026/i,
          }
          const hits = {
            address: expected.addressHint.test(blob),
            tenant: expected.tenantHint.test(blob),
            rent: expected.rentHint.test(blob),
            start: expected.startHint.test(blob),
            end: expected.endHint.test(blob),
          }
          const hitCount = Object.values(hits).filter(Boolean).length
          if (hitCount >= 3) {
            record('lease_extract_accuracy', 'passed', `Matched ${hitCount}/5 fixture fields`, { hits })
          } else {
            record('lease_extract_accuracy', 'failed', `Only matched ${hitCount}/5 fixture fields`, {
              hits,
              preview: blob.slice(0, 600),
            })
          }
          // Persist extract into LA2 onboarding draft_state (isolated; never LA1)
          try {
            const draftId = `ulo-integration-lease-${sha}`
            const { data: existing } = await admin
              .from('landlord_onboarding')
              .select('draft_state,landlord_id')
              .eq('landlord_id', LA2)
              .maybeSingle()
            const prev =
              typeof existing?.draft_state === 'object' && existing.draft_state
                ? existing.draft_state
                : {}
            const nextDraft = {
              ...prev,
              integrationLeaseProbe: {
                at: new Date().toISOString(),
                draftId,
                residents,
                properties,
                leaseReview: leaseReview || null,
              },
            }
            const upsertRow = {
              landlord_id: LA2,
              draft_state: nextDraft,
              updated_at: new Date().toISOString(),
            }
            if (!existing) upsertRow.onboarding_status = 'in_progress'
            const { error: saveErr } = await admin
              .from('landlord_onboarding')
              .upsert(upsertRow, { onConflict: 'landlord_id' })
            if (saveErr) {
              record('lease_extract_persist', 'partial', saveErr.message, {
                saveErr: saveErr.message,
              })
            } else {
              const { data: reloaded } = await admin
                .from('landlord_onboarding')
                .select('draft_state,landlord_id')
                .eq('landlord_id', LA2)
                .maybeSingle()
              const savedBlob = JSON.stringify(reloaded?.draft_state?.integrationLeaseProbe || {})
              const accurate =
                reloaded?.landlord_id === LA2 &&
                expected.addressHint.test(savedBlob) &&
                expected.tenantHint.test(savedBlob)
              record(
                'lease_extract_persist',
                accurate ? 'passed' : 'partial',
                accurate
                  ? 'LA2 onboarding draft_state stores accurate extract fields'
                  : 'Wrote draft_state but reloaded fields incomplete',
                { draftId, landlordId: reloaded?.landlord_id },
              )
            }
          } catch (persistErr) {
            record(
              'lease_extract_persist',
              'partial',
              persistErr instanceof Error ? persistErr.message : String(persistErr),
            )
          }
          record('lease_extract', 'passed', 'Lease extract returned structured fields', {
            fn: extractOk.name,
            residentCount: Array.isArray(residents) ? residents.length : 0,
            propertyCount: Array.isArray(properties) ? properties.length : 0,
            hasLeaseReview: Boolean(leaseReview),
          })
        }
      }
      await client.auth.signOut()
    } catch (e) {
      record('lease_extract', 'failed', e instanceof Error ? e.message : String(e))
    }
  }
}

// --- Ask Ulo today’s priorities (live) ---
{
  try {
    const { client, session } = await signInLa2()
    const question = "What should I prioritize today?"
    const secret = (
      process.env.ADMIN_REASSIGN_SECRET ||
      process.env.VITE_ADMIN_REASSIGN_SECRET ||
      ''
    ).trim()
    if (!secret) {
      record('ask_ulo_priorities_live', 'blocked', 'ADMIN_REASSIGN_SECRET required for ask-ulo')
      await client.auth.signOut()
      throw new Error('missing ADMIN_REASSIGN_SECRET')
    }
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ask-ulo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: ANON,
        'x-ulo-access-token': session.access_token,
        'x-admin-reassign-secret': secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        landlordId: LA2,
        question,
        channel: 'dashboard',
        conversationId: randomUUID(),
      }),
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      record('ask_ulo_priorities_live', 'failed', `ask-ulo HTTP ${res.status}`, {
        body: json || text.slice(0, 600),
      })
    } else {
      const answer =
        json?.answer || json?.message || json?.text || json?.reply || JSON.stringify(json).slice(0, 400)
      const tools = json?.toolsUsed || json?.tools_used || json?.metadata?.toolsUsed || []
      const landlordInMeta =
        json?.landlordId === LA2 ||
        json?.landlord_id === LA2 ||
        json?.metadata?.landlordId === LA2
      const leakedLa1 = JSON.stringify(json).includes(LA1)
      if (leakedLa1) {
        record('ask_ulo_priorities_isolation', 'failed', 'Response references LA1 landlord id')
      } else {
        record('ask_ulo_priorities_isolation', 'passed', 'No LA1 id in Ask Ulo response', {
          landlordInMeta,
        })
      }
      // Compare against live LA2 open emergencies / tickets for sanity
      const { data: openTickets } = await admin
        .from('maintenance_requests')
        .select('id,priority,urgency,issue_type,vendor_work_status,description')
        .eq('landlord_id', LA2)
        .not('vendor_work_status', 'in', '("completed","cancelled","canceled")')
        .limit(20)
      const emergencies = (openTickets || []).filter(
        (t) =>
          /emergency/i.test(String(t.priority || '')) ||
          /emergency/i.test(String(t.urgency || '')) ||
          String(t.issue_type || '').toLowerCase() === 'flooding',
      )
      record('ask_ulo_priorities_live', 'passed', 'Ask Ulo returned a priorities answer for LA2', {
        answerPreview: String(answer).slice(0, 240),
        toolsUsed: tools,
        openTicketCount: openTickets?.length || 0,
        emergencyCount: emergencies.length,
      })
      if (emergencies.length > 0) {
        const mentionsFlood = /flood|emergency|WO-|priorit/i.test(String(answer))
        record(
          'ask_ulo_priorities_reflects_open_work',
          mentionsFlood ? 'passed' : 'partial',
          mentionsFlood
            ? 'Answer references emergency/flooding/open work language'
            : 'Open emergencies exist but answer did not clearly reference them',
          { emergencyCount: emergencies.length },
        )
      } else {
        record(
          'ask_ulo_priorities_reflects_open_work',
          'partial',
          'No open emergency tickets on LA2 to cross-check against',
        )
      }
    }
    await client.auth.signOut()
  } catch (e) {
    record('ask_ulo_priorities_live', 'failed', e instanceof Error ? e.message : String(e))
  }
}

const failed = results.some((r) => r.status === 'failed')
const blocked = results.some((r) => r.status === 'blocked')
if (failed) finish('failed', 1)
if (blocked) finish('blocked', 2)
finish(results.some((r) => r.status === 'partial' || r.status === 'not_run') ? 'partial' : 'passed', 0)
