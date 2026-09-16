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

const panel = {
  id: "asset-panel",
  appliance_type: "Main Panel",
  brand: "Square D",
  model: null as string | null,
  metadata: {
    photoId: "report-1",
    registryAssetType: "electrical_panel",
    slotKey: "electrical_panel",
  },
}

const hvac = {
  id: "asset-hvac",
  appliance_type: "Central AC/heat system",
  brand: null as string | null,
  model: null as string | null,
  metadata: {
    photoId: "report-1",
    registryAssetType: "hvac",
    slotKey: "hvac",
  },
}

Deno.test("report findings on the same photo keep separate assets", () => {
  assertEquals(
    findReusableInspectionUnitAsset([panel], {
      photoId: "report-1",
      itemType: "Central AC/heat system",
      brand: null,
      model: null,
      serial: null,
      slotKey: "hvac",
      distinctFindingsPerPhoto: true,
    }),
    null,
  )
})

Deno.test("reuses the matching finding on a multi-item report photo", () => {
  assertEquals(
    findReusableInspectionUnitAsset([panel, hvac], {
      photoId: "report-1",
      itemType: "Central AC/heat system",
      brand: null,
      model: null,
      serial: null,
      slotKey: "hvac",
      distinctFindingsPerPhoto: true,
    })?.id,
    "asset-hvac",
  )
})

Deno.test("two roofs on one report stay separate", () => {
  const roofA = {
    id: "roof-a",
    appliance_type: "Predominant roof - reinforced concrete",
    brand: null as string | null,
    model: null as string | null,
    metadata: { photoId: "report-1", registryAssetType: "roof", slotKey: "roof" },
  }
  assertEquals(
    findReusableInspectionUnitAsset([roofA], {
      photoId: "report-1",
      itemType: "Secondary roof - fiberglass shingle",
      brand: null,
      model: null,
      serial: null,
      slotKey: "roof",
      distinctFindingsPerPhoto: true,
    }),
    null,
  )
})

Deno.test("generic roof wording reuses the predominant covering", () => {
  const roofA = {
    id: "roof-a",
    appliance_type: "Predominant roof - reinforced concrete",
    brand: null as string | null,
    model: null as string | null,
    metadata: { photoId: "report-1", registryAssetType: "roof", slotKey: "roof" },
  }
  assertEquals(
    findReusableInspectionUnitAsset([roofA], {
      photoId: "report-2",
      itemType: "Roof",
      brand: null,
      model: null,
      serial: null,
      slotKey: "roof",
      distinctFindingsPerPhoto: true,
    })?.id,
    "roof-a",
  )
})
