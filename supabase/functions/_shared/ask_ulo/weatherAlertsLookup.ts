/**
 * Active weather alerts for landlord properties via NWS (api.weather.gov).
 * No API key required. Matches alerts to portfolio cities/states.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"

export type WeatherAlertItem = {
  id: string
  event: string
  headline: string
  severity: string
  urgency: string
  areaDesc: string
  effective: string | null
  expires: string | null
  matchedProperties: string[]
  instructionHint: string | null
}

export type WeatherAlertsResult = {
  available: boolean
  found: boolean
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  alerts: WeatherAlertItem[]
  propertiesScoped: Array<{ name: string; city: string; state: string }>
  statesQueried: string[]
  error?: string | null
}

const DEMO_BUILDING_META: Record<string, { city: string; state: string; name: string }> = {
  "Oakwood Apartments": { city: "Portland", state: "OR", name: "Oakwood Apartments" },
  "Pine Ridge": { city: "Portland", state: "OR", name: "Pine Ridge" },
  "Cedar Court": { city: "Beaverton", state: "OR", name: "Cedar Court" },
  "Maple Heights": { city: "Hillsboro", state: "OR", name: "Maple Heights" },
  "Birch Tower": { city: "Portland", state: "OR", name: "Birch Tower" },
  "Willow Park": { city: "Gresham", state: "OR", name: "Willow Park" },
}

const NWS_USER_AGENT = "UloAskUlo/1.0 (property-operations; ask-ulo weather alerts)"

/** “Are there any weather alerts that could affect my properties?” */
export function isWeatherAlertsQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  return (
    /\bweather\s+alerts?\b/i.test(q) ||
    /\b(storm|freeze|heat|flood|wind|tornado|hurricane|winter\s+storm)\s+alerts?\b/i.test(q) ||
    (/\bweather\b/i.test(q) &&
      /\b(affect|impact|threaten|hit)\b/i.test(q) &&
      /\b(propert|buildings?|portfolio)\b/i.test(q))
  )
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function parseStateCityFromAddress(address: string): { city: string; state: string } | null {
  const m = address.match(/,\s*([^,]+),\s*([A-Z]{2})\b/i)
  if (!m) return null
  return { city: m[1].trim(), state: m[2].trim().toUpperCase() }
}

function collectFromOnboardingProperties(
  properties: unknown,
): Array<{ name: string; city: string; state: string }> {
  if (!Array.isArray(properties)) return []
  const out: Array<{ name: string; city: string; state: string }> = []
  for (const raw of properties) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const name = typeof row.name === "string" ? row.name.trim() : ""
    const city = typeof row.city === "string" ? row.city.trim() : ""
    const state = typeof row.state === "string" ? row.state.trim().toUpperCase() : ""
    if (city && state.length === 2) {
      out.push({ name: name || city, city, state })
      continue
    }
    const street = typeof row.streetAddress === "string" ? row.streetAddress : ""
    const zip = typeof row.zipCode === "string" ? row.zipCode : ""
    const parsed = parseStateCityFromAddress(
      [street, city, state, zip].filter(Boolean).join(", "),
    )
    if (parsed) out.push({ name: name || parsed.city, ...parsed })
  }
  return out
}

function opsHintForEvent(event: string): string | null {
  const e = event.toLowerCase()
  if (/freeze|frost|cold|winter|ice|snow/.test(e)) {
    return "Watch pipes, heat, and access at exterior units."
  }
  if (/heat|excessive\s+heat|hot/.test(e)) {
    return "Watch HVAC load and resident heat-safety outreach."
  }
  if (/wind|tornado|hurricane|storm|thunder/.test(e)) {
    return "Watch roof, trees, debris, and exterior damage reports."
  }
  if (/flood|flash\s+flood|rain/.test(e)) {
    return "Watch basements, low units, and site drainage."
  }
  if (/fire|red\s+flag|smoke/.test(e)) {
    return "Watch air quality, HVAC intake, and outdoor work."
  }
  return "Review open work orders and vendor access for affected buildings."
}

