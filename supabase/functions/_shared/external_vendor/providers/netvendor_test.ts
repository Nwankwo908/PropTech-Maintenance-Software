/// <reference lib="deno.ns" />

import {
  NetVendorMockExternalVendorProvider,
  parseNetVendorRecords,
} from "./netvendor.ts"
import { buildExternalSearchQuery } from "../trade_terms.ts"

Deno.test("parseNetVendorRecords maps partner payload fields", () => {
  const hits = parseNetVendorRecords([
    {
      vendor_id: "nv-99",
      company_name: "Acme Plumbing LLC",
      vendor_rating: 4.8,
      review_count: 120,
      compliance_status: "Compliant",
    },
  ])
  if (hits.length !== 1 || hits[0].name !== "Acme Plumbing LLC") {
    throw new Error(`unexpected parse: ${JSON.stringify(hits)}`)
  }
  if (hits[0].providerRef !== "nv-99" || hits[0].source !== "netvendor") {
    throw new Error("expected providerRef and netvendor source")
  }
})

Deno.test("NetVendor mock provider returns credentialed plumbing vendors", async () => {
  const provider = new NetVendorMockExternalVendorProvider()
  const { tradeTerms, textQuery, searchLocation } = buildExternalSearchQuery(
    "plumbing",
    "Oakwood Apartments",
  )
  const hits = await provider.search({
    issueCategory: "plumbing",
    searchLocation,
    tradeTerms,
    textQuery,
  })
  if (hits.length < 1) throw new Error("expected netvendor mock hits")
  if (!hits.every((h) => h.source === "netvendor")) {
    throw new Error("expected netvendor source on mock hits")
  }
})
