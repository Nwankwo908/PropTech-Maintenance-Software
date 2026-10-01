/**
 * Contracts for maintenance_unit_label_match + enriched unit resolution.
 * Mirrors the SQL in 20260930210000_fix_maintenance_enriched_null_unit_match.sql.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"

/** Pure mirror of the null/blank guard on maintenance_unit_label_match. */
export function maintenanceUnitLabelMatchGuard(
  mrUnit: string | null | undefined,
  unitLabel: string | null | undefined,
): boolean | "delegate" {
  if (mrUnit == null || !String(mrUnit).trim()) return false
  if (unitLabel == null || !String(unitLabel).trim()) return false
  return "delegate"
}

/**
 * Pure mirror of enriched unit resolution:
 * - prefer ticket.unit_id when it belongs to the same landlord
 * - else unique landlord-scoped label match (optional building hint filter)
 * - never created_at tiebreak; ambiguous → unresolved
 */
export function resolveEnrichedUnit(input: {
  ticketLandlordId: string
  ticketUnitId: string | null
  ticketUnitLabel: string | null
  ticketPropertyId: string | null
  units: Array<{
    id: string
    landlordId: string
    unitLabel: string
    building: string | null
    propertyId: string | null
  }>
  labelMatch: (mrUnit: string, unitLabel: string) => boolean
}): {
  unitId: string | null
  building: string | null
  propertyId: string | null
  landlordId: string
} {
  const landlordId = input.ticketLandlordId

  if (input.ticketUnitId) {
    const byId = input.units.find(
      (u) => u.id === input.ticketUnitId && u.landlordId === landlordId,
    )
    if (byId) {
      return {
        unitId: byId.id,
        building: byId.building,
        propertyId: input.ticketPropertyId ?? byId.propertyId,
        landlordId,
      }
    }
  }

  const label = input.ticketUnitLabel?.trim() || null
  if (!label) {
    return {
      unitId: null,
      building: null,
      propertyId: input.ticketPropertyId,
      landlordId,
    }
  }

  const candidates = input.units.filter(
    (u) =>
      u.landlordId === landlordId && input.labelMatch(label, u.unitLabel),
  )
  const hinted = candidates.filter(
    (u) =>
      u.building != null &&
      label.toLowerCase().includes(u.building.trim().toLowerCase()),
  )
  const pool = hinted.length > 0 ? hinted : candidates
  if (pool.length !== 1) {
    return {
      unitId: null,
      building: null,
      propertyId: input.ticketPropertyId,
      landlordId,
    }
  }
  const only = pool[0]!
  return {
    unitId: only.id,
    building: only.building,
    propertyId: input.ticketPropertyId ?? only.propertyId,
    landlordId,
  }
}

const LANDLORD_A = "landlord-a"
const LANDLORD_B = "landlord-b"
const BARTLETT_UNIT = "unit-bartlett-1"
const BAY_UNIT_B = "unit-bay-b"
const BARTLETT_PROP = "prop-bartlett"
const BAY_PROP = "prop-bay"

const portfolio = [
  {
    id: BARTLETT_UNIT,
    landlordId: LANDLORD_A,
    unitLabel: "1",
    building: "646 Bartlett",
    propertyId: BARTLETT_PROP,
  },
  {
    id: BAY_UNIT_B,
    landlordId: LANDLORD_A,
    unitLabel: "B",
    building: "3804 W Bay Avenue",
    propertyId: BAY_PROP,
  },
  {
    id: "unit-other-landlord",
    landlordId: LANDLORD_B,
    unitLabel: "B",
    building: "999 Other St",
    propertyId: "prop-other",
  },
  {
    id: "unit-maple-1",
    landlordId: LANDLORD_A,
    unitLabel: "1",
    building: "78 Maple Ave",
    propertyId: "prop-maple",
  },
  {
    id: "unit-birch-402",
    landlordId: LANDLORD_A,
    unitLabel: "402",
    building: "Birch Tower",
    propertyId: "prop-birch",
  },
  {
    id: "unit-maple-402",
    landlordId: LANDLORD_A,
    unitLabel: "402",
    building: "Maple Heights",
    propertyId: "prop-maple-402",
  },
]

