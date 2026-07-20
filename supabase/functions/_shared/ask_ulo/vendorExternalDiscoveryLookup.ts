/**
 * Local / out-of-network vendor discovery for Ask Ulo.
 * Reuses the maintenance external-vendor search stack (Google / Yelp / NetVendor / mock).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { discoverExternalVendors } from "../external_vendor/discover.ts"
import { resolvePortfolioExternalSearchContext } from "../external_vendor/search_location.ts"
import type { ExternalVendorSuggestion } from "../external_vendor/types.ts"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import {
  detectVendorTradeFromQuestion,
  isVendorExternalDiscoveryQuestion,
  isVendorRecommendQuestion,
} from "./questionMetricContext.ts"
import { polishAskUloProse } from "./responsePolish.ts"

export type VendorExternalDiscoveryResult = {
  available: boolean
  found: boolean
  searchLocation: string
  locationLabel: string
  mode: "live" | "mock"
  configured: boolean
  suggestions: ExternalVendorSuggestion[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
}

export function shouldRunExternalVendorDiscovery(input: {
  question: string
  rosterFound: boolean
  rosterCount: number
}): boolean {
  if (isVendorExternalDiscoveryQuestion(input.question)) return true
  if (
    isVendorRecommendQuestion(input.question) &&
    (!input.rosterFound || input.rosterCount < 2)
  ) {
    return true
  }
  return false
}

function formatRating(s: ExternalVendorSuggestion): string | null {
  if (s.rating == null || !Number.isFinite(s.rating)) return null
  const reviews =
    s.reviewCount != null && s.reviewCount > 0 ? ` (${s.reviewCount} reviews)` : ""
  return `${s.rating.toFixed(1)}/5${reviews}`
}

function formatSource(s: ExternalVendorSuggestion): string | null {
  if (!s.sources.length) return null
  const labels = s.sources.map((src) =>
    src === "google" ? "Google" : src === "yelp" ? "Yelp" : src === "netvendor" ? "NetVendor" : "mock",
  )
  return labels.join(", ")
}

function suggestionBits(s: ExternalVendorSuggestion): string[] {
  const bits: string[] = []
  const rating = formatRating(s)
  if (rating) bits.push(rating)
  if (s.priceLabel) bits.push(s.priceLabel)
  if (s.etaMinutes != null && Number.isFinite(s.etaMinutes)) {
    bits.push(`~${Math.max(1, Math.round(s.etaMinutes))} min ETA`)
  }
  const src = formatSource(s)
  if (src) bits.push(src)
  if (s.address) bits.push(s.address)
  return bits
}

/** Turn bare hosts or full URLs into an absolute http(s) href. */
export function absoluteHttpUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t.replace(/^\/+/, "")}`
}

export function formatPhoneMarkdown(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== "string") return null
  const display = phone.trim()
  if (!display) return null
  const tel = display.replace(/[^\d+]/g, "")
  if (!tel) return display
  return `[${display}](tel:${tel})`
}

/** Prefer business website, then provider listing, then Google Maps search. */
export function pageLinkForSuggestion(s: ExternalVendorSuggestion): { label: string; href: string } | null {
  const website = absoluteHttpUrl(s.website)
  if (website) return { label: "Website", href: website }

  const listing = absoluteHttpUrl(s.listingUrl)
  if (listing) {
    const fromGoogle = s.sources.includes("google")
    const fromYelp = s.sources.includes("yelp")
    const label = fromGoogle ? "Google" : fromYelp ? "Yelp" : "Listing"
    return { label, href: listing }
  }

  const query = [s.name, s.address].filter(Boolean).join(" ").trim()
  if (!query) return null
  return {
    label: "Maps",
    href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
  }
}

function formatSuggestionLine(s: ExternalVendorSuggestion, index: number): string {
  const bits = suggestionBits(s)
  const phoneMd = formatPhoneMarkdown(s.phone)
  const page = pageLinkForSuggestion(s)
  const extras: string[] = []
  if (phoneMd) extras.push(phoneMd)
  if (page) extras.push(`[${page.label}](${page.href})`)
  const meta = [...bits, ...extras]
  return `${index}. **${s.name}**${meta.length ? ` — ${meta.join("; ")}` : ""}.`
}

export function buildExternalDiscoveryMarkdown(input: {
  tradeLabel: string | null
  locationLabel: string
  searchLocation: string
  suggestions: ExternalVendorSuggestion[]
  mode: "live" | "mock"
  configured: boolean
  rosterHadOptions?: boolean
}): string {
  const tradeBit = input.tradeLabel ?? "vendor"
  const nearLine = input.locationLabel
    ? `Near **${input.locationLabel}** (${input.searchLocation})`
    : `Near **${input.searchLocation}**`

  if (input.suggestions.length === 0) {
    return [
      input.rosterHadOptions
        ? `I didn't find strong local ${tradeBit}s outside your roster in that area.`
        : `I don't have another ${tradeBit} on your roster, and I couldn't find local options nearby either.`,
      "",
      "### What's missing",
      input.configured
        ? "A clearer trade match or a property anchor so the search can narrow to your portfolio area."
        : "Live external search isn't configured on Edge yet (set GOOGLE_PLACES_API_KEY / YELP_API_KEY).",
      "",
      "### What I'd do",
      "Open a work order and use **Find external vendor** to run a ticket-scoped search, or add the trade to your roster in Vendors.",
    ].join("\n")
  }

  const top = input.suggestions[0]!
  const topBits = suggestionBits(top)
  const lead = input.rosterHadOptions
    ? `If you want someone **outside your roster**, **${top.name}** looks like the strongest local ${tradeBit} ${nearLine.toLowerCase()}${topBits.length ? ` — ${topBits.join("; ")}` : ""}.`
    : `I don't have a strong ${tradeBit} on your roster yet. **${top.name}** is the best local match ${nearLine.toLowerCase()}${topBits.length ? ` — ${topBits.join("; ")}` : ""}.`

  const out: string[] = [
    lead,
    "",
    input.mode === "mock" && !input.configured
      ? "_Using demo external vendor data — configure GOOGLE_PLACES_API_KEY or YELP_API_KEY on Edge for live local search._"
      : "These are **outside your network** — ratings and distance come from public listings, not your job history.",
    "",
    `### Local ${input.tradeLabel ? input.tradeLabel + "s" : "options"} outside your roster`,
  ]

  for (const [i, s] of input.suggestions.slice(0, 5).entries()) {
    out.push(formatSuggestionLine(s, i + 1))
  }

  out.push("")
  out.push("### What I'd do")
  out.push(
    `I'd shortlist **${top.name}** for the next ${tradeBit} job, then assign through **Find external vendor** on the work order so Ulo can onboard them onto your roster.`,
  )

  return out.join("\n")
}

