import type { VendorSetupThreadContext } from '@/lib/vendorSetupConversation'
import { formatVendorPricingConfirmationStatus } from '@/lib/vendorPricingConfirmation'
import type { VendorIntakeSubmission } from '@/lib/vendorIntakeForm'
import { formatEmergencyCurrency } from '@/lib/emergencyApprovalReview'

export type VendorRateVsMarket = 'below' | 'in_range' | 'above'

export type VendorSetupMarketBenchmark = {
  serviceCallLow: number
  serviceCallHigh: number
  hourlyLow: number
  hourlyHigh: number
  serviceCallMedian: number
  hourlyMedian: number
}

export type VendorSetupPricingNegotiationBrief = {
  serviceCallFee: number | null
  hourlyRate: number | null
  serviceCallDisplay: string
  hourlyDisplay: string
  acceptsEmergency: boolean | null
  marketServiceCallRange: string
  marketHourlyRange: string
  marketServiceCallMedian: number
  marketHourlyMedian: number
  targetServiceCall: number | null
  targetHourly: number | null
  walkAwayServiceCall: number | null
  walkAwayHourly: number | null
  serviceCallVsMarket: VendorRateVsMarket | null
  hourlyVsMarket: VendorRateVsMarket | null
  aiInsight: string
  leverageSummary: string
  suggestedMessages: string[]
  confirmationStatus: string
}

function parseDollarAmount(value: string): number | null {
  const digits = value.replace(/[^\d.]/g, '')
  if (!digits) return null
  const num = Number(digits)
  return Number.isFinite(num) ? num : null
}

function formatRateDisplay(value: string, suffix = ''): string {
  const parsed = parseDollarAmount(value)
  if (parsed == null) return value.trim() || '—'
  return `${formatEmergencyCurrency(parsed)}${suffix}`
}

function compareToMarket(value: number, low: number, high: number): VendorRateVsMarket {
  if (value < low) return 'below'
  if (value > high) return 'above'
  return 'in_range'
}

function roundToNearestFive(value: number): number {
  return Math.round(value / 5) * 5
}

export function marketBenchmarkForTrade(tradeLabel: string): VendorSetupMarketBenchmark {
  const trade = tradeLabel.toLowerCase()

  if (trade.includes('hvac')) {
    return {
      serviceCallLow: 95,
      serviceCallHigh: 125,
      hourlyLow: 125,
      hourlyHigh: 155,
      serviceCallMedian: 110,
      hourlyMedian: 140,
    }
  }

  if (trade.includes('plumb')) {
    return {
      serviceCallLow: 95,
      serviceCallHigh: 120,
      hourlyLow: 115,
      hourlyHigh: 145,
      serviceCallMedian: 108,
      hourlyMedian: 130,
    }
  }

  if (trade.includes('electric')) {
    return {
      serviceCallLow: 90,
      serviceCallHigh: 115,
      hourlyLow: 120,
      hourlyHigh: 150,
      serviceCallMedian: 102,
      hourlyMedian: 135,
    }
  }

  return {
    serviceCallLow: 90,
    serviceCallHigh: 110,
    hourlyLow: 110,
    hourlyHigh: 135,
    serviceCallMedian: 100,
    hourlyMedian: 122,
  }
}

function percentAbove(value: number, median: number): number {
  if (median <= 0) return 0
  return Math.round(((value - median) / median) * 100)
}

function counterTarget(quoted: number, benchmark: VendorSetupMarketBenchmark, kind: 'service' | 'hourly'): number {
  const low = kind === 'service' ? benchmark.serviceCallLow : benchmark.hourlyLow
  const high = kind === 'service' ? benchmark.serviceCallHigh : benchmark.hourlyHigh
  const median = kind === 'service' ? benchmark.serviceCallMedian : benchmark.hourlyMedian

  if (quoted <= high) return roundToNearestFive(median)
  return roundToNearestFive(Math.min(quoted - 5, high))
}

function walkAwayCap(target: number, quoted: number, benchmark: VendorSetupMarketBenchmark, kind: 'service' | 'hourly'): number {
  const high = kind === 'service' ? benchmark.serviceCallHigh : benchmark.hourlyHigh
  const midpoint = roundToNearestFive((target + quoted) / 2)
  return Math.min(Math.max(midpoint, target + 5), Math.max(high + 10, quoted))
}

