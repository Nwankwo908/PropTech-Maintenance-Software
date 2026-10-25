/**
 * Freeze and extreme-cold monitor.
 *
 * Hourly cron. Each map cell is fetched at most every 3 hours, and hourly
 * while that cell has an active cold event. Forecast decisions are rules.
 * Pass mock_forecast only for a disposable landlord test — it never calls NWS.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { recordActivityLog } from "../_shared/graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../_shared/landlordAttentionNotify.ts"
import { uloAppUrl } from "../_shared/uloAppUrl.ts"
import { fetchNwsCellSnapshot } from "../_shared/weather/propertyOutdoorTemp.ts"
import { LIMITED_ALPHA_1_LANDLORD_ID } from "../../../shared/landlordCapabilities.ts"
import {
  nwsRequestDelayMs,
  weatherCellKey,
  type HourlyForecastPoint,
  type NwsAlertFact,
} from "../../../shared/weather/freezeRules.ts"
import {
  cellNeedsFetch,
  planWeatherCycle,
  resolveFrostDate,
  stateFirstFrostMonthDay,
  type CellSnapshotInput,
  type CycleProperty,
  type CycleTask,
  type WeatherEventState,
  type WeatherSettings,
} from "../../../shared/weather/weatherMonitor.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

type PropertyRow = {
  id: string
  landlord_id: string
  name: string | null
  state: string | null
  year_built: number | null
  latitude: number | null
  longitude: number | null
}

function paceNws(): () => Promise<void> {
  const sent: number[] = []
  return async () => {
    const wait = nwsRequestDelayMs(sent, Date.now())
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    sent.push(Date.now())
  }
}

async function loadProperties(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<PropertyRow[]> {
  let query = supabase
    .from("properties")
    .select("id, landlord_id, name, state, year_built, latitude, longitude")
    .neq("landlord_id", LIMITED_ALPHA_1_LANDLORD_ID)
    .limit(2000)
  if (landlordId) query = query.eq("landlord_id", landlordId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as PropertyRow[]
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)
  if (
    !authorizedCronBearer(req, [
      "ULO_OPS_CRON_SECRET",
      "ADMIN_REASSIGN_SECRET",
      "RUN_WORKFLOW_TRIGGERS_SECRET",
    ])
  ) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Server misconfiguration" }, 500)
  const supabase = createClient(supabaseUrl, serviceKey)

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  const landlordId = typeof body.landlord_id === "string" ? body.landlord_id.trim() : ""
  if (landlordId === LIMITED_ALPHA_1_LANDLORD_ID) {
    return jsonResponse({ skipped: "limited_alpha_1" })
  }
  const mock = body.mock_forecast && typeof body.mock_forecast === "object"
    ? body.mock_forecast as { hourly?: HourlyForecastPoint[]; alerts?: NwsAlertFact[] }
    : null
  if (mock && !landlordId) {
    return jsonResponse({ error: "A disposable landlord_id is required for a mock forecast." }, 400)
  }

  const now = new Date()
  const properties = await loadProperties(supabase, landlordId)
  const propertyIds = properties.map((row) => row.id)
  const vacantByProperty = new Set<string>()
  if (propertyIds.length > 0) {
    const { data: units } = await supabase
      .from("units")
      .select("property_id, status")
      .in("property_id", propertyIds)
      .eq("status", "vacant")
      .limit(4000)
    for (const unit of units ?? []) {
      if (typeof unit.property_id === "string") vacantByProperty.add(unit.property_id)
    }
  }

  const cells = new Map<string, { lat: number; lon: number }>()
  for (const property of properties) {
    if (property.latitude == null || property.longitude == null) continue
    const key = weatherCellKey(property.latitude, property.longitude)
    if (!cells.has(key)) cells.set(key, { lat: property.latitude, lon: property.longitude })
  }

  const { data: recentSnaps } = await supabase
    .from("weather_snapshots")
    .select("cell_key, fetched_at, source_ok, forecast_hourly, active_alerts")
    .order("fetched_at", { ascending: false })
    .limit(500)
  const latest = new Map<string, CellSnapshotInput>()
  for (const row of recentSnaps ?? []) {
    const key = String(row.cell_key ?? "")
    if (!key || latest.has(key)) continue
    latest.set(key, {
      fetchedAt: String(row.fetched_at ?? ""),
      sourceOk: row.source_ok === true,
      hourly: Array.isArray(row.forecast_hourly) ? row.forecast_hourly as HourlyForecastPoint[] : [],
      alerts: Array.isArray(row.active_alerts) ? row.active_alerts as NwsAlertFact[] : [],
    })
  }

  const { data: activeEvents } = await supabase
    .from("weather_events")
    .select("id, landlord_id, property_id, level, starts_at, ends_at, low_temp_f, nws_event, status, notified_level")
    .eq("status", "active")
    .limit(1000)
  const activeCells = new Set<string>()
  for (const event of activeEvents ?? []) {
    const property = properties.find((row) => row.id === event.property_id)
    if (property?.latitude == null || property.longitude == null) continue
    activeCells.add(weatherCellKey(property.latitude, property.longitude))
  }

  const beforeRequest = paceNws()
  let fetched = 0
  let failed = 0
  for (const [cellKey, coords] of cells) {
    const last = latest.get(cellKey)
    if (
      !mock &&
      !cellNeedsFetch({
        lastFetchedAt: last?.fetchedAt ?? null,
        hasActiveEvent: activeCells.has(cellKey),
        now,
      })
    ) {
      continue
    }
    const snapshot = mock
      ? {
        hourly: mock.hourly ?? [],
        alerts: mock.alerts ?? [],
        sourceOk: (mock.hourly ?? []).length > 0,
      }
      : await fetchNwsCellSnapshot(coords.lat, coords.lon, fetch, undefined, beforeRequest)
    const row = {
      cell_key: cellKey,
      lat: coords.lat,
      lon: coords.lon,
      fetched_at: now.toISOString(),
      forecast_hourly: snapshot.hourly,
      active_alerts: snapshot.alerts,
      source_ok: snapshot.sourceOk,
    }
    const { error } = await supabase.from("weather_snapshots").insert(row)
    if (error) {
      failed += 1
      console.warn("[weather] snapshot insert failed", error.message)
    }
    latest.set(cellKey, {
      fetchedAt: row.fetched_at,
      sourceOk: snapshot.sourceOk,
      hourly: snapshot.hourly,
      alerts: snapshot.alerts,
    })
    if (!snapshot.sourceOk) failed += 1
    fetched += 1
  }

  const cycleProperties: CycleProperty[] = properties.map((property) => ({
    id: property.id,
    landlordId: property.landlord_id,
    name: property.name?.trim() || "Property",
    state: property.state,
    yearBuilt: property.year_built,
    vacant: vacantByProperty.has(property.id),
    cellKey: property.latitude != null && property.longitude != null
      ? weatherCellKey(property.latitude, property.longitude)
      : null,
  }))

  const { data: tickets } = propertyIds.length
    ? await supabase
      .from("maintenance_requests")
      .select("id, property_id, landlord_id, description, urgency, status, vendor_work_status")
      .in("property_id", propertyIds)
      .limit(1000)
    : { data: [] }
  const openTickets = (tickets ?? []).filter((ticket) => {
    const status = String(ticket.status ?? "").toLowerCase()
    const work = String(ticket.vendor_work_status ?? "").toLowerCase()
    return !["completed", "cancelled", "closed", "resolved"].includes(status) && work !== "cancelled"
  }).map((ticket) => ({
    id: String(ticket.id),
    propertyId: String(ticket.property_id ?? ""),
    description: String(ticket.description ?? ""),
    urgency: typeof ticket.urgency === "string" ? ticket.urgency : null,
  }))

  const { data: taskRows } = await supabase
    .from("preventive_maintenance_tasks")
    .select("id, landlord_id, title, status, metadata")
    .limit(1000)
  const tasks: CycleTask[] = (taskRows ?? []).map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {}
    const propertyId = typeof metadata.property_id === "string" ? metadata.property_id : ""
    const kind = metadata.kind === "winterizing"
      ? "winterizing"
      : /furnace|hvac|tune-up/i.test(String(row.title ?? ""))
        ? "hvac"
        : "other"
    const checklist = Array.isArray(metadata.checklist) ? metadata.checklist : []
    const checklistDone = row.status === "completed" ||
      (checklist.length > 0 && checklist.every((item) =>
        Boolean(item && typeof item === "object" && (item as { done?: boolean }).done)
      ))
    return {
      id: String(row.id),
      propertyId,
      title: String(row.title ?? ""),
      status: String(row.status ?? ""),
      kind,
      season: typeof metadata.season === "string" ? metadata.season : null,
      checklistDone,
    }
  })

  const { data: settingsRows } = await supabase
    .from("landlord_weather_settings")
    .select("landlord_id, text_enabled, threshold_adjust_f, watch_text_enabled")
    .limit(2000)
  const settingsByLandlord: Record<string, WeatherSettings> = {}
  for (const row of settingsRows ?? []) {
    settingsByLandlord[String(row.landlord_id)] = {
      textEnabled: row.text_enabled !== false,
      thresholdAdjustF: typeof row.threshold_adjust_f === "number" ? row.threshold_adjust_f : 0,
      watchTextEnabled: row.watch_text_enabled === true,
    }
  }

  const frostByProperty: Record<string, { monthDay: string; label: string }> = {}
  const apiKey = Deno.env.get("OPEN_METEO_API_KEY")?.trim() ?? ""
  for (const property of properties) {
    if (property.latitude == null || property.longitude == null) continue
    const cellKey = weatherCellKey(property.latitude, property.longitude)
    const { data: cached } = await supabase
      .from("frost_dates")
      .select("first_frost_date, computed_at")
      .eq("cell_key", cellKey)
      .maybeSingle()
    const computedAt = Date.parse(String(cached?.computed_at ?? ""))
    const fresh = Number.isFinite(computedAt) && now.getTime() - computedAt < 365 * 24 * 60 * 60 * 1000
    let monthDay = fresh ? String(cached?.first_frost_date ?? "") : ""
    if (!monthDay) {
      let days: Array<{ time: string; tempMinF: number }> | null = null
      if (apiKey) {
        const end = now.toISOString().slice(0, 10)
        const start = new Date(now.getTime() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const url = `https://customer-archive-api.open-meteo.com/v1/archive?latitude=${property.latitude}&longitude=${property.longitude}&start_date=${start}&end_date=${end}&daily=temperature_2m_min&temperature_unit=fahrenheit&apikey=${encodeURIComponent(apiKey)}`
        try {
          const res = await fetch(url)
          if (res.ok) {
            const body = await res.json() as { daily?: { time?: string[]; temperature_2m_min?: number[] } }
            const times = body.daily?.time ?? []
            const mins = body.daily?.temperature_2m_min ?? []
            days = times.map((time, index) => ({ time, tempMinF: mins[index] ?? 99 }))
          }
        } catch (err) {
          console.warn("[weather] Open-Meteo lookup failed", err)
        }
      }
      const resolved = resolveFrostDate({
        state: property.state,
        openMeteoDays: days,
        apiKeyPresent: Boolean(apiKey),
      })
      if (resolved.loggedFallback) {
        console.warn("[weather] OPEN_METEO_API_KEY missing; using the state frost table", {
          state: property.state,
          monthDay: resolved.monthDay ?? stateFirstFrostMonthDay(property.state),
        })
      }
      if (resolved.monthDay) {
        monthDay = resolved.monthDay
        await supabase.from("frost_dates").upsert({
          cell_key: cellKey,
          first_frost_date: monthDay,
          source: resolved.source,
          computed_at: now.toISOString(),
        })
      }
    }
    if (monthDay) {
      const [month, day] = monthDay.split("-")
      const label = new Date(Date.UTC(2026, Number(month) - 1, Number(day), 12))
        .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      frostByProperty[property.id] = { monthDay, label }
    }
  }

  const seasonYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const seasonStart = new Date(Date.UTC(seasonYear, 8, 1)).toISOString()
  const { data: seasonEvents } = await supabase
    .from("weather_events")
    .select("landlord_id")
    .gte("starts_at", seasonStart)
    .limit(2000)
  const landlordsWithSeasonEvent = new Set(
    (seasonEvents ?? []).map((row) => String(row.landlord_id ?? "")),
  )
  const firstWatchOfSeasonByLandlord: Record<string, boolean> = {}
  for (const property of properties) {
    if (!landlordsWithSeasonEvent.has(property.landlord_id)) {
      firstWatchOfSeasonByLandlord[property.landlord_id] = true
    }
  }

  const events: WeatherEventState[] = (activeEvents ?? []).map((row) => ({
    id: String(row.id),
    propertyId: String(row.property_id),
    landlordId: String(row.landlord_id),
    level: row.level as WeatherEventState["level"],
    startsAt: String(row.starts_at),
    endsAt: row.ends_at ? String(row.ends_at) : null,
    lowTempF: typeof row.low_temp_f === "number" ? row.low_temp_f : null,
    nwsEvent: typeof row.nws_event === "string" ? row.nws_event : null,
    status: row.status === "resolved" ? "resolved" : "active",
    notifiedLevel: (row.notified_level as WeatherEventState["notifiedLevel"]) ?? null,
  }))

  const plan = planWeatherCycle({
    now,
    properties: cycleProperties,
    snapshots: Object.fromEntries(latest),
    events,
    tickets: openTickets,
    tasks,
    settingsByLandlord,
    firstWatchOfSeasonByLandlord,
    appLink: uloAppUrl.admin(),
    frostByProperty,
  })

  for (const event of plan.events) {
    const previous = events.find((row) => row.id === event.id)
    if (event.id.startsWith("new:")) {
      await supabase.from("weather_events").insert({
        landlord_id: event.landlordId,
        property_id: event.propertyId,
        level: event.level,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        low_temp_f: event.lowTempF,
        nws_event: event.nwsEvent,
        status: event.status,
        notified_level: null,
      })
      continue
    }
    if (
      previous &&
      previous.level === event.level &&
      previous.status === event.status &&
      previous.lowTempF === event.lowTempF
    ) {
      continue
    }
    await supabase.from("weather_events").update({
      level: event.level,
      ends_at: event.endsAt,
      low_temp_f: event.lowTempF,
      nws_event: event.nwsEvent,
      status: event.status,
    }).eq("id", event.id)
  }

  for (const update of plan.ticketUpdates) {
    const { error } = await supabase
      .from("maintenance_requests")
      .update({ urgency: update.to })
      .eq("id", update.ticketId)
    if (error) continue
    await recordActivityLog(supabase, {
      landlordId: update.landlordId,
      eventType: "maintenance.urgency_raised",
      source: "automation",
      actorType: "system",
      propertyId: update.propertyId,
      maintenanceRequestId: update.ticketId,
      metadata: { message: update.message },
    })
  }

  for (const task of plan.winterizingTasks) {
    await supabase.from("preventive_maintenance_tasks").insert({
      landlord_id: task.landlordId,
      title: task.title,
      task_kind: "service",
      due_at: task.dueAt,
      status: "scheduled",
      metadata: {
        kind: "winterizing",
        property_id: task.propertyId,
        season: task.season,
        hvac_task_id: task.hvacTaskId,
        checklist: task.checklist,
      },
    })
    await recordActivityLog(supabase, {
      landlordId: task.landlordId,
      eventType: "maintenance.winterizing_ready",
      source: "automation",
      actorType: "system",
      propertyId: task.propertyId,
      metadata: { message: "Winterizing checklist is ready." },
    })
  }

  const smsSent: string[] = []
  for (const message of [...plan.sms, ...plan.winterizingSms]) {
    const result = await notifyLandlordNeedsAttention(supabase, {
      landlordId: message.landlordId,
      kind: "weather_alert",
      headline: message.level === "extreme_cold"
        ? "Extreme cold is in the forecast"
        : message.level === "hard_freeze"
          ? "A hard freeze is in the forecast"
          : "Winterizing checklist is ready",
      detail: message.body,
      idempotencyKey: message.idempotencyKey,
      smsBody: message.body,
      isCritical: message.isCritical,
      omitWorkOrderRef: true,
    })
    if (result.skipped) continue
    smsSent.push(message.idempotencyKey)
    for (const event of plan.events) {
      if (event.landlordId !== message.landlordId || event.status !== "active") continue
      if (event.notifiedLevel !== message.level) continue
      const update = supabase.from("weather_events").update({ notified_level: message.level })
      if (event.id.startsWith("new:")) {
        await update.eq("property_id", event.propertyId).eq("status", "active")
      } else {
        await update.eq("id", event.id)
      }
    }
  }

  return jsonResponse({
    cells: cells.size,
    fetched,
    failed,
    events: plan.events.filter((event) => event.status === "active").length,
    sms: smsSent.length,
    tickets: plan.ticketUpdates.length,
    winterizing: plan.winterizingTasks.length,
  })
})
