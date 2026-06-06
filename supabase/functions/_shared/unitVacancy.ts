import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { resolveLandlordId } from "./sms/landlordSmsOnboarding.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import {
  lookupSmsIdentity,
  normalizeSmsPhone,
  upsertSmsIdentity,
} from "./sms/inbound_db.ts"

export type UnitRow = {
  id: string
  landlord_id: string
  unit_label: string
  building: string | null
  status: string
  skip_tenant_registration: boolean
}

const OCCUPIES_UNIT_STATUSES = ["active", "pending", "suspended"] as const

export async function ensureUnitRow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitLabel: string
    building?: string | null
    status?: "vacant" | "active" | "inactive"
  },
): Promise<UnitRow> {
  const unitLabel = params.unitLabel.trim()
  const building = params.building?.trim() || null
  if (!unitLabel) throw new Error("unitLabel is required")

  let existingQuery = supabase
    .from("units")
    .select("id, landlord_id, unit_label, building, status, skip_tenant_registration")
    .eq("landlord_id", params.landlordId)
    .eq("unit_label", unitLabel)

  existingQuery = building
    ? existingQuery.eq("building", building)
    : existingQuery.is("building", null)

  const { data: existing } = await existingQuery.maybeSingle()

  if (existing?.id) {
    return existing as UnitRow
  }

  const { data: created, error } = await supabase
    .from("units")
    .insert({
      landlord_id: params.landlordId,
      unit_label: unitLabel,
      building,
      status: params.status ?? "inactive",
    })
    .select("id, landlord_id, unit_label, building, status, skip_tenant_registration")
    .single()

  if (error || !created?.id) {
    console.error("[unitVacancy] ensure unit insert", error?.message)
    throw new Error("Failed to create unit row")
  }

  return created as UnitRow
}

export async function resolveUnitByIdOrLabel(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitId?: string | null
    unitLabel?: string | null
    building?: string | null
  },
): Promise<UnitRow | null> {
  if (params.unitId?.trim()) {
    const { data } = await supabase
      .from("units")
      .select("id, landlord_id, unit_label, building, status, skip_tenant_registration")
      .eq("id", params.unitId.trim())
      .eq("landlord_id", params.landlordId)
      .maybeSingle()
    return (data as UnitRow | null) ?? null
  }

  const unitLabel = params.unitLabel?.trim()
  if (!unitLabel) return null

  const building = params.building?.trim() || null
  let query = supabase
    .from("units")
    .select("id, landlord_id, unit_label, building, status, skip_tenant_registration")
    .eq("landlord_id", params.landlordId)
    .eq("unit_label", unitLabel)

  query = building ? query.eq("building", building) : query.is("building", null)

  const { data } = await query.maybeSingle()

  return (data as UnitRow | null) ?? null
}

async function findOccupantsForUnit(
  supabase: SupabaseClient,
  unit: UnitRow,
): Promise<Array<{ id: string; phone: string | null; status: string }>> {
  let query = supabase
    .from("users")
    .select("id, phone, status, unit, building")
    .eq("unit", unit.unit_label)

  if (unit.building) {
    query = query.eq("building", unit.building)
  } else {
    query = query.is("building", null)
  }

  const { data, error } = await query
  if (error) {
    console.error("[unitVacancy] occupants lookup", error.message)
    return []
  }

  return (data ?? [])
    .filter((row) =>
      OCCUPIES_UNIT_STATUSES.includes(
        String(row.status ?? "") as (typeof OCCUPIES_UNIT_STATUSES)[number],
      )
    )
    .map((row) => ({
      id: row.id as string,
      phone: (row.phone as string | null) ?? null,
      status: String(row.status ?? ""),
    }))
}

async function endActiveOccupancy(
  supabase: SupabaseClient,
  unitId: string,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("occupancy")
    .update({ status: "ended", move_out_date: today })
    .eq("unit_id", unitId)
    .eq("status", "active")
    .select("id")

  if (error) {
    console.error("[unitVacancy] end occupancy", error.message)
    throw new Error("Failed to end active occupancy")
  }

  return data?.length ?? 0
}

async function deregisterTenantSmsIdentities(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitId: string
    residentIds: string[]
  },
): Promise<number> {
  let count = 0

  const { data: byUnit, error: unitErr } = await supabase
    .from("sms_identities")
    .update({
      identity_type: "unknown",
      resident_id: null,
      vendor_id: null,
      unit_id: null,
      verified: false,
      last_seen_at: new Date().toISOString(),
    })
    .eq("landlord_id", params.landlordId)
    .eq("unit_id", params.unitId)
    .select("id")

  if (unitErr) {
    console.error("[unitVacancy] deregister by unit_id", unitErr.message)
  } else {
    count += byUnit?.length ?? 0
  }

  if (params.residentIds.length > 0) {
    const { data: byResident, error: resErr } = await supabase
      .from("sms_identities")
      .update({
        identity_type: "unknown",
        resident_id: null,
        vendor_id: null,
        unit_id: null,
        verified: false,
        last_seen_at: new Date().toISOString(),
      })
      .eq("landlord_id", params.landlordId)
      .in("resident_id", params.residentIds)
      .select("id")

    if (resErr) {
      console.error("[unitVacancy] deregister by resident_id", resErr.message)
    } else {
      count += byResident?.length ?? 0
    }
  }

  return count
}

