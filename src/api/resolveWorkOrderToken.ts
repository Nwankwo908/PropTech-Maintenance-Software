import { supabase } from '@/lib/supabase'

export type WorkOrderPublicHistoryItem = {
  ticketId: string
  workOrderRef: string
  unit: string
  description: string
  status: string
  createdAt: string
}

export type WorkOrderPublicJob = {
  address: string
  building: string | null
  unit: string
  issueCategory: string | null
  description: string
  priority: string | null
  status: string | null
  createdAt: string | null
  dueAt: string | null
  photoUrls: string[]
  accessInstructions: string | null
  accessInstructionsFallback: string
  tenant: {
    name: string
    phone: string | null
  }
  appointment: {
    windowText: string | null
    scheduledAt: string | null
    confirmedAt: string | null
  }
  vendorName: string | null
  propertyHistory: WorkOrderPublicHistoryItem[]
  links: {
    estimate: string
    upload: string
    invoice: string
    portal: string
  }
  /** Latest estimate status: pending_approval | approved | rejected | null */
  estimateStatus: string | null
  /** True when an estimate is pending approval or already approved. */
  estimateSubmitted: boolean
  /** True only after the property team approves the estimate. */
  estimateApproved: boolean
  /** True after the vendor uploads at least one completion photo. */
  completionPhotosUploaded: boolean
}

export type ResolveWorkOrderTokenResult = {
  ticketId: string
  workOrderRef: string
  portalPath: string
  portalApiKey: string | null
  job: WorkOrderPublicJob
}

export async function resolveWorkOrderToken(
  token: string,
): Promise<ResolveWorkOrderTokenResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  }
  const trimmed = token.trim()
  if (!trimmed) throw new Error('Missing job link token')

  const { data, error } = await supabase.functions.invoke('resolve-work-order-token', {
    body: { token: trimmed },
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

  const payload = data as {
    ok?: boolean
    ticketId?: string
    workOrderRef?: string
    portalPath?: string
    portalApiKey?: string | null
    job?: WorkOrderPublicJob
    error?: string
  }

  if (!payload?.ticketId || !payload.portalPath || !payload.job) {
    throw new Error(payload?.error ?? 'Could not open this job link')
  }

  const job = payload.job
  return {
    ticketId: payload.ticketId,
    workOrderRef: payload.workOrderRef ?? `WO-${payload.ticketId.replace(/-/g, '').slice(0, 4).toUpperCase()}`,
    portalPath: payload.portalPath,
    portalApiKey:
      typeof payload.portalApiKey === 'string' && payload.portalApiKey.trim()
        ? payload.portalApiKey.trim()
        : null,
    job: {
      ...job,
      estimateStatus:
        typeof job.estimateStatus === 'string' ? job.estimateStatus : null,
      estimateSubmitted: Boolean(job.estimateSubmitted),
      estimateApproved: Boolean(job.estimateApproved),
      completionPhotosUploaded: Boolean(job.completionPhotosUploaded),
    },
  }
}