function buildAiInsight(
  context: VendorSetupThreadContext,
  benchmark: VendorSetupMarketBenchmark,
  serviceCall: number | null,
  hourly: number | null,
  serviceCallVsMarket: VendorRateVsMarket | null,
  hourlyVsMarket: VendorRateVsMarket | null,
  targetServiceCall: number | null,
  targetHourly: number | null,
): string {
  const trade = context.tradeLabel.toLowerCase()
  const zip = context.locationLabel.match(/\b(\d{5})\b/)?.[1]
  const area = zip ? `ZIP ${zip}` : 'this area'

  const parts: string[] = []

  if (serviceCall != null && serviceCallVsMarket === 'above') {
    parts.push(
      `Service call is ${percentAbove(serviceCall, benchmark.serviceCallMedian)}% above the ${formatEmergencyCurrency(benchmark.serviceCallLow)}–${formatEmergencyCurrency(benchmark.serviceCallHigh)} band for ${trade} in ${area}.`,
    )
  } else if (serviceCall != null && serviceCallVsMarket === 'below') {
    parts.push(`Service call is below market — good value if scope stays standard.`)
  }

  if (hourly != null && hourlyVsMarket === 'above') {
    parts.push(
      `Hourly rate is ${percentAbove(hourly, benchmark.hourlyMedian)}% above the ${formatEmergencyCurrency(benchmark.hourlyLow)}–${formatEmergencyCurrency(benchmark.hourlyHigh)}/hr median.`,
    )
  } else if (hourly != null && hourlyVsMarket === 'below') {
    parts.push(`Hourly rate is competitive vs market.`)
  }

  if (
    serviceCallVsMarket === 'in_range' &&
    (hourlyVsMarket === 'in_range' || hourlyVsMarket === null)
  ) {
    return `Submitted rates align with market for ${trade} in ${area}. Confirm as-is or ask for a small discount tied to fast approval and 7-day payment.`
  }

  if (parts.length === 0) {
    return `Compare submitted rates to market before confirming pricing with the vendor.`
  }

  const counterParts: string[] = []
  if (targetServiceCall != null) counterParts.push(`${formatEmergencyCurrency(targetServiceCall)} service call`)
  if (targetHourly != null) counterParts.push(`${formatEmergencyCurrency(targetHourly)}/hr`)

  if (counterParts.length) {
    parts.push(`Counter around ${counterParts.join(' and ')}.`)
  }

  return parts.join(' ')
}

function normalizeMessageText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function messageAlreadySent(message: string, sentFollowUpBodies: string[]): boolean {
  const normalized = normalizeMessageText(message)
  if (!normalized) return true
  return sentFollowUpBodies.some((body) => {
    const sent = normalizeMessageText(body)
    return sent === normalized || sent.includes(normalized) || normalized.includes(sent)
  })
}

function vendorSubmittedRatesLabel(
  serviceCall: number | null,
  hourly: number | null,
): string | null {
  if (serviceCall != null && hourly != null) {
    return `${formatEmergencyCurrency(serviceCall)} service call and ${formatEmergencyCurrency(hourly)}/hr`
  }
  if (serviceCall != null) return `${formatEmergencyCurrency(serviceCall)} service call`
  if (hourly != null) return `${formatEmergencyCurrency(hourly)}/hr labor`
  return null
}

