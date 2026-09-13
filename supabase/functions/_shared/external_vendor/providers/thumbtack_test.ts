/// <reference lib="deno.ns" />

import {
  extractZipFromLocation,
  parseThumbtackBusinesses,
  parseThumbtackCategoryId,
  parseThumbtackSearchContext,
  thumbtackIdsFromListingUrl,
  thumbtackSearchContextForBusiness,
  buildThumbtackFilteredUserQuery,
  mergeThumbtackOauthScopes,
  thumbtackOpenConversationError,
  thumbtackScopeAllowsMessaging,
} from "./thumbtack.ts"
import {
  normalizeThumbtackUtmSource,
  resolveThumbtackRequestFlowUrl,
} from "../../../../../shared/externalVendor/thumbtackRequestFlow.ts"

Deno.test("extractZipFromLocation reads a 5-digit ZIP", () => {
  const zip = extractZipFromLocation("109 S Grove St, Newark, NJ 07112")
  if (zip !== "07112") throw new Error(`expected 07112, got ${zip}`)
})

Deno.test("normalizeThumbtackUtmSource prefixes cma-", () => {
  if (normalizeThumbtackUtmSource("ulo") !== "cma-ulo") {
    throw new Error("expected cma-ulo")
  }
  if (normalizeThumbtackUtmSource("cma-admin") !== "cma-admin") {
    throw new Error("keep assigned partner source")
  }
})

Deno.test("parseThumbtackCategoryId prefers a name match", () => {
  const id = parseThumbtackCategoryId(
    {
      data: [
        { categoryID: "1", name: "Kitchen Remodel" },
        { categoryID: "2", name: "Plumbing" },
      ],
    },
    "plumbing",
  )
  if (id !== "2") throw new Error(`expected plumbing category, got ${id}`)
})

Deno.test("parseThumbtackCategoryId does not use an unmatched first category", () => {
  const id = parseThumbtackCategoryId(
    {
      data: [
        { categoryID: "1", name: "Kitchen Remodel" },
        { categoryID: "2", name: "House Cleaning" },
      ],
    },
    "appliance repair",
  )
  if (id !== null) throw new Error(`expected null, got ${id}`)
})

Deno.test("buildThumbtackFilteredUserQuery includes job, trade, and location", () => {
  const q = buildThumbtackFilteredUserQuery({
    issueCategory: "appliance_repair",
    searchLocation: "Irvington, NJ 07111",
    tradeTerms: "appliance repair",
    textQuery: "appliance repair near Irvington, NJ 07111",
    jobDescription: "Oven is not heating",
  })
  if (!q.includes("Oven is not heating")) throw new Error(`missing job: ${q}`)
  if (!q.includes("appliance repair")) throw new Error(`missing trade: ${q}`)
  if (!q.includes("07111")) throw new Error(`missing zip: ${q}`)
})

Deno.test("parseThumbtackBusinesses maps partner search payload", () => {
  const hits = parseThumbtackBusinesses({
    data: [
      {
        businessID: "468046965846925323",
        businessName: "Igreen Builders Inc",
        rating: 5,
        numberOfReviews: 11,
        quote: { startingCost: 85, costUnit: "on-site estimate" },
        businessLocation: "Milpitas, CA",
        responseTimeHours: 1,
        servicePageURL: "https://thumbtack.com/example",
        widgets: {
          requestFlowURL:
            "https://thumbtack.com/embed/request-flow?category_pk=c1&project_pk=s1&utm_source=cma-ulo",
        },
        businessImageURL: "https://production-next-images-cdn.thumbtack.com/i/example/profile",
        pills: ["licensed"],
        isTopPro: true,
        isBusinessLicenseVerified: true,
        isBackgroundChecked: true,
      },
    ],
  })
  if (hits.length !== 1) throw new Error("expected one hit")
  const hit = hits[0]
  if (hit.source !== "thumbtack") throw new Error("source")
  if (hit.providerRef !== "468046965846925323") throw new Error("providerRef")
  if (hit.listingUrl !== "https://thumbtack.com/example") throw new Error("listingUrl")
  if (
    hit.requestFlowUrl !==
      "https://thumbtack.com/embed/request-flow?category_pk=c1&project_pk=s1&utm_source=cma-ulo"
  ) {
    throw new Error(`requestFlowUrl ${hit.requestFlowUrl}`)
  }
  if (hit.searchId !== "s1") throw new Error(`searchId ${hit.searchId}`)
  if (hit.categoryId !== "c1") throw new Error(`categoryId ${hit.categoryId}`)
  if (hit.imageUrl !== "https://production-next-images-cdn.thumbtack.com/i/example/profile") {
    throw new Error(`imageUrl ${hit.imageUrl}`)
  }
  if (hit.etaMinutes !== 60) throw new Error(`eta ${hit.etaMinutes}`)
  if (!hit.priceLabel?.includes("Licensed")) throw new Error(`price ${hit.priceLabel}`)
  if (!hit.tags?.includes("Licensed") || !hit.tags?.includes("Top Pro")) {
    throw new Error(`tags ${hit.tags?.join(",")}`)
  }
})

