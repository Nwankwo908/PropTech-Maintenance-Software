/**
 * Factory-reset blank shape for Limited Alpha 1 / 2 Account Setup fields.
 *
 * Account Setup writes into landlords + landlord_onboarding (draft_state,
 * account_settings, emergency_contact, notification columns). Factory reset
 * must restore this expected blank/seeded shape — assert rather than listing
 * fields ad hoc at each call site.
 */
import {
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
} from '@shared/landlordCapabilities'
import {
  defaultOnboardingApprovalRules,
  type OnboardingApprovalRules,
} from '@/lib/onboardingApprovalRules'
import type { OnboardingAccountSetup } from './types'

export type FactoryResetLandlordSeed = {
  name: string
  email: string
}

export type FactoryResetAccountShape = {
  landlordId: string
  landlord: {
    name: string
    email: string
    contact_name: null
    phone: null
  }
  onboarding: {
    onboarding_status: 'not_started'
    current_step: 'entry'
    account_settings: Record<string, never>
    emergency_contact: Record<string, never>
    draft_account_setup: OnboardingAccountSetup
    approval_rules: OnboardingApprovalRules
  }
}

const EMPTY_ACCOUNT_SETUP: OnboardingAccountSetup = {
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  backupContactName: '',
  backupContactPhone: '',
  backupContactEmail: '',
  smsConsentAcceptedAt: null,
}

/** Seeded Limited Alpha display name + system mailbox (portal members stay). */
export function factoryResetLandlordSeed(
  landlordId: string,
): FactoryResetLandlordSeed | null {
  if (landlordId === LIMITED_ALPHA_1_LANDLORD_ID) {
    return { name: 'Limited Alpha 1', email: 'limitedalpha1@ulohome.io' }
  }
  if (landlordId === LIMITED_ALPHA_2_LANDLORD_ID) {
    return { name: 'Limited Alpha 2', email: 'limitedalpha2@ulohome.io' }
  }
  return null
}

/** Expected post–factory-reset shape for Account Setup–writable fields. */
export function expectedFactoryResetAccountShape(
  landlordId: string,
): FactoryResetAccountShape | null {
  const seed = factoryResetLandlordSeed(landlordId)
  if (!seed) return null
  return {
    landlordId,
    landlord: {
      name: seed.name,
      email: seed.email,
      contact_name: null,
      phone: null,
    },
    onboarding: {
      onboarding_status: 'not_started',
      current_step: 'entry',
      account_settings: {},
      emergency_contact: {},
      draft_account_setup: { ...EMPTY_ACCOUNT_SETUP },
      approval_rules: defaultOnboardingApprovalRules(),
    },
  }
}

