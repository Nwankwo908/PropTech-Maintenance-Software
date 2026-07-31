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
        return { ok: true }
      }
      if (/contact_name|phone|column .* does not exist/i.test(retryWithoutEmail.message)) {
        const { error: nameOnly } = await supabase
          .from('landlords')
          .update({ name: companyName || 'New Landlord' })
          .eq('id', scope.landlordId)
        if (!nameOnly) return { ok: true }
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
          if (!nameOnly) return { ok: true }
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
      return { ok: true }
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

  return { ok: true }
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

  const [unitsRes, residentsRes, vendorsRes, runsRes] = await Promise.all([
    supabase.from('units').select('id, building', { count: 'exact', head: false }).eq('landlord_id', landlordId),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    supabase.from('vendors').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    supabase.from('workflow_runs').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
  ])

  const buildings = new Set<string>()
  for (const row of unitsRes.data ?? []) {
    const b = String((row as { building?: string }).building ?? '').trim()
    if (b) buildings.add(b)
  }

  return {
    properties: buildings.size,
    units: unitsRes.count ?? (unitsRes.data ?? []).length,
    residents: residentsRes.count ?? 0,
    vendors: vendorsRes.count ?? 0,
    workflowRuns: runsRes.count ?? 0,
  }
}
