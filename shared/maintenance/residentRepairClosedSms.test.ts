import { describe, expect, it } from 'vitest'
import { buildResidentRepairClosedSms } from './residentRepairClosedSms.ts'

describe('buildResidentRepairClosedSms', () => {
  it('turns a full sentence into a request phrase and keeps the stored ref', () => {
    const sms = buildResidentRepairClosedSms({
      description: 'The Kitchen faucet is dripping.',
      requestRef: '676FE1DD',
    })
    expect(sms).toBe(
      "Thanks for letting us know. We've closed your request for the dripping kitchen faucet. Ref: 676FE1DD.",
    )
    expect(sms).not.toContain('your The')
    expect(sms).not.toContain('your the')
  })

  it('keeps a short phrase as the request and does not add a sentence verb', () => {
    const sms = buildResidentRepairClosedSms({
      description: 'Leaking kitchen faucet',
      requestRef: '676fe1dd',
    })
    expect(sms).toBe(
      "Thanks for letting us know. We've closed your request for the leaking kitchen faucet. Ref: 676FE1DD.",
    )
  })

  it('leaves a full sentence that is not a simple description on its own', () => {
    const sms = buildResidentRepairClosedSms({
      description: "The AC isn't working.\nIt is 100 inside.",
      requestRef: '30A0B8CC',
    })
    expect(sms).toBe(
      "Thanks for letting us know. We've closed your request. The AC isn't working. Ref: 30A0B8CC.",
    )
    expect(sms).not.toContain('100')
    expect(sms).not.toContain('your The')
  })

  it('omits a request description when the title is missing', () => {
    const sms = buildResidentRepairClosedSms({
      description: '   ',
      requestRef: '676FE1DD',
    })
    expect(sms).toBe(
      "Thanks for letting us know. We've closed your request. Ref: 676FE1DD.",
    )
    expect(sms).not.toMatch(/faucet|plumbing|dripping/i)
  })
})
