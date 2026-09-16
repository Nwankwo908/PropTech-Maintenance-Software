/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { inspectionReportItemEligibleForAutoConfirm } from "./inspectionReportAutoConfirm.ts"
import type { ApplianceVisionResult } from "./types.ts"

function item(partial: Partial<ApplianceVisionResult> & {
  identifiedItem?: ApplianceVisionResult["identifiedItem"]
}): ApplianceVisionResult {
  return {
    category: "hvac",
    identifiedItem: { type: "Central AC/heat system", ...partial.identifiedItem },
    estimatedAge: { value: 9, confidence: "medium", basis: "inspector" },
    condition: { rating: "good", summary: "Satisfactory" },
    deficiencies: [],
    maintenanceRecommendations: [],
    overallConfidence: 80,
    ...partial,
  }
}

Deno.test("auto-confirm skips blank type", () => {
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      identifiedItem: { type: "   " },
      overallConfidence: 90,
    })),
    false,
  )
})

Deno.test("auto-confirm skips Unknown item / Inspection report placeholders", () => {
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      identifiedItem: { type: "Unknown item" },
      overallConfidence: 90,
    })),
    false,
  )
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      identifiedItem: { type: "Inspection report" },
      overallConfidence: 90,
    })),
    false,
  )
})

Deno.test("auto-confirm persists named plumbing with reported condition even without age", () => {
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      category: "plumbing",
      identifiedItem: { type: "Plumbing system" },
      estimatedAge: { value: null, confidence: "low", basis: "Not specified" },
      condition: { rating: "good", summary: "Satisfactory" },
      overallConfidence: 0,
    })),
    true,
  )
})

Deno.test("auto-confirm skips blank sections with confidence 0 and no age/brand", () => {
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      category: "plumbing",
      identifiedItem: { type: "Plumbing" },
      estimatedAge: { value: null, confidence: "low", basis: "Not specified" },
      condition: { rating: "fair", summary: "" },
      overallConfidence: 0,
    })),
    false,
  )
})

Deno.test("auto-confirm allows a named finding even when confidence is below 50", () => {
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      estimatedAge: { value: 9, confidence: "medium", basis: "inspector" },
      overallConfidence: 49,
    })),
    true,
  )
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      identifiedItem: { type: "Main electrical panel", brand: "Square D" },
      estimatedAge: { value: 15, confidence: "low", basis: "inspector" },
      overallConfidence: 0,
    })),
    true,
  )
})

Deno.test("auto-confirm allows inferred 40 from missing overallConfidence", () => {
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      identifiedItem: { type: "Main electrical panel", brand: "Square D" },
      estimatedAge: { value: 15, confidence: "low", basis: "Not specified" },
      overallConfidence: 40,
    })),
    true,
  )
})

Deno.test("auto-confirm keeps Okafor panel when age is moderately uncertain (65)", () => {
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      category: "electrical_panel",
      identifiedItem: { type: "Main electrical panel", brand: "Square D" },
      estimatedAge: { value: 15, confidence: "medium", basis: "Panel age: 15" },
      overallConfidence: 65,
    })),
    true,
  )
})

Deno.test("auto-confirm allows Okafor-shaped findings at or above 50", () => {
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      category: "electrical_panel",
      identifiedItem: { type: "Main electrical panel", brand: "Square D" },
      overallConfidence: 85,
    })),
    true,
  )
  assertEquals(
    inspectionReportItemEligibleForAutoConfirm(item({
      category: "water_heater",
      identifiedItem: { type: "Water heater" },
      overallConfidence: 55,
    })),
    true,
  )
})
