import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { syncSmsIdentity } from '@/api/landlordSmsOnboarding'
import {
  EditResidentModal,
  type EditResidentModalRow,
  type EditResidentSavePayload,
} from '@/components/EditResidentModal'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { fetchAdminWorkflowDashboard, type AdminWorkflowDashboardData } from '@/lib/adminWorkflows'
import {
  buildPropertyResidentUnitOptions,
  initialUnitOptionKeyForResident,
} from '@/lib/propertyResidentUnitOptions'
import {
  buildResidentProfileDetail,
  RESIDENT_STANDING_STYLES,
  type ResidentCommunicationItem,
  type ResidentProfileDetail,
} from '@/lib/residentProfileDetail'
import { unitOptionKeyToCell } from '@/lib/residentUnitKeys'
import {
  buildingDetailPath,
  parseBuildingSlug,
} from '@/lib/propertyRoutes'
import { normalizeBuildingKey } from '@/lib/propertyHealth'
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

type ResidentStatus = 'active' | 'pending' | 'past_resident' | 'suspended'

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
  leaseEndDate: string | null
}

type PropertyUnitOption = {
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
  const normalized = value.toLowerCase()
  if (
    normalized === 'active' ||
    normalized === 'pending' ||
    normalized === 'past_resident' ||
    normalized === 'suspended'
  ) {
    return normalized
  }
  return 'active'
}

