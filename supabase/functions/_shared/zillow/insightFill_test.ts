/// <reference lib="deno.ns" />

import { parseZillowPropertyInsights } from "./insightFill.ts"

Deno.test("parseZillowPropertyInsights reads zestimate, rent, year, photos", () => {
  const p = parseZillowPropertyInsights({
    yearBuilt: 1924,
    zestimate: 610000,
    rentZestimate: 2800,
    latitude: 40.79,
    longitude: -74.24,
    imgSrc: "https://photos.zillowstatic.com/fp/example-p_e.jpg",
    resoFacts: { yearBuilt: 1924 },
  })
  if (p.yearBuilt !== 1924) throw new Error(String(p.yearBuilt))
  if (p.homeValue !== 610000) throw new Error(String(p.homeValue))
  if (p.rentEstimate !== 2800) throw new Error(String(p.rentEstimate))
  if (!p.photos[0]?.includes("zillowstatic")) throw new Error(JSON.stringify(p.photos))
})
