export const BETA_PROGRAM = {
  name: 'Ulo Beta',
  version: 'Beta 0.9',
  tagline: 'Full access to every Ulo capability while we build together.',
  priceLabel: 'Free',
  priceNote: 'During beta program',
  status: 'Active',
  memberSince: 'June 2024',
  expiration: 'No expiration during beta',
}

export const BETA_INCLUDED_FEATURES = [
  'Unlimited properties',
  'Unlimited units',
  'Unlimited residents',
  'Unlimited vendors',
  'AI maintenance intake',
  'Workflow automation',
  'Resident messaging',
  'Vendor coordination',
  'Inspection workflows',
  'Rent collection workflows',
] as const

export const BETA_LATEST_IMPROVEMENTS = [
  'AI maintenance intake',
  'Vendor portal',
  'Resident SMS',
  'Inspection automation',
] as const

export const MONTHLY_ACTIVITY_STATS = [
  { id: 'properties', label: 'Properties managed', value: '12' },
  { id: 'residents', label: 'Residents', value: '348' },
  { id: 'work_orders', label: 'Work orders', value: '87' },
  { id: 'workflow_runs', label: 'Workflow runs', value: '1,204' },
  { id: 'sms', label: 'SMS sent', value: '512' },
  { id: 'emails', label: 'Emails sent', value: '2,331' },
  { id: 'inspections', label: 'Inspection reports', value: '24' },
  { id: 'vendor_assignments', label: 'Vendor assignments', value: '76' },
] as const

export const BETA_ACCOMPLISHMENTS = [
  {
    id: 'maintenance',
    value: '142',
    title: 'Maintenance requests automated',
    detail: 'AI intake + dispatch',
  },
  {
    id: 'workflows',
    value: '1,204',
    title: 'Workflow automations completed',
    detail: 'Across all properties',
  },
  {
    id: 'messages',
    value: '2,843',
    title: 'Resident messages delivered',
    detail: 'SMS + email',
  },
  {
    id: 'vendors',
    value: '76',
    title: 'Vendor assignments completed',
    detail: 'Auto-matched',
  },
  {
    id: 'hours',
    value: '218 hrs',
    title: 'Estimated hours saved',
    detail: 'vs. manual operations',
  },
] as const

export const FUTURE_SUBSCRIPTION_FEATURES = [
  'Choose a subscription plan',
  'Add payment methods',
  'Download invoices',
  'Manage billing contacts',
  'View billing history',
  'Purchase add-ons',
] as const

export const FUTURE_BILLING_PREVIEW = [
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'payment', label: 'Payment method' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'history', label: 'Billing history' },
  { id: 'usage', label: 'Usage' },
  { id: 'addons', label: 'Add-ons' },
] as const

export function currentActivityMonthLabel(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