function toEditResidentRow(user: LoadedResidentUser): EditResidentModalRow {
  return {
    id: user.id,
    residentId: user.residentId,
    name: user.fullName,
    email: user.email,
    phone: user.phone ?? undefined,
    unit: user.unit.trim()
      ? { kind: 'assigned', unit: user.unit, building: user.building }
      : { kind: 'unassigned' },
    status: user.status,
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

function ProfileContent({ profile }: { profile: ResidentProfileDetail }) {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-3">
        <ProfileCard title="Personal info" icon={<PersonIcon />}>
          <div className="flex flex-col gap-4">
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
                  <p key={`${pet.name}-${pet.species}`} className="mt-1 text-[14px] leading-5 text-[#364153]">
                    {pet.name} · {pet.species} · {pet.breed}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </ProfileCard>

        <ProfileCard title="Lease" icon={<DocumentIcon />}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[12px] leading-4 text-[#6a7282]">Status</p>
              <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">{profile.leaseStatus}</p>
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
            <p className="text-[12px] leading-4 text-[#6a7282]">Maintenance responsibility</p>
            <p className="mt-2 text-[13px] leading-5 text-[#364153]">
              <span className="font-medium text-[#0a0a0a]">Tenant:</span> {profile.tenantMaintenance}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-[#364153]">
              <span className="font-medium text-[#0a0a0a]">Landlord:</span> {profile.landlordMaintenance}
            </p>
          </div>

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
              <li
                key={item.id}
                className="flex items-start justify-between gap-3 border-b border-[#f3f4f6] pb-3 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-[14px] leading-5 text-[#364153]">{item.preview}</p>
                  <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{item.channel}</p>
                </div>
                <span className="shrink-0 text-[12px] leading-4 text-[#9ca3af]">{item.dateLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

export function AdminPropertyResidentDetailDashboard() {
  const { buildingSlug, residentId } = useParams<{ buildingSlug: string; residentId: string }>()
  const navigate = useNavigate()
  const building = parseBuildingSlug(buildingSlug)

  const [workflowData, setWorkflowData] = useState<AdminWorkflowDashboardData | null>(null)
  const [profile, setProfile] = useState<ResidentProfileDetail | null>(null)
  const [loadedUser, setLoadedUser] = useState<LoadedResidentUser | null>(null)
  const [buildingUnits, setBuildingUnits] = useState<PropertyUnitOption[]>([])
  const [buildingResidents, setBuildingResidents] = useState<PropertyResidentOption[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadResident = useCallback(async () => {
    if (!building || !residentId) {
      setLoading(false)
      setError('Resident not found.')
      return
    }
    if (!supabase) {
      setLoading(false)
      setError('Supabase is not configured.')
      return
    }

    setLoading(true)
    setError(null)

    const landlordId = getActiveLandlordId()
    const [userResult, workflowDashboard, conversationsResult, unitsResult, residentsResult] =
      await Promise.all([
      supabase
        .from('users')
        .select(
          'id, resident_id, full_name, email, phone, unit, building, status, balance_due, lease_end_date',
        )
        .eq('landlord_id', landlordId)
        .eq('id', residentId)
        .maybeSingle(),
      fetchAdminWorkflowDashboard().catch(() => null),
      supabase
        .from('sms_conversations')
        .select('id, updated_at, conversation_type, status')
        .eq('landlord_id', landlordId)
        .eq('resident_id', residentId)
        .order('updated_at', { ascending: false })
        .limit(10),
      supabase
        .from('units')
        .select('unit_label, building')
        .eq('landlord_id', landlordId)
        .limit(2000),
      supabase
        .from('users')
        .select('id, unit, building, status')
        .eq('landlord_id', landlordId)
        .neq('status', 'past_resident')
        .limit(2000),
    ])

    if (userResult.error || !userResult.data) {
      setError(userResult.error?.message ?? 'Resident not found.')
      setProfile(null)
      setLoadedUser(null)
      setLoading(false)
      return
    }

    const raw = userResult.data as Record<string, unknown>
    const userBuilding = asString(raw.building) || building
    if (userBuilding && userBuilding.toLowerCase() !== building.toLowerCase()) {
      setError('Resident does not belong to this property.')
      setProfile(null)
      setLoadedUser(null)
      setLoading(false)
      return
    }

    const userId = asString(raw.id)
    const loaded: LoadedResidentUser = {
      id: userId,
      residentId:
        asString(raw.resident_id) ||
        `RES-${userId.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      fullName: asString(raw.full_name) || 'Unnamed resident',
      email: asString(raw.email),
      phone: asString(raw.phone) || null,
      unit: asString(raw.unit),
      building: userBuilding,
      status: parseResidentStatus(asString(raw.status)),
      balanceDue: asFiniteNumber(raw.balance_due),
      leaseEndDate: asString(raw.lease_end_date) || null,
    }

    const communications: ResidentCommunicationItem[] =
      conversationsResult.error == null
        ? ((conversationsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
            id: asString(row.id),
            preview: `${asString(row.conversation_type) || 'Conversation'} · ${asString(row.status) || 'open'}`,
            channel: asString(row.conversation_type) || 'SMS',
            dateLabel: formatCommDate(asString(row.updated_at)),
          }))
        : []

    setWorkflowData(workflowDashboard)
    setLoadedUser(loaded)
    setBuildingUnits(
      unitsResult.error
        ? []
        : ((unitsResult.data ?? []) as Record<string, unknown>[])
            .map((row) => ({
              unitLabel: asString(row.unit_label),
              building: asString(row.building) || building,
            }))
            .filter(
              (row) => normalizeBuildingKey(row.building) === normalizeBuildingKey(building),
            ),
    )
    setBuildingResidents(
      residentsResult.error
        ? []
        : ((residentsResult.data ?? []) as Record<string, unknown>[])
            .map((row) => ({
              id: asString(row.id),
              unit: asString(row.unit),
              building: asString(row.building) || building,
              status: asString(row.status).toLowerCase() || 'active',
            }))
            .filter(
              (row) => normalizeBuildingKey(row.building) === normalizeBuildingKey(building),
            ),
    )
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
          leaseEndDate: loaded.leaseEndDate,
        },
        workflowData: workflowDashboard,
        communications,
      }),
    )
    setLoading(false)
  }, [building, residentId])

  useEffect(() => {
    void loadResident()
  }, [loadResident])

  const backHref = useMemo(
    () => (building ? buildingDetailPath(building, 'residents') : '/admin/properties'),
    [building],
  )

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
    return initialUnitOptionKeyForResident(loadedUser.unit, loadedUser.building)
  }, [loadedUser])

  async function handleResidentSave(payload: EditResidentSavePayload) {
    if (!supabase) throw new Error('Supabase is not configured.')
    setActionError(null)

    const unitCell = unitOptionKeyToCell(payload.unitOptionKey)
    const { error: updateError } = await supabase
      .from('users')
      .update({
        full_name: payload.fullName,
        email: payload.email,
        phone: payload.phone ?? null,
        status: payload.status,
        unit: unitCell.kind === 'assigned' ? unitCell.unit : null,
        building: unitCell.kind === 'assigned' ? unitCell.building : null,
      })
      .eq('id', payload.id)
      .eq('landlord_id', getActiveLandlordId())

    if (updateError) {
      setActionError(updateError.message)
      throw new Error(updateError.message)
    }

    if (payload.phone?.trim()) {
      void syncSmsIdentity({
        phone: payload.phone,
        identityType: 'resident',
        residentId: payload.id,
        unitLabel: unitCell.kind === 'assigned' ? unitCell.unit : null,
        building: unitCell.kind === 'assigned' ? unitCell.building : null,
      })
    }

    setEditOpen(false)
    await loadResident()
  }

  async function handleDeleteResident() {
    if (!loadedUser || !supabase) return
    const confirmed = window.confirm(
      `Delete ${loadedUser.fullName}? This removes their profile from your roster.`,
    )
    if (!confirmed) return

    setActionError(null)
    setDeleteSaving(true)

    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', loadedUser.id)
      .eq('landlord_id', getActiveLandlordId())

    if (deleteError) {
      setActionError(deleteError.message)
      setDeleteSaving(false)
      return
    }

    navigate(backHref)
  }

  if (!building) {
    return (
      <main className="flex min-h-0 flex-1 flex-col px-8 pb-12 pt-6">
        <p className="text-[14px] text-[#6a7282]">Property not found.</p>
        <Link to="/admin/properties" className="mt-3 text-[14px] font-medium text-[#186179]">
          ← All properties
        </Link>
      </main>
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="py-6">
        <Link
          to={backHref}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#6a7282] transition-colors hover:text-[#101828]"
        >
          <span aria-hidden>←</span> Back to {profile?.buildingShort ?? building.replace(/\s+Apartments$/i, '')}
        </Link>

        {loading ? (
          <div className="mt-6">
            <p className="text-[14px] text-[#6a7282]">Loading resident…</p>
          </div>
        ) : error || !profile ? (
          <div className="mt-6">
            <p className="text-[14px] text-[#6a7282]">{error ?? 'Resident not found.'}</p>
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
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-[4px] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${RESIDENT_STANDING_STYLES[profile.standing]}`}
                >
                  {profile.standingLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="inline-flex h-9 items-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 text-[13px] font-medium leading-5 text-[#101828] transition-colors hover:bg-[#f9fafb]"
                >
                  Edit profile
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteResident()}
                  disabled={deleteSaving}
                  className="inline-flex h-9 items-center rounded-[10px] border border-[#fecaca] bg-white px-4 text-[13px] font-medium leading-5 text-[#b91c1c] transition-colors hover:bg-[#fef2f2] disabled:opacity-50"
                >
                  {deleteSaving ? 'Deleting…' : 'Delete resident'}
                </button>
              </div>
            </div>

            {actionError ? (
              <div className="mt-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
                {actionError}
              </div>
            ) : null}

            <div className="mt-6">
              <ProfileContent profile={profile} />
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
