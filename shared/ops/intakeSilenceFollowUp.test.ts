import { describe, expect, it } from 'vitest'
import { URGENCY_SLA_MINUTES } from '../maintenance/urgencyPolicy.ts'
import {
  INTAKE_SILENCE_NUDGE_MS,
  INTAKE_SILENCE_RESOLVE_MS,
  URGENT_INTAKE_SILENCE_NUDGE_MS,
  URGENT_INTAKE_SILENCE_RESOLVE_MS,
  LIFE_SAFETY_INTAKE_SILENCE_RESOLVE_MS,
  buildIntakeSilenceNudgeSms,
  classifyIntakeSilenceFollowUp,
  isEmergencyIntakeSilence,
  resolveIntakeSilenceAskedAt,
  thresholdsForIntakeSilence,
  type IntakeSilenceSnapshot,
} from './intakeSilenceFollowUp.ts'

function base(
  partial: Partial<IntakeSilenceSnapshot> = {},
): IntakeSilenceSnapshot {
  return {
    conversationId: 'conv-1',
    landlordId: 'll-1',
    step: 'diagnostic',
    diagnosticQuestionType: 'unit_entry',
    diagnosticQuestion:
      "If you're not home, may staff or a vendor enter the unit to make the repair? Reply YES, NO, or NOT SURE.",
    openQuestionAskedAt: '2026-09-29T20:37:24.000Z',
    silenceNudgeSentAt: null,
    silenceResolvedAt: null,
    draftTicketId: 'ticket-1',
    description: "I've seen mice in my apartment",
    issueHeadline: 'Pest issue',
    issueType: 'pest',
    vendorTrade: 'pest_control',
    urgency: 'low',
    urgencyAlertTier: null,
    ...partial,
  }
}

describe('urgency persistence signal (no recompute)', () => {
  it('treats intake_state.urgency=emergency as urgent without reclassifying text', () => {
    expect(
      isEmergencyIntakeSilence({
        urgency: 'emergency',
        urgencyAlertTier: null,
      }),
    ).toBe(true)
    expect(
      isEmergencyIntakeSilence({
        urgency: 'low',
        urgencyAlertTier: null,
      }),
    ).toBe(false)
  })

  it('treats urgency_alert_tier from the emergency SMS layer as urgent', () => {
    expect(
      isEmergencyIntakeSilence({
        urgency: 'normal',
        urgencyAlertTier: 'life_safety',
      }),
    ).toBe(true)
    expect(
      isEmergencyIntakeSilence({
        urgency: null,
        urgencyAlertTier: 'same_day',
      }),
    ).toBe(true)
  })
})

describe('thresholdsForIntakeSilence', () => {
  it('uses 3h/36h for routine pest drafts', () => {
    expect(thresholdsForIntakeSilence(base())).toEqual({
      nudgeMs: INTAKE_SILENCE_NUDGE_MS,
      resolveMs: INTAKE_SILENCE_RESOLVE_MS,
    })
  })

  it('aligns urgent resolve with emergencyWater SLA (120m) and nudge under 1h', () => {
    const t = thresholdsForIntakeSilence(
      base({
        urgency: 'emergency',
        description: 'I smell gas in the kitchen',
        issueHeadline: 'Gas smell',
      }),
    )
    expect(t.nudgeMs).toBe(URGENT_INTAKE_SILENCE_NUDGE_MS)
    expect(t.nudgeMs).toBeLessThan(60 * 60 * 1000)
    expect(t.resolveMs).toBe(URGENT_INTAKE_SILENCE_RESOLVE_MS)
    expect(t.resolveMs).toBe(URGENCY_SLA_MINUTES.emergencyWater * 60 * 1000)
  })

  it('aligns life_safety resolve with emergencyLifeSafety SLA (60m)', () => {
    const t = thresholdsForIntakeSilence(
      base({ urgencyAlertTier: 'life_safety', urgency: 'emergency' }),
    )
    expect(t.nudgeMs).toBe(15 * 60 * 1000)
    expect(t.resolveMs).toBe(LIFE_SAFETY_INTAKE_SILENCE_RESOLVE_MS)
    expect(t.resolveMs).toBe(URGENCY_SLA_MINUTES.emergencyLifeSafety * 60 * 1000)
  })
})

