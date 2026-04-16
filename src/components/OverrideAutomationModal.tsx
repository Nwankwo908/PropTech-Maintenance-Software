import { useEffect, useId, useLayoutEffect, useMemo, useState } from 'react'
import overrideIcon from '@/assets/Override.svg'

export type OverrideAutomationContext = 'default' | 'rent-reminder'

export type AutomationCategoryId = 'maintenance' | 'billing' | 'safety' | 'inspection'

const AUTOMATION_CATEGORIES = [
  {
    id: 'maintenance' as const,
    emoji: '🔧',
    title: 'Maintenance Requests',
    subtitle: 'Override maintenance ticket routing',
  },
  {
    id: 'billing' as const,
    emoji: '💰',
    title: 'Rent & Utilities',
    subtitle: 'Override billing automation rules',
  },
  {
    id: 'safety' as const,
    emoji: '🚨',
    title: 'System Safety Alerts',
    subtitle: 'Override safety monitoring automation',
  },
  {
    id: 'inspection' as const,
    emoji: '📋',
    title: 'Inspection Notices',
    subtitle: 'Override scheduled inspection automation',
  },
] as const

const DEMO_TICKETS = [
  {
    value: 'MNT-AUTO-UPD',
    label:
      'MNT-AUTO-UPD — Maintenance request update notifications (status change · submitter · Email + SMS)',
  },
  { value: 'MNT-482156-A4F2', label: 'MNT-482156-A4F2 — Kitchen leak (Unit 2B)' },
  { value: 'MNT-481923-B7C1', label: 'MNT-481923-B7C1 — HVAC (Unit 5A)' },
  { value: 'MNT-481100-F8D2', label: 'MNT-481100-F8D2 — Electrical (Unit 3C)' },
  { value: 'MNT-480901-A1B2', label: 'MNT-480901-A1B2 — Plumbing (Unit 8D)' },
]

const DEMO_RENT_REMINDER_RUNS = [
  {
    value: 'rr-mar-2025',
    label: 'March 2025 billing — all residents (7 days before due · Email + SMS)',
  },
  {
    value: 'rr-mar-2025-late',
    label: 'March 2025 — late-payment follow-up cohort only',
  },
  {
    value: 'rr-apr-2025',
    label: 'April 2025 billing — scheduled preview run',
  },
] as const

const DEMO_BILLING_AUTOMATIONS = [
  {
    value: 'bil-rent-rem',
    label: 'Monthly rent reminders — 7 days before due · Email + SMS (all residents)',
  },
  { value: 'bil-ach-mar', label: 'ACH rent collection — March cycle' },
  { value: 'bil-late-fee', label: 'Automated late-fee assessment rules' },
  { value: 'bil-inv-batch', label: 'Monthly invoice batch — commercial units' },
]

export const PGE_GAS_LEAK_ADVISORY_AUTOMATION_ID = 'saf-pge-gas-leak' as const

const DEMO_SAFETY_AUTOMATIONS = [
  {
    value: PGE_GAS_LEAK_ADVISORY_AUTOMATION_ID,
    label:
      'PG&E Gas Leak Advisory — San Francisco, CA 94103 (Critical · Mar 25, 2026 2:00 PM)',
  },
  { value: 'saf-fire-test', label: 'Fire system test escalation — Building A' },
  { value: 'saf-water-leak', label: 'Building 4 - Water Pressure Drop' },
  { value: 'saf-co', label: 'CO detector threshold monitoring' },
]

/** Customize Notification Distribution — safety → Override Notification Rules (Figma 117:10408). */
const SAFETY_NOTIF_RECIPIENT_GROUPS = [
  {
    id: 'property-managers' as const,
    emoji: '👔',
    title: 'Property Managers',
    subtitle: 'Alert all property management team members',
    contacts: [
      { name: 'Sarah Johnson', detail: 'General Manager' },
      { name: 'Mike Chen', detail: 'Assistant Manager' },
    ],
  },
  {
    id: 'maintenance' as const,
    emoji: '🔧',
    title: 'Maintenance Team',
    subtitle: 'Alert on-call maintenance personnel',
    contacts: [
      { name: 'James Rodriguez', detail: 'Lead Technician' },
      { name: 'Emily Davis', detail: 'HVAC Specialist' },
      { name: 'Tom Williams', detail: 'Plumbing Specialist' },
    ],
  },
  {
    id: 'resident' as const,
    emoji: '🏠',
    title: 'Resident (Ticket Submitter)',
    subtitle: 'Keep the person who submitted this ticket informed',
    contacts: [{ name: 'Alex Thompson', detail: 'Unit 4B' }],
  },
 
  {
    id: 'emergency' as const,
    emoji: '🚨',
    title: 'Emergency Response Team',
    subtitle: 'Alert emergency services (Fire, Police, Medical)',
    contacts: [],
  },
] as const

type SafetyNotifRecipientId = (typeof SAFETY_NOTIF_RECIPIENT_GROUPS)[number]['id']

const SAFETY_NOTIF_TIMING_OPTIONS = [
  {
    id: 'immediate' as const,
    title: 'Immediate (Real-time)',
    subtitle: 'Send notifications as soon as changes occur',
  },
  {
    id: 'status-change' as const,
    title: 'On Status Change',
    subtitle: 'When ticket moves to a different stage (In Progress, Completed, etc.)',
  },
  {
    id: 'vendor-assign' as const,
    title: 'On Vendor Assignment',
    subtitle: 'When a vendor is assigned or changed',
  },
  {
    id: 'daily-batch' as const,
    title: 'Daily Summary (Batch)',
    subtitle: 'Send one consolidated update per day at 5:00 PM',
  },
  {
    id: 'overdue' as const,
    title: 'When Overdue',
    subtitle: 'Alert if ticket exceeds expected resolution time',
  },
] as const

type SafetyNotifTimingId = (typeof SAFETY_NOTIF_TIMING_OPTIONS)[number]['id']

const SAFETY_NOTIF_METHOD_OPTIONS = [
  { id: 'email' as const, emoji: '📧', title: 'Email', subtitle: 'Send via email' },
  { id: 'sms' as const, emoji: '💬', title: 'SMS/Text', subtitle: 'Send via text message' },
  { id: 'push' as const, emoji: '🔔', title: 'Push Notification', subtitle: 'Mobile app notification' },
  { id: 'phone' as const, emoji: '📞', title: 'Phone Call', subtitle: 'Automated voice call' },
] as const

type SafetyNotifMethodId = (typeof SAFETY_NOTIF_METHOD_OPTIONS)[number]['id']

/** New severity + notifications when safety override is Change Alert Level (Figma 114:8722). */
const SAFETY_ALERT_SEVERITY_OPTIONS = [
  {
    id: 'critical' as const,
    emoji: '🔴',
    title: 'Critical',
    timing: 'Immediate action',
    subtitle: 'Immediate emergency response required',
  },
  {
    id: 'safety-high' as const,
    emoji: '🟠',
    title: 'High',
    timing: 'Within 1 hour',
    subtitle: 'Urgent attention needed',
  },
  {
    id: 'safety-medium' as const,
    emoji: '🟡',
    title: 'Medium',
    timing: 'Within 4 hours',
    subtitle: 'Requires timely response',
  },
  {
    id: 'safety-low' as const,
    emoji: '🟢',
    title: 'Low',
    timing: 'Within 24 hours',
    subtitle: 'Monitor and address when convenient',
  },
] as const

type SafetyAlertSeverityId = (typeof SAFETY_ALERT_SEVERITY_OPTIONS)[number]['id']

const DEMO_INSPECTION_AUTOMATIONS = [
  {
    value: 'insp-72hr',
    label: 'Inspection reminder (72hr notice) — affected unit · Email + SMS',
  },
  { value: 'insp-q1', label: 'Q1 unit inspections — 30-day notices' },
  { value: 'insp-move', label: 'Move-out inspection reminders (rolling)' },
  { value: 'insp-annual', label: 'Annual common-area inspection cadence' },
]

/** Inspection Notices → reschedule panel (Figma 121:12906). */
const INSPECTION_RESCHEDULE_REASON_OPTIONS = [
  { value: 'resident_request', label: 'Resident requested a different time' },
  { value: 'inspector', label: 'Inspector availability changed' },
  { value: 'access', label: 'Building / unit access issue' },
  { value: 'weather', label: 'Weather or safety delay' },
  { value: 'documentation', label: 'Documentation or compliance hold' },
  { value: 'other', label: 'Other' },
] as const

const INSPECTION_TIME_SLOT_OPTIONS = [
  { value: '8-9', label: '8:00 AM – 9:00 AM EST' },
  { value: '9-10', label: '9:00 AM – 10:00 AM EST' },
  { value: '10-11', label: '10:00 AM – 11:00 AM EST' },
  { value: '11-12', label: '11:00 AM – 12:00 PM EST' },
  { value: '13-14', label: '1:00 PM – 2:00 PM EST' },
  { value: '14-15', label: '2:00 PM – 3:00 PM EST' },
  { value: '15-16', label: '3:00 PM – 4:00 PM EST' },
] as const

const INSPECTION_STAFF_AVAILABILITY_SLOTS = [
  {
    id: 's1',
    line: 'Mon, Mar 30 at 8:00 AM',
    staff: 'Mike Johnson',
    availability: 'available' as const,
  },
  {
    id: 's2',
    line: 'Mon, Mar 30 at 2:00 PM',
    staff: 'Sarah Chen',
    availability: 'available' as const,
  },
  {
    id: 's3',
    line: 'Tue, Mar 31 at 10:00 AM',
    staff: 'Mike Johnson',
    availability: 'available' as const,
  },
  {
    id: 's4',
    line: 'Tue, Mar 31 at 3:00 PM',
    staff: 'David Miller',
    availability: 'limited' as const,
  },
] as const

const INSPECTION_NOTIFICATION_PREFS = [
  {
    key: 'sms' as const,
    title: 'Send SMS to Resident',
    subtitle: 'Notify resident immediately about schedule change via text message',
  },
  {
    key: 'email' as const,
    title: 'Send Email Confirmation',
    subtitle: 'Include new appointment details and calendar invite',
  },
  {
    key: 'calendar' as const,
    title: 'Update Calendar Automatically',
    subtitle: 'Sync changes to all connected calendar systems',
  },
  {
    key: 'vendor' as const,
    title: 'Notify Technician/Vendor',
    subtitle: 'Alert assigned staff about the schedule change',
  },
  {
    key: 'resident_confirm' as const,
    title: 'Request Resident Confirmation',
    subtitle: 'Require resident to confirm availability for new time slot',
  },
] as const

type InspectionNotifKey = (typeof INSPECTION_NOTIFICATION_PREFS)[number]['key']

const INSPECTION_NOTIF_PREFS_INITIAL: Record<InspectionNotifKey, boolean> = {
  sms: true,
  email: true,
  calendar: true,
  vendor: true,
  resident_confirm: false,
}

const OVERRIDE_TYPES = [
  {
    id: 'vendor' as const,
    emoji: '👷',
    title: 'Reassign Vendor',
    subtitle: 'Choose different vendor than AI recommendation',
  },
  {
    id: 'priority' as const,
    emoji: '⚡',
    title: 'Change Priority',
    subtitle: 'Adjust urgency level manually',
  },
  {
    id: 'pause' as const,
    emoji: '⏸️',
    title: 'Pause/Disable Automation',
    subtitle: 'Temporarily disable scheduled automation',
  },
] as const

const RENT_OVERRIDE_TYPES = [
  {
    id: 'priority' as const,
    emoji: '⚡',
    title: 'Change audience / urgency',
    subtitle: 'Narrow, expand, or escalate who receives reminders',
  },
  {
    id: 'pause' as const,
    emoji: '⏸️',
    title: 'Pause/Disable Automation',
    subtitle: 'Temporarily stop scheduled rent reminders',
  },
] as const

/** Inspection Notices — Override Type cards (Figma 121:12857). */
const INSPECTION_OVERRIDE_TYPES = [
  {
    id: 'inspection-reschedule' as const,
    emoji: '📅',
    title: 'Reschedule Date',
    subtitle: 'Change inspection date and time',
  },
  {
    id: 'inspection-scope' as const,
    emoji: '📋',
    title: 'Modify Inspection Scope',
    subtitle: 'Add or remove inspection items',
  },
  {
    id: 'inspection-reassign' as const,
    emoji: '👤',
    title: 'Reassign Inspector',
    subtitle: 'Select different inspection personnel',
  },
] as const

/** Modify Inspection Scope — checklist (Figma 122:13783). */
const INSPECTION_SCOPE_ITEMS = [
  {
    id: 'scope-hvac-filter' as const,
    emoji: '❄️',
    title: 'HVAC Filter Condition',
    category: 'HVAC',
    defaultIncluded: true,
  },
  {
    id: 'scope-smoke' as const,
    emoji: '🔥',
    title: 'Smoke Detector Functionality',
    category: 'Safety',
    defaultIncluded: true,
  },
  {
    id: 'scope-water-heater' as const,
    emoji: '💧',
    title: 'Water Heater Inspection',
    category: 'Plumbing',
    defaultIncluded: true,
  },
  {
    id: 'scope-plumbing-fixtures' as const,
    emoji: '🚰',
    title: 'Plumbing Fixtures & Leaks',
    category: 'Plumbing',
    defaultIncluded: true,
  },
  {
    id: 'scope-electrical' as const,
    emoji: '⚡',
    title: 'Electrical Outlets & Switches',
    category: 'Electrical',
    defaultIncluded: false,
  },
  {
    id: 'scope-door-locks' as const,
    emoji: '🔒',
    title: 'Door Locks & Security',
    category: 'Security',
    defaultIncluded: false,
  },
  {
    id: 'scope-windows' as const,
    emoji: '🪟',
    title: 'Window Seals & Operation',
    category: 'Structure',
    defaultIncluded: false,
  },
  {
    id: 'scope-flooring' as const,
    emoji: '🏠',
    title: 'Flooring Condition',
    category: 'Interior',
    defaultIncluded: false,
  },
  {
    id: 'scope-kitchen-app' as const,
    emoji: '🧊',
    title: 'Kitchen Appliances',
    category: 'Appliances',
    defaultIncluded: false,
  },
  {
    id: 'scope-co' as const,
    emoji: '⚠️',
    title: 'Carbon Monoxide Detector',
    category: 'Safety',
    defaultIncluded: false,
  },
] as const

type InspectionScopeCustomItem = {
  id: string
  title: string
  category: string
}

function initialInspectionScopeIncludedIds(): Set<string> {
  return new Set(
    INSPECTION_SCOPE_ITEMS.filter((row) => row.defaultIncluded).map((row) => row.id),
  )
}

