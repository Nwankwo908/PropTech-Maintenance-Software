/**
 * Which SMS conversation Active Tasks / work-order monitoring should open.
 *
 * Resident intake and vendor job alert are separate threads (same as Messages).
 * "See thread" on the work-order card is the resident conversation; vendor job
 * SMS stays available as a separate vendor thread id.
 */

export type WorkOrderConversationRow = {
  id: string
  conversation_type?: string | null
}

function asType(row: WorkOrderConversationRow): string {
  return (row.conversation_type ?? '').trim().toLowerCase()
}

export function pickResidentWorkOrderConversationId(
  rows: WorkOrderConversationRow[],
): string | null {
  if (!rows.length) return null
  const resident = rows.find((row) => asType(row) === 'resident_intake')
  if (resident?.id) return resident.id
  const nonVendor = rows.find((row) => {
    const type = asType(row)
    return (
      type &&
      type !== 'vendor_alert' &&
      type !== 'ai_copilot' &&
      type !== 'landlord_update'
    )
  })
  if (nonVendor?.id) return nonVendor.id
  return null
}

export function pickVendorWorkOrderConversationId(
  rows: WorkOrderConversationRow[],
): string | null {
  const vendor = rows.find((row) => asType(row) === 'vendor_alert')
  return vendor?.id?.trim() || null
}

/**
 * Primary conversation for resident-facing "See thread" / uloThread.
 * Prefer resident intake; only fall back to vendor when no resident thread exists.
 */
export function pickPrimaryWorkOrderConversationId(
  rows: WorkOrderConversationRow[],
  metadataConversationId?: string | null,
): { conversationId: string | null; vendorConversationId: string | null } {
  const vendorConversationId = pickVendorWorkOrderConversationId(rows)
  const residentId = pickResidentWorkOrderConversationId(rows)
  const meta = metadataConversationId?.trim() || null

  if (residentId) {
    return { conversationId: residentId, vendorConversationId }
  }
  if (meta && rows.some((row) => row.id === meta && asType(row) !== 'vendor_alert')) {
    return { conversationId: meta, vendorConversationId }
  }
  if (meta && !vendorConversationId) {
    return { conversationId: meta, vendorConversationId }
  }
  // No resident thread — last resort is vendor so the card still has a thread.
  return {
    conversationId: vendorConversationId ?? meta ?? rows[0]?.id ?? null,
    vendorConversationId,
  }
}
