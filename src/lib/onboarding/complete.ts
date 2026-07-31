/**
 * Complete onboarding — activation SMS / vendor invites + status flip.
 */
import { sendTenantActivationSms } from '@/api/tenantActivation'
import { sendVendorInvite, type VendorInviteChannel } from '@/api/vendorVerification'
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
import {
  persistLandlordAccountProfile,
  persistLandlordCommunicationStyle,
} from './persist/account'
import { buildOnboardingReviewMetrics } from './review'
import type { OnboardingResident } from './persist/residents'
import type { OnboardingVendor } from './persist/vendors'
import type { AccountSetupCounts, LandlordOnboardingState } from './types'
import { normalizeVendorTrade } from '@/lib/vendorTrades'

/** Landlord Connect ready for rent payouts (shared readiness rule). */
export async function isLandlordStripePayoutsReady(
  landlordId: string = getActiveLandlordId(),
): Promise<boolean> {
  const { isLandlordStripeConnectReady } = await import('@/lib/stripeConnectReady')
  return isLandlordStripeConnectReady(landlordId)
}

export function canCompleteOnboarding(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[] = [],
  residents: OnboardingResident[] = [],
  dbCounts?: AccountSetupCounts,
  payoutsReady?: boolean,
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
  if (payoutsReady !== true) missing.push('Payout account (Set up payouts)')
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

  const completed: LandlordOnboardingState = {
    ...state,
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

  // General rule: anyone listed during onboarding is automatically started on
  // their activation/verification flow when setup completes (tenants + vendors).
  // Best-effort — never block finishing setup on delivery failures.
  const warnings: string[] = []
  const companyName = state.accountSetup.companyName.trim() || null
  const propertyName = state.properties.map((p) => p.name.trim()).find(Boolean) || undefined

  try {
    const residentIds = residents
      .filter((r) => r.phone.trim().length > 0)
      .map((r) => r.id)
      .filter((id) => id.trim().length > 0)
    if (residentIds.length > 0) {
      const summary = await sendTenantActivationSms({
        landlordId: scope.landlordId,
        residentIds,
        companyName,
      })
      if (!summary.configured) {
        console.warn('[landlordOnboarding] tenant activation not configured')
      } else if (summary.error) {
        warnings.push(`couldn't send welcome texts to your residents (${summary.error})`)
      } else if ((summary.failed ?? 0) > 0) {
        const failed = summary.failed ?? 0
        warnings.push(
          `couldn't send welcome texts to ${failed} resident${failed === 1 ? '' : 's'}`,
        )
      }
    }
  } catch (err) {
    console.warn('[landlordOnboarding] tenant activation trigger failed', err)
    warnings.push('the resident welcome texts could not be sent')
  }

  try {
    const inviteable = vendors.filter(
      (v) => v.phone.trim().length > 0 || v.email.trim().length > 0,
    )
    if (inviteable.length > 0) {
      const results = await Promise.allSettled(
        inviteable.map((vendor) => {
          const phone = vendor.phone.trim()
          const email = vendor.email.trim()
          const channel: VendorInviteChannel =
            phone && email ? 'both' : phone ? 'sms' : 'email'
          const trade = normalizeVendorTrade(vendor.category, { fallbackOther: false })
          return sendVendorInvite({
            landlordId: scope.landlordId,
            vendorId: vendor.id,
            businessName: vendor.name.trim(),
            email: email || undefined,
            phone: phone || undefined,
            propertyName,
            channel,
            tradeCategories: trade ? [trade] : undefined,
          })
        }),
      )

      let failed = 0
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failed += 1
          console.warn('[landlordOnboarding] vendor invite failed', {
            vendorId: inviteable[index]?.id,
            reason: result.reason,
          })
          return
        }
        const delivery = result.value.delivery
        const anySent = delivery.sms === 'sent' || delivery.email === 'sent'
        if (!anySent) {
          failed += 1
          console.warn('[landlordOnboarding] vendor invite not delivered', {
            vendorId: inviteable[index]?.id,
            delivery,
          })
        }
      })

      if (failed > 0) {
        warnings.push(
          `couldn't send verification invites to ${failed} vendor${failed === 1 ? '' : 's'}`,
        )
      }
    }
  } catch (err) {
    console.warn('[landlordOnboarding] vendor invite trigger failed', err)
    warnings.push('the vendor verification invites could not be sent')
  }

  const activationWarning =
    warnings.length > 0
      ? `We finished setup, but ${warnings.join('; ')}. Check the activity feed for details.`
      : undefined

  return { ok: true, activationWarning }
}