Deno.test("parseThumbtackSearchContext reads nested data and listing URL ids", () => {
  const ctx = parseThumbtackSearchContext({
    data: {
      searchID: "search-nested",
      metadata: { categoryID: "cat-nested" },
    },
  })
  if (ctx.searchId !== "search-nested") throw new Error(String(ctx.searchId))
  if (ctx.categoryId !== "cat-nested") throw new Error(String(ctx.categoryId))
  const top = parseThumbtackSearchContext({
    searchID: "search-abc",
    metadata: { categoryID: "cat-9" },
  })
  if (top.searchId !== "search-abc") throw new Error(String(top.searchId))
  if (top.categoryId !== "cat-9") throw new Error(String(top.categoryId))
  const fromUrl = thumbtackIdsFromListingUrl(
    "https://www.thumbtack.com/pro?project_pk=s1&category_pk=c2",
  )
  if (fromUrl.searchId !== "s1") throw new Error(String(fromUrl.searchId))
  if (fromUrl.categoryId !== "c2") throw new Error(String(fromUrl.categoryId))
})

Deno.test("messaging scopes always include requests.write", () => {
  const merged = mergeThumbtackOauthScopes(
    "demand::businesses/search.read",
    "demand::requests.write demand::negotiations.read",
  )
  if (!thumbtackScopeAllowsMessaging(merged)) throw new Error(merged)
  if (!thumbtackScopeAllowsMessaging("demand::requests.write")) {
    throw new Error("bare write scope")
  }
  if (!thumbtackScopeAllowsMessaging("demand::messages.write")) {
    throw new Error("messages.write should allow messaging")
  }
  if (thumbtackScopeAllowsMessaging("demand::businesses/search.read")) {
    throw new Error("search-only should not allow messaging")
  }
})

Deno.test("thumbtackSearchContextForBusiness prefers the matching pro", () => {
  const ctx = thumbtackSearchContextForBusiness(
    [
      { name: "A", rating: 5, reviewCount: 1, priceLabel: null, source: "thumbtack", providerRef: "b1", searchId: "s-old", categoryId: "c-old" },
      { name: "B", rating: 5, reviewCount: 1, priceLabel: null, source: "thumbtack", providerRef: "b2", searchId: "s-new", categoryId: "c-new" },
    ],
    "b2",
  )
  if (ctx?.searchId !== "s-new" || ctx?.categoryId !== "c-new") {
    throw new Error(JSON.stringify(ctx))
  }
})

Deno.test("thumbtackSearchContextForBusiness fills ids from other hits in the same search", () => {
  const ctx = thumbtackSearchContextForBusiness(
    [
      { name: "A", rating: 5, reviewCount: 1, priceLabel: null, source: "thumbtack", providerRef: "b1", searchId: "s1", categoryId: null },
      { name: "B", rating: 5, reviewCount: 1, priceLabel: null, source: "thumbtack", providerRef: "b2", searchId: null, categoryId: "c1" },
    ],
    "b1",
  )
  if (ctx?.searchId !== "s1" || ctx?.categoryId !== "c1") {
    throw new Error(JSON.stringify(ctx))
  }
})

Deno.test("thumbtackSearchContextForBusiness can require the matching pro", () => {
  const ctx = thumbtackSearchContextForBusiness(
    [
      { name: "A", rating: 5, reviewCount: 1, priceLabel: null, source: "thumbtack", providerRef: "b1", searchId: "s1", categoryId: "c1" },
    ],
    "missing",
    { requireBusiness: true },
  )
  if (ctx) throw new Error("expected null when the pro is not in this search")
})

Deno.test("thumbtackOpenConversationError explains 400 without a raw status code", () => {
  const msg = thumbtackOpenConversationError(400, '{"error":"missing categoryID"}')
  if (!/search for vendors again/i.test(msg)) throw new Error(msg)
  if (/\(400\)/.test(msg)) throw new Error("should not echo 400")
})

Deno.test("thumbtackOpenConversationError explains an expired searchID", () => {
  const msg = thumbtackOpenConversationError(400, '{"error":"invalid searchID"}')
  if (!/expired/i.test(msg)) throw new Error(msg)
  if (/\(400\)/.test(msg)) throw new Error("should not echo 400")
})

Deno.test("thumbtackOpenConversationError explains 401 without a raw status code", () => {
  const msg = thumbtackOpenConversationError(401, "oauth_token_failed")
  if (!/could not send this in ulo/i.test(msg)) throw new Error(msg)
  if (!/message api login/i.test(msg)) throw new Error(msg)
  if (/\(401\)/.test(msg)) throw new Error("should not echo 401")
})

Deno.test("resolveThumbtackRequestFlowUrl prefers the widget URL", () => {
  const url = resolveThumbtackRequestFlowUrl({
    requestFlowUrl: "https://thumbtack.com/embed/request-flow?x=1",
    listingUrl: "https://thumbtack.com/example",
    searchId: "s1",
    categoryId: "c1",
    utmSource: "ulo",
  })
  if (url !== "https://thumbtack.com/embed/request-flow?x=1") throw new Error(String(url))
})

Deno.test("resolveThumbtackRequestFlowUrl builds embed URL from search ids", () => {
  const url = resolveThumbtackRequestFlowUrl({
    searchId: "s1",
    categoryId: "c1",
    utmSource: "ulo",
  })
  if (
    url !==
      "https://www.thumbtack.com/embed/request-flow?category_pk=c1&project_pk=s1&utm_source=cma-ulo"
  ) {
    throw new Error(String(url))
  }
})
