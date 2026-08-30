/// <reference lib="deno.ns" />

import {
  extractZipFromLocation,
  parseThumbtackBusinesses,
  parseThumbtackCategoryId,
} from "./thumbtack.ts"

Deno.test("extractZipFromLocation reads a 5-digit ZIP", () => {
  const zip = extractZipFromLocation("109 S Grove St, Newark, NJ 07112")
  if (zip !== "07112") throw new Error(`expected 07112, got ${zip}`)
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
  if (hit.etaMinutes !== 60) throw new Error(`eta ${hit.etaMinutes}`)
  if (!hit.priceLabel?.includes("Licensed")) throw new Error(`price ${hit.priceLabel}`)
  if (!hit.tags?.includes("Licensed") || !hit.tags?.includes("Top Pro")) {
    throw new Error(`tags ${hit.tags?.join(",")}`)
  }
})
