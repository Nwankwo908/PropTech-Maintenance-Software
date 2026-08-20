import { describe, expect, it } from 'vitest'
import {
  formatTicketRequestNumber,
  formatWorkOrderRefFromTicketId,
} from './vendorCallFlow'

describe('formatTicketRequestNumber', () => {
  it('uses the last four hex characters as REQ-A92B', () => {
    expect(formatTicketRequestNumber('3b0047aa-1111-2222-3333-44444444a92b')).toBe('REQ-A92B')
  })
})

describe('formatWorkOrderRefFromTicketId', () => {
  it('uses the first four hex characters as WO-XXXX', () => {
    expect(formatWorkOrderRefFromTicketId('3b0047aa-1111-2222-3333-44444444a92b')).toBe('WO-3B00')
  })
})
