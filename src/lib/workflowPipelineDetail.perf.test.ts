import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildMaintenanceOverviewStatusContext,
  buildMaintenanceOverviewStatusLabel,
  buildMaintenanceRepairNextAction,
  buildMaintenanceRepairProgressSteps,
  composeIssueDetailsNarrative,
  formatIssueLocationWithServes,
  formatRepairTimelineDate,
  maintenanceRepairWorkPhaseLabel,
  needsVisitNotConfirmedBanner,
} from '@/lib/workflowPipelineDetail'

const dashboardSource = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../components/AdminWorkflowOperationsDashboard.tsx',
  ),
  'utf8',
)

const panelSource = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../components/WorkflowPipelineDetailPanel.tsx',
  ),
  'utf8',
)

const STAGES = ['new_intake', 'assigned', 'in_progress', 'completed'] as const
const STATUSES = [
  'pending_accept',
  'accepted',
  'in_progress',
  'completed',
  'declined',
] as const

function assembleRightRailSnapshot(seed: number) {
  const kanbanStage = STAGES[seed % STAGES.length]!
  const vendorWorkStatus = STATUSES[seed % STATUSES.length]!
  const scheduledAt = seed % 3 === 0 ? '2026-11-08T15:00:00.000Z' : null
  const scheduleConfirmedAt = seed % 5 === 0 ? '2026-11-08T16:00:00.000Z' : null
  const hasCompletionPhotos = seed % 7 === 0
  const awaitingLandlordChoice = seed % 11 === 0
  const stalePendingAcceptNeedsAdmin = seed % 13 === 0
  const vendorName = seed % 2 === 0 ? 'Ecosafe Pest' : 'Metro Plumbing'

  const statusContext = buildMaintenanceOverviewStatusContext({
    vendorWorkStatus,
    vendorName,
    stageLabel: 'Assigned',
    lastEventMessage: 'Vendor accepted the work order.',
    escalationReason: null,
    runStatus: 'active',
    scheduledAt,
    scheduleConfirmedAt,
    awaitingLandlordChoice,
    stalePendingAcceptNeedsAdmin,
  })
  const statusLabel = buildMaintenanceOverviewStatusLabel({
    vendorWorkStatus,
    awaitingLandlordChoice,
    stalePendingAcceptNeedsAdmin,
  })
  const steps = buildMaintenanceRepairProgressSteps({
    kanbanStage,
    vendorWorkStatus,
    scheduledAt,
    hasCompletionPhotos,
  })
  const workPhase = maintenanceRepairWorkPhaseLabel({
    scheduledAt,
    vendorWorkStatus,
    hasCompletionPhotos,
  })
  const nextAction = buildMaintenanceRepairNextAction({
    vendorWorkStatus,
    vendorName,
    scheduledAt,
    scheduleConfirmedAt,
    awaitingLandlordChoice,
    stalePendingAcceptNeedsAdmin,
    hasCompletionPhotos,
  })
  const narrative = composeIssueDetailsNarrative({
    reportedDetail:
      seed % 2 === 0
        ? 'Kitchen sink is leaking under the cabinet and soaking the floor.'
        : null,
    displayDescription: [
      'Kitchen sink is leaking under the cabinet.',
      'Location: Kitchen',
      'Serves: Unit 2B',
      'Flag: Water damage risk',
      'Resident availability: Weekdays after 5pm',
    ].join('\n'),
    triageFlags: ['Water damage risk', 'Active leak'],
    availability: 'Weekdays after 5pm',
    needsClarification: seed % 4 === 0 ? 'Confirm shutoff access' : null,
    rawFallback: 'Maintenance request',
  })
  const location = formatIssueLocationWithServes('Kitchen', 'Unit 2B')
  const reported = formatRepairTimelineDate('2026-11-08T12:00:00.000Z')
  const estimated = formatRepairTimelineDate(scheduledAt)
  const banner = needsVisitNotConfirmedBanner({
    isMaintenanceWorkflow: true,
    vendorWorkStatus,
    scheduleConfirmedAt,
  })

  return {
    statusContext,
    statusLabel,
    steps,
    workPhase,
    nextAction,
    narrative,
    location,
    reported,
    estimated,
    banner,
  }
}

describe('Active Tasks right rail wiring', () => {
  it('loads pipeline detail with DEV timing and mounts the detail panel', () => {
    expect(dashboardSource).toContain('fetchWorkflowPipelineDetail')
    expect(dashboardSource).toContain('WorkflowPipelineDetailPanel')
    expect(dashboardSource).toContain('[active-tasks] pipeline detail')
    expect(dashboardSource).toContain('selectedRunId')
    expect(panelSource).toContain('Issue details')
    expect(panelSource).toContain('Property access')
    expect(panelSource).toContain('Repair timeline')
    expect(panelSource).toContain('detail.progressSteps')
    expect(panelSource).toContain('detail.statusContext')
    expect(panelSource).toContain('detail.reportedDateLabel')
    expect(panelSource).toContain('propertyAccessEditPath')
    expect(panelSource).toContain('needsVisitNotConfirmedBanner')
  })
})

describe('Active Tasks right rail performance', () => {
  it('keeps Overview / Repair progress / Issue details helpers under budget', () => {
    const samples: number[] = []

    for (let i = 0; i < 120; i += 1) {
      const start = performance.now()
      const snapshot = assembleRightRailSnapshot(i)
      samples.push(performance.now() - start)

      if (i === 0) {
        expect(snapshot.steps).toHaveLength(4)
        expect(snapshot.statusLabel.length).toBeGreaterThan(0)
        expect(snapshot.narrative.length).toBeGreaterThan(0)
        expect(snapshot.location).toContain('Kitchen')
        expect(snapshot.reported).toMatch(/Nov/)
      }
    }

    const sorted = [...samples].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(0.5 * sorted.length)]!
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]!
    expect(p50).toBeLessThan(8)
    expect(p95).toBeLessThan(25)
  })
})
