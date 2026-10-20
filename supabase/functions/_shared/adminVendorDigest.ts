/**
 * "Waiting on a vendor" digest for admins: tickets parked in
 * needs_admin_vendor for more than N hours.
 *
 * Replaces the flat "Landlord · WO · name · raw description · 416h" list with:
 *  - a header line (how many, how many urgent, oldest)
 *  - Urgent & safety first, then HQS inspections grouped per unit, then the rest
 *  - per ticket: staff summary, address/unit + room/spot, tenant, category, age
 *  - possible-duplicate flags (same unit + category)
 *
 * Pure: takes rows, returns { subject, text, html }. The caller loads rows
 * (see loadStaleVendorTickets example at the bottom) and sends via
 * sendLandlordOpsEmail / your admin mailer.
 */

import {
  deriveContextHeuristic,
  parseHqsDescription,
  rankUrgency,
  type Category,
  type Urgency,
} from "./workOrderContext.ts"

export interface StaleVendorTicket {
  id: string
  displayId: string // "WO-E6F7"
  landlordName: string // "KendoProperties"
  description: string
  createdAt: string
  /** When it entered needs_admin_vendor; falls back to createdAt. */
  parkedSince?: string | null
  propertyId?: string | null
  propertyAddress?: string | null // "123 Oak St"
  unit?: string | null // "Unit B"
  residentName?: string | null
  residentPhone?: string | null
  photoCount?: number | null
  // Cached context columns (null -> derived on the fly with the heuristic)
  summary?: string | null
  category?: string | null
  room?: string | null
  locationDetail?: string | null
  urgency?: string | null
}

export interface DigestOptions {
  now?: Date
  thresholdHours?: number
  ticketUrl: (displayId: string) => string
  /** Optional deep link straight to vendor assignment. */
  assignUrl?: (displayId: string) => string
  /** Minimum HQS items from one unit/inspection before they are grouped. */
  hqsGroupMin?: number
}

export interface DigestEmail {
  subject: string
  text: string
  html: string
}

// ---------------------------------------------------------------------------

interface Enriched extends StaleVendorTicket {
  ctx: { summary: string; category: Category; room: string | null; locationDetail: string | null; urgency: Urgency }
  ageHours: number
  tenant: string | null
  unitKey: string
  isHqs: boolean
  duplicateOf?: string
}

const CATEGORY_LABEL: Record<Category, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  pest: "Pest control",
  appliance: "Appliance",
  hvac: "Heating / AC",
  safety: "Safety",
  interior: "Interior repair",
  exterior: "Exterior",
  general: "General",
}

const PLACEHOLDER_NAMES = /^(resident|tenant|unknown|n\/a|-)?$/i

function enrich(t: StaleVendorTicket, now: Date): Enriched {
  const derived = deriveContextHeuristic(t.description)
  const urgency = (["emergency", "safety", "routine"].includes(t.urgency ?? "") ? t.urgency : derived.urgency) as Urgency
  const since = new Date(t.parkedSince ?? t.createdAt)
  const name = t.residentName?.trim() ?? ""
  return {
    ...t,
    ctx: {
      summary: t.summary?.trim() || derived.summary,
      category: (t.category as Category) || derived.category,
      room: t.room ?? derived.room,
      locationDetail: t.locationDetail ?? derived.location_detail,
      // Keyword detection can only raise urgency, never lower a stored value.
      urgency: rankUrgency(derived.urgency) > rankUrgency(urgency) ? derived.urgency : urgency,
    },
    ageHours: Math.max(0, (now.getTime() - since.getTime()) / 36e5),
    tenant: PLACEHOLDER_NAMES.test(name) ? null : name,
    unitKey: [t.landlordName, t.propertyId ?? t.propertyAddress ?? "", t.unit ?? ""].join("|").toLowerCase(),
    isHqs: parseHqsDescription(t.description) != null,
  }
}

