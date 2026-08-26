import { supabase } from '@/lib/supabase'

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
  if (!supabase) {
    throw new Error("We can't reach the server right now. Please try again in a moment.")
  }
  const { data, error } = await supabase.functions.invoke(
    'vendor-submit-maintenance-estimate',
    { body },
  )
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
  return data as Record<string, unknown>
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
