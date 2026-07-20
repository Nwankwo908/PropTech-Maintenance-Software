/**
 * Domain tool: draft notices, emails, checklists.
 * Routed via capability `draft` — not a playbook short-circuit.
 */

export type DraftCommunicationKind =
  | "water_shutoff_notice"
  | "scheduled_maintenance_message"
  | "vendor_update_email"
  | "lease_renewal_reminder"
  | "move_out_checklist"
  | "resident_complaint_response"
  | "team_activity_summary"
  | "generic_notice"

export type DraftCommunicationResult = {
  available: true
  found: true
  kind: DraftCommunicationKind
  markdown: string
  tool: "draft_communication"
}

const DRAFT_VERB_RE =
  /\b(draft|write|compose|create|prepare|help\s+me\s+(?:write|draft)|give\s+me\s+(?:a\s+)?(?:draft|template))\b/i

export function isDraftCommunicationQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (!DRAFT_VERB_RE.test(q)) return false
  return (
    /\b(notice|message|email|letter|checklist|reminder|response|reply)\b/i.test(q) ||
    /\b(water\s+shut[\s-]?off|shut[\s-]?off|scheduled\s+maintenance|move[\s-]?out)\b/i.test(q)
  )
}

export function detectDraftCommunicationKind(question: string): DraftCommunicationKind {
  const q = question.trim()
  if (/\bwater\s+shut[\s-]?off|shut[\s-]?off.{0,20}\bwater\b/i.test(q)) {
    return "water_shutoff_notice"
  }
  if (/\bscheduled\s+maintenance\b/i.test(q) && /\b(residents?|tenants?|all)\b/i.test(q)) {
    return "scheduled_maintenance_message"
  }
  if (/\bvendor\b/i.test(q) && /\b(email|update|message)\b/i.test(q)) {
    return "vendor_update_email"
  }
  if (/\blease\s+renewal\b/i.test(q) && /\breminder\b/i.test(q)) {
    return "lease_renewal_reminder"
  }
  if (/\bmove[\s-]?out\s+checklist\b/i.test(q)) {
    return "move_out_checklist"
  }
  if (/\b(complaint|resident\s+complaint)\b/i.test(q) && /\b(response|reply)\b/i.test(q)) {
    return "resident_complaint_response"
  }
  if (/\b(summarize|summary).{0,40}\b(activity|team)\b/i.test(q)) {
    return "team_activity_summary"
  }
  return "generic_notice"
}

