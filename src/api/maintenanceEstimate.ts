import { supabase } from '@/lib/supabase'

export type EstimatePending = {
  id: string
  partsCost: number
  laborCost: number
  totalCost: number
  notes: string | null
  status: string
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
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
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

/** Landlord / admin approve or decline from the Communication thread. */
export async function respondToEstimate(input: {
  estimateId: string
  actionToken: string
  action: 'approve' | 'reject'
}): Promise<{ status: 'approved' | 'rejected'; already?: boolean }> {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
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
