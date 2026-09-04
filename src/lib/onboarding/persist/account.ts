/**
 * Persist onboarding account profile + setup counts.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage, isUniqueViolation } from '@/lib/errorMessage'
import { phoneForDbOrError } from '@/lib/phoneFormat'
import { normalizeOnboardingApprovalRules } from '@/lib/onboardingApprovalRules'
import { supabase } from '@/lib/supabase'
import { requireOnboardingLandlord } from '../scope'
import type { AccountSetupCounts, OnboardingAccountSetup } from '../types'
import { resolveLandlordSupportEmail } from '@/lib/landlordSupportEmail'

async function persistSupportEmailOnOnboarding(
  landlordId: string,
  email: string,
): Promise<void> {
  if (!supabase) return
  const supportEmail = resolveLandlordSupportEmail({ accountSetupEmail: email })
  if (!supportEmail) return

  const { data } = await supabase
    .from('landlord_onboarding')
    .select('draft_state, account_settings')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  const draft =
    data?.draft_state && typeof data.draft_state === 'object'
      ? (data.draft_state as Record<string, unknown>)
      : {}
  const priorAccount =
    data?.account_settings && typeof data.account_settings === 'object'
      ? (data.account_settings as Record<string, unknown>)
      : {}
  const priorOrg =
    priorAccount.organization && typeof priorAccount.organization === 'object'
      ? (priorAccount.organization as Record<string, unknown>)
      : {}
  const accountSetup = {
    ...((draft.accountSetup ?? {}) as Record<string, unknown>),
    email: supportEmail,
  }

  const payload: Record<string, unknown> = {
    draft_state: { ...draft, accountSetup },
    account_settings: {
      ...priorAccount,
      organization: { ...priorOrg, supportEmail },
    },
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('landlord_onboarding')
    .update(payload)
    .eq('landlord_id', landlordId)
  if (error && /account_settings|column .* does not exist/i.test(error.message)) {
    const { account_settings: _drop, ...withoutSettings } = payload
    await supabase
      .from('landlord_onboarding')
      .update(withoutSettings)
      .eq('landlord_id', landlordId)
  }
}

async function finishAccountPersistOk(
  landlordId: string,
  email: string | null,
): Promise<{ ok: true }> {
  await persistSupportEmailOnOnboarding(landlordId, email ?? '')
  return { ok: true }
}

export async function persistLandlordAccountProfile(
  landlordId: string,
  account: OnboardingAccountSetup,
): Promise<{ ok: boolean; error?: string }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) return scope
  if (!supabase) return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }

  const companyName = account.companyName.trim()
  const contactName = account.contactName.trim()
  const email = account.email.trim() || null
  const phoneResult = account.phone.trim()
    ? phoneForDbOrError(account.phone)
    : { phone: null as string | null, error: undefined as string | undefined }
  if (phoneResult.error) {
    return { ok: false, error: phoneResult.error }
  }

  const payload: Record<string, unknown> = {
    name: companyName || 'New Landlord',
    contact_name: contactName || null,
    email,
    phone: phoneResult.phone,
  }

  const { error } = await supabase.from('landlords').update(payload).eq('id', scope.landlordId)
  if (error) {
    // landlords.email is globally unique — keep login email and still save name/phone.
    if (isUniqueViolation(error) && /email/i.test(error.message)) {
      const { error: retryWithoutEmail } = await supabase
        .from('landlords')
        .update({
          name: companyName || 'New Landlord',
          contact_name: contactName || null,
          phone: phoneResult.phone,
        })
        .eq('id', scope.landlordId)
      if (!retryWithoutEmail) {
        console.warn(
          '[landlordOnboarding] account email already in use; saved profile without changing email',
          email,
        )
        return finishAccountPersistOk(scope.landlordId, email)
      }
      if (/contact_name|phone|column .* does not exist/i.test(retryWithoutEmail.message)) {
        const { error: nameOnly } = await supabase
          .from('landlords')
          .update({ name: companyName || 'New Landlord' })
          .eq('id', scope.landlordId)
        if (!nameOnly) return finishAccountPersistOk(scope.landlordId, email)
        return {
          ok: false,
          error: getErrorMessage(
            nameOnly,
            'That email is already used by another account. Use a different email.',
          ),
        }
      }
      return {
        ok: false,
        error:
          'That email is already used by another account. Use a different email.',
      }
    }
    if (/contact_name|phone|column .* does not exist/i.test(error.message)) {
      const { error: retryError } = await supabase
        .from('landlords')
        .update({
          name: companyName || 'New Landlord',
          email,
        })
        .eq('id', scope.landlordId)
      if (retryError) {
        if (isUniqueViolation(retryError) && /email/i.test(retryError.message)) {
          const { error: nameOnly } = await supabase
            .from('landlords')
            .update({ name: companyName || 'New Landlord' })
            .eq('id', scope.landlordId)
          if (!nameOnly) return finishAccountPersistOk(scope.landlordId, email)
          return {
            ok: false,
            error:
              'That email is already used by another account. Use a different email.',
          }
        }
        console.warn('[landlordOnboarding] persist account profile', retryError.message)
        return {
          ok: false,
          error: getErrorMessage(retryError, 'Couldn’t save account details. Please try again.'),
        }
      }
      return finishAccountPersistOk(scope.landlordId, email)
    }
    console.warn('[landlordOnboarding] persist account profile', error.message)
    return {
      ok: false,
      error: getErrorMessage(error, 'Couldn’t save account details. Please try again.'),
    }
  }

  const { recordActivityLog } = await import('@/lib/recordActivityLog')
  await recordActivityLog({
    landlordId: scope.landlordId,
    eventType: 'landlord.account_profile_updated',
    source: 'onboarding',
    actorType: 'landlord',
    metadata: {
      message: companyName
        ? `Account profile updated for ${companyName}.`
        : 'Account profile updated.',
      company_name: companyName || null,
      contact_name: contactName || null,
      step: 'account_setup',
    },
  })

  return finishAccountPersistOk(scope.landlordId, email)
}

/** Persist communication style on the landlord account (source of truth for outbound tone). */
export async function persistLandlordCommunicationStyle(
  landlordId: string,
  style: string,
  options?: {
    eventType?: 'landlord.communication_style_selected' | 'landlord.communication_style_updated'
    step?: string
    source?: string
  },
): Promise<void> {
  if (!supabase) return
  const communicationStyle = normalizeOnboardingApprovalRules({
    communication_style: style,
  }).communicationStyle
  const { error } = await supabase
    .from('landlords')
    .update({ communication_style: communicationStyle })
    .eq('id', landlordId)
  if (error) {
    console.warn('[landlordOnboarding] persist communication style', error.message)
    return
  }
  const { recordActivityLog } = await import('@/lib/recordActivityLog')
  await recordActivityLog({
    landlordId,
    eventType: options?.eventType ?? 'landlord.communication_style_updated',
    source: options?.source ?? 'admin_ui',
    actorType: 'landlord',
    metadata: {
      message: `Communication style set to ${communicationStyle}.`,
      communication_style: communicationStyle,
      step: options?.step ?? 'settings',
    },
  })
}


export async function fetchAccountSetupCounts(
  landlordId: string = getActiveLandlordId(),
): Promise<AccountSetupCounts> {
  if (!supabase) {
    return { properties: 0, units: 0, residents: 0, vendors: 0, workflowRuns: 0 }
  }

  const [propertiesRes, unitsRes, residentsRes, vendorsRes, runsRes] = await Promise.all([
    supabase.from('properties').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    supabase.from('units').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    supabase.from('vendors').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    supabase.from('workflow_runs').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
  ])

  return {
    properties: propertiesRes.count ?? 0,
    units: unitsRes.count ?? 0,
    residents: residentsRes.count ?? 0,
    vendors: vendorsRes.count ?? 0,
    workflowRuns: runsRes.count ?? 0,
  }
}
