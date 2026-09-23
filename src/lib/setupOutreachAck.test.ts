import { describe, expect, it } from 'vitest'
import {
  setupOutreachAckBody,
  setupOutreachAckCheckboxLabel,
  setupOutreachAckConfirmLabel,
  setupOutreachAckTitle,
} from './setupOutreachAck'

describe('setupOutreachAck', () => {
  it('mentions saving the number so messages are not filtered', () => {
    expect(setupOutreachAckBody('resident')).toMatch(/save our number/i)
    expect(setupOutreachAckBody('resident')).toMatch(/Unknown Sender|Filtered Unknown/i)
    expect(setupOutreachAckCheckboxLabel('vendor')).toMatch(/save our number/i)
  })

  it('labels confirm by recipient and retry', () => {
    expect(setupOutreachAckTitle('resident')).toMatch(/resident/i)
    expect(setupOutreachAckTitle('vendor')).toMatch(/vendor/i)
    expect(setupOutreachAckConfirmLabel({ kind: 'resident' })).toBe('Setup Resident')
    expect(setupOutreachAckConfirmLabel({ kind: 'vendor', retry: true })).toBe('Retry setup')
  })
})
