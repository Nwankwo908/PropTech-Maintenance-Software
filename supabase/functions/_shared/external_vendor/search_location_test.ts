/// <reference lib="deno.ns" />

import {
  formatVendorSetupLocationLabel,
  resolveExternalVendorSearchContext,
} from "./search_location.ts"

Deno.test("formatVendorSetupLocationLabel combines building and unit", () => {
  const label = formatVendorSetupLocationLabel("Unit 304", "Maple Heights")
  if (label !== "Maple Heights · Unit 304") {
    throw new Error(`unexpected label: ${label}`)
  }
})

Deno.test("resolveExternalVendorSearchContext uses demo building address", async () => {
  const result = await resolveExternalVendorSearchContext(
    { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) } as never,
    {
      unit: "Unit 207",
      building: "Maple Heights",
      landlordId: null,
    },
  )
  if (!result.searchLocation.includes("Hillsboro")) {
    throw new Error(`expected Hillsboro address, got ${result.searchLocation}`)
  }
  if (result.locationLabel !== "Maple Heights · Unit 207") {
    throw new Error(`unexpected location label: ${result.locationLabel}`)
  }
})