describe('classifyIntakeSilenceFollowUp urgency scaling', () => {
  it('nudges a gas-smell draft well under an hour', () => {
    const gas = base({
      urgency: 'emergency',
      urgencyAlertTier: 'life_safety',
      description: 'Strong gas smell near the stove',
      issueHeadline: 'Gas smell',
    })
    const asked = Date.parse(gas.openQuestionAskedAt!)
    const at25m = classifyIntakeSilenceFollowUp(gas, asked + 25 * 60 * 1000)
    expect(at25m.action).toBe('nudge')
    if (at25m.action === 'nudge') {
      expect(at25m.urgent).toBe(true)
      expect(at25m.body.toLowerCase()).toContain('urgent follow-up')
    }

    // Same 25m is still before the routine 3h bar.
    const pest = base()
    expect(classifyIntakeSilenceFollowUp(pest, asked + 25 * 60 * 1000)).toEqual({
      action: 'skip',
      reason: 'before_nudge_threshold',
    })
  })

  it('keeps routine pest on 3h/36h defaults', () => {
    const pest = base()
    const asked = Date.parse(pest.openQuestionAskedAt!)
    expect(
      classifyIntakeSilenceFollowUp(pest, asked + INTAKE_SILENCE_NUDGE_MS - 1)
        .action,
    ).toBe('skip')
    const nudge = classifyIntakeSilenceFollowUp(
      pest,
      asked + INTAKE_SILENCE_NUDGE_MS + 1,
    )
    expect(nudge.action).toBe('nudge')
    if (nudge.action === 'nudge') expect(nudge.urgent).toBe(false)

    const resolve = classifyIntakeSilenceFollowUp(
      {
        ...pest,
        silenceNudgeSentAt: new Date(asked + INTAKE_SILENCE_NUDGE_MS).toISOString(),
      },
      asked + INTAKE_SILENCE_RESOLVE_MS + 1,
    )
    expect(resolve.action).toBe('resolve_unit_entry_unconfirmed')
    if (resolve.action === 'resolve_unit_entry_unconfirmed') {
      expect(resolve.emergencyAlert).toBe(false)
    }
  })

  it('routes urgent silence resolve through emergency alert tier', () => {
    const gas = base({
      urgency: 'emergency',
      urgencyAlertTier: 'life_safety',
      description: 'I smell gas',
      issueHeadline: 'Gas smell',
    })
    const asked = Date.parse(gas.openQuestionAskedAt!)
    const resolve = classifyIntakeSilenceFollowUp(
      {
        ...gas,
        silenceNudgeSentAt: new Date(asked + 15 * 60 * 1000).toISOString(),
      },
      asked + LIFE_SAFETY_INTAKE_SILENCE_RESOLVE_MS + 1,
    )
    expect(resolve.action).toBe('resolve_unit_entry_unconfirmed')
    if (resolve.action === 'resolve_unit_entry_unconfirmed') {
      expect(resolve.emergencyAlert).toBe(true)
      expect(resolve.urgencyAlertTier).toBe('life_safety')
      expect(resolve.body.toLowerCase()).toContain('alerted the property team')
    }
  })

  it('nudges once then waits — never repeats every cron cycle', () => {
    const gas = base({ urgency: 'emergency', urgencyAlertTier: 'same_day' })
    const asked = Date.parse(gas.openQuestionAskedAt!)
    const now = asked + URGENT_INTAKE_SILENCE_NUDGE_MS + 60_000
    expect(classifyIntakeSilenceFollowUp(gas, now).action).toBe('nudge')
    expect(
      classifyIntakeSilenceFollowUp(
        { ...gas, silenceNudgeSentAt: new Date(now).toISOString() },
        now + 5 * 60_000,
      ),
    ).toEqual({ action: 'skip', reason: 'already_nudged_waiting' })
  })
})

describe('buildIntakeSilenceNudgeSms', () => {
  it('summarizes unit_entry instead of raw re-paste', () => {
    const body = buildIntakeSilenceNudgeSms(base())
    expect(body).toMatch(/pest issue/i)
    expect(body).not.toBe(base().diagnosticQuestion)
  })
})

describe('resolveIntakeSilenceAskedAt', () => {
  const asked = '2026-09-29T20:37:24.000Z'
  const askedMs = Date.parse(asked)

  it('prefers frozen open_question_asked_at over updated_at', () => {
    expect(
      resolveIntakeSilenceAskedAt({
        openQuestionAskedAt: asked,
        conversationUpdatedAt: new Date(askedMs + INTAKE_SILENCE_NUDGE_MS).toISOString(),
        hasOpenQuestion: true,
      }),
    ).toEqual({ askedAt: asked, source: 'open_question_asked_at' })
  })

  it('recovers ask time from nudge stamp so resolve is not restarted', () => {
    const nudgeAt = new Date(askedMs + INTAKE_SILENCE_NUDGE_MS).toISOString()
    const resolved = resolveIntakeSilenceAskedAt({
      openQuestionAskedAt: null,
      silenceNudgeSentAt: nudgeAt,
      conversationUpdatedAt: nudgeAt,
      hasOpenQuestion: true,
      nudgeMs: INTAKE_SILENCE_NUDGE_MS,
    })
    expect(resolved.source).toBe('recovered_from_nudge')
    expect(Date.parse(resolved.askedAt!)).toBe(askedMs)

    const snap = base({
      openQuestionAskedAt: resolved.askedAt,
      silenceNudgeSentAt: nudgeAt,
    })
    expect(
      classifyIntakeSilenceFollowUp(snap, askedMs + INTAKE_SILENCE_RESOLVE_MS + 1)
        .action,
    ).toBe('resolve_unit_entry_unconfirmed')
  })

  it('documents the updated_at fallback bug when nudge bumps the row', () => {
    const afterNudgeUpdatedAt = new Date(
      askedMs + INTAKE_SILENCE_NUDGE_MS + 1,
    ).toISOString()
    const buggy = resolveIntakeSilenceAskedAt({
      openQuestionAskedAt: null,
      silenceNudgeSentAt: null,
      conversationUpdatedAt: afterNudgeUpdatedAt,
      hasOpenQuestion: true,
    })
    expect(buggy.source).toBe('updated_at_fallback')
    const silentFor =
      askedMs + INTAKE_SILENCE_RESOLVE_MS + 1 - Date.parse(buggy.askedAt!)
    expect(silentFor).toBeLessThan(INTAKE_SILENCE_RESOLVE_MS)
  })
})
