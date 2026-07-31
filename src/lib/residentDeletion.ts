import { getErrorMessage } from '@/lib/errorMessage'
/**
 * Delete roster residents safely when `occupancy.resident_id` is ON DELETE RESTRICT.
 * Clears occupancy (and vacates orphaned units) before removing `users` rows.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type DeleteResidentsResult =
  | { ok: true; deletedCount: number }
  | { ok: false; error: string }

export async function deleteResidentsForLandlord(params: {
  residentIds: string[]
  landlordId?: string
}): Promise<DeleteResidentsResult> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }

  const residentIds = [...new Set(params.residentIds.map((id) => id.trim()).filter(Boolean))]
  if (residentIds.length === 0) return { ok: true, deletedCount: 0 }

  const landlordId = params.landlordId?.trim() || getActiveLandlordId()

  const { data: occupancyRows, error: occupancySelectError } = await supabase
    .from('occupancy')
    .select('id, unit_id, status')
    .eq('landlord_id', landlordId)
    .in('resident_id', residentIds)

  if (occupancySelectError) {
    return { ok: false, error: getErrorMessage(occupancySelectError, 'Something went wrong. Please try again.') }
  }

  const unitIds = [
    ...new Set(
      (occupancyRows ?? [])
        .map((row) => (typeof row.unit_id === 'string' ? row.unit_id : ''))
        .filter(Boolean),
    ),
  ]

  if ((occupancyRows ?? []).length > 0) {
    const { error: occupancyDeleteError } = await supabase
      .from('occupancy')
      .delete()
      .eq('landlord_id', landlordId)
      .in('resident_id', residentIds)

    if (occupancyDeleteError) {
      return { ok: false, error: getErrorMessage(occupancyDeleteError, 'Something went wrong. Please try again.') }
    }
  }

  // Free phone numbers for reuse in a fresh onboarding run.
  const { error: identityDeleteError } = await supabase
    .from('sms_identities')
    .delete()
    .eq('landlord_id', landlordId)
    .in('resident_id', residentIds)
  if (identityDeleteError) {
    console.warn('[deleteResidents] sms_identities', identityDeleteError.message)
  }

  for (const unitId of unitIds) {
    const { data: remainingActive, error: remainingError } = await supabase
      .from('occupancy')
      .select('id')
      .eq('unit_id', unitId)
      .eq('status', 'active')
      .limit(1)

    if (remainingError) {
      return { ok: false, error: getErrorMessage(remainingError, 'Something went wrong. Please try again.') }
    }

    if ((remainingActive ?? []).length > 0) continue

    const { error: unitUpdateError } = await supabase
      .from('units')
      .update({ status: 'vacant', updated_at: new Date().toISOString() })
      .eq('id', unitId)
      .eq('landlord_id', landlordId)

    if (unitUpdateError) {
      // Unit vacate is best-effort; resident delete can still proceed.
      console.warn('[deleteResidents] unit vacate', unitUpdateError.message)
    }
  }

  const { data: deletedRows, error: userDeleteError } = await supabase
    .from('users')
    .delete()
    .eq('landlord_id', landlordId)
    .in('id', residentIds)
    .select('id')

  if (userDeleteError) {
    return { ok: false, error: getErrorMessage(userDeleteError, 'Something went wrong. Please try again.') }
  }

  return { ok: true, deletedCount: deletedRows?.length ?? residentIds.length }
}
