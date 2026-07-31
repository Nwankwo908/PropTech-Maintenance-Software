/**
 * Decide which domain tools to run for this turn (rules + optional OpenAI select).
 * Belongs in the plan stage (`planAskUloTurn`) — not retrieve.
 */

import {
  isOpenAiToolSelectEnabled,
  selectDomainToolsWithOpenAI,
  type PlannedDomainToolCall,
} from "./selectTools.ts"
import {
  applyPlannedToolsToNeeds,
  type DomainToolNeedsPatch,
  type ToolSelectSubjectLocks,
} from "./toolSelectNeeds.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import type { AskUloCapability } from "./capability.ts"
import type { AskUloQuestionSubject } from "./detectSubject.ts"
import { logToolSelect } from "../audit/logToolCalls.ts"

export type AskUloToolSelectSource = "openai" | "rules" | "skipped" | "error"

export type AskUloToolSelection = {
  plannedTools: PlannedDomainToolCall[]
  toolSelectSource: AskUloToolSelectSource
  noToolMatched: boolean
  toolNeeds: DomainToolNeedsPatch
}

/**
 * Resolve planned tools from rule plan + optional OpenAI allowlisted select.
 */
export async function resolveToolSelection(input: {
  question: string
  ruleToolPlan: PlannedDomainToolCall[]
  toolAllowlist: DomainToolId[]
  toolSelectLocks: ToolSelectSubjectLocks
  subject: AskUloQuestionSubject
  capability: AskUloCapability
}): Promise<AskUloToolSelection> {
  let plannedTools: PlannedDomainToolCall[] = input.ruleToolPlan
  let toolSelectSource: AskUloToolSelectSource = "rules"
  let noToolMatched = false

  if (isOpenAiToolSelectEnabled() && input.toolAllowlist.length > 0) {
    const llmSelect = await selectDomainToolsWithOpenAI({
      question: input.question,
      allowlist: input.toolAllowlist,
      subject: input.subject,
      capability: input.capability,
    })
    if (llmSelect.ok && llmSelect.tools.length > 0) {
      const byName = new Map<string, PlannedDomainToolCall>()
      for (const t of input.ruleToolPlan) byName.set(t.name, t)
      for (const t of llmSelect.tools) byName.set(t.name, t)
      plannedTools = [...byName.values()]
      toolSelectSource = "openai"
      noToolMatched = false
    } else {
      noToolMatched = llmSelect.noToolMatched || llmSelect.source === "empty"
      toolSelectSource = llmSelect.source === "error" ? "error" : "rules"
      plannedTools = input.ruleToolPlan
    }
    logToolSelect({
      source: toolSelectSource,
      allowlist: input.toolAllowlist,
      tools_planned: plannedTools.map((t) => ({
        name: t.name,
        arguments: t.arguments,
      })),
      no_tool_matched: noToolMatched,
      openai_source: llmSelect.source,
      error: llmSelect.error ?? null,
      model: llmSelect.model ?? null,
      latencyMs: llmSelect.latencyMs ?? null,
    })
  } else {
    logToolSelect({
      source: "rules",
      allowlist: input.toolAllowlist,
      tools_planned: plannedTools.map((t) => ({
        name: t.name,
        arguments: t.arguments,
      })),
      no_tool_matched: false,
      openai_source: "skipped",
    })
  }

  const toolNeeds = applyPlannedToolsToNeeds(
    plannedTools,
    input.toolSelectLocks,
  )

  return {
    plannedTools,
    toolSelectSource,
    noToolMatched,
    toolNeeds,
  }
}
