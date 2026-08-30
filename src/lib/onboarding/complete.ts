/**
 * Complete onboarding — persist portfolio + flip status + landlord welcome message.
 */
import { sendLandlordOnboardingWelcome } from '@/api/landlordOnboardingWelcome'
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
  importOnboardingResidentsFromExtraction,
  onboardingResidentsToImportRows,
} from './persist/importResidents'
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
  const { landlordHasPayments } = await import('@shared/landlordCapabilities')
  if (!landlordHasPayments(landlordId)) return false
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

  // Persist inventory first so activation can match saved units (new rows start inactive).
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

  // Anyone on the final review roster must land in Residents — do not rely only on
  // the earlier AI-review import, which can persist a subset.
  if (residents.length > 0) {
    try {
      const importRows = onboardingResidentsToImportRows(residents)
      const persisted = await importOnboardingResidentsFromExtraction(
        importRows,
        [],
        scope.landlordId,
        {
          properties: properties.map((property) => ({
            id: property.id,
            name: property.name,
          })),
        },
      )
      if (persisted < importRows.length) {
        console.warn(
          '[landlordOnboarding] review resident persist partial',
          persisted,
          'of',
          importRows.length,
        )
      }
    } catch (err) {
      console.warn('[landlordOnboarding] review resident persist failed', err)
    }
  }

  // Tenant assigned to a unit with lease dates — or tenant SMS onboarding complete —
  // activates that unit. No separate Activate Unit click.
  try {
    await activateUnitsFromResidentAssignments({
      landlordId: scope.landlordId,
      source: 'onboarding_complete',
    })
  } catch (err) {
    console.warn('[landlordOnboarding] unit activation from residents failed', err)
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

  // Tenant/vendor outreach stays manual. Landlord welcome is sent once on complete.
  const tenantsPendingOutreach = residents.filter((r) => r.phone.trim().length > 0).length
  const vendorsPendingOutreach = vendors.filter(
    (v) => v.phone.trim().length > 0 || v.email.trim().length > 0,
  ).length
  const warnings: string[] = []
  let welcomeDelivered = false

  try {
    const welcome = await sendLandlordOnboardingWelcome({
      landlordId: scope.landlordId,
      companyName: state.accountSetup.companyName.trim() || null,
      contactName: state.accountSetup.contactName.trim() || null,
      email: state.accountSetup.email.trim() || null,
    })
    if (!welcome.configured) {
      console.warn('[landlordOnboarding] landlord welcome not configured')
    } else if (welcome.skipped && welcome.reason === 'already_sent') {
      welcomeDelivered = true
    } else if (!welcome.ok || welcome.error) {
      warnings.push("we couldn't send your setup welcome message")
    } else if ((welcome.smsSent?.length ?? 0) > 0 || (welcome.emailSent?.length ?? 0) > 0) {
      welcomeDelivered = true
    } else if (welcome.reason === 'no_contact_info') {
      warnings.push('add a phone or email in Account setup to receive your welcome message')
    } else {
      warnings.push("we couldn't deliver your setup welcome message")
    }
  } catch (err) {
    console.warn('[landlordOnboarding] landlord welcome trigger failed', err)
    warnings.push('your setup welcome message could not be sent')
  }

  try {
    const { recordActivityLog } = await import('@/lib/recordActivityLog')
    const outreachNote =
      tenantsPendingOutreach > 0 || vendorsPendingOutreach > 0
        ? ' Send resident welcome texts and vendor verification invites from Residents and Vendors when you are ready.'
        : ''
    const welcomeNote = welcomeDelivered ? ' Your welcome message was sent.' : ''
    await recordActivityLog({
      landlordId: scope.landlordId,
      eventType: 'onboarding.completed',
      source: 'onboarding',
      actorType: 'landlord',
      metadata: {
        message: `Setup complete.${welcomeNote}${outreachNote}`.trim(),
        tenants_pending_outreach: tenantsPendingOutreach,
        vendors_pending_outreach: vendorsPendingOutreach,
      },
    })
  } catch (err) {
    console.warn('[landlordOnboarding] completion activity log failed', err)
  }

  const activationWarning =
    warnings.length > 0
      ? `Setup finished, but ${warnings.join('; ')}.`
      : tenantsPendingOutreach > 0 || vendorsPendingOutreach > 0
        ? 'Setup complete. Send resident welcome texts and vendor verification invites from Residents and Vendors when you are ready.'
        : undefined

  return { ok: true, activationWarning }
}
