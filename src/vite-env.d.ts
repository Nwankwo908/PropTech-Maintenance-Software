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
  /** GET vendor-list-tickets (Authorization: Bearer <vendors.portal_api_key from ?k=>). */
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
  /**
   * POST recommend-vendor-alternatives (full URL); uses `VITE_ADMIN_REASSIGN_SECRET`.
   * If omitted, URL defaults to `${VITE_SUPABASE_URL}/functions/v1/recommend-vendor-alternatives`.
   */
  readonly VITE_VENDOR_RECOMMEND_URL?: string
  /**
   * POST discover-external-vendors (full URL); uses `VITE_ADMIN_REASSIGN_SECRET`.
   * If omitted, URL defaults to `${VITE_SUPABASE_URL}/functions/v1/discover-external-vendors`.
   */
  readonly VITE_DISCOVER_EXTERNAL_VENDORS_URL?: string
  /**
   * POST reassign-external-vendor (full URL); uses `VITE_ADMIN_REASSIGN_SECRET`.
   * If omitted, defaults to `${VITE_SUPABASE_URL}/functions/v1/reassign-external-vendor`.
   */
  readonly VITE_REASSIGN_EXTERNAL_VENDOR_URL?: string
  /**
   * POST sla-auto-reassign (full URL); uses `VITE_ADMIN_REASSIGN_SECRET`.
   * If omitted, defaults to `${VITE_SUPABASE_URL}/functions/v1/sla-auto-reassign`.
   */
  readonly VITE_SLA_AUTO_REASSIGN_URL?: string
  /** Milliseconds after assignment before “vendor delayed” AI UI (default: dev 0, prod 1h). */
  readonly VITE_VENDOR_DELAY_AI_MS?: string
  /**
   * POST vendor-verify-token (full URL). If unset, defaults to
   * `${VITE_SUPABASE_URL}/functions/v1/vendor-verify-token`.
   */
  readonly VITE_VENDOR_VERIFY_TOKEN_URL?: string
  /** Optional POST endpoint for immediate broadcast send. */
  readonly VITE_BROADCAST_SEND_URL?: string
  /** Optional POST endpoint for scheduled broadcast creation. */
  readonly VITE_BROADCAST_SCHEDULE_URL?: string
  /** Optional POST endpoint for AI message enhancement. */
  readonly VITE_BROADCAST_AI_ENHANCE_URL?: string
  /**
   * POST generate-late-rent-insights (full URL); uses `VITE_ADMIN_REASSIGN_SECRET`.
   * If omitted, defaults to `${VITE_SUPABASE_URL}/functions/v1/generate-late-rent-insights`.
   */
  readonly VITE_LATE_RENT_INSIGHTS_URL?: string
  /**
   * POST send-late-rent-account-message (full URL); uses `VITE_ADMIN_REASSIGN_SECRET`.
   * If omitted, defaults to `${VITE_SUPABASE_URL}/functions/v1/send-late-rent-account-message`.
   */
  readonly VITE_SEND_LATE_RENT_ACCOUNT_MESSAGE_URL?: string
  /**
   * POST send-lease-renewal-incentive-message (full URL); uses `VITE_ADMIN_REASSIGN_SECRET`.
   * If omitted, defaults to `${VITE_SUPABASE_URL}/functions/v1/send-lease-renewal-incentive-message`.
   */
  readonly VITE_SEND_LEASE_RENEWAL_INCENTIVE_MESSAGE_URL?: string
  /** Optional POST endpoint for retrying a failed resident/vendor/broadcast delivery. */
  readonly VITE_RETRY_FAILED_DELIVERY_URL?: string
  /** UUID tenant scope for SMS onboarding (matches Edge secret DEFAULT_LANDLORD_ID). */
  readonly VITE_DEFAULT_LANDLORD_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.mov' {
  const src: string
  export default src
}
