/**
 * Communication inbox read receipts (client-side).
 * A thread is unread until the admin opens it; opening stamps last_read_at.
 */

const STORAGE_PREFIX = 'ulo.communicationInboxRead.'

type ReadMap = Record<string, number>

function storageKey(landlordId: string): string {
  return `${STORAGE_PREFIX}${landlordId}`
}

function readMap(landlordId: string): ReadMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey(landlordId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: ReadMap = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const ms = typeof value === 'number' ? value : Number(value)
      if (id && Number.isFinite(ms) && ms > 0) out[id] = ms
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(landlordId: string, map: ReadMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(landlordId), JSON.stringify(map))
  } catch {
    /* ignore quota / private mode */
  }
}

export function getConversationLastReadAtMs(
  landlordId: string,
  conversationId: string,
): number | null {
  const ms = readMap(landlordId)[conversationId]
  return ms && Number.isFinite(ms) ? ms : null
}

/** Mark a conversation as read at `readAtMs` (defaults to now). */
export function markCommunicationConversationRead(
  landlordId: string,
  conversationId: string,
  readAtMs: number = Date.now(),
): void {
  const id = conversationId.trim()
  if (!landlordId.trim() || !id) return
  const map = readMap(landlordId)
  const previous = map[id] ?? 0
  if (readAtMs <= previous) return
  map[id] = readAtMs
  writeMap(landlordId, map)
}

/**
 * True when the thread should show the unread blue dot / bold treatment.
 * Opening the thread stamps last_read_at; a newer inbound activity makes it unread again.
 */
export function isCommunicationConversationUnread(input: {
  landlordId: string
  conversationId: string
  lastActivityMs: number
  /** Heuristic candidate before read receipts (e.g. latest inbound + open). */
  activityLooksUnread: boolean
}): boolean {
  if (!input.activityLooksUnread) return false
  const lastRead = getConversationLastReadAtMs(input.landlordId, input.conversationId)
  if (lastRead == null) return true
  return input.lastActivityMs > lastRead
}