/** Mirrors SQL: full normalize equality, or all-digits extract equals label normalize. */
function simpleLabelMatch(mrUnit: string, unitLabel: string): boolean {
  if (maintenanceUnitLabelMatchGuard(mrUnit, unitLabel) === false) return false
  const norm = (s: string) =>
    s.toLowerCase().replace(/#|unit|apt/g, "").replace(/[^a-z0-9]/g, "")
  const digits = (s: string) => {
    const d = s.toLowerCase().replace(/#|unit|apt/g, "").replace(/[^0-9]/g, "")
    return d || null
  }
  const labelN = norm(unitLabel)
  if (!labelN) return false
  return labelN === norm(mrUnit) || labelN === digits(mrUnit)
}

Deno.test("maintenance_unit_label_match: null ticket unit → false for any label", () => {
  for (const label of ["B", "1", "A", "402", "anything"]) {
    assertEquals(maintenanceUnitLabelMatchGuard(null, label), false)
    assertEquals(maintenanceUnitLabelMatchGuard("", label), false)
    assertEquals(maintenanceUnitLabelMatchGuard("   ", label), false)
  }
})

Deno.test("enriched: null unit label without unit_id → unresolved (not Bay Unit B)", () => {
  const resolved = resolveEnrichedUnit({
    ticketLandlordId: LANDLORD_A,
    ticketUnitId: null,
    ticketUnitLabel: null,
    ticketPropertyId: BARTLETT_PROP,
    units: portfolio,
    labelMatch: simpleLabelMatch,
  })
  assertEquals(resolved.unitId, null)
  assertEquals(resolved.building, null)
  // Stored property_id retained; never invent Bay from a null-unit join.
  assertEquals(resolved.propertyId, BARTLETT_PROP)
  assertEquals(resolved.landlordId, LANDLORD_A)
})

Deno.test("enriched: stored unit_id resolves even when unit label is null (HQS path)", () => {
  const resolved = resolveEnrichedUnit({
    ticketLandlordId: LANDLORD_A,
    ticketUnitId: BARTLETT_UNIT,
    ticketUnitLabel: null,
    ticketPropertyId: BARTLETT_PROP,
    units: portfolio,
    labelMatch: simpleLabelMatch,
  })
  assertEquals(resolved.unitId, BARTLETT_UNIT)
  assertEquals(resolved.building, "646 Bartlett")
  assertEquals(resolved.propertyId, BARTLETT_PROP)
})

Deno.test("enriched: never returns another landlord's property under null-unit multi-candidate", () => {
  const resolved = resolveEnrichedUnit({
    ticketLandlordId: LANDLORD_A,
    ticketUnitId: null,
    ticketUnitLabel: null,
    ticketPropertyId: null,
    units: portfolio,
    labelMatch: () => true, // forced match-all (would include other landlord if unscoped)
  })
  assertEquals(resolved.unitId, null)
  assertEquals(resolved.building, null)
  assertEquals(resolved.propertyId, null)
  assertEquals(resolved.landlordId, LANDLORD_A)
})

Deno.test("enriched: ambiguous label '1' across buildings → unresolved (no created_at pick)", () => {
  const resolved = resolveEnrichedUnit({
    ticketLandlordId: LANDLORD_A,
    ticketUnitId: null,
    ticketUnitLabel: "1",
    ticketPropertyId: null,
    units: portfolio,
    labelMatch: simpleLabelMatch,
  })
  assertEquals(resolved.unitId, null)
  assertEquals(resolved.building, null)
  assertEquals(resolved.propertyId, null)
})

Deno.test("enriched: unique label still resolves (non-null regression)", () => {
  const resolved = resolveEnrichedUnit({
    ticketLandlordId: LANDLORD_A,
    ticketUnitId: null,
    ticketUnitLabel: "B",
    ticketPropertyId: null,
    units: portfolio,
    labelMatch: simpleLabelMatch,
  })
  assertEquals(resolved.unitId, BAY_UNIT_B)
  assertEquals(resolved.building, "3804 W Bay Avenue")
  assertEquals(resolved.propertyId, BAY_PROP)
  assertEquals(resolved.landlordId, LANDLORD_A)
})

Deno.test("normalize guard: uppercase letter labels are not empty-equal to null", () => {
  // Mirrors the prod bug: normalize used to strip A–Z before lower(), so
  // normalize('B') === normalize(null) === '' → false-positive match.
  const lowerFirst = (label: string | null) => {
    if (label == null || !String(label).trim()) return ""
    return String(label)
      .trim()
      .toLowerCase()
      .replace(/#|unit|apt/g, "")
      .replace(/[^a-z0-9]/g, "")
  }
  assertEquals(lowerFirst(null), "")
  assertEquals(lowerFirst("B"), "b")
  assertEquals(lowerFirst("B") === lowerFirst(null), false)
  assertEquals(maintenanceUnitLabelMatchGuard(null, "B"), false)
})

Deno.test("enriched: building-prefixed label uniquely resolves among duplicate labels", () => {
  // "Birch Tower · 402" digit-extracts to 402; building hint picks Birch over Maple.
  const resolved = resolveEnrichedUnit({
    ticketLandlordId: LANDLORD_A,
    ticketUnitId: null,
    ticketUnitLabel: "Birch Tower · 402",
    ticketPropertyId: null,
    units: portfolio,
    labelMatch: simpleLabelMatch,
  })
  assertEquals(resolved.unitId, "unit-birch-402")
  assertEquals(resolved.building, "Birch Tower")
})
