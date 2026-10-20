import { supabase } from '@/lib/supabase'

/** Persist an idempotency key for an onboarding import record (best-effort upsert). */
export async function recordOnboardingImportKey(input: {
  landlordId: string
  onboardingSessionId: string
  documentKey: string
  recordKind: 'property' | 'unit' | 'resident' | 'lease'
  recordKey: string
  entityId?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase is not configured.' }
  }
  const sessionId = input.onboardingSessionId.trim()
  const documentKey = input.documentKey.trim() || 'manual'
  const recordKey = input.recordKey.trim()
  if (!sessionId || !recordKey) {
    return { ok: false, error: 'Missing import key fields.' }
  }

  const { error } = await supabase.from('onboarding_import_keys').upsert(
    {
      landlord_id: input.landlordId,
      onboarding_session_id: sessionId,
      document_key: documentKey,
      record_kind: input.recordKind,
      record_key: recordKey,
      entity_id: input.entityId?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'landlord_id,onboarding_session_id,document_key,record_kind,record_key',
    },
  )

  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export function residentImportRecordKey(input: {
  fullName: string
  unit?: string | null
  building?: string | null
  leaseStart?: string | null
  leaseEnd?: string | null
}): string {
  return [
    input.fullName.trim().toLowerCase(),
    (input.unit ?? '').trim().toLowerCase(),
    (input.building ?? '').trim().toLowerCase(),
    (input.leaseStart ?? '').trim(),
    (input.leaseEnd ?? '').trim(),
  ].join('|')
}
