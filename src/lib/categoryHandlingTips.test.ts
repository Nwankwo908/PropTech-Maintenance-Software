import { describe, expect, it } from "vitest"
import {
  categoryLabelForSms,
  resolveCategoryHandlingTip,
} from "../../shared/maintenance/categoryHandlingTips"

describe("resolveCategoryHandlingTip", () => {
  it("recommends shutoff for active plumbing overflow", () => {
    const tip = resolveCategoryHandlingTip({
      primaryCategory: "plumbing",
      text: "My toilet is clogged",
      diagnosticFacts: { toilet_overflow: "Yes" },
    })
    expect(tip).toMatch(/shutoff/i)
    expect(tip).toMatch(/Until help arrives/i)
  })

  it("recommends not flushing for clogged drains", () => {
    const tip = resolveCategoryHandlingTip({
      issueType: "plumbing",
      text: "Kitchen sink is clogged",
    })
    expect(tip).toMatch(/don't keep flushing|drain cleaner/i)
  })

  it("recommends thermostat check for HVAC", () => {
    const tip = resolveCategoryHandlingTip({
      primaryCategory: "hvac",
      text: "No heat in bedroom",
    })
    expect(tip).toMatch(/thermostat/i)
  })

  it("warns not to touch outlets for electrical", () => {
    const tip = resolveCategoryHandlingTip({
      primaryCategory: "electrical",
      text: "Outlet sparking",
    })
    expect(tip).toMatch(/don't touch|leave that area/i)
  })

  it("labels categories for SMS", () => {
    expect(categoryLabelForSms({ primaryCategory: "plumbing" })).toBe("plumbing")
    expect(categoryLabelForSms({ primaryCategory: "hvac" })).toBe("HVAC")
    expect(categoryLabelForSms({ text: "Stove not working" })).toBe("appliance")
  })
})
