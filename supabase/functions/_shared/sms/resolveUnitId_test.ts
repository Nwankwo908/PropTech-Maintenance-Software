import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  normalizeUnitLabelForMatch,
  pickUnitIdFromInventoryRows,
} from "./resolveUnitId.ts"

Deno.test("normalizeUnitLabelForMatch strips unit prefixes", () => {
  assertEquals(normalizeUnitLabelForMatch("Unit #1A"), "1a")
  assertEquals(normalizeUnitLabelForMatch("Apt 2"), "2")
  assertEquals(normalizeUnitLabelForMatch("  3  "), "3")
})

const inventory = [
  { id: "ellerslie-3110", unit_label: "1", building: "3110 Ellerslie Ave", property_id: "prop-3110" },
  { id: "avon-3222", unit_label: "1", building: "3222 Avon Ave", property_id: "prop-avon" },
  { id: "unique-2b", unit_label: "2B", building: "3222 Avon Ave", property_id: "prop-avon" },
]

Deno.test("pickUnitIdFromInventoryRows fails closed on bare repeating label", () => {
  assertEquals(
    pickUnitIdFromInventoryRows(inventory, { unitLabel: "1" }),
    null,
  )
})

Deno.test("pickUnitIdFromInventoryRows uses building when labels collide", () => {
  assertEquals(
    pickUnitIdFromInventoryRows(inventory, {
      unitLabel: "1",
      building: "3222 Avon Ave",
    }),
    "avon-3222",
  )
})

Deno.test("pickUnitIdFromInventoryRows uses property_id when provided", () => {
  assertEquals(
    pickUnitIdFromInventoryRows(inventory, {
      unitLabel: "1",
      propertyId: "prop-3110",
    }),
    "ellerslie-3110",
  )
})

Deno.test("pickUnitIdFromInventoryRows allows unique labels without building", () => {
  assertEquals(
    pickUnitIdFromInventoryRows(inventory, { unitLabel: "2B" }),
    "unique-2b",
  )
})
