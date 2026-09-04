/**
 * Landlord account profile — DB source of truth for Alpha / New Landlord settings.
 * Onboarding account setup and Settings → Organization read/write through here.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  DEFAULT_COMMUNICATION_STYLE,
  normalizeCommunicationStyle,
  type CommunicationStyle,
} from '@/lib/communicationStyle'
import type { OnboardingAccountSetup } from '@/lib/onboarding/types'
import { resolveLandlordSupportEmail } from '@/lib/landlordSupportEmail'
import { supabase } from '@/lib/supabase'

export type LandlordAccountProfile = {
  companyName: string
  contactName: string
  email: string
  phone: string
  backupContactName: string
  backupContactPhone: string
  communicationStyle: CommunicationStyle
  autoApprovalThreshold: number | null
  marketplacePreference: string | null
  notificationChannel: string | null
  smsConsentAcceptedAt: string | null
}

export const EMPTY_LANDLORD_ACCOUNT_PROFILE: LandlordAccountProfile = {
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  backupContactName: '',
  backupContactPhone: '',
  communicationStyle: DEFAULT_COMMUNICATION_STYLE,
  autoApprovalThreshold: null,
  marketplacePreference: null,
  notificationChannel: null,
  smsConsentAcceptedAt: null,
}

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function accountSetupFromDraft(draft: Record<string, unknown>): OnboardingAccountSetup {
  const row = (draft.accountSetup ?? {}) as Record<string, unknown>
  return {
    companyName: asTrimmed(row.companyName),
    contactName: asTrimmed(row.contactName),
    email: asTrimmed(row.email),
    phone: asTrimmed(row.phone),
    backupContactName: asTrimmed(row.backupContactName),
    backupContactPhone: asTrimmed(row.backupContactPhone),
    smsConsentAcceptedAt:
      typeof row.smsConsentAcceptedAt === 'string' ? row.smsConsentAcceptedAt : null,
  }
}

export function profileFromAccountSetupFields(
  account: Pick<
    OnboardingAccountSetup,
    | 'companyName'
    | 'contactName'
    | 'email'
    | 'phone'
    | 'backupContactName'
    | 'backupContactPhone'
    | 'smsConsentAcceptedAt'
  >,
): LandlordAccountProfile {
  return {
    companyName: account.companyName.trim(),
    contactName: account.contactName.trim(),
    email: account.email.trim(),
    phone: account.phone.trim(),
    backupContactName: account.backupContactName.trim(),
    backupContactPhone: account.backupContactPhone.trim(),
    communicationStyle: DEFAULT_COMMUNICATION_STYLE,
    autoApprovalThreshold: null,
    marketplacePreference: null,
    notificationChannel: null,
    smsConsentAcceptedAt: account.smsConsentAcceptedAt ?? null,
  }
}

export function notificationTogglesFromChannel(channel: string | null | undefined): {
  emailUpdates: boolean
  smsAlerts: boolean
  activityFeedAlerts: boolean
} {
  const normalized = asTrimmed(channel).toLowerCase()
  if (normalized === 'sms') {
    return { emailUpdates: false, smsAlerts: true, activityFeedAlerts: false }
  }
  if (normalized === 'email') {
    return { emailUpdates: true, smsAlerts: false, activityFeedAlerts: false }
  }
  if (normalized === 'activity_feed') {
    return { emailUpdates: false, smsAlerts: false, activityFeedAlerts: true }
  }
  if (normalized === 'both') {
    return { emailUpdates: true, smsAlerts: true, activityFeedAlerts: true }
  }
  return { emailUpdates: true, smsAlerts: true, activityFeedAlerts: true }
}

export function notificationChannelFromToggles(toggles: {
  emailUpdates: boolean
  smsAlerts: boolean
  activityFeedAlerts: boolean
}): string {
  const email = toggles.emailUpdates
  const sms = toggles.smsAlerts
  const feed = toggles.activityFeedAlerts
  if (email && sms && feed) return 'both'
  if (email && sms) return 'both'
  if (feed && !email && !sms) return 'activity_feed'
  if (sms && !email) return 'sms'
  if (email && !sms) return 'email'
  if (sms) return 'sms'
  if (email) return 'email'
  if (feed) return 'activity_feed'
  return 'both'
}

export function marketplaceLabelFromPreference(
  preference: string | null | undefined,
): string | null {
  if (preference === 'ulo_vetted_only') return 'Ulo-vetted vendors only'
  if (preference === 'include_imported') return 'Include imported vendors'
  return null
}

export function marketplacePreferenceFromLabel(label: string): string | null {
  if (label === 'Ulo-vetted vendors only') return 'ulo_vetted_only'
  if (label === 'Include imported vendors') return 'include_imported'
  if (label === 'All active vendors') return 'include_imported'
  return null
}

/** Load canonical landlord profile from landlords + landlord_onboarding. */
export async function fetchLandlordAccountProfile(
  landlordId: string = getActiveLandlordId(),
): Promise<LandlordAccountProfile> {
  if (!supabase) return { ...EMPTY_LANDLORD_ACCOUNT_PROFILE }

  const [{ data: landlord }, { data: onboarding }] = await Promise.all([
    supabase
      .from('landlords')
      .select('name, email, phone, contact_name, communication_style')
      .eq('id', landlordId)
      .maybeSingle(),
    supabase
      .from('landlord_onboarding')
      .select(
        'auto_approval_threshold, marketplace_preference, draft_state, account_settings, communication_style, notification_channel',
      )
      .eq('landlord_id', landlordId)
      .maybeSingle(),
  ])

  const draft = ((onboarding?.draft_state ?? {}) as Record<string, unknown>) ?? {}
  const account = accountSetupFromDraft(draft)
  const accountSettings =
    onboarding?.account_settings && typeof onboarding.account_settings === 'object'
      ? (onboarding.account_settings as Record<string, unknown>)
      : {}
  const org = {
    ...((draft.organizationSettings ?? {}) as Record<string, unknown>),
    ...((accountSettings.organization ?? {}) as Record<string, unknown>),
  }

  const profile: LandlordAccountProfile = {
    companyName: asTrimmed(landlord?.name) || account.companyName,
    contactName: asTrimmed(landlord?.contact_name) || account.contactName,
    email: resolveLandlordSupportEmail({
      accountSetupEmail: account.email,
      organizationSupportEmail: asTrimmed(org.supportEmail),
      landlordEmail: asTrimmed(landlord?.email),
    }),
    phone: asTrimmed(landlord?.phone) || account.phone,
    backupContactName: account.backupContactName,
    backupContactPhone: account.backupContactPhone,
    communicationStyle: normalizeCommunicationStyle(
      asTrimmed(landlord?.communication_style) ||
        asTrimmed(onboarding?.communication_style) ||
        DEFAULT_COMMUNICATION_STYLE,
    ),
    autoApprovalThreshold:
      onboarding?.auto_approval_threshold != null &&
      Number.isFinite(Number(onboarding.auto_approval_threshold))
        ? Math.round(Number(onboarding.auto_approval_threshold))
        : null,
    marketplacePreference: asTrimmed(onboarding?.marketplace_preference) || null,
    notificationChannel: asTrimmed(onboarding?.notification_channel) || null,
    smsConsentAcceptedAt: account.smsConsentAcceptedAt,
  }

  const approvalRules = draft.approvalRules as { notificationChannel?: string } | undefined
  if (!profile.notificationChannel && approvalRules?.notificationChannel) {
    profile.notificationChannel = asTrimmed(approvalRules.notificationChannel)
  }

  return profile
}

/** Persist profile fields shared by onboarding account setup and Settings → Organization. */
export async function persistLandlordAccountProfileFields(
  landlordId: string,
  fields: Pick<
    LandlordAccountProfile,
    | 'companyName'
    | 'contactName'
    | 'email'
    | 'phone'
    | 'backupContactName'
    | 'backupContactPhone'
  >,
): Promise<{ ok: boolean; error?: string }> {
  const { persistLandlordAccountProfile } = await import('@/lib/onboarding/persist/account')
  return persistLandlordAccountProfile(landlordId, {
    companyName: fields.companyName,
    contactName: fields.contactName,
    email: fields.email,
    phone: fields.phone,
    backupContactName: fields.backupContactName,
    backupContactPhone: fields.backupContactPhone,
    smsConsentAcceptedAt: null,
  })
}
