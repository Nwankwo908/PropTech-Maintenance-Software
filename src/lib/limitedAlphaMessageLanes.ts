import {
  isTenantOnboardingInvite,
  isVendorOnboardingInvite,
} from '@/lib/conversationMonitoring'

export type LimitedAlphaMessageLane = 'onboarding' | 'request'

const SHORT_ACTIVATION_REPLY = /^(yes|y|yeah|yep|ok|okay|start|stop|help|no)$/i

/** Inbound that is more than a welcome YES/STOP or the onboarding copy itself. */
export function looksLikeNonOnboardingInboundSms(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (SHORT_ACTIVATION_REPLY.test(text)) return false
  if (isTenantOnboardingInvite(text) || isVendorOnboardingInvite(text)) return false
  return true
}

/**
 * Limited Alpha 1 Messages: keep tenant/vendor onboarding threads out of
 * maintenance request threads. A ticket (or a later problem-report inbound)
 * always wins so mixed welcome + repair SMS land under Requests.
 */
export function classifyLimitedAlphaMessageLane(input: {
  hasMaintenanceRequest: boolean
  isWorkOrderInboxRow?: boolean
  isVendorSetupInbox?: boolean
  hasOnboardingCopy: boolean
  hasNonOnboardingInbound: boolean
}): LimitedAlphaMessageLane {
  if (input.isWorkOrderInboxRow || input.hasMaintenanceRequest) return 'request'
  if (input.hasNonOnboardingInbound) return 'request'
  if (input.isVendorSetupInbox || input.hasOnboardingCopy) return 'onboarding'
  return 'request'
}