function buildSuggestedMessages(input: {
  targetServiceCall: number | null
  targetHourly: number | null
  walkAwayServiceCall: number | null
  walkAwayHourly: number | null
  serviceCall: number | null
  hourly: number | null
  serviceCallVsMarket: VendorRateVsMarket | null
  hourlyVsMarket: VendorRateVsMarket | null
  acceptsEmergency: boolean | null
  canTakeJobToday: boolean | null
  availabilityNotes: string
  sentFollowUpBodies: string[]
}): string[] {
  const {
    targetServiceCall,
    targetHourly,
    walkAwayServiceCall,
    walkAwayHourly,
    serviceCall,
    hourly,
    serviceCallVsMarket,
    hourlyVsMarket,
    acceptsEmergency,
    canTakeJobToday,
    availabilityNotes,
    sentFollowUpBodies,
  } = input

  const messages: string[] = []
  const vendorRates = vendorSubmittedRatesLabel(serviceCall, hourly)
  const hasSentFollowUp = sentFollowUpBodies.length > 0
  const notes = availabilityNotes.trim()

  if (!hasSentFollowUp) {
    if (serviceCallVsMarket === 'above' || hourlyVsMarket === 'above') {
      if (targetServiceCall != null && targetHourly != null) {
        messages.push(
          vendorRates
            ? `Thanks for submitting ${vendorRates}. Can you do ${formatEmergencyCurrency(targetServiceCall)} + ${formatEmergencyCurrency(targetHourly)}/hr if we assign today?`
            : `Thanks for the form. Can you do ${formatEmergencyCurrency(targetServiceCall)} service call and ${formatEmergencyCurrency(targetHourly)}/hr if we assign today?`,
        )
      } else if (targetServiceCall != null && serviceCallVsMarket === 'above') {
        messages.push(
          vendorRates
            ? `Your ${formatEmergencyCurrency(serviceCall!)} service call is above our cap — can you match ${formatEmergencyCurrency(targetServiceCall)} for this job?`
            : `Can you match ${formatEmergencyCurrency(targetServiceCall)} for the service call on this job?`,
        )
      } else if (targetHourly != null && hourlyVsMarket === 'above') {
        messages.push(
          vendorRates
            ? `Can you bring ${formatEmergencyCurrency(hourly!)}/hr down to ${formatEmergencyCurrency(targetHourly)}/hr? We pay in 7 days.`
            : `Can you bring labor to ${formatEmergencyCurrency(targetHourly)}/hr? We pay in 7 days vs the usual 30.`,
        )
      }
    } else if (
      serviceCallVsMarket === 'in_range' &&
      (hourlyVsMarket === 'in_range' || hourlyVsMarket == null)
    ) {
      messages.push(
        vendorRates
          ? `Thanks for the form — ${vendorRates} works for us. Please confirm you're locked in for this work order.`
          : `Rates look good. Please confirm you're locked in at these numbers for this work order.`,
      )
    }

    if (canTakeJobToday === true && vendorRates) {
      messages.push(
        `Great that you're available today. If ${vendorRates} is firm, reply YES and we'll assign immediately.`,
      )
    } else if (canTakeJobToday === false) {
      messages.push(
        vendorRates
          ? `We need coverage today — can you still honor ${vendorRates} on a rush timeline?`
          : `We need someone available today — can you still take this job?`,
      )
    }

    if (acceptsEmergency === false && (serviceCallVsMarket === 'above' || hourlyVsMarket === 'above')) {
      messages.push(
        `Understood on standard-hours pricing — if you can flex on ${vendorRates ?? 'your quoted rates'}, we can approve fast with 7-day payment.`,
      )
    }

    if (notes) {
      messages.push(
        vendorRates
          ? `Noted your availability note. If ${vendorRates} holds, confirm and we'll send the work order details.`
          : `Noted your availability note — please confirm your quoted rates so we can assign.`,
      )
    }
  } else {
    if (walkAwayServiceCall != null && walkAwayHourly != null) {
      messages.push(
        `Best we can approve is ${formatEmergencyCurrency(walkAwayServiceCall)} + ${formatEmergencyCurrency(walkAwayHourly)}/hr with 7-day payment — let us know by EOD.`,
      )
    }

    if (
      serviceCallVsMarket === 'in_range' &&
      (hourlyVsMarket === 'in_range' || hourlyVsMarket == null) &&
      vendorRates
    ) {
      messages.push(
        `If ${vendorRates} is still firm after our last note, reply YES and we'll finalize vendor setup today.`,
      )
    } else if (targetServiceCall != null && targetHourly != null) {
      messages.push(
        `Following up on your ${vendorRates ?? 'quoted rates'} — any room on ${formatEmergencyCurrency(targetServiceCall)} + ${formatEmergencyCurrency(targetHourly)}/hr?`,
      )
    }

    if (canTakeJobToday === true) {
      messages.push(`Still have this job open for today — confirm your final rate and we'll assign.`)
    }
  }

  return [...new Set(messages)]
    .filter((message) => !messageAlreadySent(message, sentFollowUpBodies))
    .slice(0, 3)
}

export function extractVendorSetupSentFollowUpBodies(
  items: Array<{ type: string; sender?: string; body?: string }>,
): string[] {
  return items
    .filter(
      (item): item is { type: 'message'; sender: 'ulo'; body: string } =>
        item.type === 'message' && item.sender === 'ulo' && Boolean(item.body?.trim()),
    )
    .map((item) => item.body.trim())
}

