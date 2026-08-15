import { useState } from 'react'
import { IconRoadmap } from '@/components/landing/LandingIcons'
import trackingIcon from '@/assets/Tracking.png'
import aiBotIcon from '@/assets/ai-bot-icon.png'
import processIcon from '@/assets/process.png'
import chatIcon from '@/assets/chat.png'
import tenantTextPreview from '@/assets/Tenant.png'
import featuresAiOrganizes from '@/assets/landing/AI organizes.png'
import featuresWorkspace from '@/assets/Workspace.png'
import featuresActivityFeed from '@/assets/Ulo Activity Feed 14.png'

type FeatureId = 'track-workflow-execution' | 'ai-organizes' | 'ulo-coordinates' | 'tenant-text'

type FeatureItem = {
  id: FeatureId
  title: string
  description?: string
  icon: string
  iconSizeClass?: string
  iconWrap?: boolean
  inactiveTitleClass?: string
  /** Title weight class (default `font-bold`). */
  titleWeightClass?: string
  /** Override default title size (default `text-[19px] lg:text-base`). */
  titleSizeClass?: string
  /** Override default description size (default `text-[17px] lg:text-sm`). */
  descriptionSizeClass?: string
  /** Icon + title only — centered row, width hugs content. */
  compactCenter?: boolean
}

const FEATURES: FeatureItem[] = [
  {
    id: 'tenant-text',
    title: 'Tenant Text',
    description:
      'Maintenance starts with a simple text.',
    icon: chatIcon,
  },
  {
    id: 'ai-organizes',
    title: 'AI organizes',
    description:
      'Turns requests into organized workflows',
    icon: aiBotIcon,
  },
  {
    id: 'ulo-coordinates',
    title: 'Ulo Coordinates',
    description:
      'Keeps vendors, schedules, and repairs moving.',
    icon: processIcon,
  },
  {
    id: 'track-workflow-execution',
    title: 'Track workflow execution',
    description:
      'Landlords can track repair history, vendor performance, repeat issues, maintenance costs, timelines, and potential future problems.',
    icon: trackingIcon,
  },
]

const EMPHASIZED_PREVIEW_WIDTH = 'mx-auto w-[70.55%] lg:mx-0'
const AI_ORGANIZES_PREVIEW_WIDTH = 'mx-auto w-[83.2%] lg:mx-0'

const FEATURE_PREVIEWS: Record<
  FeatureId,
  {
    src: string
    alt: string
    width: number
    height: number
    displayWidthClass?: string
    /** Overflow-clip offsets (e.g. `-mt-[30px] -ml-[25%] w-[125%] max-w-none`). */
    cropClass?: string
    /** Shifts the preview frame (e.g. `-mt-[40px]`). */
    offsetClass?: string
  }
> = {
  'track-workflow-execution': {
    src: featuresActivityFeed,
    alt: 'Ulo activity feed showing actions completed across properties',
    width: 966,
    height: 810,
    displayWidthClass: 'mx-auto w-[60%] lg:mx-0',
    offsetClass: 'translate-x-[50px]',
  },
  'ai-organizes': {
    src: featuresAiOrganizes,
    alt: 'AI intake and workflow progress: work order stages from classification through vendor assignment on the property dashboard',
    width: 1452,
    height: 1095,
    displayWidthClass: AI_ORGANIZES_PREVIEW_WIDTH,
    cropClass: '-mt-[30px] -ml-[25%] w-[125%] max-w-none',
    offsetClass: '-mt-[40px]',
  },
  'ulo-coordinates': {
    src: featuresWorkspace,
    alt: 'Ulo workspace board with New Intake, Assigned, and In Progress work orders',
    width: 901,
    height: 689,
    displayWidthClass: 'mx-auto w-[70%] lg:mx-0',
  },
  'tenant-text': {
    src: tenantTextPreview,
    alt: 'Tenant texts a maintenance issue; Ulo triages urgency, routes vendors, and tracks status by SMS',
    width: 2587,
    height: 2457,
    displayWidthClass: EMPHASIZED_PREVIEW_WIDTH,
  },
}

function FeatureIcon({ feature, dimmed }: { feature: FeatureItem; dimmed?: boolean }) {
  const iconClass = dimmed ? 'opacity-50 grayscale' : ''
  const iconSizeClass = feature.iconSizeClass ?? 'size-[42px] lg:size-[35px]'

  if (feature.iconWrap) {
    return (
      <div
        className={`flex size-[53px] shrink-0 items-center justify-center rounded-2xl transition-[opacity,filter] duration-500 ease-in-out motion-reduce:transition-none lg:size-11 ${iconClass}`}
      >
        <img src={feature.icon} alt="" className="size-[38px] object-contain lg:size-8" />
      </div>
    )
  }

  return (
    <img
      src={feature.icon}
      alt=""
      className={`${iconSizeClass} shrink-0 object-contain transition-[opacity,filter] duration-500 ease-in-out motion-reduce:transition-none ${iconClass}`}
    />
  )
}

