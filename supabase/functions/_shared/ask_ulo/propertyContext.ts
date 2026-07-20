/**
 * Portfolio dossier for legal answers: this property's leases, programs,
 * ops signals, and company policies — so the same legal question can yield
 * different answers for different landlords / buildings.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"

export type DemoPropertyProfile = {
  propertyType: string
  /** Housing programs present at this building (e.g. section_8_hcv). */
  housingPrograms: string[]
  companyPolicies: string[]
  /** Typical in-place rent when rent roll column is unavailable (demo). */
  typicalMonthlyRent?: number
}

/** Curated demo profiles — live tables supply leases/ops; these fill gaps. */
export const DEMO_PROPERTY_PROFILES: Record<string, DemoPropertyProfile> = {
  "Oakwood Apartments": {
    propertyType: "Garden-style multifamily (mid-rise)",
    housingPrograms: [],
    companyPolicies: [
      "Written 60-day notice for rent increases on month-to-month tenancies (company policy).",
      "Renewal offers require regional PM approval when increase exceeds 5%.",
    ],
    typicalMonthlyRent: 2140,
  },
  "Pine Ridge": {
    propertyType: "Garden-style multifamily",
    housingPrograms: [],
    companyPolicies: [
      "Standard Oregon Residential Landlord and Tenant Act notice templates only.",
    ],
    typicalMonthlyRent: 1795,
  },
  "Cedar Court": {
    propertyType: "Townhome / small multifamily",
    housingPrograms: [],
    companyPolicies: [
      "Lease renewals prefer 12-month fixed terms; MTM only with PM approval.",
    ],
    typicalMonthlyRent: 1885,
  },
  "Maple Heights": {
    propertyType: "Garden-style multifamily",
    housingPrograms: ["section_8_hcv"],
    companyPolicies: [
      "HCV / Section 8 units: rent changes require PHA approval before notice to tenant.",
      "Company policy: no mid-lease rent increases on fixed-term leases.",
    ],
    typicalMonthlyRent: 1945,
  },
  "Birch Tower": {
    propertyType: "High-rise multifamily",
    housingPrograms: [],
    companyPolicies: [
      "Corporate counsel reviews any increase above local CPI + 3% before notice.",
    ],
    typicalMonthlyRent: 2400,
  },
  "Willow Park": {
    propertyType: "Garden-style multifamily",
    housingPrograms: [],
    companyPolicies: [
      "Written 60-day notice for rent increases on month-to-month tenancies (company policy).",
    ],
    typicalMonthlyRent: 1650,
  },
}

/**
 * Questions where the correct answer depends on which property (lease term,
 * rent control locality, housing program, company policy) — not just state law.
 */
export function needsPortfolioPropertyScope(question: string): boolean {
  return /\b(raise|increase|hike|change)\s+(the\s+)?rent\b|\brent\s+(increase|hike|raise|control|cap|stabiliz)/i
    .test(question) ||
    /\b(can|may|should)\s+i\s+(raise|increase|change)\b/i.test(question) ||
    /\b(month[- ]to[- ]month|mtm|fixed[- ]term|lease\s+term|renew(al)?\s+offer)\b/i
      .test(question) ||
    /\b(security\s+deposit|return\s+(the\s+)?deposit|withhold\s+(the\s+)?deposit)\b/i
      .test(question) ||
    /\b(enter|access)\s+(the\s+)?(unit|apartment|property)\b|\blandlord\s+entr/i
      .test(question) ||
    /\b(section\s*8|housing\s+choice\s+voucher|\bhcv\b)\b/i.test(question) ||
    /\b(at\s+(this|my|the)\s+propert|for\s+(this|my)\s+(building|unit|tenant|resident))\b/i
      .test(question)
}

export function formatPropertyScopeClarifyMarkdown(
  buildings: string[],
  questionHint?: string,
): string {
  const list =
    buildings.length > 0
      ? buildings.map((b) => `- ${b}`).join("\n")
      : "- (name the building or unit)"
  const topic = questionHint?.trim()
    ? ` for “${questionHint.trim().slice(0, 80)}${questionHint.trim().length > 80 ? "…" : ""}”`
    : ""
  return [
    "## Which property?",
    "",
    `This answer depends on **which property** in your portfolio${topic} — local rules, lease terms, housing programs, and company policies can differ by building.`,
    "",
    "Reply with the property name (or city + building), for example:",
    list,
    "",
    "Once I know the property, I’ll combine **local law** with **that building’s leases, programs, and ops context**.",
  ].join("\n")
}

