/**
 * Structured incomplete evidence — code owns the gap message.
 * Never trust the LLM to invent a ranking and self-censor at the same time.
 */
/// <reference lib="deno.ns" />

import { formatIncompleteAnswer } from "./missingInfoCommunication.ts"

export type IncompleteEvidenceStatus = "complete" | "incomplete" | "unavailable"

export type IncompleteEvidenceKind =
  | "property_ranking"
  | "unit_maintenance_ranking"
  | "period_summary"
  | "tool_miss"
  | "catchall_none"

export type IncompleteEvidenceSignal = {
  status: IncompleteEvidenceStatus
  kind: IncompleteEvidenceKind
  /** Machine-readable gaps (lookup language). */
  missing: string[]
  known: {
    openWorkOrders?: number | null
    requestCount?: number | null
    unlinkedRequestCount?: number | null
    timeframeLabel?: string | null
    scopeLabel?: string | null
  }
  /** Landlord-facing markdown — rendered in code, not by the LLM. */
  markdown: string
}

/** Map internal missing tokens → landlord language. */
export function humanizeMissingData(missing: string[]): string[] {
  return missing.map((m) =>
    m
      .replace(
        /property assignments on open work orders/gi,
        "which properties those open requests belong to",
      )
      .replace(
        /property assignments on active workflows/gi,
        "which properties those active operations belong to",
      )
      .replace(
        /named properties \/ buildings in portfolio/gi,
        "named buildings in your portfolio",
      )
      .replace(
        /unit assignments on maintenance requests/gi,
        "which units those maintenance requests belong to",
      ),
  )
}

export function rankingStatusFromFlags(input: {
  available: boolean
  canRank: boolean
}): IncompleteEvidenceStatus {
  if (!input.available) return "unavailable"
  if (!input.canRank) return "incomplete"
  return "complete"
}

export function buildPropertyRankingIncompleteSignal(input: {
  available: boolean
  canRank: boolean
  missingData: string[]
  portfolioOpenWorkOrders: number
  reasoningMode?: string | null
}): IncompleteEvidenceSignal | null {
  const status = rankingStatusFromFlags(input)
  if (status === "complete") return null

  const missing = humanizeMissingData(
    input.missingData.length
      ? input.missingData
      : status === "unavailable"
        ? ["property-level maintenance signals"]
        : ["property-level maintenance detail"],
  )
  const open = input.portfolioOpenWorkOrders
  const mode = input.reasoningMode ?? "comparison_ranking"
  const lead =
    mode === "diagnosis"
      ? "I can't tell which property is becoming the biggest problem yet."
      : mode === "recommendation"
        ? "I can't recommend which property to act on first yet."
        : "I can't reliably rank your properties yet."

  const whatIKnow =
    status === "unavailable"
      ? "I couldn't load the property-level signals needed for a ranking."
      : open > 0
        ? `I can see **${open}** open maintenance requests across the portfolio, but I only have portfolio totals — not enough to compare buildings.`
        : "I can see your portfolio structure, but I don't have property-level maintenance detail to compare buildings."

  const whatsMissing =
    missing.length === 1
      ? `I'm missing ${missing[0]}.`
      : `I'm missing: ${missing.join("; ")}.`

  const markdown = formatIncompleteAnswer({
    lead,
    whatIKnow,
    whatsMissing,
    whatHappensNext:
      "Once requests and workflows are tied to specific buildings, I'll rank properties by severity and tell you which one needs attention first — without guessing from portfolio totals.",
  })

  return {
    status,
    kind: "property_ranking",
    missing,
    known: { openWorkOrders: open },
    markdown,
  }
}

