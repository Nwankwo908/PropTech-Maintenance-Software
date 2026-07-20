/**
 * Vendor completion-rate ranking for Ask Ulo.
 * Answers “Which vendor has the highest completion rate?”
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { polishAskUloProse } from "./responsePolish.ts"
import { isVendorCompletionQuestion } from "./questionMetricContext.ts"
import { loadVendorNameById } from "./vendorNames.ts"

export type VendorCompletionRow = {
  vendorId: string
  name: string
  completionRate: number | null
  completedJobs: number
  acceptedJobs: number
}

export type VendorCompletionResult = {
  available: boolean
  found: boolean
  ranked: VendorCompletionRow[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
}

export { isVendorCompletionQuestion }

function formatPct(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "no completion rate yet"
  return `**${Math.round(rate * 100)}%**`
}

function buildMarkdown(ranked: VendorCompletionRow[]): string {
  if (ranked.length === 0) {
    return [
      "I don't have enough completed jobs yet to rank vendors by completion rate.",
      "",
      "### What's missing",
      "Finished work orders per vendor so completion rate (completed ÷ accepted) can be scored.",
      "",
      "### What I'd do",
      "After a few jobs close out, ask again — I'll rank by who finishes the work they accept.",
    ].join("\n")
  }

  const top = ranked[0]!
  const lead =
    top.completionRate != null
      ? `**${top.name}** has the highest completion rate — ${formatPct(top.completionRate)}` +
        (top.completedJobs > 0
          ? ` across **${top.completedJobs}** completed job${top.completedJobs === 1 ? "" : "s"}.`
          : ".")
      : `**${top.name}** leads on completion among vendors with scored history.`

  const out: string[] = [
    lead,
    "",
    "I'm ranking by **completion rate** (finished jobs ÷ accepted) — not response speed or property priority.",
    "",
    "### Highest completion",
  ]

  for (const [i, row] of ranked.slice(0, 6).entries()) {
    const sample =
      row.completedJobs > 0
        ? `${row.completedJobs} completed`
        : row.acceptedJobs > 0
          ? `${row.acceptedJobs} accepted`
          : "limited sample"
    out.push(
      `${i + 1}. **${row.name}** — ${formatPct(row.completionRate)} (${sample}).`,
    )
  }

  out.push("")
  out.push("### What I'd do")
  out.push(
    `I'd prefer **${top.name}** when you need reliable finish rates — and ask if you want this by speed or overall score instead.`,
  )

  return out.join("\n")
}

export async function vendorCompletionLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<VendorCompletionResult> {
  const landlordId = input.landlordId.trim()
  const empty: VendorCompletionResult = {
    available: false,
    found: false,
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
    console.error("[ask_ulo/vendorCompletion]", error.message)
    return {
      ...empty,
      available: false,
      markdown:
        "I couldn't load vendor completion rates right now. Open Vendors to compare scores, or try again in a moment.",
    }
  }

  const rows = (scores ?? []) as Array<Record<string, unknown>>
  const vendorIds = rows
    .map((r) => (typeof r.vendor_id === "string" ? r.vendor_id : null))
    .filter((id): id is string => Boolean(id))

  const nameById = await loadVendorNameById(supabase, { landlordId, vendorIds })

  const ranked: VendorCompletionRow[] = []
  for (const r of rows) {
    const vendorId = typeof r.vendor_id === "string" ? r.vendor_id : null
    if (!vendorId) continue
    const completion =
      r.completion_rate == null || r.completion_rate === ""
        ? null
        : Number(r.completion_rate)
    const completedJobs = Number(r.completed_jobs ?? 0) || 0
    const acceptedJobs = Number(r.accepted_jobs ?? 0) || 0
    if (
      (completion == null || !Number.isFinite(completion)) &&
      completedJobs <= 0 &&
      acceptedJobs <= 0
    ) {
      continue
    }
    const displayName = nameById.get(vendorId)
    if (!displayName) continue
    ranked.push({
      vendorId,
      name: displayName,
      completionRate: completion != null && Number.isFinite(completion) ? completion : null,
      completedJobs,
      acceptedJobs,
    })
  }

  ranked.sort((a, b) => {
    if (a.completionRate != null && b.completionRate != null) {
      if (b.completionRate !== a.completionRate) return b.completionRate - a.completionRate
      return b.completedJobs - a.completedJobs
    }
    if (a.completionRate != null) return -1
    if (b.completionRate != null) return 1
    return b.completedJobs - a.completedJobs
  })

  const withRate = ranked.filter((r) => r.completionRate != null || r.completedJobs > 0)
  const found = withRate.length > 0
  const finalRanked = found ? withRate : []
  const markdown = polishAskUloProse(buildMarkdown(finalRanked))

  console.log(
    "ASK_ULO_VENDOR_COMPLETION",
    JSON.stringify({ landlordId, found, ranked: finalRanked.length }),
  )

  return {
    available: true,
    found,
    ranked: finalRanked,
    bullets: finalRanked.slice(0, 5).map(
      (r) => `${r.name}: ${formatPct(r.completionRate)} (${r.completedJobs} completed)`,
    ),
    citations: [
      {
        tool: "ops_graph",
        title: "Vendor completion rate",
        citation: "get_vendor_scores_for_landlord (completion_rate)",
        excerpt: found
          ? `Highest: ${finalRanked[0]!.name}`
          : "No completion rates yet",
      },
    ],
    markdown,
  }
}

export const VENDOR_COMPLETION_GUIDE = `
## Vendor completion rate

For “Which vendor has the highest completion rate?”:
1. Rank vendors by completion_rate (completed ÷ accepted).
2. Lead with the highest-completion vendor and the rate — never a property priority card.
3. Never substitute “Oakwood needs attention first” or critical WO counts.
4. If completion history is missing, say so and explain what unlocks the ranking.
`.trim()
