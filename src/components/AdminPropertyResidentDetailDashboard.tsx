import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { TenantActivationStatusChip } from '@/components/TenantActivationStatusChip'
import {
  EditResidentModal,
  type EditResidentModalRow,
  type EditResidentSavePayload,
} from '@/components/EditResidentModal'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { fetchAdminWorkflowDashboard } from '@/lib/adminWorkflows'
import {
  buildPropertyResidentUnitOptions,
  initialUnitOptionKeyForResident,
  resolveInventoryUnitForResidentSave,
} from '@/lib/propertyResidentUnitOptions'
import {
  buildResidentProfileDetail,
  buildResidentWorkflowSummaries,
  displayResidentEmail,
  isPlaceholderResidentEmail,
  type ResidentCommunicationItem,
  type ResidentProfileDetail,
} from '@/lib/residentProfileDetail'
import { unitOptionKeyToCell } from '@/lib/residentUnitKeys'
import {
  parsePropertyRouteSlug,
  propertyDetailPath,
  propertyResidentDetailPath,
} from '@/lib/propertyRoutes'
import { findPropertyById, findPropertyByName, listPropertiesForLandlord } from '@/lib/properties'
import {
  filterResidentsForPropertyScope,
  filterUnitsForCanonicalProperty,
  mapUnitsForPropertyHealth,
  normalizeBuildingKey,
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
import { loadResidentLeaseDocuments } from '@/lib/residentLeaseDocuments'
import { getErrorMessage } from '@/lib/errorMessage'
import { parseLeaseDateInput } from '@/lib/onboarding'
import {
  syncAssignedUnitOccupancyFromResidentStatus,
} from '@/lib/unitActivation'
import { supabase } from '@/lib/supabase'

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
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
  monthlyRent: number | null
  maintenanceResponsibilitiesClause: string | null
  activationStatus: string | null
  smsConsentStatus: string | null
  activationAttemptCount: number
  activationSmsSentAt: string | null
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

function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4 text-[#6a7282]">
      <path
        d="M14.7 6.3a4 4 0 0 0-5.66 5.66L4 17v3h3l5.04-5.04a4 4 0 0 0 5.66-5.66l-1.41 1.41-2.83-2.83 1.41-1.41z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  children,
}: {
  title: string
  icon: React.ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
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
  leaseDocuments,
  documentPreviewError,
  occupancySaving = false,
  onOccupancyChange,
  onPreviewDocument,
}: {
  profile: ResidentProfileDetail
  leaseDocuments: OrganizationDocument[]
  documentPreviewError: string | null
  occupancySaving?: boolean
  onOccupancyChange?: (status: ResidentOccupancyStatus) => void
  onPreviewDocument: (document: OrganizationDocument) => void
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
          </div>
        </ProfileCard>

        <ProfileCard title="Lease" icon={<DocumentIcon />}>
          <div className="grid grid-cols-2 gap-4">
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
            <div>
              <p className="text-[12px] leading-4 text-[#6a7282]">Lease starts</p>
              <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">{profile.leaseStartLabel}</p>
            </div>
            <div>
              <p className="text-[12px] leading-4 text-[#6a7282]">Lease ends</p>
              <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">{profile.leaseEndLabel}</p>
            </div>
            <div>
              <p className="text-[12px] leading-4 text-[#6a7282]">Monthly rent</p>
              <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">{profile.monthlyRentLabel}</p>
            </div>
            <div>
              <p className="text-[12px] leading-4 text-[#6a7282]">Deposit</p>
              <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">{profile.depositLabel}</p>
            </div>
          </div>

          <div className="mt-5 border-t border-[#f3f4f6] pt-4">
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
                    <li key={document.id} className="flex items-start gap-2 py-2">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#f3f4f6] text-[#364153]">
                        <FileGlyph />
                      </span>
                      <div className="min-w-0">
                        {canPreview ? (
                          <button
                            type="button"
                            className="sa-link block truncate text-left text-[14px] font-medium leading-5 text-[#155dfc] underline-offset-2 hover:underline"
                            onClick={() => onPreviewDocument(document)}
                          >
                            {document.name}
                          </button>
                        ) : (
                          <p className="truncate text-[14px] font-medium leading-5 text-[#0a0a0a]">
                            {document.name}
                          </p>
                        )}
                        <p className="text-[12px] leading-4 text-[#6a7282]">
                          {document.meta}
                          {canPreview ? '' : ' · Preview unavailable'}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
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
        </ProfileCard>

        <ProfileCard title="Workflow summary" icon={<WrenchIcon />}>
          {profile.workflows.length === 0 ? (
            <p className="text-[13px] leading-5 text-[#6a7282]">No open workflows for this resident.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {profile.workflows.map((workflow) => (
                <li
                  key={workflow.id}
                  className="flex items-start justify-between gap-3 rounded-[8px] border border-[#f3f4f6] bg-[#fafafa] px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">{workflow.title}</p>
                    <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{workflow.subtitle}</p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded-[4px] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${workflow.priorityClassName}`}
                  >
                    {workflow.priorityLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ProfileCard>
      </div>

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
    </>
  )
}

export function AdminPropertyResidentDetailDashboard() {
  const { propertySlug, residentId } = useParams<{ propertySlug: string; residentId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [building, setBuilding] = useState<string | null>(null)
  const [propertyId, setPropertyId] = useState<string | null>(null)

  const [profile, setProfile] = useState<ResidentProfileDetail | null>(null)
  const [loadedUser, setLoadedUser] = useState<LoadedResidentUser | null>(null)
  const [buildingUnits, setBuildingUnits] = useState<PropertyUnitOption[]>([])
  const [buildingResidents, setBuildingResidents] = useState<PropertyResidentOption[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [occupancySaving, setOccupancySaving] = useState(false)
  const [resendingActivation, setResendingActivation] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [leaseDocuments, setLeaseDocuments] = useState<OrganizationDocument[]>([])
  const [documentPreviewError, setDocumentPreviewError] = useState<string | null>(null)
  const profileIdRef = useRef<string | null>(null)
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const loadResident = useCallback(async () => {
    const slug = parsePropertyRouteSlug(propertySlug)
    if (!slug || !residentId) {
      setLoading(false)
      setError('Resident not found.')
      return
    }
    if (!supabase) {
      setLoading(false)
      setError("We can't reach the server right now. Please try again in a moment.")
      return
    }

    const switchingResident = profileIdRef.current !== residentId
    if (switchingResident) {
      setLoading(true)
      setProfile(null)
      setLoadedUser(null)
      setLeaseDocuments([])
    }
    setError(null)
    setDocumentPreviewError(null)

    const landlordId = getActiveLandlordId()
    const userSelect =
      'id, resident_id, full_name, email, phone, unit, building, status, balance_due, move_in_date, lease_end_date, monthly_rent, maintenance_responsibilities_clause, activation_status, sms_consent_status, activation_attempt_count, activation_sms_sent_at'

    try {
      const userResult = await supabase
        .from('users')
        .select(userSelect)
        .eq('landlord_id', landlordId)
        .eq('id', residentId)
        .maybeSingle()

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
          .eq('id', residentId)
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
        building: asString(raw.building) || (slug.kind === 'name' ? slug.value : '') || 'Portfolio',
        status: parseResidentStatus(asString(raw.status)),
        balanceDue: asFiniteNumber(raw.balance_due),
        leaseStartDate: asString(raw.move_in_date) || null,
        leaseEndDate: asString(raw.lease_end_date) || null,
        monthlyRent: monthlyRentRaw > 0 ? monthlyRentRaw : null,
        maintenanceResponsibilitiesClause:
          asString(raw.maintenance_responsibilities_clause) || null,
        activationStatus: asString(raw.activation_status) || null,
        smsConsentStatus: asString(raw.sms_consent_status) || null,
        activationAttemptCount: asFiniteNumber(raw.activation_attempt_count),
        activationSmsSentAt: asString(raw.activation_sms_sent_at) || null,
      }

      setBuilding(loaded.building)
      setPropertyId(slug.kind === 'id' ? slug.value : null)
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
            monthlyRent: loaded.monthlyRent,
            maintenanceResponsibilitiesClause: loaded.maintenanceResponsibilitiesClause,
          },
          workflowData: null,
          communications: [],
        }),
      )
      setLoading(false)

      void (async () => {
      const propertyResult =
        slug.kind === 'id'
          ? await findPropertyById(landlordId, slug.value)
          : await findPropertyByName(landlordId, slug.value)

      let buildingName = loaded.building
      let resolvedPropertyId: string | null = slug.kind === 'id' ? slug.value : null
      let activeCanonicalProperty: PropertyHealthCanonicalProperty | null = null

      if (propertyResult.ok && 'property' in propertyResult && propertyResult.property) {
        resolvedPropertyId = propertyResult.property.id
        buildingName = propertyResult.property.name || buildingName
        activeCanonicalProperty = {
          id: propertyResult.property.id,
          name: propertyResult.property.name,
        }
        if (slug.kind === 'name') {
          const nextPath = propertyResidentDetailPath(propertyResult.property.id, residentId)
          const currentPath = `${propertyDetailPath(propertySlug ?? '')}/residents/${encodeURIComponent(residentId)}`
          if (nextPath !== currentPath) {
            navigateRef.current(nextPath, { replace: true })
          }
        }
      } else if (!activeCanonicalProperty && buildingName) {
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

      const { data: conversationRows, error: conversationsError } = await supabase
        .from('sms_conversations')
        .select('id, updated_at, conversation_type, status')
        .eq('landlord_id', landlordId)
        .eq('resident_id', residentId)
        .order('updated_at', { ascending: false })
        .limit(10)

      const communications: ResidentCommunicationItem[] =
        conversationsError == null
          ? ((conversationRows ?? []) as Record<string, unknown>[]).map((row) => {
              const typeLabel = conversationTypeLabel(asString(row.conversation_type))
              const statusLabel = conversationStatusLabel(asString(row.status) || 'open')
              return {
                id: asString(row.id),
                preview: `${typeLabel} · ${statusLabel}`,
                channel: typeLabel,
                dateLabel: formatCommDate(asString(row.updated_at)),
              }
            })
          : []

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
            .select('id, unit, building, status')
            .eq('landlord_id', landlordId)
            .neq('status', 'past_resident')
            .limit(300),
          fetchAdminWorkflowDashboard({ residentId }).catch(() => null),
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

        if (workflowDashboard) {
          setProfile((current) =>
            current && current.id === loaded.id
              ? {
                  ...current,
                  workflows: buildResidentWorkflowSummaries(loaded.id, workflowDashboard),
                }
              : current,
          )
        }

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


  const backFallbackHref = useMemo(
    () =>
      propertyId
        ? propertyDetailPath(propertyId, 'residents')
        : '/admin/residents',
    [propertyId],
  )

  function handleBack() {
    const from = (location.state as { from?: string } | null)?.from
    if (typeof from === 'string' && from.startsWith('/')) {
      navigate(from)
      return
    }
    const historyIdx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof historyIdx === 'number' && historyIdx > 0) {
      navigate(-1)
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

    const unitCell = unitOptionKeyToCell(payload.unitOptionKey)
    const assigned =
      unitCell.kind === 'assigned'
        ? resolveInventoryUnitForResidentSave(buildingUnits, {
            unit: unitCell.unit,
            building: unitCell.building,
          })
        : null
    const previousPhone = loadedUser?.phone ?? null
    const { error: updateError } = await supabase
      .from('users')
      .update({
        full_name: payload.fullName,
        email: payload.email,
        phone: payload.phone ?? null,
        status: payload.status,
        unit: assigned?.unitLabel ?? null,
        building: assigned?.building ?? null,
        move_in_date: parseLeaseDateInput(payload.leaseStart),
        lease_end_date: parseLeaseDateInput(payload.leaseEnd),
      })
      .eq('id', payload.id)
      .eq('landlord_id', getActiveLandlordId())

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

    setEditOpen(false)
    await loadResident()
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

  const activationChip = loadedUser
    ? resolveTenantActivationChip({
        activationStatus: loadedUser.activationStatus,
        smsConsentStatus: loadedUser.smsConsentStatus,
        activationAttemptCount: loadedUser.activationAttemptCount,
        activationSmsSentAt: loadedUser.activationSmsSentAt,
      })
    : null

  const showStartOnboarding =
    activationChip &&
    activationChip.status !== 'activated' &&
    activationChip.status !== 'opted_out' &&
    activationChip.status !== 'waiting'

  async function handleStartOnboarding() {
    if (!loadedUser || !activationChip) return
    setActionError(null)
    setResendingActivation(true)
    const result = activationChip.actionRequired
      ? await resendTenantActivationSms({ residentId: loadedUser.id })
      : await sendTenantWelcomeSms({ residentId: loadedUser.id })
    setResendingActivation(false)
    if (!result.ok || (result.failed ?? 0) > 0) {
      setActionError(
        result.error ||
          'Welcome text could not be delivered. Check the phone number and try again.',
      )
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
                  <div className="mt-3 flex flex-col gap-2">
                    <TenantActivationStatusChip chip={activationChip} />
                    {showStartOnboarding ? (
                      <button
                        type="button"
                        disabled={resendingActivation}
                        onClick={() => void handleStartOnboarding()}
                        className="sa-press inline-flex h-9 w-fit items-center rounded-[10px] bg-[#187960] px-4 text-[13px] font-medium leading-5 text-white hover:bg-[#146b52] disabled:opacity-50"
                      >
                        {resendingActivation ? 'Sending…' : 'Start onboarding'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="sa-press inline-flex h-9 items-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 text-[13px] font-medium leading-5 text-[#101828] hover:bg-[#f9fafb]"
                >
                  Edit profile
                </button>
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
                leaseDocuments={leaseDocuments}
                documentPreviewError={documentPreviewError}
                occupancySaving={occupancySaving}
                onOccupancyChange={(status) => void handleOccupancyChange(status)}
                onPreviewDocument={(document) => {
                  setDocumentPreviewError(null)
                  void openOrganizationDocumentPreview(document).then((result) => {
                    if (!result.ok) setDocumentPreviewError(result.error)
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
      />
    </main>
  )
}

export default AdminPropertyResidentDetailDashboard
