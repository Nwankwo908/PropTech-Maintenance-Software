/**
 * listResidents — parameterized resident listing (late rent, move-in, message non-response).
 * Same sources as admin UI / SMS / occupancy — not portfolio briefing.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "../opsGraphLookup.ts"
import { polishAskUloProse } from "../responsePolish.ts"

export type ListResidentsFilter =
  | "late_rent"
  | "outstanding_balance"
  | "lease_ending"
  | "high_maintenance_activity"
  | "move_in"
  | "move_out"
  | "message_nonresponse"

export type ListResidentsParams = {
  organizationId: string
  propertyId?: string | null
  unitId?: string | null
  filter?: ListResidentsFilter | null
  leaseEndingWithinDays?: number
  minimumBalance?: number
  minimumMaintenanceCount?: number
  /** For move_in: look back this many days (default calendar month ≈ 31). */
  dateRangeDays?: number
  sortBy?: "balance_due" | "days_overdue" | "name" | "move_in_date" | "awaiting_reply_hours"
  sortOrder?: "asc" | "desc"
  limit?: number
}

export type ResidentEvidence = {
  residentId: string
  name: string
  unitLabel: string | null
  propertyName: string | null
  balanceDue: number
  daysOverdue: number | null
  leaseEndDate: string | null
  moveInDate: string | null
  awaitingReplyHours: number | null
  lastOutboundAt: string | null
  workflowRunId: string | null
  workflowStatus: string | null
}

export type ListResidentsResult = {
  toolId: "search_residents"
  available: boolean
  found: boolean
  residents: ResidentEvidence[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  params: Record<string, unknown>
  error: string | null
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)
}

function displayName(row: Record<string, unknown>): string {
  const full = String(row.full_name ?? "").trim()
  return full || "Resident"
}

function emptyResult(
  params: Record<string, unknown>,
  error: string | null,
): ListResidentsResult {
  return {
    toolId: "search_residents",
    available: error == null,
    found: false,
    residents: [],
    bullets: [],
    citations: [],
    markdown: "",
    params,
    error,
  }
}

function buildLateRentMarkdown(residents: ResidentEvidence[]): string {
  if (residents.length === 0) {
    return [
      "I checked resident balances and active rent-collection workflows.",
      "",
      "### What I know",
      "No residents currently show an outstanding balance or late-rent collection run.",
      "",
      "### What happens next",
      "When a balance comes due or a rent-collection workflow escalates, I'll list those residents here first.",
    ].join("\n")
  }
  const lines = [
    `**${residents.length}** resident${residents.length === 1 ? "" : "s"} currently look late on rent or carrying a balance:`,
    "",
  ]
  for (const r of residents.slice(0, 12)) {
    const where = [r.propertyName, r.unitLabel ? `Unit ${r.unitLabel}` : null]
      .filter(Boolean)
      .join(" · ")
    const overdue =
      typeof r.daysOverdue === "number" && r.daysOverdue > 0
        ? ` · ${r.daysOverdue} day${r.daysOverdue === 1 ? "" : "s"} overdue`
        : ""
    lines.push(
      `- **${r.name}**${where ? ` (${where})` : ""} — ${formatMoney(r.balanceDue)} due${overdue}`,
    )
  }
  lines.push("")
  lines.push("### What I'd do next")
  lines.push(
    "Start with the highest balances / longest overdue, confirm payment status, then follow up from Needs Your Attention.",
  )
  return polishAskUloProse(lines.join("\n"))
}

