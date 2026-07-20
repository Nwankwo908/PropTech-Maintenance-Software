/**
 * Vendors carrying the most open work (“overloaded” / busiest / at capacity).
 * Answers “Which vendors are overloaded?” — not quality/best score.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { polishAskUloProse } from "./responsePolish.ts"
import { isVendorOverloadQuestion } from "./questionSubjectMatch.ts"
import { vendorDisplayName } from "./vendorNames.ts"

export type VendorOverloadRow = {
  vendorId: string
  name: string
  openJobs: number
  pendingAccept: number
  accepted: number
  inProgress: number
  oldestOpenDays: number | null
}

export type VendorOverloadResult = {
  available: boolean
  found: boolean
  ranked: VendorOverloadRow[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
}

export { isVendorOverloadQuestion }

const ACTIVE_VENDOR_LOAD_STATUSES = [
  "pending_accept",
  "accepted",
  "in_progress",
] as const

/** Soft threshold: at or above this open count, call them overloaded. */
const OVERLOAD_OPEN_JOBS = 2

function daysOpen(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}

function describeLoad(row: VendorOverloadRow): string {
  const parts: string[] = []
  if (row.inProgress > 0) {
    parts.push(
      `${row.inProgress} in progress`,
    )
  }
  if (row.accepted > 0) {
    parts.push(
      `${row.accepted} accepted, not started`,
    )
  }
  if (row.pendingAccept > 0) {
    parts.push(
      `${row.pendingAccept} still waiting for them to respond`,
    )
  }
  const detail = parts.length > 0 ? ` (${parts.join("; ")})` : ""
  const aging =
    row.oldestOpenDays != null && row.oldestOpenDays >= 2
      ? ` · oldest open about ${row.oldestOpenDays} day${row.oldestOpenDays === 1 ? "" : "s"}`
      : ""
  const jobWord = row.openJobs === 1 ? "open job" : "open jobs"
  return `**${row.name}** — **${row.openJobs}** ${jobWord}${detail}${aging}.`
}

function buildMarkdown(ranked: VendorOverloadRow[]): string {
  if (ranked.length === 0) {
    return [
      "Nobody on your roster looks overloaded right now — open assigned work is light across active vendors.",
      "",
      "### What I'd do",
      "Keep assigning as usual. If one trade is thin, ask me to recommend another vendor for that trade before the queue piles up.",
    ].join("\n")
  }

  const top = ranked[0]!
  const overloaded = ranked.filter((r) => r.openJobs >= OVERLOAD_OPEN_JOBS)
  const focus = overloaded.length > 0 ? overloaded : ranked.slice(0, 3)

  const lead =
    top.openJobs >= OVERLOAD_OPEN_JOBS
      ? top.openJobs === 1
        ? `**${top.name}** is the busiest right now with one open job still on their plate.`
        : `**${top.name}** looks the most overloaded — **${top.openJobs}** open jobs still assigned to them.`
      : `**${top.name}** is carrying the most open work right now (**${top.openJobs}**), though the load still looks manageable.`

  const out: string[] = [
    lead,
    "",
    "I'm ranking by **open assigned jobs** (waiting on accept, accepted, or in progress) — not by score or who finishes the most.",
    "",
    overloaded.length > 0 ? "### Vendors looking overloaded" : "### Vendors with the most open work",
  ]

  for (const [i, row] of focus.slice(0, 8).entries()) {
    out.push(`${i + 1}. ${describeLoad(row)}`)
  }

  out.push("")
  out.push("### What I'd do")
  out.push(
    `Pause new assignments to **${top.name}** until their open jobs move, and send the next few jobs to vendors with a lighter load — or ask me for another option in that trade.`,
  )

  return out.join("\n")
}

