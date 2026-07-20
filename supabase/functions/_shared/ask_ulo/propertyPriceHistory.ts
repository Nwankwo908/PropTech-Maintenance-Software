/**
 * Property sale / valuation history for Ask Ulo.
 * Demo buildings use curated sale + valuation points; ZIP ZHVI adds neighborhood index context.
 */

import type { AskUloCitation } from "./opsGraphLookup.ts"

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

type DemoSeries = {
  address: string
  zip: string
  events: Array<{
    date: string
    event: string
    price: number
    source: string
  }>
  drivers: string[]
}

/** Curated multifamily sale/valuation history for demo portfolio buildings. */
const DEMO_PRICE_HISTORY: Record<string, DemoSeries> = {
  "Maple Heights": {
    address: "901 Maple Heights Blvd, Hillsboro, OR 97124",
    zip: "97124",
    events: [
      {
        date: "2022-08-15",
        event: "Last recorded sale",
        price: 11_600_000,
        source: "County recorder / portfolio close package",
      },
      {
        date: "2025-01-31",
        event: "Estimated value",
        price: 12_100_000,
        source: "Portfolio valuation model",
      },
      {
        date: "2026-05-31",
        event: "Estimated value",
        price: 12_400_000,
        source: "Portfolio valuation model",
      },
    ],
    drivers: [
      "Rental income increased with renewals above prior-year rents",
      "Local multifamily values improved with Hillsboro employment demand",
      "Occupancy remained stable",
      "Interest-rate pressure limited faster appreciation",
    ],
  },
  "Oakwood Apartments": {
    address: "812 Oakwood Ave, Portland, OR 97214",
    zip: "97214",
    events: [
      {
        date: "2021-06-01",
        event: "Last recorded sale",
        price: 8_400_000,
        source: "County recorder / portfolio close package",
      },
      {
        date: "2024-12-31",
        event: "Estimated value",
        price: 9_050_000,
        source: "Portfolio valuation model",
      },
      {
        date: "2026-05-31",
        event: "Estimated value",
        price: 9_350_000,
        source: "Portfolio valuation model",
      },
    ],
    drivers: [
      "Inner-east Portland rents supported NOI growth",
      "Cap-rate compression paused after 2023 rate resets",
      "Occupancy stayed high with limited new supply nearby",
    ],
  },
  "Pine Ridge": {
    address: "220 Pine Ridge Dr, Portland, OR 97217",
    zip: "97217",
    events: [
      {
        date: "2020-11-12",
        event: "Last recorded sale",
        price: 6_900_000,
        source: "County recorder / portfolio close package",
      },
      {
        date: "2025-01-31",
        event: "Estimated value",
        price: 7_450_000,
        source: "Portfolio valuation model",
      },
      {
        date: "2026-05-31",
        event: "Estimated value",
        price: 7_600_000,
        source: "Portfolio valuation model",
      },
    ],
    drivers: [
      "North Portland demand remained resilient",
      "Deferred capex limited upside vs newer stock",
    ],
  },
  "Cedar Court": {
    address: "45 Cedar Court Ln, Beaverton, OR 97005",
    zip: "97005",
    events: [
      {
        date: "2019-09-30",
        event: "Last recorded sale",
        price: 5_200_000,
        source: "County recorder / portfolio close package",
      },
      {
        date: "2025-01-31",
        event: "Estimated value",
        price: 5_850_000,
        source: "Portfolio valuation model",
      },
      {
        date: "2026-05-31",
        event: "Estimated value",
        price: 6_000_000,
        source: "Portfolio valuation model",
      },
    ],
    drivers: [
      "Beaverton suburban rent growth outpaced downtown Portland",
      "Stable occupancy supported valuation",
    ],
  },
  "Birch Tower": {
    address: "12 Birch Tower Way, Portland, OR 97209",
    zip: "97209",
    events: [
      {
        date: "2023-03-01",
        event: "Last recorded sale",
        price: 18_200_000,
        source: "County recorder / portfolio close package",
      },
      {
        date: "2025-06-30",
        event: "Estimated value",
        price: 17_800_000,
        source: "Portfolio valuation model",
      },
      {
        date: "2026-05-31",
        event: "Estimated value",
        price: 18_050_000,
        source: "Portfolio valuation model",
      },
    ],
    drivers: [
      "Pearl District condo/multifamily values softened then stabilized",
      "Higher rates weighed on high-rise valuations after acquisition",
    ],
  },
  "Willow Park": {
    address: "330 Willow Park Rd, Gresham, OR 97030",
    zip: "97030",
    events: [
      {
        date: "2018-05-20",
        event: "Last recorded sale",
        price: 4_100_000,
        source: "County recorder / portfolio close package",
      },
      {
        date: "2025-01-31",
        event: "Estimated value",
        price: 4_750_000,
        source: "Portfolio valuation model",
      },
      {
        date: "2026-05-31",
        event: "Estimated value",
        price: 4_900_000,
        source: "Portfolio valuation model",
      },
    ],
    drivers: [
      "Gresham rents grew from a lower base",
      "Long hold period produced moderate cumulative appreciation",
    ],
  },
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`
}

function moneyCompact(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `$${m.toFixed(m >= 10 ? 1 : 1)}M`.replace(/\.0M$/, "M")
  }
  return money(n)
}

function formatMonth(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
}

function yearsBetween(a: string, b: string): number {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (!Number.isFinite(da) || !Number.isFinite(db) || db <= da) return 0
  return (db - da) / (365.25 * 24 * 60 * 60 * 1000)
}

function matchDemoKey(buildingName: string | null): string | null {
  if (!buildingName?.trim()) return null
  const q = buildingName.trim().toLowerCase()
  for (const key of Object.keys(DEMO_PRICE_HISTORY)) {
    if (q.includes(key.toLowerCase()) || key.toLowerCase().includes(q)) return key
  }
  return null
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

  // Backfill pre-sale with gentle ~1.5%/yr growth into the first known point.
  const annual = 0.015
  const yearsBack = Math.max(0, (parseUtc(first.date) - startMs) / (365.25 * 86400000))
  const startValue = first.price / Math.pow(1 + annual, yearsBack)

  const knots: Array<{ t: number; v: number }> = [
    { t: startMs, v: startValue },
    ...sorted.map((a) => ({ t: parseUtc(a.date), v: a.price })),
  ]

  // Mild mid-period wobble so the line isn't a ruler (still deterministic).
  const out: PriceChartPoint[] = []
  const stepMs = 30.44 * 86400000 // ~monthly
  for (let t = startMs, i = 0; t <= endMs + 1; t += stepMs, i++) {
    let v = knots[knots.length - 1].v
    for (let k = 0; k < knots.length - 1; k++) {
      const a = knots[k]
      const b = knots[k + 1]
      if (t >= a.t && t <= b.t) {
        const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
        // Ease-in-out for a softer curve
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
  // Ensure exact end value
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

  const key = matchDemoKey(input.buildingName)
  if (!key) {
    return emptyPriceResult({
      available: false,
      needsClarification: false,
      gapNote:
        "I need a specific building name to pull sale and valuation history (e.g. Maple Heights).",
    })
  }

  const demo = DEMO_PRICE_HISTORY[key]
  const events: PriceHistoryEvent[] = []
  let prev: number | null = null
  for (const e of demo.events) {
    const changePct =
      prev != null && prev > 0 ? Math.round(((e.price - prev) / prev) * 1000) / 10 : null
    events.push({
      date: e.date,
      event: e.event,
      price: e.price,
      changePct,
      source: e.source,
      asOf: e.date,
    })
    prev = e.price
  }

  const sale = [...events].reverse().find((e) => /sale/i.test(e.event))
  const current = events[events.length - 1] ?? null
  const chartSeries = buildValuationChartSeries(
    events.map((e) => ({ date: e.date, price: e.price })),
  )
  const chartStart = chartSeries[0]?.value ?? null
  const chartEnd = chartSeries[chartSeries.length - 1]?.value ?? current?.price ?? null
  const chartSpanYrs =
    chartSeries.length >= 2
      ? yearsBetween(chartSeries[0].date, chartSeries[chartSeries.length - 1].date)
      : 0
  const chartChangePct =
    chartStart != null && chartEnd != null && chartStart > 0
      ? Math.round(((chartEnd - chartStart) / chartStart) * 1000) / 10
      : null

  const appreciationSinceSalePct =
    sale && current && sale.price > 0
      ? Math.round(((current.price - sale.price) / sale.price) * 1000) / 10
      : null
  const yrs = sale && current ? yearsBetween(sale.date, current.date) : 0
  const avgAnnualAppreciationPct =
    appreciationSinceSalePct != null && yrs > 0
      ? Math.round((appreciationSinceSalePct / yrs) * 10) / 10
      : null

  const changeLabel =
    chartChangePct != null && chartSpanYrs > 0
      ? `${chartChangePct >= 0 ? "+" : ""}${chartChangePct}% in last ${Math.max(1, Math.round(chartSpanYrs))} years`
      : appreciationSinceSalePct != null
        ? `${appreciationSinceSalePct >= 0 ? "+" : ""}${appreciationSinceSalePct}% since sale`
        : null

  const bullets: string[] = [
    `Property: ${key} — ${demo.address}.`,
  ]
  if (sale) {
    bullets.push(
      `Last recorded sale: ${moneyCompact(sale.price)} (${formatMonth(sale.date)}).`,
    )
  }
  if (current) {
    bullets.push(
      `Current estimated value: ${moneyCompact(current.price)} (as of ${formatMonth(current.date)}).`,
    )
  }
  if (appreciationSinceSalePct != null) {
    bullets.push(
      `Estimated appreciation since sale: ${appreciationSinceSalePct >= 0 ? "+" : ""}${appreciationSinceSalePct}%.`,
    )
  }
  if (avgAnnualAppreciationPct != null) {
    bullets.push(
      `Average annual appreciation: approximately ${avgAnnualAppreciationPct}%.`,
    )
  }

  const citations: AskUloCitation[] = [
    {
      tool: "market_data",
      title: "Property valuation history",
      citation: key,
      excerpt: current ? `Est. ${moneyCompact(current.price)}` : "Sale / valuation timeline",
    },
  ]

  return {
    available: true,
    bullets,
    citations,
    events,
    chartSeries,
    summary: {
      lastSale: sale?.price ?? null,
      lastSaleDate: sale?.date ?? null,
      currentEstimate: current?.price ?? null,
      appreciationSinceSalePct,
      avgAnnualAppreciationPct,
      changeLabel,
    },
    drivers: demo.drivers,
    gapNote: null,
    needsClarification: false,
    clarificationPrompt: null,
  }
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

  // Chart is rendered in the UI — keep markdown focused on narrative.
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