function tomorrowLabel(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function waterShutoffDraft(question: string): string {
  const when = /\btomorrow\b/i.test(question) ? tomorrowLabel() : "[DATE]"
  const building = "[BUILDING / ADDRESS]"
  const window = "[e.g. 9:00 a.m. – 2:00 p.m.]"
  const reason = "[e.g. scheduled plumbing repair / building maintenance]"
  const contact = "[PROPERTY MANAGER NAME / PHONE]"

  return [
    "Here's a resident notice you can copy and send. Fill in the brackets before posting.",
    "",
    "---",
    "",
    "**NOTICE OF TEMPORARY WATER SHUTOFF**",
    "",
    `**Property:** ${building}`,
    `**Date of shutoff:** ${when}`,
    `**Approximate time:** ${window}`,
    "",
    "Dear Residents,",
    "",
    `Please be advised that water service will be temporarily shut off at the property on **${when}** during approximately **${window}** due to **${reason}**.`,
    "",
    "During this time:",
    "- Hot and cold water may be unavailable in units and common areas",
    "- Please store water in advance for drinking, cooking, and personal use",
    "- Avoid starting laundry, dishwashing, or other water-dependent tasks during the window",
    "",
    "We expect service to be restored as soon as the work is complete. If the schedule changes, we will notify you.",
    "",
    `If you have questions or special needs (medical equipment, mobility, etc.), contact **${contact}** as soon as possible.`,
    "",
    "Thank you for your patience.",
    "",
    "Property Management",
    "",
    "---",
    "",
    "**Before you send**",
    "- Confirm the building, date, time window, and reason",
    "- This template is for **scheduled maintenance** notice — not a punitive utility shutoff",
    "- If you tell me the property name and exact hours, I'll rewrite this with those details filled in",
  ].join("\n")
}

function scheduledMaintenanceDraft(): string {
  return [
    "Here's a resident message you can adapt:",
    "",
    "---",
    "",
    "**Subject:** Scheduled maintenance — [DATE]",
    "",
    "Hi everyone,",
    "",
    "We will be performing scheduled maintenance at **[PROPERTY]** on **[DATE]** from **[START]** to **[END]**.",
    "",
    "**What to expect:** [brief description]",
    "**Areas affected:** [units / common areas]",
    "",
    "Please [any access or prep instructions]. Contact **[NAME / PHONE]** with questions.",
    "",
    "Thank you,",
    "Property Management",
    "",
    "---",
    "",
    "Share the property, date, and work type and I'll fill this in completely.",
  ].join("\n")
}

function vendorUpdateEmailDraft(): string {
  return [
    "Here's a professional follow-up you can send to the vendor:",
    "",
    "---",
    "",
    "**Subject:** Status update requested — [WORK ORDER / PROPERTY]",
    "",
    "Hi [VENDOR NAME],",
    "",
    "I'm following up on **[JOB / WORK ORDER #]** at **[PROPERTY / UNIT]**. Could you please confirm:",
    "1. Current status",
    "2. Next scheduled visit or completion ETA",
    "3. Anything you need from us or the resident",
    "",
    "Please reply by **[DATE]** so we can keep the resident updated.",
    "",
    "Thank you,",
    "[YOUR NAME]",
    "",
    "---",
  ].join("\n")
}

function leaseRenewalReminderDraft(): string {
  return [
    "Here's a lease renewal reminder draft:",
    "",
    "---",
    "",
    "**Subject:** Lease renewal — [PROPERTY / UNIT]",
    "",
    "Hi [RESIDENT NAME],",
    "",
    "Your lease for **[UNIT]** at **[PROPERTY]** is set to end on **[LEASE END DATE]**. We'd like to discuss renewal options.",
    "",
    "Please reply by **[RESPONSE DEADLINE]** to confirm interest or schedule a time to talk.",
    "",
    "Thank you,",
    "Property Management",
    "",
    "---",
  ].join("\n")
}

function moveOutChecklistDraft(): string {
  return [
    "Here's a move-out checklist you can share with residents:",
    "",
    "### Move-out checklist",
    "- [ ] Schedule final walkthrough",
    "- [ ] Return all keys, fobs, and remotes",
    "- [ ] Clear personal belongings from unit, storage, and mailbox",
    "- [ ] Clean kitchen (appliances, cabinets, floors)",
    "- [ ] Clean bathrooms (fixtures, floors, vents)",
    "- [ ] Patch small nail holes / touch up paint if required by lease",
    "- [ ] Provide forwarding address for deposit accounting",
    "- [ ] Confirm utilities transfer / final meter reads",
    "- [ ] Remove trash and recycling",
    "",
    "Tell me the property or lease rules and I'll customize this.",
  ].join("\n")
}

function complaintResponseDraft(): string {
  return [
    "Here's a professional response template for a resident complaint:",
    "",
    "---",
    "",
    "Hi [RESIDENT NAME],",
    "",
    "Thank you for bringing this to our attention. I'm sorry for the inconvenience with **[ISSUE]**.",
    "",
    "Here's what we're doing next:",
    "1. **[IMMEDIATE STEP]**",
    "2. **[FOLLOW-UP / ETA]**",
    "",
    "Please reply if anything changes or if you need temporary accommodations. You can reach me at **[PHONE / EMAIL]**.",
    "",
    "Thank you,",
    "[YOUR NAME]",
    "",
    "---",
    "",
    "Paste the complaint details and I'll tailor the wording.",
  ].join("\n")
}

function genericNoticeDraft(question: string): string {
  return [
    "I can draft that for you. Here's a starting template:",
    "",
    "---",
    "",
    `**Draft based on your ask:** ${question.trim().slice(0, 160)}`,
    "",
    "Dear [RECIPIENT],",
    "",
    "[Main message — purpose, date/time, what to expect, and who to contact.]",
    "",
    "Thank you,",
    "Property Management",
    "",
    "---",
    "",
    "Tell me the audience (residents / vendor / team), property, and key details and I'll rewrite a finished version.",
  ].join("\n")
}

function markdownForKind(kind: DraftCommunicationKind, question: string): string {
  switch (kind) {
    case "water_shutoff_notice":
      return waterShutoffDraft(question)
    case "scheduled_maintenance_message":
      return scheduledMaintenanceDraft()
    case "vendor_update_email":
      return vendorUpdateEmailDraft()
    case "lease_renewal_reminder":
      return leaseRenewalReminderDraft()
    case "move_out_checklist":
      return moveOutChecklistDraft()
    case "resident_complaint_response":
      return complaintResponseDraft()
    case "team_activity_summary":
      return [
        "I can draft a team activity summary once I know the window you care about.",
        "",
        "Ask me something like **“Summarize today's activity for my team”** after we've pulled today's ops, or tell me which property and date range to cover.",
      ].join("\n")
    default:
      return genericNoticeDraft(question)
  }
}

/** Domain tool entrypoint. */
export function draftCommunication(params: {
  question: string
}): DraftCommunicationResult {
  const kind = detectDraftCommunicationKind(params.question)
  return {
    available: true,
    found: true,
    kind,
    markdown: markdownForKind(kind, params.question),
    tool: "draft_communication",
  }
}
