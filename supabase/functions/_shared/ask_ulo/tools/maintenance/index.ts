/**
 * Maintenance domain tools — work orders, workflows, awaiting decisions, drafts.
 */

export {
  searchWorkOrders,
  searchWorkOrdersAsToolResult,
  toSearchWorkOrdersToolResult,
  type SearchWorkOrdersParams,
  type SearchWorkOrdersResult,
} from "./searchWorkOrders.ts"

export {
  getAwaitingDecisions,
  type GetAwaitingDecisionsParams,
  type GetAwaitingDecisionsResult,
} from "./getAwaitingDecisions.ts"

export {
  listActiveWorkflows,
  isUloActiveTasksQuestion,
  type ListActiveWorkflowsParams,
  type ListActiveWorkflowsResult,
} from "./listActiveWorkflows.ts"

export {
  draftCommunication,
  isDraftCommunicationQuestion,
  type DraftCommunicationKind,
  type DraftCommunicationResult,
} from "./draftCommunication.ts"
