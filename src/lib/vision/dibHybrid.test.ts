import { describe, expect, it } from "vitest"
import {
  buildHybridVisionProviderLabel,
  mapDibCategoryToVisionCategory,
  mergeDibIdentificationWithVisionAssessment,
  parseDibSmartAddResponse,
} from "@shared/vision/dibHybrid"
import type { ApplianceVisionResult } from "@shared/vision/types"

const baseVision: ApplianceVisionResult = {
  category: "unknown",
  identifiedItem: { type: "Unknown appliance" },
  estimatedAge: { value: 8, confidence: "medium", basis: "Visual wear" },
  condition: { rating: "fair", summary: "Moderate wear visible." },
  deficiencies: [{ description: "Rust on base", severity: "monitor" }],
  maintenanceRecommendations: [{ action: "Inspect annually", urgency: "routine" }],
  rawConfidenceNotes: "Vision-only note.",
}

describe("mapDibCategoryToVisionCategory", () => {
  it("maps common Dib labels", () => {
    expect(mapDibCategoryToVisionCategory("Appliances", null, "Dishwasher")).toBe("appliance")
    expect(mapDibCategoryToVisionCategory("HVAC", "Furnace", null)).toBe("hvac")
    expect(mapDibCategoryToVisionCategory(null, null, "Tankless water heater")).toBe(
      "water_heater",
    )
    expect(mapDibCategoryToVisionCategory("Systems", "Boiler", null)).toBe("boiler")
  })
})

describe("parseDibSmartAddResponse", () => {
  it("picks the highest-confidence candidate above threshold", () => {
    const parsed = parseDibSmartAddResponse(
      {
        data: {
          candidates: [
            {
              confidence: 62,
              item: {
                name: "Range",
                brand: "GE",
                model: "JGBS30",
                category: "Appliances",
              },
            },
            {
              confidence: 88,
              item: {
                id: "11111111-1111-1111-1111-111111111111",
                name: "Refrigerator",
                brand: "Samsung",
                model: "RF28R",
                serial_number: "SN123",
                category: "Appliances",
              },
            },
          ],
        },
      },
      75,
    )

    expect(parsed?.type).toBe("Refrigerator")
    expect(parsed?.brand).toBe("Samsung")
    expect(parsed?.modelNumber).toBe("RF28R")
    expect(parsed?.serialNumber).toBe("SN123")
    expect(parsed?.category).toBe("appliance")
    expect(parsed?.confidence).toBeCloseTo(0.88)
  })

  it("returns null when no candidate meets threshold", () => {
    const parsed = parseDibSmartAddResponse(
      {
        data: {
          items: [{ name: "Microwave", brand: "Panasonic", confidence_score: 0.4 }],
        },
      },
      75,
    )
    expect(parsed).toBeNull()
  })
})

describe("mergeDibIdentificationWithVisionAssessment", () => {
  it("keeps vision condition data while overriding identification", () => {
    const merged = mergeDibIdentificationWithVisionAssessment(
      {
        category: "appliance",
        type: "Samsung Refrigerator",
        brand: "Samsung",
        modelNumber: "RF28R",
        serialNumber: "SN123",
        confidence: 0.88,
      },
      baseVision,
    )

    expect(merged.identifiedItem.brand).toBe("Samsung")
    expect(merged.identifiedItem.modelNumber).toBe("RF28R")
    expect(merged.category).toBe("appliance")
    expect(merged.condition.rating).toBe("fair")
    expect(merged.deficiencies).toHaveLength(1)
    expect(merged.rawConfidenceNotes).toContain("Dib identification")
  })
})

describe("buildHybridVisionProviderLabel", () => {
  it("prefixes dib to the active vision provider", () => {
    expect(buildHybridVisionProviderLabel("gpt4o")).toBe("dib+gpt4o")
  })
})
