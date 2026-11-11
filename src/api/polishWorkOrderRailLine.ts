import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
  getAdminEdgeSecret,
} from '@/lib/adminEdgeAuth'

export type WorkOrderRailLinePolishRequest = {
  id: string
  draft: string
  mustKeep?: string[]
  /** status = Overview / next-step / Activity; issue_description = Issue details body */
  kind?: 'status' | 'issue_description'
}

export type WorkOrderRailLinePolishResult = {
  id: string
  line: string
  method: 'deterministic' | 'llm_polish'
}

export function resolvePolishWorkOrderRailLineUrl(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/polish-work-order-rail-line`
  return null
}

/**
 * Best-effort Luna rewrite for Active Tasks Overview / next-step drafts.
 * Returns null when the edge function is unavailable so callers keep the draft.
 */
export async function postPolishWorkOrderRailLines(
  lines: WorkOrderRailLinePolishRequest[],
): Promise<WorkOrderRailLinePolishResult[] | null> {
  const url = resolvePolishWorkOrderRailLineUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret || lines.length === 0) return null

  try {
    const res = await fetchAdminEdgeFunction(url, {
      method: 'POST',
      headers: await adminEdgeInvokeHeaders(secret),
      body: JSON.stringify({ lines }),
    })
    const text = await res.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      return null
    }
    if (!res.ok) return null
    const rows = (body as { lines?: unknown }).lines
    if (!Array.isArray(rows)) return null
    return rows
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const record = row as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id : ''
        const line = typeof record.line === 'string' ? record.line.trim() : ''
        const method =
          record.method === 'llm_polish' ? 'llm_polish' : 'deterministic'
        if (!id || !line) return null
        return { id, line, method } satisfies WorkOrderRailLinePolishResult
      })
      .filter((row): row is WorkOrderRailLinePolishResult => row != null)
  } catch {
    return null
  }
}
