export { PIPELINE_VERSION } from "./types.ts"
export type {
  ClassificationEntities,
  ClassificationResult,
  ClassifyMaintenanceInput,
  ClarificationPrompt,
  EmergencyType,
  IssueType,
  SemanticMatch,
  SeverityLevel,
  VendorTrade,
} from "./types.ts"

export { sanitizeDescriptionDeterministic, sanitizeMaintenanceDescription } from "./sanitizer.ts"
export { extractEntities } from "./entities.ts"
export {
  inferIssueTypeFromRules,
  inferTradeFromText,
  matchDeterministicRules,
} from "./deterministicRules.ts"
export { semanticMatchDescription, SEMANTIC_PHRASE_LIBRARY } from "./semanticMap.ts"
export { buildClarificationPrompt, buildClassificationAck } from "./clarification.ts"
export {
  classifyIssueForSlaUnified,
  classifyMaintenanceRequest,
} from "./pipeline.ts"

/** Graph / audit event names */
export const MAINTENANCE_CLASSIFICATION_EVENTS = {
  TEXT_SANITIZED: "MAINTENANCE_TEXT_SANITIZED",
  ENTITIES_EXTRACTED: "MAINTENANCE_ENTITIES_EXTRACTED",
  SEMANTIC_MATCHED: "MAINTENANCE_SEMANTIC_MATCHED",
  CLASSIFIED: "MAINTENANCE_CLASSIFIED",
  CLARIFICATION_REQUESTED: "MAINTENANCE_CLARIFICATION_REQUESTED",
  OTHER_POSTCHECK: "MAINTENANCE_OTHER_POSTCHECK",
  ROUTING_COMPLETED: "MAINTENANCE_ROUTING_COMPLETED",
} as const