function buildMoveInMarkdown(residents: ResidentEvidence[], days: number): string {
  if (residents.length === 0) {
    return [
      `I checked move-in dates for the last **${days}** days.`,
      "",
      "### What I know",
      "No residents currently have a move-in date in that window.",
      "",
      "### What happens next",
      "When new occupants are assigned with a move-in date, I'll list them here first.",
    ].join("\n")
  }
  const lines = [
    `**${residents.length}** resident${residents.length === 1 ? "" : "s"} moved in over the last **${days}** days:`,
    "",
  ]
  for (const r of residents.slice(0, 12)) {
    const where = [r.propertyName, r.unitLabel ? `Unit ${r.unitLabel}` : null]
      .filter(Boolean)
      .join(" · ")
    lines.push(
      `- **${r.name}**${where ? ` (${where})` : ""}${r.moveInDate ? ` — moved in ${r.moveInDate}` : ""}`,
    )
  }
  lines.push("")
  lines.push("### What I'd do next")
  lines.push(
    "Confirm welcome / move-in checklist status for each, then make sure any open intake or maintenance threads are assigned.",
  )
  return polishAskUloProse(lines.join("\n"))
}

function buildMessageNonresponseMarkdown(residents: ResidentEvidence[]): string {
  if (residents.length === 0) {
    return [
      "I checked recent outbound SMS to residents and whether they replied.",
      "",
      "### What I know",
      "I'm not seeing open resident threads where your last message is still waiting on a reply.",
      "",
      "### What happens next",
      "When you send SMS and a resident doesn't reply, I'll list those threads here with how long you've been waiting.",
    ].join("\n")
  }
  const lines = [
    `**${residents.length}** resident${residents.length === 1 ? "" : "s"} still haven't replied to your latest message:`,
    "",
  ]
  for (const r of residents.slice(0, 12)) {
    const where = [r.propertyName, r.unitLabel ? `Unit ${r.unitLabel}` : null]
      .filter(Boolean)
      .join(" · ")
    const wait =
      typeof r.awaitingReplyHours === "number"
        ? r.awaitingReplyHours >= 24
          ? ` · waiting ~${Math.floor(r.awaitingReplyHours / 24)} day${Math.floor(r.awaitingReplyHours / 24) === 1 ? "" : "s"}`
          : ` · waiting ~${r.awaitingReplyHours}h`
        : ""
    lines.push(`- **${r.name}**${where ? ` (${where})` : ""}${wait}`)
  }
  lines.push("")
  lines.push("### What I'd do next")
  lines.push(
    "Prioritize the longest waits, send a short follow-up, or call if the ask is time-sensitive (access, payment, or move-in).",
  )
  return polishAskUloProse(lines.join("\n"))
}

