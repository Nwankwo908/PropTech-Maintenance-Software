import { describe, expect, it } from 'vitest'
import {
  classifyLimitedAlphaMessageLane,
  looksLikeNonOnboardingInboundSms,
} from '@/lib/limitedAlphaMessageLanes'

const WELCOME =
  "Hi Sebastian! Meet Ulo, your Oak Properties's text assistant for your home.\n\n🏡 Need something for your home? Just text Ulo.\n\nFrom reporting repairs to getting property updates and reminders, Ulo helps you get the information and assistance you need, all through text.\n\n📲 Save this number as Ulo Assistant so you can easily find us when you need help.\n\nReply YES to activate | NO to opt out | HELP for help | STOP to unsubscribe. Msg & data rates may apply."

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
    expect(WELCOME.toLowerCase()).toContain('reply yes to activate | no to opt out')
    expect(looksLikeNonOnboardingInboundSms(WELCOME)).toBe(false)
  })
})
