import { useEffect, useId, useState } from 'react'
import { isDemoAccountActive } from '@/lib/activeLandlord'

export type AssignUnitModalRow = {
  residentId: string
  name: string
}

type AvailableUnit = {
  id: string
  unit: string
  building: string
}

/** Demo inventory (Figma 130:20369). Replace with API data when wired. */
const DEMO_AVAILABLE_UNITS: AvailableUnit[] = [
  { id: 'u1', unit: '3C', building: 'Building A' },
  { id: 'u2', unit: '4A', building: 'Building A' },
  { id: 'u3', unit: '6B', building: 'Building B' },
  { id: 'u4', unit: '7C', building: 'Building B' },
  { id: 'u5', unit: '10D', building: 'Building C' },
  { id: 'u6', unit: '11A', building: 'Building C' },
]

function IconKeyHeader({ className = 'size-5 text-extended-1' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10.5 10.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM10.5 10.5L6 22l2-1 1-4 2 1 1-4 2 1 3-6"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconAi({ className = 'size-4 shrink-0 text-extended-1' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v2M12 19v2M4 12H2m20 0h-2m-3.05-6.95l1.42-1.42M6.34 17.66l-1.42 1.42m12.02 0l1.42-1.42M6.34 6.34L4.93 4.93M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconCheckCircle({ className = 'size-4 shrink-0 text-extended-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.65} />
      <path d="M8.5 12l2.5 2.5L15.5 10" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Assign unit rail (Figma 130:20369). */
export function AssignUnitModal({
  row,
  onClose,
}: {
  row: AssignUnitModalRow | null
  onClose: () => void
}) {
  const titleId = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const residentId = row?.residentId ?? ''
  const [prevResidentId, setPrevResidentId] = useState(residentId)
  if (residentId !== prevResidentId) {
    setPrevResidentId(residentId)
    if (residentId) setSelectedId(null)
  }

  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose])

  if (!row) return null

  const availableUnits = isDemoAccountActive() ? DEMO_AVAILABLE_UNITS : []
  const selected = availableUnits.find((u) => u.id === selectedId)

  function assign() {
    if (!selectedId) return
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,640px)] flex-col overflow-hidden border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-secondary px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-extended-2">
              <IconKeyHeader />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3"
              >
                Assign Unit
              </h2>
              <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-neutral">
                {row.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
          <div className="flex flex-col gap-4">
            <div className="rounded-[10px] border border-extended-1 bg-extended-2 px-[13px] py-[13px]">
              <div className="flex gap-2">
                <IconAi className="mt-0.5 size-4 shrink-0 text-extended-1" />
                <div className="min-w-0 space-y-1">
                  <p className="text-[12px] font-medium leading-4 text-extended-3">AI Conflict Prevention</p>
                  <p className="text-[12px] font-normal leading-4 text-extended-1">
                    System will prevent duplicate or conflicting unit assignments automatically.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                Select Available Unit
              </p>
              {availableUnits.length === 0 ? (
                <p className="rounded-[10px] border border-secondary bg-secondary px-4 py-6 text-center text-[13px] text-neutral">
                  No vacant units in this portfolio yet.
                </p>
              ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {availableUnits.map((u) => {
                  const isSel = selectedId === u.id
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedId(u.id)}
                      aria-pressed={isSel}
                      aria-label={`${u.unit}, ${u.building}, available`}
                      className={
                        isSel
                          ? 'flex h-[88px] flex-col items-stretch rounded-[10px] border-2 border-extended-1 bg-white px-[14px] pt-[14px] pb-[2px] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
                          : 'flex h-[88px] flex-col items-stretch rounded-[10px] border-2 border-secondary bg-white px-[14px] pt-[14px] pb-[2px] outline-none hover:border-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
                      }
                    >
                      <div className="flex flex-1 flex-col items-center text-center">
                        <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3">
                          {u.unit}
                        </p>
                        <p className="text-[12px] font-medium leading-4 text-neutral">{u.building}</p>
                        <span className="mt-2 inline-flex items-center justify-center rounded px-2 py-0.5 text-[12px] font-medium leading-4 text-extended-3 bg-extended-2">
                          Available
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
              )}
            </div>

            <div className="rounded-[10px] border border-extended-2 bg-extended-2 px-[13px] py-[13px]">
              <div className="flex items-center gap-2">
                <IconCheckCircle />
                <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-extended-3">
                  {selected ? (
                    <>
                      Unit {selected.unit} will be assigned to {row.name}
                    </>
                  ) : (
                    <>Select a unit to preview assignment.</>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-secondary bg-secondary px-6 pb-5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[42px] min-w-[5.5rem] items-center justify-center rounded-[10px] border border-secondary bg-white px-5 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-neutral-variant outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={assign}
            disabled={!selectedId}
            className="inline-flex h-[42px] min-w-[8.5rem] items-center justify-center rounded-[10px] bg-extended-1 px-5 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-extended-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Assign Unit
          </button>
        </footer>
      </div>
    </div>
  )
}
