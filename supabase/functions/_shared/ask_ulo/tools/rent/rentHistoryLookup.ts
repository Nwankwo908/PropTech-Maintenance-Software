/**
 * Rent history for Ask Ulo.
 * Returns unavailable until a live rent-index or portfolio rent-roll API is wired.
 */

import type { AskUloCitation } from "../../retrieval/searchInternalData.ts"
import { buildValuationChartSeries } from "../finance/propertyPriceHistory.ts"

export type RentHistoryPoint = {
  date: string
  rent: number
}

export type RentHistoryResult = {
  available: boolean
  bullets: string[]
  citations: AskUloCitation[]
  points: RentHistoryPoint[]
  /** Dense monthly series for the history chart when data is available. */
  chartSeries: Array<{ date: string; value: number }>
  current: number | null
  yearAgo: number | null
  yoyPct: number | null
  changeLabel: string | null
  scope: string | null
  gapNote: string | null
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`
}

export async function rentHistoryLookup(input: {
  buildingName: string | null
  cityLabel: string | null
  stateCode: string | null
  addressLine?: string | null
}): Promise<RentHistoryResult> {
  const scopeParts = [
    input.buildingName?.trim(),
    input.cityLabel?.trim(),
    input.stateCode?.trim(),
  ].filter(Boolean)
  const scope = scopeParts.length > 0 ? scopeParts.join(" · ") : null

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
    scope,
    gapNote: scope
      ? `Rent history is not available for ${scope} yet. Ask for current market comps or typical rent instead.`
      : "Name a specific property (or city + state) to scope rent history.",
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
  return parts.join("\n")
}

// Re-export chart builder for tests / future live integrations.
export { buildValuationChartSeries }
