import { supabase } from '@/lib/supabase'
import { normalizeVendorJobToken } from '@/lib/vendorJobToken'

export type EstimatePending = {
  id: string
  partsCost: number
  laborCost: number
  totalCost: number
  notes: string | null
  status: string
}

/** Pending landlord decision (Communication / emergency Review rail). */
export type PendingEstimateDecision = {
  estimateId: string
  actionToken: string
  partsCost: number
  laborCost: number
  totalCost: number
  notes: string | null
}

export type EstimateJobContext = {
  ticketId: string
  workOrderRef: string
  unit: string
  description: string
  pendingEstimate: EstimatePending | null
}

async function invokeEstimate(body: Record<string, unknown>) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anon) {
    throw new Error("We can't reach the server right now. Please try again in a moment.")
  }

  const token =
    typeof body.token === 'string' ? normalizeVendorJobToken(body.token) : ''
  if (!token) {
    throw new Error('This estimate link is invalid or incomplete.')
  }

  const res = await fetch(
    `${supabaseUrl.replace(/\/$/, '')}/functions/v1/vendor-submit-maintenance-estimate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify({ ...body, token }),
    },
  )

  let data: Record<string, unknown> | null = null
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    data = null
  }

  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error.trim() : ''
    if (res.status === 404 || message.toLowerCase().includes('not found')) {
      throw new Error('This job link is no longer valid. Ask the property team to send a new one.')
    }
    if (res.status === 400 || message.toLowerCase().includes('invalid')) {
      throw new Error(message || 'This estimate link is invalid or incomplete.')
    }
    throw new Error(
      message && message.length < 160
        ? message
        : "We couldn't open this estimate. Please try the link from your job again.",
    )
  }

  return data ?? {}
}

export async function resolveEstimateJob(token: string): Promise<EstimateJobContext> {
  const data = await invokeEstimate({ token, action: 'resolve' })
  if (!data?.ticketId || !data.workOrderRef) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Could not load estimate form',
    )
  }
  const pending = data.pendingEstimate as EstimatePending | null | undefined
  return {
    ticketId: String(data.ticketId),
    workOrderRef: String(data.workOrderRef),
    unit: typeof data.unit === 'string' ? data.unit : '',
    description: typeof data.description === 'string' ? data.description : '',
    pendingEstimate: pending ?? null,
  }
}

export async function submitEstimate(
  token: string,
  input: {
    partsCost: number
    laborCost: number
    totalCost: number
    notes?: string
  },
): Promise<{ estimateId: string; message: string }> {
  const data = await invokeEstimate({
    token,
    action: 'submit',
    partsCost: input.partsCost,
    laborCost: input.laborCost,
    totalCost: input.totalCost,
    notes: input.notes,
  })
  if (!data?.ok || !data.estimateId) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Could not submit estimate',
    )
  }
  return {
    estimateId: String(data.estimateId),
    message:
      typeof data.message === 'string'
        ? data.message
        : 'Estimate sent for approval.',
  }
}

/** Load the open estimate awaiting landlord approval for a work order. */
export async function fetchPendingEstimateForTicket(
  ticketId: string,
): Promise<PendingEstimateDecision | null> {
  if (!supabase || !ticketId.trim()) return null

  const { data, error } = await supabase
    .from('maintenance_estimates')
    .select(
      'id, landlord_action_token, parts_cost, labor_cost, total_cost, notes, status',
    )
    .eq('maintenance_request_id', ticketId.trim())
    .eq('status', 'pending_approval')
    .maybeSingle()

  if (error || !data) return null

  const estimateId = typeof data.id === 'string' ? data.id : ''
  const actionToken =
    typeof data.landlord_action_token === 'string' ? data.landlord_action_token : ''
  if (!estimateId || !actionToken) return null

  return {
    estimateId,
    actionToken,
    partsCost: Number(data.parts_cost) || 0,
    laborCost: Number(data.labor_cost) || 0,
    totalCost: Number(data.total_cost) || 0,
    notes: typeof data.notes === 'string' ? data.notes : null,
  }
}

/** Landlord / admin approve or decline from the Communication thread. */
export async function respondToEstimate(input: {
  estimateId: string
  actionToken: string
  action: 'approve' | 'reject'
}): Promise<{ status: 'approved' | 'rejected'; already?: boolean }> {
  if (!supabase) {
    throw new Error("We can't reach the server right now. Please try again in a moment.")
  }
  const { data, error } = await supabase.functions.invoke('landlord-respond-estimate', {
    body: {
      action: input.action,
      estimateId: input.estimateId,
      token: input.actionToken,
    },
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
  const payload = data as Record<string, unknown> | null
  if (!payload?.ok) {
    throw new Error(
      typeof payload?.error === 'string' ? payload.error : 'Could not update estimate',
    )
  }
  const status = payload.status === 'rejected' ? 'rejected' : 'approved'
  return {
    status,
    already: Boolean(payload.already),
  }
}
