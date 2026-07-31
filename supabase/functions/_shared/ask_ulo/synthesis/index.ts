/**
 * Synthesis traffic controller:
 *   prepared answer? → OpenAI? → fallback
 *
 * Prefer-packet policy lives in retrieval/resolvePreferPacket.ts.
 */

import {
  preferPacketBagFromToolPackets,
  resolvePreferPacket,
} from "../retrieval/resolvePreferPacket.ts"
import { resolveIncompleteRankingSignal } from "../guards/incompleteEvidence.ts"
import type { AskUloCitation } from "../retrieval/searchInternalData.ts"
import { formatAskUloAnswer } from "./formatAnswer.ts"
import { synthesizeWithOpenAI, ANSWER_MODEL } from "./openai.ts"
import { buildFallbackAskUloAnswer } from "./fallback.ts"
import {
  mergeCitations,
  ensureReasoningTransparency,
} from "./packets.ts"
import type {
  AskUloTokenUsage,
  AskUloSynthesis,
  AskUloToolPackets,
} from "./toolPackets.ts"

export type {
  AskUloHistoryMessage,
  AskUloTokenUsage,
  AskUloSynthesis,
  AskUloToolPackets,
} from "./toolPackets.ts"

export { buildFallbackAskUloAnswer } from "./fallback.ts"
export { ensureReasoningTransparency, mergeCitations } from "./packets.ts"
export { synthesizeWithOpenAI, ANSWER_MODEL } from "./openai.ts"

function emptyUsageSynthesis(
  answer: string,
  citations: AskUloCitation[],
  mode: "openai" | "fallback",
  model: string | null,
): AskUloSynthesis {
  return {
    answer,
    citations,
    mode,
    model,
    usage: null,
    synthesizeMs: null,
  }
}

export async function synthesizeAskUloAnswer(
  packets: AskUloToolPackets,
): Promise<AskUloSynthesis> {
  const citations = mergeCitations(packets)
  const hasOpenAi = Boolean(Deno.env.get("OPENAI_API_KEY")?.trim())

  const finish = (
    answer: string,
    mode: "openai" | "fallback",
    model: string | null,
    extra?: { usage?: AskUloTokenUsage | null; synthesizeMs?: number | null },
  ): AskUloSynthesis => {
    const requireLegalDisclaimer = Boolean(
      packets.legalGate?.requireCounsel ||
        (packets.intent === "legal" &&
          /eviction|fair housing|discrimination|reasonable accommodation|lead|court/i
            .test(packets.question)),
    )
    const withTransparency = ensureReasoningTransparency(answer, packets)
    return {
      answer: formatAskUloAnswer(withTransparency, {
        requireLegalDisclaimer,
        // Legal path already skips polish inside ensureReasoningTransparency.
        polish: packets.intent !== "legal",
      }),
      citations,
      mode,
      model,
      usage: extra?.usage ?? null,
      synthesizeMs: extra?.synthesizeMs ?? null,
    }
  }

  // Legal clarify / refuse — never invent guidance without location or sources.
  if (
    packets.intent === "legal" &&
    packets.legalGate &&
    (packets.legalGate.status === "clarify" || packets.legalGate.status === "refuse") &&
    packets.legalGate.markdown
  ) {
    return emptyUsageSynthesis(packets.legalGate.markdown, citations, "fallback", null)
  }

  // Deterministic tables for price/rent history — stay tightly scoped to the question.
  if (
    packets.intent === "property_price_history" ||
    packets.intent === "price_history_ambiguous"
  ) {
    if (packets.priceHistory?.markdown) {
      return finish(
        packets.priceHistory.markdown,
        hasOpenAi ? "openai" : "fallback",
        hasOpenAi ? ANSWER_MODEL : null,
      )
    }
  }
  if (packets.intent === "rent_history" && packets.rentHistory?.markdown) {
    return finish(
      packets.rentHistory.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }

  // Specialty / incomplete / catch-all — same policy as prefer stage.
  const preferredSynth = resolvePreferPacket(preferPacketBagFromToolPackets(packets))
  if (preferredSynth.prefer) {
    return finish(
      preferredSynth.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }

  // When ranking is incomplete but not primary, strip inventable winners before OpenAI.
  const incompleteRanking = resolveIncompleteRankingSignal({
    propertyRanking: packets.propertyRanking
      ? {
          available: packets.propertyRanking.available,
          canRank: packets.propertyRanking.canRank,
          missingData: packets.propertyRanking.missingData,
          portfolioOpenWorkOrders: packets.propertyRanking.portfolioOpenWorkOrders,
        }
      : null,
    unitMaintenanceRanking: packets.unitMaintenanceRanking
      ? {
          available: packets.unitMaintenanceRanking.available,
          canRank: packets.unitMaintenanceRanking.canRank,
          missingData: packets.unitMaintenanceRanking.missingData,
          requestCount: packets.unitMaintenanceRanking.scopedRequestCount,
          unlinkedRequestCount: packets.unitMaintenanceRanking.unlinkedRequestCount,
          timeframeLabel: packets.unitMaintenanceRanking.timeframeLabel,
          scopeLabel: packets.unitMaintenanceRanking.scopeLabel,
        }
      : null,
    reasoningMode: packets.reasoningMode,
    preferUnit:
      packets.intent === "unit_maintenance_ranking" ||
      Boolean(packets.unitMaintenanceRanking && !packets.propertyRanking),
  })

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (apiKey) {
    try {
      // Strip inventable ranking winners when status is incomplete — even for non-primary paths.
      const safePackets =
        incompleteRanking && packets.propertyRanking && !packets.propertyRanking.canRank
          ? {
              ...packets,
              propertyRanking: {
                ...packets.propertyRanking,
                top: null,
                watch: [],
                markdown: incompleteRanking.kind === "property_ranking"
                  ? incompleteRanking.markdown
                  : packets.propertyRanking.markdown,
              },
            }
          : incompleteRanking &&
              packets.unitMaintenanceRanking &&
              !packets.unitMaintenanceRanking.canRank
            ? {
                ...packets,
                unitMaintenanceRanking: {
                  ...packets.unitMaintenanceRanking,
                  top: null,
                  ranked: [],
                  markdown: incompleteRanking.kind === "unit_maintenance_ranking"
                    ? incompleteRanking.markdown
                    : packets.unitMaintenanceRanking.markdown,
                },
              }
            : packets
      const openai = await synthesizeWithOpenAI(apiKey, safePackets)
      if (openai) {
        return finish(openai.text, "openai", ANSWER_MODEL, {
          usage: openai.usage,
          synthesizeMs: openai.synthesizeMs,
        })
      }
    } catch (err) {
      console.error("[ask_ulo/synthesize] threw", err)
    }
  }
  return finish(buildFallbackAskUloAnswer(packets), "fallback", null)
}