async function fetchNwsAlertsForState(state: string): Promise<{
  alerts: Array<{
    id: string
    event: string
    headline: string
    severity: string
    urgency: string
    areaDesc: string
    effective: string | null
    expires: string | null
  }>
  error: string | null
}> {
  const url = `https://api.weather.gov/alerts/active?area=${encodeURIComponent(state)}`
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": NWS_USER_AGENT,
        Accept: "application/geo+json",
      },
    })
    if (!res.ok) {
      return { alerts: [], error: `nws_http_${res.status}` }
    }
    const body = (await res.json()) as { features?: unknown[] }
    const alerts: Array<{
      id: string
      event: string
      headline: string
      severity: string
      urgency: string
      areaDesc: string
      effective: string | null
      expires: string | null
    }> = []
    for (const feat of body.features ?? []) {
      const f = asRecord(feat)
      const props = asRecord(f?.properties)
      if (!props) continue
      const id = typeof props.id === "string" ? props.id : String(f?.id ?? crypto.randomUUID())
      const event = typeof props.event === "string" ? props.event : "Weather alert"
      const headline =
        typeof props.headline === "string" && props.headline.trim()
          ? props.headline.trim()
          : event
      const severity = typeof props.severity === "string" ? props.severity : "Unknown"
      const urgency = typeof props.urgency === "string" ? props.urgency : "Unknown"
      const areaDesc = typeof props.areaDesc === "string" ? props.areaDesc : ""
      alerts.push({
        id,
        event,
        headline,
        severity,
        urgency,
        areaDesc,
        effective: typeof props.effective === "string" ? props.effective : null,
        expires: typeof props.expires === "string" ? props.expires : null,
      })
    }
    return { alerts, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "nws_fetch_failed"
    return { alerts: [], error: msg }
  }
}

function matchProperties(
  areaDesc: string,
  properties: Array<{ name: string; city: string; state: string }>,
  state: string,
): string[] {
  const area = areaDesc.toLowerCase()
  const matched: string[] = []
  for (const p of properties) {
    if (p.state !== state) continue
    const city = p.city.toLowerCase()
    if (city && area.includes(city)) {
      matched.push(p.name)
      continue
    }
    // County-style or statewide: still flag properties in that state for severe alerts
  }
  if (matched.length === 0) {
    // Statewide / zone alerts without city names — attribute to all props in state
    for (const p of properties) {
      if (p.state === state) matched.push(p.name)
    }
  }
  return [...new Set(matched)]
}

