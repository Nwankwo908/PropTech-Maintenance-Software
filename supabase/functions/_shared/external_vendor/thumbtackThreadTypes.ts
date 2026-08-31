export type ThumbtackThreadStatus = "awaiting_response" | "vendor_replied" | "closed"

export type ThumbtackVendorThreadRow = {
  id: string
  ticket_id: string
  landlord_id: string
  business_id: string
  vendor_name: string
  search_id: string | null
  category_id: string | null
  request_id: string | null
  negotiation_id: string | null
  status: ThumbtackThreadStatus
  last_outbound_text: string | null
  last_outbound_at: string | null
  last_inbound_text: string | null
  last_inbound_at: string | null
}

export function mapThumbtackThreadRow(row: Record<string, unknown>): ThumbtackVendorThreadRow {
  return {
    id: String(row.id),
    ticket_id: String(row.ticket_id),
    landlord_id: String(row.landlord_id),
    business_id: String(row.business_id),
    vendor_name: String(row.vendor_name ?? ""),
    search_id: typeof row.search_id === "string" ? row.search_id : null,
    category_id: typeof row.category_id === "string" ? row.category_id : null,
    request_id: typeof row.request_id === "string" ? row.request_id : null,
    negotiation_id: typeof row.negotiation_id === "string" ? row.negotiation_id : null,
    status: (row.status as ThumbtackThreadStatus) || "awaiting_response",
    last_outbound_text: typeof row.last_outbound_text === "string" ? row.last_outbound_text : null,
    last_outbound_at: typeof row.last_outbound_at === "string" ? row.last_outbound_at : null,
    last_inbound_text: typeof row.last_inbound_text === "string" ? row.last_inbound_text : null,
    last_inbound_at: typeof row.last_inbound_at === "string" ? row.last_inbound_at : null,
  }
}
