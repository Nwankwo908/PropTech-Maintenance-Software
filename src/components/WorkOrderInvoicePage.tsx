import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  resolveInvoiceJob,
  submitPublicInvoice,
  type InvoiceJobContext,
} from '@/api/maintenanceInvoicePublic'

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, 2)}`
}

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

/** Public invoice form at `/invoice/:token` (job details → Submit invoice). */
export function WorkOrderInvoicePage() {
  const { token } = useParams<{ token: string }>()
  const [ctx, setCtx] = useState<InvoiceJobContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [labor, setLabor] = useState('0')
  const [material, setMaterial] = useState('0')
  const [tax, setTax] = useState('0')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  const t = token?.trim() ?? ''
  const back = t ? `/w/${encodeURIComponent(t)}` : '/vendor'

  useEffect(() => {
    let cancelled = false
    if (!t) {
      setError('This invoice link is missing a token.')
      return
    }
    void (async () => {
      try {
        const job = await resolveInvoiceJob(t)
        if (cancelled) return
        setCtx(job)
        if (job.existingInvoice) {
          setLabor(String(job.existingInvoice.laborCost))
          setMaterial(String(job.existingInvoice.materialCost))
          setTax(String(job.existingInvoice.taxAmount))
          if (job.existingInvoice.status !== 'rejected') {
            setSuccess(
              `Invoice of ${formatMoney(job.existingInvoice.totalCost)} is already with the property team.`,
            )
          }
        } else if (job.approvedEstimate) {
          setLabor(String(job.approvedEstimate.laborCost))
          setMaterial(String(job.approvedEstimate.partsCost))
          setTax('0')
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

  const laborN = parseMoney(labor) ?? 0
  const materialN = parseMoney(material) ?? 0
  const taxN = parseMoney(tax) ?? 0
  const computed = Math.round((laborN + materialN + taxN) * 100) / 100

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!t) return
    const l = parseMoney(labor)
    const m = parseMoney(material)
    const tx = parseMoney(tax)
    if (l == null || m == null || tx == null) {
      setError('Enter valid labor, materials, and tax amounts.')
      return
    }
    if (l + m + tx <= 0) {
      setError('Total must be greater than zero.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await submitPublicInvoice(t, {
        laborCost: l,
        materialCost: m,
        taxAmount: tx,
        vendorNotes: notes.trim() || undefined,
      })
      setSuccess(result.message)
      const job = await resolveInvoiceJob(t)
      setCtx(job)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit invoice.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !ctx) {
    return (
      <Shell>
        <h1 className="text-[22px] font-semibold text-[#101828]">Couldn’t open invoice</h1>
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

  const alreadySubmitted =
    Boolean(success) ||
    (ctx.existingInvoice != null && ctx.existingInvoice.status !== 'rejected')

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

        {!ctx.canSubmit && !alreadySubmitted ? (
          <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] leading-5 text-[#92400e]">
            Upload completion photos before submitting an invoice.
          </div>
        ) : null}

        {ctx.approvedEstimate && !alreadySubmitted ? (
          <div className="rounded-xl border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-[13px] leading-5 text-[#1e40af]">
            Prefills from your approved estimate (
            {formatMoney(ctx.approvedEstimate.totalCost)}). Adjust if the final
            invoice differs.
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
            <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">Invoice</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#667085]">
              Submit final costs so the property team can approve payment in Ulo.
            </p>
          </div>

          <MoneyRow label="Labor" value={labor} onChange={setLabor} disabled={busy || alreadySubmitted} />
          <MoneyRow
            label="Materials"
            value={material}
            onChange={setMaterial}
            disabled={busy || alreadySubmitted}
          />
          <MoneyRow label="Tax" value={tax} onChange={setTax} disabled={busy || alreadySubmitted} />

          <p className="text-[14px] font-semibold text-[#101828]">
            Total {formatMoney(computed)}
          </p>

          <label className="block">
            <span className="text-[13px] font-medium text-[#344054]">
              Notes <span className="font-normal text-[#98a2b3]">(optional)</span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-[10px] border border-[#d0d5dd] px-3 py-2.5 text-[15px] outline-none focus:border-[#186179]"
              disabled={busy || alreadySubmitted}
              placeholder="Anything the property team should know about this invoice?"
            />
          </label>

          <button
            type="submit"
            disabled={busy || alreadySubmitted || !ctx.canSubmit}
            className="w-full rounded-[10px] bg-[#186179] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#145066] disabled:opacity-50"
          >
            {busy ? 'Sending…' : alreadySubmitted ? 'Invoice submitted' : 'Submit invoice'}
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
