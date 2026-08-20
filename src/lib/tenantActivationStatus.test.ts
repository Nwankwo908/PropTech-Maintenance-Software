import { describe, expect, it } from 'vitest'
import { resolveTenantActivationChip } from './tenantActivationStatus'

describe('resolveTenantActivationChip — SMS consent stays in sync with activation', () => {
  it('shows Opted out after STOP (consent and activation both opted_out)', () => {
    const chip = resolveTenantActivationChip({
      activationStatus: 'opted_out',
      smsConsentStatus: 'opted_out',
    })
    expect(chip.status).toBe('opted_out')
    expect(chip.label).toBe('Opted out')
  })

  it('shows Activated after START re-opt-in (consent opted_in + activation activated)', () => {
    const chip = resolveTenantActivationChip({
      activationStatus: 'activated',
      smsConsentStatus: 'opted_in',
    })
    expect(chip.status).toBe('activated')
    expect(chip.label).toBe('Activated')
  })

  it('cannot show Waiting or Action Required when SMS is opted in after START', () => {
    const chip = resolveTenantActivationChip({
      activationStatus: 'activated',
      smsConsentStatus: 'opted_in',
      activationSmsSentAt: '2026-08-01T00:00:00.000Z',
      activationAttemptCount: 3,
    })
    expect(chip.status).toBe('activated')
    expect(chip.label).toBe('Activated')
    expect(chip.status).not.toBe('waiting')
    expect(chip.status).not.toBe('action_required')
  })

  it('shows Waiting only before the resident has opted in', () => {
    const chip = resolveTenantActivationChip({
      activationStatus: 'waiting',
      smsConsentStatus: 'pending',
      activationSmsSentAt: '2026-08-01T00:00:00.000Z',
    })
    expect(chip.status).toBe('waiting')
    expect(chip.label).toBe('Waiting for Resident')
  })
})
