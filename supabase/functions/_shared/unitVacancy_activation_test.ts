/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { pickCanonicalUnitForResident, type UnitRow } from "./unitVacancy.ts"

function unit(
  id: string,
  label: string,
  building: string,
  status = "inactive",
): UnitRow {
  return {
    id,
    landlord_id: "ll-1",
    unit_label: label,
    building,
    status,
    skip_tenant_registration: false,
    property_id: "prop-1",
  }
}

const units = [
  unit("u-oak", "1A", "Oak Apartments"),
  unit("u-maple-2", "Unit 2", "78 Maple Ave"),
  unit("u-grove", "A", "109 S Grove St"),
]

Deno.test("occupancy unit id wins over a mismatched label", () => {
  const picked = pickCanonicalUnitForResident(units, {
    unit: "1A",
    building: "Oak Apartments",
    occupancyUnitId: "u-maple-2",
  })
  assertEquals(picked?.id, "u-maple-2")
})

Deno.test("SMS identity unit id is used when occupancy is missing", () => {
  const picked = pickCanonicalUnitForResident(units, {
    unit: "A",
    building: "Wrong Building",
    identityUnitId: "u-grove",
  })
  assertEquals(picked?.id, "u-grove")
})

Deno.test("label match still works when no canonical id is present", () => {
  const picked = pickCanonicalUnitForResident(units, {
    unit: "2",
    building: "78 Maple Ave",
  })
  assertEquals(picked?.id, "u-maple-2")
})

Deno.test("does not create or invent a unit when nothing matches", () => {
  const picked = pickCanonicalUnitForResident(units, {
    unit: "9Z",
    building: "Oak Apartments",
  })
  assertEquals(picked, undefined)
})
