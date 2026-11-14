import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Raw JSON from public.get_staff_metrics (see shared/staffMetrics/catalog.ts for names). */
export type StaffMetrics = Record<string, unknown> & {
  generated_at?: string
  window_days?: number
  include_demo?: boolean
}

export type StaffMetricsAnswer = {
  answer: string
  source: 'ai' | 'rules'
  metricPaths: string[]
}

const STAFF_ONLY_MESSAGE = 'Ulo Ops is only available to Ulo staff accounts.'

function isPermissionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42501' || /staff access required/i.test(error.message ?? '')
}

/** Staff metrics across all landlords. The database refuses non-staff callers. */
export async function fetchStaffMetrics(input: {
  days: number
  includeDemo: boolean
}): Promise<StaffMetrics> {
  if (!supabase) throw new Error("We can't reach the server right now. Please try again in a moment.")
  const { data, error } = await supabase.rpc('get_staff_metrics', {
    p_days: input.days,
    p_include_demo: input.includeDemo,
  })
  if (error) {
    if (isPermissionError(error)) throw new Error(STAFF_ONLY_MESSAGE)
    throw new Error(`Could not load staff metrics: ${error.message}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Could not load staff metrics: the server returned an unexpected response.')
  }
  return data as StaffMetrics
}

/** Ask a plain-English question answered only from the staff metrics. */
export async function askStaffMetrics(input: {
  question: string
  days: number
  includeDemo: boolean
}): Promise<StaffMetricsAnswer> {
  if (!supabase) throw new Error("We can't reach the server right now. Please try again in a moment.")
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token?.trim() || ''
  if (!accessToken) throw new Error('Sign in again to ask about staff metrics.')

  const { data, error } = await supabase.functions.invoke('ask-ulo-staff-metrics', {
    body: { question: input.question, days: input.days, includeDemo: input.includeDemo },
    headers: { 'x-ulo-access-token': accessToken },
  })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = (error.context as Response | undefined)?.status
      if (status === 403) throw new Error(STAFF_ONLY_MESSAGE)
      if (status === 400) throw new Error('Type a question about the staff metrics.')
    }
    throw new Error('Could not answer that right now. Please try again.')
  }
  const body = data as Partial<StaffMetricsAnswer> | null
  if (!body || typeof body.answer !== 'string') {
    throw new Error('Could not answer that right now. Please try again.')
  }
  return {
    answer: body.answer,
    source: body.source === 'ai' ? 'ai' : 'rules',
    metricPaths: Array.isArray(body.metricPaths)
      ? body.metricPaths.filter((path): path is string => typeof path === 'string')
      : [],
  }
}