async function archiveResidentSmsConversations(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitId: string
    residentIds: string[]
  },
): Promise<number> {
  const now = new Date().toISOString()
  let count = 0

  const { data: byUnit, error: unitErr } = await supabase
    .from("sms_conversations")
    .update({ status: "archived", updated_at: now })
    .eq("landlord_id", params.landlordId)
    .eq("unit_id", params.unitId)
    .eq("status", "open")
    .select("id")

  if (unitErr) {
    console.error("[unitVacancy] archive convos by unit", unitErr.message)
  } else {
    count += byUnit?.length ?? 0
  }

  if (params.residentIds.length > 0) {
    const { data: byResident, error: resErr } = await supabase
      .from("sms_conversations")
      .update({ status: "archived", updated_at: now })
      .eq("landlord_id", params.landlordId)
      .in("resident_id", params.residentIds)
      .in("conversation_type", ["resident_intake", "vendor_tenant_proxy"])
      .eq("status", "open")
      .select("id")

    if (resErr) {
      console.error("[unitVacancy] archive convos by resident", resErr.message)
    } else {
      count += byResident?.length ?? 0
    }
  }

  return count
}

async function markOccupantsPastResident(
  supabase: SupabaseClient,
  residentIds: string[],
): Promise<number> {
  if (residentIds.length === 0) return 0

  const { data, error } = await supabase
    .from("users")
    .update({ status: "past_resident" })
    .in("id", residentIds)
    .in("status", [...OCCUPIES_UNIT_STATUSES])
    .select("id")

  if (error) {
    console.error("[unitVacancy] past_resident update", error.message)
    throw new Error("Failed to update resident status")
  }

  return data?.length ?? 0
}

export type MarkUnitVacantResult = {
  unitId: string
  occupantsEnded: number
  occupancyEnded: number
  identitiesDeregistered: number
  conversationsArchived: number
  promptMessage: string
}

/** Mark a unit vacant and run full vacancy side effects. */
export async function markUnitVacant(
  supabase: SupabaseClient,
  params: {
    landlordId?: string | null
    unitId?: string | null
    unitLabel?: string | null
    building?: string | null
  },
): Promise<MarkUnitVacantResult> {
  const landlordId = resolveLandlordId(params.landlordId)

  let unit =
    (await resolveUnitByIdOrLabel(supabase, {
      landlordId,
      unitId: params.unitId,
      unitLabel: params.unitLabel,
      building: params.building,
    })) ?? null

  if (!unit && params.unitLabel?.trim()) {
    unit = await ensureUnitRow(supabase, {
      landlordId,
      unitLabel: params.unitLabel.trim(),
      building: params.building,
      status: "inactive",
    })
  }

  if (!unit) {
    throw new Error("Unit not found")
  }

  const occupants = await findOccupantsForUnit(supabase, unit)
  const residentIds = occupants.map((o) => o.id)

  const occupancyEnded = await endActiveOccupancy(supabase, unit.id)
  const pastResidentCount = await markOccupantsPastResident(supabase, residentIds)
  const identitiesDeregistered = await deregisterTenantSmsIdentities(supabase, {
    landlordId,
    unitId: unit.id,
    residentIds,
  })
  const conversationsArchived = await archiveResidentSmsConversations(supabase, {
    landlordId,
    unitId: unit.id,
    residentIds,
  })

  const { error: unitErr } = await supabase
    .from("units")
    .update({
      status: "vacant",
      skip_tenant_registration: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", unit.id)

  if (unitErr) {
    console.error("[unitVacancy] unit status update", unitErr.message)
    throw new Error("Failed to mark unit vacant")
  }

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "unit.marked_vacant",
    source: "dashboard",
    actor_type: "landlord",
    unit_id: unit.id,
    metadata: {
      unit_label: unit.unit_label,
      building: unit.building,
      occupants_marked_past_resident: pastResidentCount,
      occupancy_records_ended: occupancyEnded,
      sms_identities_deregistered: identitiesDeregistered,
      sms_conversations_archived: conversationsArchived,
      resident_ids: residentIds,
    },
  })

  return {
    unitId: unit.id,
    occupantsEnded: pastResidentCount,
    occupancyEnded,
    identitiesDeregistered,
    conversationsArchived,
    promptMessage: "Add the new tenant before activating this unit.",
  }
}

