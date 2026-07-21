import { supabase } from '@/lib/supabase'

export type InvoiceJobContext = {
  ticketId: string
  workOrderRef: string
  unit: string
  description: string
  canSubmit: boolean
  approvedEstimate: {
    partsCost: number
    laborCost: number
    totalCost: number
  } | null
  existingInvoice: {
    id: string
    laborCost: number
    materialCost: number
    taxAmount: number
    totalCost: number
    status: string
  } | null
}

async function invokeInvoice(body: Record<string, unknown>) {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  }
  const { data, error } = await supabase.functions.invoke(
    'vendor-submit-maintenance-invoice',
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

export async function resolveInvoiceJob(token: string): Promise<InvoiceJobContext> {
  const data = await invokeInvoice({ token, action: 'resolve' })
  if (!data?.ticketId || !data.workOrderRef) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Could not load invoice form',
    )
  }
  const approved = data.approvedEstimate as InvoiceJobContext['approvedEstimate'] | undefined
  const existing = data.existingInvoice as InvoiceJobContext['existingInvoice'] | undefined
  return {
    ticketId: String(data.ticketId),
    workOrderRef: String(data.workOrderRef),
    unit: typeof data.unit === 'string' ? data.unit : '',
    description: typeof data.description === 'string' ? data.description : '',
    canSubmit: Boolean(data.canSubmit),
    approvedEstimate: approved ?? null,
    existingInvoice: existing ?? null,
  }
}

export async function submitPublicInvoice(
  token: string,
  input: {
    laborCost: number
    materialCost: number
    taxAmount?: number
    invoiceNumber?: string
    vendorNotes?: string
  },
): Promise<{ invoiceId: string; totalCost: number; message: string; already?: boolean }> {
  const data = await invokeInvoice({
    token,
    action: 'submit',
    laborCost: input.laborCost,
    materialCost: input.materialCost,
    taxAmount: input.taxAmount ?? 0,
    invoiceNumber: input.invoiceNumber,
    vendorNotes: input.vendorNotes,
  })
  if (!data?.ok || !data.invoiceId) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Could not submit invoice',
    )
  }
  return {
    invoiceId: String(data.invoiceId),
    totalCost: Number(data.totalCost) || 0,
    already: Boolean(data.already),
    message:
      typeof data.message === 'string'
        ? data.message
        : 'Invoice submitted. The property team will review it in Needs Your Attention.',
  }
}