/** Distill open tickets into legal-safe bullets (no ticket IDs / workflow states). */
export function legalOpsContextFromOpsBullets(opsBullets: string[]): string[] {
  const out: string[] = []
  const openLine = opsBullets.find((b) => /open maintenance tickets:\s*(\d+)/i.test(b))
  if (openLine) {
    const m = openLine.match(/open maintenance tickets:\s*(\d+)/i)
    const n = m ? Number(m[1]) : 0
    if (n === 1) {
      out.push(
        "One open maintenance item at this property — relevant if habitability or rent-withholding risk comes up.",
      )
    } else if (n > 1) {
      out.push(
        `${n} open maintenance items at this property — weigh habitability / repair-before-increase risk before acting.`,
      )
    }
  }

  const wfLine = opsBullets.find((b) => /open workflow/i.test(b))
  if (wfLine && /\b(\d+)\b/.test(wfLine)) {
    const m = wfLine.match(/(\d+)/)
    const n = m ? Number(m[1]) : 0
    if (n > 0) {
      out.push(
        `${n} open operational workflow(s) (e.g. lease renewal / inspection) — check active renewals before changing rent or notice strategy.`,
      )
    }
  }

  return out
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysUntil(isoDate: string): number | null {
  const t = Date.parse(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(t)) return null
  return Math.round((t - Date.now()) / (1000 * 60 * 60 * 24))
}

export type PropertyLegalContextResult = {
  bullets: string[]
  citations: AskUloCitation[]
  housingProgramHint: string | null
  buildingName: string | null
  portfolioBuildingNames: string[]
}

/**
 * Enrich a property focus with lease mix, inspections, demo programs/policies.
 * Call after propertySnapshotLookup when intent is legal.
 */
export async function enrichPropertyContextForLegal(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    buildingName: string | null
    /** Known buildings from unit inventory (for clarify lists). */
    portfolioBuildingNames?: string[]
  },
): Promise<PropertyLegalContextResult> {
  const landlordId = input.landlordId.trim()
  const buildingName = input.buildingName?.trim() || null
  const bullets: string[] = []
  const citations: AskUloCitation[] = []
  let housingProgramHint: string | null = null

  // Portfolio building list (for clarify UX even when no focus yet).
  let portfolioBuildingNames = input.portfolioBuildingNames ?? []
  if (portfolioBuildingNames.length === 0) {
    const { data: units } = await supabase
      .from("units")
      .select("building")
      .eq("landlord_id", landlordId)
      .limit(400)
    portfolioBuildingNames = [
      ...new Set(
        (units ?? [])
          .map((u) => (typeof u.building === "string" ? u.building.trim() : ""))
          .filter(Boolean),
      ),
    ]
  }

  if (!buildingName) {
    return {
      bullets,
      citations,
      housingProgramHint: null,
      buildingName: null,
      portfolioBuildingNames,
    }
  }

  const profile =
    DEMO_PROPERTY_PROFILES[buildingName] ??
    Object.entries(DEMO_PROPERTY_PROFILES).find(([k]) =>
      buildingName.toLowerCase().includes(k.toLowerCase()) ||
      k.toLowerCase().includes(buildingName.toLowerCase())
    )?.[1] ??
    null

  if (profile) {
    bullets.push(`Property type: ${profile.propertyType}.`)
    if (profile.housingPrograms.includes("section_8_hcv")) {
      housingProgramHint = "section_8_hcv"
      bullets.push(
        "Some units here use Section 8 Housing Choice Vouchers. Rent changes on those units usually need housing authority approval first.",
      )
    } else {
      bullets.push("Housing programs: no voucher / HCV program flagged on this building’s profile.")
    }
    if (profile.typicalMonthlyRent != null) {
      bullets.push(
        `Typical in-place rent at this building is about $${profile.typicalMonthlyRent.toLocaleString("en-US")}/mo.`,
      )
    }
    for (const p of profile.companyPolicies.slice(0, 3)) {
      bullets.push(`Your company policy: ${p}`)
    }
    citations.push({
      tool: "ops_graph",
      title: "Property profile & company policies",
      excerpt: `${buildingName}: type, programs, and internal policies for legal application.`,
    })
  } else {
    const unitCountHint = portfolioBuildingNames.length
    bullets.push(
      unitCountHint > 1
        ? "Property type: multifamily portfolio building (type not tagged in profile)."
        : "Property type: residential rental (type not tagged in profile).",
    )
  }

  // Active residents / lease terms at this building
  const { data: residents, error: resErr } = await supabase
    .from("users")
    .select("id, full_name, unit, building, status, move_in_date, lease_end_date, balance_due")
    .eq("landlord_id", landlordId)
    .ilike("building", `%${buildingName}%`)
    .in("status", ["active", "pending"])
    .limit(80)

  if (resErr) {
    console.error("[ask_ulo/propertyContext] residents", resErr.message)
  }

  const rows = residents ?? []
  if (rows.length > 0) {
    const today = todayIso()
    let fixed = 0
    let mtm = 0
    let endingSoon = 0
    let pastDueBalance = 0
    const soonEnds: Array<{ unit: string; days: number }> = []

    for (const r of rows) {
      const end = typeof r.lease_end_date === "string" ? r.lease_end_date : null
      if (!end || end < today) {
        mtm += 1
      } else {
        fixed += 1
        const d = daysUntil(end)
        if (d != null && d <= 90) {
          endingSoon += 1
          const unit = typeof r.unit === "string" ? r.unit : "?"
          soonEnds.push({ unit, days: d })
        }
      }
      const bal = typeof r.balance_due === "number" ? r.balance_due : Number(r.balance_due)
      if (Number.isFinite(bal) && bal > 0) pastDueBalance += 1
    }

    bullets.push(
      `Active / pending residents on file at this property: ${rows.length}` +
        ` · fixed-term (future lease end): ${fixed}` +
        ` · month-to-month or expired end date: ${mtm}` +
        (endingSoon ? ` · ${endingSoon} lease(s) ending within 90 days` : "") +
        ".",
    )

    if (soonEnds.length) {
      soonEnds.sort((a, b) => a.days - b.days)
      const sample = soonEnds
        .slice(0, 3)
        .map((s) => `unit ${s.unit} (~${s.days}d)`)
        .join(", ")
      bullets.push(`Nearest lease ends: ${sample}.`)
    }

    if (pastDueBalance > 0) {
      bullets.push(
        `${pastDueBalance} resident(s) show a balance due — factor into any rent-increase or notice timing.`,
      )
    }

    citations.push({
      tool: "ops_graph",
      title: "Lease & occupancy roll",
      citation: "users + occupancy",
      excerpt: `${rows.length} resident row(s); fixed vs MTM inferred from lease_end_date.`,
    })
  } else {
    bullets.push(
      "No named residents with lease_end_date on file for this building yet — confirm lease term (fixed vs month-to-month) before applying notice rules.",
    )
  }

  // Recent / open inspections for units at this building
  const { data: unitRows } = await supabase
    .from("units")
    .select("id")
    .eq("landlord_id", landlordId)
    .ilike("building", `%${buildingName}%`)
    .limit(200)

  const unitIds = (unitRows ?? []).map((u) => String(u.id)).filter(Boolean)
  if (unitIds.length > 0) {
    const { data: inspections, error: inspErr } = await supabase
      .from("unit_inspections")
      .select("id, inspection_type, status, scheduled_at, completed_at, unit_id")
      .eq("landlord_id", landlordId)
      .in("unit_id", unitIds.slice(0, 100))
      .order("scheduled_at", { ascending: false })
      .limit(20)

    if (inspErr) {
      console.error("[ask_ulo/propertyContext] inspections", inspErr.message)
    } else {
      const open = (inspections ?? []).filter((i) =>
        ["scheduled", "notice_sent", "in_progress"].includes(String(i.status)),
      )
      const completed = (inspections ?? []).filter((i) => i.status === "completed")
      if (open.length || completed.length) {
        bullets.push(
          `Inspections: ${open.length} open/scheduled` +
            (completed.length ? `, ${completed.length} recently completed on file` : "") +
            " — relevant for habitability, HCV HQS, or entry-notice questions.",
        )
        citations.push({
          tool: "ops_graph",
          title: "Unit inspections",
          citation: "unit_inspections",
          excerpt: `${open.length} open, ${completed.length} completed in recent sample.`,
        })
      }
    }
  }

  // Vendor performance at this building (no ticket IDs in bullets)
  const { data: tickets, error: ticketErr } = await supabase
    .from("maintenance_request_enriched")
    .select(
      "id, building, issue_category, vendor_work_status, assigned_vendor_id, created_at, urgency, priority",
    )
    .eq("landlord_id", landlordId)
    .ilike("building", `%${buildingName}%`)
    .order("created_at", { ascending: false })
    .limit(40)

  if (ticketErr) {
    console.error("[ask_ulo/propertyContext] tickets", ticketErr.message)
  } else if (tickets && tickets.length > 0) {
    const vendorIds = [
      ...new Set(
        tickets
          .map((t) =>
            typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    const vendorNameById = new Map<string, string>()
    if (vendorIds.length > 0) {
      const { data: vendors } = await supabase
        .from("vendors")
        .select("id, name, active")
        .eq("landlord_id", landlordId)
        .in("id", vendorIds)
      for (const v of vendors ?? []) {
        if (typeof v.id === "string" && typeof v.name === "string") {
          vendorNameById.set(v.id, v.name)
        }
      }
    }

    const openStatuses = new Set([
      "unassigned",
      "pending_accept",
      "accepted",
      "in_progress",
    ])
    let openCount = 0
    let completedCount = 0
    const byVendor = new Map<string, { open: number; done: number }>()
    const byCategory = new Map<string, number>()

    for (const t of tickets) {
      const status = typeof t.vendor_work_status === "string" ? t.vendor_work_status : ""
      const cat =
        typeof t.issue_category === "string" && t.issue_category.trim()
          ? t.issue_category.trim()
          : "general"
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1)
      if (openStatuses.has(status)) openCount += 1
      if (status === "completed" || status === "closed") completedCount += 1
      const vid =
        typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null
      if (vid) {
        const name = vendorNameById.get(vid) ?? "Assigned vendor"
        const row = byVendor.get(name) ?? { open: 0, done: 0 }
        if (openStatuses.has(status)) row.open += 1
        if (status === "completed" || status === "closed") row.done += 1
        byVendor.set(name, row)
      }
    }

    const topCats = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, n]) => `${c} (${n})`)
      .join(", ")

    bullets.push(
      `Maintenance history (recent sample): ${tickets.length} tickets` +
        ` · ${openCount} open · ${completedCount} completed` +
        (topCats ? ` · top trades: ${topCats}` : "") +
        ".",
    )

    const vendorLines = [...byVendor.entries()]
      .map(([name, s]) => ({ name, total: s.open + s.done, ...s }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
    if (vendorLines.length) {
      bullets.push(
        `Vendor performance at this property: ` +
          vendorLines
            .map(
              (v) =>
                `${v.name} (${v.done} completed` +
                (v.open ? `, ${v.open} still open` : "") +
                `)`,
            )
            .join("; ") +
          ".",
      )
    } else {
      bullets.push(
        "Vendor performance: recent tickets at this property have no assigned vendor yet.",
      )
    }

    citations.push({
      tool: "ops_graph",
      title: "Maintenance & vendor performance",
      citation: "maintenance_request_enriched + vendors",
      excerpt: `${tickets.length} ticket(s); ${vendorLines.length} vendor(s) in sample.`,
    })
  }

  // Prior conversations / decisions (Ask Ulo handoffs + graph attention)
  const { data: handoffs } = await supabase
    .from("operations_graph_events")
    .select("event_type, metadata, created_at")
    .eq("landlord_id", landlordId)
    .order("created_at", { ascending: false })
    .limit(50)

  const buildingKey = buildingName.toLowerCase()
  const related = (handoffs ?? []).filter((e) => {
    const meta =
      e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
        ? (e.metadata as Record<string, unknown>)
        : null
    const hay = [
      typeof meta?.building === "string" ? meta.building : "",
      typeof meta?.property_name === "string" ? meta.property_name : "",
      typeof meta?.message === "string" ? meta.message : "",
      typeof meta?.question === "string" ? meta.question : "",
    ]
      .join(" ")
      .toLowerCase()
    return hay.includes(buildingKey)
  })

  if (related.length > 0) {
    const handoffCount = related.filter((e) =>
      String(e.event_type).includes("counsel_handoff"),
    ).length
    const askCount = related.filter((e) =>
      String(e.event_type).includes("ask_ulo.answered"),
    ).length
    const decisionish = related.filter((e) => {
      const et = String(e.event_type)
      return (
        et.includes("escalat") ||
        et.includes("renewal") ||
        et.includes("reassign") ||
        et.includes("recurring") ||
        et.startsWith("lease.") ||
        et.startsWith("rent.")
      )
    })
    const opsNotes = decisionish.slice(0, 3).map((e) => {
      const meta =
        e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
          ? (e.metadata as Record<string, unknown>)
          : null
      const msg =
        typeof meta?.message === "string" ? meta.message.slice(0, 120) : null
      return msg || String(e.event_type)
    })

    const bits: string[] = []
    if (askCount) {
      bits.push(`${askCount} prior Ask Ulo answer(s) touching this property`)
    }
    if (handoffCount) {
      bits.push(
        `${handoffCount} counsel/human-review handoff(s) already logged for related topics`,
      )
    }
    if (opsNotes.length) {
      bits.push(`recent ops notes: ${opsNotes.join("; ")}`)
    } else if (related.length > 0 && !askCount && !handoffCount) {
      const sample = related.slice(0, 2).map((e) => {
        const meta =
          e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
            ? (e.metadata as Record<string, unknown>)
            : null
        return typeof meta?.message === "string"
          ? meta.message.slice(0, 100)
          : String(e.event_type)
      })
      bits.push(`recent activity: ${sample.join("; ")}`)
    }
    if (bits.length) {
      bullets.push(`Prior conversations / decisions: ${bits.join(" · ")}.`)
      citations.push({
        tool: "ops_graph",
        title: "Prior property decisions",
        citation: "operations_graph_events",
        excerpt: `${related.length} related graph event(s) for ${buildingName}.`,
      })
    }
  }

  return {
    bullets,
    citations,
    housingProgramHint,
    buildingName,
    portfolioBuildingNames,
  }
}
