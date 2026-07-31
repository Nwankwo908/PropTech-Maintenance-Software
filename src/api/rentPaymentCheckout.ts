/**
 * Public client wrappers for resident rent Stripe Checkout.
 */
import { supabase } from '@/lib/supabase'

export type RentCheckoutCreateResult = {
  url: string
  sessionId: string
  runId: string
}

export type RentCheckoutCompleteResult = {
  runId: string
  residentId: string | null
  amountPaid: number
  alreadyCompleted: boolean
}

async function invokeRentPaymentCheckout(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!supabase) {
    throw new Error("We can't reach the server right now. Please try again in a moment.")
  }
  const { data, error } = await supabase.functions.invoke('rent-payment-checkout', {
    body,
  })
  if (error) {
    let message = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.text === 'function') {
      try {
        const t = await ctx.text()
        const j = t ? (JSON.parse(t) as { error?: string }) : null
        if (j?.error) message = j.error
      } catch {
        /* ignore */
      }
    }
    throw new Error(message)
  }
  const payload = (data ?? {}) as Record<string, unknown>
  if (typeof payload.error === 'string' && payload.error.trim()) {
    throw new Error(payload.error.trim())
  }
  return payload
}

/** Start Stripe Checkout for a rent_collection run (durable /pay/rent entry). */
export async function createRentPaymentCheckout(params: {
  runId: string
  residentId: string
}): Promise<RentCheckoutCreateResult> {
  const json = await invokeRentPaymentCheckout({
    action: 'create',
    runId: params.runId,
    residentId: params.residentId,
  })
  const url = typeof json.url === 'string' ? json.url.trim() : ''
  const sessionId = typeof json.sessionId === 'string' ? json.sessionId.trim() : ''
  const runId = typeof json.runId === 'string' ? json.runId.trim() : params.runId
  if (!url || !sessionId) {
    throw new Error('Could not start rent payment checkout.')
  }
  return { url, sessionId, runId }
}

/** After Stripe redirects back, verify payment and close the rent run. */
export async function completeRentPaymentCheckout(params: {
  sessionId: string
}): Promise<RentCheckoutCompleteResult> {
  const json = await invokeRentPaymentCheckout({
    action: 'complete',
    sessionId: params.sessionId,
  })
  const runId = typeof json.runId === 'string' ? json.runId.trim() : ''
  if (!runId) {
    throw new Error('Payment completed but rent run id was missing.')
  }
  return {
    runId,
    residentId:
      typeof json.residentId === 'string' && json.residentId.trim()
        ? json.residentId.trim()
        : null,
    amountPaid: typeof json.amountPaid === 'number' ? json.amountPaid : 0,
    alreadyCompleted: json.alreadyCompleted === true,
  }
}
