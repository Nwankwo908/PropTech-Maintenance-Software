import { describe, expect, it } from 'vitest'
import { computePortfolioInsights } from './computeInsights.ts'
import { computePortfolioRecommendations } from './computeRecommendations.ts'
import {
  buildUnitBuildingMap,
  resolveTicketBuilding,
} from './helpers.ts'
import type { PortfolioIntelligenceInput } from './types.ts'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')
const PROP_OAK = 'prop-oak-0001'
const PROP_A = 'prop-a-0001'
const PROP_B = 'prop-b-0002'

function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
}

describe('computePortfolioIntelligence', () => {
  it('insights surface pattern cards from 60-day history', () => {
    const input: PortfolioIntelligenceInput = {
      now: NOW,
      units: [{
        id: 'unit-4b',
        unitLabel: '4B',
        building: 'Oak Tower',
        propertyId: PROP_OAK,
      }],
      tickets: [
        {
          id: '1',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '4B',
          unitId: 'unit-4b',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(5),
          urgency: 'normal',
        },
        {
          id: '2',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '4B',
          unitId: 'unit-4b',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(10),
          urgency: 'normal',
        },
        {
          id: '3',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '2A',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(12),
          urgency: 'normal',
        },
      ],
    }

    const insights = computePortfolioInsights(input)
    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(true)
    expect(insights.some((i) => i.tag === 'RISK')).toBe(true)
    expect(insights.every((i) => i.tag !== 'priority_property' as never)).toBe(true)
  })

  it('recommendations surface action signals from open backlog, not insight tags', () => {
    const input: PortfolioIntelligenceInput = {
      now: NOW,
      units: [{
        id: 'unit-4b',
        unitLabel: '4B',
        building: 'Oak Tower',
        propertyId: PROP_OAK,
      }],
      tickets: [
        {
          id: 'open-1',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'pending_accept',
          createdAt: daysAgo(15),
          urgency: 'urgent',
        },
        {
          id: 'open-2',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '2A',
          issueCategory: 'hvac',
          vendorWorkStatus: 'in_progress',
          createdAt: daysAgo(12),
          urgency: 'normal',
        },
      ],
    }

    const recommendations = computePortfolioRecommendations(input)
    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations[0]?.kind).toBe('priority_property')
    expect(recommendations.every((r) => r.confidence === 'high')).toBe(true)
    expect(recommendations.every((r) => !('tag' in r))).toBe(true)
  })

  it('escalation stack recommendation requires multiple escalated workflows', () => {
    const input: PortfolioIntelligenceInput = {
      now: NOW,
      units: [],
      tickets: [],
      escalatedWorkflows: [
        { id: '1', status: 'escalated', templateName: 'late_rent' },
        { id: '2', status: 'escalated', templateName: 'lease_renewal' },
        { id: '3', status: 'escalated', templateName: 'maintenance_sla' },
      ],
    }

    const recommendations = computePortfolioRecommendations(input)
    expect(recommendations.some((r) => r.kind === 'escalation_stack')).toBe(true)
    const insights = computePortfolioInsights(input)
    expect(insights.length).toBe(0)
  })

  it('does not treat a single resident-flagged ticket as recurring', () => {
    const insights = computePortfolioInsights({
      now: NOW,
      units: [{
        unitLabel: '1',
        building: '14 Maple Ave',
        propertyId: PROP_A,
      }],
      tickets: [
        {
          id: 'solo',
          propertyId: PROP_A,
          building: '14 Maple Ave',
          unit: '1',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(3),
          residentReportedRecurring: true,
          urgency: 'normal',
        },
      ],
    })
    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(false)
  })

  it('does not treat a 12-ticket inspection batch as Recurring Issues', () => {
    const reportId = 'insp-report-8ac8'
    const tickets = Array.from({ length: 12 }, (_, i) => ({
      id: `hqs-${i + 1}`,
      propertyId: PROP_A,
      building: '646 Bartlett',
      unit: '1',
      issueCategory: 'general',
      vendorWorkStatus: i % 2 === 0 ? 'pending_accept' : 'completed',
      createdAt: daysAgo(2),
      urgency: 'normal',
      inspectionReportId: reportId,
    }))

    const insights = computePortfolioInsights({
      now: NOW,
      units: [{
        unitLabel: '1',
        building: '646 Bartlett',
        propertyId: PROP_A,
      }],
      tickets,
    })

    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(false)
    expect(insights.some((i) => i.tag === 'RISK')).toBe(false)
    expect(insights.some((i) => i.tag === 'PREVENT FUTURE REPAIRS')).toBe(false)
  })

  it('still flags Recurring Issues from two independent tenant-reported tickets', () => {
    const insights = computePortfolioInsights({
      now: NOW,
      units: [{
        unitLabel: '1',
        building: '646 Bartlett',
        propertyId: PROP_A,
      }],
      tickets: [
        {
          id: 'tenant-1',
          propertyId: PROP_A,
          building: '646 Bartlett',
          unit: '1',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(5),
          urgency: 'normal',
          inspectionReportId: null,
        },
        {
          id: 'tenant-2',
          propertyId: PROP_A,
          building: '646 Bartlett',
          unit: '2',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(12),
          urgency: 'normal',
        },
        // Inspection noise must not inflate or suppress the tenant pattern.
        {
          id: 'hqs-noise',
          propertyId: PROP_A,
          building: '646 Bartlett',
          unit: '1',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'pending_accept',
          createdAt: daysAgo(1),
          urgency: 'normal',
          inspectionReportId: 'insp-report-noise',
        },
      ],
    })

    const recurring = insights.find((i) => i.tag === 'RECURRING ISSUES')
    expect(recurring).toBeTruthy()
    expect(recurring?.requestCount).toBe(2)
    expect(recurring?.ticketIds).toEqual(['tenant-1', 'tenant-2'])
  })

  it('does not merge pest_control across two properties with the same building name or unit label', () => {
    const insights = computePortfolioInsights({
      now: NOW,
      units: [
        {
          id: 'unit-a1',
          unitLabel: '1',
          building: '14 Maple Ave',
          propertyId: PROP_A,
        },
        {
          id: 'unit-b1',
          unitLabel: '1',
          building: '14 Maple Ave',
          propertyId: PROP_B,
        },
      ],
      tickets: [
        {
          id: 'pest-a',
          propertyId: PROP_A,
          building: '14 Maple Ave',
          unit: '1',
          unitId: 'unit-a1',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(4),
          urgency: 'normal',
        },
        {
          id: 'pest-b',
          propertyId: PROP_B,
          building: '14 Maple Ave',
          unit: '1',
          unitId: 'unit-b1',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(6),
          urgency: 'normal',
        },
      ],
    })

    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(false)
    expect(insights.some((i) => i.tag === 'RISK')).toBe(false)
    expect(insights.some((i) => i.tag === 'PREVENT FUTURE REPAIRS')).toBe(false)
  })

  it('resolves missing ticket building only within the ticket property_id', () => {
    const units = [
      {
        id: 'unit-a1',
        unitLabel: '1',
        building: 'Alpha Court',
        propertyId: PROP_A,
        landlordId: 'll-1',
      },
      {
        id: 'unit-b1',
        unitLabel: '1',
        building: 'Beta Court',
        propertyId: PROP_B,
        landlordId: 'll-1',
      },
    ]
    const map = buildUnitBuildingMap(units)

    expect(
      resolveTicketBuilding(
        {
          createdAt: daysAgo(1),
          unit: '1',
          unitId: 'unit-a1',
          propertyId: PROP_A,
          building: null,
        },
        map,
      ),
    ).toBe('Alpha Court')

    expect(
      resolveTicketBuilding(
        {
          createdAt: daysAgo(1),
          unit: '1',
          propertyId: PROP_B,
          building: null,
        },
        map,
      ),
    ).toBe('Beta Court')

    // No property/landlord scope → nothing (do not borrow another property's unit 1).
    expect(
      resolveTicketBuilding(
        {
          createdAt: daysAgo(1),
          unit: '1',
          building: null,
        },
        map,
      ),
    ).toBeNull()
  })

  it('does not use cancelled or deleted work orders for pattern cards', () => {
    const input: PortfolioIntelligenceInput = {
      now: NOW,
      units: [{
        unitLabel: '4B',
        building: 'Oak Tower',
        propertyId: PROP_OAK,
      }],
      tickets: [
        {
          id: 'cancelled-1',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'cancelled',
          createdAt: daysAgo(4),
          assignedVendorId: 'vendor-1',
          urgency: 'normal',
        },
        {
          id: 'cancelled-2',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'cancelled',
          createdAt: daysAgo(6),
          assignedVendorId: 'vendor-1',
          urgency: 'normal',
        },
        {
          id: 'deleted-1',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'deleted',
          createdAt: daysAgo(8),
          urgency: 'normal',
        },
      ],
      vendorResponsePct: 100,
      assignedWorkOrderCount: 2,
    }

    const insights = computePortfolioInsights(input)
    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(false)
    expect(insights.some((i) => i.tag === 'RISK')).toBe(false)
    expect(insights.some((i) => i.tag === 'PREVENT FUTURE REPAIRS')).toBe(false)
    expect(insights.some((i) => i.tag === 'VENDOR RESPONSE')).toBe(false)
  })
})
