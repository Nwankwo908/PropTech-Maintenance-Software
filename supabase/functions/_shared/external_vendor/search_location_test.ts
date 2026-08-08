/// <reference lib="deno.ns" />

import {
  formatVendorSetupLocationLabel,
  resolveExternalVendorSearchContext,
} from "./search_location.ts"

function mockSupabaseWithProperty(): { from: (table: string) => unknown } {
  return {
    from(table: string) {
      if (table === "landlord_onboarding") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null }),
            }),
          }),
        }
      }
      if (table === "properties") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "prop-1",
                        name: "Maple Heights",
                        street_address: "901 Maple Heights Blvd",
                        city: "Hillsboro",
                        state: "OR",
                        zip_code: "97124",
                        property_type: "multifamily",
                        year_built: null,
                        unit_count: null,
                        latitude: null,
                        longitude: null,
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

Deno.test("formatVendorSetupLocationLabel combines building and unit", () => {
  const label = formatVendorSetupLocationLabel("Unit 304", "Maple Heights")
  if (label !== "Maple Heights · Unit 304") {
    throw new Error(`unexpected label: ${label}`)
  }
})

Deno.test("resolveExternalVendorSearchContext uses properties table address", async () => {
  const result = await resolveExternalVendorSearchContext(
    mockSupabaseWithProperty() as never,
    {
      unit: "Unit 207",
      building: "Maple Heights",
      landlordId: "landlord-1",
    },
  )
  if (!result.searchLocation.includes("Hillsboro")) {
    throw new Error(`expected Hillsboro address, got ${result.searchLocation}`)
  }
  if (result.locationLabel !== "Maple Heights · Unit 207") {
    throw new Error(`unexpected location label: ${result.locationLabel}`)
  }
})

Deno.test("resolveExternalVendorSearchContext falls back to building name without landlord", async () => {
  const result = await resolveExternalVendorSearchContext(
    { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) } as never,
    {
      unit: "Unit 207",
      building: "Maple Heights",
      landlordId: null,
    },
  )
  if (result.searchLocation !== "Maple Heights") {
    throw new Error(`expected building name fallback, got ${result.searchLocation}`)
  }
})