export async function vendorOverloadLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<VendorOverloadResult> {
  const landlordId = input.landlordId.trim()
  const empty: VendorOverloadResult = {
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
    { data: openTickets, error: openErr },
  ] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, active")
      .eq("landlord_id", landlordId)
      .eq("active", true),
    supabase
      .from("maintenance_requests")
      .select("id, assigned_vendor_id, vendor_work_status, assigned_at, created_at")
      .eq("landlord_id", landlordId)
      .in("vendor_work_status", [...ACTIVE_VENDOR_LOAD_STATUSES])
      .not("assigned_vendor_id", "is", null),
  ])

  if (vendorsErr) console.error("[ask_ulo/vendorOverload] vendors", vendorsErr.message)
  if (openErr) console.error("[ask_ulo/vendorOverload] open", openErr.message)

  if (vendorsErr && !vendors) {
    return {
      ...empty,
      available: false,
      markdown:
        "I couldn't load vendor workload right now. Open Active Tasks or Vendors to see who's carrying open jobs.",
    }
  }

  type Acc = {
    pendingAccept: number
    accepted: number
    inProgress: number
    oldestDays: number | null
  }
  const byId = new Map<string, Acc>()

  for (const t of openTickets ?? []) {
    const vid = typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null
    if (!vid) continue
    const status = typeof t.vendor_work_status === "string" ? t.vendor_work_status : ""
    const assignedAt =
      typeof t.assigned_at === "string"
        ? t.assigned_at
        : typeof t.created_at === "string"
          ? t.created_at
          : null
    const days = daysOpen(assignedAt, now)
    const prev = byId.get(vid) ?? {
      pendingAccept: 0,
      accepted: 0,
      inProgress: 0,
      oldestDays: null,
    }
    if (status === "pending_accept") prev.pendingAccept += 1
    else if (status === "accepted") prev.accepted += 1
    else if (status === "in_progress") prev.inProgress += 1
    if (days != null && (prev.oldestDays == null || days > prev.oldestDays)) {
      prev.oldestDays = days
    }
    byId.set(vid, prev)
  }

  const ranked: VendorOverloadRow[] = []
  for (const v of vendors ?? []) {
    if (typeof v.id !== "string") continue
    const name = vendorDisplayName(v)
    if (!name) continue
    const acc = byId.get(v.id)
    if (!acc) continue
    const openJobs = acc.pendingAccept + acc.accepted + acc.inProgress
    if (openJobs <= 0) continue
    ranked.push({
      vendorId: v.id,
      name,
      openJobs,
      pendingAccept: acc.pendingAccept,
      accepted: acc.accepted,
      inProgress: acc.inProgress,
      oldestOpenDays: acc.oldestDays,
    })
  }

  ranked.sort((a, b) => {
    if (b.openJobs !== a.openJobs) return b.openJobs - a.openJobs
    const ad = a.oldestOpenDays ?? -1
    const bd = b.oldestOpenDays ?? -1
    return bd - ad
  })

  const found = ranked.some((r) => r.openJobs > 0)
  const markdown = polishAskUloProse(buildMarkdown(found ? ranked : []))

  console.log(
    "ASK_ULO_VENDOR_OVERLOAD",
    JSON.stringify({ landlordId, found, ranked: ranked.length }),
  )

  return {
    available: true,
    found,
    ranked,
    bullets: ranked.slice(0, 6).map((r) => `${r.name}: ${r.openJobs} open`),
    citations: [
      {
        tool: "ops_graph",
        title: "Vendor open workload",
        citation: "maintenance_requests open by assigned_vendor_id",
        excerpt: found ? `Top: ${ranked[0]!.name} (${ranked[0]!.openJobs} open)` : "No open vendor load",
      },
    ],
    markdown,
  }
}

export const VENDOR_OVERLOAD_GUIDE = `
## Overloaded / busy vendors

For “Which vendors are overloaded?”:
1. Rank by open assigned jobs (pending accept + accepted + in progress).
2. Lead with who is carrying the most work — never overall vendor score / “best”.
3. Suggest pausing new assignments to the busiest vendor.
`.trim()
