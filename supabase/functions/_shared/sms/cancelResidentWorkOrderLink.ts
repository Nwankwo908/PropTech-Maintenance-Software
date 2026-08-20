/** True when a maintenance workflow run belongs to the ticket being cancelled. */
export function runLinksCancelledTicket(
  run: {
    entity_id?: string | null
    entity_type?: string | null
    metadata?: Record<string, unknown> | null
  },
  ticketId: string,
): boolean {
  const wanted = ticketId.trim()
  if (!wanted) return false
  const entityId = (run.entity_id ?? "").trim()
  if (entityId === wanted) return true
  const meta = run.metadata && typeof run.metadata === "object" ? run.metadata : {}
  const draft = typeof meta.draft_ticket_id === "string" ? meta.draft_ticket_id.trim() : ""
  const linked = typeof meta.maintenance_request_id === "string"
    ? meta.maintenance_request_id.trim()
    : ""
  return draft === wanted || linked === wanted
}
