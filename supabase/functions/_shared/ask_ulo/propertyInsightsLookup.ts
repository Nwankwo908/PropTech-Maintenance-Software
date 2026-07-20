/**
 * Property Insights lookup — same derived intelligence as Admin Overview cards.
 * Recurring Issues / Needs Attention / Prevent Future Repairs (60d, count ≥ 2).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"

export type PropertyInsightTag =
  | "RECURRING ISSUES"
  | "RISK"
  | "PREVENT FUTURE REPAIRS"
  | "VENDOR RESPONSE"

export type PropertyInsightFinding = {
  tag: PropertyInsightTag
  text: string
  score: number
  building?: string | null
  categoryLabel?: string | null
  unitLabel?: string | null
  requestCount?: number | null
}

export type PropertyInsightsResult = {
  available: boolean
  found: boolean
  insights: PropertyInsightFinding[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  /** True when insights already answer an "expensive if ignored" / risk question. */
  sufficientForMaintenanceRisk: boolean
}

const WINDOW_MS = 60 * 24 * 60 * 60 * 1000

function normalizeUnitLabel(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^unit\s+/, "")
  if (s.includes("·")) {
    const right = s.split("·").pop()?.trim() ?? ""
    return right.replace(/^unit\s+/, "")
  }
  return s
}

