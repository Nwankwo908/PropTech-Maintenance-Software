/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent } from "./intent.ts"
import { classifyInvestigationPlaybook } from "./investigationPlaybooks.ts"
import {
  isVendorExternalDiscoveryQuestion,
  isVendorRecommendQuestion,
} from "./questionMetricContext.ts"
import {
  buildExternalDiscoveryMarkdown,
  shouldRunExternalVendorDiscovery,
} from "./vendorExternalDiscoveryLookup.ts"

Deno.test("external discovery question routes to vendor_best", () => {
  const q = "Find a local plumber outside my network near my properties."
  assertEquals(isVendorExternalDiscoveryQuestion(q), true)
  assertEquals(classifyInvestigationPlaybook(q).id, "vendor_best")
  assertEquals(classifyAskUloIntent(q).intent, "vendor")
})

Deno.test("shouldRunExternalVendorDiscovery when roster is thin on recommend", () => {
  assertEquals(
    shouldRunExternalVendorDiscovery({
      question: "Recommend another plumber.",
      rosterFound: false,
      rosterCount: 0,
    }),
    true,
  )
  assertEquals(
    shouldRunExternalVendorDiscovery({
      question: "Recommend another plumber.",
      rosterFound: true,
      rosterCount: 3,
    }),
    false,
  )
})

Deno.test("shouldRunExternalVendorDiscovery for explicit outside-network ask", () => {
  assertEquals(
    shouldRunExternalVendorDiscovery({
      question: "Find an external electrician near Oakwood.",
      rosterFound: true,
      rosterCount: 4,
    }),
    true,
  )
})

Deno.test("recommend another plumber still skips external when roster is strong", () => {
  assertEquals(isVendorRecommendQuestion("Recommend another plumber."), true)
  assertEquals(
    shouldRunExternalVendorDiscovery({
      question: "Recommend another plumber.",
      rosterFound: true,
      rosterCount: 2,
    }),
    false,
  )
})

Deno.test("buildExternalDiscoveryMarkdown lists local options", () => {
  const md = buildExternalDiscoveryMarkdown({
    tradeLabel: "plumber",
    locationLabel: "Oakwood Apartments",
    searchLocation: "812 Oakwood Ave, Portland, OR 97214",
    mode: "mock",
    configured: false,
    rosterHadOptions: false,
    suggestions: [
      {
        name: "Rapid Plumb Co.",
        rating: 4.8,
        reviewCount: 120,
        priceLabel: "$$",
        sources: ["mock"],
        rankScore: 9.1,
        etaMinutes: 18,
        address: "840 N Clark St",
        phone: "(503) 555-0100",
        website: "rapidplumb.com",
      },
    ],
  })
  assertStringIncludes(md, "Rapid Plumb Co.")
  assertStringIncludes(md, "outside your roster")
  assertStringIncludes(md, "oakwood apartments")
  assertStringIncludes(md, "Find external vendor")
  assertStringIncludes(md, "[(503) 555-0100](tel:5035550100)")
  assertStringIncludes(md, "[Website](https://rapidplumb.com)")
})

Deno.test("buildExternalDiscoveryMarkdown falls back to listing / Maps page link", () => {
  const withListing = buildExternalDiscoveryMarkdown({
    tradeLabel: "roofer",
    locationLabel: "Portland",
    searchLocation: "Portland, OR",
    mode: "live",
    configured: true,
    rosterHadOptions: true,
    suggestions: [
      {
        name: "Bliss Roofing",
        rating: 4.9,
        reviewCount: 856,
        priceLabel: null,
        sources: ["google"],
        rankScore: 10,
        etaMinutes: null,
        address: "14430 SE 98th Ct, Clackamas, OR 97015",
        phone: "(503) 555-0199",
        listingUrl: "https://maps.google.com/?cid=123",
      },
    ],
  })
  assertStringIncludes(withListing, "[(503) 555-0199](tel:5035550199)")
  assertStringIncludes(withListing, "[Google](https://maps.google.com/?cid=123)")

  const mapsFallback = buildExternalDiscoveryMarkdown({
    tradeLabel: "roofer",
    locationLabel: "Portland",
    searchLocation: "Portland, OR",
    mode: "live",
    configured: true,
    suggestions: [
      {
        name: "Flow Roofing",
        rating: 4.9,
        reviewCount: 427,
        priceLabel: null,
        sources: ["google"],
        rankScore: 9,
        etaMinutes: null,
        address: "555 SE MLK Blvd, Portland, OR",
      },
    ],
  })
  assertStringIncludes(mapsFallback, "[Maps](https://www.google.com/maps/search/?api=1&query=")
  assertStringIncludes(mapsFallback, "Flow%20Roofing")
})
