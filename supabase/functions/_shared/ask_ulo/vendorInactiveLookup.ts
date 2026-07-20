/**
 * Vendors that haven't accepted jobs recently (or are sitting on pending accepts).
 * Answers “Show vendors that haven't accepted jobs recently.”
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { polishAskUloProse } from "./responsePolish.ts"
import { formatLastAssigned } from "./operationalLanguage.ts"
import { isVendorInactivityQuestion } from "./questionSubjectMatch.ts"
import { vendorDisplayName } from "./vendorNames.ts"

export type VendorInactiveRow = {
  vendorId: string
  name: string
  pendingAcceptJobs: number
  acceptedJobs: number
  lastAssignedAt: string | null
  daysSinceAssigned: number | null
  reason: string
}

export type VendorInactiveResult = {
  available: boolean
  found: boolean
  ranked: VendorInactiveRow[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
}

export { isVendorInactivityQuestion }

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}

function describeInactiveVendor(row: VendorInactiveRow, index: number): string {
  const assigned = formatLastAssigned(row.daysSinceAssigned)
  if (row.pendingAcceptJobs > 0) {
    const jobWord =
      row.pendingAcceptJobs === 1 ? "one assigned job" : `${row.pendingAcceptJobs} assigned jobs`
    const variants = [
      `**${row.name}** — ${jobWord} still waiting for a response (${assigned}).`,
      `**${row.name}** hasn't responded to ${jobWord} yet — ${assigned}.`,
      `**${row.name}** — ${row.pendingAcceptJobs} job${row.pendingAcceptJobs === 1 ? "" : "s"} sitting without a vendor accept; ${assigned}.`,
    ]
    return variants[index % variants.length]!
  }
  if (row.acceptedJobs === 0) {
    return `**${row.name}** — on the roster but no accepted jobs on record yet (${assigned}).`
  }
  return `**${row.name}** — quiet on new accepts; ${assigned}.`
}

function buildMarkdown(ranked: VendorInactiveRow[]): string {
  if (ranked.length === 0) {
    return [
      "No vendors look stuck on unaccepted jobs right now — everyone's either responding or sitting idle without open assignments.",
      "",
      "### What I'd do",
      "If a specific vendor feels slow on one ticket, open that work order and chase or reassign from there.",
    ].join("\n")
  }

  const top = ranked[0]!
  const lead =
    top.pendingAcceptJobs > 0
      ? top.pendingAcceptJobs === 1
        ? `The biggest follow-up today is **${top.name}**. They still haven't responded to a job you recently assigned them.`
        : `The biggest follow-up today is **${top.name}**. They still haven't responded to **${top.pendingAcceptJobs}** recently assigned jobs — that could delay getting those repairs started.`
      : `**${top.name}** is the vendor worth checking first — they haven't taken new work recently (${formatLastAssigned(top.daysSinceAssigned)}).`

  const out: string[] = [lead, "", "### Vendors to chase"]

  for (const [i, row] of ranked.slice(0, 8).entries()) {
    out.push(`${i + 1}. ${describeInactiveVendor(row, i)}`)
  }

  out.push("")
  out.push("### What I'd do")
  if (top.pendingAcceptJobs > 0) {
    out.push(
      `Reach out to **${top.name}** first. If they can't commit today, reassign those jobs so they don't keep aging in the queue.`,
    )
  } else {
    out.push(
      `Check whether **${top.name}** should stay on rotation for new work, or if you want to pause assignments until they're active again.`,
    )
  }

  return out.join("\n")
}

export async function vendorInactiveLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<VendorInactiveResult> {
  const landlordId = input.landlordId.trim()
  const empty: VendorInactiveResult = {
    available: false,
    found: false,
    ranked: [],
    bullets: [],
    citations: [],
    markdown: "",
  }
  if (!landlordId) return empty

  const now = new Date()

  const [
    { data: vendors, error: vendorsErr },
    { data: scores, error: scoresErr },
    { data: pending, error: pendingErr },
  ] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, active, last_assigned_at")
      .eq("landlord_id", landlordId)
      .eq("active", true),
    supabase.rpc("get_vendor_scores_for_landlord", { p_landlord_id: landlordId }),
    supabase
      .from("maintenance_requests")
      .select("id, assigned_vendor_id, vendor_work_status, assigned_at, created_at")
      .eq("landlord_id", landlordId)
      .eq("vendor_work_status", "pending_accept")
      .not("assigned_vendor_id", "is", null),
  ])

  if (vendorsErr) console.error("[ask_ulo/vendorInactive] vendors", vendorsErr.message)
  if (scoresErr) console.error("[ask_ulo/vendorInactive] scores", scoresErr.message)
  if (pendingErr) console.error("[ask_ulo/vendorInactive] pending", pendingErr.message)

  if (vendorsErr && !vendors) {
    return {
      ...empty,
      available: false,
      markdown:
        "I couldn't load vendor activity right now. Open Vendors or the job queue to see who's sitting on accepts.",
    }
  }

  const acceptedById = new Map<string, number>()
  for (const r of (scores ?? []) as Array<Record<string, unknown>>) {
    if (typeof r.vendor_id !== "string") continue
    acceptedById.set(r.vendor_id, Number(r.accepted_jobs ?? 0) || 0)
  }

  const pendingById = new Map<string, number>()
  for (const t of pending ?? []) {
    const vid = typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null
    if (!vid) continue
    pendingById.set(vid, (pendingById.get(vid) ?? 0) + 1)
  }

  const ranked: VendorInactiveRow[] = []
  for (const v of vendors ?? []) {
    if (typeof v.id !== "string") continue
    const name = vendorDisplayName(v)
    if (!name) continue
    const pendingAcceptJobs = pendingById.get(v.id) ?? 0
    const acceptedJobs = acceptedById.get(v.id) ?? 0
    const lastAssignedAt =
      typeof v.last_assigned_at === "string" ? v.last_assigned_at : null
    const days = daysSince(lastAssignedAt, now)

    let reason: string
    if (pendingAcceptJobs > 0) {
      reason =
        pendingAcceptJobs === 1
          ? "1 job waiting for the vendor to accept"
          : `${pendingAcceptJobs} jobs waiting for the vendor to accept`
      if (days != null) reason += ` · ${formatLastAssigned(days)}`
    } else if (acceptedJobs === 0) {
      reason =
        days != null
          ? `No accepted jobs on record · ${formatLastAssigned(days)}`
          : "No accepted jobs on record"
    } else {
      reason = formatLastAssigned(days)
    }

    ranked.push({
      vendorId: v.id,
      name,
      pendingAcceptJobs,
      acceptedJobs,
      lastAssignedAt,
      daysSinceAssigned: days,
      reason,
    })
  }

  // Flag: pending accepts, or zero accepted history on the roster.
  const filtered = ranked.filter((r) => r.pendingAcceptJobs > 0 || r.acceptedJobs === 0)

  filtered.sort((a, b) => {
    if (b.pendingAcceptJobs !== a.pendingAcceptJobs) {
      return b.pendingAcceptJobs - a.pendingAcceptJobs
    }
    if (a.acceptedJobs !== b.acceptedJobs) return a.acceptedJobs - b.acceptedJobs
    const ad = a.daysSinceAssigned ?? 10_000
    const bd = b.daysSinceAssigned ?? 10_000
    return bd - ad
  })

  const found = filtered.length > 0
  const markdown = polishAskUloProse(buildMarkdown(filtered))

  console.log(
    "ASK_ULO_VENDOR_INACTIVE",
    JSON.stringify({ landlordId, found, ranked: filtered.length }),
  )

  return {
    available: true,
    found,
    ranked: filtered,
    bullets: filtered.slice(0, 6).map((r) => `${r.name}: ${r.reason}`),
    citations: [
      {
        tool: "ops_graph",
        title: "Vendors without recent accepts",
        citation: "vendors + pending_accept maintenance_requests + vendor scores",
        excerpt: found ? `Top: ${filtered[0]!.name}` : "No inactive vendors flagged",
      },
    ],
    markdown,
  }
}

export const VENDOR_INACTIVE_GUIDE = `
## Vendors without recent accepts

For “Show vendors that haven't accepted jobs recently”:
1. List vendors with jobs the vendor hasn't responded to yet and/or zero accepted jobs.
2. Lead with the takeaway — who needs follow-up first and why it matters.
3. Use natural language (never "pending accept", "~3d ago", or "I'm listing…").
4. Never substitute health scores, occupancy, or property hotspot cards.
`.trim()
