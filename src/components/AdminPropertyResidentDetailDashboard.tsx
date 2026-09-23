import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { syncSmsIdentity } from '@/api/landlordSmsOnboarding'
import {
  phoneChanged,
  restartTenantOnboardingAfterPhoneChange,
  resetTenantActivationForPhoneChange,
  resendTenantActivationSms,
  sendTenantWelcomeSms,
} from '@/api/tenantActivation'
import { ResidentOccupancySelect } from '@/components/ResidentOccupancySelect'
import { ResidentLeaseCalendar } from '@/components/ResidentLeaseCalendar'
import { SmartIntelligenceCard } from '@/components/SmartIntelligenceCard'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'
import { TenantActivationStatusChip } from '@/components/TenantActivationStatusChip'
import { SetupOutreachAckModal } from '@/components/SetupOutreachAckModal'
import {
  EditResidentModal,
  type EditResidentModalRow,
  type EditResidentSavePayload,
} from '@/components/EditResidentModal'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { fetchAdminWorkflowDashboard, type AdminWorkflowDashboardData } from '@/lib/adminWorkflows'
import {
  fetchPropertyOperationsTimeline,
  type PropertyOperationsTimelineEvent,
} from '@/lib/propertyOperationsGraph'
import { resolveTenantActivationChip } from '@/lib/tenantActivationStatus'
import {
  buildPropertyResidentUnitOptions,
  initialUnitOptionKeyForResident,
  residentPlacementUpdateForSave,
  resolveInventoryUnitForResidentSave,
} from '@/lib/propertyResidentUnitOptions'
import {
  buildResidentProfileDetail,
  displayResidentEmail,
  isPlaceholderResidentEmail,
  otherOccupantsOnSamePlace,
  residentEmailPatchForSave,
  residentPlaceLabel,
  type ResidentCommunicationItem,
  type ResidentProfileDetail,
} from '@/lib/residentProfileDetail'
import {
  parsePropertyRouteSlug,
  propertyDetailPath,
  propertyResidentDetailPath,
  residentDetailPath,
} from '@/lib/propertyRoutes'
import { findPropertyById, findPropertyByName, listPropertiesForLandlord } from '@/lib/properties'
import {
  filterResidentsForPropertyScope,
  filterUnitsForCanonicalProperty,
  mapUnitsForPropertyHealth,
  normalizeBuildingKey,
  normalizeUnitLabel,
  type PropertyHealthCanonicalProperty,
} from '@/lib/propertyHealth'
import {
  conversationStatusLabel,
  conversationTypeLabel,
} from '@/lib/propertyConversations'
import {
  normalizeResidentOccupancyStatus,
  type ResidentOccupancyStatus,
} from '@/lib/residentOccupancy'
import {
  openOrganizationDocumentPreview,
  type OrganizationDocument,
} from '@/lib/organizationSettings'
import { loadResidentLeaseDocuments, uploadResidentLeaseDocuments } from '@/lib/residentLeaseDocuments'
import {
  fetchResidentMaintenanceCalendarEvents,
  fetchResidentOpenMaintenanceTickets,
} from '@/lib/residentScheduledVisits'
import { buildSmartIntelligence, type SmartInsight, type SmartIntelligenceTicket } from '@/lib/smartIntelligence'
import { getErrorMessage, isUniqueViolation } from '@/lib/errorMessage'
import { parseLeaseDateInput, parseRentDueDayInput } from '@/lib/onboarding'
import { parseIsoDateOnly, type ResidentCalendarEvent } from '@/lib/residentLeaseCalendar'
import {
  syncAssignedUnitOccupancyFromResidentStatus,
} from '@/lib/unitActivation'
import { deleteResidentsForLandlord } from '@/lib/residentDeletion'
import { supabase } from '@/lib/supabase'

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asLeaseDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const iso = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    return parseIsoDateOnly(iso)
  }
  return parseIsoDateOnly(asString(value))
}

function asRentDueDay(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const day = Math.trunc(value)
    return day >= 1 && day <= 31 ? day : null
  }
  return parseRentDueDayInput(asString(value))
}

function asFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

type ResidentStatus = ResidentOccupancyStatus

type LoadedResidentUser = {
  id: string
  residentId: string
  fullName: string
  email: string
  phone: string | null
  unit: string
  building: string
  status: ResidentStatus
  balanceDue: number
  leaseStartDate: string | null
  leaseEndDate: string | null
  rentDueDay: number | null
  monthlyRent: number | null
  maintenanceResponsibilitiesClause: string | null
  activationStatus: string | null
  smsConsentStatus: string | null
  activationAttemptCount: number
  activationSmsSentAt: string | null
  lastActivationAttemptAt: string | null
  firstActivationAttemptAt: string | null
}

type PropertyUnitOption = {
  id?: string
  unitLabel: string
  building: string | null
}

type PropertyResidentOption = {
  id: string
  unit: string
  building: string | null
  status: string
}

function parseResidentStatus(value: string): ResidentStatus {
  return normalizeResidentOccupancyStatus(value)
}

function toEditResidentRow(user: LoadedResidentUser): EditResidentModalRow {
  return {
    id: user.id,
    residentId: user.residentId,
    name: user.fullName,
    email: displayResidentEmail(user.email) ?? '',
    phone: user.phone ?? undefined,
    unit: user.unit.trim()
      ? { kind: 'assigned', unit: user.unit, building: user.building }
      : { kind: 'unassigned' },
    status: user.status,
    leaseStart: user.leaseStartDate,
    leaseEnd: user.leaseEndDate,
    rentDueDay: user.rentDueDay,
  }
}

function formatCommDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4 text-[#6a7282]">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4 text-[#6a7282]">
      <path d="M8 4h8l4 4v12H8V4z" strokeLinejoin="round" />
      <path d="M16 4v4h4" strokeLinejoin="round" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4 text-[#6a7282]">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinejoin="round" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4 shrink-0 text-[#9ca3af]">
      <path d="M6.5 4h3l1.5 5-2 1.5a11 11 0 0 0 5 5l1.5-2 5 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 4 8.5 2 2 0 0 1 6.5 4z" strokeLinejoin="round" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4 shrink-0 text-[#9ca3af]">
      <path d="M4 6h16v12H4V6zm0 0l8 6 8-6" strokeLinejoin="round" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-3.5 text-[#9ca3af]">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v5M12 8h.01" strokeLinecap="round" />
    </svg>
  )
}

function PawIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5 text-[#9ca3af]">
      <circle cx="8" cy="8" r="2" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="6" cy="13" r="1.8" />
      <circle cx="18" cy="13" r="1.8" />
      <path d="M12 20c3-2.5 4.5-5 4.5-7.5a4.5 4.5 0 0 0-9 0C7.5 15 9 17.5 12 20z" />
    </svg>
  )
}

function DollarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4 text-[#9ca3af]">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" />
    </svg>
  )
}

