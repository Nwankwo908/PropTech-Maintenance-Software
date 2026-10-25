import { describe, expect, it } from 'vitest'
import {
  setupOutreachAckBody,
  setupOutreachAckConfirmLabel,
  setupOutreachAckTitle,
} from './setupOutreachAck'

describe('setupOutreachAck', () => {
  it('mentions saving the number so messages are not filtered', () => {
    expect(setupOutreachAckBody('resident')).toMatch(/save our number/i)
    expect(setupOutreachAckBody('resident')).toMatch(/Unknown Sender|Filtered Unknown/i)
  })

  it('labels confirm as Send invite, with Retry invite when retrying', () => {
    expect(setupOutreachAckTitle('resident')).toMatch(/send this invite/i)
    expect(setupOutreachAckTitle('vendor')).toMatch(/send this invite/i)
    expect(setupOutreachAckConfirmLabel({ kind: 'resident' })).toBe('Send invite')
    expect(setupOutreachAckConfirmLabel({ kind: 'vendor', retry: true })).toBe('Retry invite')
  })
})
