import { getSessionLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'
import {
  captureAttributionFromLocation,
  hasAttributionTouch,
  type AttributionSnapshot,
  type AttributionTouch,
} from './attribution'

export type LandlordAttributionPayload = {
  acquisition_source?: string
  acquisition_medium?: string
  acquisition_campaign?: string
  acquisition_content?: string
  acquisition_term?: string
  acquisition_first_touch_at?: string
  latest_acquisition_source?: string | null
  latest_acquisition_medium?: string | null
  latest_acquisition_campaign?: string | null
  latest_acquisition_content?: string | null
  latest_acquisition_term?: string | null
  acquisition_latest_touch_at?: string
}

function touchTimestamp(touch: AttributionTouch): string | undefined {
  return touch.capturedAt
}

function assignFirst(
  payload: LandlordAttributionPayload,
  touch: AttributionTouch,
): void {
  if (touch.source) payload.acquisition_source = touch.source
  if (touch.medium) payload.acquisition_medium = touch.medium
  if (touch.campaign) payload.acquisition_campaign = touch.campaign
  if (touch.content) payload.acquisition_content = touch.content
  if (touch.term) payload.acquisition_term = touch.term
  const at = touchTimestamp(touch)
  if (at) payload.acquisition_first_touch_at = at
}

function assignLatest(
  payload: LandlordAttributionPayload,
  touch: AttributionTouch,
): void {
  payload.latest_acquisition_source = touch.source ?? null
  payload.latest_acquisition_medium = touch.medium ?? null
  payload.latest_acquisition_campaign = touch.campaign ?? null
  payload.latest_acquisition_content = touch.content ?? null
  payload.latest_acquisition_term = touch.term ?? null
  payload.acquisition_latest_touch_at = touchTimestamp(touch) ?? new Date().toISOString()
}

export function buildLandlordAttributionPayload(
  snapshot: AttributionSnapshot,
): LandlordAttributionPayload | null {
  const payload: LandlordAttributionPayload = {}
  if (hasAttributionTouch(snapshot.firstTouch)) {
    assignFirst(payload, snapshot.firstTouch)
  }
  if (hasAttributionTouch(snapshot.latestTouch)) {
    assignLatest(payload, snapshot.latestTouch)
  } else if (hasAttributionTouch(snapshot.firstTouch)) {
    assignLatest(payload, snapshot.firstTouch)
  }
  return Object.keys(payload).length > 0 ? payload : null
}

function attributionDebug(message: string, meta?: Record<string, string | boolean | number | null>): void {
  if (!import.meta.env.DEV) return
  console.info('[analytics]', message, meta ?? {})
}

export async function persistAnonymousAttributionToLandlord(
  landlordId: string,
): Promise<void> {
  try {
    const id = landlordId.trim()
    if (!id || !supabase) {
      attributionDebug('persist skipped', { reason: !id ? 'empty_landlord_id' : 'no_supabase' })
      return
    }
    const snapshot = captureAttributionFromLocation()
    const payload = buildLandlordAttributionPayload(snapshot)
    if (!payload) {
      attributionDebug('persist skipped', { reason: 'no_browser_utm' })
      return
    }

    const hadFirst =
      Boolean(payload.acquisition_source) ||
      Boolean(payload.acquisition_medium) ||
      Boolean(payload.acquisition_campaign)

    let firstAlreadySet = true
    if (hadFirst) {
      const existing = await supabase
        .from('landlords')
        .select('acquisition_source')
        .eq('id', id)
        .maybeSingle()
      if (!existing.error) {
        const source = (existing.data as { acquisition_source?: string | null } | null)
          ?.acquisition_source
        firstAlreadySet = Boolean(source)
      }
    }

    const { data, error } = await supabase
      .from('landlords')
      .update(payload)
      .eq('id', id)
      .select('id')
    if (error) {
      attributionDebug('persist update error', {
        reason: /acquisition_|column .* does not exist/i.test(error.message)
          ? 'column_missing'
          : 'update_error',
      })
      if (/acquisition_|column .* does not exist/i.test(error.message)) return
      console.warn('[analytics] persist landlord attribution', error.message)
      return
    }
    if (!data?.length) {
      attributionDebug('persist skipped', { reason: 'rls_or_no_row' })
      return
    }
    attributionDebug('persist wrote', { first_already_set: firstAlreadySet })

    if (hadFirst && !firstAlreadySet) {
      const { recordActivityLog } = await import('@/lib/recordActivityLog')
      await recordActivityLog({
        landlordId: id,
        eventType: 'landlord.acquisition_attributed',
        source: 'dashboard',
        actorType: 'landlord',
        metadata: {
          message: 'Visitor acquisition source saved for this account.',
          acquisition_source: payload.acquisition_source ?? null,
        },
      })
    }
  } catch {
    attributionDebug('persist skipped', { reason: 'exception' })
  }
}

/** Account-bound logins only — never stamp staff-switcher / default ops accounts. */
export async function persistAnonymousAttributionForSessionLandlord(): Promise<void> {
  const landlordId = getSessionLandlordId()
  if (!landlordId) {
    attributionDebug('persist skipped', { reason: 'no_session_landlord' })
    return
  }
  await persistAnonymousAttributionToLandlord(landlordId)
}
