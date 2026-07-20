/**
 * Overall “best vendor” ranking (optionally by trade).
 * Answers “Who is my best electrician?” — not response-speed alone.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  vendorTradeMatchesFlexible,
  type VendorTradeSlug,
} from "../vendor_trades.ts"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { polishAskUloProse } from "./responsePolish.ts"
import {
  detectVendorTradeFromQuestion,
  isVendorBestQuestion,
  isVendorRecommendQuestion,
} from "./questionMetricContext.ts"
import { vendorDisplayName } from "./vendorNames.ts"
import {
  loadVendorTradeJobHistory,
  type VendorTradeJobHistory,
} from "./vendorTradeJobHistory.ts"
import {
  mergeRosterAndExternalMarkdown,
  shouldRunExternalVendorDiscovery,
  vendorExternalDiscoveryLookup,
  type VendorExternalDiscoveryResult,
} from "./vendorExternalDiscoveryLookup.ts"

export type VendorBestRow = {
  vendorId: string
  name: string
  category: string | null
  vendorScore: number | null
  residentSatisfaction: number | null
  reviewCount: number
  completedJobs: number
  acceptedJobs: number
  avgResponseMinutes: number | null
  completionRate: number | null
  /** Example units/buildings from matching trade tickets. */
  sampleLocations?: string[]
}

export type VendorBestResult = {
  available: boolean
  found: boolean
  tradeSlug: VendorTradeSlug | null
  tradeLabel: string | null
  ranked: VendorBestRow[]
  external?: VendorExternalDiscoveryResult | null
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
}

export { isVendorBestQuestion }

function formatPct(rate: number | null): string | null {
  if (rate == null || !Number.isFinite(rate)) return null
  return `${Math.round(rate * 100)}%`
}

function formatMinutes(minutes: number | null): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null
  if (minutes < 60) return `~${Math.max(1, Math.round(minutes))} min response`
  const hours = minutes / 60
  if (hours < 24) {
    const rounded = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)
    return `~${rounded}h response`
  }
  return `~${Math.round(hours / 24)}d response`
}

function scoreBits(row: VendorBestRow): string[] {
  const bits: string[] = []
  if (row.vendorScore != null) bits.push(`score **${row.vendorScore}/5**`)
  if (row.residentSatisfaction != null && row.reviewCount > 0) {
    bits.push(`${row.residentSatisfaction}/5 resident rating (${row.reviewCount})`)
  }
  const completion = formatPct(row.completionRate)
  if (completion && row.completedJobs > 0) {
    bits.push(`${completion} completion · ${row.completedJobs} finished`)
  } else if (row.completedJobs > 0) {
    bits.push(`${row.completedJobs} completed job${row.completedJobs === 1 ? "" : "s"}`)
  }
  const speed = formatMinutes(row.avgResponseMinutes)
  if (speed) bits.push(speed)
  if (row.sampleLocations?.length) {
    bits.push(`incl. ${row.sampleLocations.slice(0, 2).join("; ")}`)
  }
  return bits
}

function buildMarkdown(input: {
  tradeLabel: string | null
  ranked: VendorBestRow[]
  isRecommend?: boolean
  isCompare?: boolean
}): string {
  const tradeBit = input.tradeLabel ?? "vendor"
  if (input.ranked.length === 0) {
    return [
      input.tradeLabel
        ? input.isRecommend
          ? `I don't have another strong ${tradeBit} to recommend from your roster yet.`
          : input.isCompare
            ? `I couldn't find ${tradeBit} job history on your roster to compare yet.`
            : `I don't have enough scored history yet to pick your best ${tradeBit}.`
        : "I don't have enough scored vendor history yet to say who's best.",
      "",
      "### What's missing",
      "Completed jobs (and/or resident ratings) for that trade — including vendors tagged as generalists who still finished those tickets.",
      "",
      "### What I'd do",
      input.tradeLabel
        ? `Open Vendors and set the right trade on your ${tradeBit}s, then ask again — or open a work order so history can build.`
        : "Open Vendors to review who's on your roster, then ask again after a few completed jobs.",
    ].join("\n")
  }

  const top = input.ranked[0]!
  const bits = scoreBits(top)
  const lead = input.isRecommend
    ? bits.length > 0
      ? `If you need another ${tradeBit}, **${top.name}** is the strongest alternative on your roster — ${bits.join("; ")}.`
      : `If you need another ${tradeBit}, **${top.name}** is the strongest alternative on your roster based on available history.`
    : input.isCompare && input.ranked.length === 1
      ? bits.length > 0
        ? `For this ${tradeBit} compare, **${top.name}** is the only ${tradeBit} with finished work on your books — ${bits.join("; ")}. I don't have a second ${tradeBit} with enough history to put beside them yet.`
        : `**${top.name}** is the only ${tradeBit} with usable history to compare so far.`
    : input.isCompare
      ? bits.length > 0
        ? `Here's how your ${tradeBit}s compare — **${top.name}** leads on available history (${bits.join("; ")}).`
        : `Here's how your ${tradeBit}s compare based on completed work and scores on your roster.`
      : bits.length > 0
        ? `**${top.name}** is your best ${tradeBit} right now — ${bits.join("; ")}.`
        : `**${top.name}** is the strongest ${tradeBit} on your roster based on available history.`

  const out: string[] = [
    lead,
    "",
    input.isRecommend
      ? "This is based on **overall vendor score** — satisfaction, completion, response time, and rework — not just who responds fastest."
      : input.isCompare
        ? "I'm comparing from **job history + vendor scores** for this trade (including generalists who completed matching work) — not response speed alone."
        : "Overall vendor score combines satisfaction, completion, response time, and rework — not response speed alone.",
    "",
    input.isCompare
      ? `### ${input.tradeLabel ? input.tradeLabel + " compare" : "Vendor compare"}`
      : `### Top ${input.tradeLabel ? input.tradeLabel + "s" : "vendors"}`,
  ]

  for (const [i, row] of input.ranked.slice(0, 5).entries()) {
    const rowBits = scoreBits(row)
    out.push(
      `${i + 1}. **${row.name}**${rowBits.length ? ` — ${rowBits.join("; ")}` : ""}.`,
    )
  }

  out.push("")
  out.push("### What I'd do")
  out.push(
    input.isRecommend
      ? `I'd try **${top.name}** for the next ${tradeBit} job if your current vendor isn't working out — and keep a second option from this list in your back pocket.`
      : `I'd send ${tradeBit} work to **${top.name}** first when they're available — and ask if you want this ranked by speed, ratings, or completion instead.`,
  )

  return out.join("\n")
}

