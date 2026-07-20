/**
 * Lightweight property / portfolio snapshot for intents that need personalization
 * (market analysis, finance, property health) without dumping ops tickets.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"

export type PropertySnapshotResult = {
  bullets: string[]
  citations: AskUloCitation[]
  found: boolean
  buildingName: string | null
  cityLabel: string | null
  stateCode: string | null
  addressLine: string | null
  /** Median active resident monthly rent at the scoped building, when known. */
  portfolioMonthlyRent: number | null
}

const DEMO_BUILDING_META: Record<
  string,
  { city: string; state: string; address: string }
> = {
  "Oakwood Apartments": {
    city: "Portland",
    state: "OR",
    address: "812 Oakwood Ave, Portland, OR 97214",
  },
  "Pine Ridge": {
    city: "Portland",
    state: "OR",
    address: "220 Pine Ridge Dr, Portland, OR 97217",
  },
  "Cedar Court": {
    city: "Beaverton",
    state: "OR",
    address: "45 Cedar Court Ln, Beaverton, OR 97005",
  },
  "Maple Heights": {
    city: "Hillsboro",
    state: "OR",
    address: "901 Maple Heights Blvd, Hillsboro, OR 97124",
  },
  "Birch Tower": {
    city: "Portland",
    state: "OR",
    address: "12 Birch Tower Way, Portland, OR 97209",
  },
  "Willow Park": {
    city: "Gresham",
    state: "OR",
    address: "330 Willow Park Rd, Gresham, OR 97030",
  },
}

function extractBuildingName(question: string, known: string[]): string | null {
  const q = question.toLowerCase()
  for (const name of known) {
    if (q.includes(name.toLowerCase())) return name
  }
  const m = question.match(
    /\b(?:for|at|about|on|of|my)\s+(?:the\s+)?([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3})\b/,
  )
  if (m?.[1]) {
    const candidate = m[1].trim()
    if (!/^(my|the|a|an|all|open|past)\b/i.test(candidate)) return candidate
  }
  return null
}

/** Summarize unit inventory + location for a building (no ticket IDs / workflow states). */
export async function propertySnapshotLookup(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    question: string
    jurisdiction: {
      stateCode: string | null
      cityLabel: string | null
      citySlug: string | null
    }
  },
): Promise<PropertySnapshotResult> {
  const landlordId = input.landlordId.trim()
  const bullets: string[] = []
  const citations: AskUloCitation[] = []

  const { data: units, error } = await supabase
    .from("units")
    .select("id, unit_label, building, status")
    .eq("landlord_id", landlordId)
    .limit(400)

  if (error) {
    console.error("[ask_ulo/propertySnapshot] units", error.message)
  }

  const allUnits = units ?? []
  const buildings = [
    ...new Set(
      allUnits
        .map((u) => (typeof u.building === "string" ? u.building.trim() : ""))
        .filter(Boolean),
    ),
  ]

  const buildingName = extractBuildingName(input.question, buildings)
  const scoped = buildingName
    ? allUnits.filter(
        (u) =>
          typeof u.building === "string" &&
          u.building.toLowerCase().includes(buildingName.toLowerCase()),
      )
    : allUnits

  const matchedBuilding =
    buildingName &&
    buildings.find((b) => b.toLowerCase().includes(buildingName.toLowerCase()))

  const demo =
    (matchedBuilding && DEMO_BUILDING_META[matchedBuilding]) ||
    (buildingName && DEMO_BUILDING_META[buildingName]) ||
    null

  const cityLabel = demo?.city ?? input.jurisdiction.cityLabel
  const stateCode = demo?.state ?? input.jurisdiction.stateCode
  const addressLine = demo?.address ?? null

  const vacant = scoped.filter((u) => u.status === "vacant").length
  const active = scoped.filter((u) => u.status === "active").length
  const inactive = scoped.filter((u) => u.status === "inactive").length
  const total = scoped.length
  const occupancyPct = total > 0 ? Math.round((active / total) * 100) : null

  // Portfolio current rent is optional; live market AVM is the primary pricing signal.
  const portfolioMonthlyRent: number | null = null

  if (matchedBuilding || buildingName) {
    bullets.push(
      `Property focus: ${matchedBuilding ?? buildingName}` +
        (addressLine
          ? ` — ${addressLine}`
          : cityLabel && stateCode
            ? ` (${cityLabel}, ${stateCode})`
            : "") +
        ".",
    )
  } else if (cityLabel || stateCode) {
    bullets.push(
      `Portfolio footprint: ${[cityLabel, stateCode].filter(Boolean).join(", ")}.`,
    )
  }

  if (total > 0) {
    bullets.push(
      `Unit inventory${matchedBuilding || buildingName ? " at this property" : ""}: ${total} units` +
        (occupancyPct != null ? ` · ~${occupancyPct}% occupied (active status)` : "") +
        ` · vacant ${vacant} · active ${active}` +
        (inactive ? ` · inactive ${inactive}` : "") +
        ".",
    )
  } else {
    bullets.push("No unit inventory found for this landlord scope yet.")
  }

  if (buildings.length > 0 && !matchedBuilding && !buildingName) {
    bullets.push(`Buildings in portfolio: ${buildings.slice(0, 8).join(", ")}.`)
  }

  citations.push({
    tool: "ops_graph",
    title: "Portfolio unit inventory",
    excerpt: "Unit counts, occupancy, and resident rent samples from portfolio tables.",
  })

  return {
    bullets,
    citations,
    found: total > 0 || Boolean(matchedBuilding || buildingName),
    buildingName: matchedBuilding ?? buildingName,
    cityLabel,
    stateCode,
    addressLine,
    portfolioMonthlyRent,
  }
}

/**
 * Distill open tickets into at most one leasing-impact line (no IDs / workflow states).
 */
export function leasingImpactFromOpsBullets(opsBullets: string[]): string[] {
  const openLine = opsBullets.find((b) => /open maintenance tickets:\s*(\d+)/i.test(b))
  if (!openLine) return []
  const m = openLine.match(/open maintenance tickets:\s*(\d+)/i)
  const n = m ? Number(m[1]) : 0
  if (!n || n <= 0) return []
  if (n === 1) {
    return [
      "One open maintenance item may slightly affect showings or renewals until resolved — mention only if relevant to leasing.",
    ]
  }
  return [
    `${n} open maintenance items could weigh on leasing/renewals until cleared — mention only if relevant; never list ticket IDs or workflow states.`,
  ]
}