export function mergeRosterAndExternalMarkdown(input: {
  rosterMarkdown: string
  external: VendorExternalDiscoveryResult | null
  rosterFound: boolean
}): string {
  if (!input.external?.available || !input.external.found) {
    return input.rosterMarkdown
  }
  if (!input.rosterFound || !input.rosterMarkdown.trim()) {
    return input.external.markdown
  }
  return [input.rosterMarkdown.trim(), "", input.external.markdown.trim()].join("\n")
}

export async function vendorExternalDiscoveryLookup(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    question: string
    buildingFilter?: string | null
    rosterHadOptions?: boolean
  },
): Promise<VendorExternalDiscoveryResult> {
  const landlordId = input.landlordId.trim()
  const trade = detectVendorTradeFromQuestion(input.question)
  const empty: VendorExternalDiscoveryResult = {
    available: false,
    found: false,
    searchLocation: "",
    locationLabel: "",
    mode: "mock",
    configured: false,
    suggestions: [],
    bullets: [],
    citations: [],
    markdown: "",
  }
  if (!landlordId) return empty

  const { searchLocation, locationLabel } = await resolvePortfolioExternalSearchContext(
    supabase,
    { landlordId, buildingFilter: input.buildingFilter },
  )

  const issueCategory = trade.slug ?? trade.label ?? null
  const discovery = await discoverExternalVendors(supabase, {
    issueCategory,
    searchLocation,
    locationLabel,
    landlordId,
    limit: 5,
  })

  const found = discovery.suggestions.length > 0
  const markdown = polishAskUloProse(
    buildExternalDiscoveryMarkdown({
      tradeLabel: trade.label,
      locationLabel,
      searchLocation,
      suggestions: discovery.suggestions,
      mode: discovery.mode,
      configured: discovery.configured,
      rosterHadOptions: input.rosterHadOptions ?? false,
    }),
  )

  console.log(
    "ASK_ULO_VENDOR_EXTERNAL",
    JSON.stringify({
      landlordId,
      trade: trade.slug,
      found,
      mode: discovery.mode,
      searchLocation,
      count: discovery.suggestions.length,
    }),
  )

  return {
    available: true,
    found,
    searchLocation,
    locationLabel,
    mode: discovery.mode,
    configured: discovery.configured,
    suggestions: discovery.suggestions,
    bullets: discovery.suggestions.slice(0, 5).map((s) => {
      const bits = suggestionBits(s)
      return `${s.name}${bits.length ? `: ${bits.join("; ")}` : ""}`
    }),
    citations: [
      {
        tool: "external_vendor",
        title: trade.label ? `Local ${trade.label}s` : "Local vendors",
        citation: `discoverExternalVendors (${discovery.providersUsed.join(", ") || "mock"})`,
        excerpt: found
          ? `Top: ${discovery.suggestions[0]!.name} near ${locationLabel}`
          : `No local matches near ${locationLabel}`,
      },
    ],
    markdown,
  }
}

export const VENDOR_EXTERNAL_DISCOVERY_GUIDE = `
## External / local vendor discovery

When the landlord asks for someone outside the roster, or roster is thin for "recommend another [trade]":
1. Resolve portfolio search location (named building → onboarding address → demo property anchor).
2. Run discoverExternalVendors for the inferred trade near that location.
3. Rank by public rating/reviews; exclude roster names when possible.
4. Include phone (clickable) and a page link (website, else Google/Yelp listing, else Maps search).
5. Say these are outside the network and assign via Find external vendor on a work order.
`.trim()
