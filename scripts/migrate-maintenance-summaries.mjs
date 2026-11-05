#!/usr/bin/env node
/**
 * Historical maintenance-summary migration.
 *
 * Dry-run (default): preview proposed title/location/description changes.
 * Apply: APPLY=1 node scripts/migrate-maintenance-summaries.mjs
 * Rollback one run: ROLLBACK_FILE=path/to/audit.json node scripts/migrate-maintenance-summaries.mjs
 *
 * Never sends SMS, never changes status/assignment/appointments/estimates.
 * Skips ambiguous records (needsClarification) and reports them for review.
 * Idempotent: skips when summary_source_hash already matches proposed description.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'mzpqwuizhiaczxcnmxbt'
const APPLY = process.env.APPLY === '1'
const ROLLBACK_FILE = process.env.ROLLBACK_FILE?.trim() || ''
const LANDLORD_ID = process.env.LANDLORD_ID?.trim() || ''
const LIMIT = Number(process.env.LIMIT || '200')

function loadEnv() {
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
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
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    /* optional */
  }
}

function hashDescription(description) {
  return createHash('sha256').update(String(description ?? '').trim()).digest('hex').slice(0, 32)
}

const GENERIC_SUMMARY =
  /^(?:plumbing|hvac|electrical|appliance|maintenance|pest)(?: leak| issue| request)?$/i
const GREETING_LEAD = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))\b/i

async function loadSummarizer() {
  // Dynamic import of shared TS via Node --experimental or transpile-free path:
  // Prefer the compiled-like direct import used elsewhere in scripts.
  const mod = await import(
    join(ROOT, 'shared/maintenance/maintenanceRequestFacts.ts')
  )
  return mod
}

function isGenericTitle(title) {
  const t = (title ?? '').trim()
  return (
    !t ||
    GENERIC_SUMMARY.test(t) ||
    /^maintenance request$/i.test(t) ||
    /^(?:other|carpentry|painting|general)(?: issue)?$/i.test(t) ||
    /^(?:freezer|fridge|light|sink|toilet|oven|stove)$/i.test(t)
  )
}

function isHqsDescription(desc) {
  return /\bHQS\s*fail\b/i.test(desc ?? '')
}

function titleSpecificity(title) {
  const t = (title ?? '').trim()
  if (isGenericTitle(t)) return 0
  return Math.min(12, t.split(/\s+/).filter(Boolean).length + (t.length > 24 ? 2 : 0))
}

function looksStale(row, proposed) {
  const headline = (row.issue_headline ?? '').trim()
  const loc = (row.location_detail ?? '').trim()
  const desc = (row.description ?? '').trim()
  if (isHqsDescription(desc)) return false
  // Never "upgrade" into a weaker/generic title.
  if (titleSpecificity(headline) > titleSpecificity(proposed.title)) return false
  if (isGenericTitle(proposed.title) && !proposed.location) return false
  if (!headline || GENERIC_SUMMARY.test(headline)) return !isGenericTitle(proposed.title)
  if (GREETING_LEAD.test(desc.split('\n')[0] ?? '')) return !isGenericTitle(proposed.title)
  if (!loc && proposed.location && !isGenericTitle(proposed.title || headline)) return true
  if (loc.includes('—') && proposed.location && !proposed.location.includes('—')) return true
  // Duplicate-word titles ("Kitchen sink sink leak")
  if (/\b(\w+)\s+\1\b/i.test(headline) && !isGenericTitle(proposed.title)) return true
  if (
    !desc.includes('The tenant reports') &&
    proposed.description.startsWith('The tenant reports') &&
    !isGenericTitle(proposed.title) &&
    titleSpecificity(proposed.title) >= titleSpecificity(headline)
  ) {
    return true
  }
  return false
}

