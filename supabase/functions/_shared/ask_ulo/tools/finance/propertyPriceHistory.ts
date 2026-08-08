/**
 * Property sale / valuation history for Ask Ulo.
 * Returns unavailable until county recorder / AVM integrations are wired.
 */

import type { AskUloCitation } from "../../retrieval/searchInternalData.ts"

export type PriceHistoryEvent = {
  date: string
  event: string
  price: number
  changePct: number | null
  source: string
  asOf: string
}

export type PriceChartPoint = {
  date: string
  value: number
}

export type PropertyPriceHistoryResult = {
  available: boolean
  bullets: string[]
  citations: AskUloCitation[]
  events: PriceHistoryEvent[]
  /** Dense series for the Zestimate-style chart (no CSV download). */
  chartSeries: PriceChartPoint[]
  summary: {
    lastSale: number | null
    lastSaleDate: string | null
    currentEstimate: number | null
    appreciationSinceSalePct: number | null
    avgAnnualAppreciationPct: number | null
    /** e.g. "+6.9% since sale" for the chart subtitle */
    changeLabel: string | null
  }
  drivers: string[]
  gapNote: string | null
  needsClarification: boolean
  clarificationPrompt: string | null
}

function moneyCompact(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `$${m.toFixed(m >= 10 ? 1 : 1)}M`.replace(/\.0M$/, "M")
  }
  return `$${Math.round(n).toLocaleString("en-US")}`
}

function formatMonth(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
}

function parseUtc(iso: string): number {
  return new Date(iso.includes("T") ? iso : `${iso}T12:00:00Z`).getTime()
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Build a smooth ~10y valuation curve from sparse sale/estimate anchors.
 * Purely local math — no CSV / network.
 */
export function buildValuationChartSeries(
  anchors: Array<{ date: string; price: number }>,
): PriceChartPoint[] {
  if (anchors.length === 0) return []
  const sorted = [...anchors].sort((a, b) => parseUtc(a.date) - parseUtc(b.date))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const endMs = parseUtc(last.date)
  const targetStart = new Date(endMs)
  targetStart.setUTCFullYear(targetStart.getUTCFullYear() - 10)
  const startMs = Math.min(parseUtc(first.date), targetStart.getTime())

  const annual = 0.015
  const yearsBack = Math.max(0, (parseUtc(first.date) - startMs) / (365.25 * 86400000))
  const startValue = first.price / Math.pow(1 + annual, yearsBack)

  const knots: Array<{ t: number; v: number }> = [
    { t: startMs, v: startValue },
    ...sorted.map((a) => ({ t: parseUtc(a.date), v: a.price })),
  ]

  const out: PriceChartPoint[] = []
  const stepMs = 30.44 * 86400000
  for (let t = startMs, i = 0; t <= endMs + 1; t += stepMs, i++) {
    let v = knots[knots.length - 1].v
    for (let k = 0; k < knots.length - 1; k++) {
      const a = knots[k]
      const b = knots[k + 1]
      if (t >= a.t && t <= b.t) {
        const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
        const e = u * u * (3 - 2 * u)
        v = a.v + (b.v - a.v) * e
        break
      }
      if (t < a.t) {
        v = a.v
        break
      }
    }
    const wobble = 1 + 0.004 * Math.sin(i * 0.55) + 0.002 * Math.sin(i * 1.3)
    out.push({ date: toIsoDate(t), value: Math.round(v * wobble) })
  }
  if (out.length) out[out.length - 1] = { date: last.date, value: last.price }
  return out
}

function emptyPriceResult(
  partial: Partial<PropertyPriceHistoryResult> &
    Pick<PropertyPriceHistoryResult, "needsClarification" | "available">,
): PropertyPriceHistoryResult {
  return {
    bullets: [],
    citations: [],
    events: [],
    chartSeries: [],
    summary: {
      lastSale: null,
      lastSaleDate: null,
      currentEstimate: null,
      appreciationSinceSalePct: null,
      avgAnnualAppreciationPct: null,
      changeLabel: null,
    },
    drivers: [],
    gapNote: null,
    clarificationPrompt: null,
    ...partial,
  }
}

export async function propertyPriceHistoryLookup(input: {
  buildingName: string | null
  addressLine?: string | null
  clarifyOnly?: boolean
}): Promise<PropertyPriceHistoryResult> {
  if (input.clarifyOnly) {
    return emptyPriceResult({
      available: false,
      needsClarification: true,
      clarificationPrompt:
        "Do you want the property’s sale and valuation history, or its rental-price history?",
    })
  }

  const scopeParts = [input.buildingName?.trim(), input.addressLine?.trim()].filter(Boolean)
  const scope = scopeParts.length > 0 ? scopeParts.join(" · ") : null

  return emptyPriceResult({
    available: false,
    needsClarification: false,
    gapNote: scope
      ? `Sale and valuation history is not available for ${scope} yet. Ask for market comps or a rent analysis instead.`
      : "Name a specific property to scope sale and valuation history.",
  })
}

/** Format price-history markdown table for synthesis / fallback. */
export function formatPriceHistoryMarkdown(result: PropertyPriceHistoryResult): string {
  if (result.needsClarification && result.clarificationPrompt) {
    return [
      "## Quick clarification",
      result.clarificationPrompt,
      "",
      "Reply with either **sale and valuation history** or **rental-price history** and I’ll pull the right timeline.",
    ].join("\n")
  }
  if (!result.available) {
    return [
      "## Price History",
      result.gapNote ?? "Price history is not available for this property yet.",
    ].join("\n")
  }

  const parts: string[] = ["## Summary"]
  const s = result.summary
  if (s.lastSale != null) {
    parts.push(
      `- Last recorded sale: **${moneyCompact(s.lastSale)}**` +
        (s.lastSaleDate ? ` (${formatMonth(s.lastSaleDate)})` : ""),
    )
  }
  if (s.currentEstimate != null) {
    parts.push(`- Current estimated value: **${moneyCompact(s.currentEstimate)}**`)
  }
  if (s.appreciationSinceSalePct != null) {
    parts.push(
      `- Estimated appreciation since sale: **${s.appreciationSinceSalePct >= 0 ? "+" : ""}${s.appreciationSinceSalePct}%**`,
    )
  }
  if (s.avgAnnualAppreciationPct != null) {
    parts.push(
      `- Average annual appreciation: **approximately ${s.avgAnnualAppreciationPct}%**`,
    )
  }

  if (result.drivers.length) {
    parts.push("", "## What Changed")
    for (const d of result.drivers) parts.push(`- ${d}`)
  }

  parts.push("", "## Data Source")
  for (const e of result.events) {
    parts.push(`- ${formatMonth(e.date)} · ${e.event}: ${e.source} (as of ${formatMonth(e.asOf)})`)
  }

  parts.push("", "## Next Steps")
  parts.push("- Ask for rent history if you want unit pricing over time instead.")
  parts.push("- Or ask for a full market analysis with comps and Street View.")
  return parts.join("\n")
}
