/**
 * Manual fields collected on Fast Track AI review that documents don't cover
 * (account profile, property location/PM, resident lease extras, preferred emergency).
 */
import type { OnboardingAccountSetup, OnboardingOccupancyStatus } from '@/lib/onboarding'
import { normalizeOnboardingOccupancyStatus } from '@/lib/onboarding'

export type OnboardingReviewManualAccount = {
  companyName: string
  contactName: string
  email: string
  phone: string
  backupContactName: string
  backupContactPhone: string
  smsConsentAcceptedAt: string | null
}

export function emptyReviewManualAccount(
  seed?: Partial<OnboardingAccountSetup> | null,
): OnboardingReviewManualAccount {
  return {
    companyName: seed?.companyName?.trim() ?? '',
    contactName: seed?.contactName?.trim() ?? '',
    email: seed?.email?.trim() ?? '',
    phone: seed?.phone?.trim() ?? '',
    backupContactName: seed?.backupContactName?.trim() ?? '',
    backupContactPhone: seed?.backupContactPhone?.trim() ?? '',
    smsConsentAcceptedAt: seed?.smsConsentAcceptedAt?.trim() || null,
  }
}

export function normalizeReviewManualAccount(raw: unknown): OnboardingReviewManualAccount {
  if (!raw || typeof raw !== 'object') return emptyReviewManualAccount()
  const row = raw as Record<string, unknown>
  const consent = row.smsConsentAcceptedAt ?? row.sms_consent_accepted_at
  return {
    companyName: String(row.companyName ?? ''),
    contactName: String(row.contactName ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    backupContactName: String(row.backupContactName ?? row.backup_contact_name ?? ''),
    backupContactPhone: String(row.backupContactPhone ?? row.backup_contact_phone ?? ''),
    smsConsentAcceptedAt:
      typeof consent === 'string' && consent.trim() ? consent.trim() : null,
  }
}

export function accountSetupFromReviewManual(
  account: OnboardingReviewManualAccount,
): OnboardingAccountSetup {
  return {
    companyName: account.companyName.trim(),
    contactName: account.contactName.trim(),
    email: account.email.trim(),
    phone: account.phone.trim(),
    backupContactName: account.backupContactName.trim(),
    backupContactPhone: account.backupContactPhone.trim(),
    smsConsentAcceptedAt: account.smsConsentAcceptedAt,
  }
}

export function validateReviewManualAccount(
  account: OnboardingReviewManualAccount,
): { ok: true } | { ok: false; error: string } {
  if (!account.companyName.trim() || !account.contactName.trim()) {
    return { ok: false, error: 'Enter your company name and contact name.' }
  }
  if (!account.smsConsentAcceptedAt) {
    return { ok: false, error: 'Please agree to the SMS terms to continue.' }
  }
  return { ok: true }
}

export function normalizeReviewOccupancyStatus(raw: unknown): OnboardingOccupancyStatus {
  return normalizeOnboardingOccupancyStatus(raw)
}
