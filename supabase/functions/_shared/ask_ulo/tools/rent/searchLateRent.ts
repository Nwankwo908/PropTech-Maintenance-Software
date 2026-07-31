/**
 * searchLateRent — one job: residents late on rent / carrying a balance.
 * Returns ToolResult for consistent evidence handling.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  toolFail,
  toolOk,
  type EvidenceItem,
  type ToolResult,
} from "../_shared/toolResult.ts"
import { polishAskUloProse } from "../../synthesis/formatAnswer.ts"

export type SearchLateRentParams = {
  organizationId: string
  propertyId?: string | null
  /** Building name filter (e.g. Maple Heights). */
  buildingFilter?: string | null
  minimumBalance?: number
  sortOrder?: "asc" | "desc"
  limit?: number
}

export type LateRentRow = {
  residentId: string
  name: string
  unitLabel: string | null
  propertyName: string | null
  balanceDue: number
  daysOverdue: number | null
  workflowRunId: string | null
  workflowStatus: string | null
}

export type SearchLateRentData = {
  rows: LateRentRow[]
  count: number
  params: Record<string, unknown>
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

function toEvidence(rows: LateRentRow[]): EvidenceItem[] {
  return rows.slice(0, 12).map((r) => ({
    id: r.residentId,
    source: "users.balance_due+rent_collection",
    label: r.name,
    excerpt: `${formatMoney(r.balanceDue)} outstanding` +
      (typeof r.daysOverdue === "number" && r.daysOverdue > 0
        ? ` · ${r.daysOverdue}d overdue`
        : ""),
    entityIds: {
      resident_id: r.residentId,
      workflow_run_id: r.workflowRunId,
      property_name: r.propertyName,
      unit: r.unitLabel,
    },
  }))
}

/** Landlord-facing markdown for synthesis prefer-packet (optional). */
export function formatLateRentMarkdown(rows: LateRentRow[]): string {
  if (rows.length === 0) {
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
    `**${rows.length}** resident${rows.length === 1 ? "" : "s"} currently look late on rent or carrying a balance:`,
    "",
  ]
  for (const r of rows.slice(0, 12)) {
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

/**
 * Find residents with outstanding balance and/or active rent_collection runs.
 */
export async function searchLateRent(
  supabase: SupabaseClient,
  params: SearchLateRentParams,
): Promise<ToolResult<SearchLateRentData>> {
  const organizationId = params.organizationId.trim()
  if (!organizationId) {
    return toolFail("organizationId is required")
  }

  const minimumBalance = params.minimumBalance ?? 0.01
  const limit = params.limit ?? 25
  const baseParams: Record<string, unknown> = {
    organizationId,
    propertyId: params.propertyId ?? null,
    buildingFilter: params.buildingFilter ?? null,
    minimumBalance,
    limit,
  }

  let buildingHint = params.buildingFilter?.trim() || null
  if (!buildingHint && params.propertyId) {
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
    console.error("[ask_ulo/searchLateRent] users", userErr.message)
    return toolFail(userErr.message)
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
  let rows: LateRentRow[] = []
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
    const propertyName = String(row.building ?? "").trim() || null
    if (
      buildingHint &&
      propertyName &&
      !propertyName.toLowerCase().includes(buildingHint.toLowerCase())
    ) {
      continue
    }
    rows.push({
      residentId: id,
      name: displayName(row),
      unitLabel: String(row.unit ?? "").trim() || null,
      propertyName,
      balanceDue: balance,
      daysOverdue,
      workflowRunId: run?.id ?? null,
      workflowStatus: run?.status ?? null,
    })
  }

  const seen = new Set(rows.map((r) => r.residentId))
  for (const [residentId, run] of runByResident) {
    if (seen.has(residentId)) continue
    const meta = (run.metadata ?? {}) as Record<string, unknown>
    const amount = asNumber(meta.amount_due ?? meta.balance_due) ?? 0
    if (amount < minimumBalance) continue
    const propertyName = meta.building != null ? String(meta.building) : null
    if (
      buildingHint &&
      propertyName &&
      !propertyName.toLowerCase().includes(buildingHint.toLowerCase())
    ) {
      continue
    }
    rows.push({
      residentId,
      name: String(meta.resident_name ?? meta.name ?? "Resident"),
      unitLabel: meta.unit != null ? String(meta.unit) : null,
      propertyName,
      balanceDue: amount,
      daysOverdue: asNumber(meta.days_overdue),
      workflowRunId: run.id,
      workflowStatus: run.status,
    })
  }

  const dir = (params.sortOrder ?? "desc") === "asc" ? 1 : -1
  rows.sort((a, b) => (a.balanceDue - b.balanceDue) * dir)
  if (rows.length > limit) rows = rows.slice(0, limit)

  const data: SearchLateRentData = {
    rows,
    count: rows.length,
    params: { ...baseParams, resultCount: rows.length, buildingHint },
  }
  return toolOk(data, toEvidence(rows))
}
