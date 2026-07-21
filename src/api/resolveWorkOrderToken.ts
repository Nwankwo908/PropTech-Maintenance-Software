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
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
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
  const tenant =
    job.tenant && typeof job.tenant === 'object'
      ? job.tenant
      : { name: 'Resident', phone: null }
  const appointment =
    job.appointment && typeof job.appointment === 'object'
      ? job.appointment
      : { windowText: null, scheduledAt: null, confirmedAt: null }
  const links =
    job.links && typeof job.links === 'object'
      ? job.links
      : {
          estimate: `/estimate/${encodeURIComponent(trimmed)}`,
          upload: `/upload/${encodeURIComponent(trimmed)}`,
          invoice: `/invoice/${encodeURIComponent(trimmed)}`,
          portal: payload.portalPath,
        }

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
      address: typeof job.address === 'string' ? job.address : '',
      streetAddress:
        typeof job.streetAddress === 'string' && job.streetAddress.trim()
          ? job.streetAddress.trim()
          : null,
      city: typeof job.city === 'string' && job.city.trim() ? job.city.trim() : null,
      state: typeof job.state === 'string' && job.state.trim() ? job.state.trim() : null,
      zipCode:
        typeof job.zipCode === 'string' && job.zipCode.trim() ? job.zipCode.trim() : null,
      building:
        typeof job.building === 'string' && job.building.trim()
          ? job.building.trim()
          : null,
      unit: typeof job.unit === 'string' && job.unit.trim() ? job.unit : 'Unit',
      description: typeof job.description === 'string' ? job.description : '',
      photoUrls: Array.isArray(job.photoUrls)
        ? job.photoUrls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : [],
      accessInstructions:
        typeof job.accessInstructions === 'string' ? job.accessInstructions : null,
      accessInstructionsFallback:
        typeof job.accessInstructionsFallback === 'string' &&
        job.accessInstructionsFallback.trim()
          ? job.accessInstructionsFallback
          : 'Contact the property team if you need entry instructions for this unit.',
      tenant: {
        name:
          typeof tenant.name === 'string' && tenant.name.trim()
            ? tenant.name.trim()
            : 'Resident',
        phone:
          typeof tenant.phone === 'string' && tenant.phone.trim()
            ? tenant.phone.trim()
            : null,
      },
      appointment: {
        windowText:
          typeof appointment.windowText === 'string' ? appointment.windowText : null,
        scheduledAt:
          typeof appointment.scheduledAt === 'string' ? appointment.scheduledAt : null,
        confirmedAt:
          typeof appointment.confirmedAt === 'string' ? appointment.confirmedAt : null,
      },
      propertyHistory: Array.isArray(job.propertyHistory)
        ? job.propertyHistory.filter(
            (item): item is WorkOrderPublicHistoryItem =>
              Boolean(item && typeof item === 'object' && typeof item.ticketId === 'string'),
          )
        : [],
      links: {
        estimate:
          typeof links.estimate === 'string' && links.estimate.trim()
            ? links.estimate
            : `/estimate/${encodeURIComponent(trimmed)}`,
        upload:
          typeof links.upload === 'string' && links.upload.trim()
            ? links.upload
            : `/upload/${encodeURIComponent(trimmed)}`,
        invoice:
          typeof links.invoice === 'string' && links.invoice.trim()
            ? links.invoice
            : `/invoice/${encodeURIComponent(trimmed)}`,
        portal:
          typeof links.portal === 'string' && links.portal.trim()
            ? links.portal
            : payload.portalPath,
      },
      estimateStatus:
        typeof job.estimateStatus === 'string' ? job.estimateStatus : null,
      estimateSubmitted: Boolean(job.estimateSubmitted),
      estimateApproved: Boolean(job.estimateApproved),
      completionPhotosUploaded: Boolean(job.completionPhotosUploaded),
    },
  }
}
