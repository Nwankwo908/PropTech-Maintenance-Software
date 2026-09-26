/**
 * Complete onboarding — persist portfolio + flip status + landlord welcome message.
 * Opted-in residents (`sendOnboardingOnComplete`) get a welcome SMS after persist.
 * Opted-in vendors get a verification invite after persist.
 */
import { sendLandlordOnboardingWelcome } from '@/api/landlordOnboardingWelcome'
import { sendTenantWelcomeSms } from '@/api/tenantActivation'
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
import { trackProductEventOnce } from '@/lib/analytics/productEvents'
import { persistOnboardingProperties } from './persist/properties'
import {
  importOnboardingResidentsFromExtraction,
  onboardingResidentIdentityMatch,
  onboardingResidentsToImportRows,
} from './persist/importResidents'
import { onboardingSessionFromState } from './session'
import {
  persistLandlordAccountProfile,
  persistLandlordCommunicationStyle,
  persistLandlordDefaultRentDueDay,
} from './persist/account'
import { buildOnboardingReviewMetrics } from './review'
import {
  fetchOnboardingResidents,
  mostCommonRentDueDay,
  type OnboardingResident,
} from './persist/residents'
import { fetchOnboardingVendors, type OnboardingVendor } from './persist/vendors'
import type { AccountSetupCounts, LandlordOnboardingState } from './types'

function vendorHasInviteContact(vendor: { phone?: string; email?: string }): boolean {
  return Boolean(vendor.phone?.trim() || vendor.email?.trim())
}

function vendorInviteChannel(vendor: {
  phone?: string
  email?: string
}): VendorInviteChannel {
  const phone = vendor.phone?.trim() ?? ''
  const email = vendor.email?.trim() ?? ''
  if (phone && email) return 'both'
  if (phone) return 'sms'
  return 'email'
}

