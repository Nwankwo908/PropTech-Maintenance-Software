/**
 * Shared domain-tool result contract.
 * Every business tool returns ToolResult<T> — predictable success / data / evidence.
 */

export type EvidenceItem = {
  id: string
  /** Table, graph event, API, or tool source key. */
  source: string
  label: string
  excerpt?: string
  url?: string | null
  entityIds?: Record<string, string | null>
}

export type ToolResult<T> = {
  success: boolean
  data?: T
  evidence: EvidenceItem[]
  error?: string
}

export function toolOk<T>(data: T, evidence: EvidenceItem[] = []): ToolResult<T> {
  return { success: true, data, evidence }
}

export function toolFail<T = never>(error: string, evidence: EvidenceItem[] = []): ToolResult<T> {
  return { success: false, evidence, error }
}

export function toolEmpty<T>(empty: T, evidence: EvidenceItem[] = []): ToolResult<T> {
  return { success: true, data: empty, evidence }
}
