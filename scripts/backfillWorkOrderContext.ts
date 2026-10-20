/**
 * One-off: ensureWorkOrderContext on all open maintenance_requests.
 *
 *   npx tsx scripts/backfillWorkOrderContext.ts
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 * Optional: BATCH=20 PAUSE_MS=250 LIMIT=0 DRY_RUN=1
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensureWorkOrderContext } from "../supabase/functions/_shared/workOrderContext.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

try {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] == null || process.env[k] === "") process.env[k] = v
  }
} catch {
  // optional
}

const BATCH = Math.max(1, Number(process.env.BATCH ?? 20) || 20)
const PAUSE_MS = Math.max(0, Number(process.env.PAUSE_MS ?? 250) || 0)
const LIMIT = Math.max(0, Number(process.env.LIMIT ?? 0) || 0)
const DRY_RUN = process.env.DRY_RUN === "1"

const OPEN_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "declined",
  "in_progress",
]

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const url =
    process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let offset = 0
  let processed = 0
  let errors = 0

  for (;;) {
    if (LIMIT > 0 && processed >= LIMIT) break

    const pageSize =
      LIMIT > 0 ? Math.min(BATCH, LIMIT - processed) : BATCH

    const { data, error } = await supabase
      .from("maintenance_requests")
      .select(
        "id, description, summary, category, room, location_detail, context_urgency, summary_source_hash, vendor_work_status",
      )
      .in("vendor_work_status", OPEN_STATUSES)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw new Error(error.message)
    const rows = data ?? []
    if (rows.length === 0) break

    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : ""
      const description =
        typeof row.description === "string" ? row.description : ""
      if (!id || !description.trim()) continue

      if (DRY_RUN) {
        console.log(`[dry-run] ${id}`)
        processed += 1
        continue
      }

      try {
        await ensureWorkOrderContext(supabase, {
          id,
          description,
          summary: typeof row.summary === "string" ? row.summary : null,
          category: typeof row.category === "string" ? row.category : null,
          room: typeof row.room === "string" ? row.room : null,
          location_detail:
            typeof row.location_detail === "string"
              ? row.location_detail
              : null,
          context_urgency:
            typeof row.context_urgency === "string"
              ? row.context_urgency
              : null,
          summary_source_hash:
            typeof row.summary_source_hash === "string"
              ? row.summary_source_hash
              : null,
        })
        processed += 1
      } catch (e) {
        errors += 1
        console.warn(`[backfill] failed ${id}`, e)
      }
    }

    offset += rows.length
    if (rows.length < pageSize) break
    if (PAUSE_MS > 0) await sleep(PAUSE_MS)
  }

  console.log(
    JSON.stringify({ ok: true, processed, errors, dryRun: DRY_RUN }, null, 2),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