export function buildVendorSetupPricingNegotiationBrief(
  context: VendorSetupThreadContext,
  submission: VendorIntakeSubmission,
  conversationId: string,
  options: { sentFollowUpBodies?: string[] } = {},
): VendorSetupPricingNegotiationBrief {
  const benchmark = marketBenchmarkForTrade(context.tradeLabel)
  const serviceCall = parseDollarAmount(submission.pricing.serviceCallFee)
  const hourly = parseDollarAmount(submission.pricing.hourlyRate)

  const serviceCallVsMarket =
    serviceCall != null
      ? compareToMarket(serviceCall, benchmark.serviceCallLow, benchmark.serviceCallHigh)
      : null
  const hourlyVsMarket =
    hourly != null ? compareToMarket(hourly, benchmark.hourlyLow, benchmark.hourlyHigh) : null

  const targetServiceCall =
    serviceCall != null ? counterTarget(serviceCall, benchmark, 'service') : null
  const targetHourly = hourly != null ? counterTarget(hourly, benchmark, 'hourly') : null

  const walkAwayServiceCall =
    serviceCall != null && targetServiceCall != null
      ? walkAwayCap(targetServiceCall, serviceCall, benchmark, 'service')
      : null
  const walkAwayHourly =
    hourly != null && targetHourly != null
      ? walkAwayCap(targetHourly, hourly, benchmark, 'hourly')
      : null

  const leverageSummary =
    serviceCallVsMarket === 'above' || hourlyVsMarket === 'above'
      ? 'Your edge: fast 7-day payment · first job with you · tenant waiting today · repeat work if rates fit portfolio caps.'
      : 'Your edge: rates already fit market · fast approval · 7-day payment · priority queue for future jobs in this ZIP.'

  return {
    serviceCallFee: serviceCall,
    hourlyRate: hourly,
    serviceCallDisplay: formatRateDisplay(submission.pricing.serviceCallFee),
    hourlyDisplay: formatRateDisplay(submission.pricing.hourlyRate, '/hr'),
    acceptsEmergency: submission.pricing.acceptsEmergency,
    marketServiceCallRange: `${formatEmergencyCurrency(benchmark.serviceCallLow)}–${formatEmergencyCurrency(benchmark.serviceCallHigh)}`,
    marketHourlyRange: `${formatEmergencyCurrency(benchmark.hourlyLow)}–${formatEmergencyCurrency(benchmark.hourlyHigh)}/hr`,
    marketServiceCallMedian: benchmark.serviceCallMedian,
    marketHourlyMedian: benchmark.hourlyMedian,
    targetServiceCall,
    targetHourly,
    walkAwayServiceCall,
    walkAwayHourly,
    serviceCallVsMarket,
    hourlyVsMarket,
    aiInsight: buildAiInsight(
      context,
      benchmark,
      serviceCall,
      hourly,
      serviceCallVsMarket,
      hourlyVsMarket,
      targetServiceCall,
      targetHourly,
    ),
    leverageSummary,
    suggestedMessages: buildSuggestedMessages({
      targetServiceCall,
      targetHourly,
      walkAwayServiceCall,
      walkAwayHourly,
      serviceCall,
      hourly,
      serviceCallVsMarket,
      hourlyVsMarket,
      acceptsEmergency: submission.pricing.acceptsEmergency,
      canTakeJobToday: submission.availability.canTakeJobToday,
      availabilityNotes: submission.availability.notes,
      sentFollowUpBodies: options.sentFollowUpBodies ?? [],
    }),
    confirmationStatus: formatVendorPricingConfirmationStatus(conversationId),
  }
}

export function vendorRateVsMarketLabel(vs: VendorRateVsMarket | null): string | null {
  if (vs === 'below') return 'Below market'
  if (vs === 'in_range') return 'In range'
  if (vs === 'above') return 'Above market'
  return null
}

export function vendorRateVsMarketClass(vs: VendorRateVsMarket | null): string {
  if (vs === 'below') return 'border-[#bbf7d0] bg-[#f0fdf4] text-[#008236]'
  if (vs === 'in_range') return 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
  if (vs === 'above') return 'border-[#fde68a] bg-[#fffbeb] text-[#a16207]'
  return 'border-[#e5e7eb] bg-[#f9fafb] text-[#6a7282]'
}
