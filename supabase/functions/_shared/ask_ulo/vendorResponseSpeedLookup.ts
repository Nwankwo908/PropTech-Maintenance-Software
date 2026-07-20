/**
 * Vendor response-speed ranking for Ask Ulo.
 * Answers “Which vendors respond the fastest?” and
 * “Which vendors have poor / slow response times?”
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { polishAskUloProse } from "./responsePolish.ts"
import {
  isVendorPoorResponseSpeedQuestion,
  isVendorResponseSpeedQuestion,
  isVendorRankingQuestion,
} from "./questionSubjectMatch.ts"
import { loadVendorNameById } from "./vendorNames.ts"

export type VendorSpeedRow = {
  vendorId: string
  name: string
  avgResponseMinutes: number | null
  acceptedJobs: number
  completedJobs: number
  responseSpeedScore: number | null
}

export type VendorResponseSpeedResult = {
  available: boolean
  found: boolean
  mode: "fastest" | "slowest"
  ranked: VendorSpeedRow[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
}

export {
  isVendorResponseSpeedQuestion,
  isVendorPoorResponseSpeedQuestion,
  isVendorRankingQuestion,
}

/** Soft bar: avg notify → accept/decline at or above this is “poor”. */
const POOR_RESPONSE_MINUTES = 4 * 60

function formatDuration(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "not enough timed responses yet"
  if (minutes < 60) return `about **${Math.max(1, Math.round(minutes))} minutes**`
  const hours = minutes / 60
  if (hours < 24) {
    const rounded = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)
    return `about **${rounded} hour${rounded === 1 ? "" : "s"}**`
  }
  const days = Math.round(hours / 24)
  return `about **${days} day${days === 1 ? "" : "s"}**`
}

function sortFastestFirst(a: VendorSpeedRow, b: VendorSpeedRow): number {
  if (a.avgResponseMinutes != null && b.avgResponseMinutes != null) {
    return a.avgResponseMinutes - b.avgResponseMinutes
  }
  if (a.avgResponseMinutes != null) return -1
  if (b.avgResponseMinutes != null) return 1
  return (b.responseSpeedScore ?? 0) - (a.responseSpeedScore ?? 0)
}

function sortSlowestFirst(a: VendorSpeedRow, b: VendorSpeedRow): number {
  return sortFastestFirst(b, a)
}

export function buildVendorResponseSpeedMarkdown(input: {
  ranked: VendorSpeedRow[]
  mode: "fastest" | "slowest"
}): string {
  const { ranked, mode } = input
  if (ranked.length === 0) {
    return [
      mode === "slowest"
        ? "I don't have enough timed vendor responses yet to say who has poor response times."
        : "I don't have enough timed vendor responses yet to say who responds the fastest.",
      "",
      "### What's missing",
      "Accept / decline timings after vendors are notified on jobs.",
      "",
      "### What I'd do",
      "Once a few vendors have accepted work, I'll rank them by how quickly they respond.",
    ].join("\n")
  }

  if (mode === "slowest") {
    const timed = ranked.filter((r) => r.avgResponseMinutes != null)
    const clearlyPoor = timed.filter(
      (r) => (r.avgResponseMinutes ?? 0) >= POOR_RESPONSE_MINUTES,
    )
    const list = (clearlyPoor.length > 0 ? clearlyPoor : timed).slice(0, 6)
    const top = list[0] ?? ranked[0]!

    const lead =
      clearlyPoor.length > 0
        ? top.avgResponseMinutes != null
          ? `**${top.name}** has the weakest response time — typically ${formatDuration(top.avgResponseMinutes)} from notify to first accept/decline.`
          : `**${top.name}** looks weakest on response speed among vendors with timed history.`
        : top.avgResponseMinutes != null
          ? `Nobody is clearly in the *poor* band (≥ ~4 hours) yet — the slowest so far is **${top.name}** at ${formatDuration(top.avgResponseMinutes)} average.`
          : `I have limited timed responses; **${top.name}** ranks weakest on response speed among vendors with scores.`

    const out: string[] = [
      lead,
      "",
      "I'm ranking by **average response time** (notify → first accept/decline) — not overall vendor score.",
      "",
      clearlyPoor.length > 0
        ? "### Vendors with poor response times"
        : "### Slowest responders",
    ]

    for (const [i, row] of list.entries()) {
      const sample =
        row.acceptedJobs > 0
          ? `${row.acceptedJobs} accepted job${row.acceptedJobs === 1 ? "" : "s"}`
          : "limited sample"
      out.push(
        `${i + 1}. **${row.name}** — ${formatDuration(row.avgResponseMinutes)} average response (${sample}).`,
      )
    }

    out.push("")
    out.push("### What I'd do")
    out.push(
      clearlyPoor.length > 0
        ? `I'd pause time-sensitive assignments to **${top.name}** until response improves — and use faster vendors for urgent tickets.`
        : `I'd still watch **${top.name}** on turnaround, and ask again after more accepts land so a clearer “poor” cut shows up.`,
    )

    return out.join("\n")
  }

  const top = ranked[0]!
  const lead =
    top.avgResponseMinutes != null
      ? `**${top.name}** responds the fastest — typically ${formatDuration(top.avgResponseMinutes)} from notify to first accept/decline.`
      : `**${top.name}** ranks best on response speed among vendors with scored history.`

  const out: string[] = [
    lead,
    "",
    "I'm ranking by **average response time** (notify → first accept/decline) — not overall vendor score.",
    "",
    "### Fastest responders",
  ]

  for (const [i, row] of ranked.slice(0, 6).entries()) {
    const sample =
      row.acceptedJobs > 0
        ? `${row.acceptedJobs} accepted job${row.acceptedJobs === 1 ? "" : "s"}`
        : "limited sample"
    out.push(
      `${i + 1}. **${row.name}** — ${formatDuration(row.avgResponseMinutes)} average response (${sample}).`,
    )
  }

  out.push("")
  out.push("### What I'd do")
  out.push(
    `I'd route time-sensitive work to **${top.name}** first when they're the right trade — and chase anyone consistently slow to accept.`,
  )

  return out.join("\n")
}