export type FactoryResetShapeSnapshot = {
  landlord: {
    name: string | null
    email: string | null
    contact_name: string | null
    phone: string | null
  }
  onboarding: {
    onboarding_status: string | null
    current_step: string | null
    account_settings: unknown
    emergency_contact: unknown
    draft_state: unknown
    auto_approval_threshold: unknown
    notification_preference: unknown
    notification_channel: unknown
    communication_style: unknown
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normNullableText(value: unknown): string | null {
  const text = normText(value)
  return text ? text : null
}

function isEmptyObject(value: unknown): boolean {
  const row = asRecord(value)
  return Object.keys(row).length === 0
}

function accountSetupFromDraft(draftState: unknown): OnboardingAccountSetup {
  const draft = asRecord(draftState)
  const raw = asRecord(draft.accountSetup)
  return {
    companyName: normText(raw.companyName),
    contactName: normText(raw.contactName),
    email: normText(raw.email),
    phone: normText(raw.phone),
    backupContactName: normText(raw.backupContactName ?? raw.backup_contact_name),
    backupContactPhone: normText(raw.backupContactPhone ?? raw.backup_contact_phone),
    backupContactEmail: normText(raw.backupContactEmail ?? raw.backup_contact_email),
    smsConsentAcceptedAt:
      typeof raw.smsConsentAcceptedAt === 'string' && raw.smsConsentAcceptedAt.trim()
        ? raw.smsConsentAcceptedAt.trim()
        : null,
  }
}

/**
 * Diff a live row against the expected blank shape.
 * Returns path strings for every mismatch (empty array = pass).
 */
export function diffFactoryResetAccountShape(
  expected: FactoryResetAccountShape,
  actual: FactoryResetShapeSnapshot,
): string[] {
  const mismatches: string[] = []
  const push = (path: string, want: unknown, got: unknown) => {
    mismatches.push(`${path}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }

  if (normText(actual.landlord.name) !== expected.landlord.name) {
    push('landlords.name', expected.landlord.name, actual.landlord.name)
  }
  if (normText(actual.landlord.email).toLowerCase() !== expected.landlord.email.toLowerCase()) {
    push('landlords.email', expected.landlord.email, actual.landlord.email)
  }
  if (normNullableText(actual.landlord.contact_name) !== null) {
    push('landlords.contact_name', null, actual.landlord.contact_name)
  }
  if (normNullableText(actual.landlord.phone) !== null) {
    push('landlords.phone', null, actual.landlord.phone)
  }

  if (normText(actual.onboarding.onboarding_status) !== expected.onboarding.onboarding_status) {
    push(
      'landlord_onboarding.onboarding_status',
      expected.onboarding.onboarding_status,
      actual.onboarding.onboarding_status,
    )
  }
  if (normText(actual.onboarding.current_step) !== expected.onboarding.current_step) {
    push(
      'landlord_onboarding.current_step',
      expected.onboarding.current_step,
      actual.onboarding.current_step,
    )
  }
  if (!isEmptyObject(actual.onboarding.account_settings)) {
    push('landlord_onboarding.account_settings', {}, actual.onboarding.account_settings)
  }
  if (!isEmptyObject(actual.onboarding.emergency_contact)) {
    push('landlord_onboarding.emergency_contact', {}, actual.onboarding.emergency_contact)
  }

  const setup = accountSetupFromDraft(actual.onboarding.draft_state)
  const wantSetup = expected.onboarding.draft_account_setup
  for (const key of Object.keys(wantSetup) as (keyof OnboardingAccountSetup)[]) {
    if (setup[key] !== wantSetup[key]) {
      push(`landlord_onboarding.draft_state.accountSetup.${key}`, wantSetup[key], setup[key])
    }
  }

  const rules = expected.onboarding.approval_rules
  const threshold = Number(actual.onboarding.auto_approval_threshold)
  if (!Number.isFinite(threshold) || Math.round(threshold) !== rules.autoApprovalThreshold) {
    push(
      'landlord_onboarding.auto_approval_threshold',
      rules.autoApprovalThreshold,
      actual.onboarding.auto_approval_threshold,
    )
  }
  if (normText(actual.onboarding.notification_preference) !== rules.notificationPreference) {
    push(
      'landlord_onboarding.notification_preference',
      rules.notificationPreference,
      actual.onboarding.notification_preference,
    )
  }
  if (normText(actual.onboarding.notification_channel) !== rules.notificationChannel) {
    push(
      'landlord_onboarding.notification_channel',
      rules.notificationChannel,
      actual.onboarding.notification_channel,
    )
  }
  if (normText(actual.onboarding.communication_style) !== rules.communicationStyle) {
    push(
      'landlord_onboarding.communication_style',
      rules.communicationStyle,
      actual.onboarding.communication_style,
    )
  }

  return mismatches
}

export function assertFactoryResetAccountShape(
  expected: FactoryResetAccountShape,
  actual: FactoryResetShapeSnapshot,
): { ok: true } | { ok: false; error: string; mismatches: string[] } {
  const mismatches = diffFactoryResetAccountShape(expected, actual)
  if (mismatches.length === 0) return { ok: true }
  return {
    ok: false,
    mismatches,
    error: `Factory reset left Account Setup fields dirty:\n${mismatches.join('\n')}`,
  }
}

/** landlord_onboarding columns cleared to the blank shape (including draft accountSetup). */
export function factoryResetOnboardingClearRow(
  expected: FactoryResetAccountShape,
): Record<string, unknown> {
  const rules = expected.onboarding.approval_rules
  return {
    onboarding_status: expected.onboarding.onboarding_status,
    current_step: expected.onboarding.current_step,
    account_settings: expected.onboarding.account_settings,
    emergency_contact: expected.onboarding.emergency_contact,
    draft_state: {
      setupPath: null,
      accountSetup: expected.onboarding.draft_account_setup,
      approvalRules: rules,
    },
    properties: [],
    auto_approval_threshold: rules.autoApprovalThreshold,
    notification_preference: rules.notificationPreference,
    notification_channel: rules.notificationChannel,
    communication_style: rules.communicationStyle,
    after_hours_rule: rules.afterHoursRule,
    marketplace_preference: rules.marketplacePreference,
    emergency_types: rules.emergencyTypes,
    completed_at: null,
    onboarding_session_id: null,
    onboarding_session_started_at: null,
    updated_at: new Date().toISOString(),
  }
}
