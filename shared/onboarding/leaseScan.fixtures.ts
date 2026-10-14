import { LEASE_FIELD_NAMES, type LeaseFieldName } from './leaseScan'
export function leaseFixture(pages = [1]) {
  const values = { tenant_names: ['Morgan Tenant'], property_address: '123 Example St', unit: '12A', lease_start: '2026-01-01', lease_end: '2026-12-31', monthly_rent: 1500, security_deposit: 0, rent_due_day: 1 }
  const fields = Object.fromEntries(LEASE_FIELD_NAMES.map(name => [name, { value: values[name], status: 'found', confidence: 96, pages: [pages[0]], quote: 'Lease terms' }])) as Record<LeaseFieldName, { value: unknown; status: string; confidence: number; pages: number[]; quote: string }>
  return { fields, pages_reviewed: pages, landlord_name: 'Example Owner', guarantor_names: [], property_manager_name: null, warnings: [] }
}
