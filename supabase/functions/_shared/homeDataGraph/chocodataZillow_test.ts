/// <reference lib="deno.ns" />

import {
  chocodataSearchLocations,
  mapChocodataPropertyToFacts,
  mapChocodataSearchHitToFacts,
  pickChocodataSearchHit,
} from "./chocodataZillow.ts"

Deno.test("chocodataSearchLocations uses city/state and ZIP, not the street", () => {
  const locations = chocodataSearchLocations("78 Maple Ave, Irvington, NJ 07111")
  if (locations[0] !== "Irvington, NJ") throw new Error(JSON.stringify(locations))
  if (!locations.includes("07111")) throw new Error(JSON.stringify(locations))
  if (locations.some((item) => /maple/i.test(item))) throw new Error(JSON.stringify(locations))
})

Deno.test("pickChocodataSearchHit matches street and ZIP", () => {
  const hit = pickChocodataSearchHit(
    {
      results: [
        {
          title: "12 Oak St, Newark, NJ 07102",
          address_street: "12 Oak St",
          address_zip: "07102",
          zpid: "1",
          price: 100,
        },
        {
          title: "78 Maple Ave, Irvington, NJ 07111",
          address_street: "78 Maple Ave",
          address_zip: "07111",
          zpid: "2",
          zestimate: 410000,
          beds: 3,
          baths: 1,
        },
      ],
    },
    "78 Maple Avenue, Irvington, NJ 07111",
  )
  if (hit?.zpid !== "2") throw new Error(String(hit?.zpid))
})

Deno.test("mapChocodataPropertyToFacts fills overview cards", () => {
  const { facts, providerRecordId } = mapChocodataPropertyToFacts(
    {
      name: "705 Partridge Dr, Schaumburg, IL, 60193",
      year_built: 1983,
      property_type: "house",
      number_of_rooms: 3,
      rooms: [
        { count: 3, room_type: "bedroom" },
        { count: 2, room_type: "bathroom" },
      ],
      area: { value: 2351, unit_code: "sqft" },
      lot_size: 8712,
      latitude: 42.003365,
      longitude: -88.06319,
      zpid: "3438699",
      trade_info: [{ price: 550000, trade_type: "sale" }],
      images: ["https://photos.zillowstatic.com/fp/example-p_d.jpg"],
    },
    { zestimate: 560000, beds: 3 },
  )
  if (providerRecordId !== "3438699") throw new Error(String(providerRecordId))
  if (facts.estimatedValue !== 560000) throw new Error(String(facts.estimatedValue))
  if (facts.bedrooms !== 3) throw new Error(String(facts.bedrooms))
  if (facts.bathrooms !== 2) throw new Error(String(facts.bathrooms))
  if (facts.livingAreaSqft !== 2351) throw new Error(String(facts.livingAreaSqft))
  if (facts.yearBuilt !== 1983) throw new Error(String(facts.yearBuilt))
  if (facts.propertyType !== "Single Family") throw new Error(String(facts.propertyType))
  if (facts.lotSizeSqft !== 8712) throw new Error(String(facts.lotSizeSqft))
  if (!facts.photoUrls[0]?.includes("zillowstatic")) throw new Error(JSON.stringify(facts.photoUrls))
})

Deno.test("mapChocodataSearchHitToFacts uses listing price when zestimate is null", () => {
  const facts = mapChocodataSearchHitToFacts({
    price: 550000,
    zestimate: null,
    beds: 3,
    baths: 3,
    sqft: 2351,
    home_type: "SINGLE_FAMILY",
    latitude: 42.0,
    longitude: -88.0,
  })
  if (facts.estimatedValue !== 550000) throw new Error(String(facts.estimatedValue))
  if (facts.propertyType !== "Single Family") throw new Error(String(facts.propertyType))
})
