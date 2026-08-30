import { uloAppUrl } from '@/lib/uloAppUrl'
import { normalizeVendorJobToken } from '@/lib/vendorJobToken'

export type WorkOrderPublicHistoryItem = {
  ticketId: string
  workOrderRef: string
  unit: string
  description: string
  status: string
  createdAt: string
}

export type WorkOrderPropertyAccess = {
  buildingEntry: string
  gateCode: string
  lockboxLocation: string
  lockboxCode: string
  utilityRoomAccess: string
  visitorParking: string
  superintendentContact: string
  emergencyAccessNotes: string
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
  /** Structured building access from Property Details when available. */
  propertyAccess: WorkOrderPropertyAccess | null
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
  const trimmed = normalizeVendorJobToken(token)
  if (!trimmed) throw new Error('This job link is invalid or incomplete.')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anon) {
    throw new Error("We can't reach the server right now. Please try again in a moment.")
  }

  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/resolve-work-order-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anon,
      Authorization: `Bearer ${anon}`,
    },
    body: JSON.stringify({ token: trimmed }),
  })

  let payload: {
    ok?: boolean
    ticketId?: string
    workOrderRef?: string
    portalPath?: string
    portalApiKey?: string | null
    job?: WorkOrderPublicJob
    error?: string
  } | null = null
  try {
    payload = (await res.json()) as typeof payload
  } catch {
    payload = null
  }

  if (!res.ok) {
    const message = payload?.error?.trim()
    if (res.status === 404 || message?.toLowerCase().includes('not found')) {
      throw new Error('This job link is no longer valid. Ask the property team to send a new one.')
    }
    if (res.status === 400 || message?.toLowerCase().includes('invalid token')) {
      throw new Error('This job link is invalid or incomplete.')
    }
    throw new Error(
      message && message.length < 160
        ? message
        : 'Could not open this job. Please try the link from your text again.',
    )
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
          estimate: uloAppUrl.estimate(trimmed),
          upload: uloAppUrl.upload(trimmed),
          invoice: uloAppUrl.invoice(trimmed),
          portal: payload.portalPath,
        }

  return {
    ticketId: payload.ticketId,
    workOrderRef: payload.workOrderRef ?? `WO-${payload.ticketId.replace(/-/g, '').slice(0, 4).toUpperCase()}`,
    portalPath: payload.portalPath,
    portalApiKey:
      typeof payload.portalApiKey === 'string' && payload.portalApiKey.trim()
        ? payload.portalApiKey.trim()
        : trimmed,
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
      propertyAccess:
        job.propertyAccess && typeof job.propertyAccess === 'object'
          ? {
              buildingEntry:
                typeof job.propertyAccess.buildingEntry === 'string'
                  ? job.propertyAccess.buildingEntry
                  : '',
              gateCode:
                typeof job.propertyAccess.gateCode === 'string'
                  ? job.propertyAccess.gateCode
                  : '',
              lockboxLocation:
                typeof job.propertyAccess.lockboxLocation === 'string'
                  ? job.propertyAccess.lockboxLocation
                  : '',
              lockboxCode:
                typeof job.propertyAccess.lockboxCode === 'string'
                  ? job.propertyAccess.lockboxCode
                  : '',
              utilityRoomAccess:
                typeof job.propertyAccess.utilityRoomAccess === 'string'
                  ? job.propertyAccess.utilityRoomAccess
                  : '',
              visitorParking:
                typeof job.propertyAccess.visitorParking === 'string'
                  ? job.propertyAccess.visitorParking
                  : '',
              superintendentContact:
                typeof job.propertyAccess.superintendentContact === 'string'
                  ? job.propertyAccess.superintendentContact
                  : '',
              emergencyAccessNotes:
                typeof job.propertyAccess.emergencyAccessNotes === 'string'
                  ? job.propertyAccess.emergencyAccessNotes
                  : '',
            }
          : null,
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
            : uloAppUrl.estimate(trimmed),
        upload:
          typeof links.upload === 'string' && links.upload.trim()
            ? links.upload
            : uloAppUrl.upload(trimmed),
        invoice:
          typeof links.invoice === 'string' && links.invoice.trim()
            ? links.invoice
            : uloAppUrl.invoice(trimmed),
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
