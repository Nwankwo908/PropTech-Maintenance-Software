import { runHomeCheckPhotoRecovery } from '../_shared/homeCheck/recovery.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { startDueHomeCheckPhotoPrompts } from '../_shared/homeCheck/visitAct.ts'

// A dedicated minute sweep; never runs rent, onboarding, digests or other ops jobs.
Deno.serve(async (request: Request) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')?.trim()
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!url || !key) return json({ error: 'Server misconfiguration' }, 500)
  const cronKey = Deno.env.get('ULO_OPS_CRON_SECRET')?.trim()
  const bearer = request.headers.get('authorization')
  if (bearer !== `Bearer ${key}` && (!cronKey || bearer !== `Bearer ${cronKey}`)) return json({ error: 'Unauthorized' }, 401)
  let input: Record<string, unknown>
  try { input = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Invalid input' }, 400)
  const scope = input.landlord_id
  if (scope !== undefined && (typeof scope !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(scope))) return json({ error: 'Invalid landlord scope' }, 400)
  const db = createClient(url, key, { auth: { persistSession: false } })
  const now = new Date()
  let query = db.from('home_checks').select('landlord_id').eq('status', 'collecting')
    .eq('visit->>phase', 'scheduled').is('visit->>photoPromptSentAt', null)
    .gt('expires_at', now.toISOString()).lte('visit->>visitAt', now.toISOString()).limit(200)
  if (typeof scope === 'string') query = query.eq('landlord_id', scope)
  const { data, error } = await query
  if (error) return json({ error: 'Could not load due Home Checks' }, 500)
  const accounts = [...new Set((data ?? []).map(row => String(row.landlord_id)))]
  if (input.dry_run === true) return json({ dryRun: true, dueChecks: data?.length ?? 0, accounts: accounts.length, sent: 0 })
  const recovery = await runHomeCheckPhotoRecovery(db, typeof scope === 'string' ? scope : undefined)
  let sent = 0
  let failedAccounts = 0
  for (const account of accounts) {
    try { sent += await startDueHomeCheckPhotoPrompts(db, account, now) }
    catch { failedAccounts++ }
  }
  return json({ sent, failedAccounts, recovery }, failedAccounts ? 503 : 200)
})