/** Reassign Inspector panel (Figma 123:14464). */
const INSPECTION_CURRENT_INSPECTOR = {
  initials: 'MJ',
  name: 'Michael Johnson',
  rating: '4.8',
  inspections: 47,
  avatarClass: 'bg-[#dbeafe] text-[#155dfc]',
} as const

type InspectionInspectorAvailability = 'now' | 'delay' | 'tomorrow'

const INSPECTION_INSPECTOR_CANDIDATES = [
  {
    id: 'insp-cand-sc' as const,
    initials: 'SC',
    name: 'Sarah Chen',
    rating: '4.9',
    specialty: 'General & Safety',
    badges: ['Certified Property Inspector', 'Safety Compliance'] as const,
    inspectionCount: 132,
    avgMin: '45-60',
    availability: 'now' as const,
    avatarClass: 'bg-[#f3e8ff] text-[#9810fa]',
  },
  {
    id: 'insp-cand-dm' as const,
    initials: 'DM',
    name: 'David Martinez',
    rating: '4.7',
    specialty: 'HVAC & Mechanical',
    badges: ['HVAC Certified', 'Mechanical Systems'] as const,
    inspectionCount: 98,
    avgMin: '60-75',
    availability: 'delay' as const,
    avatarClass: 'bg-[#dbeafe] text-[#155dfc]',
  },
  {
    id: 'insp-cand-er' as const,
    initials: 'ER',
    name: 'Emily Rodriguez',
    rating: '4.8',
    specialty: 'Plumbing & Electrical',
    badges: ['Licensed Electrician', 'Plumbing Inspector'] as const,
    inspectionCount: 156,
    avgMin: '50-70',
    availability: 'tomorrow' as const,
    avatarClass: 'bg-[#dcfce7] text-[#00a63e]',
  },
  {
    id: 'insp-cand-jw' as const,
    initials: 'JW',
    name: 'James Wilson',
    rating: '4.6',
    specialty: 'Structural & Exterior',
    badges: ['Structural Inspector', 'Building Code Expert'] as const,
    inspectionCount: 84,
    avgMin: '60-90',
    availability: 'now' as const,
    avatarClass: 'bg-[#fef3c6] text-[#e17100]',
  },
] as const

function inspectionInspectorAvailabilityPill(kind: InspectionInspectorAvailability): {
  label: string
  className: string
} {
  switch (kind) {
    case 'now':
      return { label: 'Available Now', className: 'bg-[#dcfce7] text-[#008236]' }
    case 'delay':
      return { label: 'Available in 2h', className: 'bg-[#fef9c2] text-[#a65f00]' }
    case 'tomorrow':
      return { label: 'Available Tomorrow', className: 'bg-[#f3f4f6] text-[#364153]' }
  }
}

/** Rent & Utilities (billing) — Override Type cards (Figma 112:5843). */
const BILLING_OVERRIDE_TYPES = [
  {
    id: 'adjust-payment-terms' as const,
    emoji: '📅',
    title: 'Adjust Payment Terms',
    subtitle: 'Modify payment schedule or due dates',
  },
  {
    id: 'override-late-fees' as const,
    emoji: '💰',
    title: 'Override Late Fees',
    subtitle: 'Waive or adjust late payment fees',
  },
  {
    id: 'suspend-auto-payments' as const,
    emoji: '⏸️',
    title: 'Suspend Auto-Payments',
    subtitle: 'Pause automated payment processing',
  },
] as const

const BILLING_PAYMENT_FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'one_time', label: 'One-time payment' },
] as const

/** Override Late Fees detail panel (Figma 112:5144). */
const BILLING_LATE_FEE_ADJUSTMENT_OPTIONS = [
  {
    id: 'full-waiver' as const,
    emoji: '🎁',
    title: 'Full Waiver',
    subtitle: 'Completely waive all late fees',
  },
  {
    id: 'partial-waiver' as const,
    emoji: '📉',
    title: 'Partial Waiver',
    subtitle: 'Reduce late fee by percentage or amount',
  },
  {
    id: 'adjust-amount' as const,
    emoji: '✏️',
    title: 'Adjust Amount',
    subtitle: 'Set a new late fee amount',
  },
] as const

type BillingLateFeeAdjustmentId = (typeof BILLING_LATE_FEE_ADJUSTMENT_OPTIONS)[number]['id']

/** Suspend Auto-Payments panel (Figma 113:6577). */
const BILLING_SUSPEND_DURATION_OPTIONS = [
  {
    id: 'one-month' as const,
    emoji: '📅',
    title: 'One Month',
    subtitle: 'Pause for 1 billing cycle',
    meta: '30 days',
  },
  {
    id: 'three-months' as const,
    emoji: '📆',
    title: 'Three Months',
    subtitle: 'Pause for 3 billing cycles',
    meta: '90 days',
  },
  {
    id: 'custom-period' as const,
    emoji: '🗓️',
    title: 'Custom Period',
    subtitle: 'Set specific pause duration',
    meta: 'Specify dates',
  },
  {
    id: 'indefinite' as const,
    emoji: '⏱️',
    title: 'Indefinite',
    subtitle: 'Pause until manually resumed',
    meta: 'No end date',
  },
] as const

type BillingSuspendDurationId = (typeof BILLING_SUSPEND_DURATION_OPTIONS)[number]['id']

/** Override types when category is System Safety Alerts (Figma 113:7991). */
const SAFETY_OVERRIDE_TYPES = [
  {
    id: 'alert-level' as const,
    emoji: '🚨',
    title: 'Change Alert Level',
    subtitle: 'Escalate or reduce alert severity',
  },
  {
    id: 'notification-rules' as const,
    emoji: '📢',
    title: 'Override Notification Rules',
    subtitle: 'Modify who gets notified and when',
  },
  {
    id: 'response-protocol' as const,
    emoji: '⚡',
    title: 'Adjust Response Protocol',
    subtitle: 'Change emergency response procedures',
  },
] as const

/** Adjust Response Protocol panel (Figma 118:11323). */
const RESPONSE_PROTOCOL_OPTIONS = [
  {
    id: 'emergency' as const,
    emoji: '🚨',
    title: 'Emergency Protocol',
    subtitle: 'Life/safety hazards, severe property damage',
    metaSoft: 'Immediate dispatch',
    metaBold: '2-hour response',
  },
  {
    id: 'expedited' as const,
    emoji: '⚡',
    title: 'Expedited Protocol',
    subtitle: 'Urgent but not life-threatening issues',
    metaSoft: 'Priority handling',
    metaBold: '4-hour response',
  },
  {
    id: 'standard' as const,
    emoji: '🔧',
    title: 'Standard Protocol',
    subtitle: 'Routine maintenance and repairs',
    metaSoft: 'Normal processing',
    metaBold: '24-hour response',
  },
  {
    id: 'scheduled' as const,
    emoji: '📅',
    title: 'Scheduled Protocol',
    subtitle: 'Cosmetic issues, preventive maintenance',
    metaSoft: 'Non-urgent',
    metaBold: '3-5 day window',
  },
  {
    id: 'assessment' as const,
    emoji: '🔍',
    title: 'Assessment Required',
    subtitle: 'Complex issues requiring professional assessment',
    metaSoft: 'Evaluation needed',
    metaBold: 'TBD after inspection',
  },
] as const

type SafetyResponseProtocolId = (typeof RESPONSE_PROTOCOL_OPTIONS)[number]['id']

const RESPONSE_PROTOCOL_AUTOMATED_ACTIONS = [
  {
    id: 'assign_oncall' as const,
    title: 'Auto-Assign to On-Call Technician',
    subtitle: 'Immediately dispatch available maintenance staff',
  },
  {
    id: 'notify_resident' as const,
    title: 'Send Immediate Notification to Resident',
    subtitle: 'Confirm receipt and provide response timeline',
  },
  {
    id: 'vendor_quotes' as const,
    title: 'Request Vendor Quotes Automatically',
    subtitle: 'Send RFQ to pre-approved vendors for estimates',
  },
  {
    id: 'followup_insp' as const,
    title: 'Schedule Follow-Up Inspection',
    subtitle: 'Automatically book quality check after completion',
  },
  {
    id: 'photo_doc' as const,
    title: 'Require Photo Documentation',
    subtitle: 'Mandate before/after photos for work verification',
  },
] as const

type SafetyProtocolAutomatedId = (typeof RESPONSE_PROTOCOL_AUTOMATED_ACTIONS)[number]['id']

const RESPONSE_PROTOCOL_BUDGET_OPTIONS = [
  { value: 'site', label: 'Site manager — up to $2,500' },
  { value: 'regional', label: 'Regional director — up to $10,000' },
  { value: 'vp', label: 'VP operations — escalated cap' },
] as const

const RESPONSE_PROTOCOL_QUEUE_OPTIONS = [
  { value: 'standard', label: 'Standard priority queue' },
  { value: 'elevated', label: 'Elevated / next available' },
  { value: 'emergency', label: 'Emergency reserve lane' },
] as const

const RESPONSE_PROTOCOL_STAFFING_OPTIONS = [
  { value: 'primary', label: 'Primary on-call rotation' },
  { value: 'full', label: 'Full on-call pool' },
  { value: 'external', label: 'External vendor augmentation' },
] as const

/** New priority when override type is "Change Priority" (Figma 110:4072). */
const PRIORITY_LEVELS = [
  {
    id: 'emergency' as const,
    emoji: '🚨',
    title: 'Emergency',
    subtitle: 'Immediate response',
  },
  {
    id: 'high' as const,
    emoji: '⚠️',
    title: 'High',
    subtitle: 'Within 4 hours',
  },
  {
    id: 'medium' as const,
    emoji: '📋',
    title: 'Medium',
    subtitle: 'Within 24 hours',
  },
  {
    id: 'low' as const,
    emoji: '✅',
    title: 'Low',
    subtitle: 'Within 3 days',
  },
] as const

type NewPriorityLevelId = (typeof PRIORITY_LEVELS)[number]['id']

/** Sub-actions under rent reminder → Pause/Disable (Figma 87:10152). */
type RentAutomationAction = 'pause_temp' | 'disable' | 'modify'

const RENT_PAUSE_DURATION_OPTIONS = [
  { value: '24h', label: '24 hours' },
  { value: '3d', label: '3 days' },
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' },
] as const

const RENT_NEW_TRIGGER_OPTIONS = [
  { value: '3d', label: '3 days before due date' },
  { value: '5d', label: '5 days before due date' },
  { value: '7d', label: '7 days before due date (default)' },
  { value: '10d', label: '10 days before due date' },
  { value: 'on_due', label: 'On due date' },
] as const

type MaintenanceOverrideId = (typeof OVERRIDE_TYPES)[number]['id']
type RentOverrideId = (typeof RENT_OVERRIDE_TYPES)[number]['id']
type BillingOverrideTypeId = (typeof BILLING_OVERRIDE_TYPES)[number]['id']
export type SafetyOverrideTypeId = (typeof SAFETY_OVERRIDE_TYPES)[number]['id']
type InspectionOverrideTypeId = (typeof INSPECTION_OVERRIDE_TYPES)[number]['id']
type OverrideTypeId =
  | MaintenanceOverrideId
  | RentOverrideId
  | BillingOverrideTypeId
  | SafetyOverrideTypeId
  | InspectionOverrideTypeId

type VendorTradeCategory = 'plumbing' | 'electrical' | 'general' | 'hvac'

type VendorRow = {
  id: string
  name: string
  rating: string
  metaLine: string
  category: VendorTradeCategory
  status: 'now' | 'scheduled'
  statusLabel: string
}

const VENDOR_CATEGORY_FILTER_OPTIONS: { value: 'all' | VendorTradeCategory; label: string }[] = [
  { value: 'all', label: 'All categories' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'general', label: 'General' },
]

const VENDORS: VendorRow[] = [
  {
    id: 'v1',
    name: 'Quick Fix Plumbing',
    rating: '4.8',
    metaLine: 'Plumbing • $$ • Avg: 2-4 hours',
    category: 'plumbing',
    status: 'now',
    statusLabel: 'Available Now',
  },
  {
    id: 'v2',
    name: 'Elite Electrical',
    rating: '4.9',
    metaLine: 'Electrical • $$$ • Avg: 1-3 hours',
    category: 'electrical',
    status: 'scheduled',
    statusLabel: 'Available in 3h',
  },
  {
    id: 'v3',
    name: 'General Maintenance Co',
    rating: '4.5',
    metaLine: 'General • $ • Avg: 4-8 hours',
    category: 'general',
    status: 'scheduled',
    statusLabel: 'Available Tomorrow',
  },
  {
    id: 'v4',
    name: 'Premium HVAC Services',
    rating: '4.7',
    metaLine: 'HVAC • $$$ • Avg: 2-6 hours',
    category: 'hvac',
    status: 'now',
    statusLabel: 'Available Now',
  },
]

function defaultPauseAutomationTitle(category: AutomationCategoryId): string {
  switch (category) {
    case 'maintenance':
      return 'Maintenance ticket routing'
    case 'billing':
      return 'Billing automation'
    case 'safety':
      return 'Safety monitoring automation'
    case 'inspection':
      return 'Inspection notice automation'
  }
}

type PauseDisableOverrideActionsPanelProps = {
  showAutomationControlHeader?: boolean
  currentAutomationName: string
  rentAutomationAction: RentAutomationAction | null
  setRentAutomationAction: (action: RentAutomationAction) => void
  pauseDuration: string
  setPauseDuration: (v: string) => void
  resumeOn: string
  setResumeOn: (v: string) => void
  newTriggerTiming: string
  setNewTriggerTiming: (v: string) => void
  pauseDurationId: string
  resumeOnId: string
  newTriggerId: string
}