async function listLateRent(
  supabase: SupabaseClient,
  params: ListResidentsParams,
): Promise<ListResidentsResult> {
  const organizationId = params.organizationId.trim()
  const filter = params.filter ?? "late_rent"
  const minimumBalance = params.minimumBalance ?? 0.01
  const limit = params.limit ?? 25
  const baseParams = { organizationId, filter, minimumBalance, resultCount: 0 }

  let buildingHint: string | null = null
  if (params.propertyId) {
    const { data: prop } = await supabase
      .from("properties")
      .select("id, name, address")
      .eq("id", params.propertyId)
      .maybeSingle()
    if (prop) {
      buildingHint =
        String(
          (prop as Record<string, unknown>).name ??
            (prop as Record<string, unknown>).address ??
            "",
        ).trim() || null
    }
  }

  let userQuery = supabase
    .from("users")
    .select(
      "id, full_name, balance_due, unit, building, status, lease_end_date, move_in_date",
    )
    .eq("landlord_id", organizationId)
    .gt("balance_due", minimumBalance)
    .order("balance_due", { ascending: false })
    .limit(80)

  if (buildingHint) userQuery = userQuery.ilike("building", `%${buildingHint}%`)

  const { data: userRows, error: userErr } = await userQuery
  if (userErr) {
    console.error("[ask_ulo/listResidents] users", userErr.message)
    return emptyResult(baseParams, userErr.message)
  }

  let runsQuery = supabase
    .from("workflow_runs")
    .select("id, status, entity_id, property_id, unit_id, started_at, metadata")
    .eq("landlord_id", organizationId)
    .eq("template_id", "rent_collection")
    .in("status", ["active", "escalated", "running", "waiting"])
    .order("started_at", { ascending: false })
    .limit(80)

  if (params.propertyId) runsQuery = runsQuery.eq("property_id", params.propertyId)

  const { data: runs } = await runsQuery
  type RunRow = {
    id: string
    status: string | null
    entity_id: string | null
    started_at: string | null
    metadata: unknown
  }
  const runByResident = new Map<string, RunRow>()
  for (const run of (runs ?? []) as RunRow[]) {
    const meta = (run.metadata ?? {}) as Record<string, unknown>
    const residentId =
      (typeof run.entity_id === "string" && run.entity_id) ||
      (typeof meta.resident_id === "string" ? meta.resident_id : null) ||
      (typeof meta.user_id === "string" ? meta.user_id : null)
    if (!residentId || runByResident.has(residentId)) continue
    runByResident.set(residentId, run)
  }

  const now = Date.now()
  let residents: ResidentEvidence[] = []
  for (const row of (userRows ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.id)
    const balance = asNumber(row.balance_due) ?? 0
    if (balance < minimumBalance) continue
    const run = runByResident.get(id)
    const meta = (run?.metadata ?? {}) as Record<string, unknown>
    let daysOverdue: number | null = asNumber(meta.days_overdue)
    if (daysOverdue == null && run?.started_at) {
      const started = Date.parse(run.started_at)
      if (Number.isFinite(started)) {
        daysOverdue = Math.max(0, Math.floor((now - started) / 86_400_000))
      }
    }
    residents.push({
      residentId: id,
      name: displayName(row),
      unitLabel: String(row.unit ?? "").trim() || null,
      propertyName: String(row.building ?? "").trim() || null,
      balanceDue: balance,
      daysOverdue,
      leaseEndDate: typeof row.lease_end_date === "string" ? row.lease_end_date : null,
      moveInDate: typeof row.move_in_date === "string" ? row.move_in_date : null,
      awaitingReplyHours: null,
      lastOutboundAt: null,
      workflowRunId: run?.id ?? null,
      workflowStatus: run?.status ?? null,
    })
  }

  const seen = new Set(residents.map((r) => r.residentId))
  for (const [residentId, run] of runByResident) {
    if (seen.has(residentId)) continue
    const meta = (run.metadata ?? {}) as Record<string, unknown>
    const amount = asNumber(meta.amount_due ?? meta.balance_due) ?? 0
    if (amount < minimumBalance) continue
    residents.push({
      residentId,
      name: String(meta.resident_name ?? meta.name ?? "Resident"),
      unitLabel: meta.unit != null ? String(meta.unit) : null,
      propertyName: meta.building != null ? String(meta.building) : null,
      balanceDue: amount,
      daysOverdue: asNumber(meta.days_overdue),
      leaseEndDate: null,
      moveInDate: null,
      awaitingReplyHours: null,
      lastOutboundAt: null,
      workflowRunId: run.id,
      workflowStatus: run.status,
    })
  }

  const dir = (params.sortOrder ?? "desc") === "asc" ? 1 : -1
  residents.sort((a, b) => (a.balanceDue - b.balanceDue) * dir)
  if (residents.length > limit) residents = residents.slice(0, limit)

  const bullets = residents.slice(0, 8).map((r) => {
    const where = [r.propertyName, r.unitLabel].filter(Boolean).join(" / ")
    return `${r.name}${where ? ` (${where})` : ""}: ${formatMoney(r.balanceDue)} due`
  })
  const citations: AskUloCitation[] = residents.slice(0, 5).map((r) => ({
    tool: "structured",
    title: r.name,
    citation: "users.balance_due + rent_collection",
    excerpt: `${formatMoney(r.balanceDue)} outstanding`,
  }))

  return {
    toolId: "search_residents",
    available: true,
    found: residents.length > 0,
    residents,
    bullets,
    citations,
    markdown: buildLateRentMarkdown(residents),
    params: { ...baseParams, resultCount: residents.length },
    error: null,
  }
}

