/// <reference lib="deno.ns" />

import {
  extractZipFromLocation,
  normalizeThumbtackUtmSource,
  parseThumbtackBusinesses,
  parseThumbtackCategoryId,
  parseThumbtackSearchContext,
  thumbtackIdsFromListingUrl,
  buildThumbtackFilteredUserQuery,
} from "./thumbtack.ts"

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
  if (hit.imageUrl !== "https://production-next-images-cdn.thumbtack.com/i/example/profile") {
    throw new Error(`imageUrl ${hit.imageUrl}`)
  }
  if (hit.etaMinutes !== 60) throw new Error(`eta ${hit.etaMinutes}`)
  if (!hit.priceLabel?.includes("Licensed")) throw new Error(`price ${hit.priceLabel}`)
  if (!hit.tags?.includes("Licensed") || !hit.tags?.includes("Top Pro")) {
    throw new Error(`tags ${hit.tags?.join(",")}`)
  }
})

Deno.test("parseThumbtackSearchContext and listing URL ids", () => {
  const ctx = parseThumbtackSearchContext({
    searchID: "search-abc",
    metadata: { categoryID: "cat-9" },
  })
  if (ctx.searchId !== "search-abc") throw new Error(String(ctx.searchId))
  if (ctx.categoryId !== "cat-9") throw new Error(String(ctx.categoryId))
  const fromUrl = thumbtackIdsFromListingUrl(
    "https://www.thumbtack.com/pro?project_pk=s1&category_pk=c2",
  )
  if (fromUrl.searchId !== "s1") throw new Error(String(fromUrl.searchId))
  if (fromUrl.categoryId !== "c2") throw new Error(String(fromUrl.categoryId))
})
