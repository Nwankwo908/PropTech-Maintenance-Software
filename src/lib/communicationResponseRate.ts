/**
 * Client loader for Messages Response rate KPI (DB aggregate RPC).
 * Algorithm twin: shared/ops/communicationResponseRate.ts
 */
import { supabase } from '@/lib/supabase'
import {
  COMMUNICATION_RESPONSE_WINDOW_HOURS,
  communicationResponseRateDelta,
  type CommunicationResponseRateResult,
} from '@shared/ops/communicationResponseRate'

export {
  COMMUNICATION_RESPONSE_WINDOW_HOURS,
  COMMUNICATION_RESPONSE_WINDOW_MS,
  computeCommunicationResponseRate,
  communicationResponseRateDelta,
  type CommunicationResponseMessage,
  type CommunicationResponseRateResult,
} from '@shared/ops/communicationResponseRate'

export const MESSAGE_RESPONSE_RATE_TOOLTIP =
  'The percentage of incoming texts Ulo replied to within 24 hours. This measures message replies, not whether vendors accepted jobs.'

export const VENDOR_JOB_ACCEPTANCE_TOOLTIP =
  'Share of assigned work orders where the vendor left pending accept. Not the same as Messages Response rate (inbound SMS replies).'

type RpcRow = {
  total_inbounds: number | null
  answered_inbounds: number | null
  response_rate_pct: number | null
}

function mapRpcRow(row: RpcRow | null | undefined): CommunicationResponseRateResult {
  const total = Number(row?.total_inbounds ?? 0)
  const answered = Number(row?.answered_inbounds ?? 0)
  const pct =
    row?.response_rate_pct == null || Number.isNaN(Number(row.response_rate_pct))
      ? total === 0
        ? null
        : Math.round((answered / total) * 100)
      : Number(row.response_rate_pct)
  return {
    totalInbounds: total,
    answeredInbounds: answered,
    responseRatePct: total === 0 ? null : pct,
  }
}

/**
 * Loads response rate for one window via SQL aggregate (no client message cap).
 */
export async function fetchCommunicationInboundResponseRate(params: {
  landlordId: string
  fromMs: number
  toMs: number
  windowHours?: number
}): Promise<CommunicationResponseRateResult> {
  const { data, error } = await supabase.rpc('communication_inbound_response_rate', {
    p_landlord_id: params.landlordId,
    p_from: new Date(params.fromMs).toISOString(),
    p_to: new Date(params.toMs).toISOString(),
    p_window_hours: params.windowHours ?? COMMUNICATION_RESPONSE_WINDOW_HOURS,
  })
  if (error) throw error
  const row = Array.isArray(data) ? (data[0] as RpcRow | undefined) : (data as RpcRow | null)
  return mapRpcRow(row)
}

/** Current 4-week rate + delta vs prior 4 weeks — same formula both sides. */
export async function fetchCommunicationResponseRateKpi(params: {
  landlordId: string
  nowMs?: number
  windowHours?: number
}): Promise<{
  responseRate: number | null
  responseRateDelta: number | null
  recent: CommunicationResponseRateResult
  previous: CommunicationResponseRateResult
}> {
  const nowMs = params.nowMs ?? Date.now()
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000
  const recentStart = nowMs - fourWeeksMs
  const previousStart = nowMs - 2 * fourWeeksMs
  const windowHours = params.windowHours ?? COMMUNICATION_RESPONSE_WINDOW_HOURS

  const [recent, previous] = await Promise.all([
    fetchCommunicationInboundResponseRate({
      landlordId: params.landlordId,
      fromMs: recentStart,
      toMs: nowMs,
      windowHours,
    }),
    fetchCommunicationInboundResponseRate({
      landlordId: params.landlordId,
      fromMs: previousStart,
      toMs: recentStart,
      windowHours,
    }),
  ])

  return {
    responseRate: recent.responseRatePct,
    responseRateDelta: communicationResponseRateDelta(recent, previous),
    recent,
    previous,
  }
}