async function main() {
  loadEnv()
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) {
    const keys = JSON.parse(
      execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
        encoding: 'utf8',
      }),
    )
    key = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')?.api_key
  }
  if (!url || !key) throw new Error('Missing Supabase URL / service role key')
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  if (ROLLBACK_FILE) {
    const audit = JSON.parse(readFileSync(ROLLBACK_FILE, 'utf8'))
    let restored = 0
    for (const row of audit.applied ?? []) {
      const { error } = await supabase
        .from('maintenance_requests')
        .update({
          issue_headline: row.before.issue_headline,
          location_detail: row.before.location_detail,
          room: row.before.room,
          description: row.before.description,
          summary: row.before.summary,
          summary_source_hash: row.before.summary_source_hash,
          summarized_at: row.before.summarized_at,
        })
        .eq('id', row.id)
      if (!error) restored += 1
      else console.error('rollback failed', row.id, error.message)
    }
    console.log(JSON.stringify({ rollback: true, restored, from: ROLLBACK_FILE }, null, 2))
    return
  }

  const { summarizeMaintenanceRequestDeterministic, formatPersistedDescription } =
    await loadSummarizer()

  let q = supabase
    .from('maintenance_requests')
    .select(
      'id, display_id, landlord_id, issue_headline, issue_category, description, location_detail, room, summary, summary_source_hash, summarized_at, vendor_work_status, assigned_vendor_id, urgency, priority, photo_paths, entry_ok_if_absent, access_instructions, created_at',
    )
    .in('vendor_work_status', [
      'unassigned',
      'pending_accept',
      'accepted',
      'in_progress',
      'pending_estimate',
      'estimate_submitted',
    ])
    .order('created_at', { ascending: false })
    .limit(LIMIT)
  if (LANDLORD_ID) q = q.eq('landlord_id', LANDLORD_ID)

  const { data: rows, error } = await q
  if (error) throw error

  const proposed = []
  const skipped = []
  const unchanged = []

  for (const row of rows ?? []) {
    const summary = summarizeMaintenanceRequestDeterministic(row.description ?? '', {
      category: row.issue_category,
    })
    if (summary.facts.needsClarification) {
      skipped.push({
        id: row.id,
        display_id: row.display_id,
        reason: 'ambiguous_needs_clarification',
        detail: summary.facts.needsClarification,
      })
      continue
    }
    const persisted = formatPersistedDescription(summary, row.description)
    const nextHash = hashDescription(persisted)
    if (row.summary_source_hash === nextHash && row.issue_headline === summary.title) {
      unchanged.push({ id: row.id, display_id: row.display_id })
      continue
    }
    if (isHqsDescription(row.description)) {
      skipped.push({
        id: row.id,
        display_id: row.display_id,
        reason: 'skip_hqs_preserve',
        detail: 'HQS fail tickets keep original inspection wording',
      })
      continue
    }
    if (titleSpecificity(row.issue_headline) > titleSpecificity(summary.title)) {
      skipped.push({
        id: row.id,
        display_id: row.display_id,
        reason: 'skip_title_regression',
        detail: `${row.issue_headline} -> ${summary.title}`,
      })
      continue
    }
    if (!looksStale(row, { ...summary, persisted })) {
      unchanged.push({ id: row.id, display_id: row.display_id, reason: 'not_stale' })
      continue
    }
    const nextTitle =
      titleSpecificity(row.issue_headline) >= titleSpecificity(summary.title) &&
      !isGenericTitle(row.issue_headline)
        ? String(row.issue_headline).trim()
        : summary.title
    const beforeLoc = (row.location_detail ?? '').trim()
    const guessedLoc = (summary.location ?? '').trim()
    const nextLoc = (() => {
      if (!beforeLoc) return guessedLoc || null
      if (beforeLoc.includes('—') && guessedLoc && !guessedLoc.includes('—')) {
        return guessedLoc
      }
      // Keep explicit stored locations; heuristics must not relocate the job.
      return beforeLoc
    })()
    // If the heuristic relocates the job, heal title/location columns only —
    // never rewrite the resident narrative with a conflicting place.
    const locationConflict =
      Boolean(beforeLoc) &&
      Boolean(guessedLoc) &&
      beforeLoc.toLowerCase() !== guessedLoc.toLowerCase() &&
      !beforeLoc.includes('—')
    const nextDescription = locationConflict
      ? String(row.description ?? '')
      : persisted
    const nextHashFinal = hashDescription(nextDescription)
    if (isGenericTitle(nextTitle) && !nextLoc) {
      skipped.push({
        id: row.id,
        display_id: row.display_id,
        reason: 'skip_weak_proposal',
        detail: nextTitle,
      })
      continue
    }
    // No-op after location preserve.
    if (
      nextTitle === (row.issue_headline ?? '').trim() &&
      (nextLoc || '') === beforeLoc &&
      nextDescription.trim() === String(row.description ?? '').trim()
    ) {
      unchanged.push({ id: row.id, display_id: row.display_id, reason: 'noop_after_preserve' })
      continue
    }
    proposed.push({
      id: row.id,
      display_id: row.display_id,
      landlord_id: row.landlord_id,
      before: {
        issue_headline: row.issue_headline,
        location_detail: row.location_detail,
        room: row.room,
        description: row.description,
        summary: row.summary,
        summary_source_hash: row.summary_source_hash,
        summarized_at: row.summarized_at,
      },
      after: {
        issue_headline: nextTitle,
        location_detail: nextLoc,
        room: nextLoc || row.room,
        description: nextDescription,
        summary: nextLoc ? `${nextTitle} · ${nextLoc}` : nextTitle,
        summary_source_hash: nextHashFinal,
        summarized_at: new Date().toISOString(),
      },
      preserved: {
        vendor_work_status: row.vendor_work_status,
        assigned_vendor_id: row.assigned_vendor_id,
        photo_count: Array.isArray(row.photo_paths) ? row.photo_paths.length : 0,
        entry_ok_if_absent: row.entry_ok_if_absent,
        access_instructions: row.access_instructions,
      },
    })
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(ROOT, 'scripts', 'migration-audits')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const previewPath = join(outDir, `maintenance-summaries-preview-${stamp}.json`)

  const report = {
    mode: APPLY ? 'apply' : 'dry_run',
    generatedAt: new Date().toISOString(),
    scanned: (rows ?? []).length,
    proposed: proposed.length,
    skippedAmbiguous: skipped.length,
    unchanged: unchanged.length,
    proposals: proposed.map((p) => ({
      id: p.id,
      display_id: p.display_id,
      beforeTitle: p.before.issue_headline,
      afterTitle: p.after.issue_headline,
      beforeLocation: p.before.location_detail,
      afterLocation: p.after.location_detail,
      beforeDescription: (p.before.description ?? '').slice(0, 180),
      afterDescription: (p.after.description ?? '').split('\n')[0],
    })),
    skipped,
  }
  writeFileSync(previewPath, JSON.stringify({ ...report, full: proposed }, null, 2))

  console.log(
    JSON.stringify(
      {
        ...report,
        previewFile: previewPath,
        note: APPLY
          ? 'APPLY=1 — writing proposed updates'
          : 'Dry run only. Re-run with APPLY=1 after review.',
      },
      null,
      2,
    ),
  )

  if (!APPLY) return

  const applied = []
  for (const p of proposed) {
    const { error: upErr } = await supabase
      .from('maintenance_requests')
      .update({
        issue_headline: p.after.issue_headline,
        location_detail: p.after.location_detail,
        room: p.after.room,
        description: p.after.description,
        summary: p.after.summary,
        summary_source_hash: p.after.summary_source_hash,
        summarized_at: p.after.summarized_at,
      })
      .eq('id', p.id)
      .eq('vendor_work_status', p.preserved.vendor_work_status) // fail closed if status moved
    if (upErr) {
      console.error('apply failed', p.id, upErr.message)
      continue
    }
    applied.push(p)
  }

  const auditPath = join(outDir, `maintenance-summaries-applied-${stamp}.json`)
  writeFileSync(
    auditPath,
    JSON.stringify(
      {
        appliedAt: new Date().toISOString(),
        applied,
        rollback: `ROLLBACK_FILE=${auditPath} node scripts/migrate-maintenance-summaries.mjs`,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ applied: applied.length, auditPath }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