export function formatAge(hours: number): string {
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.floor(hours / 24)} days`
}

function placeLine(t: Enriched): string | null {
  const addr = [t.propertyAddress, t.unit].filter(Boolean).join(", ")
  const spot = [t.ctx.room, t.ctx.locationDetail].filter(Boolean).join(" — ")
  const parts = [addr, spot].filter(Boolean)
  return parts.length ? parts.join(" · ") : null
}

function markDuplicates(tickets: Enriched[]): void {
  // Oldest ticket wins; later ones with same unit + category are flagged.
  const seen = new Map<string, Enriched>()
  for (const t of [...tickets].sort((a, b) => b.ageHours - a.ageHours)) {
    if (t.isHqs || t.ctx.category === "general") continue
    // Without a property/unit we fall back to tenant name to avoid false matches.
    const who = t.propertyId || t.propertyAddress || t.unit ? t.unitKey : `${t.landlordName}|${t.tenant ?? t.id}`.toLowerCase()
    const key = `${who}|${t.ctx.category}`
    const first = seen.get(key)
    if (first) t.duplicateOf = first.displayId
    else seen.set(key, t)
  }
}

interface HqsGroup {
  key: string
  items: Enriched[]
  address: string | null
  landlordName: string
  tenant: string | null
  ageHours: number
}

function groupHqs(tickets: Enriched[], min: number): { groups: HqsGroup[]; grouped: Set<string> } {
  const byKey = new Map<string, Enriched[]>()
  for (const t of tickets) {
    if (!t.isHqs) continue
    // Same unit and created within the same 6h window = same inspection.
    const bucket = Math.floor(new Date(t.createdAt).getTime() / (6 * 36e5))
    const key = `${t.unitKey}|${bucket}`
    byKey.set(key, [...(byKey.get(key) ?? []), t])
  }
  const groups: HqsGroup[] = []
  const grouped = new Set<string>()
  for (const [key, items] of byKey) {
    if (items.length < min) continue
    items.sort((a, b) => rankUrgency(b.ctx.urgency) - rankUrgency(a.ctx.urgency) || (a.ctx.room ?? "").localeCompare(b.ctx.room ?? ""))
    items.forEach((i) => grouped.add(i.id))
    groups.push({
      key,
      items,
      address: [items[0].propertyAddress, items[0].unit].filter(Boolean).join(", ") || null,
      landlordName: items[0].landlordName,
      tenant: items.find((i) => i.tenant)?.tenant ?? null,
      ageHours: Math.max(...items.map((i) => i.ageHours)),
    })
  }
  groups.sort((a, b) => b.ageHours - a.ageHours)
  return { groups, grouped }
}

const byUrgencyThenAge = (a: Enriched, b: Enriched) =>
  rankUrgency(b.ctx.urgency) - rankUrgency(a.ctx.urgency) || b.ageHours - a.ageHours

// ---------------------------------------------------------------------------

export function buildAdminVendorDigest(rows: StaleVendorTicket[], opts: DigestOptions): DigestEmail | null {
  if (!rows.length) return null
  const now = opts.now ?? new Date()
  const threshold = opts.thresholdHours ?? 24
  const tickets = rows.map((r) => enrich(r, now))
  markDuplicates(tickets)

  const { groups, grouped } = groupHqs(tickets, opts.hqsGroupMin ?? 3)
  const loose = tickets.filter((t) => !grouped.has(t.id))
  const urgent = loose.filter((t) => t.ctx.urgency !== "routine").sort(byUrgencyThenAge)
  const routine = loose.filter((t) => t.ctx.urgency === "routine").sort((a, b) => b.ageHours - a.ageHours)

  const urgentCount = tickets.filter((t) => t.ctx.urgency !== "routine").length
  const oldest = Math.max(...tickets.map((t) => t.ageHours))
  const landlords = [...new Set(tickets.map((t) => t.landlordName))]

  const subject = [
    `${tickets.length} ticket${tickets.length === 1 ? "" : "s"} waiting on a vendor`,
    urgentCount ? `${urgentCount} urgent/safety` : null,
    `oldest ${formatAge(oldest)}`,
  ].filter(Boolean).join(" · ")

  const dateLabel = now.toISOString().slice(0, 10)
  const intro = `These tickets have been in "needs vendor" for more than ${threshold} hours and stay parked until someone assigns a vendor or hands them back to automation.`

  return {
    subject,
    text: renderText({ tickets, urgent, routine, groups, urgentCount, oldest, landlords, dateLabel, intro, opts }),
    html: renderHtml({ tickets, urgent, routine, groups, urgentCount, oldest, landlords, dateLabel, intro, opts }),
  }
}

interface RenderInput {
  tickets: Enriched[]
  urgent: Enriched[]
  routine: Enriched[]
  groups: HqsGroup[]
  urgentCount: number
  oldest: number
  landlords: string[]
  dateLabel: string
  intro: string
  opts: DigestOptions
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function textTicket(t: Enriched, opts: DigestOptions): string {
  const flag = t.ctx.urgency === "emergency" ? "[URGENT] " : t.ctx.urgency === "safety" ? "[SAFETY] " : ""
  const lines = [
    `${flag}${t.displayId} — ${t.ctx.summary}`,
    placeLine(t) ? `   Where: ${placeLine(t)}` : null,
    `   ${[t.tenant ? `Tenant: ${t.tenant}${t.residentPhone ? ` (${t.residentPhone})` : ""}` : null, CATEGORY_LABEL[t.ctx.category], `waiting ${formatAge(t.ageHours)}`, t.landlordName].filter(Boolean).join(" · ")}`,
    t.duplicateOf ? `   Possible duplicate of ${t.duplicateOf}` : null,
    `   ${opts.ticketUrl(t.displayId)}`,
  ]
  return lines.filter(Boolean).join("\n")
}

function renderText(r: RenderInput): string {
  const out: string[] = [
    `Waiting on a vendor — ${r.dateLabel}`,
    `${r.tickets.length} tickets · ${r.urgentCount} urgent/safety · oldest ${formatAge(r.oldest)}`,
    "",
  ]
  if (r.urgent.length) {
    out.push(`URGENT & SAFETY (${r.urgent.length})`, "")
    for (const t of r.urgent) out.push(textTicket(t, r.opts), "")
  }
  for (const g of r.groups) {
    out.push(`HQS INSPECTION — ${g.address ?? g.landlordName} (${g.items.length} items, ${formatAge(g.ageHours)})`)
    if (g.tenant) out.push(`Tenant: ${g.tenant}`)
    for (const i of g.items) {
      const where = [i.ctx.room, i.ctx.locationDetail].filter(Boolean).join(" — ")
      const flag = i.ctx.urgency !== "routine" ? " [SAFETY]" : ""
      out.push(` - ${i.displayId}: ${i.ctx.summary.replace(/^HQS fail:\s*/i, "")}${where ? ` (${where})` : ""}${flag}`)
    }
    out.push("")
  }
  if (r.routine.length) {
    out.push(`OTHER REPAIRS (${r.routine.length})`, "")
    for (const t of r.routine) out.push(textTicket(t, r.opts), "")
  }
  out.push(r.intro)
  return out.join("\n")
}

// ---------------------------------------------------------------------------
// HTML (inline styles only — email clients strip <style>)
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const C = {
  text: "#1f2328",
  muted: "#59636e",
  border: "#e4e7eb",
  bg: "#f6f7f9",
  red: "#b42318",
  redBg: "#fef3f2",
  amber: "#b54708",
  amberBg: "#fffaeb",
  link: "#1a56db",
}

function badge(label: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:600;letter-spacing:.02em;color:${color};background:${bg};">${esc(label)}</span>`
}