function onboardingVendorIdentityMatch(
  left: { id?: string; name?: string; phone?: string; email?: string },
  right: { id?: string; name?: string; phone?: string; email?: string },
): boolean {
  const leftId = (left.id ?? '').trim()
  const rightId = (right.id ?? '').trim()
  if (leftId && rightId && leftId === rightId) return true
  const leftName = (left.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const rightName = (right.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (leftName && rightName && leftName === rightName) return true
  const leftPhone = (left.phone ?? '').trim()
  const rightPhone = (right.phone ?? '').trim()
  if (leftPhone && rightPhone && leftPhone === rightPhone) return true
  const leftEmail = (left.email ?? '').trim().toLowerCase()
  const rightEmail = (right.email ?? '').trim().toLowerCase()
  return Boolean(leftEmail && rightEmail && leftEmail === rightEmail)
}

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
          onboardingSession: onboardingSessionFromState(state),
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

  const metrics = buildOnboardingReviewMetrics(completed, vendors, residents, dbCounts)
  trackProductEventOnce('signup_completed', 'onboarding', {
    property_count: metrics.properties,
    unit_count: metrics.units,
  })

  try {
    const profile = await persistLandlordAccountProfile(scope.landlordId, state.accountSetup)
    if (!profile.ok) {
      console.warn('[landlordOnboarding] account profile persist failed', profile.error)
    }
  } catch (err) {
    console.warn('[landlordOnboarding] account profile persist failed', err)
  }

  try {
    const defaultRentDueDay = mostCommonRentDueDay(residents)
    const rentDue = await persistLandlordDefaultRentDueDay(scope.landlordId, defaultRentDueDay)
    if (!rentDue.ok) {
      console.warn('[landlordOnboarding] default rent due day persist failed', rentDue.error)
    }
  } catch (err) {
    console.warn('[landlordOnboarding] default rent due day persist failed', err)
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

  // Landlord welcome is sent once on complete. Tenant welcome SMS / vendor
  // verification invites only for rows with Onboarding switch enabled.
  const optedInForWelcome = residents.filter(
    (r) => Boolean(r.sendOnboardingOnComplete) && r.phone.trim().length > 0,
  )
  const optedInForVendorInvite = vendors.filter(
    (v) => Boolean(v.sendOnboardingOnComplete) && vendorHasInviteContact(v),
  )
  const tenantsPendingOutreach = residents.filter(
    (r) => r.phone.trim().length > 0 && !r.sendOnboardingOnComplete,
  ).length
  const vendorsPendingOutreach = vendors.filter(
    (v) => vendorHasInviteContact(v) && !v.sendOnboardingOnComplete,
  ).length
  const warnings: string[] = []
  let welcomeDelivered = false
  let tenantWelcomeSent = 0
  let vendorInviteSent = 0

  if (optedInForWelcome.length > 0) {
    try {
      const persistedResidents = await fetchOnboardingResidents(scope.landlordId)
      const companyName = state.accountSetup.companyName.trim() || null
      for (const target of optedInForWelcome) {
        const match =
          persistedResidents.find((row) => row.id === target.id) ??
          persistedResidents.find((row) =>
            onboardingResidentIdentityMatch(
              {
                id: row.id,
                fullName: row.fullName,
                unit: row.unit,
                building: row.building,
                phone: row.phone,
              },
              {
                id: target.id,
                fullName: target.fullName,
                unit: target.unit,
                building: target.building,
                phone: target.phone,
              },
            ),
          )
        if (!match?.id) {
          warnings.push(
            `welcome text for ${target.fullName.trim() || 'a resident'} could not be matched`,
          )
          continue
        }
        const summary = await sendTenantWelcomeSms({
          landlordId: scope.landlordId,
          residentId: match.id,
          companyName,
        })
        if (summary.ok && !(summary.failed ?? 0) && !summary.error) {
          tenantWelcomeSent += 1
        } else {
          warnings.push(
            `welcome text for ${match.fullName.trim() || 'a resident'} could not be sent`,
          )
        }
      }
    } catch (err) {
      console.warn('[landlordOnboarding] opted-in tenant welcome failed', err)
      warnings.push('resident welcome texts could not be sent')
    }
  }

  if (optedInForVendorInvite.length > 0) {
    try {
      const persistedVendors = await fetchOnboardingVendors(scope.landlordId)
      for (const target of optedInForVendorInvite) {
        const match =
          persistedVendors.find((row) => row.id === target.id) ??
          persistedVendors.find((row) => onboardingVendorIdentityMatch(row, target))
        if (!match?.id) {
          warnings.push(
            `verification invite for ${target.name.trim() || 'a vendor'} could not be matched`,
          )
          continue
        }
        try {
          const result = await sendVendorInvite({
            landlordId: scope.landlordId,
            vendorId: match.id,
            businessName: match.name,
            email: match.email.trim() || undefined,
            phone: match.phone.trim() || undefined,
            channel: vendorInviteChannel(match),
            tradeCategories: match.category ? [match.category] : undefined,
          })
          const anySent =
            result.delivery.sms === 'sent' || result.delivery.email === 'sent'
          if (anySent) {
            vendorInviteSent += 1
          } else {
            warnings.push(
              `verification invite for ${match.name.trim() || 'a vendor'} could not be delivered`,
            )
          }
        } catch (err) {
          console.warn('[landlordOnboarding] opted-in vendor invite failed', err)
          warnings.push(
            `verification invite for ${match.name.trim() || 'a vendor'} could not be sent`,
          )
        }
      }
    } catch (err) {
      console.warn('[landlordOnboarding] opted-in vendor invites failed', err)
      warnings.push('vendor verification invites could not be sent')
    }
  }

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
    const tenantWelcomeNote =
      tenantWelcomeSent > 0
        ? ` Welcome texts were sent to ${tenantWelcomeSent} resident${tenantWelcomeSent === 1 ? '' : 's'}.`
        : ''
    const vendorInviteNote =
      vendorInviteSent > 0
        ? ` Verification invites were sent to ${vendorInviteSent} vendor${vendorInviteSent === 1 ? '' : 's'}.`
        : ''
    const outreachNote =
      tenantsPendingOutreach > 0 || vendorsPendingOutreach > 0
        ? ' Send remaining resident welcome texts and vendor verification invites from Residents and Vendors when you are ready.'
        : ''
    const welcomeNote = welcomeDelivered ? ' Your welcome message was sent.' : ''
    await recordActivityLog({
      landlordId: scope.landlordId,
      eventType: 'onboarding.completed',
      source: 'onboarding',
      actorType: 'landlord',
      metadata: {
        message: `Setup complete.${welcomeNote}${tenantWelcomeNote}${vendorInviteNote}${outreachNote}`.trim(),
        tenants_pending_outreach: tenantsPendingOutreach,
        tenants_welcome_sent: tenantWelcomeSent,
        vendors_pending_outreach: vendorsPendingOutreach,
        vendors_invite_sent: vendorInviteSent,
      },
    })
  } catch (err) {
    console.warn('[landlordOnboarding] completion activity log failed', err)
  }

  const activationWarning =
    warnings.length > 0
      ? `Setup finished, but ${warnings.join('; ')}.`
      : tenantsPendingOutreach > 0 || vendorsPendingOutreach > 0
        ? 'Setup complete. Send remaining resident welcome texts and vendor verification invites from Residents and Vendors when you are ready.'
        : undefined

  return { ok: true, activationWarning }
}
