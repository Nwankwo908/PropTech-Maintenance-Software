/**
 * Shared fixtures for onboarding unit tests (not used in production).
 */
import { defaultOnboardingApprovalRules } from '@/lib/onboardingApprovalRules'
import type { OnboardingResident } from './persist/residents'
import type { OnboardingVendor } from './persist/vendors'
import type { LandlordOnboardingState } from './types'

export const TEST_LANDLORD_ID = '11111111-1111-4111-8111-111111111111'

export function validOnboardingState(
  patch?: Partial<LandlordOnboardingState>,
): LandlordOnboardingState {
  return {
    landlordId: TEST_LANDLORD_ID,
    onboardingStatus: 'in_progress',
    currentStep: 'review',
    setupPath: 'guided',
    accountSetup: {
      companyName: 'Acme Properties',
      contactName: 'Alex Manager',
      email: 'alex@acme.test',
      phone: '+12025550100',
      backupContactName: '',
      backupContactPhone: '',
      smsConsentAcceptedAt: '2026-01-01T00:00:00.000Z',
    },
    properties: [
      {
        id: 'prop-1',
        name: 'Maple Court',
        streetAddress: '100 Maple St',
        city: 'Atlanta',
        state: 'GA',
        zipCode: '30301',
        unitCount: 4,
      },
    ],
    approvalRules: defaultOnboardingApprovalRules(),
    completedAt: null,
    ...patch,
  }
}

export function sampleResident(
  patch?: Partial<OnboardingResident>,
): OnboardingResident {
  return {
    id: 'res-1',
    residentId: 'ONB11111111-001',
    fullName: 'Jamie Tenant',
    unit: '101',
    building: 'Maple Court',
    email: 'jamie@example.com',
    phone: '+12025550111',
    monthlyRent: 1850,
    rentDueDay: 1,
    leaseStart: '2025-01-01',
    leaseEnd: '2026-01-01',
    maintenanceResponsibilitiesClause: null,
    occupancyStatus: 'active',
    ...patch,
  }
}

export function sampleVendor(patch?: Partial<OnboardingVendor>): OnboardingVendor {
  return {
    id: 'vendor-1',
    name: 'Flex Plumbing',
    category: 'plumbing',
    email: 'jobs@flex.test',
    phone: '+12025550122',
    city: 'Atlanta',
    state: 'GA',
    country: 'United States',
    preferredEmergency: true,
    ...patch,
  }
}
