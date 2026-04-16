import { useEffect, useId } from 'react'

type StaffMember = {
  id: string
  initials: string
  name: string
  email: string
  roleLabel: string
  permissions: string[]
  lastLogin: string
  showDelete: boolean
}

const DEMO_STAFF: StaffMember[] = [
  {
    id: '1',
    initials: 'AU',
    name: 'Admin User',
    email: 'admin@property.com',
    roleLabel: 'Property Manager',
    permissions: ['Full Access'],
    lastLogin: '3/29/2026, 8:00:00 AM',
    showDelete: false,
  },
  {
    id: '2',
    initials: 'MC',
    name: 'Maintenance Coordinator',
    email: 'maintenance@property.com',
    roleLabel: 'Maintenance Manager',
    permissions: ['view requests', 'assign vendors', 'update status'],
    lastLogin: '3/29/2026, 7:30:00 AM',
    showDelete: true,
  },
  {
    id: '3',
    initials: 'LA',
    name: 'Leasing Agent',
    email: 'leasing@property.com',
    roleLabel: 'Leasing Agent',
    permissions: ['view residents', 'add residents', 'assign units'],
    lastLogin: '3/28/2026, 4:45:00 PM',
    showDelete: true,
  },
]

function IconShieldHeader({ className = 'size-5 text-[#9810fa]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l8 4v5c0 5.25-3.4 9.74-8 11-4.6-1.26-8-5.75-8-11V7l8-4z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconClose({ className = 'size-5 text-[#6a7282]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function IconUserPlusWhite({ className = 'size-4 shrink-0 text-white' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth={1.65} />
      <path
        d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M19 8v6M22 11h-6"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPencilSmall({ className = 'size-4 text-[#4a5565]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconTrashSmall({ className = 'size-4 text-[#e7000b]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconClockSmall({ className = 'size-3 shrink-0 text-[#6a7282]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

/** Staff Management panel (Figma 129:16839). */
export function ManageStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,900px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-[#e5e7eb] px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3e8ff]">
              <IconShieldHeader />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#101828]"
              >
                Staff Management
              </h2>
              <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">
                Manage staff accounts and permissions
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <IconClose />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 pb-6 pt-6">
          <div className="flex justify-end">
            <button
              type="button"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-[#9810fa] px-4 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-[#8200db] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
            >
              <IconUserPlusWhite />
              Add Staff Member
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {DEMO_STAFF.map((member) => (
              <div
                key={member.id}
                className="rounded-[10px] border border-[#e5e7eb] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#f3e8ff]">
                      <span className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#9810fa]">
                        {member.initials}
                      </span>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                        {member.name}
                      </p>
                      <p className="text-[12px] font-normal leading-4 text-[#4a5565]">{member.email}</p>
                      <span className="inline-flex rounded px-2 py-0.5 text-[12px] font-normal leading-4 text-[#8200db] bg-[#f3e8ff]">
                        {member.roleLabel}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    <button
                      type="button"
                      aria-label={`Edit ${member.name}`}
                      className="flex size-7 items-center justify-center rounded outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                    >
                      <IconPencilSmall />
                    </button>
                    {member.showDelete ? (
                      <button
                        type="button"
                        aria-label={`Remove ${member.name}`}
                        className="flex size-7 items-center justify-center rounded outline-none hover:bg-[#ffe2e2] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                      >
                        <IconTrashSmall />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 rounded bg-[#f9fafb] px-3 pb-3 pt-3">
                  <p className="text-[12px] font-medium leading-4 text-[#364153]">Permissions:</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {member.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="inline-flex items-center rounded border border-[#e5e7eb] bg-white px-2.5 py-1 text-[12px] font-normal leading-4 text-[#364153]"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <IconClockSmall className="size-3 text-[#6a7282]" />
                  <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                    Last login: {member.lastLogin}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-[#e5e7eb] bg-[#f9fafb] px-6 pb-5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-[10px] bg-[#4a5565] px-8 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-[#364153] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
