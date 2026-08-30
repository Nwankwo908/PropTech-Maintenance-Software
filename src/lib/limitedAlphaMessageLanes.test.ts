import { describe, expect, it } from 'vitest'
import {
  classifyLimitedAlphaMessageLane,
  looksLikeNonOnboardingInboundSms,
} from '@/lib/limitedAlphaMessageLanes'

const WELCOME =
  "You can now reach us by text anytime you need a repair or have a question. Reply YES to get updates about your maintenance requests and important property notices."

describe('looksLikeNonOnboardingInboundSms', () => {
  it('ignores YES/START activation replies', () => {
    expect(looksLikeNonOnboardingInboundSms('YES')).toBe(false)
    expect(looksLikeNonOnboardingInboundSms('start')).toBe(false)
  })

  it('treats a leak report as a request inbound', () => {
    expect(looksLikeNonOnboardingInboundSms('Kitchen sink is leaking')).toBe(true)
  })
})

describe('classifyLimitedAlphaMessageLane', () => {
  it('puts welcome-only tenant threads in onboarding', () => {
    expect(
      classifyLimitedAlphaMessageLane({
        hasMaintenanceRequest: false,
        hasOnboardingCopy: true,
        hasNonOnboardingInbound: false,
      }),
    ).toBe('onboarding')
  })

  it('puts a ticketed thread in requests even if welcome copy is still on the thread', () => {
    expect(
      classifyLimitedAlphaMessageLane({
        hasMaintenanceRequest: true,
        hasOnboardingCopy: true,
        hasNonOnboardingInbound: true,
      }),
    ).toBe('request')
  })

  it('puts a welcome thread that later reports a problem in requests before a ticket exists', () => {
    expect(
      classifyLimitedAlphaMessageLane({
        hasMaintenanceRequest: false,
        hasOnboardingCopy: true,
        hasNonOnboardingInbound: looksLikeNonOnboardingInboundSms('Kitchen sink is leaking'),
      }),
    ).toBe('request')
  })

  it('puts vendor setup inbox rows in onboarding', () => {
    expect(
      classifyLimitedAlphaMessageLane({
        hasMaintenanceRequest: false,
        isVendorSetupInbox: true,
        hasOnboardingCopy: false,
        hasNonOnboardingInbound: false,
      }),
    ).toBe('onboarding')
  })

  it('puts synthetic work-order inbox rows in requests', () => {
    expect(
      classifyLimitedAlphaMessageLane({
        hasMaintenanceRequest: false,
        isWorkOrderInboxRow: true,
        hasOnboardingCopy: false,
        hasNonOnboardingInbound: false,
      }),
    ).toBe('request')
  })

  it('detects tenant welcome copy', () => {
    expect(WELCOME.toLowerCase()).toContain('reply yes to get updates about your maintenance requests')
  })
})
