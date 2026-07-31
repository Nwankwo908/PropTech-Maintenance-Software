/**
 * Re-export shim — implementation split by responsibility:
 *   openai.ts / fallback.ts / packets.ts / index.ts
 */

export {
  synthesizeAskUloAnswer,
  buildFallbackAskUloAnswer,
  ensureReasoningTransparency,
  mergeCitations,
  synthesizeWithOpenAI,
  ANSWER_MODEL,
} from "./index.ts"

export type {
  AskUloHistoryMessage,
  AskUloTokenUsage,
  AskUloSynthesis,
  AskUloToolPackets,
} from "./toolPackets.ts"
