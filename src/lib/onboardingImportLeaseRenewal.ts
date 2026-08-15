/**
 * Fast Track used to insert fake lease_renewal workflow runs for every extracted
 * lease. Real renewals start from check-lease-renewals when the notice window opens.
 */
import { DEMO_LANDLORD_ID } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export const ONBOARDING_IMPORT_LEASE_RENEWAL_SOURCE = 'onboarding_import'

export function isOnboardingImportLeaseRenewalRun(
  templateId: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
  entityType?: string | null,
): boolean {
  if (templateId !== 'lease_renewal') return false
  if (entityType === 'lease_document') return true
  const source = metadata?.source
  return typeof source === 'string' && source === ONBOARDING_IMPORT_LEASE_RENEWAL_SOURCE
}

/** Cancel leftover dummy import runs so they cannot block real lease-renewal cron. */
export async function retireOnboardingImportLeaseRenewals(
  landlordId: string,
): Promise<number> {
  if (!supabase || !landlordId || landlordId === DEMO_LANDLORD_ID) return 0

  const completedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('workflow_runs')
    .update({ status: 'cancelled', completed_at: completedAt })
    .eq('landlord_id', landlordId)
    .eq('template_id', 'lease_renewal')
    .in('status', ['active', 'escalated'])
    .or(
      `metadata->>source.eq.${ONBOARDING_IMPORT_LEASE_RENEWAL_SOURCE},entity_type.eq.lease_document`,
    )
    .select('id')

  if (error) {
    console.warn('[onboarding] retire dummy lease renewals', error.message)
    return 0
  }

  return data?.length ?? 0
}