export type ActivateUnitInput = {
  landlordId?: string | null
  unitId: string
  skipTenantRegistration?: boolean
  tenantName?: string | null
  tenantPhone?: string | null
  tenantEmail?: string | null
  moveInDate?: string | null
  residentId?: string | null
}

export type ActivateUnitResult = {
  unitId: string
  residentId: string | null
  occupancyId: string | null
  skippedTenantRegistration: boolean
}

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim())
}

/** Activate a vacant/inactive unit with tenant registration or explicit skip. */
export async function activateUnit(
  supabase: SupabaseClient,
  input: ActivateUnitInput,
): Promise<ActivateUnitResult> {
  const landlordId = resolveLandlordId(input.landlordId)
  const skip = input.skipTenantRegistration === true

  const unit = await resolveUnitByIdOrLabel(supabase, {
    landlordId,
    unitId: input.unitId,
  })

  if (!unit) {
    throw new Error("Unit not found")
  }

  if (unit.status === "active" && !skip) {
    throw new Error("Unit is already active")
  }

  const tenantName = input.tenantName?.trim() ?? ""
  const tenantPhone = input.tenantPhone?.trim() ?? ""
  const moveInDate = input.moveInDate?.trim() ?? ""

  if (!skip) {
    if (!tenantName || !tenantPhone || !moveInDate) {
      throw new Error(
        "tenant name, phone number, and move-in date are required unless tenant registration is skipped",
      )
    }
    if (!isIsoDate(moveInDate)) {
      throw new Error("moveInDate must be YYYY-MM-DD")
    }
  }

  let residentId: string | null = input.residentId?.trim() || null
  let occupancyId: string | null = null

  if (!skip) {
    if (residentId) {
      const patch: Record<string, unknown> = {
        full_name: tenantName,
        phone: tenantPhone,
        unit: unit.unit_label,
        building: unit.building,
        status: "active",
        move_in_date: moveInDate,
      }
      if (input.tenantEmail?.trim()) {
        patch.email = input.tenantEmail.trim()
      }

      const { error: upErr } = await supabase
        .from("users")
        .update(patch)
        .eq("id", residentId)

      if (upErr) {
        console.error("[unitVacancy] update resident", upErr.message)
        throw new Error("Failed to update resident")
      }
    } else {
      const email =
        input.tenantEmail?.trim() ||
        `tenant+${unit.id.slice(0, 8)}@unit.local`
      const residentCode = `RES-${crypto.randomUUID().slice(0, 8)}`

      const { data: created, error: insErr } = await supabase
        .from("users")
        .insert({
          resident_id: residentCode,
          full_name: tenantName,
          email,
          phone: tenantPhone,
          unit: unit.unit_label,
          building: unit.building,
          status: "active",
          move_in_date: moveInDate,
        })
        .select("id")
        .single()

      if (insErr || !created?.id) {
        console.error("[unitVacancy] create resident", insErr?.message)
        throw new Error("Failed to create resident for unit")
      }

      residentId = created.id as string
    }

    await endActiveOccupancy(supabase, unit.id)

    const { data: occ, error: occErr } = await supabase
      .from("occupancy")
      .insert({
        landlord_id: landlordId,
        unit_id: unit.id,
        resident_id: residentId,
        move_in_date: moveInDate,
        status: "active",
      })
      .select("id")
      .single()

    if (occErr || !occ?.id) {
      console.error("[unitVacancy] occupancy insert", occErr?.message)
      throw new Error("Failed to create occupancy record")
    }

    occupancyId = occ.id as string

    const existingIdentity = await lookupSmsIdentity(
      supabase,
      tenantPhone,
      landlordId,
    )
    await upsertSmsIdentity(supabase, {
      fromNumber: tenantPhone,
      landlordId,
      existing: existingIdentity,
      patch: {
        identity_type: "resident",
        resident_id: residentId,
        unit_id: unit.id,
        verified: false,
      },
    })
  }

  const { error: unitErr } = await supabase
    .from("units")
    .update({
      status: "active",
      skip_tenant_registration: skip,
      updated_at: new Date().toISOString(),
    })
    .eq("id", unit.id)

  if (unitErr) {
    console.error("[unitVacancy] activate unit", unitErr.message)
    throw new Error("Failed to activate unit")
  }

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "unit.activated",
    source: "dashboard",
    actor_type: "landlord",
    unit_id: unit.id,
    resident_id: residentId,
    metadata: {
      unit_label: unit.unit_label,
      building: unit.building,
      skip_tenant_registration: skip,
      move_in_date: skip ? null : moveInDate,
      occupancy_id: occupancyId,
    },
  })

  return {
    unitId: unit.id,
    residentId,
    occupancyId,
    skippedTenantRegistration: skip,
  }
}
