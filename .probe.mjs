import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq <= 0) continue
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    const k = t.slice(0, eq).trim(); if (!process.env[k]) process.env[k] = v
  }
} catch {}
const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
let key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!key) {
  const { execSync } = await import('node:child_process')
  const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }))
  key = keys.find(k => k.name === 'service_role' || k.id === 'service_role')?.api_key
}
const db = createClient(url, key, { auth: { persistSession: false } })
const { data } = await db.from('maintenance_requests')
  .select('title, created_at').order('created_at', { ascending: false }).limit(40)
const withTitle = (data ?? []).filter(r => (r.title ?? '').trim())
console.log(`last ${data?.length} requests: ${withTitle.length} have a title`)
for (const r of (data ?? []).slice(0, 12)) {
  const d = new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  console.log(`  ${d}  title="${String(r.title ?? '')}"`)
}
