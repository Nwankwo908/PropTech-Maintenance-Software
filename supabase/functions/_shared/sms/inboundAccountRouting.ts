/**
 * Choose which landlord an inbound SMS belongs to.
 *
 * The receiving number's permitted accounts are decided first. Inside that
 * scope, a current explicit assignment wins over message history. History is
 * only a fallback when it identifies one eligible account and no current
 * assignment conflicts. Closed threads and disconnected accounts do not
 * restore an old association.
 */

export type InboundExplicitAssignment = {
  landlordId: string
}

export type InboundHistoryMatch = {
  landlordId: string
  at?: string | null
  /** Closed conversations are never eligible, even if a caller includes them. */
  closed?: boolean
}

export type InboundAccountDecision = {
  landlordId: string | null
  reason: "explicit" | "history" | "ambiguous" | "assigned_elsewhere" | "unmatched"
}

export function landlordAllowedOnReceivingLine(params: {
  sharedLine: boolean
  lineOwnerLandlordId?: string | null
  landlordId: string
  usesSharedLine?: boolean
}): boolean {
  const id = params.landlordId.trim()
  if (!id) return false
  const owner = (params.lineOwnerLandlordId ?? "").trim()
  if (!params.sharedLine) return Boolean(owner) && id === owner
  if (owner && id === owner) return true
  return params.usesSharedLine === true
}

function cleanId(value: string | null | undefined): string {
  return (value ?? "").trim()
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

/**
 * Newest eligible history row. Equal timestamps on different accounts are
 * ambiguous — the sort order must not pick a winner.
 */
export function historyFallbackLandlordId(
  history: readonly InboundHistoryMatch[],
  allowed: ReadonlySet<string>,
  disconnected: ReadonlySet<string>,
): { landlordId: string | null; ambiguous: boolean } {
  const eligible = history.filter((row) => {
    const id = cleanId(row.landlordId)
    return Boolean(id) && !row.closed && allowed.has(id) && !disconnected.has(id)
  })
  if (eligible.length === 0) return { landlordId: null, ambiguous: false }
  const newestAt = eligible.reduce((best, row) => {
    const at = cleanId(row.at)
    return at > best ? at : best
  }, "")
  const top = newestAt
    ? eligible.filter((row) => cleanId(row.at) === newestAt)
    : eligible
  const ids = uniqueIds(top.map((row) => row.landlordId))
  if (ids.length === 1) return { landlordId: ids[0], ambiguous: false }
  return { landlordId: null, ambiguous: true }
}

export function resolveInboundAccount(input: {
  permittedLandlordIds: readonly string[]
  explicit: readonly InboundExplicitAssignment[]
  history?: readonly InboundHistoryMatch[]
  disconnectedLandlordIds?: readonly string[]
}): InboundAccountDecision {
  const allowed = new Set(uniqueIds(input.permittedLandlordIds))
  const disconnected = new Set(uniqueIds(input.disconnectedLandlordIds ?? []))
  const explicitIds = uniqueIds(
    input.explicit
      .map((row) => cleanId(row.landlordId))
      .filter((id) => allowed.has(id) && !disconnected.has(id)),
  )
  const explicitAnywhere = uniqueIds(input.explicit.map((row) => cleanId(row.landlordId)))

  if (explicitIds.length === 1) return { landlordId: explicitIds[0], reason: "explicit" }
  if (explicitIds.length > 1) return { landlordId: null, reason: "ambiguous" }
  if (explicitAnywhere.length > 0) {
    return { landlordId: null, reason: "assigned_elsewhere" }
  }

  const fallback = historyFallbackLandlordId(input.history ?? [], allowed, disconnected)
  if (fallback.ambiguous) return { landlordId: null, reason: "ambiguous" }
  if (fallback.landlordId) return { landlordId: fallback.landlordId, reason: "history" }
  return { landlordId: null, reason: "unmatched" }
}