export async function loadPortfolioWeatherLocations(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<Array<{ name: string; city: string; state: string }>> {
  const byKey = new Map<string, { name: string; city: string; state: string }>()

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("properties, draft_state")
    .eq("landlord_id", landlordId)
    .maybeSingle()

  for (const row of collectFromOnboardingProperties(onboarding?.properties)) {
    byKey.set(`${row.state}:${row.city.toLowerCase()}:${row.name.toLowerCase()}`, row)
  }
  const draft = asRecord(onboarding?.draft_state)
  for (const row of collectFromOnboardingProperties(draft?.properties)) {
    byKey.set(`${row.state}:${row.city.toLowerCase()}:${row.name.toLowerCase()}`, row)
  }

  const { data: units } = await supabase
    .from("units")
    .select("building, city, state")
    .eq("landlord_id", landlordId)
    .limit(200)

  let hasUserLocations = byKey.size > 0
  for (const u of units ?? []) {
    const building = typeof u.building === "string" ? u.building.trim() : ""
    const city = typeof u.city === "string" ? u.city.trim() : ""
    const state = typeof u.state === "string" ? u.state.trim().toUpperCase() : ""
    if (city && state.length === 2) {
      const name = building || city
      byKey.set(`${state}:${city.toLowerCase()}:${name.toLowerCase()}`, {
        name,
        city,
        state,
      })
      hasUserLocations = true
    }
  }

  // Demo building map only when this landlord has zero user-entered locations.
  if (!hasUserLocations) {
    for (const u of units ?? []) {
      const building = typeof u.building === "string" ? u.building.trim() : ""
      if (!building) continue
      const demo = DEMO_BUILDING_META[building]
      if (demo) {
        byKey.set(`${demo.state}:${demo.city.toLowerCase()}:${demo.name.toLowerCase()}`, {
          name: demo.name,
          city: demo.city,
          state: demo.state,
        })
      }
    }
  }

  return [...byKey.values()]
}

export async function weatherAlertsLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<WeatherAlertsResult> {
  const landlordId = input.landlordId.trim()
  const empty = (error?: string | null): WeatherAlertsResult => ({
    available: false,
    found: false,
    bullets: [],
    citations: [],
    markdown: "",
    alerts: [],
    propertiesScoped: [],
    statesQueried: [],
    error: error ?? null,
  })

  if (!landlordId) return empty("missing_landlord")

  const properties = await loadPortfolioWeatherLocations(supabase, landlordId)
  const states = [...new Set(properties.map((p) => p.state).filter((s) => s.length === 2))]
  if (states.length === 0) {
    return {
      available: true,
      found: false,
      bullets: ["No property city/state locations found to check weather alerts against."],
      citations: [],
      markdown: [
        "## Weather alerts",
        "",
        "I couldn't find city/state locations for your properties, so I can't check NWS alerts yet.",
      ].join("\n"),
      alerts: [],
      propertiesScoped: [],
      statesQueried: [],
      error: "no_locations",
    }
  }

  const allItems: WeatherAlertItem[] = []
  const errors: string[] = []
  for (const state of states) {
    const { alerts, error } = await fetchNwsAlertsForState(state)
    if (error) errors.push(`${state}:${error}`)
    for (const a of alerts) {
      const matchedProperties = matchProperties(a.areaDesc, properties, state)
      if (matchedProperties.length === 0) continue
      allItems.push({
        ...a,
        matchedProperties,
        instructionHint: opsHintForEvent(a.event),
      })
    }
  }

  // Prefer higher severity first
  const severityRank: Record<string, number> = {
    Extreme: 0,
    Severe: 1,
    Moderate: 2,
    Minor: 3,
    Unknown: 4,
  }
  allItems.sort(
    (a, b) =>
      (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
      a.event.localeCompare(b.event),
  )

  const bullets: string[] = []
  const cities = [...new Set(properties.map((p) => `${p.city}, ${p.state}`))]
  bullets.push(
    `Checked National Weather Service active alerts for ${states.join(", ")} (portfolio cities: ${cities.slice(0, 6).join("; ")}${cities.length > 6 ? "…" : ""}).`,
  )

  if (allItems.length === 0) {
    bullets.push("No active weather alerts currently match your property locations.")
  } else {
    bullets.push(`Active alerts that may affect your portfolio: ${allItems.length}.`)
    for (const a of allItems.slice(0, 8)) {
      bullets.push(
        `${a.event} (${a.severity}) — ${a.matchedProperties.slice(0, 4).join(", ")}${
          a.matchedProperties.length > 4 ? "…" : ""
        }.`,
      )
      if (a.instructionHint) bullets.push(`  Ops focus: ${a.instructionHint}`)
    }
  }

  const citations: AskUloCitation[] = [
    {
      tool: "structured",
      title: "NWS active weather alerts",
      citation: "api.weather.gov/alerts/active",
      url: `https://api.weather.gov/alerts/active?area=${states[0]}`,
      excerpt: `${allItems.length} alert(s) across ${states.join(", ")}`,
    },
  ]

  const md: string[] = [
    "## Weather alerts for your properties",
    "",
    `Checked **NWS** active alerts for **${states.join(", ")}** covering: ${cities.join("; ")}.`,
    "",
  ]
  if (allItems.length === 0) {
    md.push("**No active alerts** currently match your portfolio locations.")
    md.push("")
    md.push(
      "I'll keep using National Weather Service data for this ask — nothing severe is flagged for your markets right now.",
    )
  } else {
    md.push(`**${allItems.length} active alert(s)** that may affect your buildings:`)
    md.push("")
    for (const a of allItems.slice(0, 10)) {
      md.push(`### ${a.event} · ${a.severity}`)
      md.push(a.headline)
      md.push(`- **Properties:** ${a.matchedProperties.join(", ")}`)
      if (a.areaDesc) md.push(`- **Area:** ${a.areaDesc.split(";").slice(0, 3).join("; ")}`)
      if (a.expires) md.push(`- **Expires:** ${a.expires.slice(0, 16).replace("T", " ")} UTC`)
      if (a.instructionHint) md.push(`- **Ops focus:** ${a.instructionHint}`)
      md.push("")
    }
  }

  return {
    available: true,
    found: allItems.length > 0,
    bullets,
    citations,
    markdown: md.join("\n"),
    alerts: allItems,
    propertiesScoped: properties,
    statesQueried: states,
    error: errors.length ? errors.join(";") : null,
  }
}
