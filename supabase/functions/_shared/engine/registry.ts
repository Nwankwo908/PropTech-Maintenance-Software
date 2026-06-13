import type { WorkflowTemplate, WorkflowTemplateId } from "./types.ts"
import { maintenanceIntakeTemplate } from "./templates/maintenance.ts"
import { leaseRenewalTemplate } from "./templates/leaseRenewal.ts"
import { rentCollectionTemplate } from "./templates/rentCollection.ts"
import { vendorJobResponseTemplate } from "./templates/vendorResponse.ts"
import {
  identityOnboardingTemplate,
  landlordCommandTemplate,
} from "./templates/onboarding.ts"

const TEMPLATES: Record<WorkflowTemplateId, WorkflowTemplate> = {
  maintenance_intake: maintenanceIntakeTemplate,
  lease_renewal: leaseRenewalTemplate,
  rent_collection: rentCollectionTemplate,
  vendor_job_response: vendorJobResponseTemplate,
  identity_onboarding: identityOnboardingTemplate,
  landlord_command: landlordCommandTemplate,
}

export function getWorkflowTemplate(id: WorkflowTemplateId): WorkflowTemplate {
  return TEMPLATES[id]
}

export function listWorkflowTemplates(): WorkflowTemplate[] {
  return Object.values(TEMPLATES)
}
