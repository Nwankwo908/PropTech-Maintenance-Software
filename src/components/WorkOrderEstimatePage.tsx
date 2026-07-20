import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  resolveEstimateJob,
  submitEstimate,
  type EstimateJobContext,
} from '@/api/maintenanceEstimate'

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** Keep only a typed money amount (digits + optional one decimal). */
function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, 2)}`
}

/** Split stored description text into readable paragraphs (not a raw line dump). */
function descriptionParagraphs(raw: string): string[] {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function MoneyRow({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-[7.5rem] shrink-0 text-[13px] font-medium leading-5 text-[#344054]">
        {label}
      </span>
      <span className="relative min-w-0 flex-1">
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[15px] text-[#667085]"
          aria-hidden
        >
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(sanitizeMoneyInput(e.target.value))}
          className="w-full rounded-[10px] border border-[#d0d5dd] py-2.5 pl-7 pr-3 text-[15px] outline-none focus:border-[#186179]"
          disabled={disabled}
        />
      </span>
    </label>
  )
}

/** Phase 3 / 4.3 — public estimate form at `/estimate/:token`. */
export function WorkOrderEstimatePage() {
  const { token } = useParams<{ token: string }>()
  const [ctx, setCtx] = useState<EstimateJobContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parts, setParts] = useState('0')
  const [labor, setLabor] = useState('0')
  const [totalOverride, setTotalOverride] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  const t = token?.trim() ?? ''
  const back = t ? `/w/${encodeURIComponent(t)}` : '/vendor'

  useEffect(() => {
    let cancelled = false
    if (!t) {
      setError('This estimate link is missing a token.')
      return
    }
    void (async () => {
      try {
        const job = await resolveEstimateJob(t)
        if (cancelled) return
        setCtx(job)
        if (job.pendingEstimate) {
          setParts(String(job.pendingEstimate.partsCost))
          setLabor(String(job.pendingEstimate.laborCost))
          setTotalOverride(String(job.pendingEstimate.totalCost))
          setNotes(job.pendingEstimate.notes ?? '')
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load this job.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [t])

  const partsN = parseMoney(parts) ?? 0
  const laborN = parseMoney(labor) ?? 0
  const computed = Math.round((partsN + laborN) * 100) / 100

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!t) return
    const p = parseMoney(parts)
    const l = parseMoney(labor)
    if (p == null || l == null) {
      setError('Enter valid parts and labor amounts.')
      return
    }
    const total = totalOverride.trim() === '' ? p + l : parseMoney(totalOverride)
    if (total == null || total <= 0) {
      setError('Total must be greater than zero.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await submitEstimate(t, {
        partsCost: p,
        laborCost: l,
        totalCost: total,
        notes: notes.trim() || undefined,
      })
      setSuccess(result.message)
      const job = await resolveEstimateJob(t)
      setCtx(job)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit estimate.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !ctx) {
    return (
      <Shell>
        <h1 className="text-[22px] font-semibold text-[#101828]">Couldn’t open estimate</h1>
        <p className="mt-2 text-[14px] leading-6 text-[#475467]">{error}</p>
        <Link to={back} className="mt-6 inline-flex text-[14px] font-semibold text-[#186179] hover:underline">
          Back to job
        </Link>
      </Shell>
    )
  }

  if (!ctx) {
    return (
      <Shell>
        <p className="text-[14px] text-[#475467]">Loading…</p>
      </Shell>
    )
  }

  return (
    <div className="min-h-dvh bg-[#f4f6f8] text-[#101828]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto max-w-lg px-4 py-4">
          <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#667085]">
            Job detail
          </p>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-semibold">
            {ctx.workOrderRef}
          </h1>
          <p className="mt-1 text-[14px] text-[#667085]">{ctx.unit || 'Unit'}</p>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-6 pb-16">
        {ctx.description ? (
          <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">Description</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-6 text-[#364153]">
              {descriptionParagraphs(ctx.description).map((paragraph) => (
                <li key={paragraph}>{paragraph}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {ctx.pendingEstimate && !success ? (
          <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] leading-5 text-[#92400e]">
            An estimate of {formatMoney(ctx.pendingEstimate.totalCost)} is already waiting
            for property team approval. Submitting again replaces it.
          </div>
        ) : null}

        {success ? (
          <div className="rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-4 text-[14px] leading-6 text-[#065f46]">
            {success}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
            {error}
          </div>
        ) : null}

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
        >
          <div>
            <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">
              Estimate
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[#667085]">
              Enter the cost of the labor needed to complete the additional work.
            </p>
          </div>

          <MoneyRow
            label="Cost of Parts"
            value={parts}
            onChange={setParts}
            disabled={busy}
          />

          <MoneyRow
            label="Cost of Labor"
            value={labor}
            onChange={setLabor}
            disabled={busy}
          />

          <MoneyRow
            label="Total Cost"
            value={totalOverride}
            placeholder={computed.toFixed(2)}
            onChange={setTotalOverride}
            disabled={busy}
          />

          <label className="block">
            <span className="text-[13px] font-medium text-[#344054]">
              Notes <span className="font-normal text-[#98a2b3]">(optional)</span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-[10px] border border-[#d0d5dd] px-3 py-2.5 text-[15px] outline-none focus:border-[#186179]"
              disabled={busy}
              placeholder="What extra work or materials are needed?"
            />
          </label>

          <button
            type="submit"
            disabled={busy || Boolean(success)}
            className="w-full rounded-[10px] bg-[#186179] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#145066] disabled:opacity-50"
          >
            {busy
              ? 'Sending…'
              : success
                ? 'Estimate submitted'
                : ctx.pendingEstimate
                  ? 'Update estimate'
                  : 'Send for approval'}
          </button>
        </form>

        <Link
          to={back}
          className="inline-flex text-[14px] font-semibold text-[#186179] hover:underline"
        >
          Back to job details
        </Link>
      </main>
    </div>
  )
}

function Shell({ children }: { children: import('react').ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f8] px-4">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  )
}
