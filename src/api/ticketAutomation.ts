export type PostTicketAutomationInput = {
  ticketId: string
  residentName: string
  email: string
  unit: string
  description: string
  /** Same values as resident "urgency" / DB `priority`. */
  priority: string
}

const recurringUrl = import.meta.env.VITE_RECURRING_ISSUE_API_URL as
  | string
  | undefined
const vendorRouteUrl = import.meta.env.VITE_VENDOR_ROUTING_API_URL as
  | string
  | undefined

/**
 * Best-effort calls after a ticket is created. Configure URLs in `.env` or leave unset to skip.
 * Your backend should verify the caller; do not expose secrets in the browser.
 *
 * Important: vendor **email/SMS** with Resend/Twilio is handled server-side in the
 * `submit-maintenance-request` Edge Function (Supabase secrets). Use `VITE_VENDOR_ROUTING_API_URL`
 * only for optional, **public-safe** webhooks (e.g. analytics). Do not route real SMS/email through
 * a URL that would require embedding API keys in the frontend.
 */
export async function runPostTicketAutomation(
  input: PostTicketAutomationInput,
): Promise<void> {
  const payload = {
    ticketId: input.ticketId,
    residentName: input.residentName.trim(),
    email: input.email.trim(),
    unit: input.unit.trim(),
    description: input.description.trim(),
    priority: input.priority,
  }
  const body = JSON.stringify(payload)

  const tasks: Promise<unknown>[] = []

  if (recurringUrl?.trim()) {
    tasks.push(
      fetch(recurringUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).then((res) => {
        if (!res.ok) {
          console.warn(
            '[recurring-issue] Request failed',
            res.status,
            recurringUrl,
          )
        }
      }),
    )
  }

  if (vendorRouteUrl?.trim()) {
    tasks.push(
      fetch(vendorRouteUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, action: 'route_to_vendor' }),
      }).then((res) => {
        if (!res.ok) {
          console.warn(
            '[vendor-routing] Request failed',
            res.status,
            vendorRouteUrl,
          )
        }
      }),
    )
  }

  await Promise.allSettled(tasks)
}
