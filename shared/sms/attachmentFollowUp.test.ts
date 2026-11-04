import { describe, expect, it } from 'vitest'
import {
  buildAttachmentAddedAck,
  decideFollowUpAttachment,
  mergeAttachmentPaths,
} from './attachmentFollowUp.ts'

const SINK = { id: 'sink', label: 'Bathroom sink leak', open: false }
const HEATER = { id: 'heater', label: 'Baseboard heater leak', open: true }
const FREEZER = { id: 'freezer', label: 'Freezer seal', open: true }

describe('follow-up attachments', () => {
  it('does not treat Ganaia’s captionless heater video as a rent reply or the completed sink job', () => {
    const decision = decideFollowUpAttachment({
      mediaCount: 1,
      body: '',
      repairs: [SINK],
      intakeActive: false,
      explicitOtherWorkflowReply: false,
      emergency: false,
    })
    expect(decision).toEqual({ action: 'acknowledge' })
  })

  it('lets a captioned new report stay with maintenance intake', () => {
    const decision = decideFollowUpAttachment({
      mediaCount: 1,
      body: 'There is a leak in the baseboard heater for the first floor.',
      repairs: [SINK],
      intakeActive: false,
      explicitOtherWorkflowReply: false,
      emergency: false,
    })
    expect(decision.action).toBe('skip')
  })

  it('attaches a follow-up file to the one open repair', () => {
    const decision = decideFollowUpAttachment({
      mediaCount: 1,
      body: '',
      repairs: [HEATER],
      intakeActive: false,
      explicitOtherWorkflowReply: false,
      emergency: false,
    })
    expect(decision).toEqual({ action: 'attach', repairId: 'heater', mediaPaths: [] })
  })

  it('asks when more than one open repair could match', () => {
    const decision = decideFollowUpAttachment({
      mediaCount: 1,
      body: 'sent',
      repairs: [HEATER, FREEZER],
      intakeActive: false,
      explicitOtherWorkflowReply: false,
      emergency: false,
    })
    expect(decision.action).toBe('ask')
    if (decision.action === 'ask') {
      expect(decision.repairIds).toEqual(['heater', 'freezer'])
    }
  })

  it('uses the number the resident replies while a choice is pending', () => {
    const decision = decideFollowUpAttachment({
      mediaCount: 0,
      body: '2',
      repairs: [HEATER, FREEZER],
      awaitingChoice: { repairIds: ['heater', 'freezer'], mediaPaths: ['sms/a.3gp'] },
      intakeActive: false,
      explicitOtherWorkflowReply: false,
      emergency: false,
    })
    expect(decision).toEqual({
      action: 'attach',
      repairId: 'freezer',
      mediaPaths: ['sms/a.3gp'],
    })
  })

  it('leaves rent replies, emergencies, and an open intake alone', () => {
    const base = {
      mediaCount: 1,
      body: '',
      repairs: [HEATER],
      intakeActive: false,
      explicitOtherWorkflowReply: false,
      emergency: false,
    }
    expect(decideFollowUpAttachment({ ...base, explicitOtherWorkflowReply: true }).action).toBe('skip')
    expect(decideFollowUpAttachment({ ...base, emergency: true, body: 'I smell gas' }).action).toBe('skip')
    expect(decideFollowUpAttachment({ ...base, intakeActive: true }).action).toBe('skip')
  })

  it('attaches to the repair that asked for a file, including after submit', () => {
    const decision = decideFollowUpAttachment({
      mediaCount: 1,
      body: 'The valve is still leaking',
      repairs: [HEATER, FREEZER],
      pendingPhotoRepairId: 'heater',
      intakeActive: false,
      explicitOtherWorkflowReply: false,
      emergency: false,
    })
    expect(decision).toEqual({ action: 'attach', repairId: 'heater', mediaPaths: [] })
  })

  it('does not duplicate paths when the same file is saved again', () => {
    expect(mergeAttachmentPaths(['sms/a.3gp'], ['sms/a.3gp', 'sms/b.3gp'])).toEqual([
      'sms/a.3gp',
      'sms/b.3gp',
    ])
  })

  it('mentions the repair only in the added acknowledgement', () => {
    expect(buildAttachmentAddedAck({ count: 1, repairLabel: 'the baseboard heater leak' })).toContain(
      'baseboard heater leak',
    )
  })
})
