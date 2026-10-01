/**
 * Product-support job path: verified help → clarify → ticket + confirmation.
 * Never reads portfolio tools; never calls counsel_handoff.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloResponse, AskUloRunInput } from "../core/types.ts"
import { parseAskUloAgentMode } from "../routing/selectMode.ts"
import type { AskUloJobClassification } from "../routing/classifyAskUloJob.ts"
import { matchVerifiedHelp } from "./helpCorpus.ts"
import {
  createOrBumpProductSupportTicket,
  historyHadClarifyingAttempt,
  shouldOpenProductSupportTicket,
} from "./createProductSupportTicket.ts"

function emptyJurisdiction(): AskUloResponse["jurisdiction"] {
  return {
    countryCode: "US",
    stateCode: null,
    countySlug: null,
    countyLabel: null,
    citySlug: null,
    cityLabel: null,
    courtSystem: null,
    housingProgram: null,
    codeSet: null,
  }
}

function baseResponse(input: {
  answer: string
  intent?: string
  agentMode: AskUloRunInput["agentMode"]
  supportTicket?: AskUloResponse["supportTicket"]
}): AskUloResponse {
  return {
    answer: input.answer,
    citations: [],
    toolsUsed: ["product_support"],
    mode: "fallback",
    model: null,
    intent: input.intent ?? "product_support",
    agentMode: parseAskUloAgentMode(input.agentMode),
    evalId: null,
    jurisdiction: emptyJurisdiction(),
    visualContext: null,
    legalAudit: null,
    safetyBoundary: null,
    supportTicket: input.supportTicket ?? null,
  }
}

const CLARIFY_ANSWER = [
  "## Quick check",
  "",
  "I want to make sure I help with the right thing. Are you stuck on a **specific screen or button** in Ulo (settings, residents, vendors, onboarding), or do you need the product team to look into a bug?",
  "",
  "Reply with a short description of what you tried and what you expected. If you’d rather talk to support now, say **I need help from support**.",
].join("\n")

export async function runProductSupportTurn(
  supabase: SupabaseClient,
  input: AskUloRunInput,
  job: AskUloJobClassification,
): Promise<AskUloResponse> {
  const help = matchVerifiedHelp(input.question)
  const hadClarify = historyHadClarifyingAttempt(input.history)
  const unresolved = !help

  const openTicket = shouldOpenProductSupportTicket({
    explicitSupportAsk: job.explicitSupportAsk,
    helpMatched: Boolean(help),
    hadClarifyingAttempt: hadClarify,
    unresolved,
  })

  // First unresolved ask without explicit support → clarify once (no ticket yet).
  if (
    !openTicket &&
    unresolved &&
    !hadClarify &&
    !job.explicitSupportAsk
  ) {
    return baseResponse({
      answer: CLARIFY_ANSWER,
      agentMode: input.agentMode,
    })
  }

  if (help && !job.explicitSupportAsk) {
    return baseResponse({
      answer: help.answerMarkdown,
      agentMode: input.agentMode,
    })
  }

  // Ticket path: explicit support, or unresolved after clarify, or unresolved with no help.
  if (openTicket || job.explicitSupportAsk || (unresolved && hadClarify)) {
    const attempted =
      help?.answerMarkdown ??
      (hadClarify
        ? "Clarified once; still unresolved product-support ask."
        : "No matching verified help article.")

    const ticket = await createOrBumpProductSupportTicket(supabase, {
      landlordId: input.landlordId,
      adminUserId: input.userId,
      conversationId: input.conversationId,
      question: input.question,
      history: input.history,
      attemptedResolution: attempted,
    })

    if (!ticket.ok) {
      console.error("[ask_ulo] product support ticket failed", ticket.error)
      return baseResponse({
        answer: [
          "I wasn’t able to file a support ticket automatically just now.",
          "",
          "Please email **systems@ulohome.io** with a short description of what went wrong, and we’ll follow up.",
        ].join("\n"),
        agentMode: input.agentMode,
      })
    }

    const lead = help
      ? `${help.answerMarkdown}\n\n---`
      : [
          "I don’t have a verified help article that fully covers this yet.",
          "",
        ].join("\n")

    return baseResponse({
      answer: `${lead}\n\n${ticket.confirmationMarkdown}`.trim(),
      agentMode: input.agentMode,
      supportTicket: {
        id: ticket.ticketId,
        created: ticket.created,
        repeatCount: ticket.repeatCount,
        summary: ticket.summary,
        notifyStatus: ticket.notifyStatus,
      },
    })
  }

  return baseResponse({
    answer: CLARIFY_ANSWER,
    agentMode: input.agentMode,
  })
}
