/**
 * Rent history for Ask Ulo.
 * Demo buildings use curated timelines — no Zillow CSV downloads (edge memory limits).
 */

import type { AskUloCitation } from "./opsGraphLookup.ts"
import { buildValuationChartSeries } from "./propertyPriceHistory.ts"

export type RentHistoryPoint = {
  date: string
  rent: number
}

export type RentHistoryResult = {
  available: boolean
  bullets: string[]
  citations: AskUloCitation[]
  points: RentHistoryPoint[]
  /** Dense monthly series for the history chart (local demo data only). */
  chartSeries: Array<{ date: string; value: number }>
  current: number | null
  yearAgo: number | null
  yoyPct: number | null
  changeLabel: string | null
  scope: string | null
  gapNote: string | null
}

/** Curated typical-rent samples for demo portfolio buildings. */
const DEMO_RENT_HISTORY: Record<
  string,
  { zip: string; points: RentHistoryPoint[]; source: string }
> = {
  "Maple Heights": {
    zip: "97124",
    source: "Portfolio rent roll + local multifamily index (demo)",
    points: [
      { date: "2018-05-31", rent: 1420 },
      { date: "2020-05-31", rent: 1550 },
      { date: "2022-05-31", rent: 1680 },
      { date: "2023-05-31", rent: 1750 },
      { date: "2024-05-31", rent: 1825 },
      { date: "2025-05-31", rent: 1890 },
      { date: "2026-05-31", rent: 1945 },
    ],
  },
  "Oakwood Apartments": {
    zip: "97214",
    source: "Portfolio rent roll + local multifamily index (demo)",
    points: [
      { date: "2018-05-31", rent: 1580 },
      { date: "2020-05-31", rent: 1720 },
      { date: "2022-05-31", rent: 1850 },
      { date: "2024-05-31", rent: 2010 },
      { date: "2026-05-31", rent: 2140 },
    ],
  },
  "Pine Ridge": {
    zip: "97217",
    source: "Portfolio rent roll + local multifamily index (demo)",
    points: [
      { date: "2018-05-31", rent: 1320 },
      { date: "2020-05-31", rent: 1430 },
      { date: "2022-05-31", rent: 1550 },
      { date: "2024-05-31", rent: 1685 },
      { date: "2026-05-31", rent: 1795 },
    ],
  },
  "Cedar Court": {
    zip: "97005",
    source: "Portfolio rent roll + local multifamily index (demo)",
    points: [
      { date: "2018-05-31", rent: 1380 },
      { date: "2020-05-31", rent: 1490 },
      { date: "2022-05-31", rent: 1620 },
      { date: "2024-05-31", rent: 1765 },
      { date: "2026-05-31", rent: 1885 },
    ],
  },
  "Birch Tower": {
    zip: "97209",
    source: "Portfolio rent roll + local multifamily index (demo)",
    points: [
      { date: "2018-05-31", rent: 2050 },
      { date: "2020-05-31", rent: 2180 },
      { date: "2022-05-31", rent: 2250 },
      { date: "2024-05-31", rent: 2280 },
      { date: "2026-05-31", rent: 2395 },
    ],
  },
  "Willow Park": {
    zip: "97030",
    source: "Portfolio rent roll + local multifamily index (demo)",
    points: [
      { date: "2018-05-31", rent: 1180 },
      { date: "2020-05-31", rent: 1290 },
      { date: "2022-05-31", rent: 1420 },
      { date: "2024-05-31", rent: 1550 },
      { date: "2026-05-31", rent: 1665 },
    ],
  },
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`
}

function formatMonth(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
}

function matchDemoKey(buildingName: string | null): string | null {
  if (!buildingName?.trim()) return null
  const q = buildingName.trim().toLowerCase()
  for (const key of Object.keys(DEMO_RENT_HISTORY)) {
    if (q.includes(key.toLowerCase()) || key.toLowerCase().includes(q)) return key
  }
  return null
}

export async function rentHistoryLookup(input: {
  buildingName: string | null
  cityLabel: string | null
  stateCode: string | null
  addressLine?: string | null
}): Promise<RentHistoryResult> {
  const key = matchDemoKey(input.buildingName)
  if (!key) {
    return {
      available: false,
      bullets: [],
      citations: [],
      points: [],
      chartSeries: [],
      current: null,
      yearAgo: null,
      yoyPct: null,
      changeLabel: null,
      scope: null,
      gapNote:
        "I need a specific building name to pull rent history (e.g. Maple Heights).",
    }
  }

  const demo = DEMO_RENT_HISTORY[key]
  const points = demo.points
  const chartSeries = buildValuationChartSeries(
    points.map((p) => ({ date: p.date, price: p.rent })),
  )
  const current = points[points.length - 1]?.rent ?? null
  const yearAgo =
    points.length >= 2 ? points[points.length - 2]?.rent ?? null : null
  const yoyPct =
    current != null && yearAgo != null && yearAgo > 0
      ? Math.round(((current - yearAgo) / yearAgo) * 1000) / 10
      : null

  const start = chartSeries[0]?.value
  const end = chartSeries[chartSeries.length - 1]?.value
  const changePct =
    start != null && end != null && start > 0
      ? Math.round(((end - start) / start) * 1000) / 10
      : null
  const changeLabel =
    changePct != null ? `${changePct >= 0 ? "+" : ""}${changePct}% in last 10 years` : null

  const scopeLabel = `${key} · ZIP ${demo.zip}`
  const bullets: string[] = [`Rent history scope: ${scopeLabel}.`]
  if (current != null) {
    bullets.push(
      `Current typical rent: ${money(current)}/mo` +
        (points[points.length - 1]
          ? ` as of ${formatMonth(points[points.length - 1].date)}`
          : "") +
        ".",
    )
  }
  if (changeLabel) bullets.push(`Long-term change: ${changeLabel}.`)

  return {
    available: true,
    bullets,
    citations: [
      {
        tool: "market_data",
        title: "Property rent history",
        citation: scopeLabel,
        excerpt: current != null ? `~${money(current)}/mo` : "Rent timeline",
      },
    ],
    points,
    chartSeries,
    current,
    yearAgo,
    yoyPct,
    changeLabel,
    scope: scopeLabel,
    gapNote: null,
  }
}

export function formatRentHistoryMarkdown(result: RentHistoryResult): string {
  if (!result.available) {
    return ["## Rent History", result.gapNote ?? "Rent history is not available."].join("\n")
  }
  const parts: string[] = ["## Summary"]
  if (result.scope) parts.push(`Scope: **${result.scope}**`)
  if (result.current != null) {
    parts.push(`- Current typical rent: **${money(result.current)}/mo**`)
  }
  if (result.changeLabel) {
    parts.push(`- Long-term change: **${result.changeLabel}**`)
  }
  parts.push("", "## Data Source")
  parts.push("- Portfolio rent roll + local multifamily index (demo timeline)")
  parts.push("", "## Next Steps")
  parts.push("- Ask what you could charge for a specific bedroom count.")
  parts.push("- Or ask for sale/valuation history instead of rent.")
  return parts.join("\n")
}
