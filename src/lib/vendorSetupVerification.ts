import { hasVendorIntakeSubmission } from '@/lib/vendorIntakeForm'
import {
  formatVendorPricingConfirmationStatus,
  isVendorPricingMutuallyConfirmed,
} from '@/lib/vendorPricingConfirmation'
import type { VerificationChecklistItem } from '@/lib/externalVendorVerification'

export type VendorSetupVerificationStatus =
  | 'sending'
  | 'awaiting'
  | 'form_received'
  | 'complete'

export type VendorSetupVerificationState = {
  status: VendorSetupVerificationStatus
  detail: string
}

export function initialVendorSetupVerificationState(): VendorSetupVerificationState {
  return {
    status: 'sending',
    detail: 'Sending your message…',
  }
}

export function markVendorSetupRequestSent(): VendorSetupVerificationState {
  return {
    status: 'awaiting',
    detail: 'Waiting for reply · Quick form sent by text and email',
  }
}

export function markVendorSetupFormReceived(): VendorSetupVerificationState {
  return {
    status: 'form_received',
    detail: 'Quick form on file · Pricing needs confirmation from you and the vendor',
  }
}

/** Merge local setup progress with intake submission + dual pricing confirmation. */
export function resolveVendorSetupVerificationState(
  localState: VendorSetupVerificationState,
  conversationId: string,
): VendorSetupVerificationState {
  if (localState.status === 'sending' || localState.status === 'awaiting') {
    return localState
  }

  if (!hasVendorIntakeSubmission(conversationId)) {
    return localState
  }

  if (isVendorPricingMutuallyConfirmed(conversationId)) {
    return {
      status: 'complete',
      detail: 'Setup complete · Pricing confirmed by you and the vendor',
    }
  }

  return {
    status: 'form_received',
    detail: `Quick form on file · ${formatVendorPricingConfirmationStatus(conversationId)}`,
  }
}

export function buildVendorSetupChecklistItem(
  state: VendorSetupVerificationState,
): VerificationChecklistItem {
  return {
    id: 'vendor-setup',
    title: 'Vendor setup',
    required: true,
    detail: state.detail,
    verified: state.status === 'complete',
    requiresViewMessageAction:
      state.status === 'awaiting' ||
      state.status === 'form_received' ||
      state.status === 'complete',
  }
}