function FeatureNavButton({
  feature,
  isHighlighted,
  onHighlight,
}: {
  feature: FeatureItem
  isHighlighted: boolean
  onHighlight: () => void
}) {
  const compact = feature.compactCenter === true
  const titleWeightClass = feature.titleWeightClass ?? 'font-medium'
  const titleSizeClass = feature.titleSizeClass ?? 'text-[25px] lg:text-[21px]'
  const descriptionSizeClass = feature.descriptionSizeClass ?? 'text-[22px] lg:text-[18px]'
  const showDescription = Boolean(feature.description) && isHighlighted && !compact

  return (
    <button
      type="button"
      aria-pressed={isHighlighted}
      onMouseEnter={onHighlight}
      onFocus={onHighlight}
      onClick={onHighlight}
      className={`sa-press flex cursor-pointer items-start gap-5 rounded-2xl px-[34px] py-1 text-left transition-[opacity] duration-500 ease-in-out motion-reduce:transition-none lg:gap-4 lg:pl-7 lg:pr-0 landing-compact:!px-0 ${
        compact ? 'w-fit items-center justify-center' : 'w-full lg:w-auto'
      } ${isHighlighted ? '' : 'opacity-50 hover:opacity-65'}`}
    >
      {compact ? (
        <div className="flex items-center justify-center gap-5 lg:gap-4">
          <FeatureIcon feature={feature} dimmed={!isHighlighted} />
          <h3
            className={`font-[family-name:var(--font-landing-heading)] ${titleSizeClass} ${titleWeightClass} ${
              isHighlighted ? 'text-[#111827]' : feature.inactiveTitleClass ?? 'text-[#858c99]'
            }`}
          >
            {feature.title}
          </h3>
        </div>
      ) : (
        <div className="flex items-start gap-5 lg:gap-4">
          <FeatureIcon feature={feature} dimmed={!isHighlighted} />
          <div className="min-w-0 flex-1">
            <h3
              className={`font-[family-name:var(--font-landing-heading)] ${titleSizeClass} ${titleWeightClass} ${
                isHighlighted ? 'text-[#111827]' : feature.inactiveTitleClass ?? 'text-[#858c99]'
              }`}
            >
              {feature.title}
            </h3>
            {feature.description ? (
              <div
                className={`overflow-hidden transition-[max-height] duration-500 ease-in-out motion-reduce:transition-none ${
                  showDescription
                    ? 'max-h-40 landing-compact:!max-h-[22rem]'
                    : 'max-h-0'
                }`}
              >
                <p
                  className={`pl-0 font-normal leading-[1.625] text-[#6b7280] transition-transform duration-500 ease-out motion-reduce:transition-none ${descriptionSizeClass} ${
                    showDescription ? 'translate-y-0' : '-translate-y-full'
                  }`}
                >
                  {feature.description}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </button>
  )
}

/** Features section interactive showcase (Figma 464:361). */
function FeaturePreviewPanel({ activeId }: { activeId: FeatureId }) {
  const preview = FEATURE_PREVIEWS[activeId]
  const widthClass = preview.displayWidthClass ?? 'w-full lg:mx-0'
  const cropClass = preview.cropClass ?? 'w-full max-w-full'

  return (
    <div className="relative flex min-w-0 w-full flex-1 items-center justify-center lg:min-w-[280px] lg:justify-start landing-compact:justify-center" aria-live="polite">
      <div className={`overflow-hidden ${widthClass} ${preview.offsetClass ?? ''} landing-compact:!w-full landing-compact:!translate-x-0`}>
        <img
          key={activeId}
          src={preview.src}
          alt={preview.alt}
          className={`block h-auto saturate-[90%] contrast-[90%] animate-[feature-preview-fade_0.6s_ease-in-out] ${cropClass} landing-compact:!ml-0 landing-compact:!mt-0 landing-compact:!w-full`}
          width={preview.width}
          height={preview.height}
        />
      </div>
    </div>
  )
}

export function FeaturesShowcase() {
  const [activeId, setActiveId] = useState<FeatureId>('tenant-text')

  return (
    <div className="mx-auto mb-4 w-full overflow-visible pb-8 lg:mb-6 lg:pb-10">
      <header className="mb-10 lg:mb-12">
        <p className="inline-flex items-center gap-2 font-mono text-xs font-normal uppercase tracking-wide text-slate-900">
          <IconRoadmap className="size-4 shrink-0 text-[#81228A]" />
          How It Works
        </p>
        <h3 className="mt-3 whitespace-nowrap font-[family-name:var(--font-landing-heading)] text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.1] tracking-[-0.02em] text-slate-900 landing-compact:whitespace-normal landing-390:!text-[1.75rem]">
          <span className="landing-390:whitespace-nowrap">SMS-first maintenance</span>{' '}
          <span className="landing-390:whitespace-nowrap">management</span>
        </h3>
        <p className="mt-4 text-lg font-normal leading-relaxed text-slate-700">
          Less maintenance chaos. More control.
        </p>
      </header>

      <div className="flex w-full flex-col items-start gap-8 overflow-visible lg:flex-row lg:items-center lg:gap-4">
          <nav
            className="flex w-full shrink-0 flex-col gap-[61px] transition-[gap] duration-500 ease-in-out motion-reduce:transition-none lg:w-auto lg:max-w-[463px] lg:gap-16"
            aria-label="Product features"
          >
            {FEATURES.map((feature) => (
              <FeatureNavButton
                key={feature.id}
                feature={feature}
                isHighlighted={feature.id === activeId}
                onHighlight={() => setActiveId(feature.id)}
              />
            ))}
          </nav>

          <FeaturePreviewPanel activeId={activeId} />
      </div>
    </div>
  )
}