export function buildUnitRankingIncompleteSignal(input: {
  available: boolean
  canRank: boolean
  missingData: string[]
  requestCount?: number | null
  unlinkedRequestCount?: number | null
  timeframeLabel?: string | null
  scopeLabel?: string | null
}): IncompleteEvidenceSignal | null {
  const status = rankingStatusFromFlags(input)
  if (status === "complete") return null

  const missing = humanizeMissingData(
    input.missingData.length
      ? input.missingData
      : ["which units those maintenance requests belong to"],
  )
  const window = input.timeframeLabel?.trim() || "this period"
  const scope = input.scopeLabel?.trim() || "your portfolio"
  const req =
    typeof input.requestCount === "number" && input.requestCount >= 0
      ? input.requestCount
      : null
  const unlinked =
    typeof input.unlinkedRequestCount === "number" && input.unlinkedRequestCount >= 0
      ? input.unlinkedRequestCount
      : null

  const whatIKnowParts: string[] = []
  if (req != null) {
    whatIKnowParts.push(
      `I can see **${req}** maintenance request${req === 1 ? "" : "s"} in **${scope}** over **${window}**`,
    )
    if (unlinked != null && unlinked > 0) {
      whatIKnowParts[0] += `, but **${unlinked}** ${
        unlinked === 1 ? "isn't" : "aren't"
      } linked to a unit`
    }
    whatIKnowParts[0] += "."
  } else {
    whatIKnowParts.push(
      "I found maintenance activity for the portfolio, but I could not reliably connect the requests to individual units.",
    )
  }

  const markdown = formatIncompleteAnswer({
    lead: "I can't tell which units generate the most maintenance requests yet.",
    whatIKnow: whatIKnowParts.join(" "),
    whatsMissing:
      missing.length === 1
        ? `I'm missing ${missing[0]}.`
        : `I'm missing: ${missing.join("; ")}.`,
    whatHappensNext:
      "Once maintenance requests include unit assignments, I'll rank the units by volume and show which ones need the most attention.",
  })

  return {
    status,
    kind: "unit_maintenance_ranking",
    missing,
    known: {
      requestCount: req,
      unlinkedRequestCount: unlinked,
      timeframeLabel: window,
      scopeLabel: scope,
    },
    markdown,
  }
}

/**
 * If a ranking packet is incomplete/unavailable, return the code-rendered gap.
 * Callers must prefer this over OpenAI synthesis for that turn.
 */
export function resolveIncompleteRankingSignal(input: {
  propertyRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    portfolioOpenWorkOrders: number
  } | null
  unitMaintenanceRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    requestCount?: number | null
    unlinkedRequestCount?: number | null
    timeframeLabel?: string | null
    scopeLabel?: string | null
  } | null
  reasoningMode?: string | null
  /** Prefer unit incomplete when both present and unit intent/packet is active. */
  preferUnit?: boolean
}): IncompleteEvidenceSignal | null {
  if (input.preferUnit && input.unitMaintenanceRanking) {
    const unit = buildUnitRankingIncompleteSignal(input.unitMaintenanceRanking)
    if (unit) return unit
  }
  if (input.propertyRanking) {
    const prop = buildPropertyRankingIncompleteSignal({
      ...input.propertyRanking,
      reasoningMode: input.reasoningMode,
    })
    if (prop) return prop
  }
  if (input.unitMaintenanceRanking) {
    return buildUnitRankingIncompleteSignal(input.unitMaintenanceRanking)
  }
  return null
}

/**
 * Structured gap when OpenAI tool select / catch-all miss — code owns the message
 * so rule-planner directives never leak as landlord-facing prose.
 */
export function buildToolMissIncompleteSignal(input: {
  noToolMatched: boolean
  catchallNone: boolean
  subject: string
  openWorkOrders?: number | null
}): IncompleteEvidenceSignal | null {
  if (!input.noToolMatched && !input.catchallNone) return null

  const kind: IncompleteEvidenceKind = input.catchallNone ? "catchall_none" : "tool_miss"
  const open =
    typeof input.openWorkOrders === "number" && Number.isFinite(input.openWorkOrders)
      ? input.openWorkOrders
      : null

  const lead = input.catchallNone
    ? "I couldn't match this to a clear work-order answer yet."
    : "I couldn't match this question to a specific portfolio lookup yet."

  const whatIKnow =
    open != null && open > 0
      ? `I can see **${open}** open maintenance requests in your portfolio, but that alone isn't enough to answer what you asked.`
      : "I can see your portfolio context, but I don't have a specialty packet that fits this ask."

  const whatsMissing = input.catchallNone
    ? "A clearer work-order or unit anchor (property name, unit, trade, or ticket detail) so I can pull the right requests."
    : "A clearer subject (vendor, resident, work order, property, or legal topic) so I can run the right lookup."

  const markdown = formatIncompleteAnswer({
    lead,
    whatIKnow,
    whatsMissing,
    whatHappensNext:
      "Rephrase with the property, unit, vendor, or topic you care about — I'll run the matching lookup instead of guessing from portfolio totals.",
  })

  return {
    status: "incomplete",
    kind,
    missing: [whatsMissing],
    known: { openWorkOrders: open, scopeLabel: input.subject },
    markdown,
  }
}
