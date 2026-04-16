import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  fetchIssueAnalysis,
  ISSUE_CLARIFY_LOCAL_MIN_CHARS,
  type IssueParsed,
} from '../api/issueAnalysis'
import { runPostTicketAutomation } from '../api/ticketAutomation'
import {
  safeIssueCategoryFromParsed,
  submitMaintenanceRequest,
  type SubmitMaintenanceResult,
} from '../api/submitMaintenanceRequest'
import { MaintenancePortalPageHeader } from './MaintenancePortalPageHeader'
import { MaintenanceRequestReview } from './MaintenanceRequestReview'
import {
  VerifyIdentityModal,
  type OtpModalFlowState,
} from './VerifyIdentityModal'
import {
  isFormValid,
  validateMaintenanceForm,
  type MaintenanceField,
  type MaintenanceFormValues,
} from '../lib/maintenanceRequestValidation'
import { generateMaintenanceRequestDisplayId } from '../lib/generateMaintenanceRequestDisplayId'
import {
  getValidResidentSubmitAuth,
  isResidentAuthEnabled,
  syncResidentProfileMetadata,
  type ResidentAuthPayload,
} from '../lib/residentAuth'
import { supabase } from '@/lib/supabase'
import { SparkleIcon } from '@/components/SparkleIcon'
import checkmarkIcon from '@/assets/Checkmark Icon.svg'
import dashIcon from '@/assets/Dash icon.svg'
import homeIcon from '@/assets/Home Icon.svg'
import radioButtonChecked from '@/assets/radio_button_checked.svg'
import radioButtonUnchecked from '@/assets/radio_button_unchecked.svg'
import uploadIcon from '@/assets/Upload_Icon.svg'
import lightbulbIcon from '@/assets/Lightbulb.svg'
import maintenanceRequestHeroIllustration from '@/assets/Maintenance Request illustration (8).png'

/** API / client messages that mean the JWT is unusable and the resident should re-verify. */
function isAuthSessionSubmitError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('invalid session') ||
    m.includes('verify your email') ||
    m.includes('sign-in could not be confirmed')
  )
}

const CLARIFY_DEBOUNCE_MS = 700

type Urgency = 'low' | 'normal' | 'urgent'

type FlowPhase = 'form' | 'review' | 'success'

const URGENCY_OPTIONS: {
  value: Urgency
  title: string
  description: string
}[] = [
  {
    value: 'low',
    title: 'Low Priority',
    description:
      'Non-urgent issue that can be addressed during regular business hours',
  },
  {
    value: 'normal',
    title: 'Normal Priority',
    description:
      'Standard maintenance issue requiring attention within 48 hours',
  },
  {
    value: 'urgent',
    title: 'Urgent',
    description: 'Critical issue requiring immediate attention ',
  },
]

function fieldClassName(invalid: boolean): string {
  const base =
    'w-full rounded-lg border px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] placeholder:text-[#717182] outline-none transition-[box-shadow,background-color,border-color] duration-150'
  if (invalid) {
    return `${base} border-red-500 bg-[#fef2f2] ring-2 ring-red-500/30 hover:border-red-600 hover:bg-[#fee2e2]`
  }
  return `${base} border-transparent bg-[#f3f3f5] ring-[#944c73] hover:border-[#d1d5dc] hover:bg-[#ececef] focus:border-transparent focus:ring-2`
}

type IssueDescriptionClarifyBodyProps = {
  clarifyLoading: boolean
  clarifyError: string | null
  clarifyQuestions: string[]
  issueParsed: IssueParsed | null
  hasStructuredParse: boolean
  formUrgency: Urgency | ''
  suggestedUrgencyApplyAck: boolean
  /** Full-width, centered label (e.g. bottom sheet). */
  applyUrgencySheetLayout?: boolean
  onApplySuggestedUrgency: (value: Urgency) => void
}

