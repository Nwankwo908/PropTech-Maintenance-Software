/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAINTENANCE_API_URL?: string
  /** POST JSON { ticketId, comment } to append a resident message to the ticket thread (optional). */
  readonly VITE_MAINTENANCE_TICKET_COMMENT_URL?: string
  /** GET JSON ticket status: `?ticketId=` — optional `status`/`phase`/`state` + optional `detail`/`subtitle`. */
  readonly VITE_MAINTENANCE_TICKET_STATUS_URL?: string
  /** Poll interval in ms for ticket status (min 5000). Default 45000. */
  readonly VITE_MAINTENANCE_TICKET_STATUS_POLL_MS?: string
  readonly VITE_ISSUE_CLARIFY_API_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** POST JSON after ticket created — recurring / duplicate issue detection (optional). */
  readonly VITE_RECURRING_ISSUE_API_URL?: string
  /** POST JSON after ticket created — route or assign vendor (optional). */
  readonly VITE_VENDOR_ROUTING_API_URL?: string
  /** GET vendor-list-tickets (Authorization: Bearer <Supabase access_token>). See supabase/VENDOR_PORTAL.md */
  readonly VITE_VENDOR_PORTAL_LIST_URL?: string
  /** POST vendor-update-job-status — full URL; if omitted, derived from VITE_VENDOR_PORTAL_LIST_URL. */
  readonly VITE_VENDOR_PORTAL_UPDATE_URL?: string
  /**
   * POST admin-reassign-vendor (full URL). With `VITE_ADMIN_REASSIGN_SECRET`, saving a vendor
   * change updates the DB and re-notifies when the row has a real maintenance_requests UUID.
   */
  readonly VITE_ADMIN_REASSIGN_URL?: string
  /** Same value as Edge secret ADMIN_REASSIGN_SECRET — do not ship to public clients in production. */
  readonly VITE_ADMIN_REASSIGN_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
