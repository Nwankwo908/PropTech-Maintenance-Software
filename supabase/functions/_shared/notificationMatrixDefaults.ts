/**
 * Default notification event matrix for edge delivery — mirrors client
 * `DEFAULT_NOTIFICATION_SETTINGS.categories` in notificationSettings.ts.
 */
export type MatrixChannel = "email" | "sms" | "activity_feed" | "push"

export type MatrixEvent = {
  id: string
  label: string
  critical?: boolean
  channels: Record<MatrixChannel, boolean>
}

export type MatrixCategory = {
  id: string
  title: string
  description: string
  events: MatrixEvent[]
}

function matrixEvent(
  id: string,
  label: string,
  channels: Partial<Record<MatrixChannel, boolean>>,
  critical = false,
): MatrixEvent {
  return {
    id,
    label,
    critical,
    channels: {
      email: channels.email ?? true,
      sms: channels.sms ?? false,
      activity_feed: channels.activity_feed ?? true,
      push: channels.push ?? false,
    },
  }
}

export const DEFAULT_NOTIFICATION_MATRIX_CATEGORIES: MatrixCategory[] = [
  {
    id: "maintenance",
    title: "Maintenance",
    description: "Work orders, emergencies, vendor dispatch, and close-out updates.",
    events: [
      matrixEvent("new_request", "New maintenance request", { email: true, sms: true }),
      matrixEvent("emergency_request", "Emergency maintenance request", { email: true, sms: true, push: true }, true),
      matrixEvent("vendor_assigned", "Vendor assigned", { email: true, sms: false }),
      matrixEvent("vendor_delayed", "Vendor delayed response", { email: true, sms: true }),
      matrixEvent("work_completed", "Work order completed", { email: true, sms: false }),
      matrixEvent("sla_overdue", "Response time overdue", { email: true, sms: true, push: true }, true),
    ],
  },
  {
    id: "rent",
    title: "Rent collection",
    description: "Reminders, payments, delinquency, and escalation events.",
    events: [
      matrixEvent("rent_reminder", "Rent reminder sent", { email: true, sms: false }),
      matrixEvent("payment_received", "Payment received", { email: true, sms: false }),
      matrixEvent("overdue_rent", "Overdue rent", { email: true, sms: true, push: true }, true),
      matrixEvent("rent_escalated", "Rent collection escalated", { email: true, sms: true, push: true }, true),
    ],
  },
  {
    id: "leasing",
    title: "Leasing",
    description: "Applications, lease execution, renewals, and move events.",
    events: [
      matrixEvent("application_submitted", "Application submitted", { email: true, sms: false }),
      matrixEvent("lease_signed", "Lease signed", { email: true, sms: false }),
      matrixEvent("lease_expiring", "Lease expiring soon", { email: true, sms: true }),
      matrixEvent("lease_info_missing", "Leasing information is missing", { email: true, sms: true }),
      matrixEvent("move_in_scheduled", "Move-in scheduled", { email: true, sms: false }),
    ],
  },
  {
    id: "inspections",
    title: "Inspections",
    description: "Scheduling, completion, and findings that need review.",
    events: [
      matrixEvent("inspection_scheduled", "Inspection scheduled", { email: true, sms: false }),
      matrixEvent("inspection_completed", "Inspection completed", { email: true, sms: false }),
      matrixEvent("inspection_review", "Inspection requires review", { email: true, sms: true, push: true }, true),
    ],
  },
  {
    id: "workflows",
    title: "AI workflows",
    description: "Automation runs, escalations, failures, and routing exceptions.",
    events: [
      matrixEvent("workflow_started", "Workflow started", { email: false, sms: false }),
      matrixEvent("needs_your_attention", "Needs Your Attention item added", { email: true, sms: true, push: true }, true),
      matrixEvent("workflow_escalated", "Workflow escalated", { email: true, sms: true, push: true }, true),
      matrixEvent("automation_failed", "Automation failed", { email: true, sms: true, push: true }, true),
      matrixEvent("vendor_unassigned", "Vendor could not be assigned", { email: true, sms: true, push: true }, true),
    ],
  },
  {
    id: "resident_comms",
    title: "Resident communications",
    description: "Resident posts, opt-outs, and document uploads.",
    events: [
      matrixEvent("resident_posted", "Resident posted update", { email: true, sms: false }),
      matrixEvent("resident_opt_out", "Resident opted out of SMS", { email: true, sms: false }),
      matrixEvent("resident_uploaded", "Resident uploaded documents", { email: true, sms: false }),
    ],
  },
  {
    id: "vendor_comms",
    title: "Vendor communications",
    description: "Vendor responses, declines, and completion evidence.",
    events: [
      matrixEvent("vendor_responded", "Vendor responded", { email: true, sms: false }),
      matrixEvent("vendor_declined", "Vendor declined assignment", { email: true, sms: true }),
      matrixEvent("vendor_photos", "Vendor uploaded completion photos", { email: true, sms: false }),
    ],
  },
]

export function mergeNotificationMatrixCategories(
  saved: MatrixCategory[] | undefined,
): MatrixCategory[] {
  return DEFAULT_NOTIFICATION_MATRIX_CATEGORIES.map((defaultCategory) => {
    const savedCategory = saved?.find((row) => row.id === defaultCategory.id)
    return {
      ...defaultCategory,
      events: defaultCategory.events.map((defaultEvent) => {
        const savedEvent = savedCategory?.events.find((row) => row.id === defaultEvent.id)
        const savedChannels = savedEvent?.channels
        return {
          ...defaultEvent,
          critical: savedEvent?.critical ?? defaultEvent.critical,
          channels: {
            email: typeof savedChannels?.email === "boolean"
              ? savedChannels.email
              : defaultEvent.channels.email,
            sms: typeof savedChannels?.sms === "boolean"
              ? savedChannels.sms
              : defaultEvent.channels.sms,
            activity_feed: typeof savedChannels?.activity_feed === "boolean"
              ? savedChannels.activity_feed
              : defaultEvent.channels.activity_feed,
            push: typeof savedChannels?.push === "boolean"
              ? savedChannels.push
              : defaultEvent.channels.push,
          },
        }
      }),
    }
  })
}