function IssueDescriptionClarifyBody({
  clarifyLoading,
  clarifyError,
  clarifyQuestions,
  issueParsed,
  hasStructuredParse,
  formUrgency,
  suggestedUrgencyApplyAck,
  applyUrgencySheetLayout = false,
  onApplySuggestedUrgency,
}: IssueDescriptionClarifyBodyProps) {
  const suggestedUrgencyApplied = Boolean(
    suggestedUrgencyApplyAck &&
      issueParsed?.urgency != null &&
      formUrgency === issueParsed.urgency,
  )
  return (
    <>
      {clarifyLoading && (
        <div
          className="space-y-2.5"
          aria-busy="true"
          aria-label="Analyzing issue description"
        >
          <div className="h-2.5 w-full max-w-[18rem] animate-pulse rounded-full bg-[#e9d4ff]/70" />
          <div className="h-2.5 w-full max-w-[14rem] animate-pulse rounded-full bg-[#e9d4ff]/55" />
          <div className="h-2.5 w-full max-w-[10rem] animate-pulse rounded-full bg-[#e9d4ff]/40" />
          <p className="pt-0.5 text-[12px] leading-4 text-[#6a7282]">
            Extracting details and suggestions…
          </p>
        </div>
      )}
      {clarifyError && !clarifyLoading && (
        <div className="rounded-lg border border-red-200 bg-red-50/90 px-3 py-2.5 text-[13px] font-medium leading-5 text-red-800">
          {clarifyError}
        </div>
      )}
      {!clarifyLoading && !clarifyError && issueParsed && hasStructuredParse && (
        <div className="space-y-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-[#6e11b0]/80">
            What we detected
          </p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {issueParsed.issueType && (
              <div className="rounded-lg border border-[#e9d4ff]/50 bg-white/80 px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[#6a7282]">
                  Issue type
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium text-[#0a0a0a]">
                  {issueParsed.issueType}
                </dd>
              </div>
            )}
            {issueParsed.room && (
              <div className="rounded-lg border border-[#e9d4ff]/50 bg-white/80 px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[#6a7282]">
                  Room
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium text-[#0a0a0a]">
                  {issueParsed.room}
                </dd>
              </div>
            )}
            {issueParsed.appliance && (
              <div className="rounded-lg border border-[#e9d4ff]/50 bg-white/80 px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[#6a7282]">
                  Appliance
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium text-[#0a0a0a]">
                  {issueParsed.appliance}
                </dd>
              </div>
            )}
            {issueParsed.urgency && (
              <div className="rounded-lg border border-[#e9d4ff]/50 bg-white/80 px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[#6a7282]">
                  Urgency
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium text-[#0a0a0a]">
                  {URGENCY_OPTIONS.find((o) => o.value === issueParsed.urgency)
                    ?.title ?? issueParsed.urgency}
                </dd>
              </div>
            )}
            {issueParsed.severity && (
              <div className="rounded-lg border border-[#e9d4ff]/50 bg-white/80 px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[#6a7282]">
                  Severity
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium text-[#0a0a0a]">
                  {issueParsed.severity}
                </dd>
              </div>
            )}
          </dl>
          {issueParsed.normalizedSummary && (
            <div className="rounded-lg border border-dashed border-[#c4b5fd]/80 bg-[#faf5ff]/50 px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#6e11b0]/80">
                Clearer wording
              </p>
              <p className="mt-1 text-[13px] leading-5 text-[#364153]">
                {issueParsed.normalizedSummary}
              </p>
            </div>
          )}
          {issueParsed.urgency && (
            <button
              type="button"
              disabled={suggestedUrgencyApplied}
              aria-label={
                suggestedUrgencyApplied
                  ? 'Suggested urgency applied'
                  : `Apply suggested urgency: ${URGENCY_OPTIONS.find((o) => o.value === issueParsed.urgency)?.title ?? issueParsed.urgency}`
              }
              className={[
                'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-medium shadow-sm transition-colors',
                applyUrgencySheetLayout
                  ? '-mx-4 w-[calc(100%+2rem)] max-w-none justify-center text-center'
                  : 'w-full max-w-full max-lg:justify-center max-lg:text-center sm:w-auto lg:justify-start lg:text-left',
                suggestedUrgencyApplied
                  ? 'cursor-default border-emerald-200/90 bg-emerald-50/90 text-emerald-900'
                  : 'border-[#d8b4fe] bg-white text-[#59168b] hover:bg-[#faf5ff]',
                'disabled:opacity-100',
              ].join(' ')}
              onClick={() => onApplySuggestedUrgency(issueParsed.urgency!)}
            >
              {suggestedUrgencyApplied ? (
                <span
                  className={
                    applyUrgencySheetLayout
                      ? 'inline-flex max-w-full flex-wrap items-center justify-center gap-2 text-center'
                      : 'inline-flex items-center gap-2 max-lg:justify-center lg:justify-start'
                  }
                >
                  <img
                    src={checkmarkIcon}
                    alt=""
                    className="size-5 shrink-0 object-contain"
                    aria-hidden
                  />
                  <span className={applyUrgencySheetLayout ? 'text-center' : ''}>
                    Suggested urgency applied —{' '}
                    <span className="font-semibold text-[#065f46]">
                      {URGENCY_OPTIONS.find((o) => o.value === issueParsed.urgency)
                        ?.title ?? issueParsed.urgency}
                    </span>
                  </span>
                </span>
              ) : (
                <span className={applyUrgencySheetLayout ? 'text-center' : ''}>
                  Apply suggested urgency:{' '}
                  <span className="text-[#9810fa]">
                    {URGENCY_OPTIONS.find((o) => o.value === issueParsed.urgency)
                      ?.title ?? issueParsed.urgency}
                  </span>
                </span>
              )}
            </button>
          )}
        </div>
      )}
      {!clarifyLoading && !clarifyError && clarifyQuestions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {clarifyQuestions.map((q, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white/90 px-3 py-2 text-[13px] leading-5 text-[#364153] shadow-[0_1px_0_rgba(0,0,0,0.03)]"
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f3e8ff]"
                aria-hidden
              >
                <img
                  src={lightbulbIcon}
                  alt=""
                  className="h-5 w-[18px] object-contain"
                />
              </span>
              <span className="min-w-0 flex-1">{q}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g)$/i.test(file.name)
}

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  return /\.(mp4|webm|mov)$/i.test(file.name)
}

export type MaintenanceRequestFormProps = {
  /** When set, successful submit navigates away (e.g. success page) instead of locking the form. */
  onTicketSubmitted?: (result: SubmitMaintenanceResult) => void
}

export function MaintenanceRequestForm({
  onTicketSubmitted,
}: MaintenanceRequestFormProps = {}) {
  const formId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const descriptionSheetTextareaRef = useRef<HTMLTextAreaElement>(null)

  const [urgency, setUrgency] = useState<Urgency | ''>('')
  const [residentName, setResidentName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [residentNotificationChannel, setResidentNotificationChannel] =
    useState<'email' | 'sms' | 'both'>('both')
  const [unit, setUnit] = useState('')
  const [description, setDescription] = useState('')
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<FlowPhase>('form')
  const [verifyModalOpen, setVerifyModalOpen] = useState(false)
  const [otpFlowState, setOtpFlowState] = useState<OtpModalFlowState>('idle')

  const [touched, setTouched] = useState<Partial<Record<MaintenanceField, true>>>(
    {},
  )
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState<SubmitMaintenanceResult | null>(null)

  const [clarifyQuestions, setClarifyQuestions] = useState<string[]>([])
  const [issueParsed, setIssueParsed] = useState<IssueParsed | null>(null)
  const [aiGeneratedSummary, setAiGeneratedSummary] = useState<string | null>(
    null,
  )
  const [clarifyLoading, setClarifyLoading] = useState(false)
  const [clarifyError, setClarifyError] = useState<string | null>(null)
  const [issueDescriptionClarifySheetOpen, setIssueDescriptionClarifySheetOpen] =
    useState(false)
  const [issueClarifySheetEntered, setIssueClarifySheetEntered] = useState(false)
  const [suggestedUrgencyApplyAck, setSuggestedUrgencyApplyAck] = useState(false)

  const hasStructuredParse = useMemo(() => {
    if (!issueParsed) return false
    return Boolean(
      issueParsed.issueType ||
        issueParsed.room ||
        issueParsed.appliance ||
        issueParsed.severity ||
        issueParsed.urgency ||
        issueParsed.normalizedSummary,
    )
  }, [issueParsed])

  const showDescriptionClarify = Boolean(
    clarifyLoading ||
      clarifyQuestions.length > 0 ||
      clarifyError ||
      hasStructuredParse,
  )

  useEffect(() => {
    if (!showDescriptionClarify) setIssueDescriptionClarifySheetOpen(false)
  }, [showDescriptionClarify])

  useEffect(() => {
    setSuggestedUrgencyApplyAck(false)
  }, [issueParsed])

  useEffect(() => {
    if (!issueParsed?.urgency) return
    if (urgency !== issueParsed.urgency) setSuggestedUrgencyApplyAck(false)
  }, [urgency, issueParsed])

  useEffect(() => {
    if (!issueDescriptionClarifySheetOpen) {
      setIssueClarifySheetEntered(false)
      return
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setIssueClarifySheetEntered(true))
    })
    return () => cancelAnimationFrame(id)
  }, [issueDescriptionClarifySheetOpen])

  useEffect(() => {
    if (!issueDescriptionClarifySheetOpen || !issueClarifySheetEntered) return
    descriptionSheetTextareaRef.current?.focus()
  }, [issueDescriptionClarifySheetOpen, issueClarifySheetEntered])

  useEffect(() => {
    if (!issueDescriptionClarifySheetOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setIssueDescriptionClarifySheetOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [issueDescriptionClarifySheetOpen])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => {
      if (mq.matches) setIssueDescriptionClarifySheetOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const trimmed = description.trim()

    if (trimmed.length < ISSUE_CLARIFY_LOCAL_MIN_CHARS) {
      setClarifyQuestions([])
      setIssueParsed(null)
      setAiGeneratedSummary(null)
      setClarifyLoading(false)
      setClarifyError(null)
      return
    }

    const ac = new AbortController()
    let cancelled = false

    const timer = window.setTimeout(() => {
      setClarifyLoading(true)
      setClarifyError(null)
      setIssueParsed(null)
      setAiGeneratedSummary(null)
      void (async () => {
        try {
          const { questions, parsed, aiSummary } = await fetchIssueAnalysis(
            description,
            ac.signal,
          )
          if (!cancelled) {
            setClarifyQuestions(questions)
            setIssueParsed(parsed)
            setAiGeneratedSummary(aiSummary)
          }
        } catch (e) {
          const aborted =
            (e instanceof DOMException && e.name === 'AbortError') ||
            (e instanceof Error && e.name === 'AbortError')
          if (aborted) return
          if (!cancelled) {
            setClarifyError(
              e instanceof Error ? e.message : 'Could not load suggestions.',
            )
            setClarifyQuestions([])
            setIssueParsed(null)
            setAiGeneratedSummary(null)
          }
        } finally {
          if (!cancelled) {
            setClarifyLoading(false)
          }
        }
      })()
    }, CLARIFY_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      ac.abort()
      setClarifyLoading(false)
    }
  }, [description])

  const mediaPreviewUrls = useMemo(
    () => mediaFiles.map((f) => URL.createObjectURL(f)),
    [mediaFiles],
  )

  useEffect(() => {
    return () => {
      for (const u of mediaPreviewUrls) URL.revokeObjectURL(u)
    }
  }, [mediaPreviewUrls])

  const values: MaintenanceFormValues = useMemo(
    () => ({
      urgency,
      residentName,
      email,
      phone,
      residentNotificationChannel,
      unit,
      description,
    }),
    [
      urgency,
      residentName,
      email,
      phone,
      residentNotificationChannel,
      unit,
      description,
    ],
  )

  const errors = useMemo(
    () => validateMaintenanceForm(values, mediaFiles),
    [values, mediaFiles],
  )

  const canSubmit = useMemo(
    () => isFormValid(values, mediaFiles),
    [values, mediaFiles],
  )

  function showError(field: MaintenanceField): boolean {
    return Boolean(errors[field] && (touched[field] || attemptedSubmit))
  }

  function touch(field: MaintenanceField) {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  function handleFormContinue(e: FormEvent) {
    e.preventDefault()
    setAttemptedSubmit(true)
    setSubmitError(null)

    if (!isFormValid(values, mediaFiles)) return

    setPhase('review')
  }

  const performSubmit = useCallback(
    async () => {
      setSubmitError(null)
      setIsSubmitting(true)
      try {
        let submitAuth: ResidentAuthPayload | undefined
        let sessionFresh = false

        if (isResidentAuthEnabled()) {
          if (!supabase) {
            throw new Error('Sign-in is not configured.')
          }
          try {
            const fresh = await getValidResidentSubmitAuth(supabase)
            const want = values.email.trim().toLowerCase()
            const em = fresh.email?.trim().toLowerCase()
            if (!em || em !== want) {
              setVerifyModalOpen(true)
              setSubmitError(null)
              return
            }
            submitAuth = { accessToken: fresh.accessToken, userId: fresh.userId }
            sessionFresh = true
          } catch {
            setVerifyModalOpen(true)
            setSubmitError(null)
            return
          }
        }

        const result = await submitMaintenanceRequest(
          {
            ...values,
            photos: mediaFiles,
            issueCategory: safeIssueCategoryFromParsed(issueParsed),
          },
          submitAuth
            ? {
                auth: {
                  accessToken: submitAuth.accessToken,
                  residentUserId: submitAuth.userId,
                },
                sessionFresh,
              }
            : undefined,
        )
        if (!result?.id?.trim()) {
          throw new Error('Submit failed')
        }
        if (submitAuth) {
          void syncResidentProfileMetadata(
            values.residentName,
            values.unit,
          ).catch(() => {
            /* non-blocking after successful submit */
          })
        }
        if (fileInputRef.current) fileInputRef.current.value = ''
        void runPostTicketAutomation({
          ticketId: result.id,
          residentName: values.residentName,
          email: values.email,
          unit: values.unit,
          description: values.description,
          priority: values.urgency,
        })
        const displayResult: SubmitMaintenanceResult = {
          ...result,
          id: generateMaintenanceRequestDisplayId(),
        }
        if (onTicketSubmitted) {
          onTicketSubmitted(displayResult)
        } else {
          setSuccess(displayResult)
          setPhase('success')
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Something went wrong.'
        if (isResidentAuthEnabled() && isAuthSessionSubmitError(msg)) {
          setOtpFlowState('idle')
          setVerifyModalOpen(true)
          setSubmitError(
            'Session expired. Please verify your email again, then submit.',
          )
        } else {
          setSubmitError(msg)
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    [values, mediaFiles, onTicketSubmitted, issueParsed],
  )

  async function handleConfirmSubmit() {
    setSubmitError(null)
    if (isResidentAuthEnabled()) {
      setVerifyModalOpen(true)
      return
    }
    await performSubmit()
    }

  /** OTP pipeline steps (requirement: track sending vs verifying vs ticket submit). */
  const isRequestingOtp = otpFlowState === 'sending'
  const isVerifyingOtp = otpFlowState === 'verifying'
  const reviewConfirmBusy =
    isSubmitting || verifyModalOpen || isRequestingOtp || isVerifyingOtp

  function resetForm() {
    setUrgency('')
    setResidentName('')
    setEmail('')
    setPhone('')
    setResidentNotificationChannel('both')
    setUnit('')
    setDescription('')
    setMediaFiles([])
    setAiGeneratedSummary(null)
    setTouched({})
    setAttemptedSubmit(false)
    setSubmitError(null)
    setSuccess(null)
    setPhase('form')
    setVerifyModalOpen(false)
    setOtpFlowState('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const locked = success !== null

  const urgencyTitle =
    URGENCY_OPTIONS.find((o) => o.value === urgency)?.title ?? '—'

  const sidebarSubmitJetBlack =
    (phase === 'form' && canSubmit && !isSubmitting && !locked) ||
    (phase === 'review' && reviewConfirmBusy)

  const mobileProgressPct =
    locked || phase === 'success'
      ? 100
      : phase === 'review'
        ? (200 / 3)
        : (100 / 3)
  const mobileStepFraction =
    locked || phase === 'success' ? '3 / 3' : phase === 'review' ? '2 / 3' : '1 / 3'
  /** Mobile / tablet only (progress UI is `lg:hidden`): no "Your details" on step 1. */
  const mobileStepLabel =
    locked || phase === 'success'
      ? 'Complete'
      : phase === 'review'
        ? 'Review & confirm'
        : ''

  const mobileProgressCore = (
    <>
      {mobileStepLabel ? (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6a7282]">
          {mobileStepLabel}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <div
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e5e7eb]"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-[#944c73] transition-[width] duration-300 ease-out"
            style={{ width: `${mobileProgressPct}%` }}
          />
        </div>
        <span className="shrink-0 tabular-nums text-[11px] font-medium text-[#364153]">
          {mobileStepFraction}
        </span>
      </div>
    </>
  )

  return (
    <main className="min-h-dvh w-full bg-[#f9fafb] font-sans">
      <div className="flex min-h-dvh w-full min-w-0 flex-col rounded-none border-0 bg-white shadow-none lg:flex-row">
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col lg:flex-row">
          <div
            className="hidden w-[8px] shrink-0 self-stretch bg-[#944c73] lg:block"
            aria-hidden
          />

          <div className="w-full min-w-0 flex-1">
            {phase === 'review' ? (
              <>
                <div
                  className="lg:hidden sticky top-0 z-30 w-full shrink-0 bg-white px-6 py-3 sm:px-12"
                  role="region"
                  aria-label="Request progress"
                >
                  {mobileProgressCore}
                  {!reviewConfirmBusy ? (
                    <p className="mt-3 text-center text-[12px] leading-4 text-[#6a7282]">
                      Confirm your request below to submit.
                    </p>
                  ) : (
                    <p className="mt-3 text-center text-[12px] font-medium leading-4 text-[#364153]">
                      {isSubmitting
                        ? 'Submitting…'
                        : 'Check your email to verify and submit.'}
                    </p>
                  )}
                </div>
                <MaintenanceRequestReview
                  residentName={residentName}
                  email={email}
                  phone={phone}
                  notificationChannel={residentNotificationChannel}
                  unit={unit}
                  description={description}
                  urgencyValue={urgency}
                  urgencyTitle={urgencyTitle}
                  issueParsed={issueParsed}
                  aiGeneratedSummary={aiGeneratedSummary}
                  mediaCount={mediaFiles.length}
                  onBack={() => {
                    setSubmitError(null)
                    setPhase('form')
                  }}
                  onConfirm={() => void handleConfirmSubmit()}
                  isConfirming={reviewConfirmBusy}
                  confirmError={submitError}
                />
              </>
            ) : (
            <form
              id={formId}
              className="flex w-full flex-col"
              onSubmit={handleFormContinue}
              noValidate
            >
              {(success || submitError) && (
                <div className="mb-[18px] flex flex-col gap-[18px] px-6 pt-8 sm:px-12 sm:pt-10">
                  {success && (
                    <div
                      className="w-full max-w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] leading-5 text-emerald-950 lg:max-w-[650px]"
                      role="status"
                    >
                      <p className="font-medium">Request received</p>
                      <p className="mt-1 text-emerald-900/90">
                        Reference:{' '}
                        <span className="font-mono text-[13px]">{success.id}</span>
                      </p>
                      {success.mode === 'demo' && (
                        <p className="mt-2 text-[12px] leading-4 text-emerald-900/75">
                          Demo mode — set{' '}
                          <code className="rounded bg-emerald-100/80 px-1 py-0.5 font-mono text-[11px]">
                            VITE_MAINTENANCE_API_URL
                          </code>{' '}
                          to POST to your API.
                        </p>
                      )}
                    </div>
                  )}

                  {submitError && (
                    <div
                      className="w-full max-w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] leading-5 text-red-950 lg:max-w-[650px]"
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
                        <span className="min-w-0">{submitError}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <MaintenancePortalPageHeader sticky="always" />

              <div className="flex flex-col gap-6 pb-10 lg:flex-row lg:items-start lg:gap-20 xl:gap-28">
                <div className="min-h-0 min-w-0 w-full flex-1 px-6 sm:px-12">
              <fieldset
                disabled={locked}
                className="m-0 flex flex-col gap-[18px] border-0 p-0 pt-4 sm:pt-6 disabled:opacity-60"
              >
                <div
                  className="lg:hidden w-full"
                  role="region"
                  aria-label="Request progress"
                >
                  {mobileProgressCore}
                </div>

                <div className="ml-0 flex w-full min-w-0 max-w-full flex-col gap-[18px] pl-[36px] lg:ml-[120px] lg:pl-0">
                <div className="w-full max-w-full lg:max-w-[650px]">
                  <fieldset className="m-0 border-0 p-0">
                    <legend className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                      Urgency level
                    </legend>
                    <p className="mt-2 max-w-full text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565] lg:max-w-[582px]">
                      Select the urgency level for this maintenance request. This
                      helps us prioritize and respond appropriately.
                    </p>
                    <div
                      className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3"
                      role="radiogroup"
                      aria-label="Urgency level"
                      aria-invalid={showError('urgency')}
                      aria-describedby={
                        showError('urgency') ? 'urgency-error' : undefined
                      }
                    >
                      {URGENCY_OPTIONS.map((opt) => {
                        const selected = urgency === opt.value
                        return (
                          <label
                            key={opt.value}
                            className={`flex min-h-0 min-w-0 w-full cursor-pointer flex-col rounded-[10px] border border-solid p-4 transition-[border-color,box-shadow,background-color] duration-150 ${
                              selected
                                ? 'border-[#944c73] ring-1 ring-[#944c73] hover:bg-[#fdf8fb] hover:ring-2 hover:ring-[#944c73]/25'
                                : showError('urgency')
                                  ? 'border-red-400 ring-1 ring-red-400/40 hover:border-red-500 hover:bg-red-50/60'
                                  : 'border-[#e5e7eb] hover:border-[#944c73]/45 hover:bg-[#fafafa] hover:shadow-sm'
                            }`}
                          >
                            <div className="flex items-start gap-3.5">
                              <span className="shrink-0 self-start">
                                <input
                                  type="radio"
                                  name="urgency"
                                  value={opt.value}
                                  checked={selected}
                                  onChange={() => {
                                    setUrgency(opt.value)
                                    touch('urgency')
                                  }}
                                  className="sr-only"
                                />
                                {selected ? (
                                  <img
                                    src={radioButtonChecked}
                                    alt=""
                                    className="size-6"
                                    aria-hidden
                                  />
                                ) : (
                                  <img
                                    src={radioButtonUnchecked}
                                    alt=""
                                    className="size-6"
                                    aria-hidden
                                  />
                                )}
                              </span>
                              <span className="flex min-w-0 flex-1 flex-col gap-2 text-left text-[14px] tracking-[-0.1504px]">
                                <span className="font-medium leading-[14px] text-[#0a0a0a]">
                                  {opt.title}
                                </span>
                                <span className="font-normal leading-5 text-[#6a7282]">
                                  {opt.description}
                                </span>
                              </span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                    {showError('urgency') && (
                      <p
                        id="urgency-error"
                        className="mt-2 text-[12px] font-medium leading-4 text-red-600"
                      >
                        {errors.urgency}
                      </p>
                    )}
                  </fieldset>
                </div>

                <div className="flex w-full max-w-full flex-col gap-4 lg:max-w-[650px]">
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="resident-name"
                      className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]"
                    >
                      Resident name{' '}
                      <span className="font-medium text-[#99a1af]">Required</span>
                    </label>
                    <input
                      id="resident-name"
                      type="text"
                      autoComplete="name"
                      placeholder="Enter your full name"
                      value={residentName}
                      onChange={(e) => setResidentName(e.target.value)}
                      onBlur={() => touch('residentName')}
                      aria-invalid={showError('residentName')}
                      aria-describedby={
                        showError('residentName')
                          ? 'resident-name-error'
                          : undefined
                      }
                      className={`h-9 py-1 ${fieldClassName(showError('residentName'))}`}
                    />
                    {showError('residentName') && (
                      <p
                        id="resident-name-error"
                        className="text-[12px] font-medium leading-4 text-red-600"
                      >
                        {errors.residentName}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="email"
                      className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]"
                    >
                      Email{' '}
                      <span className="font-medium text-[#99a1af]">Required</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="Enter your registered email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => touch('email')}
                      aria-invalid={showError('email')}
                      aria-describedby={
                        showError('email') ? 'email-error' : undefined
                      }
                      className={`h-9 py-1 ${fieldClassName(showError('email'))}`}
                    />
                    <p className="px-3 text-left text-[12px] font-normal leading-4 text-[#6a7282]">
                      We&apos;ll verify this email is registered as a resident
                      before processing your request
                    </p>
                    {showError('email') && (
                      <p
                        id="email-error"
                        className="text-[12px] font-medium leading-4 text-red-600"
                      >
                        {errors.email}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="resident-phone"
                      className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]"
                    >
                      Mobile phone{' '}
                      <span className="font-medium text-[#99a1af]">
                        Optional
                      </span>
                    </label>
                    <input
                      id="resident-phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="For SMS status updates (e.g. 5551234567)"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onBlur={() => touch('phone')}
                      aria-invalid={showError('phone')}
                      aria-describedby={
                        showError('phone') ? 'resident-phone-error' : undefined
                      }
                      className={`h-9 py-1 ${fieldClassName(showError('phone'))}`}
                    />
                    <p className="px-3 text-left text-[12px] font-normal leading-4 text-[#6a7282]">
                      Text messages when your ticket is submitted, assigned, in
                      progress, or completed.
                    </p>
                    {showError('phone') && (
                      <p
                        id="resident-phone-error"
                        className="text-[12px] font-medium leading-4 text-red-600"
                      >
                        {errors.phone}
                      </p>
                    )}
                  </div>

                  <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                      Status updates via
                    </legend>
                    <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                      We&apos;ll notify you when your request is received, a
                      vendor is assigned, work is in progress, and when it&apos;s
                      complete.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {(
                        [
                          ['both', 'Email and text'],
                          ['email', 'Email only'],
                          ['sms', 'Text only'],
                        ] as const
                      ).map(([value, label]) => (
                        <label
                          key={value}
                          className="flex cursor-pointer items-center gap-2 text-[14px] leading-5 text-[#364153]"
                        >
                          <input
                            type="radio"
                            name="residentNotificationChannel"
                            value={value}
                            checked={residentNotificationChannel === value}
                            onChange={() =>
                              setResidentNotificationChannel(value)
                            }
                            className="size-4 accent-[#9810fa]"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="unit"
                      className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]"
                    >
                      Unit number{' '}
                      <span className="font-medium text-[#99a1af]">Required</span>
                    </label>
                    <input
                      id="unit"
                      type="text"
                      autoComplete="off"
                      placeholder="e.g., 2B, 305, etc."
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      onBlur={() => touch('unit')}
                      aria-invalid={showError('unit')}
                      aria-describedby={
                        showError('unit') ? 'unit-error' : undefined
                      }
                      className={`h-9 py-1 ${fieldClassName(showError('unit'))}`}
                    />
                    {showError('unit') && (
                      <p
                        id="unit-error"
                        className="text-[12px] font-medium leading-4 text-red-600"
                      >
                        {errors.unit}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <div
                      id={
                        showDescriptionClarify ? 'description-clarify' : undefined
                      }
                      role={showDescriptionClarify ? 'region' : undefined}
                      aria-label={
                        showDescriptionClarify
                          ? 'Suggestions from issue analysis'
                          : undefined
                      }
                      className="flex flex-col gap-2"
                    >
                      <div
                        className={[
                          'flex flex-col gap-[8px]',
                          issueDescriptionClarifySheetOpen ? 'max-lg:hidden' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        {...(issueDescriptionClarifySheetOpen
                          ? { inert: true as const }
                          : {})}
                      >
                        <label
                          htmlFor="description"
                          className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]"
                        >
                          Issue description{' '}
                          <span className="font-medium text-[#99a1af]">
                            Required
                          </span>
                        </label>
                        <textarea
                          id="description"
                          rows={5}
                          placeholder="Please describe the maintenance issue in detail..."
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          onBlur={() => touch('description')}
                          aria-invalid={showError('description')}
                          aria-describedby={
                            [
                              showError('description')
                                ? 'description-error'
                                : null,
                              showDescriptionClarify
                                ? 'description-clarify'
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          className={`min-h-[120px] resize-y py-2 text-[14px] font-normal leading-5 ${fieldClassName(showError('description'))}`}
                        />
                      </div>
                      {showDescriptionClarify && (
                        <>
                          <div
                            className="hidden overflow-hidden rounded-xl border border-[#e9cbf7] bg-gradient-to-br from-[#faf5ff] via-white to-[#f3f4ff] text-left shadow-sm ring-1 ring-black/[0.03] lg:block"
                            role="status"
                            aria-live="polite"
                          >
                            <div className="flex items-start gap-2 border-b border-[#e9d4ff]/55 bg-white/55 px-3 py-2.5 sm:px-4 lg:items-center">
                              <span className="flex size-8 shrink-0 items-center justify-center self-start rounded-lg bg-[#f3e8ff] text-[#9810fa] lg:self-auto">
                                <SparkleIcon className="size-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold leading-5 text-[#59168b]">
                                  Helpful Details To Add
                                </p>
                                <p className="text-[11px] leading-4 text-[#7c3aed]/85">
                                  See followup questions to add to your request.
                                </p>
                              </div>
                              {clarifyLoading && (
                                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[#9810fa]/90">
                                  Analyzing…
                                </span>
                              )}
                            </div>
                            <div className="space-y-3 px-3 py-3 sm:px-4 sm:py-3.5">
                              <IssueDescriptionClarifyBody
                                clarifyLoading={clarifyLoading}
                                clarifyError={clarifyError}
                                clarifyQuestions={clarifyQuestions}
                                issueParsed={issueParsed}
                                hasStructuredParse={hasStructuredParse}
                                formUrgency={urgency}
                                suggestedUrgencyApplyAck={suggestedUrgencyApplyAck}
                                onApplySuggestedUrgency={(u) => {
                                  setUrgency(u)
                                  touch('urgency')
                                  setSuggestedUrgencyApplyAck(true)
                                }}
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            className={`flex w-full overflow-hidden rounded-xl border border-[#e9cbf7] bg-gradient-to-br from-[#faf5ff] via-white to-[#f3f4ff] text-left shadow-sm ring-1 ring-black/[0.03] lg:hidden ${issueDescriptionClarifySheetOpen ? 'max-lg:hidden' : ''}`}
                            aria-expanded={issueDescriptionClarifySheetOpen}
                            aria-controls="issue-description-clarify-sheet-panel"
                            onClick={() =>
                              setIssueDescriptionClarifySheetOpen(true)
                            }
                          >
                            <span className="flex w-full items-start gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
                              <span className="flex size-8 shrink-0 items-center justify-center self-start rounded-lg bg-[#f3e8ff] text-[#9810fa]">
                                <SparkleIcon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-semibold leading-5 text-[#59168b]">
                                  Helpful Details To Add
                                </span>
                                <span className="mt-0.5 block text-[11px] leading-4 text-[#7c3aed]/85">
                                  Tap to view analysis and follow-up questions.
                                </span>
                              </span>
                              {clarifyLoading && (
                                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[#9810fa]/90">
                                  Analyzing…
                                </span>
                              )}
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                    {issueDescriptionClarifySheetOpen &&
                      createPortal(
                        <div
                          className="fixed inset-0 z-[60] lg:hidden"
                          role="presentation"
                        >
                          <button
                            type="button"
                            className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ease-out ${
                              issueClarifySheetEntered
                                ? 'opacity-100'
                                : 'opacity-0'
                            }`}
                            aria-label="Close helpful details"
                            data-clarify-sheet-backdrop
                            onClick={() =>
                              setIssueDescriptionClarifySheetOpen(false)
                            }
                          />
                          <div
                            data-clarify-sheet-panel
                            id="issue-description-clarify-sheet-panel"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="issue-description-clarify-sheet-title"
                            className={`absolute inset-0 flex h-[100dvh] max-h-[100dvh] flex-col border-[#e9cbf7] bg-gradient-to-br from-[#faf5ff] via-white to-[#f3f4ff] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform ${
                              issueClarifySheetEntered
                                ? 'translate-y-0'
                                : 'translate-y-full'
                            } pt-[env(safe-area-inset-top,0px)]`}
                          >
                            <div className="flex shrink-0 items-center gap-2 border-b border-[#e9d4ff]/55 bg-white/70 px-3 py-3 sm:px-4">
                              <button
                                type="button"
                                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-[#59168b] transition-colors hover:bg-[#f3e8ff]"
                                aria-label="Back"
                                onClick={() =>
                                  setIssueDescriptionClarifySheetOpen(false)
                                }
                              >
                                <svg
                                  className="size-6"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden
                                >
                                  <path d="M15 18l-6-6 6-6" />
                                </svg>
                              </button>
                              <h2
                                id="issue-description-clarify-sheet-title"
                                className="min-w-0 flex-1 text-left text-[15px] font-semibold leading-snug text-[#59168b]"
                              >
                                Helpful details to add
                              </h2>
                            </div>
                            <div
                              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
                              role="status"
                              aria-live="polite"
                            >
                              <div className="mb-5 flex flex-col gap-[8px] border-b border-[#e9d4ff]/55 pb-5">
                                <label
                                  htmlFor="description-sheet"
                                  className="text-left text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]"
                                >
                                  Issue description{' '}
                                  <span className="font-medium text-[#99a1af]">
                                    Required
                                  </span>
                                </label>
                                <textarea
                                  ref={descriptionSheetTextareaRef}
                                  id="description-sheet"
                                  rows={5}
                                  placeholder="Please describe the maintenance issue in detail..."
                                  value={description}
                                  onChange={(e) => setDescription(e.target.value)}
                                  onBlur={() => touch('description')}
                                  aria-invalid={showError('description')}
                                  aria-describedby={
                                    [
                                      showError('description')
                                        ? 'description-error-sheet'
                                        : null,
                                      showDescriptionClarify
                                        ? 'description-clarify'
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' ') || undefined
                                  }
                                  className={`min-h-[120px] resize-y py-2 text-[14px] font-normal leading-5 ${fieldClassName(showError('description'))}`}
                                />
                                {showError('description') && (
                                  <p
                                    id="description-error-sheet"
                                    className="text-[12px] font-medium leading-4 text-red-600"
                                    role="alert"
                                  >
                                    {errors.description}
                                  </p>
                                )}
                              </div>
                              <IssueDescriptionClarifyBody
                                clarifyLoading={clarifyLoading}
                                clarifyError={clarifyError}
                                clarifyQuestions={clarifyQuestions}
                                issueParsed={issueParsed}
                                hasStructuredParse={hasStructuredParse}
                                formUrgency={urgency}
                                suggestedUrgencyApplyAck={suggestedUrgencyApplyAck}
                                applyUrgencySheetLayout
                                onApplySuggestedUrgency={(u) => {
                                  setUrgency(u)
                                  touch('urgency')
                                  setSuggestedUrgencyApplyAck(true)
                                }}
                              />
                            </div>
                            <div className="shrink-0 border-t border-[#e9d4ff]/55 bg-white/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-[0_-4px_24px_rgba(0,0,0,0.06)]">
                              <button
                                type="button"
                                className="flex h-11 w-full items-center justify-center rounded-lg bg-[#9810fa] px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#8710e0] active:bg-[#7620c7]"
                                onClick={() =>
                                  setIssueDescriptionClarifySheetOpen(false)
                                }
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        </div>,
                        document.body,
                      )}
                    {showError('description') && (
                      <p
                        id="description-error"
                        className={`text-[12px] font-medium leading-4 text-red-600 ${
                          issueDescriptionClarifySheetOpen
                            ? 'max-lg:hidden'
                            : ''
                        }`}
                      >
                        {errors.description}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                      Upload photos or videos{' '}
                      <span className="font-medium text-[#99a1af]">Required</span>
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,.jpg,.jpeg,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                      className="sr-only"
                      onChange={(e) => {
                        const list = e.target.files
                        if (!list?.length) return
                        const incoming = Array.from(list)
                        setMediaFiles((prev) => {
                          const next = [...prev]
                          for (const f of incoming) {
                            const dup = next.some(
                              (x) =>
                                x.name === f.name &&
                                x.size === f.size &&
                                x.lastModified === f.lastModified,
                            )
                            if (!dup) next.push(f)
                          }
                          return next
                        })
                        touch('photo')
                        e.target.value = ''
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className={`flex min-h-[136px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed px-6 pb-6 pt-6 transition-colors ${
                        showError('photo')
                          ? 'border-red-400 bg-red-50/50 hover:border-red-500/70'
                          : 'border-[#d1d5dc] bg-transparent hover:border-[#944c73]/50'
                      }`}
                    >
                      <span className="flex w-full max-w-full flex-col items-center justify-center gap-2 text-center">
                        <img
                          src={uploadIcon}
                          alt=""
                          className="size-8 shrink-0 object-contain"
                        />
                        <span className="flex w-full flex-col items-center gap-1 px-1">
                          <span className="max-w-full break-words text-center text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                            {mediaFiles.length > 0
                              ? 'Add more files'
                              : 'Click to upload'}
                          </span>
                          <span className="text-center text-[12px] font-normal leading-4 text-[#6a7282]">
                            PNG, JPG, MP4, WebM, or MOV — up to 50MB each; multiple
                            files allowed
                          </span>
                        </span>
                      </span>
                    </button>
                    {mediaFiles.length > 0 && (
                      <ul
                        className="flex flex-col gap-2"
                        aria-label="Uploaded files"
                      >
                        {mediaFiles.map((file, i) => {
                          const previewUrl = mediaPreviewUrls[i]
                          if (!previewUrl) return null
                          return (
                            <li
                              key={`${file.name}-${file.size}-${file.lastModified}-${i}`}
                              className="flex items-center gap-3 rounded-lg border border-[#e5e7eb] bg-white py-2.5 pl-3 pr-1"
                            >
                              <span
                                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100"
                                aria-hidden
                              >
                                <svg
                                  className="size-5 text-emerald-700"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2.5}
                                  aria-hidden
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              </span>
                              {isImageFile(file) ? (
                                <img
                                  src={previewUrl}
                                  alt=""
                                  className="size-14 shrink-0 rounded-md border border-[#e5e7eb] object-cover"
                                />
                              ) : isVideoFile(file) ? (
                                <video
                                  src={previewUrl}
                                  muted
                                  playsInline
                                  className="h-14 w-24 shrink-0 rounded-md border border-[#e5e7eb] object-cover"
                                  aria-hidden
                                />
                              ) : (
                                <span className="flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed border-[#d1d5dc] bg-[#f9fafb] text-[10px] font-medium text-[#6a7282]">
                                  File
                                </span>
                              )}
                              <span className="min-w-0 flex-1 break-words text-left text-[14px] font-medium leading-snug tracking-[-0.1504px] text-[#0a0a0a]">
                                {file.name}
                              </span>
                              <button
                                type="button"
                                className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#6a7282] transition-colors hover:bg-[#f3f3f5] hover:text-[#0a0a0a]"
                                aria-label={`Remove ${file.name}`}
                                onClick={() => {
                                  setMediaFiles((prev) =>
                                    prev.filter((_, j) => j !== i),
                                  )
                                  touch('photo')
                                }}
                              >
                                <svg
                                  className="size-5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  aria-hidden
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {showError('photo') && (
                      <p className="text-[12px] font-medium leading-4 text-red-600">
                        {errors.photo}
                      </p>
                    )}
                  </div>
                </div>
                </div>
              </fieldset>
                </div>

                <div
                  className="flex w-full min-w-0 shrink-0 flex-col items-center justify-center bg-transparent pl-12 pr-6 pb-1 pt-[199px] sm:pl-24 sm:pr-12 lg:sticky lg:top-14 lg:mr-[336px] lg:min-w-0 lg:flex-1 lg:shrink-0 lg:self-stretch lg:pt-[199px] lg:pl-20 lg:pr-0 xl:pl-28"
                >
                  <div className="mx-auto flex w-full max-w-[min(100%,42rem)] flex-col items-center text-center sm:max-w-[min(100%,46rem)] lg:max-w-[min(100%,50rem)]">
                    <img
                      src={maintenanceRequestHeroIllustration}
                      alt=""
                      className="pointer-events-none mx-auto h-auto w-full max-w-[min(100%,308px)] shrink-0 select-none object-contain sm:max-w-[332px] lg:max-w-[355px]"
                      decoding="async"
                      loading="lazy"
                      aria-hidden
                    />
                    <p className="mt-4 w-full max-w-full whitespace-nowrap text-center text-[22px] font-normal leading-7 tracking-[-0.1504px] text-[#4a5565] sm:text-[24px]">
                      Submit a request and we&apos;ll take care of the rest.
                    </p>
                  </div>
                </div>
              </div>
            </form>
            )}
          </div>

          <aside className="hidden w-full shrink-0 bg-white px-6 pb-10 pt-6 lg:flex lg:w-[300px] lg:items-start lg:border-l lg:border-[#e5e7eb] lg:px-8 lg:pb-12 lg:pt-10">
            <div className="mt-[50px] h-fit w-full min-w-0 lg:sticky lg:top-[50px] lg:z-10 lg:self-start">
              <div className="flex flex-col items-center text-center">
                <div className="flex size-12 items-center justify-center rounded-[10px] bg-[#101828]">
                  <img
                    src={homeIcon}
                    alt=""
                    className="size-12 object-contain"
                  />
                </div>
                <h2 className="mt-4 text-[20px] font-semibold leading-7 tracking-[-0.4492px] text-[#0a0a0a]">
                  Property Management
                </h2>
                <p className="mt-1 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                  Quick Maintenance Request
                </p>
              </div>

              <ul className="mt-6 flex flex-col gap-4">
                <li className="flex items-center gap-2">
                  <img
                    src={checkmarkIcon}
                    alt=""
                    className="size-5 shrink-0"
                  />
                  <span className="text-left text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                    Provide Request Details
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <img
                    src={
                      phase === 'review' || success ? checkmarkIcon : dashIcon
                    }
                    alt=""
                    className="size-5 shrink-0"
                  />
                  <span className="text-left text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                    Submit & Confirm Request
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <img
                    src={dashIcon}
                    alt=""
                    className="size-5 shrink-0"
                  />
                  <span className="text-left text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                    Track request status
                  </span>
                </li>
              </ul>

              <button
                type={phase === 'form' ? 'submit' : 'button'}
                form={phase === 'form' ? formId : undefined}
                disabled={
                  phase !== 'form' || !canSubmit || isSubmitting || locked
                }
                className={`mt-6 h-9 w-full rounded-lg text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  sidebarSubmitJetBlack ? 'bg-black' : 'bg-[#101828]'
                } ${
                  phase === 'review' && reviewConfirmBusy ? '!opacity-100' : ''
                } ${
                  phase === 'form' &&
                  canSubmit &&
                  !isSubmitting &&
                  !locked
                    ? 'cursor-pointer hover:bg-neutral-900'
                    : ''
                }`}
              >
                {reviewConfirmBusy && phase === 'review'
                  ? isSubmitting
                    ? 'Submitting…'
                    : 'Verification…'
                  : locked
                    ? 'Submitted'
                    : 'Submit Request'}
              </button>

              {locked && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="mt-3 w-full rounded-lg border border-[#e5e7eb] bg-white py-2 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153] transition-colors hover:bg-[#f9fafb]"
                >
                  New request
                </button>
              )}
            </div>
          </aside>
        </div>

        {/* Mobile / tablet: primary actions at bottom of card (after form content) */}
        {(phase === 'form' && !locked) || locked ? (
          <div className="border-t border-[#e5e7eb] bg-white px-4 py-4 sm:px-6 lg:hidden">
            {phase === 'form' && !locked ? (
              <button
                type="submit"
                form={formId}
                disabled={!canSubmit || isSubmitting}
                className={`h-9 w-full rounded-lg text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  sidebarSubmitJetBlack ? 'bg-black' : 'bg-[#101828]'
                } ${
                  canSubmit && !isSubmitting
                    ? 'cursor-pointer hover:bg-neutral-900'
                    : ''
                }`}
              >
                Submit Request
              </button>
            ) : null}
            {locked ? (
              <>
                <button
                  type="button"
                  disabled
                  className="h-9 w-full rounded-lg bg-[#101828] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white opacity-80"
                >
                  Submitted
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="mt-2 w-full rounded-lg border border-[#e5e7eb] bg-white py-2 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153] transition-colors hover:bg-[#f9fafb]"
                >
                  New request
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <VerifyIdentityModal
        open={verifyModalOpen}
        email={email}
        onExit={() => {
          setVerifyModalOpen(false)
          setOtpFlowState('idle')
        }}
        onFlowStateChange={setOtpFlowState}
        onVerified={() => {
          setVerifyModalOpen(false)
          setOtpFlowState('idle')
          void performSubmit()
        }}
      />
    </main>
  )
}