async function listMoveIns(
  supabase: SupabaseClient,
  params: ListResidentsParams,
): Promise<ListResidentsResult> {
  const organizationId = params.organizationId.trim()
  const days = params.dateRangeDays ?? 31
  const limit = params.limit ?? 25
  const baseParams = {
    organizationId,
    filter: "move_in" as const,
    dateRangeDays: days,
    resultCount: 0,
  }

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  const sinceIso = since.toISOString().slice(0, 10)

  const { data: userRows, error } = await supabase
    .from("users")
    .select("id, full_name, balance_due, unit, building, status, lease_end_date, move_in_date")
    .eq("landlord_id", organizationId)
    .gte("move_in_date", sinceIso)
    .order("move_in_date", { ascending: false })
    .limit(80)

  if (error) {
    console.error("[ask_ulo/listResidents] move_in", error.message)
    return emptyResult(baseParams, error.message)
  }

  // Also pull occupancy.move_in_date for residents not mirrored on users
  const { data: occRows } = await supabase
    .from("occupancy")
    .select("id, resident_id, unit_id, move_in_date, status")
    .eq("landlord_id", organizationId)
    .gte("move_in_date", sinceIso)
    .in("status", ["active", "pending", "scheduled"])
    .order("move_in_date", { ascending: false })
    .limit(80)

  const byId = new Map<string, ResidentEvidence>()
  for (const row of (userRows ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.id)
    byId.set(id, {
      residentId: id,
      name: displayName(row),
      unitLabel: String(row.unit ?? "").trim() || null,
      propertyName: String(row.building ?? "").trim() || null,
      balanceDue: asNumber(row.balance_due) ?? 0,
      daysOverdue: null,
      leaseEndDate: typeof row.lease_end_date === "string" ? row.lease_end_date : null,
      moveInDate: typeof row.move_in_date === "string" ? row.move_in_date : null,
      awaitingReplyHours: null,
      lastOutboundAt: null,
      workflowRunId: null,
      workflowStatus: null,
    })
  }

  const missingResidentIds: string[] = []
  for (const occ of (occRows ?? []) as Array<Record<string, unknown>>) {
    const rid = typeof occ.resident_id === "string" ? occ.resident_id : null
    if (!rid) continue
    if (byId.has(rid)) {
      const existing = byId.get(rid)!
      if (!existing.moveInDate && typeof occ.move_in_date === "string") {
        existing.moveInDate = occ.move_in_date
      }
      continue
    }
    missingResidentIds.push(rid)
  }

  if (missingResidentIds.length > 0) {
    const { data: moreUsers } = await supabase
      .from("users")
      .select("id, full_name, balance_due, unit, building, lease_end_date, move_in_date")
      .in("id", missingResidentIds.slice(0, 40))
    for (const row of (moreUsers ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.id)
      const occ = ((occRows ?? []) as Array<Record<string, unknown>>).find(
        (o) => o.resident_id === id,
      )
      byId.set(id, {
        residentId: id,
        name: displayName(row),
        unitLabel: String(row.unit ?? "").trim() || null,
        propertyName: String(row.building ?? "").trim() || null,
        balanceDue: asNumber(row.balance_due) ?? 0,
        daysOverdue: null,
        leaseEndDate: typeof row.lease_end_date === "string" ? row.lease_end_date : null,
        moveInDate:
          (typeof row.move_in_date === "string" ? row.move_in_date : null) ||
          (typeof occ?.move_in_date === "string" ? occ.move_in_date : null),
        awaitingReplyHours: null,
        lastOutboundAt: null,
        workflowRunId: null,
        workflowStatus: null,
      })
    }
  }

  let residents = Array.from(byId.values()).filter((r) => r.moveInDate)
  residents.sort((a, b) => String(b.moveInDate).localeCompare(String(a.moveInDate)))
  if (residents.length > limit) residents = residents.slice(0, limit)

  const bullets = residents.slice(0, 8).map((r) => {
    const where = [r.propertyName, r.unitLabel].filter(Boolean).join(" / ")
    return `${r.name}${where ? ` (${where})` : ""}${r.moveInDate ? `: ${r.moveInDate}` : ""}`
  })
  const citations: AskUloCitation[] = residents.slice(0, 5).map((r) => ({
    tool: "structured",
    title: r.name,
    citation: "users.move_in_date + occupancy",
    excerpt: r.moveInDate ? `Moved in ${r.moveInDate}` : "Recent move-in",
  }))

  return {
    toolId: "search_residents",
    available: true,
    found: residents.length > 0,
    residents,
    bullets,
    citations,
    markdown: buildMoveInMarkdown(residents, days),
    params: { ...baseParams, resultCount: residents.length },
    error: null,
  }
}

