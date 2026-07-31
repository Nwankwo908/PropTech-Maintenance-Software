/**
 * Maintenance approval rules collected during landlord onboarding
 * (guided + fast track). Defaults match landlord_onboarding DB defaults.
 */

import {
  DEFAULT_COMMUNICATION_STYLE,
  normalizeCommunicationStyle,
  type CommunicationStyle,
} from '@/lib/communicationStyle'

export type { CommunicationStyle }

export type EmergencyTypeId =
  | 'no_heat'
  | 'no_hot_water'
  | 'flood_active_leak'
  | 'no_power'
  | 'security_breach'
  | 'gas_smell'

export type AfterHoursRuleId =
  | 'auto_approve_emergencies'
  | 'require_approval'
  | 'no_after_hours'

export type MarketplacePreferenceId = 'ulo_vetted_only' | 'include_imported'

export type NotificationPreferenceId = 'all_jobs' | 'urgent_only' | 'daily_digest'

export type NotificationChannelId = 'sms' | 'email' | 'activity_feed' | 'both'

export type OnboardingApprovalRules = {
  autoApprovalThreshold: number
  emergencyTypes: EmergencyTypeId[]
  afterHoursRule: AfterHoursRuleId
  marketplacePreference: MarketplacePreferenceId
  notificationPreference: NotificationPreferenceId
  notificationChannel: NotificationChannelId
  /** When true, mute non-emergency alerts between quietHoursStart and quietHoursEnd. */
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  /** Tone for Ulo-generated operational SMS and email. */
  communicationStyle: CommunicationStyle
}

export const DEFAULT_AUTO_APPROVAL_THRESHOLD = 250

export const ALL_EMERGENCY_TYPE_IDS: EmergencyTypeId[] = [
  'no_heat',
  'no_hot_water',
  'flood_active_leak',
  'no_power',
  'security_breach',
  'gas_smell',
]

export const EMERGENCY_TYPE_OPTIONS: { id: EmergencyTypeId; label: string }[] = [
  { id: 'no_heat', label: 'No heat' },
  { id: 'no_hot_water', label: 'No hot water' },
  { id: 'flood_active_leak', label: 'Flood / active leak' },
  { id: 'no_power', label: 'No power' },
  { id: 'security_breach', label: 'Security breach' },
  { id: 'gas_smell', label: 'Gas smell' },
]

export const AFTER_HOURS_RULE_OPTIONS: {
  id: AfterHoursRuleId
  label: string
  description: string
}[] = [
  {
    id: 'auto_approve_emergencies',
    label: 'Auto-approve emergencies',
    description: 'After hours, emergencies can proceed without waiting on you.',
  },
  {
    id: 'require_approval',
    label: 'Require your approval',
    description: 'After hours, Ulo waits for your sign-off before dispatching.',
  },
  {
    id: 'no_after_hours',
    label: 'No after-hours jobs',
    description: 'Hold non-urgent work until business hours.',
  },
]

export const MARKETPLACE_PREFERENCE_OPTIONS: {
  id: MarketplacePreferenceId
  label: string
  description: string
}[] = [
  {
    id: 'ulo_vetted_only',
    label: 'Ulo-vetted vendors only',
    description: 'Dispatch from Ulo’s verified marketplace network.',
  },
  {
    id: 'include_imported',
    label: 'Include my imported vendors',
    description: 'Prefer your roster first, then fall back to Ulo-vetted vendors.',
  },
]

export const NOTIFICATION_PREFERENCE_OPTIONS: {
  id: NotificationPreferenceId
  label: string
  description?: string
}[] = [
  { id: 'all_jobs', label: 'All jobs', description: 'Get notified about every maintenance job.' },
  { id: 'urgent_only', label: 'Urgent only', description: 'Only urgent and emergency alerts.' },
  { id: 'daily_digest', label: 'Daily digest', description: 'One summary each day instead of every update.' },
]

export const NOTIFICATION_CHANNEL_OPTIONS: {
  id: NotificationChannelId
  label: string
  description?: string
}[] = [
  { id: 'sms', label: 'SMS', description: 'Text messages only.' },
  { id: 'email', label: 'Email', description: 'Email only.' },
  {
    id: 'activity_feed',
    label: 'Activity feed',
    description: 'Show alerts in the Ulo Activity Feed on Overview.',
  },
  {
    id: 'both',
    label: 'All channels',
    description: 'SMS, email, and the Ulo Activity Feed.',
  },
]

/** Quiet-hours window options shown during account setup. */
export const QUIET_HOURS_TIME_OPTIONS = [
  '12:00 AM',
  '1:00 AM',
  '2:00 AM',
  '3:00 AM',
  '4:00 AM',
  '5:00 AM',
  '6:00 AM',
  '7:00 AM',
  '8:00 AM',
  '9:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '1:00 PM',
  '2:00 PM',
  '3:00 PM',
  '4:00 PM',
  '5:00 PM',
  '6:00 PM',
  '7:00 PM',
  '8:00 PM',
  '9:00 PM',
  '10:00 PM',
  '11:00 PM',
] as const

export function defaultOnboardingApprovalRules(): OnboardingApprovalRules {
  return {
    autoApprovalThreshold: DEFAULT_AUTO_APPROVAL_THRESHOLD,
    emergencyTypes: [...ALL_EMERGENCY_TYPE_IDS],
    afterHoursRule: 'auto_approve_emergencies',
    marketplacePreference: 'include_imported',
    notificationPreference: 'urgent_only',
    notificationChannel: 'both',
    quietHoursEnabled: true,
    quietHoursStart: '10:00 PM',
    quietHoursEnd: '7:00 AM',
    communicationStyle: DEFAULT_COMMUNICATION_STYLE,
  }
}