function urgencyBadge(u: Urgency): string {
  if (u === "emergency") return badge("URGENT", C.red, C.redBg)
  if (u === "safety") return badge("SAFETY", C.amber, C.amberBg)
  return ""
}

function button(href: string, label: string, primary: boolean): string {
  return `<a href="${esc(href)}" style="display:inline-block;margin-right:8px;padding:6px 12px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;${
    primary ? `background:${C.link};color:#fff;` : `border:1px solid ${C.border};color:${C.text};`
  }">${esc(label)}</a>`
}

function ageStyle(hours: number): string {
  return hours >= 24 * 14 ? `color:${C.red};font-weight:600;` : hours >= 24 * 7 ? `color:${C.amber};font-weight:600;` : `color:${C.muted};`
}

function htmlTicket(t: Enriched, opts: DigestOptions): string {
  const place = placeLine(t)
  const meta = [
    t.tenant ? `${esc(t.tenant)}${t.residentPhone ? ` · ${esc(t.residentPhone)}` : ""}` : null,
    esc(CATEGORY_LABEL[t.ctx.category]),
    t.photoCount ? `${t.photoCount} photo${t.photoCount === 1 ? "" : "s"}` : null,
    esc(t.landlordName),
  ].filter(Boolean).join(" · ")
  return `
<div style="padding:14px 0;border-top:1px solid ${C.border};">
  <div style="font-size:15px;font-weight:600;line-height:1.35;color:${C.text};">
    ${urgencyBadge(t.ctx.urgency)}${t.ctx.urgency !== "routine" ? " " : ""}${esc(t.ctx.summary)}
  </div>
  ${place ? `<div style="margin-top:4px;font-size:13px;color:${C.text};">📍 ${esc(place)}</div>` : ""}
  <div style="margin-top:3px;font-size:13px;color:${C.muted};">
    <a href="${esc(opts.ticketUrl(t.displayId))}" style="color:${C.link};text-decoration:none;font-weight:600;">${esc(t.displayId)}</a>
    · ${meta} · <span style="${ageStyle(t.ageHours)}">waiting ${formatAge(t.ageHours)}</span>
  </div>
  ${t.duplicateOf ? `<div style="margin-top:4px;font-size:12px;color:${C.amber};">Possible duplicate of ${esc(t.duplicateOf)} — same unit, same issue type</div>` : ""}
  <div style="margin-top:8px;">
    ${opts.assignUrl ? button(opts.assignUrl(t.displayId), "Assign vendor", true) : ""}${button(opts.ticketUrl(t.displayId), "View ticket", !opts.assignUrl)}
  </div>
</div>`
}

