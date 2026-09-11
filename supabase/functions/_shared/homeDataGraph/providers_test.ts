/// <reference lib="deno.ns" />

import { fetchHomeDataFromProvider } from "./providers.ts"
import { mapListingPayloadToHomeDataFacts } from "./uloPropertyFacts.ts"

Deno.test("home data providers skip ingest without vendor HTTP", async () => {
  const manual = await fetchHomeDataFromProvider({ provider: "manual", address: "1 Main St, Newark, NJ 07102" })
  if (manual.status !== "unsupported") throw new Error(manual.status)
  const rentcast = await fetchHomeDataFromProvider({
    provider: "rentcast",
    address: "1 Main St, Newark, NJ 07102",
  })
  if (rentcast.status !== "not_configured") throw new Error(rentcast.status)
})

Deno.test("Ulo listing mapper fills overview facts from a /property payload", () => {
  const { facts, providerRecordId } = mapListingPayloadToHomeDataFacts({
    zpid: "12345",
    yearBuilt: 1924,
    zestimate: 610000,
    zestimateLowPercent: 5,
    zestimateHighPercent: 6,
    rentZestimate: 2800,
    latitude: 40.79,
    longitude: -74.24,
    homeType: "SINGLE_FAMILY",
    bedrooms: 3,
    bathrooms: 1.5,
    livingArea: 1420,
    lotAreaValue: 0.12,
    lotAreaUnits: "acres",
    imgSrc: "https://photos.zillowstatic.com/fp/example-p_e.jpg",
    resoFacts: {
      yearBuilt: 1924,
      heating: ["Forced air"],
      cooling: "Central",
      hasGarage: true,
      garageSpaces: 1,
      parkingFeatures: "Detached",
      hasPrivatePool: false,
      taxAnnualAmount: 9800,
      taxAssessedValue: 420000,
      taxAssessedYear: 2025,
    },
    priceHistory: [{ event: "Sold", price: 385000, date: "2019-06-12" }],
  })
  if (providerRecordId !== "12345") throw new Error(String(providerRecordId))
  if (facts.estimatedValue !== 610000) throw new Error(String(facts.estimatedValue))
  if (facts.estimatedValueLow !== 579500) throw new Error(String(facts.estimatedValueLow))
  if (facts.estimatedValueHigh !== 646600) throw new Error(String(facts.estimatedValueHigh))
  if (facts.estimatedRent !== 2800) throw new Error(String(facts.estimatedRent))
  if (facts.propertyType !== "Single Family") throw new Error(String(facts.propertyType))
  if (facts.bedrooms !== 3) throw new Error(String(facts.bedrooms))
  if (facts.bathrooms !== 1.5) throw new Error(String(facts.bathrooms))
  if (facts.livingAreaSqft !== 1420) throw new Error(String(facts.livingAreaSqft))
  if (facts.lotSizeSqft !== 5227) throw new Error(String(facts.lotSizeSqft))
  if (facts.yearBuilt !== 1924) throw new Error(String(facts.yearBuilt))
  if (facts.heating !== "Forced air") throw new Error(String(facts.heating))
  if (facts.cooling !== "Central") throw new Error(String(facts.cooling))
  if (facts.hasGarage !== true || facts.garageSpaces !== 1) throw new Error("garage")
  if (facts.hasPool !== false) throw new Error("pool")
  if (facts.propertyTaxAnnual !== 9800) throw new Error(String(facts.propertyTaxAnnual))
  if (facts.assessedValue !== 420000) throw new Error(String(facts.assessedValue))
  if (facts.taxYear !== 2025) throw new Error(String(facts.taxYear))
  if (facts.lastSalePrice !== 385000) throw new Error(String(facts.lastSalePrice))
  if (facts.lastSaleDate !== "2019-06-12") throw new Error(String(facts.lastSaleDate))
  if (!facts.photoUrls[0]?.includes("zillowstatic")) throw new Error(JSON.stringify(facts.photoUrls))
})

Deno.test("Ulo listing mapper unwraps search props[] payloads", () => {
  const { facts } = mapListingPayloadToHomeDataFacts({
    props: [
      {
        zpid: "999",
        zestimate: 410000,
        bedrooms: 2,
        bathrooms: 1,
        livingArea: 900,
        homeType: "CONDO",
        yearBuilt: 1988,
      },
    ],
  })
  if (facts.estimatedValue !== 410000) throw new Error(String(facts.estimatedValue))
  if (facts.bedrooms !== 2) throw new Error(String(facts.bedrooms))
  if (facts.propertyType !== "Condo") throw new Error(String(facts.propertyType))
  if (facts.yearBuilt !== 1988) throw new Error(String(facts.yearBuilt))
})
