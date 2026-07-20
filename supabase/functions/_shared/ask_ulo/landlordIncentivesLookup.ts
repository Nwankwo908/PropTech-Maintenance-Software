/**
 * Landlord grants / tax-incentive orientation packet.
 * Curated official-source catalog scoped to portfolio jurisdiction — not tax advice.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { resolvePortfolioJurisdiction } from "./portfolioContext.ts"
import { formatIncentivesFreshnessFooter } from "./sourceFreshness.ts"

export type LandlordIncentiveProgram = {
  id: string
  name: string
  scope: "federal" | "state" | "local" | "utility"
  states: string[] | "*" // "*" = all US
  category: "housing" | "energy" | "tax" | "rehab" | "other"
  summary: string
  officialUrl: string
  agency: string
}

export type LandlordIncentivesResult = {
  available: boolean
  found: boolean
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  programs: LandlordIncentiveProgram[]
  stateCode: string | null
  cityLabel: string | null
  error?: string | null
}

/** Curated starting catalog — official landing pages only; verify current terms. */
const PROGRAM_CATALOG: LandlordIncentiveProgram[] = [
  {
    id: "hud-landlord",
    name: "HUD resources for landlords (including HCV / Section 8)",
    scope: "federal",
    states: "*",
    category: "housing",
    summary:
      "Federal orientation for property owners participating in HUD rental assistance programs.",
    officialUrl: "https://www.hud.gov/topics/rental_assistance",
    agency: "U.S. Department of Housing and Urban Development",
  },
  {
    id: "hud-lihtc",
    name: "Low-Income Housing Tax Credit (LIHTC) overview",
    scope: "federal",
    states: "*",
    category: "tax",
    summary:
      "Major federal tax credit for affordable rental housing development / rehab — administered with state allocating agencies.",
    officialUrl: "https://www.huduser.gov/portal/datasets/lihtc.html",
    agency: "HUD User / state HFAs",
  },
  {
    id: "irs-pub946",
    name: "IRS — How to Depreciate Property (Pub 946)",
    scope: "federal",
    states: "*",
    category: "tax",
    summary:
      "Federal depreciation rules for rental property (not a grant). Useful orientation before talking to a CPA.",
    officialUrl: "https://www.irs.gov/publications/p946",
    agency: "Internal Revenue Service",
  },
  {
    id: "irs-pub527",
    name: "IRS — Residential Rental Property (Pub 527)",
    scope: "federal",
    states: "*",
    category: "tax",
    summary: "Federal tax orientation for residential rental activity.",
    officialUrl: "https://www.irs.gov/publications/p527",
    agency: "Internal Revenue Service",
  },
  {
    id: "energy-home",
    name: "Home Energy Rebates (IRA) — Energy.gov",
    scope: "federal",
    states: "*",
    category: "energy",
    summary:
      "Federal Inflation Reduction Act home energy rebate programs; state implementation varies — check whether multifamily / rental properties qualify in your state.",
    officialUrl: "https://www.energy.gov/scep/home-energy-rebate-programs",
    agency: "U.S. Department of Energy",
  },
  {
    id: "energy-star-mfr",
    name: "ENERGY STAR for Multifamily Buildings",
    scope: "federal",
    states: "*",
    category: "energy",
    summary:
      "Efficiency benchmarks and recognition for multifamily properties; often pairs with utility rebates.",
    officialUrl: "https://www.energystar.gov/buildings/resources_audience/multifamily_housing",
    agency: "ENERGY STAR / EPA",
  },
  {
    id: "cdfi-fund",
    name: "CDFI Fund — Community development finance",
    scope: "federal",
    states: "*",
    category: "rehab",
    summary:
      "Treasury programs that can support community development and affordable housing finance (often via CDFIs).",
    officialUrl: "https://www.cdfifund.gov/",
    agency: "U.S. Department of the Treasury",
  },
  {
    id: "or-ohcs",
    name: "Oregon Housing and Community Services (OHCS)",
    scope: "state",
    states: ["OR"],
    category: "housing",
    summary:
      "Oregon’s housing finance / community services agency — multifamily funding, tax credit allocations, and landlord/owner program notices.",
    officialUrl: "https://www.oregon.gov/ohcs",
    agency: "Oregon Housing and Community Services",
  },
  {
    id: "or-energy-trust",
    name: "Energy Trust of Oregon — Multifamily / rental incentives",
    scope: "utility",
    states: ["OR"],
    category: "energy",
    summary:
      "Cash incentives and technical help for energy upgrades on eligible Oregon rental / multifamily properties (utility territory rules apply).",
    officialUrl: "https://www.energytrust.org/incentives/multifamily/",
    agency: "Energy Trust of Oregon",
  },
  {
    id: "or-business-energy",
    name: "Oregon Department of Energy — Incentives & financing",
    scope: "state",
    states: ["OR"],
    category: "energy",
    summary: "State energy incentive and financing orientation for Oregon projects.",
    officialUrl: "https://www.oregon.gov/energy/Incentives/Pages/default.aspx",
    agency: "Oregon Department of Energy",
  },
  {
    id: "wa-commerce",
    name: "Washington State Department of Commerce — Housing",
    scope: "state",
    states: ["WA"],
    category: "housing",
    summary: "State housing programs and funding orientation for Washington owners / sponsors.",
    officialUrl: "https://www.commerce.wa.gov/building-infrastructure/housing/",
    agency: "Washington State Department of Commerce",
  },
  {
    id: "ca-hcd",
    name: "California HCD — Housing programs",
    scope: "state",
    states: ["CA"],
    category: "housing",
    summary: "California Department of Housing and Community Development program portal.",
    officialUrl: "https://www.hcd.ca.gov/",
    agency: "California HCD",
  },
  {
    id: "tx-tdhca",
    name: "Texas Department of Housing and Community Affairs",
    scope: "state",
    states: ["TX"],
    category: "housing",
    summary: "Texas housing finance / TDHCA programs for owners and developers.",
    officialUrl: "https://www.tdhca.texas.gov/",
    agency: "TDHCA",
  },
  {
    id: "ny-hcr",
    name: "New York Homes and Community Renewal (HCR)",
    scope: "state",
    states: ["NY"],
    category: "housing",
    summary: "New York State housing finance and community renewal programs.",
    officialUrl: "https://hcr.ny.gov/",
    agency: "NYS Homes and Community Renewal",
  },
  {
    id: "fl-fhfc",
    name: "Florida Housing Finance Corporation",
    scope: "state",
    states: ["FL"],
    category: "housing",
    summary: "Florida’s housing finance agency — multifamily and rental program orientation.",
    officialUrl: "https://www.floridahousing.org/",
    agency: "Florida Housing Finance Corporation",
  },
]

