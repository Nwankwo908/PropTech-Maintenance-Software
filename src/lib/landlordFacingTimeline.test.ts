import { describe, expect, it } from 'vitest'
import {
  isHiddenActivationAlertTimelineEventType,
  isHiddenOpsHeartbeatTimelineEventType,
  isHiddenPipelineTimelineEventType,
  isHiddenSmsTransportTimelineEventType,
  isVisibleLandlordTimelineDescription,
  landlordFeedHiddenEventTypes,
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
    expect(isHiddenSmsTransportTimelineEventType('sms.intent_recognized')).toBe(true)
    expect(isHiddenSmsTransportTimelineEventType('sms.gate_miss')).toBe(true)
    expect(isHiddenSmsTransportTimelineEventType('sms.intake_seed_recovered')).toBe(true)
    expect(isHiddenSmsTransportTimelineEventType('sms.maintenance_cancelled')).toBe(false)
  })

  it('hides tenant-activation alert bookkeeping and keeps action required', () => {
    expect(isHiddenActivationAlertTimelineEventType('tenant.activation_failure_resolved')).toBe(true)
    expect(isHiddenActivationAlertTimelineEventType('tenant.activation_admin_alert_sent')).toBe(true)
    expect(isHiddenActivationAlertTimelineEventType('tenant.activation_admin_alert_failed')).toBe(true)
    expect(isHiddenActivationAlertTimelineEventType('tenant.activation_action_required')).toBe(false)
    expect(isHiddenActivationAlertTimelineEventType('tenant.activation_completed')).toBe(false)
  })

  it('hides rent-collection cron heartbeats', () => {
    expect(isHiddenOpsHeartbeatTimelineEventType('rent.collection_cron_triggered')).toBe(true)
    expect(isHiddenOpsHeartbeatTimelineEventType('rent.reminder_sent')).toBe(false)
  })

  it('lists every hidden feed event type for query filters', () => {
    const hidden = landlordFeedHiddenEventTypes()
    expect(hidden).toContain('workflow.act')
    expect(hidden).toContain('sms.delivered')
    expect(hidden).toContain('rent.collection_cron_triggered')
    expect(hidden).toContain('tenant.activation_admin_alert_sent')
    expect(hidden).not.toContain('workflow.escalate')
    expect(hidden).not.toContain('rent.reminder_sent')
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
