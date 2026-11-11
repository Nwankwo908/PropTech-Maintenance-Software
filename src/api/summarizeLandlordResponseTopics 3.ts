import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
  getAdminEdgeSecret,
} from '@/lib/adminEdgeAuth'

export function resolveSummarizeLandlordResponseTopicsUrl(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/summarize-landlord-response-topics`
  return null
}

/** One sentence per source text, in the same order. Throws when the function is unavailable. */
export async function postSummarizeLandlordResponseTopics(
  topics: string[],
): Promise<string[]> {
  const url = resolveSummarizeLandlordResponseTopicsUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret || topics.length === 0) {
    throw new Error('Topic summaries are unavailable')
  }
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: await adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({ topics }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Topic summaries: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    throw new Error(err.error ?? `Topic summaries failed (${res.status})`)
  }
  const summaries = (body as { summaries?: unknown }).summaries
  if (!Array.isArray(summaries) || summaries.length !== topics.length) {
    throw new Error('Topic summaries came back in the wrong shape')
  }
  return summaries.map((line) => (typeof line === 'string' ? line.trim() : ''))
}
