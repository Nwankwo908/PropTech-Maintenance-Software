type Channel = 'email' | 'sms'

type BroadcastMetricsStore = {
  sendSuccessByChannel: number
  sendFailureByChannel: number
  scheduledMessages: number
}

export type BroadcastMetricsSnapshot = BroadcastMetricsStore

const STORAGE_KEY = 'proptech.broadcast.metrics.v1'
const UPDATE_EVENT = 'proptech:broadcast-metrics-updated'

const EMPTY: BroadcastMetricsStore = {
  sendSuccessByChannel: 0,
  sendFailureByChannel: 0,
  scheduledMessages: 0,
}

function readStore(): BroadcastMetricsStore {
  if (typeof localStorage === 'undefined') return { ...EMPTY }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as Partial<BroadcastMetricsStore> | null
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY }
    return {
      sendSuccessByChannel:
        typeof parsed.sendSuccessByChannel === 'number'
          ? parsed.sendSuccessByChannel
          : 0,
      sendFailureByChannel:
        typeof parsed.sendFailureByChannel === 'number'
          ? parsed.sendFailureByChannel
          : 0,
      scheduledMessages:
        typeof parsed.scheduledMessages === 'number'
          ? parsed.scheduledMessages
          : 0,
    }
  } catch {
    return { ...EMPTY }
  }
}

function writeStore(next: BroadcastMetricsStore): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UPDATE_EVENT))
  }
}

export function recordBroadcastSendAttempt(
  channels: readonly Channel[],
  success: boolean,
): void {
  const channelCount = channels.length
  if (channelCount <= 0) return
  const current = readStore()
  const next: BroadcastMetricsStore = {
    ...current,
    sendSuccessByChannel:
      current.sendSuccessByChannel + (success ? channelCount : 0),
    sendFailureByChannel:
      current.sendFailureByChannel + (success ? 0 : channelCount),
  }
  writeStore(next)
}

export function recordScheduledBroadcastCreated(count = 1): void {
  if (!Number.isFinite(count) || count <= 0) return
  const current = readStore()
  writeStore({
    ...current,
    scheduledMessages: current.scheduledMessages + count,
  })
}

export function getBroadcastMetricsSnapshot(): BroadcastMetricsSnapshot {
  return readStore()
}

export function listenBroadcastMetrics(
  onChange: (snapshot: BroadcastMetricsSnapshot) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const update = () => onChange(getBroadcastMetricsSnapshot())
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) update()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(UPDATE_EVENT, update)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(UPDATE_EVENT, update)
  }
}
