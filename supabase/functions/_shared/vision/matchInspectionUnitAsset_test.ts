/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { findReusableInspectionUnitAsset } from "./matchInspectionUnitAsset.ts"

const fridge = {
  id: "asset-1",
  appliance_type: "Refrigerator",
  brand: "GE",
  model: "GTS18",
  metadata: { photoId: "photo-a", serialNumber: "SN-1", registryAssetType: "appliance" },
}

const stove = {
  id: "asset-2",
  appliance_type: "Range",
  brand: "GE",
  model: "JB735",
  metadata: { photoId: "photo-b", registryAssetType: "appliance", applianceSubtype: "stove" },
}

Deno.test("does not reuse a slot just because both rows are appliances", () => {
  assertEquals(
    findReusableInspectionUnitAsset([fridge], {
      photoId: "photo-b",
      itemType: "Range",
      brand: "GE",
      model: "JB735",
      serial: null,
    }),
    null,
  )
})

Deno.test("reuses the row for the same inspection photo", () => {
  assertEquals(
    findReusableInspectionUnitAsset([fridge, stove], {
      photoId: "photo-a",
      itemType: "Refrigerator",
      brand: "GE",
      model: "GTS18",
      serial: null,
    })?.id,
    "asset-1",
  )
})

Deno.test("reuses when type, brand, and model all match", () => {
  assertEquals(
    findReusableInspectionUnitAsset([fridge], {
      photoId: "photo-new",
      itemType: "Refrigerator",
      brand: "GE",
      model: "GTS18",
      serial: null,
    })?.id,
    "asset-1",
  )
})
