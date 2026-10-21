import {
  cardHasAssignedVendorForStageMove,
  isInspectionVisitKanbanCard,
  stageMoveTicketIdsForCard,
  type WorkflowKanbanCard,
} from '@/lib/adminWorkflowKanban'
import {
  STAGE_MOVE_RULES,
  templateGroupFromTemplateId,
  type StageMoveTemplateGroup,
} from '@/lib/workflowStageMoveRules'

/** Template group used for stage-move gates (visit rollups always use inspection). */
export function stageMoveTemplateGroupForCard(
  card: Pick<WorkflowKanbanCard, 'templateId' | 'inspectionReportId' | 'inspectionChecklist' | 'stageMoveTicketIds'>,
): StageMoveTemplateGroup {
  if (isInspectionVisitKanbanCard(card)) return 'inspection'
  return templateGroupFromTemplateId(card.templateId)
}

export function canStageMoveKanbanCard(
  card: Pick<
    WorkflowKanbanCard,
    | 'templateId'
    | 'ticketId'
    | 'stageMoveTicketIds'
    | 'inspectionReportId'
    | 'inspectionChecklist'
  >,
): boolean {
  const group = stageMoveTemplateGroupForCard(card)
  const rule = STAGE_MOVE_RULES[group] ?? STAGE_MOVE_RULES.other
  if (!rule.draggable) return false
  return stageMoveTicketIdsForCard(card).length > 0
}

export function stageMoveNotDraggableReason(
  card: Pick<
    WorkflowKanbanCard,
    | 'templateId'
    | 'ticketId'
    | 'stageMoveTicketIds'
    | 'inspectionReportId'
    | 'inspectionChecklist'
  >,
): string | null {
  if (canStageMoveKanbanCard(card)) return null
  const group = stageMoveTemplateGroupForCard(card)
  const rule = STAGE_MOVE_RULES[group] ?? STAGE_MOVE_RULES.other
  if (!rule.draggable) return rule.notDraggableReason || 'Stage is set automatically'
  return 'This card cannot be moved.'
}

export {
  cardHasAssignedVendorForStageMove,
  isInspectionVisitKanbanCard,
  stageMoveTicketIdsForCard,
}