function ProfileCard({
  title,
  icon,
  id,
  children,
}: {
  title: string
  icon: React.ReactNode
  id?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="min-w-0 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function FileGlyph() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4.5 2.5H9.5L12.5 5.5V13.5H4.5V2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9.5 2.5V5.5H12.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function ProfileContent({
  profile,
  insights,
  leaseDocuments,
  documentPreviewError,
  occupancySaving = false,
  limitedAlpha1 = false,
  operationsEvents = [],
  visitEvents = [],
  onboarding = null,
  occupantProfilePath,
  occupantProfileState,
  onOccupancyChange,
  onPreviewDocument,
  onEditResident,
}: {
  profile: ResidentProfileDetail
  insights: SmartInsight[]
  leaseDocuments: OrganizationDocument[]
  documentPreviewError: string | null
  occupancySaving?: boolean
  limitedAlpha1?: boolean
  operationsEvents?: PropertyOperationsTimelineEvent[]
  visitEvents?: ResidentCalendarEvent[]
  onboarding?: {
    residentId: string
    activationStatus?: string | null
    smsConsentStatus?: string | null
    activationAttemptCount?: number | null
    activationSmsSentAt?: string | null
    lastActivationAttemptAt?: string | null
    firstActivationAttemptAt?: string | null
  } | null
  occupantProfilePath?: (residentId: string) => string
  occupantProfileState?: { from: string }
  onOccupancyChange?: (status: ResidentOccupancyStatus) => void
  onPreviewDocument?: (document: OrganizationDocument) => void
  onEditResident?: () => void
}) {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-3">
        <ProfileCard title="Personal info" icon={<PersonIcon />}>
          <div className="flex flex-col gap-4">
            {!profile.phone && !profile.email && !profile.emergencyContact && profile.pets.length === 0 ? (
              <p className="text-[13px] leading-5 text-[#6a7282]">No contact details on file.</p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {profile.phone ? (
                    <div className="flex items-center gap-2 text-[14px] leading-5 text-[#364153]">
                      <PhoneIcon />
                      {profile.phone}
                    </div>
                  ) : null}
                  {profile.email ? (
                    <div className="flex items-center gap-2 text-[14px] leading-5 text-[#364153]">
                      <MailIcon />
                      {profile.email}
                    </div>
                  ) : null}
                </div>

                {profile.emergencyContact ? (
                  <div>
                    <div className="flex items-center gap-1.5 text-[12px] leading-4 text-[#6a7282]">
                      <InfoIcon />
                      Emergency contact
                    </div>
                    <p className="mt-1 text-[14px] font-medium leading-5 text-[#0a0a0a]">
                      {profile.emergencyContact.name} · {profile.emergencyContact.relationship}
                    </p>
                    <p className="text-[13px] leading-5 text-[#364153]">{profile.emergencyContact.phone}</p>
                  </div>
                ) : null}

                {profile.pets.length > 0 ? (
                  <div>
                    <div className="flex items-center gap-1.5 text-[12px] leading-4 text-[#6a7282]">
                      <PawIcon />
                      Pets
                    </div>
                    {profile.pets.map((pet) => (
                      <p
                        key={`${pet.name}-${pet.species}`}
                        className="mt-1 text-[14px] leading-5 text-[#364153]"
                      >
                        {pet.name} · {pet.species} · {pet.breed}
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            )}

            <div className="border-t border-[#f3f4f6] pt-4">
              <p className="text-[12px] leading-4 text-[#6a7282]">Documents</p>
              {documentPreviewError ? (
                <p className="mt-2 text-[13px] leading-5 text-[#b91c1c]">{documentPreviewError}</p>
              ) : null}
              {leaseDocuments.length === 0 ? (
                <p className="mt-2 text-[13px] leading-5 text-[#6a7282]">No lease documents on file.</p>
              ) : (
                <ul className="mt-2 flex flex-col">
                  {leaseDocuments.map((document) => {
                    const canPreview = Boolean(
                      document.previewUrl || (document.storageBucket && document.storagePath),
                    )
                    return (
                      <li key={document.id} className="flex min-w-0 items-start gap-2 py-2">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#f3f4f6] text-[#364153]">
                          <FileGlyph />
                        </span>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          {canPreview && onPreviewDocument ? (
                            <button
                              type="button"
                              className="sa-link block w-full text-left text-[14px] font-medium leading-5 text-[#155dfc] underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                              onClick={() => onPreviewDocument(document)}
                            >
                              {document.name}
                            </button>
                          ) : (
                            <p className="text-[14px] font-medium leading-5 text-[#0a0a0a] [overflow-wrap:anywhere]">
                              {document.name}
                            </p>
                          )}
                          <p className="text-[12px] leading-4 text-[#6a7282] [overflow-wrap:anywhere]">
                            {document.meta}
                            {canPreview && onPreviewDocument ? '' : ' · Preview unavailable'}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </ProfileCard>

        <ProfileCard id="resident-lease" title="Lease" icon={<DocumentIcon />}>
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[12px] leading-4 text-[#6a7282]">Status</p>
              {onOccupancyChange ? (
                <div className="mt-1">
                  <ResidentOccupancySelect
                    value={profile.occupancyStatus}
                    disabled={occupancySaving}
                    onChange={onOccupancyChange}
                    aria-label="Occupancy status"
                    className="sa-surface h-9 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-1 pl-3 pr-9 text-[14px] font-semibold leading-5 text-[#0a0a0a] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              ) : (
                <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                  {profile.leaseStatus}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[12px] leading-4 text-[#6a7282]">Lease starts</p>
                <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                  {profile.leaseStartLabel}
                </p>
              </div>
              <div>
                <p className="text-[12px] leading-4 text-[#6a7282]">Lease ends</p>
                <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                  {profile.leaseEndLabel}
                </p>
              </div>
              <div>
                <p className="text-[12px] leading-4 text-[#6a7282]">Monthly rent</p>
                <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                  {profile.monthlyRentLabel}
                </p>
              </div>
              <div>
                <p className="text-[12px] leading-4 text-[#6a7282]">Rent due</p>
                <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                  {profile.rentDueDayLabel}
                </p>
              </div>
            </div>
          </div>

          {profile.maintenanceResponsibilitiesClause ||
          profile.tenantMaintenance ||
          profile.landlordMaintenance ? (
            <div className="mt-5 border-t border-[#f3f4f6] pt-4">
              <p className="text-[12px] leading-4 text-[#6a7282]">Maintenance responsibility</p>
              {profile.maintenanceResponsibilitiesClause ? (
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[#364153]">
                  {profile.maintenanceResponsibilitiesClause}
                </p>
              ) : null}
              {profile.tenantMaintenance ? (
                <p className="mt-2 text-[13px] leading-5 text-[#364153]">
                  <span className="font-medium text-[#0a0a0a]">Tenant:</span> {profile.tenantMaintenance}
                </p>
              ) : null}
              {profile.landlordMaintenance ? (
                <p className="mt-1 text-[13px] leading-5 text-[#364153]">
                  <span className="font-medium text-[#0a0a0a]">Landlord:</span>{' '}
                  {profile.landlordMaintenance}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between border-t border-[#f3f4f6] pt-4">
            <div className="flex items-center gap-2">
              <DollarIcon />
              <span className="text-[13px] font-medium text-[#364153]">Balance</span>
            </div>
            <span className="text-[22px] font-bold leading-7 tabular-nums text-[#0a0a0a]">
              {profile.balanceLabel}
            </span>
          </div>

          {profile.otherOccupants.length > 0 ? (
            <div className="mt-4">
              <p className="text-[12px] leading-4 text-[#6a7282]">
                {profile.otherOccupants.length === 1 ? 'Other occupant' : 'Other occupants'}
              </p>
              <p className="mt-1 min-w-0 text-[14px] font-medium leading-5 text-[#155dfc] [overflow-wrap:anywhere]">
                {profile.otherOccupants.map((occupant, index) => (
                  <span key={occupant.id}>
                    {index > 0 ? ', ' : null}
                    <Link
                      to={(typeof occupantProfilePath === 'function'
                        ? occupantProfilePath
                        : residentDetailPath)(occupant.id)}
                      state={occupantProfileState}
                      className="sa-link underline-offset-2 hover:underline"
                    >
                      {occupant.name}
                    </Link>
                  </span>
                ))}
              </p>
            </div>
          ) : null}
        </ProfileCard>

        <SmartIntelligenceCard
          insights={insights}
          onEditResident={onEditResident}
        />
      </div>

      <ResidentLeaseCalendar
        leaseStartDate={profile.leaseStartDate}
        leaseEndDate={profile.leaseEndDate}
        rentDueDay={profile.rentDueDay}
        rowTitle={profile.name}
        rowSubtitle={profile.unitDisplay}
        operationsEvents={operationsEvents}
        visitEvents={visitEvents}
        onboarding={onboarding}
      />

      {limitedAlpha1 ? null : (
      <section className="mt-4 rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-2">
          <ChatIcon />
          <h2 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">Communication history</h2>
        </div>
        {profile.communications.length === 0 ? (
          <p className="mt-8 pb-4 text-center text-[13px] leading-5 text-[#6a7282]">No conversations yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {profile.communications.map((item) => (
              <li key={item.id} className="border-b border-[#f3f4f6] pb-3 last:border-b-0 last:pb-0">
                <Link
                  to={`/admin/communication?thread=${encodeURIComponent(item.id)}`}
                  className="sa-row group flex items-start justify-between gap-3 rounded-[8px] px-1 py-0.5 hover:bg-[#f9fafb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#186179]"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] leading-5 text-[#364153] group-hover:text-[#186179] group-hover:underline">
                      {item.preview}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{item.channel}</p>
                  </div>
                  <span className="shrink-0 text-[12px] leading-4 text-[#9ca3af]">{item.dateLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </>
  )
}

export function AdminPropertyResidentDetailDashboard() {
  const { propertySlug, residentId } = useParams<{ propertySlug?: string; residentId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [building, setBuilding] = useState<string | null>(null)
  const [propertyId, setPropertyId] = useState<string | null>(null)

  const [profile, setProfile] = useState<ResidentProfileDetail | null>(null)
  const [loadedUser, setLoadedUser] = useState<LoadedResidentUser | null>(null)
  const [buildingUnits, setBuildingUnits] = useState<PropertyUnitOption[]>([])
  const [buildingResidents, setBuildingResidents] = useState<PropertyResidentOption[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const deleteConfirmTitleId = useId()
  const [actionError, setActionError] = useState<string | null>(null)
  const [occupancySaving, setOccupancySaving] = useState(false)
  const [resendingActivation, setResendingActivation] = useState(false)
  const [setupOutreachAckOpen, setSetupOutreachAckOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [leaseDocuments, setLeaseDocuments] = useState<OrganizationDocument[]>([])
  const [operationsEvents, setOperationsEvents] = useState<PropertyOperationsTimelineEvent[]>([])
  const [visitEvents, setVisitEvents] = useState<ResidentCalendarEvent[]>([])
  const [workflowData, setWorkflowData] = useState<AdminWorkflowDashboardData | null>(null)
  const [maintenanceTickets, setMaintenanceTickets] = useState<SmartIntelligenceTicket[]>([])
  const [documentPreviewError, setDocumentPreviewError] = useState<string | null>(null)
  const profileIdRef = useRef<string | null>(null)
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const locationStateRef = useRef(location.state)
  locationStateRef.current = location.state

  const loadResident = useCallback(async () => {
    const resolvedResidentId = (() => {
      if (!residentId?.trim()) return ''
      try {
        return decodeURIComponent(residentId.trim())
      } catch {
        return residentId.trim()
      }
    })()
    if (!resolvedResidentId) {
      setLoading(false)
      setError('Resident not found.')
      return
    }
    const slug = propertySlug ? parsePropertyRouteSlug(propertySlug) : null
    // Property-scoped URLs must have a valid slug; global /admin/residents/:id is allowed.
    if (propertySlug && !slug) {
      setLoading(false)
      setError('Resident not found.')
      return
    }
    if (!supabase) {
      setLoading(false)
      setError("We can't reach the server right now. Please try again in a moment.")
      return
    }

    const switchingResident = profileIdRef.current !== resolvedResidentId
    if (switchingResident) {
      setLoading(true)
      setProfile(null)
      setLoadedUser(null)
      setLeaseDocuments([])
      setOperationsEvents([])
      setVisitEvents([])
      setWorkflowData(null)
      setMaintenanceTickets([])
    }
    setError(null)
    setDocumentPreviewError(null)

    const landlordId = getActiveLandlordId()
    const userSelect =
      'id, resident_id, full_name, email, phone, unit, building, status, balance_due, move_in_date, lease_end_date, monthly_rent, rent_due_day, maintenance_responsibilities_clause, activation_status, sms_consent_status, activation_attempt_count, activation_sms_sent_at, last_activation_attempt_at, first_activation_attempt_at'

    try {
      let userResult = await supabase
        .from('users')
        .select(userSelect)
        .eq('landlord_id', landlordId)
        .eq('id', resolvedResidentId)
        .maybeSingle()

      // Also accept human-readable resident_id (RES-XXXX) in the URL.
      if ((userResult.error || !userResult.data) && resolvedResidentId !== '') {
        const byCode = await supabase
          .from('users')
          .select(userSelect)
          .eq('landlord_id', landlordId)
          .eq('resident_id', resolvedResidentId)
          .maybeSingle()
        if (!byCode.error && byCode.data) {
          userResult = byCode
        }
      }

      let raw: Record<string, unknown> | null =
        userResult.error || !userResult.data
          ? null
          : (userResult.data as Record<string, unknown>)

      if (!raw && userResult.error && /column .* does not exist/i.test(userResult.error.message)) {
        const legacy = await supabase
          .from('users')
          .select(
            'id, resident_id, full_name, email, phone, unit, building, status, balance_due, move_in_date, lease_end_date, monthly_rent',
          )
          .eq('landlord_id', landlordId)
          .eq('id', resolvedResidentId)
          .maybeSingle()
        if (legacy.error || !legacy.data) {
          setError(getErrorMessage(legacy.error, "We couldn't find that resident."))
          setProfile(null)
          setLoadedUser(null)
          setLoading(false)
          return
        }
        raw = legacy.data as Record<string, unknown>
      } else if (!raw) {
        setError(getErrorMessage(userResult.error, "We couldn't find that resident."))
        setProfile(null)
        setLoadedUser(null)
        setLoading(false)
        return
      }

      const userId = asString(raw.id)
      const monthlyRentRaw = asFiniteNumber(raw.monthly_rent)
      let email = asString(raw.email)
      if (isPlaceholderResidentEmail(email)) {
        void supabase
          .from('users')
          .update({ email: '' })
          .eq('id', userId)
          .eq('landlord_id', landlordId)
        email = ''
      }

      const loaded: LoadedResidentUser = {
        id: userId,
        residentId:
          asString(raw.resident_id) ||
          `RES-${userId.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
        fullName: asString(raw.full_name) || 'Unnamed resident',
        email,
        phone: asString(raw.phone) || null,
        unit: asString(raw.unit),
        building: asString(raw.building) || (slug?.kind === 'name' ? slug.value : ''),
        status: parseResidentStatus(asString(raw.status)),
        balanceDue: asFiniteNumber(raw.balance_due),
        leaseStartDate: asLeaseDate(raw.move_in_date),
        leaseEndDate: asLeaseDate(raw.lease_end_date),
        rentDueDay: asRentDueDay(raw.rent_due_day),
        monthlyRent: monthlyRentRaw > 0 ? monthlyRentRaw : null,
        maintenanceResponsibilitiesClause:
          asString(raw.maintenance_responsibilities_clause) || null,
        activationStatus: asString(raw.activation_status) || null,
        smsConsentStatus: asString(raw.sms_consent_status) || null,
        activationAttemptCount: asFiniteNumber(raw.activation_attempt_count),
        activationSmsSentAt: asString(raw.activation_sms_sent_at) || null,
        lastActivationAttemptAt: asString(raw.last_activation_attempt_at) || null,
        firstActivationAttemptAt: asString(raw.first_activation_attempt_at) || null,
      }

      setBuilding(loaded.building)
      setPropertyId(slug?.kind === 'id' ? slug.value : null)
      setLoadedUser(loaded)
      profileIdRef.current = loaded.id
      setProfile(
        buildResidentProfileDetail({
          user: {
            id: loaded.id,
            fullName: loaded.fullName,
            email: loaded.email,
            phone: loaded.phone,
            unit: loaded.unit,
            building: loaded.building,
            status: loaded.status,
            balanceDue: loaded.balanceDue,
            leaseStartDate: loaded.leaseStartDate,
            leaseEndDate: loaded.leaseEndDate,
            rentDueDay: loaded.rentDueDay,
            monthlyRent: loaded.monthlyRent,
            maintenanceResponsibilitiesClause: loaded.maintenanceResponsibilitiesClause,
          },
          workflowData: null,
          communications: [],
        }),
      )
      setLoading(false)

      void (async () => {
      let buildingName = loaded.building
      let resolvedPropertyId: string | null = slug?.kind === 'id' ? slug.value : null
      let activeCanonicalProperty: PropertyHealthCanonicalProperty | null = null

      if (slug) {
        const propertyResult =
          slug.kind === 'id'
            ? await findPropertyById(landlordId, slug.value)
            : await findPropertyByName(landlordId, slug.value)

        if (propertyResult.ok && 'property' in propertyResult && propertyResult.property) {
          resolvedPropertyId = propertyResult.property.id
          buildingName = propertyResult.property.name || buildingName
          activeCanonicalProperty = {
            id: propertyResult.property.id,
            name: propertyResult.property.name,
          }
          if (slug.kind === 'name') {
            const nextPath = propertyResidentDetailPath(propertyResult.property.id, loaded.id)
            const currentPath = `${propertyDetailPath(propertySlug ?? '')}/residents/${encodeURIComponent(resolvedResidentId)}`
            if (nextPath !== currentPath) {
              navigateRef.current(nextPath, {
                replace: true,
                state: locationStateRef.current,
              })
            }
          }
        }
      }

      if (!activeCanonicalProperty && buildingName) {
        const propertiesResult = await listPropertiesForLandlord(landlordId)
        const match = propertiesResult.ok
          ? propertiesResult.properties.find(
              (property) =>
                normalizeBuildingKey(property.name) === normalizeBuildingKey(buildingName),
            )
          : null
        if (match) {
          activeCanonicalProperty = { id: match.id, name: match.name }
          resolvedPropertyId = match.id
        }
      }

      const skipCommunicationHistory = isLimitedAlpha1Landlord(landlordId)
      const communications: ResidentCommunicationItem[] = skipCommunicationHistory
        ? []
        : await (async () => {
            const { data: conversationRows, error: conversationsError } = await supabase
              .from('sms_conversations')
              .select('id, updated_at, conversation_type, status')
              .eq('landlord_id', landlordId)
              .eq('resident_id', loaded.id)
              .order('updated_at', { ascending: false })
              .limit(10)

            if (conversationsError != null) return []
            return ((conversationRows ?? []) as Record<string, unknown>[]).map((row) => {
              const typeLabel = conversationTypeLabel(asString(row.conversation_type))
              const statusLabel = conversationStatusLabel(asString(row.status) || 'open')
              return {
                id: asString(row.id),
                preview: `${typeLabel} · ${statusLabel}`,
                channel: typeLabel,
                dateLabel: formatCommDate(asString(row.updated_at)),
              }
            })
          })()

      if (profileIdRef.current !== loaded.id) return

      setBuilding(buildingName)
      setPropertyId(resolvedPropertyId)
      setLoadedUser((current) =>
        current && current.id === loaded.id ? { ...current, building: buildingName } : current,
      )
      setProfile((current) =>
        current && current.id === loaded.id
          ? {
              ...current,
              building: buildingName,
              buildingShort: residentPlaceLabel(buildingName),
              communications,
            }
          : current,
      )

      const lookupName = activeCanonicalProperty?.name ?? buildingName
        let unitsQuery = supabase
          .from('units')
          .select('id, unit_label, building, property_id')
          .eq('landlord_id', landlordId)
        if (resolvedPropertyId) {
          unitsQuery = unitsQuery.eq('property_id', resolvedPropertyId)
        }
        const [unitsResult, residentsResult, workflowDashboard] = await Promise.all([
          unitsQuery.limit(200),
          supabase
            .from('users')
            .select('id, full_name, unit, building, status')
            .eq('landlord_id', landlordId)
            .neq('status', 'past_resident')
            .limit(300),
          fetchAdminWorkflowDashboard({ residentId: loaded.id }).catch(() => null),
          loadResidentLeaseDocuments(
            {
              fullName: loaded.fullName,
              unit: loaded.unit,
              building: loaded.building,
              phone: loaded.phone,
              email: loaded.email,
            },
            landlordId,
          )
            .then((docs) => {
              if (profileIdRef.current === loaded.id) setLeaseDocuments(docs)
            })
            .catch((documentError) => {
              console.warn('[resident-profile] lease documents', documentError)
              if (profileIdRef.current === loaded.id) setLeaseDocuments([])
            }),
        ])

        if (profileIdRef.current !== loaded.id) return

        const occupantRows = ((residentsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: asString(row.id),
          fullName: asString(row.full_name),
          unit: asString(row.unit),
          building: asString(row.building) || null,
          status: asString(row.status),
        }))
        const otherOccupants = otherOccupantsOnSamePlace({
          residentId: loaded.id,
          unit: loaded.unit,
          building: buildingName || loaded.building,
          residents: occupantRows,
        })

        if (workflowDashboard) {
          setWorkflowData(workflowDashboard)
        } else {
          setWorkflowData(null)
        }
        setProfile((current) =>
          current && current.id === loaded.id ? { ...current, otherOccupants } : current,
        )

        const healthUnits = mapUnitsForPropertyHealth(
          ((unitsResult.data ?? []) as Record<string, unknown>[]) ?? [],
        )
        const scopedUnits = activeCanonicalProperty
          ? filterUnitsForCanonicalProperty(healthUnits, activeCanonicalProperty)
          : healthUnits.filter(
              (unit) =>
                normalizeBuildingKey(unit.building) === normalizeBuildingKey(loaded.building),
            )

        setBuildingUnits(
          unitsResult.error
            ? []
            : scopedUnits.map((unit) => ({
                id: unit.id,
                unitLabel: unit.unitLabel,
                building: unit.building || loaded.building,
              })),
        )

        const residentUnitId =
          scopedUnits.find(
            (unit) =>
              normalizeUnitLabel(unit.unitLabel) === normalizeUnitLabel(loaded.unit),
          )?.id ?? null
        void fetchPropertyOperationsTimeline({
          scope: residentUnitId
            ? { unitId: residentUnitId, residentId: loaded.id }
            : { residentId: loaded.id },
          landlordId,
          limit: 500,
        })
          .then((rows) => {
            if (profileIdRef.current === loaded.id) setOperationsEvents(rows)
          })
          .catch((timelineError) => {
            console.warn('[resident-profile] operations calendar', timelineError)
            if (profileIdRef.current === loaded.id) setOperationsEvents([])
          })
        void fetchResidentMaintenanceCalendarEvents({
          landlordId,
          residentId: loaded.id,
          residentName: loaded.fullName,
          unitLabel: loaded.unit,
        })
          .then((rows) => {
            if (profileIdRef.current === loaded.id) setVisitEvents(rows)
          })
          .catch((visitError) => {
            console.warn('[resident-profile] visit calendar', visitError)
            if (profileIdRef.current === loaded.id) setVisitEvents([])
          })
        void fetchResidentOpenMaintenanceTickets({
          landlordId,
          residentId: loaded.id,
          residentName: loaded.fullName,
          unitLabel: loaded.unit,
        })
          .then((rows) => {
            if (profileIdRef.current === loaded.id) setMaintenanceTickets(rows)
          })
          .catch((ticketError) => {
            console.warn('[resident-profile] maintenance intelligence', ticketError)
            if (profileIdRef.current === loaded.id) setMaintenanceTickets([])
          })
        const scopedBuildingResidents = filterResidentsForPropertyScope(
          residentsResult.error
            ? []
            : ((residentsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
                id: asString(row.id),
                fullName: 'Resident',
                unit: asString(row.unit),
                building: asString(row.building) || null,
                status: asString(row.status).toLowerCase() || 'active',
              })),
          lookupName,
          activeCanonicalProperty,
          healthUnits,
        )
        setBuildingResidents(
          scopedBuildingResidents.map((row) => ({
            id: row.id,
            unit: row.unit,
            building: row.building || loaded.building,
            status: row.status,
          })),
        )
      })().catch((backgroundError) => {
        console.warn('[resident-profile] background', backgroundError)
      })
    } catch (loadError) {
      console.error('[resident-profile] load', loadError)
      setError(getErrorMessage(loadError, "We couldn't load this resident."))
      setLoading(false)
    }
  }, [propertySlug, residentId])

  useEffect(() => {
    void loadResident().catch((loadError) => {
      console.error('[resident-profile] load', loadError)
      setError(getErrorMessage(loadError, "We couldn't load this resident."))
      setLoading(false)
    })
  }, [loadResident])

  useEffect(() => {
    if (!actionsOpen) return
    function handlePointerDown(event: MouseEvent) {
      if (!actionsMenuRef.current?.contains(event.target as Node)) setActionsOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setActionsOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [actionsOpen])

  useEffect(() => {
    if (!deleteConfirmOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleteSaving) setDeleteConfirmOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [deleteConfirmOpen, deleteSaving])

  const backFallbackHref = useMemo(() => {
    // Property-scoped profile URLs fall back to that property. Global /admin/residents/:id
    // (including other-occupant hops) always returns to the Residents list.
    if (propertySlug) {
      if (propertyId) return propertyDetailPath(propertyId)
      return propertyDetailPath(propertySlug)
    }
    return '/admin/residents'
  }, [propertyId, propertySlug])

  function handleBack() {
    const from = (location.state as { from?: string } | null)?.from
    if (typeof from === 'string' && from.startsWith('/') && from !== location.pathname) {
      // Never bounce between resident profiles — other-occupant hops should exit to the list.
      if (
        /\/admin\/residents\/[^/?#]+$/.test(from) ||
        /\/admin\/properties\/[^/]+\/residents\/[^/?#]+$/.test(from)
      ) {
        navigate('/admin/residents')
        return
      }
      navigate(from)
      return
    }
    navigate(backFallbackHref)
  }

  const editResidentRow = useMemo(
    () => (editOpen && loadedUser ? toEditResidentRow(loadedUser) : null),
    [editOpen, loadedUser],
  )

  const editUnitOptions = useMemo(
    () =>
      buildPropertyResidentUnitOptions({
        building: building ?? '',
        units: buildingUnits,
        residents: buildingResidents,
        editingResidentId: loadedUser?.id ?? null,
      }),
    [building, buildingUnits, buildingResidents, loadedUser?.id],
  )

  const editInitialUnitKey = useMemo(() => {
    if (!loadedUser?.unit.trim()) return ''
    return initialUnitOptionKeyForResident(loadedUser.unit, loadedUser.building, buildingUnits)
  }, [loadedUser, buildingUnits])

  async function handleResidentSave(payload: EditResidentSavePayload) {
    if (!supabase) throw new Error("We can't reach the server right now. Please try again in a moment.")
    setActionError(null)

    const previousUnit = loadedUser?.unit.trim() ?? ''
    const previousBuilding = loadedUser?.building.trim() ?? ''
    const placement = residentPlacementUpdateForSave({
      unitAssignmentChanged: payload.unitAssignmentChanged,
      submittedUnitKey: payload.unitOptionKey,
      previousUnit,
      previousBuilding,
      units: buildingUnits,
      fallbackBuilding: building ?? '',
    })
    const assigned =
      placement && placement.unit
        ? resolveInventoryUnitForResidentSave(buildingUnits, {
            unit: placement.unit,
            building: placement.building ?? '',
          })
        : !placement && previousUnit
          ? resolveInventoryUnitForResidentSave(buildingUnits, {
              unit: previousUnit,
              building: previousBuilding,
            })
          : null
    const previousPhone = loadedUser?.phone ?? null
    const emailPatch = residentEmailPatchForSave(payload.email, loadedUser?.email)
    const updatePayload: Record<string, unknown> = {
      full_name: payload.fullName,
      phone: payload.phone ?? null,
      status: payload.status,
      move_in_date: parseLeaseDateInput(payload.leaseStart),
      lease_end_date: parseLeaseDateInput(payload.leaseEnd),
      rent_due_day: payload.rentDueDay,
    }
    if (placement) {
      updatePayload.unit = placement.unit
      updatePayload.building = placement.building
    }
    if (emailPatch !== undefined) {
      updatePayload.email = emailPatch
    }

    let { error: updateError } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', payload.id)
      .eq('landlord_id', getActiveLandlordId())

    // Blank emails are often shared. If a leftover unique index still fires, save
    // the rest of the profile instead of blocking the edit.
    if (
      updateError &&
      emailPatch !== undefined &&
      isUniqueViolation(updateError) &&
      /email/i.test(updateError.message ?? '')
    ) {
      const submitted = payload.email.trim()
      const current = displayResidentEmail(loadedUser?.email) ?? ''
      if (!submitted || submitted === current) {
        const { email: _ignored, ...withoutEmail } = updatePayload
        const retry = await supabase
          .from('users')
          .update(withoutEmail)
          .eq('id', payload.id)
          .eq('landlord_id', getActiveLandlordId())
        updateError = retry.error
      }
    }

    if (updateError) {
      setActionError(getErrorMessage(updateError, 'Something went wrong. Please try again.'))
      throw new Error(getErrorMessage(updateError, 'Something went wrong. Please try again.'))
    }

    if (assigned) {
      const occupancyResult = await syncAssignedUnitOccupancyFromResidentStatus({
        landlordId: getActiveLandlordId(),
        residentId: payload.id,
        unitId: assigned.unitId,
        unitLabel: assigned.unitLabel,
        building: assigned.building,
        status: payload.status,
        residentName: payload.fullName,
        source: 'edit_resident',
      })
      if (!occupancyResult.ok) {
        setActionError(occupancyResult.error)
      }
    }

    if (payload.phone?.trim()) {
      void syncSmsIdentity({
        phone: payload.phone,
        identityType: 'resident',
        residentId: payload.id,
        unitId: assigned?.unitId ?? null,
        unitLabel: assigned?.unitLabel ?? null,
        building: assigned?.building ?? null,
      })
    }

    if (phoneChanged(previousPhone, payload.phone)) {
      if (payload.restartOnboarding && payload.phone?.trim()) {
        const result = await restartTenantOnboardingAfterPhoneChange({
          landlordId: getActiveLandlordId(),
          residentId: payload.id,
        })
        if (!result.ok || (result.failed ?? 0) > 0) {
          setActionError(
            result.error ||
              'Resident saved, but the welcome text could not be delivered. You can start onboarding again from this page.',
          )
        }
      } else {
        await resetTenantActivationForPhoneChange({
          landlordId: getActiveLandlordId(),
          residentId: payload.id,
        })
      }
    }

    if (payload.leaseDocumentFiles && payload.leaseDocumentFiles.length > 0) {
      const unitLabel =
        placement?.unit?.trim() ||
        (!placement ? previousUnit : '') ||
        loadedUser?.unit.trim() ||
        ''
      const buildingLabel =
        (placement?.building ?? '').trim() ||
        (!placement ? previousBuilding : '') ||
        loadedUser?.building.trim() ||
        ''
      const docsResult = await uploadResidentLeaseDocuments({
        landlordId: getActiveLandlordId(),
        residentId: payload.id,
        resident: {
          fullName: payload.fullName,
          unit: unitLabel,
          building: buildingLabel,
          phone: payload.phone,
          email: payload.email,
        },
        files: payload.leaseDocumentFiles,
      })
      if (!docsResult.ok) {
        setActionError(docsResult.error)
        throw new Error(docsResult.error)
      }
    }

    setEditOpen(false)
    await loadResident()
  }

  async function deleteResidentAccount() {
    if (!loadedUser || deleteSaving) return
    setActionError(null)
    setDeleteSaving(true)
    const result = await deleteResidentsForLandlord({
      landlordId: getActiveLandlordId(),
      residentIds: [loadedUser.id],
    })
    if (!result.ok) {
      setActionError(result.error)
      setDeleteSaving(false)
      throw new Error(result.error)
    }
    setDeleteConfirmOpen(false)
    setEditOpen(false)
    setDeleteSaving(false)
    navigate('/admin/residents')
  }

  async function handleResidentDelete(_row: EditResidentModalRow) {
    await deleteResidentAccount()
  }

  async function handleOccupancyChange(next: ResidentOccupancyStatus) {
    if (!loadedUser || !supabase) return
    if (next === loadedUser.status) return
    setActionError(null)
    setOccupancySaving(true)
    const landlordId = getActiveLandlordId()
    const assigned = loadedUser.unit.trim()
      ? resolveInventoryUnitForResidentSave(buildingUnits, {
          unit: loadedUser.unit,
          building: loadedUser.building,
        })
      : null
    const { error: updateError } = await supabase
      .from('users')
      .update({ status: next })
      .eq('id', loadedUser.id)
      .eq('landlord_id', landlordId)
    if (updateError) {
      setActionError(getErrorMessage(updateError, 'Could not update occupancy. Please try again.'))
      setOccupancySaving(false)
      return
    }
    const occupancyResult = await syncAssignedUnitOccupancyFromResidentStatus({
      landlordId,
      residentId: loadedUser.id,
      unitId: assigned?.unitId ?? null,
      unitLabel: assigned?.unitLabel ?? loadedUser.unit,
      building: assigned?.building ?? loadedUser.building,
      status: next,
      residentName: loadedUser.fullName,
      source: 'resident_profile',
    })
    setOccupancySaving(false)
    if (!occupancyResult.ok) {
      setActionError(occupancyResult.error)
    }
    await loadResident()
  }

  const insights = useMemo(() => {
    if (!profile) return []
    return buildSmartIntelligence({
      resident: {
        id: profile.id,
        name: profile.name,
        unitDisplay: profile.unitDisplay,
        balanceDue: profile.balanceDue,
        monthlyRent: loadedUser?.monthlyRent ?? null,
        rentDueDay: profile.rentDueDay,
        leaseStartDate: profile.leaseStartDate,
        leaseEndDate: profile.leaseEndDate,
        activationStatus: loadedUser?.activationStatus ?? null,
      },
      propertyId,
      workflowData,
      tickets: maintenanceTickets,
      communicationThreadId: profile.communications[0]?.id ?? null,
    })
  }, [profile, loadedUser, propertyId, workflowData, maintenanceTickets])

  const activationChip = loadedUser
    ? resolveTenantActivationChip({
        activationStatus: loadedUser.activationStatus,
        smsConsentStatus: loadedUser.smsConsentStatus,
        activationAttemptCount: loadedUser.activationAttemptCount,
        activationSmsSentAt: loadedUser.activationSmsSentAt,
      })
    : null

  const canSendOnboardingSms = Boolean(loadedUser?.phone?.trim())
  const retryOnboarding = Boolean(
    activationChip && activationChip.status !== 'not_started',
  )

  async function handleStartOnboarding() {
    if (!loadedUser || !activationChip || !canSendOnboardingSms) return
    setActionError(null)
    setResendingActivation(true)
    const restartConsent =
      activationChip.status === 'activated' || activationChip.status === 'opted_out'
    if (restartConsent) {
      await resetTenantActivationForPhoneChange({ residentId: loadedUser.id })
    }
    const result = retryOnboarding
      ? await resendTenantActivationSms({ residentId: loadedUser.id })
      : await sendTenantWelcomeSms({ residentId: loadedUser.id })
    setResendingActivation(false)
    if (!result.ok || (result.failed ?? 0) > 0 || (result.sent ?? 0) === 0) {
      setActionError(
        result.error ||
          'Welcome text could not be delivered. Check the phone number and try again.',
      )
    } else {
      const { notifySetupSuccessProgressChanged } = await import('@/lib/setupSuccessChecklist')
      notifySetupSuccessProgressChanged()
    }
    await loadResident()
  }

  if (loading && !profile) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center px-8 py-12">
        <p className="text-[14px] text-[#6a7282]">Loading resident…</p>
      </main>
    )
  }

  if (error && !profile) {
    return (
      <main className="flex min-h-0 flex-1 flex-col px-8 pb-12 pt-6">
        <p className="text-[14px] text-[#6a7282]">{error}</p>
        <Link to="/admin/residents" className="sa-link mt-3 text-[14px] font-medium text-[#186179]">
          ← Residents
        </Link>
      </main>
    )
  }

  if (!profile) {
    return (
      <main className="flex min-h-0 flex-1 flex-col px-8 pb-12 pt-6">
        <p className="text-[14px] text-[#6a7282]">Resident not found.</p>
        <Link to="/admin/residents" className="sa-link mt-3 text-[14px] font-medium text-[#186179]">
          ← Residents
        </Link>
      </main>
    )
  }

  return (
    <main className="property-resident-detail-enter flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="py-6">
        <button
          type="button"
          onClick={handleBack}
          className="sa-link inline-flex items-center gap-1 text-[13px] font-medium text-[#6a7282] hover:text-[#101828]"
        >
          <span aria-hidden>←</span> Back
        </button>

        {error ? (
          <div className="mt-6">
            <p className="text-[14px] text-[#6a7282]">{error}</p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
                  {profile.name}
                </h1>
                <p className="mt-1 text-[14px] leading-5 text-[#6a7282]">
                  {profile.buildingShort} · {profile.unitDisplay}
                </p>
                {activationChip ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={resendingActivation || !canSendOnboardingSms}
                      onClick={() => setSetupOutreachAckOpen(true)}
                      className="sa-press inline-flex h-9 w-fit items-center rounded-[10px] bg-[#187960] px-4 text-[13px] font-medium leading-5 text-white hover:bg-[#146b52] disabled:opacity-50"
                    >
                      {resendingActivation
                        ? 'Sending…'
                        : retryOnboarding
                          ? 'Retry setup'
                          : 'Setup Resident'}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {activationChip ? <TenantActivationStatusChip chip={activationChip} /> : null}
                <div ref={actionsMenuRef} className="relative">
                  <button
                    type="button"
                    aria-label="Resident actions"
                    aria-haspopup="menu"
                    aria-expanded={actionsOpen}
                    onClick={() => setActionsOpen((open) => !open)}
                    className="sa-press inline-flex size-9 items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white text-[#364153] hover:bg-[#f9fafb]"
                  >
                    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <circle cx="12" cy="5" r="1.75" />
                      <circle cx="12" cy="12" r="1.75" />
                      <circle cx="12" cy="19" r="1.75" />
                    </svg>
                  </button>
                  {actionsOpen ? (
                    <div
                      role="menu"
                      className="sa-enter absolute right-0 z-20 mt-1.5 min-w-[160px] overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.12)]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="sa-press block w-full cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-[#0a0a0a] hover:bg-[#f3f4f6]"
                        onClick={() => {
                          setActionsOpen(false)
                          setEditOpen(true)
                        }}
                      >
                        Edit profile
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="sa-press block w-full cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-[#b91c1c] hover:bg-[#fef2f2]"
                        onClick={() => {
                          setActionsOpen(false)
                          setActionError(null)
                          setDeleteConfirmOpen(true)
                        }}
                      >
                        Delete tenant
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {actionError ? (
              <div className="mt-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
                {actionError}
              </div>
            ) : null}

            <div className="mt-6">
              <ProfileContent
                profile={profile}
                insights={insights}
                leaseDocuments={leaseDocuments}
                documentPreviewError={documentPreviewError}
                occupancySaving={occupancySaving}
                limitedAlpha1={isLimitedAlpha1Landlord(getActiveLandlordId())}
                operationsEvents={operationsEvents}
                visitEvents={visitEvents}
                onboarding={
                  loadedUser
                    ? {
                        residentId: loadedUser.id,
                        activationStatus: loadedUser.activationStatus,
                        smsConsentStatus: loadedUser.smsConsentStatus,
                        activationAttemptCount: loadedUser.activationAttemptCount,
                        activationSmsSentAt: loadedUser.activationSmsSentAt,
                        lastActivationAttemptAt: loadedUser.lastActivationAttemptAt,
                        firstActivationAttemptAt: loadedUser.firstActivationAttemptAt,
                      }
                    : null
                }
                occupantProfilePath={(id) => residentDetailPath(id)}
                occupantProfileState={{
                  from: '/admin/residents',
                }}
                onEditResident={() => setEditOpen(true)}
                onOccupancyChange={(status) => {
                  void handleOccupancyChange(status)
                }}
                onPreviewDocument={(document) => {
                  void openOrganizationDocumentPreview(document).then((result) => {
                    setDocumentPreviewError(result.ok ? null : result.error)
                  })
                }}
              />
            </div>
          </>
        )}
      </div>

      <EditResidentModal
        row={editResidentRow}
        unitOptions={editUnitOptions}
        initialUnitOptionKey={editInitialUnitKey}
        onClose={() => setEditOpen(false)}
        onSave={handleResidentSave}
        onDelete={handleResidentDelete}
      />

      {deleteConfirmOpen ? (
        <div className="fixed inset-0 z-[81] flex items-center justify-center bg-black/40 p-4">
          <div
            role="presentation"
            className="absolute inset-0"
            aria-hidden
            onClick={() => {
              if (!deleteSaving) setDeleteConfirmOpen(false)
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={deleteConfirmTitleId}
            className="relative flex w-full max-w-[440px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#e5e7eb] px-6 py-4">
              <h2
                id={deleteConfirmTitleId}
                className="text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#0a0a0a]"
              >
                Delete tenant account?
              </h2>
            </div>
            <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                This permanently removes{' '}
                <span className="font-medium text-[#0a0a0a]">
                  {loadedUser?.fullName.trim() || 'this resident'}
                </span>{' '}
                from your roster and their tenant account. This cannot be undone.
              </p>
              {actionError ? (
                <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                  {actionError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  disabled={deleteSaving || !loadedUser}
                  className="inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#b52a00] outline-none transition-colors hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 sm:flex-initial"
                  onClick={() => {
                    void deleteResidentAccount().catch(() => {})
                  }}
                >
                  {deleteSaving ? 'Deleting…' : 'Yes, delete tenant'}
                </button>
                <button
                  type="button"
                  disabled={deleteSaving}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  onClick={() => {
                    if (!deleteSaving) setDeleteConfirmOpen(false)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <SetupOutreachAckModal
        open={setupOutreachAckOpen}
        kind="resident"
        retry={retryOnboarding}
        saving={resendingActivation}
        onClose={() => {
          if (resendingActivation) return
          setSetupOutreachAckOpen(false)
        }}
        onConfirm={() => {
          void (async () => {
            await handleStartOnboarding()
            setSetupOutreachAckOpen(false)
          })()
        }}
      />
    </main>
  )
}

export default AdminPropertyResidentDetailDashboard