export async function vendorResponseSpeedLookup(
  supabase: SupabaseClient,
  input: { landlordId: string; question?: string },
): Promise<VendorResponseSpeedResult> {
  const landlordId = input.landlordId.trim()
  const mode: "fastest" | "slowest" = isVendorPoorResponseSpeedQuestion(
      input.question ?? "",
    )
    ? "slowest"
    : "fastest"
  const empty: VendorResponseSpeedResult = {
    available: false,
    found: false,
    mode,
    ranked: [],
    bullets: [],
    citations: [],
    markdown: "",
  }
  if (!landlordId) return empty

  const { data: scores, error } = await supabase.rpc("get_vendor_scores_for_landlord", {
    p_landlord_id: landlordId,
  })

  if (error) {
    console.error("[ask_ulo/vendorResponseSpeed]", error.message)
    return {
      ...empty,
      available: false,
      markdown:
        "I couldn't load vendor response timings right now. Open Vendors to see response-speed scores, or try again in a moment.",
    }
  }

  const rows = (scores ?? []) as Array<Record<string, unknown>>
  const vendorIds = rows
    .map((r) => (typeof r.vendor_id === "string" ? r.vendor_id : null))
    .filter((id): id is string => Boolean(id))

  const nameById = await loadVendorNameById(supabase, { landlordId, vendorIds })

  const ranked: VendorSpeedRow[] = []
  for (const r of rows) {
    const vendorId = typeof r.vendor_id === "string" ? r.vendor_id : null
    if (!vendorId) continue
    const avg =
      r.avg_response_time == null || r.avg_response_time === ""
        ? null
        : Number(r.avg_response_time)
    const score =
      r.response_speed_score == null || r.response_speed_score === ""
        ? null
        : Number(r.response_speed_score)
    // Need either a timed average or a response-speed score to rank.
    if ((avg == null || !Number.isFinite(avg)) && (score == null || !Number.isFinite(score))) {
      continue
    }
    const displayName = nameById.get(vendorId)
    if (!displayName) continue
    ranked.push({
      vendorId,
      name: displayName,
      avgResponseMinutes: avg != null && Number.isFinite(avg) ? avg : null,
      acceptedJobs: Number(r.accepted_jobs ?? 0) || 0,
      completedJobs: Number(r.completed_jobs ?? 0) || 0,
      responseSpeedScore: score != null && Number.isFinite(score) ? score : null,
    })
  }

  ranked.sort(mode === "slowest" ? sortSlowestFirst : sortFastestFirst)

  const found = ranked.length > 0
  const markdown = polishAskUloProse(
    buildVendorResponseSpeedMarkdown({ ranked, mode }),
  )

  console.log(
    "ASK_ULO_VENDOR_RESPONSE_SPEED",
    JSON.stringify({ landlordId, found, mode, ranked: ranked.length }),
  )

  return {
    available: true,
    found,
    mode,
    ranked,
    bullets: ranked.slice(0, 5).map((r) => `${r.name}: ${formatDuration(r.avgResponseMinutes)}`),
    citations: [
      {
        tool: "ops_graph",
        title: mode === "slowest" ? "Poor vendor response times" : "Vendor response speed",
        citation: "get_vendor_scores_for_landlord (avg_response_time minutes)",
        excerpt: found
          ? mode === "slowest"
            ? `Slowest: ${ranked[0]!.name}`
            : `Fastest: ${ranked[0]!.name}`
          : "No timed vendor responses yet",
      },
    ],
    markdown,
  }
}

export const VENDOR_RESPONSE_SPEED_GUIDE = `
## Vendor response speed

For “Which vendors respond the fastest?” / “Which vendors have poor response times?”:
1. Rank vendors by average response time (notify → first accept/decline).
2. For poor/slow asks, lead with the slowest — never overall vendor score / “best vendor”.
3. Never substitute “Oakwood needs attention first” or critical WO counts.
4. If timings are missing, say so and explain what would unlock the ranking.
`.trim()
