/**
 * Complete onboarding — persist portfolio + flip status (no automatic outreach).
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  normalizeOnboardingApprovalRules,
  validateOnboardingApprovalRules,
} from '@/lib/onboardingApprovalRules'
import { activateUnitsFromResidentAssignments } from '@/lib/unitActivation'
import {
  requireOnboardingLandlord,
  saveLandlordOnboarding,
} from './draftStorage'
import { persistOnboardingProperties } from './persist/properties'
import {
  persistLandlordAccountProfile,
  persistLandlordCommunicationStyle,
} from './persist/account'
import { buildOnboardingReviewMetrics } from './review'
import type { OnboardingResident } from './persist/residents'
import type { OnboardingVendor } from './persist/vendors'
import type { AccountSetupCounts, LandlordOnboardingState } from './types'

/** Landlord Connect ready for rent payouts (onboarding + Checkout gate). */
export async function isLandlordStripePayoutsReady(
  landlordId: string = getActiveLandlordId(),
): Promise<boolean> {
  const { canLandlordReceivePayments } = await import('@/lib/paymentReadiness')
  return canLandlordReceivePayments(landlordId)
}

export function canCompleteOnboarding(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[] = [],
  residents: OnboardingResident[] = [],
  dbCounts?: AccountSetupCounts,
  /** Unused — payouts can be skipped during onboarding; rent checkout stays gated separately. */
  _payoutsReady?: boolean,
): { ok: boolean; missing: string[] } {
  const metrics = buildOnboardingReviewMetrics(state, vendors, residents, dbCounts)
  const missing: string[] = []
  if (!state.accountSetup.companyName.trim()) missing.push('Company name')
  if (!state.accountSetup.contactName.trim()) missing.push('Contact name')
  if (metrics.properties === 0) missing.push('At least one property')
  if (metrics.units === 0) missing.push('At least one unit')
  const approvalCheck = validateOnboardingApprovalRules(
    normalizeOnboardingApprovalRules(state.approvalRules),
  )
  if (!approvalCheck.ok) {
    missing.push('Maintenance approval rules')
  }
  // Payouts are optional during onboarding — rent collection stays gated until Connect is ready.
  return { ok: missing.length === 0, missing }
}

export async function completeOnboarding(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[] = [],
  residents: OnboardingResident[] = [],
  dbCounts?: AccountSetupCounts,
): Promise<{ ok: boolean; error?: string; activationWarning?: string }> {
  const scope = requireOnboardingLandlord(state.landlordId)
  if (!scope.ok) return scope

  const payoutsReady = await isLandlordStripePayoutsReady(scope.landlordId)
  const check = canCompleteOnboarding(state, vendors, residents, dbCounts, payoutsReady)
  if (!check.ok) {
    return { ok: false, error: `Missing: ${check.missing.join(', ')}` }
  }

  // Do not purge tickets/workflow runs on complete — live SMS intake may already
  // have created real work orders. Wipe only via Reset onboarding.

  // General rule: tenant assigned to a unit with lease dates activates that unit.
  // No separate Activate Unit click is required after onboarding.
  try {
    await activateUnitsFromResidentAssignments({
      landlordId: scope.landlordId,
      residents: residents.map((r) => ({
        id: r.id,
        unit: r.unit,
        building: r.building,
        status: r.occupancyStatus,
        leaseStart: r.leaseStart,
        leaseEnd: r.leaseEnd,
      })),
      source: 'onboarding_complete',
    })
  } catch (err) {
    console.warn('[landlordOnboarding] unit activation from residents failed', err)
  }

  // Ensure canonical properties rows exist for every onboarding property.
  let properties = state.properties
  if (properties.length > 0) {
    try {
      const synced = await persistOnboardingProperties(properties, scope.landlordId)
      if (synced.ok) {
        properties = synced.properties
      } else {
        console.warn('[landlordOnboarding] properties sync on complete failed', synced.error)
      }
    } catch (err) {
      console.warn('[landlordOnboarding] properties sync on complete failed', err)
    }
  }

  const completed: LandlordOnboardingState = {
    ...state,
    properties,
    landlordId: scope.landlordId,
    onboardingStatus: 'completed',
    currentStep: 'review',
    completedAt: new Date().toISOString(),
  }
  await saveLandlordOnboarding(completed)

  try {
    const profile = await persistLandlordAccountProfile(scope.landlordId, state.accountSetup)
    if (!profile.ok) {
      console.warn('[landlordOnboarding] account profile persist failed', profile.error)
    }
  } catch (err) {
    console.warn('[landlordOnboarding] account profile persist failed', err)
  }

  const rules = normalizeOnboardingApprovalRules(state.approvalRules)
  try {
    await persistLandlordCommunicationStyle(scope.landlordId, rules.communicationStyle, {
      eventType: 'landlord.communication_style_selected',
      step: 'approval',
      source: 'onboarding',
    })
  } catch (err) {
    console.warn('[landlordOnboarding] communication style persist failed', err)
  }

  // Outreach is manual: managers send tenant welcome texts and vendor verification
  // invites from Residents / Vendors when they are ready.
  const tenantsPendingOutreach = residents.filter((r) => r.phone.trim().length > 0).length
  const vendorsPendingOutreach = vendors.filter(
    (v) => v.phone.trim().length > 0 || v.email.trim().length > 0,
  ).length

  try {
    const { recordActivityLog } = await import('@/lib/recordActivityLog')
    await recordActivityLog({
      landlordId: scope.landlordId,
      eventType: 'onboarding.completed',
      source: 'onboarding',
      actorType: 'landlord',
      metadata: {
        message:
          tenantsPendingOutreach > 0 || vendorsPendingOutreach > 0
            ? 'Setup complete. Send resident welcome texts and vendor verification invites from Residents and Vendors when you are ready.'
            : 'Setup complete.',
        tenants_pending_outreach: tenantsPendingOutreach,
        vendors_pending_outreach: vendorsPendingOutreach,
      },
    })
  } catch (err) {
    console.warn('[landlordOnboarding] completion activity log failed', err)
  }

  return { ok: true }
}
