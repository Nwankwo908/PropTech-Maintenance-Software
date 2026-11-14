import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  normalizeSmsPhone,
  phoneLookupVariants,
  upsertSmsIdentityForPhone,
  type SmsIdentityRow,
} from "./inbound_db.ts"
import { ensureUnitRow, findUnitRow } from "../unitVacancy.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  resolveLandlordId,
  type LandlordSmsNumberRow,
} from "./smsNumberPool.ts"
import type { SmsProviderName } from "./types.ts"
import {
  LIMITED_ALPHA_1_TWILIO_SMS_NUMBER,
  landlordMayUseSharedSmsLine,
} from "../../../../shared/landlordCapabilities.ts"

export { resolveLandlordId, type LandlordSmsNumberRow } from "./smsNumberPool.ts"
export { claimAvailablePoolNumber as claimPoolNumberForLandlord } from "./smsNumberPool.ts"

export const NO_SMS_POOL_NUMBERS_ERROR =
  "Dedicated SMS number allocation is retired. The shared Ulo line must be configured."

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

/**
 * Outbound from-number on a landlord_main `sms_numbers` row.
 *
 * Always read `phone_number`. There is no `e164` column on this table — checking
 * `row.e164` is always undefined and makes reminders / silence follow-ups quietly
 * skip with a false "no landlord SMS line" warning.
 */
export function landlordSmsRowFromNumber(
  row: Pick<LandlordSmsNumberRow, "phone_number"> | null | undefined,
): string {
  return typeof row?.phone_number === "string" ? row.phone_number.trim() : ""
}

export async function findActiveLandlordMainNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<LandlordSmsNumberRow | null> {
  if (!landlordMayUseSharedSmsLine(landlordId)) return null
  const { data, error } = await supabase.from("sms_numbers")
    .select(selectSmsNumberFields()).in("phone_number", [...phoneLookupVariants(LIMITED_ALPHA_1_TWILIO_SMS_NUMBER), LIMITED_ALPHA_1_TWILIO_SMS_NUMBER.slice(-10)])
    .eq("provider", "twilio").eq("purpose", "landlord_main").eq("status", "active").limit(2)
  if (error || !data || data.length > 1) throw new Error("Shared Ulo SMS line is unavailable")
  const row = (data as unknown as LandlordSmsNumberRow[])[0]
  return row ? { ...row, phone_number: LIMITED_ALPHA_1_TWILIO_SMS_NUMBER } : null
}

export type OutboundLandlordSmsLine = {
  id: string
  phone: string
  provider: SmsProviderName
}

function twilioLineFromRow(row: LandlordSmsNumberRow): OutboundLandlordSmsLine | null {
  if (String(row.provider).toLowerCase() !== "twilio") return null
  return {
    id: String(row.id),
    phone: String(row.phone_number).trim(),
    provider: "twilio",
  }
}

/**
 * Landlord_main line for outbound SMS.
 * All accounts are eligible for the shared Ulo DID, independently of plan tier.
 * The canonical shared row is reused read-only; owned-line fallback is retired.
 */
export async function resolveOutboundLandlordSmsLine(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<OutboundLandlordSmsLine | null> {
  const row = await findActiveLandlordMainNumber(supabase, landlordId)
  const line = row ? twilioLineFromRow(row) : null
  if (line) return line
  return null
}

/**
 * Validate the shared platform line. Never claim or provision a per-landlord number.
 */
export async function ensureLandlordMainSmsNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<EnsureLandlordMainResult> {
  const number = await findActiveLandlordMainNumber(supabase, landlordId)
  if (!number) throw new Error("Shared Ulo SMS line is unavailable")
  return { number, created: false, source: "existing" }
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
    const unitRow = await findUnitRow(supabase, {
      landlordId: params.landlordId,
      unitLabel: params.unitLabel.trim(),
      building: params.building?.trim() || null,
    })
    unitId = unitRow?.id ?? null
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
