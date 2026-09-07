/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isVendorPropertyUnitJobHistoryRow,
  selectVendorPropertyUnitJobHistory,
} from "./vendorJobPropertyHistory.ts"

const scope = {
  ticketId: "ticket-now",
  vendorId: "vendor-a",
  propertyId: "prop-1",
  unitId: "unit-4b",
  unitLabel: "4B",
}

Deno.test("vendor job history excludes other properties, units, and vendors", () => {
  const rows = [
    {
      id: "other-vendor",
      assigned_vendor_id: "vendor-b",
      property_id: "prop-1",
      unit_id: "unit-4b",
      unit: "4B",
      vendor_work_status: "completed",
    },
    {
      id: "other-unit",
      assigned_vendor_id: "vendor-a",
      property_id: "prop-1",
      unit_id: "unit-2a",
      unit: "2A",
      vendor_work_status: "completed",
    },
    {
      id: "other-property",
      assigned_vendor_id: "vendor-a",
      property_id: "prop-2",
      unit_id: "unit-4b",
      unit: "4B",
      vendor_work_status: "completed",
    },
    {
      id: "same-context",
      assigned_vendor_id: "vendor-a",
      property_id: "prop-1",
      unit_id: "unit-4b",
      unit: "4B",
      vendor_work_status: "completed",
    },
    {
      id: "ticket-now",
      assigned_vendor_id: "vendor-a",
      property_id: "prop-1",
      unit_id: "unit-4b",
      unit: "4B",
      vendor_work_status: "in_progress",
    },
  ]

  assertEquals(
    selectVendorPropertyUnitJobHistory(scope, rows).map((row) => row.id),
    ["same-context"],
  )
})

Deno.test("vendor job history matches unit labels when unit ids are missing", () => {
  assertEquals(
    isVendorPropertyUnitJobHistoryRow(
      { ...scope, unitId: null },
      {
        id: "past",
        assigned_vendor_id: "vendor-a",
        property_id: "prop-1",
        unit: "Unit 4B",
        vendor_work_status: "completed",
      },
    ),
    true,
  )
})

Deno.test("vendor job history is empty without an assigned vendor", () => {
  assertEquals(
    selectVendorPropertyUnitJobHistory({ ...scope, vendorId: null }, [
      {
        id: "past",
        assigned_vendor_id: "vendor-a",
        property_id: "prop-1",
        unit_id: "unit-4b",
        unit: "4B",
        vendor_work_status: "completed",
      },
    ]),
    [],
  )
})
