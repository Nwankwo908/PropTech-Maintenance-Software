/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { mergeInspectionReportExtracts, normalizeInspectionReportExtract } from "./normalize.ts"

Deno.test("Okafor 4-point fixture normalizes to six systems findings", () => {
  const extracted = normalizeInspectionReportExtract({
    propertyAddress: {
      street: "563 Springdale Cir",
      city: "Palm Springs",
      state: "FL",
      zip: "33461",
      raw: "563 Springdale Cir, Palm Springs, FL 33461",
    },
    items: [
      {
        category: "electrical_panel",
        identifiedItem: { type: "Main electrical panel", brand: "Square D" },
        estimatedAge: 15,
        condition: "satisfactory",
        deficiencies: [],
        maintenanceRecommendations: [],
        overallConfidence: 65,
        rawConfidenceNotes:
          "Form states 'Panel age: 15' directly. A separate 'Year last updated: 2015' field doesn't clearly reconcile with that (would imply original install ~2009). Used the directly-stated age per instructions rather than withholding the value; discrepancy noted here.",
      },
      {
        category: "hvac",
        identifiedItem: { type: "Central AC/heat system" },
        estimatedAge: 9,
        condition: "satisfactory",
        overallConfidence: 80,
      },
      {
        category: "water_heater",
        identifiedItem: { type: "Water heater" },
        estimatedAge: 9,
        condition: "satisfactory",
        overallConfidence: 55,
      },
      {
        category: "roof",
        identifiedItem: { type: "Predominant roof - reinforced concrete" },
        estimatedAge: 5,
        condition: "satisfactory",
        overallConfidence: 85,
      },
      {
        category: "roof",
        identifiedItem: { type: "Secondary roof - fiberglass shingle" },
        estimatedAge: 5,
        condition: "satisfactory",
        overallConfidence: 85,
      },
      {
        category: "plumbing",
        identifiedItem: { type: "Plumbing system" },
        estimatedAge: null,
        condition: "satisfactory",
        overallConfidence: 70,
        rawConfidenceNotes: "4-point plumbing section checked satisfactory; no pipe age stated.",
      },
    ],
  })

  assertEquals(extracted.propertyAddress.street, "563 Springdale Cir")
  assertEquals(extracted.items.length, 6)
  assertEquals(extracted.items[0]?.category, "electrical_panel")
  assertEquals(extracted.items[0]?.identifiedItem.type, "Main electrical panel")
  assertEquals(extracted.items[0]?.identifiedItem.brand, "Square D")
  assertEquals(extracted.items[0]?.estimatedAge.value, 15)
  assertEquals(extracted.items[0]?.overallConfidence, 65)
  assertEquals(extracted.items[0]?.condition.rating, "good")
  assertEquals(extracted.items.map((item) => item.category).join(","),
    "electrical_panel,hvac,water_heater,roof,roof,plumbing")
})

Deno.test("accepts findings[] and category-only rows", () => {
  const extracted = normalizeInspectionReportExtract({
    propertyAddress: { street: "563 Springdale Cir", city: "Palm Springs", state: "FL", zip: "33461" },
    findings: [
      { category: "electrical_panel", brand: "Square D", ageYears: 15 },
      { category: "hvac", type: "Central AC/heat system", estimated_age: 9 },
    ],
  })
  assertEquals(extracted.items.length, 2)
  assertEquals(extracted.items[0]?.identifiedItem.type, "Electrical panel")
  assertEquals(extracted.items[0]?.identifiedItem.brand, "Square D")
  assertEquals(extracted.items[0]?.estimatedAge.value, 15)
  assertEquals(extracted.items[1]?.identifiedItem.type, "Central AC/heat system")
  assertEquals(extracted.items[1]?.estimatedAge.value, 9)
})

Deno.test("mergeInspectionReportExtracts keeps later-page systems", () => {
  const merged = mergeInspectionReportExtracts([
    normalizeInspectionReportExtract({
      propertyAddress: { street: "563 Springdale Cir" },
      items: [{
        category: "electrical_panel",
        identifiedItem: { type: "Main electrical panel" },
        overallConfidence: 80,
      }],
    }),
    normalizeInspectionReportExtract({
      items: [
        { category: "hvac", identifiedItem: { type: "Central AC/heat system" }, overallConfidence: 80 },
        { category: "plumbing", identifiedItem: { type: "Plumbing system" }, overallConfidence: 70 },
      ],
    }),
    normalizeInspectionReportExtract({
      items: [
        { category: "roof", identifiedItem: { type: "Predominant roof - reinforced concrete" }, overallConfidence: 85 },
        { category: "roof", identifiedItem: { type: "Secondary roof - fiberglass shingle" }, overallConfidence: 85 },
      ],
    }),
  ])
  assertEquals(merged.propertyAddress.street, "563 Springdale Cir")
  assertEquals(
    merged.items.map((item) => `${item.category}:${item.identifiedItem.type}`).join("|"),
    "electrical_panel:Main electrical panel|hvac:Central AC/heat system|plumbing:Plumbing system|roof:Predominant roof - reinforced concrete|roof:Secondary roof - fiberglass shingle",
  )
})

Deno.test("mergeInspectionReportExtracts collapses duplicate roof wordings to two coverings", () => {
  const merged = mergeInspectionReportExtracts([
    normalizeInspectionReportExtract({
      items: [{ category: "roof", identifiedItem: { type: "Roof" }, overallConfidence: 40 }],
    }),
    normalizeInspectionReportExtract({
      items: [{ category: "roof", identifiedItem: { type: "Roof covering" }, overallConfidence: 50 }],
    }),
    normalizeInspectionReportExtract({
      items: [{
        category: "roof",
        identifiedItem: { type: "Predominant roof - reinforced concrete" },
        overallConfidence: 90,
      }],
    }),
    normalizeInspectionReportExtract({
      items: [{ category: "roof", identifiedItem: { type: "Roof inspection" }, overallConfidence: 45 }],
    }),
    normalizeInspectionReportExtract({
      items: [{
        category: "roof",
        identifiedItem: { type: "Secondary roof - fiberglass shingle" },
        overallConfidence: 88,
      }],
    }),
  ])
  assertEquals(merged.items.length, 2)
  assertEquals(merged.items[0]?.identifiedItem.type, "Predominant roof - reinforced concrete")
  assertEquals(merged.items[1]?.identifiedItem.type, "Secondary roof - fiberglass shingle")
})
