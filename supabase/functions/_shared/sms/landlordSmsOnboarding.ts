import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
  type SmsIdentityRow,
} from "./inbound_db.ts"
import { ensureUnitRow } from "../unitVacancy.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  provisionLandlordMainNumber,
  resolveLandlordId,
  type LandlordSmsNumberRow,
} from "./smsNumberPool.ts"

export { resolveLandlordId, type LandlordSmsNumberRow } from "./smsNumberPool.ts"
export { claimAvailablePoolNumber as claimPoolNumberForLandlord } from "./smsNumberPool.ts"

export const NO_SMS_POOL_NUMBERS_ERROR =
  "No available SMS numbers in pool. Pre-seed pool rows or configure SMS_AUTO_PROVISION_* for provider provisioning."

export type EnsureLandlordMainResult = {
  number: LandlordSmsNumberRow
  created: boolean
  source: "existing" | "pool" | "provider"
}

export type UnitCreatedInput = {
  landlordId: string
  unitId?: string | null
  unitLabel?: string | null
  building?: string | null
  residentId?: string | null
  tenantPhone?: string | null
}

export type UnitCreatedResult = {
  landlordId: string
  smsNumberId: string
  mainPhoneNumber: string
  smsIdentityId?: string
  unitAssociated: boolean
}

function selectSmsNumberFields() {
  return "id, landlord_id, phone_number, provider, provider_number_sid, provider_messaging_service_sid, status, purpose"
}

export async function findActiveLandlordMainNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<LandlordSmsNumberRow | null> {
  const { data, error } = await supabase
    .from("sms_numbers")
    .select(selectSmsNumberFields())
    .eq("landlord_id", landlordId)
    .eq("purpose", "landlord_main")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[landlordSms] find landlord_main", error.message)
    throw new Error("Failed to look up landlord SMS number")
  }

  return (data as LandlordSmsNumberRow | null) ?? null
}

/**
 * Ensure landlord has an active landlord_main line (pool claim or provider provision).
 */
export async function ensureLandlordMainSmsNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<EnsureLandlordMainResult> {
  const result = await provisionLandlordMainNumber(supabase, { landlordId })
  const number = await findActiveLandlordMainNumber(supabase, landlordId)
  if (!number) {
    throw new Error("Failed to load provisioned landlord_main number")
  }

  if (result.created) {
    console.info("[landlordSms] provisioned landlord_main", {
      landlordId,
      phoneNumber: number.phone_number,
      source: result.source,
    })
  }

  return {
    number,
    created: result.created,
    source: result.source,
  }
}

async function createResidentSmsIdentity(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    tenantPhone: string
    unitId?: string | null
  },
): Promise<SmsIdentityRow | null> {
  return upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone: params.tenantPhone,
    identityType: "resident",
    residentId: params.residentId,
    unitId: params.unitId ?? null,
  })
}

/** Register or upgrade resident SMS identity after admin/resident onboarding. */
export async function syncResidentSmsIdentity(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    tenantPhone: string
    unitId?: string | null
    unitLabel?: string | null
    building?: string | null
  },
): Promise<SmsIdentityRow | null> {
  let unitId = params.unitId?.trim() || null
  if (!unitId && params.unitLabel?.trim()) {
    const unitRow = await ensureUnitRow(supabase, {
      landlordId: params.landlordId,
      unitLabel: params.unitLabel.trim(),
      building: params.building?.trim() || null,
    })
    unitId = unitRow.id
  }

  return createResidentSmsIdentity(supabase, {
    landlordId: params.landlordId,
    residentId: params.residentId,
    tenantPhone: params.tenantPhone,
    unitId,
  })
}

/**
 * When a unit is created:
 * - Do not provision a new SMS number.
 * - Associate the unit with the landlord's main Ulo SMS line.
 * - Optionally create sms_identity when tenant phone is known.
 */
export async function onUnitCreated(
  supabase: SupabaseClient,
  input: UnitCreatedInput,
): Promise<UnitCreatedResult> {
  const landlordId = resolveLandlordId(input.landlordId)
  const { number: mainNumber } = await ensureLandlordMainSmsNumber(
    supabase,
    landlordId,
  )

  const unitLabel = input.unitLabel?.trim() || null
  const building = input.building?.trim() || null

  const unitRow = unitLabel
    ? await ensureUnitRow(supabase, {
        landlordId,
        unitLabel,
        building,
        status: "inactive",
      })
    : null
  const resolvedUnitId = input.unitId?.trim() || unitRow?.id || null

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "unit.registered",
    source: "dashboard",
    actor_type: "landlord",
    unit_id: resolvedUnitId,
    metadata: {
      unit_label: unitLabel,
      building,
      sms_number_id: mainNumber.id,
      main_phone_number: mainNumber.phone_number,
      resident_id: input.residentId ?? null,
    },
  })

  let smsIdentityId: string | undefined
  const tenantPhone = input.tenantPhone?.trim()
  const residentId = input.residentId?.trim()

  if (tenantPhone && residentId) {
    const identity = await createResidentSmsIdentity(supabase, {
      landlordId,
      residentId,
      tenantPhone,
      unitId: resolvedUnitId,
    })
    if (!identity) {
      console.warn("[landlordSms] skipped resident sms_identity — invalid phone", {
        landlordId,
        residentId,
        tenantPhone,
      })
    } else {
      smsIdentityId = identity.id

      await logGraphEvent(supabase, {
        landlord_id: landlordId,
        event_type: "tenant.sms_registered",
        source: "dashboard",
        actor_type: "landlord",
        unit_id: resolvedUnitId,
        resident_id: residentId,
        metadata: {
          phone: normalizeSmsPhone(tenantPhone),
          sms_identity_id: identity.id,
          unit_label: unitLabel,
          building,
        },
      })

      console.info("[landlordSms] created resident sms_identity", {
        landlordId,
        residentId,
        phone: normalizeSmsPhone(tenantPhone),
        unitLabel,
      })
    }
  }

  return {
    landlordId,
    smsNumberId: mainNumber.id,
    mainPhoneNumber: mainNumber.phone_number,
    smsIdentityId,
    unitAssociated: true,
  }
}

/** Batch helper for property registration flows that create many units at once. */
export async function onUnitsCreated(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    units: Array<{
      unitLabel: string
      building?: string | null
      unitId?: string | null
    }>
  },
): Promise<UnitCreatedResult> {
  const landlordId = resolveLandlordId(params.landlordId)
  const { number: mainNumber } = await ensureLandlordMainSmsNumber(
    supabase,
    landlordId,
  )

  for (const unit of params.units) {
    const unitRow = await ensureUnitRow(supabase, {
      landlordId,
      unitLabel: unit.unitLabel,
      building: unit.building ?? null,
      status: "inactive",
    })

    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "unit.registered",
      source: "dashboard",
      actor_type: "landlord",
      unit_id: unit.unitId ?? unitRow.id,
      metadata: {
        unit_label: unit.unitLabel,
        building: unit.building ?? null,
        sms_number_id: mainNumber.id,
        main_phone_number: mainNumber.phone_number,
      },
    })
  }

  return {
    landlordId,
    smsNumberId: mainNumber.id,
    mainPhoneNumber: mainNumber.phone_number,
    unitAssociated: params.units.length > 0,
  }
}