async function listMessageNonresponse(
  supabase: SupabaseClient,
  params: ListResidentsParams,
): Promise<ListResidentsResult> {
  const organizationId = params.organizationId.trim()
  const days = params.dateRangeDays ?? 30
  const limit = params.limit ?? 25
  const baseParams = {
    organizationId,
    filter: "message_nonresponse" as const,
    dateRangeDays: days,
    resultCount: 0,
  }

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  const sinceIso = since.toISOString()

  const { data: convs, error: convErr } = await supabase
    .from("sms_conversations")
    .select("id, resident_id, external_phone_number, conversation_type, status, updated_at")
    .eq("landlord_id", organizationId)
    .not("resident_id", "is", null)
    .in("conversation_type", ["resident_intake", "landlord_update", "vendor_tenant_proxy"])
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(60)

  if (convErr) {
    console.error("[ask_ulo/listResidents] sms_conversations", convErr.message)
    return emptyResult(baseParams, convErr.message)
  }

  const conversationIds = ((convs ?? []) as Array<Record<string, unknown>>)
    .map((c) => String(c.id))
    .filter(Boolean)

  if (conversationIds.length === 0) {
    return {
      toolId: "search_residents",
      available: true,
      found: false,
      residents: [],
      bullets: [],
      citations: [],
      markdown: buildMessageNonresponseMarkdown([]),
      params: baseParams,
      error: null,
    }
  }

  const { data: messages, error: msgErr } = await supabase
    .from("sms_messages")
    .select("id, conversation_id, direction, created_at")
    .eq("landlord_id", organizationId)
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false })
    .limit(400)

  if (msgErr) {
    console.error("[ask_ulo/listResidents] sms_messages", msgErr.message)
    return emptyResult(baseParams, msgErr.message)
  }

  type Msg = { conversation_id: string; direction: string; created_at: string }
  const byConv = new Map<string, Msg[]>()
  for (const m of (messages ?? []) as Msg[]) {
    const list = byConv.get(m.conversation_id) ?? []
    list.push(m)
    byConv.set(m.conversation_id, list)
  }

  const now = Date.now()
  const awaiting: Array<{
    residentId: string
    conversationId: string
    lastOutboundAt: string
    awaitingReplyHours: number
  }> = []

  for (const conv of (convs ?? []) as Array<Record<string, unknown>>) {
    const cid = String(conv.id)
    const rid = typeof conv.resident_id === "string" ? conv.resident_id : null
    if (!rid) continue
    const msgs = byConv.get(cid) ?? []
    // messages are newest-first
    let lastOutbound: Msg | null = null
    let lastInbound: Msg | null = null
    for (const m of msgs) {
      if (!lastOutbound && m.direction === "outbound") lastOutbound = m
      if (!lastInbound && m.direction === "inbound") lastInbound = m
      if (lastOutbound && lastInbound) break
    }
    if (!lastOutbound) continue
    const outTs = Date.parse(lastOutbound.created_at)
    if (!Number.isFinite(outTs)) continue
    const inTs = lastInbound ? Date.parse(lastInbound.created_at) : NaN
    const repliedAfter =
      Number.isFinite(inTs) && (inTs as number) > outTs
    if (repliedAfter) continue
    awaiting.push({
      residentId: rid,
      conversationId: cid,
      lastOutboundAt: lastOutbound.created_at,
      awaitingReplyHours: Math.max(0, Math.floor((now - outTs) / 3_600_000)),
    })
  }

  // Dedupe by resident — keep longest wait
  const bestByResident = new Map<string, (typeof awaiting)[0]>()
  for (const a of awaiting) {
    const prev = bestByResident.get(a.residentId)
    if (!prev || a.awaitingReplyHours > prev.awaitingReplyHours) {
      bestByResident.set(a.residentId, a)
    }
  }

  const residentIds = Array.from(bestByResident.keys())
  const userById = new Map<string, Record<string, unknown>>()
  if (residentIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, full_name, balance_due, unit, building, lease_end_date, move_in_date")
      .in("id", residentIds.slice(0, 40))
    for (const u of (users ?? []) as Array<Record<string, unknown>>) {
      userById.set(String(u.id), u)
    }
  }

  let residents: ResidentEvidence[] = []
  for (const [rid, a] of bestByResident) {
    const row = userById.get(rid) ?? {}
    residents.push({
      residentId: rid,
      name: displayName(row),
      unitLabel: String(row.unit ?? "").trim() || null,
      propertyName: String(row.building ?? "").trim() || null,
      balanceDue: asNumber(row.balance_due) ?? 0,
      daysOverdue: null,
      leaseEndDate: typeof row.lease_end_date === "string" ? row.lease_end_date : null,
      moveInDate: typeof row.move_in_date === "string" ? row.move_in_date : null,
      awaitingReplyHours: a.awaitingReplyHours,
      lastOutboundAt: a.lastOutboundAt,
      workflowRunId: null,
      workflowStatus: null,
    })
  }

  residents.sort(
    (a, b) => (b.awaitingReplyHours ?? 0) - (a.awaitingReplyHours ?? 0),
  )
  if (residents.length > limit) residents = residents.slice(0, limit)

  const bullets = residents.slice(0, 8).map((r) => {
    const where = [r.propertyName, r.unitLabel].filter(Boolean).join(" / ")
    const wait =
      typeof r.awaitingReplyHours === "number" ? ` (~${r.awaitingReplyHours}h)` : ""
    return `${r.name}${where ? ` (${where})` : ""}${wait}`
  })
  const citations: AskUloCitation[] = residents.slice(0, 5).map((r) => ({
    tool: "structured",
    title: r.name,
    citation: "sms_conversations + sms_messages",
    excerpt:
      typeof r.awaitingReplyHours === "number"
        ? `Awaiting reply ~${r.awaitingReplyHours}h`
        : "Awaiting reply",
  }))

  return {
    toolId: "search_residents",
    available: true,
    found: residents.length > 0,
    residents,
    bullets,
    citations,
    markdown: buildMessageNonresponseMarkdown(residents),
    params: { ...baseParams, resultCount: residents.length },
    error: null,
  }
}