/** Include specialists for the trade, plus generalists with matching job history. */
export function vendorIncludedForTrade(input: {
  category: string | null
  tradeSlug: VendorTradeSlug | null
  tradeLabel: string | null
  history: VendorTradeJobHistory | undefined
}): boolean {
  if (!input.tradeSlug) return true
  const specialist =
    vendorTradeMatchesFlexible(input.category, input.tradeSlug) ||
    vendorTradeMatchesFlexible(input.category, input.tradeLabel ?? input.tradeSlug)
  if (specialist) return true
  const h = input.history
  return Boolean(h && (h.completedJobs > 0 || h.openJobs > 0))
}

export async function vendorBestLookup(
  supabase: SupabaseClient,
  input: { landlordId: string; question: string; buildingFilter?: string | null },
): Promise<VendorBestResult> {
  const landlordId = input.landlordId.trim()
  const trade = detectVendorTradeFromQuestion(input.question)
  const empty: VendorBestResult = {
    available: false,
    found: false,
    tradeSlug: trade.slug,
    tradeLabel: trade.label,
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
    console.error("[ask_ulo/vendorBest]", error.message)
    return {
      ...empty,
      available: false,
      markdown:
        "I couldn't load vendor scores right now. Open Vendors to compare scores, or try again in a moment.",
    }
  }

  const scoreRows = (scores ?? []) as Array<Record<string, unknown>>
  const byId = new Map<string, Record<string, unknown>>()
  for (const r of scoreRows) {
    if (typeof r.vendor_id === "string") byId.set(r.vendor_id, r)
  }

  const { data: vendors, error: vendorsErr } = await supabase
    .from("vendors")
    .select("id, name, category, active")
    .eq("landlord_id", landlordId)
    .eq("active", true)

  if (vendorsErr) {
    console.error("[ask_ulo/vendorBest] vendors", vendorsErr.message)
  }

  const tradeJobs = trade.slug
    ? await loadVendorTradeJobHistory(supabase, {
      landlordId,
      tradeSlug: trade.slug,
    })
    : new Map<string, VendorTradeJobHistory>()

  const ranked: VendorBestRow[] = []
  for (const v of vendors ?? []) {
    if (typeof v.id !== "string") continue
    const category = typeof v.category === "string" ? v.category : null
    const history = tradeJobs.get(v.id)
    if (
      !vendorIncludedForTrade({
        category,
        tradeSlug: trade.slug,
        tradeLabel: trade.label,
        history,
      })
    ) {
      continue
    }

    const s = byId.get(v.id)
    const name = vendorDisplayName(v)
    if (!name) continue
    const vendorScore =
      s?.vendor_score == null || s.vendor_score === ""
        ? null
        : Number(s.vendor_score)
    const avg =
      s?.avg_response_time == null || s.avg_response_time === ""
        ? null
        : Number(s.avg_response_time)
    const completion =
      s?.completion_rate == null || s.completion_rate === ""
        ? null
        : Number(s.completion_rate)
    const satisfaction =
      s?.resident_satisfaction == null || s.resident_satisfaction === ""
        ? null
        : Number(s.resident_satisfaction)

    const scoreCompleted = Number(s?.completed_jobs ?? 0) || 0
    const historyCompleted = history?.completedJobs ?? 0
    const completedJobs = Math.max(scoreCompleted, historyCompleted)

    ranked.push({
      vendorId: v.id,
      name,
      category,
      vendorScore: vendorScore != null && Number.isFinite(vendorScore) ? vendorScore : null,
      residentSatisfaction:
        satisfaction != null && Number.isFinite(satisfaction) ? satisfaction : null,
      reviewCount: Number(s?.review_count ?? 0) || 0,
      completedJobs,
      acceptedJobs: Number(s?.accepted_jobs ?? 0) || 0,
      avgResponseMinutes: avg != null && Number.isFinite(avg) ? avg : null,
      completionRate: completion != null && Number.isFinite(completion) ? completion : null,
      sampleLocations: history?.sampleLocations?.length
        ? history.sampleLocations
        : undefined,
    })
  }

  ranked.sort((a, b) => {
    if (a.vendorScore != null && b.vendorScore != null) return b.vendorScore - a.vendorScore
    if (a.vendorScore != null) return -1
    if (b.vendorScore != null) return 1
    if (a.completedJobs !== b.completedJobs) return b.completedJobs - a.completedJobs
    if (a.reviewCount !== b.reviewCount) return b.reviewCount - a.reviewCount
    return a.name.localeCompare(b.name)
  })

  // Prefer vendors with any scored signal; keep unscored trade matches only if nothing scored.
  const withSignal = ranked.filter(
    (r) =>
      r.vendorScore != null ||
      r.completedJobs > 0 ||
      r.acceptedJobs > 0 ||
      r.reviewCount > 0 ||
      (r.sampleLocations?.length ?? 0) > 0,
  )
  const finalRanked = withSignal.length > 0 ? withSignal : ranked

  const rosterFound = finalRanked.some(
    (r) =>
      r.vendorScore != null ||
      r.completedJobs > 0 ||
      r.reviewCount > 0 ||
      (r.sampleLocations?.length ?? 0) > 0,
  )

  const isCompare =
    /\bcompar(?:e|ing|ison)\b/i.test(input.question) &&
    !isVendorRecommendQuestion(input.question)

  const rosterMarkdown = polishAskUloProse(
    buildMarkdown({
      tradeLabel: trade.label,
      ranked: rosterFound ? finalRanked : [],
      isRecommend: isVendorRecommendQuestion(input.question),
      isCompare,
    }),
  )

  let external: VendorExternalDiscoveryResult | null = null
  if (
    shouldRunExternalVendorDiscovery({
      question: input.question,
      rosterFound,
      rosterCount: finalRanked.length,
    })
  ) {
    external = await vendorExternalDiscoveryLookup(supabase, {
      landlordId,
      question: input.question,
      buildingFilter: input.buildingFilter,
      rosterHadOptions: rosterFound,
    })
  }

  const found = rosterFound || (external?.found ?? false)
  const markdown = mergeRosterAndExternalMarkdown({
    rosterMarkdown,
    external,
    rosterFound,
  })

  const bullets = [
    ...finalRanked.slice(0, 5).map((r) => {
      const bits = scoreBits(r)
      return `${r.name}${bits.length ? `: ${bits.join("; ")}` : ""}`
    }),
    ...(external?.bullets ?? []),
  ]

  const citations: AskUloCitation[] = [
    {
      tool: "ops_graph",
      title: trade.label ? `Best ${trade.label}` : "Best vendor",
      citation: "get_vendor_scores_for_landlord (vendor_score composite)",
      excerpt: rosterFound
        ? `Top: ${finalRanked[0]!.name}`
        : external?.found
          ? `Roster thin; external: ${external.suggestions[0]?.name ?? "none"}`
          : "No scored vendors for this trade yet",
    },
  ]
  if (external?.citations.length) {
    citations.push(...external.citations)
  }

  console.log(
    "ASK_ULO_VENDOR_BEST",
    JSON.stringify({
      landlordId,
      trade: trade.slug,
      found,
      rosterFound,
      externalFound: external?.found ?? false,
      ranked: finalRanked.length,
    }),
  )

  return {
    available: true,
    found,
    tradeSlug: trade.slug,
    tradeLabel: trade.label,
    ranked: finalRanked,
    external,
    bullets,
    citations,
    markdown,
  }
}

export const VENDOR_BEST_GUIDE = `
## Best vendor (overall quality)

For “Who is my best electrician?” / “best plumber” / “Compare my HVAC vendors”:
1. Infer the trade from the question when present.
2. Rank that trade by overall vendor_score, and include generalists who completed matching trade jobs.
3. Cite completed job locations when available (e.g. Birch Tower).
4. Say what “best” / “compare” means in one line — never pretend they only asked about response speed.
5. Offer to re-rank by a specific metric if they want something narrower.

For “Recommend another [trade]” or thin roster / outside-network asks:
6. After roster ranking, run local external discovery near the portfolio when roster is empty, has fewer than two matches, or they asked for someone outside the network.
7. Merge roster + external sections; external hits come from discoverExternalVendors (Google/Yelp/mock).
`.trim()