/** “What grants or tax incentives are available for landlords?” */
export function isLandlordIncentivesQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (/\bgrants?\b/i.test(q) && /\b(landlord|owner|propert|rental|housing)\b/i.test(q)) {
    return true
  }
  if (/\btax\s+incentives?\b/i.test(q)) return true
  if (
    /\b(incentives?|rebates?|tax\s+credits?)\b/i.test(q) &&
    /\b(landlord|owner|rental|multifamily|energy|housing)\b/i.test(q)
  ) {
    return true
  }
  if (/\bwhat\s+grants?\b/i.test(q) || /\bgrants?\s+(?:or|and)\s+tax\b/i.test(q)) {
    return true
  }
  return false
}

export function programsForState(stateCode: string | null): LandlordIncentiveProgram[] {
  const federal = PROGRAM_CATALOG.filter((p) => p.states === "*" || p.scope === "federal")
  if (!stateCode) return federal
  const st = stateCode.toUpperCase()
  const stateLocal = PROGRAM_CATALOG.filter(
    (p) => Array.isArray(p.states) && p.states.includes(st),
  )
  // Prefer state/local first, then federal
  return [...stateLocal, ...federal]
}

/** Test helper — same as programsForState. */
export const programsForTest = programsForState

export async function landlordIncentivesLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<LandlordIncentivesResult> {
  const landlordId = input.landlordId.trim()
  if (!landlordId) {
    return {
      available: false,
      found: false,
      bullets: [],
      citations: [],
      markdown: "",
      programs: [],
      stateCode: null,
      cityLabel: null,
      error: "missing_landlord",
    }
  }

  const jurisdiction = await resolvePortfolioJurisdiction(supabase, landlordId)
  const stateCode = jurisdiction.stateCode
  const cityLabel = jurisdiction.cityLabel
  const programs = programsForState(stateCode)

  const bullets: string[] = []
  if (stateCode) {
    bullets.push(
      `Portfolio footprint used for scoping: ${cityLabel ? `${cityLabel}, ` : ""}${stateCode}.`,
    )
  } else {
    bullets.push(
      "Portfolio state not clearly resolved — showing federal landlord / tax / energy orientation links.",
    )
  }
  bullets.push(
    `Curated official-source programs to review: ${programs.length} (not a complete catalog; not tax advice).`,
  )
  for (const p of programs.slice(0, 10)) {
    bullets.push(`${p.name} (${p.scope}) — ${p.agency}.`)
  }

  const citations: AskUloCitation[] = programs.slice(0, 8).map((p) => ({
    tool: "structured" as const,
    title: p.name,
    citation: p.agency,
    url: p.officialUrl,
    excerpt: p.summary,
  }))

  const md: string[] = [
    "## Grants & tax incentives for landlords",
    "",
    stateCode
      ? `Scoped to your portfolio markets (**${cityLabel ? `${cityLabel}, ` : ""}${stateCode}**) plus federal programs.`
      : "Scoped to **federal** programs (portfolio state not clearly resolved).",
    "",
    "> This is an orientation packet with official links — not tax, legal, or eligibility advice. Programs change; confirm current rules with the agency or your CPA.",
    "",
  ]

  const statePrograms = programs.filter((p) => p.scope === "state" || p.scope === "utility" || p.scope === "local")
  const federalPrograms = programs.filter((p) => p.scope === "federal")

  if (statePrograms.length) {
    md.push(`### ${stateCode ?? "State"} / local & utility`)
    for (const p of statePrograms) {
      md.push(`- **[${p.name}](${p.officialUrl})** — ${p.summary} _(Source: ${p.agency})_`)
    }
    md.push("")
  }

  md.push("### Federal")
  for (const p of federalPrograms) {
    md.push(`- **[${p.name}](${p.officialUrl})** — ${p.summary} _(Source: ${p.agency})_`)
  }
  md.push("")
  md.push("### What I’d do next")
  md.push(
    "1. Open the state housing finance / energy links for your market first.",
  )
  md.push(
    "2. For tax credits or depreciation strategy, take the IRS pages to your CPA — Ask Ulo won’t decide what you should claim.",
  )
  md.push(
    "3. Ask a follow-up like “energy rebates for multifamily in Oregon” if you want a narrower slice.",
  )
  md.push(formatIncentivesFreshnessFooter())

  return {
    available: true,
    found: programs.length > 0,
    bullets,
    citations,
    markdown: md.join("\n"),
    programs,
    stateCode,
    cityLabel,
    error: null,
  }
}