export async function listResidents(
  supabase: SupabaseClient,
  params: ListResidentsParams,
): Promise<ListResidentsResult> {
  const organizationId = params.organizationId.trim()
  if (!organizationId) {
    return emptyResult({ organizationId: "", resultCount: 0 }, "missing_organization_id")
  }

  const filter = params.filter ?? "late_rent"
  if (filter === "move_in") return listMoveIns(supabase, params)
  if (filter === "message_nonresponse") return listMessageNonresponse(supabase, params)
  if (filter === "late_rent" || filter === "outstanding_balance") {
    return listLateRent(supabase, { ...params, filter })
  }

  // Unsupported filters: available but empty with honest markdown
  return {
    toolId: "search_residents",
    available: true,
    found: false,
    residents: [],
    bullets: [],
    citations: [],
    markdown: [
      `I don't have a dedicated ${filter.replace(/_/g, " ")} listing wired yet.`,
      "",
      "### What I know",
      "I can look up late rent, recent move-ins, and residents who haven't replied to SMS.",
      "",
      "### What's missing",
      `The **${filter.replace(/_/g, " ")}** filter isn't implemented on this path yet.`,
      "",
      "### What happens next",
      "Ask me about late rent, who moved in, or who hasn't responded to messages — those I can answer from live records.",
    ].join("\n"),
    params: { organizationId, filter, resultCount: 0 },
    error: null,
  }
}
