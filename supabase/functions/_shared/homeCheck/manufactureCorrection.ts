import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import type { HomeCheckAsset } from '../../../../shared/homeCheck.ts'
import { homeCheckEquipment } from '../../../../shared/homeCheckEquipment.ts'
import { recordActivityLog } from '../graph/recordActivityLog.ts'
import { checked, type HomeCheckRow, requireData } from './service.ts'
import {
  assetsFromUnitAssetRows,
  type HomeCheckManufactureCorrection,
} from './manufactureCorrectionParse.ts'

export {
  assetsFromUnitAssetRows,
  homeCheckManufactureCorrectionHelp,
  isHomeCheckResultsAwaitingOk,
  parseHomeCheckManufactureCorrection,
  type HomeCheckManufactureCorrection,
} from './manufactureCorrectionParse.ts'

function emptyField(value: string | number | null = null, basis?: string) {
  return {
    value,
    source: 'landlord' as const,
    capturedBy: 'landlord' as const,
    confidence: value == null ? 'low' as const : 'high' as const,
    photoIds: [] as string[],
    ...(basis ? { basis, estimated: true as const } : {}),
  }
}

/** Persist a landlord SMS manufacture-date correction without confirming the check. */
export async function applyHomeCheckSmsManufactureCorrection(
  db: SupabaseClient,
  check: HomeCheckRow,
  correction: HomeCheckManufactureCorrection,
  now = new Date(),
): Promise<HomeCheckAsset[]> {
  if (check.confirmed_at || Date.parse(check.expires_at) <= Date.now()) {
    throw new Error('This Home Check has ended.')
  }
  if (check.answers?.warningSigns == null && !check.answers?.observationsConfirmed) {
    throw new Error('Answer the leaks, noises or smells question before correcting records.')
  }

  const rows = requireData(
    await db.from('unit_assets').select('id, home_check_system, metadata, estimated_age_years')
      .eq('home_check_id', check.id).eq('landlord_id', check.landlord_id),
  ) as Array<{
    id: string
    home_check_system: string | null
    metadata: Record<string, any> | null
    estimated_age_years: number | null
  }>

  const target = rows.find((row) => row.home_check_system === correction.system)
  if (!target?.id) throw new Error('Equipment record is not ready yet. Text RESULTS in a moment.')

  const meta = { ...(target.metadata ?? {}) }
  const homeCheck = { ...(meta.homeCheck ?? {}) }
  const fields = { ...(homeCheck.fields ?? {}) }
  const draftAsset = {
    system: correction.system,
    manufactureDate: { year: correction.year, month: correction.month },
    fields: {
      make: fields.make ?? emptyField(),
      model: fields.model ?? emptyField(),
      serial: fields.serial ?? emptyField(),
      approximateAge: emptyField(),
      condition: fields.condition ?? emptyField(),
      lastService: fields.lastService ?? emptyField(),
      lastFilterChange: fields.lastFilterChange ?? emptyField(),
    },
  }
  const facts = homeCheckEquipment(draftAsset, now)
  const ageBasis = facts.made
    ? `Landlord corrected the manufacture date to ${facts.made} by text.`
    : 'Landlord corrected the manufacture date by text.'
  fields.approximateAge = {
    ...(fields.approximateAge ?? emptyField()),
    value: facts.age,
    source: 'landlord',
    capturedBy: 'landlord',
    confidence: facts.age == null ? 'low' : 'high',
    estimated: true,
    basis: ageBasis,
  }
  homeCheck.manufactureDate = { year: correction.year, month: correction.month }
  homeCheck.fields = fields
  meta.homeCheck = homeCheck
  meta.ageBasis = 'landlord_plate'
  meta.landlordLabelVerified = true

  await checked(
    db.from('unit_assets').update({
      estimated_age_years: facts.age,
      metadata: meta,
      updated_at: new Date().toISOString(),
    }).eq('id', target.id).eq('home_check_id', check.id).eq('landlord_id', check.landlord_id),
  )

  await db.from('home_check_events').insert({
    check_id: check.id,
    event_type: 'landlord_label_corrected',
    role: check.role,
    metadata: {
      asset_id: target.id,
      actor_role: 'landlord',
      source: 'sms',
      system: correction.system,
      manufacture_year: correction.year,
      manufacture_month: correction.month,
    },
  }).then(() => undefined, () => undefined)

  await recordActivityLog(db, {
    landlordId: check.landlord_id,
    eventType: 'home_check.manufacture_date_corrected',
    source: 'sms',
    actorType: 'landlord',
    propertyId: check.property_id,
    unitId: check.unit_id,
    maintenanceRequestId: check.ticket_id,
    workflowRunId: check.workflow_run_id,
    metadata: {
      message: `Manufacture year for the ${correction.system === 'water_heater' ? 'water heater' : 'heating system'} was updated to ${correction.year} by text.`,
      checkId: check.id,
      system: correction.system,
      manufactureYear: correction.year,
      manufactureMonth: correction.month,
    },
  }).catch(() => undefined)

  const refreshed = requireData(
    await db.from('unit_assets').select('home_check_system, metadata')
      .eq('home_check_id', check.id).eq('landlord_id', check.landlord_id),
  ) as Array<{ home_check_system?: string | null; metadata?: Record<string, unknown> | null }>
  return assetsFromUnitAssetRows(refreshed)
}