function htmlHqsGroup(g: HqsGroup, opts: DigestOptions): string {
  const safety = g.items.filter((i) => i.ctx.urgency !== "routine").length
  const rows = g.items
    .map((i) => {
      const where = [i.ctx.room, i.ctx.locationDetail].filter(Boolean).join(" — ")
      return `<tr>
  <td style="padding:6px 8px 6px 0;font-size:13px;color:${C.text};vertical-align:top;">${urgencyBadge(i.ctx.urgency)}${i.ctx.urgency !== "routine" ? " " : ""}${esc(i.ctx.summary.replace(/^HQS fail:\s*/i, ""))}</td>
  <td style="padding:6px 8px;font-size:13px;color:${C.muted};vertical-align:top;">${esc(where || "—")}</td>
  <td style="padding:6px 0 6px 8px;font-size:13px;vertical-align:top;white-space:nowrap;"><a href="${esc(opts.ticketUrl(i.displayId))}" style="color:${C.link};text-decoration:none;">${esc(i.displayId)}</a></td>
</tr>`
    })
    .join("")
  return `
<div style="padding:14px 0;border-top:1px solid ${C.border};">
  <div style="font-size:15px;font-weight:600;color:${C.text};">HQS inspection — ${g.items.length} failed items${safety ? ` (${safety} safety)` : ""}</div>
  <div style="margin-top:4px;font-size:13px;color:${C.text};">📍 ${esc(g.address ?? "Address not on file")}</div>
  <div style="margin-top:3px;font-size:13px;color:${C.muted};">${[g.tenant ? esc(g.tenant) : null, esc(g.landlordName)].filter(Boolean).join(" · ")} · <span style="${ageStyle(g.ageHours)}">waiting ${formatAge(g.ageHours)}</span></div>
  <div style="margin-top:3px;font-size:12px;color:${C.muted};">Usually one general contractor can take all of these in a single visit.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;width:100%;border-collapse:collapse;">
    <tr>
      <th align="left" style="padding:4px 8px 4px 0;font-size:11px;font-weight:600;color:${C.muted};text-transform:uppercase;border-bottom:1px solid ${C.border};">Item</th>
      <th align="left" style="padding:4px 8px;font-size:11px;font-weight:600;color:${C.muted};text-transform:uppercase;border-bottom:1px solid ${C.border};">Where</th>
      <th align="left" style="padding:4px 0 4px 8px;font-size:11px;font-weight:600;color:${C.muted};text-transform:uppercase;border-bottom:1px solid ${C.border};">Ticket</th>
    </tr>
    ${rows}
  </table>
</div>`
}

