import { buildMaintenanceReviewSummary } from '@/lib/buildMaintenanceReviewSummary'
import type { IssueParsed } from '@/api/issueAnalysis'
import { MaintenancePortalPageHeader } from '@/components/MaintenancePortalPageHeader'
import { SparkleIcon } from '@/components/SparkleIcon'

function WhiteCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M13.3334 4L6.00002 11.3333L2.66669 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FormattedSummary({ text }: { text: string }) {
  const chunks = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <div className="flex flex-col gap-3 text-[14px] font-normal leading-7 tracking-[-0.1504px] text-[#6e11b0]">
      {chunks.map((chunk, i) => {
        if (!chunk) return null
        if (chunk.startsWith('**') && chunk.endsWith('**')) {
          return (
            <strong
              key={i}
              className="font-semibold text-[#4c1d95] first:mt-0 sm:text-[15px]"
            >
              {chunk.slice(2, -2)}
            </strong>
          )
        }
        const t = chunk.trim()
        if (!t) return null
        return (
          <p key={i} className="leading-relaxed text-[#6e11b0]">
            {chunk.trimStart()}
          </p>
        )
      })}
    </div>
  )
}

export type MaintenanceRequestReviewProps = {
  residentName: string
  email: string
  /** Optional; shown when set for SMS status updates. */
  phone?: string
  /** How lifecycle notifications are delivered. */
  notificationChannel?: 'email' | 'sms' | 'both'
  unit: string
  description: string
  urgencyValue: string
  urgencyTitle: string
  issueParsed: IssueParsed | null
  /** From `fetchIssueAnalysis` when the API returns `aiSummary` (or aliases). */
  aiGeneratedSummary: string | null
  mediaCount: number
  onBack: () => void
  onConfirm: () => void
  isConfirming: boolean
  confirmError: string | null
}

export function MaintenanceRequestReview({
  residentName,
  email,
  phone = '',
  notificationChannel = 'both',
  unit,
  description,
  urgencyValue,
  urgencyTitle,
  issueParsed,
  aiGeneratedSummary,
  mediaCount,
  onBack,
  onConfirm,
  isConfirming,
  confirmError,
}: MaintenanceRequestReviewProps) {
  const summaryText =
    aiGeneratedSummary?.trim() ||
    buildMaintenanceReviewSummary(
      issueParsed,
      description,
      unit,
      urgencyValue || 'normal',
    )

  return (
    <div className="flex w-full flex-col">
      <MaintenancePortalPageHeader sticky="lg" step="review" />

      <div className="px-6 pb-10 sm:px-12">
        <div className="ml-0 flex w-full max-w-full flex-col gap-8 pt-8 lg:ml-[120px] lg:max-w-[650px] sm:pt-10">
        <div className="flex flex-col gap-4 rounded-[12px] border-2 border-[#e9d4ff] bg-gradient-to-br from-[#faf5ff] via-white to-[#eef2ff] px-[22px] py-5 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset] sm:px-[26px] sm:py-6">
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#f3e8ff] text-[#9810fa] ring-1 ring-[#e9d4ff]">
              <SparkleIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#59168b]">
                AI-Generated Summary
              </h2>
              <p className="text-[12px] font-normal leading-4 text-[#7c3aed]/90">
                Based on your description—we grouped what stands out before you
                submit.
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-[#e9d4ff]/60 bg-white/70 px-4 py-3.5 sm:px-5">
            <FormattedSummary text={summaryText} />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white px-[25px] pb-px pt-[25px]">
          <h2 className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]">
            Request Details
          </h2>

          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                  Resident Name
                </p>
                <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  {residentName.trim() || '—'}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-1 sm:col-span-1">
                <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                  Email
                </p>
                <p className="break-all text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  {email.trim() || '—'}
                </p>
              </div>
              {phone.trim() ? (
                <div className="flex min-w-0 flex-col gap-1 sm:col-span-1">
                  <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                    Mobile (SMS)
                  </p>
                  <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                    {phone.trim()}
                  </p>
                </div>
              ) : null}
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                  Unit Number
                </p>
                <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  {unit.trim() || '—'}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                Status updates
              </p>
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                {notificationChannel === 'both'
                  ? 'Email and text'
                  : notificationChannel === 'email'
                    ? 'Email only'
                    : 'Text only'}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                Urgency Level
              </p>
              <span className="inline-flex w-fit rounded-full bg-[#fef9c2] px-3 py-1 text-[12px] font-medium leading-4 text-[#a65f00]">
                {urgencyTitle}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                Issue Description
              </p>
              <div className="min-h-[46px] rounded border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3">
                <p className="whitespace-pre-wrap text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#364153]">
                  {description.trim() || '—'}
                </p>
              </div>
            </div>

            {mediaCount > 0 && (
              <p className="text-[12px] leading-4 text-[#6a7282]">
                {mediaCount} file{mediaCount === 1 ? '' : 's'} attached (photos/videos)
              </p>
            )}
          </div>
        </div>

        {confirmError && (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] leading-5 text-red-950"
            role="alert"
          >
            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700"
                aria-hidden
              >
                <svg
                  className="size-3.5"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10 6.5v4.5m0 2h.01M10 2.5l7.5 13h-15l7.5-13z"
                  />
                </svg>
              </span>
              <span className="min-w-0">{confirmError}</span>
            </div>
          </div>
        )}

        <div className="flex w-full max-w-full gap-3 lg:max-w-[650px]">
          <button
            type="button"
            onClick={onBack}
            disabled={isConfirming}
            className="h-9 min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back to Edit
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#9810fa] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white transition-colors hover:bg-[#8710e0] disabled:cursor-not-allowed disabled:opacity-80"
          >
            <WhiteCheckIcon className="size-4 shrink-0 text-white" />
            {isConfirming ? 'Submitting…' : 'Confirm'}
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
