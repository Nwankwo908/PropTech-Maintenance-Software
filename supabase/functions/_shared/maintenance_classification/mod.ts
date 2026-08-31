export { PIPELINE_VERSION } from "./types.ts"
export type {
  ClassificationEntities,
  ClassificationResult,
  ClassifyMaintenanceInput,
  ClassifyMaintenanceSmsContext,
  ClarificationPrompt,
  EmergencyType,
  IssueType,
  SemanticMatch,
  SeverityLevel,
  VendorTrade,
} from "./types.ts"

export { toLandlordTriage, parseLandlordTriageJson, validateLandlordTriage } from "../../../../shared/maintenance/landlordTriage.ts"
export type { LandlordTriage } from "../../../../shared/maintenance/landlordTriage.ts"

export { sanitizeDescriptionDeterministic, sanitizeMaintenanceDescription } from "./sanitizer.ts"
export { extractEntities } from "./entities.ts"
export {
  inferIssueTypeFromRules,
  inferTradeFromText,
  matchDeterministicRules,
} from "./deterministicRules.ts"
export { llmClassifyMaintenance, parseLlmClassificationDraft } from "./llmClassify.ts"
export { buildClarificationPrompt, buildClassificationAck } from "./clarification.ts"
export {
  classifyIssueForSlaUnified,
  classifyMaintenanceRequest,
} from "./pipeline.ts"
export {
  insertAiClassificationLog,
  attachAiClassificationLogToTicket,
} from "./logAiClassification.ts"
export { resolveAmbiguousMaintenance } from "../../../../shared/maintenance/ambiguityResolution.ts"
export { resolveConfidenceBand, isLowConfidenceDescription } from "../../../../shared/maintenance/confidencePolicy.ts"
export type { ConfidenceBand } from "../../../../shared/maintenance/confidencePolicy.ts"
export { resolveUrgencyPolicy, parseDurationHours, descriptionNeedsOutdoorTemp } from "../../../../shared/maintenance/urgencyPolicy.ts"
export type { UrgencyBand } from "../../../../shared/maintenance/urgencyPolicy.ts"
export {
  PRIMARY_CATEGORIES,
  primaryCategoryFromTrade,
  type PrimaryCategory,
} from "../../../../shared/maintenance/primaryCategories.ts"

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
