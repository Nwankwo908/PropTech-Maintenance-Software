/// <reference lib="deno.ns" />

import { mergeRentCastHomeData, parseRentCastPropertyRecord } from "./rentcastAdapter.ts"

Deno.test("parseRentCastPropertyRecord maps priority fields", () => {
  const { recordId, facts } = parseRentCastPropertyRecord([
    {
      id: "123-Main-St",
      propertyType: "Single Family",
      bedrooms: 4,
      bathrooms: 2.5,
      squareFootage: 2100,
      lotSize: 6500,
      yearBuilt: 1998,
      lastSalePrice: 410000,
      lastSaleDate: "2021-06-15T00:00:00.000Z",
      features: {
        garage: true,
        garageSpaces: 2,
        garageType: "Attached",
        pool: false,
        heating: true,
        heatingType: "Forced Air",
        cooling: true,
        coolingType: "Central",
        unitCount: 1,
      },
      propertyTaxes: { "2024": { year: 2024, total: 8120 } },
      taxAssessments: { "2024": { year: 2024, value: 385000 } },
      latitude: 40.735,
      longitude: -74.172,
      photos: ["https://cdn.example.com/listing/front.jpg"],
    },
  ])
  if (recordId !== "123-Main-St") throw new Error(recordId ?? "missing id")
  if (facts.propertyType !== "Single Family") throw new Error(String(facts.propertyType))
  if (facts.bedrooms !== 4) throw new Error(String(facts.bedrooms))
  if (facts.bathrooms !== 2.5) throw new Error(String(facts.bathrooms))
  if (facts.livingAreaSqft !== 2100) throw new Error(String(facts.livingAreaSqft))
  if (facts.lotSizeSqft !== 6500) throw new Error(String(facts.lotSizeSqft))
  if (facts.yearBuilt !== 1998) throw new Error(String(facts.yearBuilt))
  if (facts.unitCount !== 1) throw new Error(String(facts.unitCount))
  if (facts.hasGarage !== true || facts.garageSpaces !== 2) throw new Error("garage")
  if (facts.hasPool !== false) throw new Error("pool")
  if (facts.heating !== "Forced Air") throw new Error(String(facts.heating))
  if (facts.cooling !== "Central") throw new Error(String(facts.cooling))
  if (facts.lastSalePrice !== 410000) throw new Error(String(facts.lastSalePrice))
  if (facts.lastSaleDate !== "2021-06-15") throw new Error(String(facts.lastSaleDate))
  if (facts.taxYear !== 2024 || facts.propertyTaxAnnual !== 8120) throw new Error("tax")
  if (facts.assessedValue !== 385000) throw new Error(String(facts.assessedValue))
  if (facts.latitude !== 40.735 || facts.longitude !== -74.172) throw new Error("coords")
  if (facts.photoUrls[0] !== "https://cdn.example.com/listing/front.jpg") throw new Error("photos")
})

Deno.test("mergeRentCastHomeData adds AVM without RentCast column names", () => {
  const merged = mergeRentCastHomeData({
    property: { propertyType: "Condo", bedrooms: 2 },
    avmValue: { price: 512000, priceRangeLow: 480000, priceRangeHigh: 545000 },
    avmRent: { rent: 2450, rentRangeLow: 2300, rentRangeHigh: 2600 },
    saleListings: [{ photos: ["https://images.example.com/sale/1.jpg"] }],
  })
  if (merged.provider !== "rentcast") throw new Error(merged.provider)
  if (merged.facts.estimatedValue !== 512000) throw new Error(String(merged.facts.estimatedValue))
  if (merged.facts.estimatedValueLow !== 480000) throw new Error(String(merged.facts.estimatedValueLow))
  if (merged.facts.estimatedRent !== 2450) throw new Error(String(merged.facts.estimatedRent))
  if (merged.facts.estimatedRentHigh !== 2600) throw new Error(String(merged.facts.estimatedRentHigh))
  if (merged.facts.propertyType !== "Condo") throw new Error(String(merged.facts.propertyType))
  if (merged.facts.photoUrls[0] !== "https://images.example.com/sale/1.jpg") throw new Error("listing photos")
  if ("price" in merged.facts) throw new Error("leaked rentcast field")
  if ("rent" in merged.facts) throw new Error("leaked rentcast rent field")
})

Deno.test("mergeRentCastHomeData reads coordinates from listing rows when the property record omits them", () => {
  const merged = mergeRentCastHomeData({
    property: { propertyType: "Condo", bedrooms: 2 },
    avmValue: { price: 200000 },
    saleListings: [{ latitude: 40.12, longitude: -74.45 }],
  })
  if (merged.facts.latitude !== 40.12) throw new Error(String(merged.facts.latitude))
  if (merged.facts.longitude !== -74.45) throw new Error(String(merged.facts.longitude))
})