const EMERGENCY_SET = new Set<string>(ALL_EMERGENCY_TYPE_IDS)

export function normalizeOnboardingApprovalRules(
  raw: unknown,
): OnboardingApprovalRules {
  const defaults = defaultOnboardingApprovalRules()
  if (!raw || typeof raw !== 'object') return defaults
  const row = raw as Record<string, unknown>

  const thresholdRaw = Number(row.autoApprovalThreshold ?? row.auto_approval_threshold)
  const autoApprovalThreshold =
    Number.isFinite(thresholdRaw) && thresholdRaw >= 0
      ? Math.round(thresholdRaw)
      : defaults.autoApprovalThreshold

  const emergencySource = Array.isArray(row.emergencyTypes)
    ? row.emergencyTypes
    : Array.isArray(row.emergency_types)
      ? row.emergency_types
      : defaults.emergencyTypes
  const emergencyTypes = emergencySource
    .map((item) => String(item).trim())
    .filter((id): id is EmergencyTypeId => EMERGENCY_SET.has(id))

  const afterHours =
    String(row.afterHoursRule ?? row.after_hours_rule ?? defaults.afterHoursRule).trim()
  const afterHoursRule = (
    AFTER_HOURS_RULE_OPTIONS.some((o) => o.id === afterHours)
      ? afterHours
      : defaults.afterHoursRule
  ) as AfterHoursRuleId

  const marketplace = String(
    row.marketplacePreference ?? row.marketplace_preference ?? defaults.marketplacePreference,
  ).trim()
  const marketplacePreference = (
    MARKETPLACE_PREFERENCE_OPTIONS.some((o) => o.id === marketplace)
      ? marketplace
      : defaults.marketplacePreference
  ) as MarketplacePreferenceId

  const notifPref = String(
    row.notificationPreference ?? row.notification_preference ?? defaults.notificationPreference,
  ).trim()
  const notificationPreference = (
    NOTIFICATION_PREFERENCE_OPTIONS.some((o) => o.id === notifPref)
      ? notifPref
      : defaults.notificationPreference
  ) as NotificationPreferenceId

  const notifChannel = String(
    row.notificationChannel ?? row.notification_channel ?? defaults.notificationChannel,
  ).trim()
  const notificationChannel = (
    NOTIFICATION_CHANNEL_OPTIONS.some((o) => o.id === notifChannel)
      ? notifChannel
      : defaults.notificationChannel
  ) as NotificationChannelId

  const quietHoursEnabledRaw = row.quietHoursEnabled ?? row.quiet_hours_enabled
  const quietHoursEnabled =
    typeof quietHoursEnabledRaw === 'boolean'
      ? quietHoursEnabledRaw
      : quietHoursEnabledRaw == null
        ? defaults.quietHoursEnabled
        : String(quietHoursEnabledRaw).trim().toLowerCase() !== 'false'

  const quietHoursStart = String(
    row.quietHoursStart ?? row.quiet_hours_start ?? defaults.quietHoursStart,
  ).trim() || defaults.quietHoursStart
  const quietHoursEnd = String(
    row.quietHoursEnd ?? row.quiet_hours_end ?? defaults.quietHoursEnd,
  ).trim() || defaults.quietHoursEnd

  const communicationStyle = normalizeCommunicationStyle(
    row.communicationStyle ?? row.communication_style ?? defaults.communicationStyle,
  )

  return {
    autoApprovalThreshold,
    emergencyTypes: emergencyTypes.length > 0 ? emergencyTypes : defaults.emergencyTypes,
    afterHoursRule,
    marketplacePreference,
    notificationPreference,
    notificationChannel,
    quietHoursEnabled,
    quietHoursStart,
    quietHoursEnd,
    communicationStyle,
  }
}

export function emergencyTypeLabel(id: EmergencyTypeId): string {
  return EMERGENCY_TYPE_OPTIONS.find((o) => o.id === id)?.label ?? id
}

export function afterHoursRuleLabel(id: AfterHoursRuleId): string {
  return AFTER_HOURS_RULE_OPTIONS.find((o) => o.id === id)?.label ?? id
}

export function marketplacePreferenceLabel(id: MarketplacePreferenceId): string {
  return MARKETPLACE_PREFERENCE_OPTIONS.find((o) => o.id === id)?.label ?? id
}

export function notificationPreferenceLabel(id: NotificationPreferenceId): string {
  return NOTIFICATION_PREFERENCE_OPTIONS.find((o) => o.id === id)?.label ?? id
}

export function notificationChannelLabel(id: NotificationChannelId): string {
  return NOTIFICATION_CHANNEL_OPTIONS.find((o) => o.id === id)?.label ?? id
}

export function quietHoursLabel(rules: Pick<
  OnboardingApprovalRules,
  'quietHoursEnabled' | 'quietHoursStart' | 'quietHoursEnd'
>): string {
  if (!rules.quietHoursEnabled) return 'Off'
  return `No alerts ${rules.quietHoursStart}–${rules.quietHoursEnd} except emergencies`
}

export function validateOnboardingApprovalRules(
  rules: OnboardingApprovalRules,
): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  if (!Number.isFinite(rules.autoApprovalThreshold) || rules.autoApprovalThreshold < 0) {
    missing.push('Auto-approval threshold')
  }
  if (rules.emergencyTypes.length === 0) {
    missing.push('At least one emergency type')
  }
  return { ok: missing.length === 0, missing }
}
