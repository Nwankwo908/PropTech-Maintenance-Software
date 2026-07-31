/**
 * Citation helpers for Ask Ulo answers.
 * Merge lives in packets.ts; rankEvidence helpers re-exported for convenience.
 */

export type { AskUloCitation } from "../retrieval/searchInternalData.ts"
export { mergeCitations } from "./packets.ts"

export {
  assessAnswerConfidence,
  buildSourcesUsed,
  confidenceLabel,
  type AnswerConfidence,
  type SourceUsedItem,
} from "../retrieval/rankEvidence.ts"
