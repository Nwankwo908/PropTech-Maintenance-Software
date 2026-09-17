import { useEffect, useRef, useState, type RefObject } from 'react'
import propertyAccessIcon from '@/assets/property-access.png'
import { getErrorMessage } from '@/lib/errorMessage'
import { notifyPropertyDetailsChanged } from '@/lib/propertyDetailsCompleteness'
import {
  clearPropertyAccess,
  loadPropertyAccess,
  propertyAccessDisplayRows,
  propertyAccessHasContent,
  type PropertyAccessProfile,
} from '@/lib/propertyAccess'

type PropertyAccessPanelProps = {
  building: string
  onEdit: () => void
  actionRef?: RefObject<HTMLElement | null>
}

export function PropertyAccessPanel({ building, onEdit, actionRef }: PropertyAccessPanelProps) {
  const [access, setAccess] = useState<PropertyAccessProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const loadSeqRef = useRef(0)

  useEffect(() => {
    const name = building.trim()
    if (!name) {
      setAccess(null)
      setLoading(false)
      setError(null)
      return
    }
    const seq = ++loadSeqRef.current
    setLoading(true)
    setError(null)
    void loadPropertyAccess(name)
      .then((loaded) => {
        if (seq !== loadSeqRef.current) return
        setAccess(propertyAccessHasContent(loaded) ? loaded : null)
      })
      .catch((err) => {
        if (seq !== loadSeqRef.current) return
        setAccess(null)
        setError(getErrorMessage(err, 'Could not load property access.'))
      })
      .finally(() => {
        if (seq !== loadSeqRef.current) return
        setLoading(false)
      })
  }, [building])

  useEffect(() => {
    function onChanged(event: Event) {
      const detail = (event as CustomEvent<{ building?: string }>).detail
      const changed = detail?.building?.trim()
      if (!changed || changed.toLowerCase() !== building.trim().toLowerCase()) return
      void loadPropertyAccess(building.trim())
        .then((loaded) => {
          setAccess(propertyAccessHasContent(loaded) ? loaded : null)
          setError(null)
        })
        .catch((err) => {
          setError(getErrorMessage(err, 'Could not refresh property access.'))
        })
    }
    window.addEventListener('ulo:property-details-changed', onChanged)
    return () => window.removeEventListener('ulo:property-details-changed', onChanged)
  }, [building])

  const rows = access ? propertyAccessDisplayRows(access) : []

  return (
    <section className="mt-6 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e5e7eb] px-4 py-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[#f3f4f6]">
            <img src={propertyAccessIcon} alt="" width={28} height={28} className="size-7 object-contain" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold leading-7 text-[#0a0a0a]">Property access</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
              Entry, lockbox, and parking details vendors need for this building.
            </p>
          </div>
        </div>
        <span ref={actionRef} className="inline-flex">
          <button
            type="button"
            onClick={onEdit}
            className="sa-press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-[#186179] px-4 py-2.5 text-[13px] font-semibold leading-5 text-white outline-none hover:bg-[#145066] focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2"
          >
            {access ? 'Edit property access' : 'Add property access'}
          </button>
        </span>
      </div>

      <div className="px-4 py-5 sm:px-6">
        {loading ? (
          <p className="text-[13px] leading-5 text-[#6a7282]">Loading property access…</p>
        ) : error ? (
          <p className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[13px] text-[#92400e]">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] leading-5 text-[#6a7282]">
            No access details yet. Add them so vendors know how to get in.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              {rows.map((row) => (
                <div key={row.label} className="min-w-0 rounded-[8px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3">
                  <dt className="text-[12px] font-medium leading-4 text-[#6a7282]">{row.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-[14px] leading-5 text-[#0a0a0a]">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                const name = building.trim()
                if (!name || !access) return
                const previous = access
                setAccess(null)
                setError(null)
                setDeleting(true)
                void clearPropertyAccess(name)
                  .then(() => {
                    notifyPropertyDetailsChanged(name)
                  })
                  .catch((err) => {
                    setAccess(previous)
                    setError(getErrorMessage(err, 'Could not delete property access.'))
                  })
                  .finally(() => {
                    setDeleting(false)
                  })
              }}
              className="sa-press inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-[8px] bg-transparent px-2 text-[12px] font-medium leading-4 text-[#a03e3e] outline-none transition-colors hover:bg-[#fef2f2] hover:text-[#8a2f2f] focus-visible:ring-2 focus-visible:ring-[#a03e3e] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete access details
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
