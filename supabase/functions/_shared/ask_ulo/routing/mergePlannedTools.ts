/**
 * Merge domain tool plans — primary (capability / OpenAI) wins on name collision.
 */
import type { PlannedDomainToolCall } from "./selectTools.ts"

export function mergePlannedToolCalls(
  primary: PlannedDomainToolCall[],
  additional: PlannedDomainToolCall[],
): PlannedDomainToolCall[] {
  const byName = new Map<string, PlannedDomainToolCall>()
  for (const call of primary) byName.set(call.name, call)
  for (const call of additional) {
    if (!byName.has(call.name)) byName.set(call.name, call)
  }
  return [...byName.values()]
}