function formatCategoryName(category: string): string {
  const c = category.replace(/_/g, " ").trim()
  if (!c) return "Maintenance"
  return c.replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function buildMarkdown(insights: PropertyInsightFinding[]): string {
  if (insights.length === 0) {
    return [
      "Ulo's Property Insights doesn't currently flag a recurring-issue or preventive-repair pattern for your portfolio.",
      "",
      "### What I know",
      "I checked the same Property Insights signals shown on your Overview.",
      "",
      "### What happens next",
      "I'll keep watching for repeating categories and high-volume units so we can catch expensive patterns early.",
    ].join("\n")
  }

  const recurring = insights.find((i) => i.tag === "RECURRING ISSUES")
  const risk = insights.find((i) => i.tag === "RISK")
  const prevent = insights.find((i) => i.tag === "PREVENT FUTURE REPAIRS")

  const parts: string[] = []

  if (recurring) {
    const countBit =
      typeof recurring.requestCount === "number"
        ? ` Ulo has detected **${recurring.requestCount}** ${
            (recurring.categoryLabel ?? "maintenance").toLowerCase()
          } requests in the last 60 days`
        : ""
    const place = recurring.building ? ` at **${recurring.building}**` : ""
    parts.push(
      `The biggest concern is your recurring **${
        (recurring.categoryLabel ?? "maintenance").toLowerCase()
      }** problems${place}.${countBit}, which suggests an ongoing issue rather than isolated repairs.`,
    )
  }

  if (risk) {
    parts.push(
      `I'd also keep an eye on **${risk.unitLabel ?? "the highest-volume unit"}** because it has generated more maintenance requests than any other unit recently${
        typeof risk.requestCount === "number" ? ` (**${risk.requestCount}** in 60 days)` : ""
      }.`,
    )
  }

  if (prevent) {
    parts.push(
      `Finally, Ulo is recommending a preventive inspection for **${
        prevent.unitLabel ?? "a high-activity unit"
      }**${
        prevent.categoryLabel
          ? ` (${prevent.categoryLabel.toLowerCase()})`
          : ""
      } before those repairs become more expensive.`,
    )
  }

  if (parts.length === 0) {
    parts.push(insights[0]!.text)
  }

  parts.push(
    "",
    "### Property Insights",
    ...insights.map((i) => `- **${titleForTag(i.tag)}:** ${i.text}`),
    "",
    "### What I'd do next",
  )

  if (recurring) {
    parts.push(
      `- Open a preventive inspection plan for the recurring ${
        (recurring.categoryLabel ?? "issue").toLowerCase()
      } pattern${recurring.building ? ` at ${recurring.building}` : ""}.`,
    )
  }
  if (risk?.unitLabel) {
    parts.push(`- Review the request history for ${risk.unitLabel} and look for a shared root cause.`)
  }
  if (prevent?.unitLabel) {
    parts.push(`- Schedule the recommended preventive inspection for ${prevent.unitLabel}.`)
  }
  if (!recurring && !risk && !prevent) {
    parts.push("- Use these Overview insights as the starting point before opening individual tickets.")
  }

  return parts.join("\n")
}

function titleForTag(tag: PropertyInsightTag): string {
  switch (tag) {
    case "RECURRING ISSUES":
      return "Recurring Issues"
    case "RISK":
      return "Needs Attention"
    case "PREVENT FUTURE REPAIRS":
      return "Prevent Future Repairs"
    case "VENDOR RESPONSE":
      return "Vendor Response"
  }
}

/**
 * Mirror Admin Overview Property Insights (smartInsights).
 */
export async function propertyInsightsLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<PropertyInsightsResult> {
  const landlordId = input.landlordId.trim()
  const empty: PropertyInsightsResult = {
    available: false,
    found: false,
    insights: [],
    bullets: [],
    citations: [],
    markdown: "",
    sufficientForMaintenanceRisk: false,
  }
  if (!landlordId) return empty

  const now = Date.now()
  const sinceIso = new Date(now - WINDOW_MS).toISOString()

  const [ticketsRes, unitsRes] = await Promise.all([
    supabase
      .from("maintenance_request_enriched")
      .select("id, building, unit, issue_category, vendor_work_status, created_at, assigned_vendor_id")
      .eq("landlord_id", landlordId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("units")
      .select("unit_label, building")
      .eq("landlord_id", landlordId)
      .limit(500),
  ])

  if (ticketsRes.error) {
    console.error("[ask_ulo/propertyInsightsLookup]", ticketsRes.error.message)
    return {
      ...empty,
      available: false,
      markdown: "Property Insights could not be loaded from live ops data.",
    }
  }

  const tickets = ticketsRes.data ?? []
  const units = unitsRes.data ?? []

  const buildingByUnitLabel = new Map<string, string>()
  for (const u of units) {
    const label = normalizeUnitLabel(u.unit_label)
    const building = typeof u.building === "string" ? u.building.trim() : ""
    if (label && building) buildingByUnitLabel.set(label, building)
  }

  const insights: PropertyInsightFinding[] = []

  // Recurring Issues: top building|category ≥ 2 in 60d
  const byBuildingCategory = new Map<string, number>()
  for (const t of tickets) {
    const unitKey = normalizeUnitLabel(t.unit)
    const building =
      (typeof t.building === "string" && t.building.trim()) ||
      buildingByUnitLabel.get(unitKey) ||
      null
    const category =
      typeof t.issue_category === "string" && t.issue_category.trim()
        ? t.issue_category.trim()
        : null
    if (!building || !category) continue
    const key = `${building}|${category}`
    byBuildingCategory.set(key, (byBuildingCategory.get(key) ?? 0) + 1)
  }
  const topPattern = [...byBuildingCategory.entries()].sort((a, b) => b[1] - a[1])[0]
  let recurringBuilding: string | null = null
  let recurringCategory: string | null = null
  if (topPattern && topPattern[1] >= 2) {
    const [key, count] = topPattern
    const [building, category] = key.split("|")
    recurringBuilding = building
    recurringCategory = category
    const categoryLabel = formatCategoryName(category)
    insights.push({
      tag: "RECURRING ISSUES",
      text: `${categoryLabel} issues keep occurring in ${building}.`,
      score: Math.min(95, 70 + count * 5),
      building,
      categoryLabel,
      requestCount: count,
    })
  }

  // Needs Attention: top unit by ticket count ≥ 2
  const byUnit = new Map<string, number>()
  for (const t of tickets) {
    const key = normalizeUnitLabel(t.unit)
    if (!key) continue
    byUnit.set(key, (byUnit.get(key) ?? 0) + 1)
  }
  const topUnit = [...byUnit.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topUnit && topUnit[1] >= 2) {
    const unitLabel = `Unit ${topUnit[0].toUpperCase()}`
    insights.push({
      tag: "RISK",
      text: `${unitLabel} has generated the most maintenance requests.`,
      score: Math.min(90, 60 + topUnit[1] * 6),
      unitLabel,
      requestCount: topUnit[1],
    })
  }

  // Prevent Future Repairs: top unit|category ≥ 2
  const byUnitCategory = new Map<string, number>()
  for (const t of tickets) {
    const unitKey = normalizeUnitLabel(t.unit)
    const category =
      typeof t.issue_category === "string" && t.issue_category.trim()
        ? t.issue_category.trim()
        : null
    if (!unitKey || !category) continue
    const key = `${unitKey}|${category}`
    byUnitCategory.set(key, (byUnitCategory.get(key) ?? 0) + 1)
  }
  const unitCategoryCandidates = [...byUnitCategory.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
  const preventPick =
    unitCategoryCandidates.find(([key]) => {
      const [unitKey, category] = key.split("|")
      if (recurringCategory && category === recurringCategory) {
        const building = buildingByUnitLabel.get(unitKey)
        if (building && building === recurringBuilding) return false
      }
      return true
    }) ?? unitCategoryCandidates[0]
  if (preventPick) {
    const [key, count] = preventPick
    const [unitKey, category] = key.split("|")
    const categoryLabel = formatCategoryName(category)
    const unitLabel = `Unit ${unitKey.toUpperCase()}`
    insights.push({
      tag: "PREVENT FUTURE REPAIRS",
      text: `A preventive ${categoryLabel.toLowerCase()} inspection is recommended for ${unitLabel}.`,
      score: Math.min(95, 65 + count * 4),
      categoryLabel,
      requestCount: count,
      unitLabel,
    })
  }

  const found = insights.length > 0
  const markdown = buildMarkdown(insights)
  const bullets = insights.map((i) => `${titleForTag(i.tag)}: ${i.text}`)
  const sufficientForMaintenanceRisk = insights.some(
    (i) =>
      i.tag === "RECURRING ISSUES" ||
      i.tag === "RISK" ||
      i.tag === "PREVENT FUTURE REPAIRS",
  )

  console.log(
    "ASK_ULO_TIER1_PROPERTY_INSIGHTS",
    JSON.stringify({
      landlordId,
      found,
      tags: insights.map((i) => i.tag),
      counts: insights.map((i) => ({ tag: i.tag, n: i.requestCount })),
    }),
  )

  return {
    available: true,
    found,
    insights,
    bullets,
    citations: [
      {
        tool: "ops_graph",
        title: "Property Insights",
        citation:
          "maintenance_request_enriched + units (same logic as Overview Property Insights)",
        excerpt: found
          ? insights.map((i) => i.text).join(" · ")
          : "No recurring / preventive insights in the last 60 days",
      },
    ],
    markdown,
    sufficientForMaintenanceRisk,
  }
}