function PauseDisableOverrideActionsPanel({
  showAutomationControlHeader = false,
  currentAutomationName,
  rentAutomationAction,
  setRentAutomationAction,
  pauseDuration,
  setPauseDuration,
  resumeOn,
  setResumeOn,
  newTriggerTiming,
  setNewTriggerTiming,
  pauseDurationId,
  resumeOnId,
  newTriggerId,
}: PauseDisableOverrideActionsPanelProps) {
  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
      {showAutomationControlHeader ? (
        <div className="flex items-center gap-2">
          <svg
            className="size-4 shrink-0 text-[#6a7282]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
          <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
            Automation Control
          </h3>
        </div>
      ) : null}
      <div className="flex flex-col rounded-[10px] border border-[#bedbff] bg-[#eff6ff] px-[13px] py-3">
        <div className="flex gap-2">
          <svg
            className="mt-0.5 size-4 shrink-0 text-[#1447e6]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" strokeLinecap="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <div className="min-w-0 space-y-1">
            <p className="text-[12px] font-semibold leading-4 text-[#1447e6]">
              Current Automation: {currentAutomationName}
            </p>
            <p className="text-[12px] leading-4 text-[#1447e6]">
              This scheduled automation is currently active and will continue running until paused or disabled.
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
          Override Action <span className="text-[#c10007]">*</span>
        </p>
        <div className="flex flex-col gap-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setRentAutomationAction('pause_temp')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setRentAutomationAction('pause_temp')
              }
            }}
            className={[
              'w-full cursor-pointer rounded-[10px] border-2 p-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
              rentAutomationAction === 'pause_temp'
                ? 'border-[#fe9a00] bg-[#fffbeb]'
                : 'border-[#e5e7eb] bg-white',
            ].join(' ')}
          >
            <div className="flex gap-3">
              <RentAutomationRadio on={rentAutomationAction === 'pause_temp'} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                  <span className="text-[18px] leading-7" aria-hidden>
                    ⏸️
                  </span>
                  Pause Temporarily
                </p>
                <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">
                  Stop automation for a specific time period
                </p>
                <div
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor={pauseDurationId}
                      className="block text-[12px] font-medium leading-4 text-[#4a5565]"
                    >
                      Pause Duration
                    </label>
                    <div className="relative">
                      <select
                        id={pauseDurationId}
                        value={pauseDuration}
                        onChange={(e) => setPauseDuration(e.target.value)}
                        disabled={rentAutomationAction !== 'pause_temp'}
                        className="h-9 w-full appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[12px] font-medium text-[#0a0a0a] outline-none disabled:cursor-not-allowed disabled:opacity-60 focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                      >
                        <option value="">Select...</option>
                        {RENT_PAUSE_DURATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={resumeOnId}
                      className="block text-[12px] font-medium leading-4 text-[#4a5565]"
                    >
                      Resume On
                    </label>
                    <input
                      id={resumeOnId}
                      type="date"
                      value={resumeOn}
                      onChange={(e) => setResumeOn(e.target.value)}
                      disabled={rentAutomationAction !== 'pause_temp'}
                      className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[12px] font-medium text-[#0a0a0a] outline-none disabled:cursor-not-allowed disabled:opacity-60 focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setRentAutomationAction('disable')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setRentAutomationAction('disable')
              }
            }}
            className={[
              'w-full cursor-pointer rounded-[10px] border-2 p-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
              rentAutomationAction === 'disable'
                ? 'border-[#fe9a00] bg-[#fffbeb]'
                : 'border-[#e5e7eb] bg-white',
            ].join(' ')}
          >
            <div className="flex gap-3">
              <RentAutomationRadio on={rentAutomationAction === 'disable'} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                  <span className="text-[18px] leading-7" aria-hidden>
                    🛑
                  </span>
                  Disable Permanently
                </p>
                <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">
                  Completely disable this automation (requires manager approval)
                </p>
                <div className="mt-3 flex gap-2 rounded border border-[#ffc9c9] bg-[#fef2f2] px-2 py-2">
                  <svg
                    className="mt-0.5 size-3 shrink-0 text-[#c10007]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                  </svg>
                  <p className="text-[12px] leading-4 text-[#c10007]">
                    This action cannot be undone easily. Disabled automations must be reactivated through system
                    settings.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setRentAutomationAction('modify')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setRentAutomationAction('modify')
              }
            }}
            className={[
              'w-full cursor-pointer rounded-[10px] border-2 p-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
              rentAutomationAction === 'modify'
                ? 'border-[#fe9a00] bg-[#fffbeb]'
                : 'border-[#e5e7eb] bg-white',
            ].join(' ')}
          >
            <div className="flex gap-3">
              <RentAutomationRadio on={rentAutomationAction === 'modify'} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                  <span className="text-[18px] leading-7" aria-hidden>
                    ✏️
                  </span>
                  Modify Schedule
                </p>
                <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">
                  Change trigger timing or conditions
                </p>
                <div
                  className="mt-3 space-y-1"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <label
                    htmlFor={newTriggerId}
                    className="block text-[12px] font-medium leading-4 text-[#4a5565]"
                  >
                    New Trigger Timing
                  </label>
                  <div className="relative">
                    <select
                      id={newTriggerId}
                      value={newTriggerTiming}
                      onChange={(e) => setNewTriggerTiming(e.target.value)}
                      disabled={rentAutomationAction !== 'modify'}
                      className="h-9 w-full appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[12px] font-medium text-[#0a0a0a] outline-none disabled:cursor-not-allowed disabled:opacity-60 focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                    >
                      <option value="">Select timing...</option>
                      {RENT_NEW_TRIGGER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export type OverrideAutomationPresentation = 'modal' | 'rail'

export function OverrideAutomationModal({
  open,
  onClose,
  context = 'default',
  initialAutomationCategory,
  initialTicketId: initialTicketIdProp,
  initialSafetyOverrideType,
  presentation = 'modal',
}: {
  open: boolean
  onClose: () => void
  context?: OverrideAutomationContext
  /** When opening from a deep link (e.g. Monthly Rent Reminder override), pre-select category. */
  initialAutomationCategory?: AutomationCategoryId
  /** Pre-select scope row (`billing` → DEMO_BILLING_AUTOMATIONS value, etc.). */
  initialTicketId?: string
  /** When category is safety (e.g. Schedule from emergency alert), pre-select override type (Figma 117:10370). */
  initialSafetyOverrideType?: SafetyOverrideTypeId
  /** `rail` = full-height panel from the right; `modal` = centered dialog. */
  presentation?: OverrideAutomationPresentation
}) {
  const titleId = useId()
  const scopeFieldId = useId()
  const audienceScopeId = useId()
  const urgencyToneId = useId()
  const rentPauseDurationId = useId()
  const rentResumeOnId = useId()
  const rentNewTriggerId = useId()
  const categoryGroupId = useId()
  const newPriorityGroupId = useId()
  const defaultPauseDurationId = useId()
  const defaultResumeOnId = useId()
  const defaultNewTriggerId = useId()
  const vendorSearchInputId = useId()
  const vendorFilterSelectId = useId()
  const safetyNewSeverityGroupId = useId()
  const safetyNotifyResidentsId = useId()
  const safetyNotifyMaintenanceId = useId()
  const safetyNotifyPropertyId = useId()
  const safetyNotifTimingGroupId = useId()
  const safetyNotifEscalateAfterId = useId()
  const safetyResponseProtocolGroupId = useId()
  const safetyProtocolBudgetId = useId()
  const safetyProtocolQueueId = useId()
  const safetyProtocolStaffingId = useId()
  const safetyProtocolJustificationId = useId()
  const billingDueDateId = useId()
  const billingAmountId = useId()
  const billingFrequencyId = useId()
  const billingModNotesId = useId()
  const billingLateFeeAdjGroupId = useId()
  const billingNewLateFeeAmountId = useId()
  const billingSuspendDurationGroupId = useId()
  const billingSuspendPauseStartId = useId()
  const billingSuspendResumeId = useId()
  const billingSuspendNotifyEmailId = useId()
  const billingSuspendNotifySmsId = useId()
  const inspectionRescheduleReasonId = useId()
  const inspectionNewDateId = useId()
  const inspectionTimeSlotId = useId()
  const inspectionNotifGroupId = useId()
  const inspectionScopeCustomItemId = useId()
  const inspectionScopeItemsGroupId = useId()
  const inspectionNewInspectorGroupId = useId()
  const [automationCategory, setAutomationCategory] =
    useState<AutomationCategoryId>('maintenance')
  const [ticketId, setTicketId] = useState('')
  const [overrideType, setOverrideType] = useState<OverrideTypeId>('vendor')
  const [newPriorityLevel, setNewPriorityLevel] = useState<'' | NewPriorityLevelId>('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [audienceScope, setAudienceScope] = useState('')
  const [urgencyTone, setUrgencyTone] = useState('')
  const [rentAutomationAction, setRentAutomationAction] =
    useState<RentAutomationAction | null>(null)
  const [pauseDuration, setPauseDuration] = useState('')
  const [resumeOn, setResumeOn] = useState('')
  const [newTriggerTiming, setNewTriggerTiming] = useState('')
  const [vendorSearchQuery, setVendorSearchQuery] = useState('')
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState<
    'all' | VendorTradeCategory
  >('all')
  const [safetyNewSeverity, setSafetyNewSeverity] = useState<'' | SafetyAlertSeverityId>('')
  const [safetyNotifyResidents, setSafetyNotifyResidents] = useState(false)
  const [safetyNotifyMaintenance, setSafetyNotifyMaintenance] = useState(false)
  const [safetyNotifyPropertyMgmt, setSafetyNotifyPropertyMgmt] = useState(false)
  const [safetyNotifRecipients, setSafetyNotifRecipients] = useState<
    Partial<Record<SafetyNotifRecipientId, boolean>>
  >({ resident: true })
  const [safetyNotifTiming, setSafetyNotifTiming] = useState<'' | SafetyNotifTimingId>('')
  const [safetyNotifMethods, setSafetyNotifMethods] = useState<
    Partial<Record<SafetyNotifMethodId, boolean>>
  >({})
  const [safetyNotifAutoEscalation, setSafetyNotifAutoEscalation] = useState(false)
  const [safetyNotifEscalateAfter, setSafetyNotifEscalateAfter] = useState('')
  const [safetyNewResponseProtocol, setSafetyNewResponseProtocol] = useState<
    SafetyResponseProtocolId | ''
  >('standard')
  const [safetyProtocolAutomated, setSafetyProtocolAutomated] = useState<
    Partial<Record<SafetyProtocolAutomatedId, boolean>>
  >({})
  const [safetyProtocolBudget, setSafetyProtocolBudget] = useState('')
  const [safetyProtocolQueue, setSafetyProtocolQueue] = useState('')
  const [safetyProtocolStaffing, setSafetyProtocolStaffing] = useState('')
  const [safetyProtocolBypassSla, setSafetyProtocolBypassSla] = useState(false)
  const [safetyProtocolJustification, setSafetyProtocolJustification] = useState('')
  const [billingNewDueDate, setBillingNewDueDate] = useState('')
  const [billingPaymentAmount, setBillingPaymentAmount] = useState('')
  const [billingPaymentFrequency, setBillingPaymentFrequency] = useState('')
  const [billingModificationNotes, setBillingModificationNotes] = useState('')
  const [billingLateFeeAdjustmentType, setBillingLateFeeAdjustmentType] = useState<
    '' | BillingLateFeeAdjustmentId
  >('')
  const [billingNewLateFeeAmount, setBillingNewLateFeeAmount] = useState('')
  const [billingSuspendDuration, setBillingSuspendDuration] = useState<'' | BillingSuspendDurationId>(
    '',
  )
  const [billingSuspendPauseStart, setBillingSuspendPauseStart] = useState('')
  const [billingSuspendResumeDate, setBillingSuspendResumeDate] = useState('')
  const [billingSuspendNotifyEmail, setBillingSuspendNotifyEmail] = useState(false)
  const [billingSuspendNotifySms, setBillingSuspendNotifySms] = useState(false)
  const [inspectionRescheduleReason, setInspectionRescheduleReason] = useState('')
  const [inspectionNewDate, setInspectionNewDate] = useState('')
  const [inspectionTimeSlot, setInspectionTimeSlot] = useState('')
  const [inspectionNotifPrefs, setInspectionNotifPrefs] =
    useState<Record<InspectionNotifKey, boolean>>(INSPECTION_NOTIF_PREFS_INITIAL)
  const [inspectionScopeIncluded, setInspectionScopeIncluded] = useState(
    () => initialInspectionScopeIncludedIds(),
  )
  const [inspectionScopeCustomItems, setInspectionScopeCustomItems] = useState<
    InspectionScopeCustomItem[]
  >([])
  const [inspectionScopeCustomInput, setInspectionScopeCustomInput] = useState('')
  const [inspectionNewInspectorId, setInspectionNewInspectorId] = useState<string | null>(
    null,
  )

  const isRentReminder = context === 'rent-reminder'
  const isMaintenanceCategory =
    !isRentReminder && automationCategory === 'maintenance'
  const overrideTypeOptions = isRentReminder
    ? RENT_OVERRIDE_TYPES
    : automationCategory === 'safety'
      ? SAFETY_OVERRIDE_TYPES
      : automationCategory === 'billing'
        ? BILLING_OVERRIDE_TYPES
        : automationCategory === 'inspection'
          ? INSPECTION_OVERRIDE_TYPES
          : automationCategory === 'maintenance'
            ? OVERRIDE_TYPES
            : OVERRIDE_TYPES.filter((t) => t.id !== 'vendor')

  const scopeFieldLabel = isRentReminder
    ? 'Select rent reminder run'
    : automationCategory === 'maintenance'
      ? 'Select Maintenance Request'
      : automationCategory === 'billing'
        ? 'Select Billing Automation'
        : automationCategory === 'safety'
          ? 'Select Safety Alert'
          : 'Select Inspection Notice'

  const scopePlaceholder = isRentReminder
    ? 'Choose a reminder cycle to override...'
    : automationCategory === 'maintenance'
      ? 'Choose a ticket to override...'
      : automationCategory === 'billing'
        ? 'Choose a billing automation to override...'
        : automationCategory === 'safety'
          ? 'Choose an alert to override...'
          : 'Choose an inspection automation to override...'

  const scopeOptions = isRentReminder
    ? DEMO_RENT_REMINDER_RUNS
    : automationCategory === 'maintenance'
      ? DEMO_TICKETS
      : automationCategory === 'billing'
        ? DEMO_BILLING_AUTOMATIONS
        : automationCategory === 'safety'
          ? DEMO_SAFETY_AUTOMATIONS
          : DEMO_INSPECTION_AUTOMATIONS

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useLayoutEffect(() => {
    if (!open) {
      setAutomationCategory('maintenance')
      setTicketId('')
      setVendorId(null)
      setPassword('')
      setAudienceScope('')
      setUrgencyTone('')
      setRentAutomationAction(null)
      setPauseDuration('')
      setResumeOn('')
      setNewTriggerTiming('')
      setNewPriorityLevel('')
      setVendorSearchQuery('')
      setVendorCategoryFilter('all')
      setSafetyNewSeverity('')
      setSafetyNotifyResidents(false)
      setSafetyNotifyMaintenance(false)
      setSafetyNotifyPropertyMgmt(false)
      setSafetyNotifRecipients({ resident: true })
      setSafetyNotifTiming('')
      setSafetyNotifMethods({})
      setSafetyNotifAutoEscalation(false)
      setSafetyNotifEscalateAfter('')
      setSafetyNewResponseProtocol('standard')
      setSafetyProtocolAutomated({})
      setSafetyProtocolBudget('')
      setSafetyProtocolQueue('')
      setSafetyProtocolStaffing('')
      setSafetyProtocolBypassSla(false)
      setSafetyProtocolJustification('')
      setBillingNewDueDate('')
      setBillingPaymentAmount('')
      setBillingPaymentFrequency('')
      setBillingModificationNotes('')
      setBillingLateFeeAdjustmentType('')
      setBillingNewLateFeeAmount('')
      setBillingSuspendDuration('')
      setBillingSuspendPauseStart('')
      setBillingSuspendResumeDate('')
      setBillingSuspendNotifyEmail(false)
      setBillingSuspendNotifySms(false)
      setInspectionRescheduleReason('')
      setInspectionNewDate('')
      setInspectionTimeSlot('')
      setInspectionNotifPrefs(INSPECTION_NOTIF_PREFS_INITIAL)
      setInspectionScopeIncluded(initialInspectionScopeIncludedIds())
      setInspectionScopeCustomItems([])
      setInspectionScopeCustomInput('')
      setInspectionNewInspectorId(null)
      setOverrideType('vendor')
      return
    }
    const nextCategory = isRentReminder
      ? 'maintenance'
      : (initialAutomationCategory ?? 'maintenance')
    const nextTicketId = initialTicketIdProp ?? ''
    setAutomationCategory(nextCategory)
    setTicketId(nextTicketId)
    setVendorId(null)
    setPassword('')
    setAudienceScope('')
    setUrgencyTone('')
    setRentAutomationAction(null)
    setPauseDuration('')
    setResumeOn('')
    setNewTriggerTiming('')
    setNewPriorityLevel('')
    setVendorSearchQuery('')
    setVendorCategoryFilter('all')
    setSafetyNewSeverity('')
    setSafetyNotifyResidents(false)
    setSafetyNotifyMaintenance(false)
    setSafetyNotifyPropertyMgmt(false)
    setSafetyNotifRecipients({ resident: true })
    setSafetyNotifTiming('')
    setSafetyNotifMethods({})
    setSafetyNotifAutoEscalation(false)
    setSafetyNotifEscalateAfter('')
    setSafetyNewResponseProtocol('standard')
    setSafetyProtocolAutomated({})
    setSafetyProtocolBudget('')
    setSafetyProtocolQueue('')
    setSafetyProtocolStaffing('')
    setSafetyProtocolBypassSla(false)
    setSafetyProtocolJustification('')
    setBillingNewDueDate('')
    setBillingPaymentAmount('')
    setBillingPaymentFrequency('')
    setBillingModificationNotes('')
    setBillingLateFeeAdjustmentType('')
    setBillingNewLateFeeAmount('')
    setBillingSuspendDuration('')
    setBillingSuspendPauseStart('')
    setBillingSuspendResumeDate('')
    setBillingSuspendNotifyEmail(false)
    setBillingSuspendNotifySms(false)
    setInspectionRescheduleReason('')
    setInspectionNewDate('')
    setInspectionTimeSlot('')
    setInspectionNotifPrefs(INSPECTION_NOTIF_PREFS_INITIAL)
    setInspectionScopeIncluded(initialInspectionScopeIncludedIds())
    setInspectionScopeCustomItems([])
    setInspectionScopeCustomInput('')
    setInspectionNewInspectorId(null)
    if (isRentReminder) {
      setOverrideType('priority')
    } else if (nextCategory === 'billing') {
      setOverrideType('adjust-payment-terms')
    } else if (nextCategory === 'safety') {
      setOverrideType(initialSafetyOverrideType ?? 'alert-level')
    } else if (nextCategory === 'inspection') {
      setOverrideType('inspection-reschedule')
    } else {
      setOverrideType('vendor')
    }
    if (nextCategory === 'safety' && initialSafetyOverrideType === 'notification-rules') {
      setSafetyNotifMethods({ push: true })
      setSafetyNotifTiming('immediate')
    }
  }, [open, isRentReminder, initialAutomationCategory, initialTicketIdProp, initialSafetyOverrideType])

  const filteredVendors = useMemo(() => {
    let list = VENDORS
    if (vendorCategoryFilter !== 'all') {
      list = list.filter((v) => v.category === vendorCategoryFilter)
    }
    const q = vendorSearchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) || v.metaLine.toLowerCase().includes(q),
      )
    }
    return list
  }, [vendorSearchQuery, vendorCategoryFilter])

  useEffect(() => {
    if (!open || vendorId == null) return
    if (!filteredVendors.some((v) => v.id === vendorId)) {
      setVendorId(null)
    }
  }, [open, vendorId, filteredVendors])

  useEffect(() => {
    if (isRentReminder) return
    if (automationCategory === 'maintenance') {
      setOverrideType('vendor')
    } else if (automationCategory === 'billing') {
      setOverrideType('adjust-payment-terms')
    } else if (automationCategory === 'inspection') {
      setOverrideType('inspection-reschedule')
    } else if (automationCategory === 'safety') {
      setOverrideType((prev) =>
        SAFETY_OVERRIDE_TYPES.some((t) => t.id === prev) ? prev : 'alert-level',
      )
    } else {
      setOverrideType('priority')
    }
  }, [automationCategory, isRentReminder])

  useEffect(() => {
    if (overrideType !== 'vendor') setVendorId(null)
  }, [overrideType])

  useEffect(() => {
    if (isRentReminder || overrideType !== 'priority') setNewPriorityLevel('')
  }, [overrideType, isRentReminder])

  useEffect(() => {
    if (rentAutomationAction !== 'pause_temp') {
      setPauseDuration('')
      setResumeOn('')
    }
    if (rentAutomationAction !== 'modify') setNewTriggerTiming('')
  }, [rentAutomationAction])

  useEffect(() => {
    if (overrideType !== 'pause') {
      setRentAutomationAction(null)
      setPauseDuration('')
      setResumeOn('')
      setNewTriggerTiming('')
    }
  }, [overrideType])

  useEffect(() => {
    if (
      isRentReminder ||
      automationCategory !== 'safety' ||
      overrideType !== 'alert-level'
    ) {
      setSafetyNewSeverity('')
      setSafetyNotifyResidents(false)
      setSafetyNotifyMaintenance(false)
      setSafetyNotifyPropertyMgmt(false)
    }
  }, [isRentReminder, automationCategory, overrideType])

  useEffect(() => {
    if (
      isRentReminder ||
      automationCategory !== 'safety' ||
      overrideType !== 'notification-rules'
    ) {
      setSafetyNotifRecipients({ resident: true })
      setSafetyNotifTiming('')
      setSafetyNotifMethods({})
      setSafetyNotifAutoEscalation(false)
      setSafetyNotifEscalateAfter('')
    }
  }, [isRentReminder, automationCategory, overrideType])

  useEffect(() => {
    if (
      isRentReminder ||
      automationCategory !== 'safety' ||
      overrideType !== 'response-protocol'
    ) {
      setSafetyNewResponseProtocol('standard')
      setSafetyProtocolAutomated({})
      setSafetyProtocolBudget('')
      setSafetyProtocolQueue('')
      setSafetyProtocolStaffing('')
      setSafetyProtocolBypassSla(false)
      setSafetyProtocolJustification('')
    }
  }, [isRentReminder, automationCategory, overrideType])

  useEffect(() => {
    if (isRentReminder || automationCategory !== 'billing' || overrideType !== 'adjust-payment-terms') {
      setBillingNewDueDate('')
      setBillingPaymentAmount('')
      setBillingPaymentFrequency('')
      setBillingModificationNotes('')
    }
    if (isRentReminder || automationCategory !== 'billing' || overrideType !== 'override-late-fees') {
      setBillingLateFeeAdjustmentType('')
      setBillingNewLateFeeAmount('')
    }
  }, [isRentReminder, automationCategory, overrideType])

  useEffect(() => {
    if (isRentReminder || automationCategory !== 'billing' || overrideType !== 'suspend-auto-payments') {
      setBillingSuspendDuration('')
      setBillingSuspendPauseStart('')
      setBillingSuspendResumeDate('')
      setBillingSuspendNotifyEmail(false)
      setBillingSuspendNotifySms(false)
      return
    }
    setBillingSuspendDuration((d) => d || 'custom-period')
  }, [isRentReminder, automationCategory, overrideType])

  useEffect(() => {
    if (
      isRentReminder ||
      automationCategory !== 'inspection' ||
      overrideType !== 'inspection-reschedule'
    ) {
      setInspectionRescheduleReason('')
      setInspectionNewDate('')
      setInspectionTimeSlot('')
      setInspectionNotifPrefs(INSPECTION_NOTIF_PREFS_INITIAL)
    }
  }, [isRentReminder, automationCategory, overrideType])

  useEffect(() => {
    if (
      isRentReminder ||
      automationCategory !== 'inspection' ||
      overrideType !== 'inspection-scope'
    ) {
      setInspectionScopeIncluded(initialInspectionScopeIncludedIds())
      setInspectionScopeCustomItems([])
      setInspectionScopeCustomInput('')
    }
  }, [isRentReminder, automationCategory, overrideType])

  useEffect(() => {
    if (
      isRentReminder ||
      automationCategory !== 'inspection' ||
      overrideType !== 'inspection-reassign'
    ) {
      setInspectionNewInspectorId(null)
    }
  }, [isRentReminder, automationCategory, overrideType])

  if (!open) return null

  const isRail = presentation === 'rail'

  const isBillingCategory = !isRentReminder && automationCategory === 'billing'
  const isInspectionCategory = !isRentReminder && automationCategory === 'inspection'
  const showInspectionReschedulePanel =
    isInspectionCategory && overrideType === 'inspection-reschedule'
  const showInspectionScopePanel =
    isInspectionCategory && overrideType === 'inspection-scope'
  const showInspectionReassignPanel =
    isInspectionCategory && overrideType === 'inspection-reassign'

  const needsVendor = isMaintenanceCategory && overrideType === 'vendor'
  const showRentAudienceUrgency =
    isRentReminder && overrideType === 'priority'
  const showRentAutomationControl =
    isRentReminder && overrideType === 'pause'
  const rentAudienceUrgencyValid =
    Boolean(audienceScope) && Boolean(urgencyTone)
  const rentAutomationValid =
    rentAutomationAction != null &&
    (rentAutomationAction === 'pause_temp'
      ? Boolean(pauseDuration) && Boolean(resumeOn)
      : rentAutomationAction === 'disable'
        ? true
        : Boolean(newTriggerTiming))

  const rentFlowValid = showRentAudienceUrgency
    ? rentAudienceUrgencyValid
    : showRentAutomationControl
      ? rentAutomationValid
      : false

  const needsNewPriority =
    !isRentReminder && overrideType === 'priority' && automationCategory !== 'inspection'

  const needsDefaultPausePanel =
    !isRentReminder && overrideType === 'pause' && automationCategory !== 'inspection'

  const defaultPauseAutomationValid =
    rentAutomationAction != null &&
    (rentAutomationAction === 'pause_temp'
      ? Boolean(pauseDuration) && Boolean(resumeOn)
      : rentAutomationAction === 'disable'
        ? true
        : Boolean(newTriggerTiming))

  const isSafetyCategory = !isRentReminder && automationCategory === 'safety'
  const showSafetyAlertSeverityPanel =
    isSafetyCategory && overrideType === 'alert-level'

  const showNotificationRulesPanel =
    isSafetyCategory && overrideType === 'notification-rules'

  const showResponseProtocolPanel =
    isSafetyCategory && overrideType === 'response-protocol'

  const showBillingPaymentSchedulePanel =
    isBillingCategory && overrideType === 'adjust-payment-terms'

  const showBillingLateFeesPanel =
    isBillingCategory && overrideType === 'override-late-fees'

  const showBillingSuspendAutoPayPanel =
    isBillingCategory && overrideType === 'suspend-auto-payments'

  const billingPaymentScheduleFormValid =
    Boolean(billingNewDueDate.trim()) &&
    billingPaymentAmount.trim().length > 0 &&
    Boolean(billingPaymentFrequency)

  const billingLateFeeFormValid =
    Boolean(billingLateFeeAdjustmentType) &&
    (billingLateFeeAdjustmentType === 'full-waiver' ||
      billingNewLateFeeAmount.trim().length > 0)

  const billingSuspendFormValid =
    Boolean(billingSuspendDuration) &&
    (billingSuspendDuration !== 'custom-period' ||
      (Boolean(billingSuspendPauseStart.trim()) &&
        Boolean(billingSuspendResumeDate.trim())))

  const billingCategoryFlowValid =
    showBillingPaymentSchedulePanel
      ? billingPaymentScheduleFormValid
      : showBillingLateFeesPanel
        ? billingLateFeeFormValid
        : showBillingSuspendAutoPayPanel
          ? billingSuspendFormValid
          : isBillingCategory

  const responseProtocolFormValid =
    Boolean(safetyNewResponseProtocol) &&
    Boolean(safetyProtocolBudget) &&
    Boolean(safetyProtocolQueue) &&
    Boolean(safetyProtocolStaffing) &&
    safetyProtocolJustification.trim().length > 0

  const safetyNotifRecipientsValid = SAFETY_NOTIF_RECIPIENT_GROUPS.some(
    (g) => safetyNotifRecipients[g.id],
  )
  const safetyNotifMethodsValid = SAFETY_NOTIF_METHOD_OPTIONS.some(
    (m) => safetyNotifMethods[m.id],
  )
  const safetyNotifEscalationValid =
    !safetyNotifAutoEscalation || safetyNotifEscalateAfter.trim().length > 0
  const notificationRulesFormValid =
    safetyNotifRecipientsValid &&
    Boolean(safetyNotifTiming) &&
    safetyNotifMethodsValid &&
    safetyNotifEscalationValid

  const safetyNotifyValid =
    safetyNotifyResidents ||
    safetyNotifyMaintenance ||
    safetyNotifyPropertyMgmt

  const safetyAlertSeverityFormValid =
    Boolean(safetyNewSeverity) && safetyNotifyValid

  const currentSafetyAlertSummary =
    ticketId && isSafetyCategory
      ? (() => {
          const opt = DEMO_SAFETY_AUTOMATIONS.find((o) => o.value === ticketId)
          if (!opt) return null
          return {
            title: opt.label,
            detected: 'Detected 2 hours ago',
            levelLabel: 'High',
          }
        })()
      : null

  const inspectionRescheduleFormValid =
    Boolean(inspectionRescheduleReason) &&
    Boolean(inspectionNewDate.trim()) &&
    Boolean(inspectionTimeSlot)

  const inspectionScopeSelectedCount =
    INSPECTION_SCOPE_ITEMS.filter((row) => inspectionScopeIncluded.has(row.id)).length +
    inspectionScopeCustomItems.length

  const inspectionScopeFormValid = inspectionScopeSelectedCount >= 1

  const inspectionReassignFormValid = inspectionNewInspectorId != null

  const defaultFlowValid =
    (!needsVendor || Boolean(vendorId)) &&
    (!needsNewPriority || Boolean(newPriorityLevel)) &&
    (!needsDefaultPausePanel || defaultPauseAutomationValid) &&
    (!showSafetyAlertSeverityPanel || safetyAlertSeverityFormValid) &&
    (!showNotificationRulesPanel || notificationRulesFormValid) &&
    (!showResponseProtocolPanel || responseProtocolFormValid) &&
    (!isBillingCategory || billingCategoryFlowValid) &&
    (!showInspectionReschedulePanel || inspectionRescheduleFormValid) &&
    (!showInspectionScopePanel || inspectionScopeFormValid) &&
    (!showInspectionReassignPanel || inspectionReassignFormValid)

  const showAdjustPriorityPanel = needsNewPriority
  const showDefaultPauseAutomationPanel = needsDefaultPausePanel

  const defaultPauseAutomationBannerName = defaultPauseAutomationTitle(automationCategory)

  const formValid =
    Boolean(ticketId) &&
    password.trim().length > 0 &&
    (isRentReminder ? rentFlowValid : defaultFlowValid)

  const headerSubtitle = isRentReminder
    ? 'Adjust audience, urgency, or pause scheduled rent payment reminders'
    : automationCategory === 'maintenance'
      ? 'Manually control ticket routing and vendor assignment'
      : 'Manually override automations for the selected category'

  const showAiRecommendationStrip = isRentReminder
  const showImpactWarning = isRentReminder || !isMaintenanceCategory

  function applyOverride() {
    if (!formValid) return
    onClose()
  }

  return (
    <div
      className={
        isRail
          ? 'fixed inset-0 z-50 flex justify-end'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
      }
    >
      <div
        role="presentation"
        className={['absolute inset-0', isRail ? 'bg-black/40' : ''].filter(Boolean).join(' ')}
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          isRail
            ? 'relative flex h-full max-h-dvh w-full max-w-[min(100vw,881px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]'
            : 'relative flex max-h-[min(92dvh,1680px)] w-full max-w-[881px] flex-col overflow-hidden rounded-[10px] bg-white shadow-lg'
        }
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e5e7eb] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#fef3c6]">
              <img src={overrideIcon} alt="" className="size-5 object-contain" />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]"
              >
                Override Automation
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">{headerSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none transition-colors hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6">
            <div className="rounded-[10px] border-l-4 border-[#fe9a00] bg-[#fffbeb] py-4 pl-5 pr-4">
              <div className="flex gap-3">
                <svg className="mt-0.5 size-5 shrink-0 text-[#d08700]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01" />
                </svg>
                <div>
                  <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#7b3306]">
                    Manual Override Required
                  </p>
                  <p className="mt-1 text-[12px] leading-4 text-[#bb4d00]">
                    {isRentReminder
                      ? 'This changes how or when rent payment reminders go out. All overrides are logged for audit compliance.'
                      : 'This action will bypass AI-powered automation. All overrides are logged for audit compliance.'}
                  </p>
                </div>
              </div>
            </div>

            {!isRentReminder ? (
              <div className="space-y-3">
                <p
                  id={categoryGroupId}
                  className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                >
                  Select Automation Category <span className="text-[#c10007]">*</span>
                </p>
                <div
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  role="radiogroup"
                  aria-labelledby={categoryGroupId}
                >
                  {AUTOMATION_CATEGORIES.map((c) => {
                    const sel = automationCategory === c.id
                    return (
                      <div
                        key={c.id}
                        role="radio"
                        aria-checked={sel}
                        tabIndex={0}
                        onClick={() => {
                          setAutomationCategory(c.id)
                          setTicketId('')
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setAutomationCategory(c.id)
                            setTicketId('')
                          }
                        }}
                        className={[
                          'cursor-pointer rounded-[10px] border-2 px-[18px] py-[18px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                          sel ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                        ].join(' ')}
                      >
                        <div className="flex gap-3">
                          <AmberRadio on={sel} />
                          <div>
                            <p className="flex items-center gap-2 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">
                              <span className="text-[18px] leading-7" aria-hidden>
                                {c.emoji}
                              </span>
                              {c.title}
                            </p>
                            <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{c.subtitle}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <label
                htmlFor={scopeFieldId}
                className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                {scopeFieldLabel} <span className="text-[#c10007]">*</span>
              </label>
              <div className="relative">
                <select
                  id={scopeFieldId}
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                >
                  <option value="">{scopePlaceholder}</option>
                  {scopeOptions.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </div>
              {showAiRecommendationStrip ? (
                <div className="flex items-center gap-2 rounded-[10px] border border-[#bedbff] bg-[#eff6ff] px-[13px] py-3">
                  <svg className="size-4 shrink-0 text-[#1447e6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" strokeLinecap="round" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <p className="text-[12px] leading-4 text-[#1447e6]">
                    AI Recommendation: 7 days before due date • Email + SMS • Confidence: 94%
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Override Type <span className="text-[#c10007]">*</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {overrideTypeOptions.map((t) => {
                  const sel = overrideType === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setOverrideType(t.id)}
                      className={[
                        'flex min-h-[84px] w-full rounded-[10px] border-2 px-[18px] py-[18px] text-left transition-colors',
                        sel ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                      ].join(' ')}
                    >
                      <div className="flex w-full gap-3">
                        <AmberRadio on={sel} />
                        <div className="min-w-0 flex-1">
                          <p className="flex min-h-[28px] items-center gap-2 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">
                            <span className="text-[18px] leading-7 tracking-[-0.4395px]" aria-hidden>
                              {t.emoji}
                            </span>
                            {t.title}
                          </p>
                          <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{t.subtitle}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {showInspectionReschedulePanel ? (
              <div className="flex flex-col gap-5">
                <div>
                  <h3 className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                    Reschedule Inspection Appointment <span aria-hidden>📅</span>
                  </h3>
                  <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                    Update the scheduled inspection time and notify stakeholders.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                    Current Scheduled Appointment
                  </p>
                  <div className="flex gap-3 rounded-[10px] border border-[#e5e7eb] bg-white p-4">
                    <div
                      className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-[#1447e6]"
                      aria-hidden
                    >
                      <svg
                        className="size-6 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[15px] font-semibold leading-5 text-[#101828]">
                            Saturday, March 28, 2026
                          </p>
                          <p className="mt-0.5 text-[13px] font-medium text-[#4a5565]">
                            10:00 AM – 11:00 AM EST
                          </p>
                          <p className="mt-1 text-[12px] text-[#6a7282]">
                            Assigned to: Mike Johnson
                          </p>
                        </div>
                        <span className="inline-flex shrink-0 items-center rounded-full bg-[#dbeafe] px-2.5 py-0.5 text-[11px] font-semibold text-[#1447e6]">
                          Confirmed
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={inspectionRescheduleReasonId}
                    className="text-[12px] font-medium leading-4 text-[#4a5565]"
                  >
                    Reason for Rescheduling <span className="text-[#c10007]">*</span>
                  </label>
                  <div className="relative">
                    <select
                      id={inspectionRescheduleReasonId}
                      value={inspectionRescheduleReason}
                      onChange={(e) => setInspectionRescheduleReason(e.target.value)}
                      className="h-[42px] w-full appearance-none rounded-[10px] border border-[#d1d5dc] bg-white py-2 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                    >
                      <option value="">Select reason…</option>
                      {INSPECTION_RESCHEDULE_REASON_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[12px] font-medium leading-4 text-[#4a5565]">
                    Select New Date &amp; Time <span className="text-[#c10007]">*</span>
                  </p>
                  <p className="text-[11px] leading-4 text-[#6a7282]">
                    Times shown in Eastern Standard Time (EST)
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={inspectionNewDateId}
                        className="text-[12px] font-medium leading-4 text-[#4a5565]"
                      >
                        New Date
                      </label>
                      <input
                        id={inspectionNewDateId}
                        type="date"
                        value={inspectionNewDate}
                        onChange={(e) => setInspectionNewDate(e.target.value)}
                        className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={inspectionTimeSlotId}
                        className="text-[12px] font-medium leading-4 text-[#4a5565]"
                      >
                        Time Slot
                      </label>
                      <div className="relative">
                        <select
                          id={inspectionTimeSlotId}
                          value={inspectionTimeSlot}
                          onChange={(e) => setInspectionTimeSlot(e.target.value)}
                          className="h-[42px] w-full appearance-none rounded-[10px] border border-[#d1d5dc] bg-white py-2 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                        >
                          <option value="">Select time…</option>
                          {INSPECTION_TIME_SLOT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                    Staff Availability
                  </p>
                  <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f3f4f6] pb-3">
                      <p className="text-[14px] font-semibold text-[#101828]">Next Available Slots</p>
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-[#e17100] underline-offset-2 hover:underline"
                      >
                        View Full Calendar →
                      </button>
                    </div>
                    <ul className="mt-3 flex flex-col gap-2" aria-label="Suggested staff slots">
                      {INSPECTION_STAFF_AVAILABILITY_SLOTS.map((s) => {
                        const limited = s.availability === 'limited'
                        return (
                          <li
                            key={s.id}
                            className={[
                              'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5',
                              limited
                                ? 'border-[#fff085] bg-[#fefce8]'
                                : 'border-[#b9f8cf] bg-[#f0fdf4]',
                            ].join(' ')}
                          >
                            <div>
                              <p className="text-[13px] font-medium text-[#101828]">{s.line}</p>
                              <p className="text-[12px] text-[#6a7282]">{s.staff}</p>
                            </div>
                            <span
                              className={[
                                'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                limited ? 'bg-[#fff085]/80 text-[#733e0a]' : 'bg-[#dcfce7] text-[#166534]',
                              ].join(' ')}
                            >
                              {limited ? 'Limited' : 'Available'}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </div>

                <div>
                  <p id={inspectionNotifGroupId} className="mb-3 text-[14px] font-medium text-[#364153]">
                    Notification Preferences
                  </p>
                  <div
                    className="flex flex-col divide-y divide-[#e5e7eb] rounded-[10px] border border-[#e5e7eb] bg-white"
                    role="group"
                    aria-labelledby={inspectionNotifGroupId}
                  >
                    {INSPECTION_NOTIFICATION_PREFS.map((row) => {
                      const ckId = `${inspectionNotifGroupId}-${row.key}`
                      const checked = inspectionNotifPrefs[row.key]
                      return (
                        <label key={row.key} className="flex cursor-pointer gap-3 px-4 py-3">
                          <input
                            id={ckId}
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setInspectionNotifPrefs((p) => ({
                                ...p,
                                [row.key]: !p[row.key],
                              }))
                            }
                            className="mt-1 size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                              {row.title}
                            </span>
                            <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                              {row.subtitle}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div
                  className="rounded-[10px] border border-[#fff085] bg-[#fefce8] px-4 py-3"
                  role="alert"
                >
                  <p className="text-[13px] font-semibold text-[#733e0a]">
                    Scheduling Conflicts Detected
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] font-medium text-[#a65f00]">
                    <li>Another inspection is scheduled within 2 hours of this window.</li>
                    <li>Mike Johnson has a conflicting work order at 10:30 AM.</li>
                  </ul>
                </div>

                <div className="rounded-[10px] border border-[#bedbff] bg-[#eff6ff] px-4 py-3">
                  <p className="text-[13px] font-semibold text-[#1c398e]">Reschedule Impact</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] font-medium text-[#1447e6]">
                    <li>Resident will be notified with the updated time if channels are enabled.</li>
                    <li>Assignee and vendor calendars update when calendar sync is on.</li>
                    <li>This change is audit-logged with reason and prior appointment.</li>
                  </ul>
                </div>
              </div>
            ) : null}

            {showInspectionScopePanel ? (
              <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-[17px] py-[17px]">
                <div className="flex items-center gap-2">
                  <span className="text-[18px] leading-7 tracking-[-0.4395px]" aria-hidden>
                    📋
                  </span>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Modify Inspection Scope
                  </h3>
                </div>

                <div className="flex flex-col gap-2">
                  <p
                    id={inspectionScopeItemsGroupId}
                    className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]"
                  >
                    Inspection Items <span className="text-[#c10007]">*</span>
                  </p>
                  <p className="text-[12px] leading-4 text-[#6a7282]">
                    Select which items should be included in the inspection
                  </p>
                  <div
                    className="flex max-h-[min(420px,50vh)] flex-col gap-2 overflow-y-auto pr-1"
                    role="group"
                    aria-labelledby={inspectionScopeItemsGroupId}
                  >
                    {INSPECTION_SCOPE_ITEMS.map((item) => {
                      const included = inspectionScopeIncluded.has(item.id)
                      const rowId = `${inspectionScopeItemsGroupId}-${item.id}`
                      return (
                        <label
                          key={item.id}
                          htmlFor={rowId}
                          className={[
                            'flex min-h-[64px] cursor-pointer flex-col rounded-[10px] border-2 px-[14px] py-[14px] transition-colors',
                            included
                              ? 'border-[#2b7fff] bg-[#eff6ff]'
                              : 'border-[#e5e7eb] bg-white',
                          ].join(' ')}
                        >
                          <div className="flex w-full items-center gap-3">
                            <input
                              id={rowId}
                              type="checkbox"
                              checked={included}
                              onChange={() =>
                                setInspectionScopeIncluded((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(item.id)) next.delete(item.id)
                                  else next.add(item.id)
                                  return next
                                })
                              }
                              className="sr-only"
                            />
                            <span
                              className={[
                                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2',
                                included
                                  ? 'border-[#2b7fff] bg-[#2b7fff]'
                                  : 'border-[#d1d5dc] bg-white',
                              ].join(' ')}
                              aria-hidden
                            >
                              {included ? (
                                <svg
                                  className="size-3 text-white"
                                  viewBox="0 0 12 12"
                                  fill="none"
                                  aria-hidden
                                >
                                  <path
                                    d="M2.5 6L5 8.5L9.5 3.5"
                                    stroke="currentColor"
                                    strokeWidth={1.75}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              ) : null}
                            </span>
                            <span className="text-[16px] leading-6 tracking-[-0.3125px]" aria-hidden>
                              {item.emoji}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                                {item.title}
                              </p>
                              <p className="text-[12px] leading-4 text-[#6a7282]">{item.category}</p>
                            </div>
                            {included ? (
                              <span className="inline-flex shrink-0 items-center rounded-lg bg-[#dbeafe] px-2.5 py-0.5 text-[12px] font-medium text-[#1447e6]">
                                Included
                              </span>
                            ) : null}
                          </div>
                        </label>
                      )
                    })}
                    {inspectionScopeCustomItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex min-h-[64px] flex-col rounded-[10px] border-2 border-[#2b7fff] bg-[#eff6ff] px-[14px] py-[14px]"
                      >
                        <div className="flex w-full items-center gap-3">
                          <span
                            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2 border-[#2b7fff] bg-[#2b7fff]"
                            aria-hidden
                          >
                            <svg
                              className="size-3 text-white"
                              viewBox="0 0 12 12"
                              fill="none"
                              aria-hidden
                            >
                              <path
                                d="M2.5 6L5 8.5L9.5 3.5"
                                stroke="currentColor"
                                strokeWidth={1.75}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="text-[16px] leading-6 tracking-[-0.3125px]" aria-hidden>
                            ✏️
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                              {item.title}
                            </p>
                            <p className="text-[12px] leading-4 text-[#6a7282]">{item.category}</p>
                          </div>
                          <span className="inline-flex shrink-0 items-center rounded-lg bg-[#dbeafe] px-2.5 py-0.5 text-[12px] font-medium text-[#1447e6]">
                            Included
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#e5e7eb] pt-[17px]">
                  <p className="text-[12px] font-medium leading-4 text-[#4a5565]">
                    Add Custom Inspection Item
                  </p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      id={inspectionScopeCustomItemId}
                      type="text"
                      value={inspectionScopeCustomInput}
                      onChange={(e) => setInspectionScopeCustomInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const trimmed = inspectionScopeCustomInput.trim()
                          if (!trimmed) return
                          setInspectionScopeCustomItems((list) => [
                            ...list,
                            {
                              id: `scope-custom-${Date.now()}`,
                              title: trimmed,
                              category: 'Custom',
                            },
                          ])
                          setInspectionScopeCustomInput('')
                        }
                      }}
                      placeholder="e.g., Pest inspection, Roof condition..."
                      className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] font-normal tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = inspectionScopeCustomInput.trim()
                        if (!trimmed) return
                        setInspectionScopeCustomItems((list) => [
                          ...list,
                          {
                            id: `scope-custom-${Date.now()}`,
                            title: trimmed,
                            category: 'Custom',
                          },
                        ])
                        setInspectionScopeCustomInput('')
                      }}
                      className="h-9 shrink-0 rounded-lg bg-[#155dfc] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[#155dfc] focus-visible:ring-offset-2"
                    >
                      Add Item
                    </button>
                  </div>
                </div>

                <div className="flex min-h-[54px] items-center justify-between rounded-[10px] border border-[#d1d5dc] bg-white px-[13px] py-3">
                  <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                    Total Items Selected:
                  </p>
                  <p className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#155dfc]">
                    {inspectionScopeSelectedCount}
                  </p>
                </div>
              </div>
            ) : null}

            {showInspectionReassignPanel ? (
              <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-[17px] py-[17px]">
                <div className="flex items-center gap-2">
                  <svg
                    className="size-4 shrink-0 text-[#364153]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Reassign Inspector
                  </h3>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                    Current Inspector
                  </p>
                  <div className="flex items-center gap-3 rounded-[10px] border border-[#d1d5dc] bg-white px-[13px] py-3">
                    <div
                      className={[
                        'flex size-10 shrink-0 items-center justify-center rounded-full',
                        INSPECTION_CURRENT_INSPECTOR.avatarClass,
                      ].join(' ')}
                    >
                      <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px]">
                        {INSPECTION_CURRENT_INSPECTOR.initials}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                        {INSPECTION_CURRENT_INSPECTOR.name}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
                        ⭐ {INSPECTION_CURRENT_INSPECTOR.rating}{' '}
                        <span className="text-[#6a7282]" aria-hidden>
                          •
                        </span>{' '}
                        {INSPECTION_CURRENT_INSPECTOR.inspections} inspections
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p
                    id={inspectionNewInspectorGroupId}
                    className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]"
                  >
                    Select New Inspector <span className="text-[#c10007]">*</span>
                  </p>
                  <div
                    className="flex flex-col gap-2"
                    role="radiogroup"
                    aria-labelledby={inspectionNewInspectorGroupId}
                  >
                    {INSPECTION_INSPECTOR_CANDIDATES.map((cand) => {
                      const sel = inspectionNewInspectorId === cand.id
                      const pill = inspectionInspectorAvailabilityPill(cand.availability)
                      return (
                        <button
                          key={cand.id}
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          onClick={() => setInspectionNewInspectorId(cand.id)}
                          className={[
                            'w-full rounded-[10px] border-2 px-[14px] py-[14px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                            sel ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                          ].join(' ')}
                        >
                          <div className="flex gap-3">
                            <span className="mt-1 shrink-0">
                              <PriorityLevelRadio on={sel} />
                            </span>
                            <div
                              className={[
                                'flex size-10 shrink-0 items-center justify-center rounded-full',
                                cand.avatarClass,
                              ].join(' ')}
                            >
                              <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px]">
                                {cand.initials}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                                    {cand.name}
                                  </span>
                                  <span className="text-[12px] text-[#99a1af]" aria-hidden>
                                    •
                                  </span>
                                  <span className="text-[12px] font-medium text-[#364153]">
                                    ⭐ {cand.rating}
                                  </span>
                                </div>
                                <span
                                  className={[
                                    'inline-flex shrink-0 items-center rounded px-2 py-1 text-[12px] leading-4',
                                    pill.className,
                                  ].join(' ')}
                                >
                                  {pill.label}
                                </span>
                              </div>
                              <p className="mt-1 text-[12px] leading-4 text-[#4a5565]">
                                {cand.specialty}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {cand.badges.map((b) => (
                                  <span
                                    key={b}
                                    className="inline-flex rounded bg-[#dbeafe] px-2 py-0.5 text-[12px] leading-4 text-[#1447e6]"
                                  >
                                    {b}
                                  </span>
                                ))}
                              </div>
                              <p className="mt-2 text-[12px] leading-4 text-[#6a7282]">
                                {cand.inspectionCount} inspections{' '}
                                <span aria-hidden>•</span> Avg: {cand.avgMin} min
                              </p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-[#d1d5dc] bg-white text-[14px] font-medium tracking-[-0.1504px] text-[#4a5565] outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                >
                  <svg
                    className="size-5 shrink-0 text-[#4a5565]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M19 8v6M22 11h-6" strokeLinecap="round" />
                  </svg>
                  Add Inspector Manually
                </button>
              </div>
            ) : null}

            {showBillingPaymentSchedulePanel ? (
              <div className="flex flex-col gap-4">
                <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                  Payment Schedule &amp; Due Date Modifications <span className="text-[#c10007]">*</span>{' '}
                  <span className="text-[12px] font-medium leading-4 text-[#e17100]">(Audit Logged)</span>
                </p>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={billingDueDateId}
                      className="text-[12px] font-medium leading-4 text-[#4a5565]"
                    >
                      New Due Date
                    </label>
                    <input
                      id={billingDueDateId}
                      type="date"
                      value={billingNewDueDate}
                      onChange={(e) => setBillingNewDueDate(e.target.value)}
                      className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={billingAmountId}
                      className="text-[12px] font-medium leading-4 text-[#4a5565]"
                    >
                      Payment Amount
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] leading-6 tracking-[-0.3125px] text-[#6a7282]">
                        $
                      </span>
                      <input
                        id={billingAmountId}
                        type="text"
                        inputMode="decimal"
                        value={billingPaymentAmount}
                        onChange={(e) => setBillingPaymentAmount(e.target.value)}
                        placeholder="0.00"
                        className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] bg-white py-2 pl-7 pr-3 text-[16px] font-medium tracking-[-0.3125px] text-[#0a0a0a] outline-none placeholder:text-[#717182]/80 focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={billingFrequencyId}
                      className="text-[12px] font-medium leading-4 text-[#4a5565]"
                    >
                      Payment Frequency
                    </label>
                    <div className="relative">
                      <select
                        id={billingFrequencyId}
                        value={billingPaymentFrequency}
                        onChange={(e) => setBillingPaymentFrequency(e.target.value)}
                        className="h-[38px] w-full appearance-none rounded-[10px] border border-[#d1d5dc] bg-white py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                      >
                        <option value="">Select frequency…</option>
                        {BILLING_PAYMENT_FREQUENCY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={billingModNotesId}
                      className="text-[12px] font-medium leading-4 text-[#4a5565]"
                    >
                      Modification Notes
                    </label>
                    <textarea
                      id={billingModNotesId}
                      value={billingModificationNotes}
                      onChange={(e) => setBillingModificationNotes(e.target.value)}
                      rows={3}
                      placeholder="Additional notes about this payment schedule change..."
                      className="min-h-[60px] w-full resize-y rounded-[10px] border border-[#d1d5dc] bg-white px-3 py-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182]/80 focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                    />
                  </div>
                </div>
                <p className="text-[12px] leading-4 text-[#6a7282]">
                  All payment modifications are tracked and reviewed by management for compliance.
                </p>
              </div>
            ) : null}

            {showBillingLateFeesPanel ? (
              <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
                <div className="flex items-center gap-2">
                  <span className="text-[18px] leading-7" aria-hidden>
                    💰
                  </span>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Waive or Adjust Late Payment Fees
                  </h3>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Current Late Fee Amount
                  </p>
                  <div className="rounded-[10px] border border-[#d1d5dc] bg-white px-[13px] py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                        Outstanding Late Fees:
                      </p>
                      <p className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#e7000b]">
                        $150.00
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p
                    id={billingLateFeeAdjGroupId}
                    className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                  >
                    Adjustment Type <span className="text-[#c10007]">*</span>
                  </p>
                  <div
                    className="flex flex-col gap-3"
                    role="radiogroup"
                    aria-labelledby={billingLateFeeAdjGroupId}
                  >
                    {BILLING_LATE_FEE_ADJUSTMENT_OPTIONS.map((opt) => {
                      const sel = billingLateFeeAdjustmentType === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          onClick={() => {
                            setBillingLateFeeAdjustmentType(opt.id)
                            if (opt.id === 'full-waiver') setBillingNewLateFeeAmount('')
                          }}
                          className={[
                            'flex w-full rounded-[10px] border-2 px-[14px] py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                            sel ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                          ].join(' ')}
                        >
                          <div className="flex w-full items-center gap-3">
                            <RentAutomationRadio on={sel} />
                            <span className="text-[18px] leading-7" aria-hidden>
                              {opt.emoji}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                                {opt.title}
                              </p>
                              <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{opt.subtitle}</p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={billingNewLateFeeAmountId}
                    className="text-[12px] font-medium leading-4 text-[#4a5565]"
                  >
                    New Late Fee Amount
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] leading-6 tracking-[-0.3125px] text-[#6a7282]">
                      $
                    </span>
                    <input
                      id={billingNewLateFeeAmountId}
                      type="text"
                      inputMode="decimal"
                      value={billingNewLateFeeAmount}
                      onChange={(e) => setBillingNewLateFeeAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={billingLateFeeAdjustmentType === 'full-waiver'}
                      aria-disabled={billingLateFeeAdjustmentType === 'full-waiver'}
                      className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] bg-white py-2 pl-7 pr-3 text-[16px] font-medium tracking-[-0.3125px] text-[#0a0a0a] outline-none placeholder:text-[#717182]/80 focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30 disabled:cursor-not-allowed disabled:bg-[#f3f4f6] disabled:text-[#6a7282]"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {showBillingSuspendAutoPayPanel ? (
              <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-[17px] py-[17px]">
                <div className="flex items-center gap-2">
                  <span className="text-[18px] leading-7" aria-hidden>
                    ⏸️
                  </span>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Pause Automated Payment Processing
                  </h3>
                </div>

                <div className="flex flex-col gap-[13px]">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Current Auto-Payment Status
                  </p>
                  <div className="flex flex-col gap-2 rounded-[10px] border border-[#d1d5dc] bg-white px-[13px] py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                        Status:{' '}
                        <span className="font-medium text-[#00a63e]">● Active</span>
                      </p>
                      <div className="text-right">
                        <p className="text-[12px] leading-4 text-[#6a7282]">Next Payment</p>
                        <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                          April 1, 2026
                        </p>
                      </div>
                    </div>
                    <div className="border-t border-[#e5e7eb] pt-2">
                      <p className="text-[12px] leading-4 text-[#4a5565]">
                        Amount:{' '}
                        <span className="font-medium text-[#101828]">$1,500/month</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p
                      id={billingSuspendDurationGroupId}
                      className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                    >
                      Suspension Duration <span className="text-[#c10007]">*</span>
                    </p>
                    <div
                      className="flex flex-col gap-3"
                      role="radiogroup"
                      aria-labelledby={billingSuspendDurationGroupId}
                    >
                      {BILLING_SUSPEND_DURATION_OPTIONS.map((opt) => {
                        const sel = billingSuspendDuration === opt.id
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={sel}
                            onClick={() => {
                              setBillingSuspendDuration(opt.id)
                              if (opt.id !== 'custom-period') {
                                setBillingSuspendPauseStart('')
                                setBillingSuspendResumeDate('')
                              }
                            }}
                            className={[
                              'flex w-full rounded-[10px] border-2 px-[14px] py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                              sel ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                            ].join(' ')}
                          >
                            <div className="flex w-full items-center gap-3">
                              <RentAutomationRadio on={sel} />
                              <span className="text-[18px] leading-7" aria-hidden>
                                {opt.emoji}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                                    {opt.title}
                                  </p>
                                  <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">
                                    {opt.meta}
                                  </p>
                                </div>
                                <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
                                  {opt.subtitle}
                                </p>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {billingSuspendDuration === 'custom-period' ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={billingSuspendPauseStartId}
                          className="text-[12px] font-medium leading-4 text-[#4a5565]"
                        >
                          Pause Start Date <span className="text-[#c10007]">*</span>
                        </label>
                        <input
                          id={billingSuspendPauseStartId}
                          type="date"
                          value={billingSuspendPauseStart}
                          onChange={(e) => setBillingSuspendPauseStart(e.target.value)}
                          className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={billingSuspendResumeId}
                          className="text-[12px] font-medium leading-4 text-[#4a5565]"
                        >
                          Resume Date <span className="text-[#c10007]">*</span>
                        </label>
                        <input
                          id={billingSuspendResumeId}
                          type="date"
                          value={billingSuspendResumeDate}
                          onChange={(e) => setBillingSuspendResumeDate(e.target.value)}
                          className="h-[42px] w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2">
                    <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                      Resident Notification
                    </p>
                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor={billingSuspendNotifyEmailId}
                        className="flex cursor-pointer items-center gap-2"
                      >
                        <input
                          id={billingSuspendNotifyEmailId}
                          type="checkbox"
                          checked={billingSuspendNotifyEmail}
                          onChange={(e) => setBillingSuspendNotifyEmail(e.target.checked)}
                          className="size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                        />
                        <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                          Send email notification to resident
                        </span>
                      </label>
                      <label
                        htmlFor={billingSuspendNotifySmsId}
                        className="flex cursor-pointer items-center gap-2"
                      >
                        <input
                          id={billingSuspendNotifySmsId}
                          type="checkbox"
                          checked={billingSuspendNotifySms}
                          onChange={(e) => setBillingSuspendNotifySms(e.target.checked)}
                          className="size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                        />
                        <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                          Send SMS reminder before resume date
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {showNotificationRulesPanel ? (
              <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-[17px]">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Customize Notification Distribution
                  </h3>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Who Should Receive Notifications <span className="text-[#c10007]">*</span>
                  </p>
                  <div className="flex flex-col gap-3">
                    {SAFETY_NOTIF_RECIPIENT_GROUPS.map((g) => {
                      const on = Boolean(safetyNotifRecipients[g.id])
                      return (
                        <label
                          key={g.id}
                          className={[
                            'flex cursor-pointer gap-3 rounded-[10px] border-2 bg-white px-[18px] py-[18px] transition-colors',
                            on ? 'border-[#fe9a00]' : 'border-[#e5e7eb]',
                          ].join(' ')}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setSafetyNotifRecipients((prev) => ({
                                ...prev,
                                [g.id]: !prev[g.id],
                              }))
                            }
                            className="mt-0.5 size-5 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-[16px] leading-6 tracking-[-0.3125px]" aria-hidden>
                                {g.emoji}
                              </span>
                              <span className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">
                                {g.title}
                              </span>
                            </span>
                            <span className="mt-1 block text-[12px] font-medium leading-4 text-[#6a7282]">
                              {g.subtitle}
                            </span>
                            {g.contacts.length > 0 ? (
                              <span
                                className={
                                  g.id === 'property-managers'
                                    ? 'mt-3 grid grid-cols-2 gap-3 pl-1'
                                    : g.id === 'maintenance'
                                      ? 'mt-3 grid grid-cols-3 gap-3 pl-1'
                                      : 'mt-3 flex flex-col gap-2 pl-1'
                                }
                              >
                                {g.contacts.map((c) =>
                                  g.id === 'property-managers' ? (
                                    <span key={`${g.id}-${c.name}`} className="min-w-0">
                                      <span className="block text-[12px] font-medium leading-4 tracking-[-0.1504px] text-[#101828]">
                                        {c.name}
                                      </span>
                                      <span className="mt-0.5 block text-[12px] leading-4 text-[#6a7282]">
                                        {c.detail}
                                      </span>
                                    </span>
                                  ) : g.id === 'maintenance' ? (
                                    <span key={`${g.id}-${c.name}`} className="min-w-0">
                                      <span className="block text-[12px] font-medium leading-4 tracking-[-0.1504px] text-[#101828]">
                                        {c.name}
                                      </span>
                                      <span className="mt-0.5 block text-[12px] leading-4 text-[#6a7282]">
                                        {c.detail}
                                      </span>
                                    </span>
                                  ) : (
                                    <span
                                      key={`${g.id}-${c.name}`}
                                      className="text-[12px] leading-4 text-[#4a5565]"
                                    >
                                      <span className="font-normal">{c.name}</span>
                                      <span className="text-[#99a1af]"> • </span>
                                      <span className="font-normal">{c.detail}</span>
                                    </span>
                                  ),
                                )}
                              </span>
                            ) : null}
                            {g.id === 'emergency' ? (
                              <span className="mt-3 block rounded border border-[#ffc9c9] bg-[#fef2f2] px-2.5 py-2">
                                <span className="text-[12px] leading-4 text-[#c10007]">
                                  ⚠️ Only enable for life-threatening emergencies
                                </span>
                              </span>
                            ) : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p
                    id={safetyNotifTimingGroupId}
                    className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                  >
                    When to Send Notifications <span className="text-[#c10007]">*</span>
                  </p>
                  <div
                    className="flex flex-col gap-3 rounded-[10px] border border-[#e5e7eb] bg-white px-[17px] py-4"
                    role="radiogroup"
                    aria-labelledby={safetyNotifTimingGroupId}
                  >
                    {SAFETY_NOTIF_TIMING_OPTIONS.map((opt) => {
                      const sel = safetyNotifTiming === opt.id
                      return (
                        <label
                          key={opt.id}
                          className="flex cursor-pointer gap-3 rounded-lg hover:bg-[#f9fafb]/80"
                        >
                          <input
                            type="radio"
                            name="safety-notif-timing"
                            checked={sel}
                            onChange={() => setSafetyNotifTiming(opt.id)}
                            className="mt-1 size-4 shrink-0 border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                          />
                          <span className="min-w-0">
                            <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                              {opt.title}
                            </span>
                            <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                              {opt.subtitle}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Notification Methods <span className="text-[#c10007]">*</span>
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {SAFETY_NOTIF_METHOD_OPTIONS.map((m) => {
                      const on = Boolean(safetyNotifMethods[m.id])
                      return (
                        <label
                          key={m.id}
                          className={[
                            'flex cursor-pointer gap-3 rounded-[10px] border-2 p-[14px] transition-colors',
                            on ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                          ].join(' ')}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setSafetyNotifMethods((prev) => ({
                                ...prev,
                                [m.id]: !prev[m.id],
                              }))
                            }
                            className="mt-0.5 size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="text-[16px] leading-6" aria-hidden>
                                {m.emoji}
                              </span>
                              <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                                {m.title}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                              {m.subtitle}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Escalation Rules
                  </p>
                  <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-[17px] py-4">
                    <label className="flex cursor-pointer gap-3">
                      <input
                        type="checkbox"
                        checked={safetyNotifAutoEscalation}
                        onChange={(e) => {
                          setSafetyNotifAutoEscalation(e.target.checked)
                          if (!e.target.checked) setSafetyNotifEscalateAfter('')
                        }}
                        className="mt-1 size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                          Enable Auto-Escalation
                        </span>
                        <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                          Automatically notify senior management if ticket is not resolved
                        </span>
                        {safetyNotifAutoEscalation ? (
                          <span className="mt-4 ml-1 flex flex-col gap-2">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-[12px] font-medium text-[#4a5565]">
                                Escalate after:
                              </span>
                              <input
                                id={safetyNotifEscalateAfterId}
                                type="text"
                                inputMode="numeric"
                                value={safetyNotifEscalateAfter}
                                onChange={(e) => setSafetyNotifEscalateAfter(e.target.value)}
                                placeholder="e.g. 24"
                                aria-label="Hours before escalation without resolution"
                                className="h-[27px] w-[90px] rounded border border-[#d1d5dc] bg-white px-2 text-[12px] font-medium text-[#101828] outline-none focus:border-[#944c73]/45 focus:ring-1 focus:ring-[#944c73]/30"
                              />
                              <span className="text-[12px] font-medium text-[#4a5565]">
                                hours without resolution
                              </span>
                            </span>
                            <span className="flex flex-wrap items-center gap-2 text-[12px] font-medium">
                              <span className="text-[#4a5565]">Notify:</span>
                              <span className="text-[#101828]">Senior Property Manager</span>
                            </span>
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            {showResponseProtocolPanel ? (
              <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-[17px]">
                <div className="flex items-center gap-2">
                 
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Modify Emergency Response Procedures
                  </h3>
                </div>

                <div className="flex flex-col gap-2">
                  <p
                    id={safetyResponseProtocolGroupId}
                    className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                  >
                    New Response Protocol <span className="text-[#c10007]">*</span>
                  </p>
                  <div
                    className="flex flex-col gap-3"
                    role="radiogroup"
                    aria-labelledby={safetyResponseProtocolGroupId}
                  >
                    {RESPONSE_PROTOCOL_OPTIONS.map((opt) => {
                      const sel = safetyNewResponseProtocol === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          onClick={() => setSafetyNewResponseProtocol(opt.id)}
                          className={[
                            'flex w-full rounded-[10px] border-2 px-[18px] py-[18px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                            sel ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                          ].join(' ')}
                        >
                          <div className="flex w-full items-start gap-3">
                            <AmberRadio on={sel} />
                            <span
                              className="mt-0.5 shrink-0 text-[20px] leading-7 tracking-[-0.4492px]"
                              aria-hidden
                            >
                              {opt.emoji}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                                <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">
                                  {opt.title}
                                </p>
                                <p className="flex shrink-0 items-center gap-2 text-[12px] leading-4">
                                  <span className="text-[#6a7282]">{opt.metaSoft}</span>
                                  <span className="text-[#99a1af]" aria-hidden>
                                    •
                                  </span>
                                  <span className="font-medium text-[#364153]">{opt.metaBold}</span>
                                </p>
                              </div>
                              <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">
                                {opt.subtitle}
                              </p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Automated Actions
                  </p>
                  <div className="flex flex-col gap-3 rounded-[10px] border border-[#e5e7eb] bg-white px-[17px] py-4">
                    {RESPONSE_PROTOCOL_AUTOMATED_ACTIONS.map((a) => (
                      <label
                        key={a.id}
                        className="flex cursor-pointer gap-3 rounded-lg hover:bg-[#f9fafb]/80"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(safetyProtocolAutomated[a.id])}
                          onChange={() =>
                            setSafetyProtocolAutomated((prev) => ({
                              ...prev,
                              [a.id]: !prev[a.id],
                            }))
                          }
                          className="mt-1 size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                            {a.title}
                          </span>
                          <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                            {a.subtitle}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Resource Allocation
                  </p>
                  <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white px-[17px] py-4">
                    <div>
                      <label
                        htmlFor={safetyProtocolBudgetId}
                        className="mb-2 block text-[12px] font-medium leading-4 text-[#4a5565]"
                      >
                        Budget Approval Level
                      </label>
                      <div className="relative">
                        <select
                          id={safetyProtocolBudgetId}
                          value={safetyProtocolBudget}
                          onChange={(e) => setSafetyProtocolBudget(e.target.value)}
                          className="h-9 w-full appearance-none rounded-[10px] border border-[#d1d5dc] bg-white py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                        >
                          <option value="">Select level…</option>
                          {RESPONSE_PROTOCOL_BUDGET_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </span>
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor={safetyProtocolQueueId}
                        className="mb-2 block text-[12px] font-medium leading-4 text-[#4a5565]"
                      >
                        Priority Queue Placement
                      </label>
                      <div className="relative">
                        <select
                          id={safetyProtocolQueueId}
                          value={safetyProtocolQueue}
                          onChange={(e) => setSafetyProtocolQueue(e.target.value)}
                          className="h-9 w-full appearance-none rounded-[10px] border border-[#d1d5dc] bg-white py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                        >
                          <option value="">Select placement…</option>
                          {RESPONSE_PROTOCOL_QUEUE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </span>
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor={safetyProtocolStaffingId}
                        className="mb-2 block text-[12px] font-medium leading-4 text-[#4a5565]"
                      >
                        Staffing Assignment
                      </label>
                      <div className="relative">
                        <select
                          id={safetyProtocolStaffingId}
                          value={safetyProtocolStaffing}
                          onChange={(e) => setSafetyProtocolStaffing(e.target.value)}
                          className="h-9 w-full appearance-none rounded-[10px] border border-[#d1d5dc] bg-white py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                        >
                          <option value="">Select assignment…</option>
                          {RESPONSE_PROTOCOL_STAFFING_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Service Level Agreement (SLA) Override
                  </p>
                  <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-[17px] py-4">
                    <label className="flex cursor-pointer gap-3">
                      <input
                        type="checkbox"
                        checked={safetyProtocolBypassSla}
                        onChange={(e) => setSafetyProtocolBypassSla(e.target.checked)}
                        className="mt-1 size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                      />
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                          Bypass Standard SLA Requirements
                        </span>
                        <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                          Override normal service level agreements for special circumstances
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="rounded-[10px] border border-[#bedbff] bg-[#eff6ff] px-[17px] py-4">
                  <div className="flex gap-3">
                    <svg
                      className="mt-0.5 size-5 shrink-0 text-[#1447e6]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#1c398e]">
                        Regulatory Compliance Notice
                      </p>
                      <p className="mt-1 text-[12px] leading-4 text-[#1447e6]">
                        Certain issues (gas leaks, electrical hazards, fire safety) require immediate action per housing
                        regulations. Emergency protocols are automatically enforced for these categories regardless of
                        manual selection.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={safetyProtocolJustificationId}
                    className="text-[12px] font-medium leading-4 text-[#4a5565]"
                  >
                    Justification for Protocol Change <span className="text-[#c10007]">*</span>
                  </label>
                  <textarea
                    id={safetyProtocolJustificationId}
                    value={safetyProtocolJustification}
                    onChange={(e) => setSafetyProtocolJustification(e.target.value)}
                    rows={4}
                    placeholder="Explain why the response protocol is being modified. Include details about urgency, special circumstances, or resident needs that justify this change..."
                    className="min-h-[80px] w-full resize-y rounded-[10px] border border-[#d1d5dc] bg-white px-3 py-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182]/80 focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                  />
                  <p className="flex gap-2 text-[12px] leading-4 text-[#6a7282]">
                    <svg
                      className="mt-0.5 size-3 shrink-0 text-[#6a7282]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" strokeLinecap="round" />
                    </svg>
                    Protocol changes are logged for quality assurance and regulatory compliance audits.
                  </p>
                </div>
              </div>
            ) : null}

            {showSafetyAlertSeverityPanel ? (
              <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Modify Safety Alert Severity
                  </h3>
                </div>
                <div className="flex flex-col gap-3">
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                    Current Alert Status
                  </p>
                  {currentSafetyAlertSummary ? (
                    <div className="rounded-[10px] border border-[#ffb86a] bg-white px-[13px] py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                            {currentSafetyAlertSummary.title}
                          </p>
                          <p className="mt-1 text-[12px] leading-4 text-[#4a5565]">
                            {currentSafetyAlertSummary.detected}
                          </p>
                        </div>
                        <span className="inline-flex shrink-0 self-start rounded-full bg-[#ffedd4] px-3 py-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#ca3500] sm:self-center">
                          {currentSafetyAlertSummary.levelLabel}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-[10px] border border-dashed border-[#d1d5dc] bg-white px-4 py-3 text-[12px] leading-4 text-[#6a7282]">
                      Select a safety alert above to view current status.
                    </p>
                  )}
                  <p
                    id={safetyNewSeverityGroupId}
                    className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                  >
                    New Alert Severity Level <span className="text-[#c10007]">*</span>
                  </p>
                  <div
                    className="flex flex-col gap-3"
                    role="radiogroup"
                    aria-labelledby={safetyNewSeverityGroupId}
                  >
                    {SAFETY_ALERT_SEVERITY_OPTIONS.map((opt) => {
                      const sel = safetyNewSeverity === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          onClick={() => setSafetyNewSeverity(opt.id)}
                          className={[
                            'flex w-full rounded-[10px] border-2 px-[14px] py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                            sel ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                          ].join(' ')}
                        >
                          <div className="flex w-full items-center gap-3">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <RentAutomationRadio on={sel} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                                    {opt.title}
                                  </p>
                                  <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">
                                    {opt.timing}
                                  </p>
                                </div>
                                <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
                                  {opt.subtitle}
                                </p>
                              </div>
                            </div>
                            <span
                              className="shrink-0 text-[20px] leading-none"
                              aria-hidden
                            >
                              {opt.emoji}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-[17px] py-4">
                    <p className="mb-3 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                      Alert Notification Settings
                    </p>
                    <div className="flex flex-col gap-3">
                      <label
                        htmlFor={safetyNotifyResidentsId}
                        className="flex cursor-pointer gap-3 rounded-lg hover:bg-[#f9fafb]/80"
                      >
                        <input
                          id={safetyNotifyResidentsId}
                          type="checkbox"
                          checked={safetyNotifyResidents}
                          onChange={(e) => setSafetyNotifyResidents(e.target.checked)}
                          className="mt-1 size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                            Notify All Residents
                          </span>
                          <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                            Send immediate alert to all building residents
                          </span>
                        </span>
                      </label>
                      <label
                        htmlFor={safetyNotifyMaintenanceId}
                        className="flex cursor-pointer gap-3 rounded-lg hover:bg-[#f9fafb]/80"
                      >
                        <input
                          id={safetyNotifyMaintenanceId}
                          type="checkbox"
                          checked={safetyNotifyMaintenance}
                          onChange={(e) => setSafetyNotifyMaintenance(e.target.checked)}
                          className="mt-1 size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                            Notify Maintenance Team
                          </span>
                          <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                            Alert on-call maintenance personnel
                          </span>
                        </span>
                      </label>
                      <label
                        htmlFor={safetyNotifyPropertyId}
                        className="flex cursor-pointer gap-3 rounded-lg hover:bg-[#f9fafb]/80"
                      >
                        <input
                          id={safetyNotifyPropertyId}
                          type="checkbox"
                          checked={safetyNotifyPropertyMgmt}
                          onChange={(e) => setSafetyNotifyPropertyMgmt(e.target.checked)}
                          className="mt-1 size-4 shrink-0 rounded border-[#d1d5dc] text-[#944c73] focus:ring-[#944c73]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                            Notify Property Management
                          </span>
                          <span className="mt-0.5 block text-[12px] font-medium leading-4 text-[#6a7282]">
                            Send alert to property managers
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {showAdjustPriorityPanel ? (
              <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-[17px]">
                <div className="flex items-center gap-2">
                  <svg
                    className="size-4 shrink-0 text-[#6a7282]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <circle cx="12" cy="12" r="10" strokeLinecap="round" />
                    <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                  </svg>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Adjust Priority Level
                  </h3>
                </div>
                <div className="flex flex-col gap-2">
                  <p
                    id={newPriorityGroupId}
                    className="text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                  >
                    New Priority <span className="text-[#c10007]">*</span>
                  </p>
                  <div
                    className="grid grid-cols-2 gap-3"
                    role="radiogroup"
                    aria-labelledby={newPriorityGroupId}
                  >
                    {PRIORITY_LEVELS.map((p) => {
                      const sel = newPriorityLevel === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          onClick={() => setNewPriorityLevel(p.id)}
                          className={[
                            'flex rounded-[10px] border-2 p-[12px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                            sel ? 'border-[#fe9a00] bg-[#fffbeb]' : 'border-[#e5e7eb] bg-white',
                          ].join(' ')}
                        >
                          <div className="flex w-full items-center gap-2">
                            <PriorityLevelRadio on={sel} />
                            <span className="text-[16px] leading-6 tracking-[-0.3125px]" aria-hidden>
                              {p.emoji}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                                {p.title}
                              </p>
                              <p className="text-[12px] leading-4 text-[#6a7282]">{p.subtitle}</p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {showDefaultPauseAutomationPanel ? (
              <PauseDisableOverrideActionsPanel
                currentAutomationName={defaultPauseAutomationBannerName}
                rentAutomationAction={rentAutomationAction}
                setRentAutomationAction={setRentAutomationAction}
                pauseDuration={pauseDuration}
                setPauseDuration={setPauseDuration}
                resumeOn={resumeOn}
                setResumeOn={setResumeOn}
                newTriggerTiming={newTriggerTiming}
                setNewTriggerTiming={setNewTriggerTiming}
                pauseDurationId={defaultPauseDurationId}
                resumeOnId={defaultResumeOnId}
                newTriggerId={defaultNewTriggerId}
              />
            ) : null}

            {needsVendor ? (
              <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-[17px]">
                <div className="mb-4 flex items-center gap-2">
                  <svg className="size-4 shrink-0 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
                  </svg>
                  <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                    Manual Vendor Selection
                  </h3>
                </div>
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={vendorSearchInputId}
                      className="mb-1.5 block text-[12px] font-medium leading-4 text-[#4a5565]"
                    >
                      Search vendors
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <circle cx="11" cy="11" r="7" />
                          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
                        </svg>
                      </span>
                      <input
                        id={vendorSearchInputId}
                        type="search"
                        value={vendorSearchQuery}
                        onChange={(e) => setVendorSearchQuery(e.target.value)}
                        placeholder="Search by name or trade…"
                        autoComplete="off"
                        className="h-9 w-full rounded-lg border border-transparent bg-white py-1 pl-9 pr-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] shadow-sm outline-none ring-1 ring-[#e5e7eb] placeholder:text-[#717182] focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor={vendorFilterSelectId}
                      className="mb-1.5 block text-[12px] font-medium leading-4 text-[#4a5565]"
                    >
                      Filter by category
                    </label>
                    <div className="relative">
                      <select
                        id={vendorFilterSelectId}
                        value={vendorCategoryFilter}
                        onChange={(e) =>
                          setVendorCategoryFilter(e.target.value as 'all' | VendorTradeCategory)
                        }
                        className="h-9 w-full appearance-none rounded-lg border border-transparent bg-white py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] shadow-sm outline-none ring-1 ring-[#e5e7eb] focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                      >
                        {VENDOR_CATEGORY_FILTER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mb-2 text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                  Select Vendor <span className="text-[#c10007]">*</span>
                </p>
                <div className="flex flex-col gap-2">
                  {filteredVendors.length === 0 ? (
                    <p className="rounded-[10px] border border-dashed border-[#d1d5dc] bg-white px-4 py-6 text-center text-[13px] leading-5 text-[#6a7282]">
                      No vendors match your search or filter.
                    </p>
                  ) : null}
                  {filteredVendors.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVendorId(v.id)}
                      className={[
                        'flex w-full flex-col gap-0 rounded-[10px] border-2 px-[14px] py-3 text-left transition-colors sm:flex-row sm:items-center sm:justify-between',
                        vendorId === v.id ? 'border-[#fe9a00] bg-white' : 'border-[#e5e7eb] bg-white',
                      ].join(' ')}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span
                          className={[
                            'mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                            vendorId === v.id ? 'border-[#fe9a00]' : 'border-[#d1d5dc]',
                          ].join(' ')}
                          aria-hidden
                        >
                          {vendorId === v.id ? (
                            <span className="size-2.5 rounded-full bg-[#fe9a00]" />
                          ) : null}
                        </span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                            {v.name}
                            <span className="text-[12px] font-normal text-[#6a7282]" aria-hidden>
                              •
                            </span>
                            <span className="text-[12px] font-medium text-[#364153]">⭐ {v.rating}</span>
                          </p>
                          <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{v.metaLine}</p>
                        </div>
                      </div>
                      <span
                        className={[
                          'mt-2 inline-flex shrink-0 self-start rounded px-2 py-1 text-[12px] leading-4 sm:mt-0',
                          v.status === 'now'
                            ? 'bg-[#dcfce7] text-[#008236]'
                            : 'bg-[#f3f4f6] text-[#364153]',
                        ].join(' ')}
                      >
                        {v.statusLabel}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {showRentAudienceUrgency ? (
              <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[18px] leading-7" aria-hidden>
                    ⚡
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                      Audience &amp; urgency
                    </p>
                    <p className="text-[12px] leading-4 text-[#6a7282]">
                      Define who receives this reminder and how strongly it reads. Logged with the run.{' '}
                      <span className="text-[#e17100]">(Required for Audit Trail)</span>
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      htmlFor={audienceScopeId}
                      className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                    >
                      Who receives this reminder <span className="text-[#c10007]">*</span>
                    </label>
                    <div className="relative">
                      <select
                        id={audienceScopeId}
                        value={audienceScope}
                        onChange={(e) => setAudienceScope(e.target.value)}
                        className="h-9 w-full appearance-none rounded-lg border border-transparent bg-white py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                      >
                        <option value="">Select audience…</option>
                        <option value="all_upcoming">All residents — upcoming due date</option>
                        <option value="late_cohort">Late / partial pay follow-up list only</option>
                        <option value="open_balance">Residents with any open balance</option>
                        <option value="building_a">Building A only (demo segment)</option>
                      </select>
                      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor={urgencyToneId}
                      className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
                    >
                      Urgency &amp; messaging tone <span className="text-[#c10007]">*</span>
                    </label>
                    <div className="relative">
                      <select
                        id={urgencyToneId}
                        value={urgencyTone}
                        onChange={(e) => setUrgencyTone(e.target.value)}
                        className="h-9 w-full appearance-none rounded-lg border border-transparent bg-white py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
                      >
                        <option value="">Select level…</option>
                        <option value="standard">Standard reminder (policy wording)</option>
                        <option value="escalated">Escalated — stronger copy, same channels</option>
                        <option value="final_pathway">Final notice pathway (compliance review)</option>
                      </select>
                      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-[12px] leading-4 text-[#6a7282]">
                  Narrowing audience may delay notices for excluded residents; escalating tone may require additional disclosures.
                </p>
              </div>
            ) : showRentAutomationControl ? (
              <PauseDisableOverrideActionsPanel
                showAutomationControlHeader
                currentAutomationName="Monthly Rent Reminder"
                rentAutomationAction={rentAutomationAction}
                setRentAutomationAction={setRentAutomationAction}
                pauseDuration={pauseDuration}
                setPauseDuration={setPauseDuration}
                resumeOn={resumeOn}
                setResumeOn={setResumeOn}
                newTriggerTiming={newTriggerTiming}
                setNewTriggerTiming={setNewTriggerTiming}
                pauseDurationId={rentPauseDurationId}
                resumeOnId={rentResumeOnId}
                newTriggerId={rentNewTriggerId}
              />
            ) : null}

            {showImpactWarning ? (
              <div className="rounded-[10px] border-l-4 border-[#fb2c36] bg-[#fef2f2] py-4 pl-5 pr-4">
                <div className="flex gap-3">
                  <svg className="mt-0.5 size-5 shrink-0 text-[#c10007]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01" />
                  </svg>
                  <div>
                    <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#82181a]">
                      Automation Impact Warning
                    </p>
                    <ul className="mt-2 space-y-1 text-[12px] leading-4 text-[#c10007]">
                      {isRentReminder ? (
                        <>
                          <li>Resident-facing rent reminder timing or channels may change</li>
                          <li>Scheduled collections messaging may no longer match the default policy</li>
                          <li>Reporting on on-time payments and reminder cadence may be affected</li>
                        </>
                      ) : (
                        <>
                          <li>AI vendor recommendations will be bypassed</li>
                          <li>Automated routing rules will be disabled for this ticket</li>
                          <li>Performance metrics may be affected</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
              <div className="mb-3 flex items-center gap-2">
                <svg className="size-4 shrink-0 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" />
                  <circle cx="12" cy="7" r="4" strokeLinecap="round" />
                  <path d="M12 14v3M9 21h6" strokeLinecap="round" />
                </svg>
                <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                  Administrator Authorization
                </p>
              </div>
              <label
                htmlFor="override-password"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Confirm Password <span className="text-[#c10007]">*</span>
              </label>
              <input
                id="override-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your admin password to authorize override..."
                className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
              />
              <p className="mt-2 text-[12px] leading-4 text-[#6a7282]">
                🔒 This action requires admin-level authorization and will be permanently logged.
              </p>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!formValid}
            onClick={applyOverride}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#e17100] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none enabled:hover:bg-[#c36100] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <img
              src={overrideIcon}
              alt=""
              className="size-4 shrink-0 object-contain brightness-0 invert"
            />
            Apply Override
          </button>
        </footer>
      </div>
    </div>
  )
}

function AmberRadio({ on }: { on: boolean }) {
  return (
    <span
      className={[
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2',
        on ? 'border-[#fe9a00]' : 'border-[#d1d5dc]',
      ].join(' ')}
      aria-hidden
    >
      {on ? <span className="size-3 rounded-full bg-[#fe9a00]" /> : null}
    </span>
  )
}

function RentAutomationRadio({ on }: { on: boolean }) {
  return (
    <span
      className={[
        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
        on ? 'border-[#fe9a00]' : 'border-[#d1d5dc]',
      ].join(' ')}
      aria-hidden
    >
      {on ? <span className="size-2 rounded-full bg-[#fe9a00]" /> : null}
    </span>
  )
}

function PriorityLevelRadio({ on }: { on: boolean }) {
  return (
    <span
      className={[
        'flex size-4 shrink-0 items-center justify-center rounded-full border-2',
        on ? 'border-[#fe9a00]' : 'border-[#d1d5dc]',
      ].join(' ')}
      aria-hidden
    >
      {on ? <span className="size-2 rounded-full bg-[#fe9a00]" /> : null}
    </span>
  )
}
