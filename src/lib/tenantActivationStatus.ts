/**
 * Tenant activation status (landlord-facing) + retry schedule helpers.
 * Keep in sync with edge `tenantActivationRetry.ts` semantics.
 */

export type TenantActivationStatus =
  | 'not_started'
  | 'waiting'
  | 'delivery_failed'
  | 'action_required'
  | 'activated'
  | 'opted_out'

export const MAX_ACTIVATION_ATTEMPTS = 3
/** Hours after attempt 1 for automatic retry 2. */
export const ACTIVATION_RETRY_2_HOURS = 24
/** Hours after attempt 1 for automatic retry 3 (final). */
export const ACTIVATION_RETRY_3_HOURS = 72

export type TenantActivationChip = {
  status: TenantActivationStatus
  label: string
  detail: string
  className: string
  /** Show Resend / Edit Phone / Call when true. */
  actionRequired: boolean
  attemptCount: number
}

export function resolveTenantActivationChip(input: {
  activationStatus?: string | null
  smsConsentStatus?: string | null
  activationAttemptCount?: number | null
  activationSmsSentAt?: string | null
}): TenantActivationChip {
  const consent = (input.smsConsentStatus ?? '').trim().toLowerCase()
  const raw = (input.activationStatus ?? '').trim().toLowerCase()
  const attempts = Math.max(0, Math.floor(Number(input.activationAttemptCount) || 0))

  if (consent === 'opted_in' || raw === 'activated') {
    return {
      status: 'activated',
      label: 'Activated',
      detail: 'Resident opted in and can receive messages.',
      className: 'bg-[#dbfce7] text-[#008236]',
      actionRequired: false,
      attemptCount: attempts,
    }
  }
  if (consent === 'opted_out' || raw === 'opted_out') {
    return {
      status: 'opted_out',
      label: 'Opted out',
      detail: 'Resident replied STOP. Automatic activation stopped.',
      className: 'bg-[#f3f4f6] text-[#6a7282]',
      actionRequired: false,
      attemptCount: attempts,
    }
  }
  if (raw === 'action_required' || attempts >= MAX_ACTIVATION_ATTEMPTS) {
    return {
      status: 'action_required',
      label: 'Action Required',
      detail:
        "We couldn't deliver the welcome text after 3 attempts. Please verify the phone number or resend.",
      className: 'bg-[#fee2e2] text-[#991b1b]',
      actionRequired: true,
      attemptCount: Math.max(attempts, MAX_ACTIVATION_ATTEMPTS),
    }
  }
  if (raw === 'delivery_failed') {
    const retryOf = Math.min(Math.max(attempts, 1), MAX_ACTIVATION_ATTEMPTS)
    return {
      status: 'delivery_failed',
      label: `Delivery Failed (Retry ${retryOf} of ${MAX_ACTIVATION_ATTEMPTS})`,
      detail: 'Delivery failed. The system will retry automatically when eligible.',
      className: 'bg-[#ffedd5] text-[#9a3412]',
      actionRequired: false,
      attemptCount: attempts,
    }
  }
  if (raw === 'waiting' || input.activationSmsSentAt) {
    return {
      status: 'waiting',
      label: 'Waiting for Resident',
      detail: 'Welcome SMS sent. Waiting for the resident to reply YES.',
      className: 'bg-[#fef9c3] text-[#92400e]',
      actionRequired: false,
      attemptCount: attempts,
    }
  }
  return {
    status: 'not_started',
    label: 'Not started',
    detail: 'Welcome SMS has not been sent yet.',
    className: 'bg-[#f3f4f6] text-[#6a7282]',
    actionRequired: false,
    attemptCount: attempts,
  }
}
