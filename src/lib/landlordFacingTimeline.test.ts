import { describe, expect, it } from 'vitest'
import {
  isHiddenPipelineTimelineEventType,
  isHiddenSmsTransportTimelineEventType,
  isVisibleLandlordTimelineDescription,
} from './landlordFacingTimeline'

describe('landlordFacingTimeline', () => {
  it('hides pipeline stage receipts and keeps escalate', () => {
    expect(isHiddenPipelineTimelineEventType('workflow.act')).toBe(true)
    expect(isHiddenPipelineTimelineEventType('workflow.log')).toBe(true)
    expect(isHiddenPipelineTimelineEventType('workflow.trigger')).toBe(true)
    expect(isHiddenPipelineTimelineEventType('workflow.classify')).toBe(true)
    expect(isHiddenPipelineTimelineEventType('workflow.route')).toBe(true)
    expect(isHiddenPipelineTimelineEventType('workflow.escalate')).toBe(false)
    expect(isHiddenPipelineTimelineEventType('maintenance.created')).toBe(false)
  })

  it('hides SMS transport receipts', () => {
    expect(isHiddenSmsTransportTimelineEventType('sms.delivered')).toBe(true)
    expect(isHiddenSmsTransportTimelineEventType('sms.message_received')).toBe(true)
    expect(isHiddenSmsTransportTimelineEventType('sms.maintenance_cancelled')).toBe(false)
  })

  it('hides plumbing labels on Timeline copy', () => {
    expect(isVisibleLandlordTimelineDescription('Action taken')).toBe(false)
    expect(isVisibleLandlordTimelineDescription('Logged')).toBe(false)
    expect(isVisibleLandlordTimelineDescription('Classified')).toBe(false)
    expect(isVisibleLandlordTimelineDescription('Routed')).toBe(false)
    expect(isVisibleLandlordTimelineDescription('Workflow started')).toBe(false)
    expect(isVisibleLandlordTimelineDescription('SLA breached')).toBe(true)
    expect(isVisibleLandlordTimelineDescription('Vendor accepted the job')).toBe(true)
  })
})
