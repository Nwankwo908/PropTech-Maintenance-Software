/// <reference lib="deno.ns" />

import { googleStreetViewImageUrl, streetViewLocationParam } from "./streetViewStatic.ts"

Deno.test("streetViewLocationParam prefers coordinates", () => {
  const loc = streetViewLocationParam({ lat: 40.7, lng: -74.1, address: "1 Main St" })
  if (loc !== "40.7,-74.1") throw new Error(String(loc))
})

Deno.test("streetViewImageUrl is the Static API, not Maps JS", () => {
  const url = googleStreetViewImageUrl("40.7,-74.1", "k")
  if (!url.includes("/maps/api/streetview?")) throw new Error(url)
  if (url.includes("maps/api/js")) throw new Error(url)
  if (url.includes("source=outdoor")) throw new Error(url)
})
