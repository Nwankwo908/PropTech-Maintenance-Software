/**
 * Fast Track account + extra review fields. Company name can come from documents
 * (landlord / lessor / management company) or from the saved landlord profile.
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

const PLACEHOLDER_COMPANY_NAMES = new Set([
  'new landlord',
  'your portfolio',
  'ulo',
  'ulo home',
  'ulo home, inc',
  'ulo home inc',
])

/** Drop empty and system placeholder company names so extraction can fill the field. */
export function usableOnboardingCompanyName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim()
  if (!name) return ''
  if (PLACEHOLDER_COMPANY_NAMES.has(name.toLowerCase())) return ''
  return name
}

export function emptyReviewManualAccount(
  seed?: Partial<OnboardingAccountSetup> | OnboardingReviewManualAccount | null,
): OnboardingReviewManualAccount {
  return {
    companyName: usableOnboardingCompanyName(seed?.companyName),
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
    companyName: usableOnboardingCompanyName(String(row.companyName ?? '')),
    contactName: String(row.contactName ?? '').trim(),
    email: String(row.email ?? '').trim(),
    phone: String(row.phone ?? '').trim(),
    backupContactName: String(row.backupContactName ?? row.backup_contact_name ?? '').trim(),
    backupContactPhone: String(row.backupContactPhone ?? row.backup_contact_phone ?? '').trim(),
    smsConsentAcceptedAt:
      typeof consent === 'string' && consent.trim() ? consent.trim() : null,
  }
}

/** Fill blank account fields from a fallback (profile seed or extracted landlord). */
export function mergeReviewManualAccount(
  primary: unknown,
  fallback?: Partial<OnboardingAccountSetup> | OnboardingReviewManualAccount | null,
): OnboardingReviewManualAccount {
  const a = normalizeReviewManualAccount(primary)
  const b = emptyReviewManualAccount(fallback)
  return {
    companyName: a.companyName || b.companyName,
    contactName: a.contactName || b.contactName,
    email: a.email || b.email,
    phone: a.phone || b.phone,
    backupContactName: a.backupContactName || b.backupContactName,
    backupContactPhone: a.backupContactPhone || b.backupContactPhone,
    smsConsentAcceptedAt: a.smsConsentAcceptedAt || b.smsConsentAcceptedAt,
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
