import { collectAdminWorkflowRuns, workflowOperationsPath } from '@/lib/adminWorkflowKanban'
import { maintenanceTicketIdFromWorkflowRun } from '@/lib/adminWorkflows'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import {
  isClosedWorkStatus,
  looksLikeStatusInquiry,
  repairLabel,
  scoreInsight,
} from '@/lib/smartIntelligence/helpers'
import type { SmartInsight, SmartIntelligenceContext } from '@/lib/smartIntelligence/types'

function hoursSince(iso: string | null | undefined, now: Date): number | null {
  const raw = (iso ?? '').trim()
  if (!raw) return null
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime())) return null
  return (now.getTime() - parsed.getTime()) / 3_600_000
}

export function evaluateVendorIntelligence(ctx: SmartIntelligenceContext): SmartInsight[] {
  const now = ctx.now ?? new Date()
  const insights: SmartInsight[] = []
  const tickets = ctx.tickets ?? []

  for (const ticket of tickets) {
    if (isClosedWorkStatus(ticket.vendorWorkStatus)) continue
    if (looksLikeStatusInquiry(ticket.description ?? '')) continue
    const status = ticket.vendorWorkStatus.trim().toLowerCase()
    const label = repairLabel(ticket.description, ticket.issueCategory)
    const trade = formatVendorTradeLabel(ticket.issueCategory, { emptyLabel: 'vendor' }).toLowerCase()
    const who = trade === 'general / handyman' ? 'vendor' : trade.replace(/s$/, '')
    const run = ctx.workflowData
      ? collectAdminWorkflowRuns(ctx.workflowData).find(
          (row) => maintenanceTicketIdFromWorkflowRun(row) === ticket.id,
        )
      : undefined
    const route = workflowOperationsPath(run?.id)

    if (status === 'declined' || (status === 'pending_accept' && !ticket.assignedVendorId)) {
      insights.push({
        id: `vendor-declined-${ticket.id}`,
        type: 'vendor',
        priority: 'attention',
        title: 'Vendor is unable to take this job',
        description: `The ${label} still needs a vendor who can take the work.`,
        action: { label: 'Find Vendor', route },
        entityId: ticket.id,
        score: scoreInsight('attention', { waitingOnLandlord: true }),
      })
      continue
    }

    if (status === 'pending_accept' && ticket.assignedVendorId) {
      const waited = hoursSince(ticket.assignedAt ?? ticket.createdAt, now)
      if (waited != null && waited < 2) continue
      insights.push({
        id: `vendor-no-response-${ticket.id}`,
        type: 'vendor',
        priority: 'attention',
        title: "Vendor hasn't responded",
        description: `The assigned ${who} has not responded to the repair request.`,
        action: { label: 'Review Job', route },
        entityId: ticket.id,
        score: scoreInsight('attention', {
          waitingOnLandlord: true,
          overdueDays: waited != null ? Math.floor(waited / 24) : 0,
        }),
      })
    }
  }

  return insights
}