function section(title: string, count: number, body: string): string {
  return `
<div style="margin-top:28px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};">${esc(title)} (${count})</div>
${body}`
}

function stat(value: string, label: string, color = C.text): string {
  return `<td style="padding:10px 14px;background:${C.bg};border-radius:8px;" width="33%">
  <div style="font-size:20px;font-weight:700;color:${color};">${esc(value)}</div>
  <div style="font-size:12px;color:${C.muted};">${esc(label)}</div>
</td>`
}

function renderHtml(r: RenderInput): string {
  const parts: string[] = []
  if (r.urgent.length) parts.push(section("Urgent & safety", r.urgent.length, r.urgent.map((t) => htmlTicket(t, r.opts)).join("")))
  if (r.groups.length) {
    const n = r.groups.reduce((s, g) => s + g.items.length, 0)
    parts.push(section("HQS inspections", n, r.groups.map((g) => htmlHqsGroup(g, r.opts)).join("")))
  }
  if (r.routine.length) parts.push(section("Other repairs", r.routine.length, r.routine.map((t) => htmlTicket(t, r.opts)).join("")))

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text};">
  <div style="font-size:12px;color:${C.muted};">Ulo · ${esc(r.dateLabel)}${r.landlords.length === 1 ? ` · ${esc(r.landlords[0])}` : ""}</div>
  <h1 style="margin:6px 0 4px;font-size:22px;line-height:1.25;">${r.tickets.length} tickets are waiting on a vendor</h1>
  <div style="font-size:14px;color:${C.muted};">Assign a vendor or hand each ticket back to automation.</div>
  <table role="presentation" cellpadding="0" cellspacing="6" style="margin:16px -6px 0;width:calc(100% + 12px);">
    <tr>
      ${stat(String(r.tickets.length), "waiting")}
      ${stat(String(r.urgentCount), "urgent / safety", r.urgentCount ? C.red : C.text)}
      ${stat(formatAge(r.oldest), "oldest")}
    </tr>
  </table>
  ${parts.join("")}
  <div style="margin-top:28px;padding-top:14px;border-top:1px solid ${C.border};font-size:12px;color:${C.muted};line-height:1.5;">${esc(r.intro)}</div>
</div>
</body></html>`
}

// ---------------------------------------------------------------------------
// Example loader — adjust table/column names to your schema.
// ---------------------------------------------------------------------------
//
// export async function loadStaleVendorTickets(supabase, thresholdHours = 24) {
//   const cutoff = new Date(Date.now() - thresholdHours * 36e5).toISOString()
//   const { data, error } = await supabase
//     .from("maintenance_requests")
//     .select(`
//       id, display_id, description, created_at, unit, resident_name, photo_paths,
//       summary, category, room, location_detail, urgency, property_id,
//       landlord:landlord_id ( name ),
//       property:property_id ( address_line1 ),
//       unit_row:unit_id ( label, tenant_name, tenant_phone )
//     `)
//     .eq("vendor_work_status", "needs_admin_vendor")
//     .lt("created_at", cutoff)   // better: a needs_admin_since column
//   if (error) throw error
//   return data.map((r) => ({
//     id: r.id,
//     displayId: r.display_id,
//     landlordName: r.landlord?.name ?? "Unknown landlord",
//     description: r.description,
//     createdAt: r.created_at,
//     propertyId: r.property_id,
//     propertyAddress: r.property?.address_line1 ?? null,
//     unit: r.unit_row?.label ?? r.unit,
//     // HQS rows were created as "Resident": prefer the unit's current tenant.
//     residentName: /^resident$/i.test(r.resident_name) ? r.unit_row?.tenant_name : r.resident_name,
//     residentPhone: r.unit_row?.tenant_phone ?? null,
//     photoCount: r.photo_paths?.length ?? 0,
//     summary: r.summary, category: r.category, room: r.room,
//     locationDetail: r.location_detail, urgency: r.urgency,
//   }))
// }
