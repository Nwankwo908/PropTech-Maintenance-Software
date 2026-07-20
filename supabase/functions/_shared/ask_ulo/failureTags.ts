/**
 * Extract structured failure tags from Ask Ulo toolsUsed for eval / feedback loops.
 * Queryable without parsing free-form quality_summary prose.
 */

export type AskUloFailureTag =
  | "no_tool_matched"
  | "catchall_none"
  | "incomplete_ranking"
  | "honest_gap"
  | "quality_gate_block"
  | "subject_gate_block"
  | "property_ranking_incomplete"
  | "unit_ranking_incomplete"
  | "tool_miss_incomplete"
  | "epistemic_internal_unmatched"

/**
 * Derive durable failure tags from toolsUsed audit strings.
 */
export function extractAskUloFailureTags(toolsUsed: string[]): AskUloFailureTag[] {
  const tags = new Set<AskUloFailureTag>()
  for (const raw of toolsUsed) {
    const t = raw.trim()
    if (!t) continue
    if (t === "no_tool_matched") tags.add("no_tool_matched")
    if (t === "catchall_fallback:none") tags.add("catchall_none")
    if (t === "epistemic:internal_unmatched") tags.add("epistemic_internal_unmatched")
    if (t.startsWith("prefer_packet:incomplete_")) {
      tags.add("incomplete_ranking")
      if (t.includes("property_ranking")) tags.add("property_ranking_incomplete")
      if (t.includes("unit_maintenance_ranking")) tags.add("unit_ranking_incomplete")
      if (t.includes("tool_miss") || t.includes("catchall_none")) {
        tags.add("tool_miss_incomplete")
      }
    }
    if (t === "prefer_packet:honest_gap") tags.add("honest_gap")
    if (t.includes("property_ranking:incomplete")) {
      tags.add("property_ranking_incomplete")
      tags.add("incomplete_ranking")
    }
    if (t.includes("unit_maintenance_ranking:incomplete")) {
      tags.add("unit_ranking_incomplete")
      tags.add("incomplete_ranking")
    }
    if (t.includes("quality_gate:") && t.includes("_block")) {
      tags.add("quality_gate_block")
      if (t.includes("subject_gate") || t.includes("subject_match_block")) {
        tags.add("subject_gate_block")
      }
    }
  }
  return [...tags].sort()
}

/** Compact summary line for quality_summary / logs. */
export function formatFailureTagsSummary(tags: AskUloFailureTag[]): string | null {
  if (tags.length === 0) return null
  return `failures:[${tags.join(",")}]`
}
