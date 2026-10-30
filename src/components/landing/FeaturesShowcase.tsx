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

/** 640×480 landscape (and nearby) — matches FeaturesMarquee band. */
const LANDING_640_480 =
  '[@media(min-width:610px)_and_(max-width:670px)_and_(min-height:450px)_and_(max-height:510px)]'

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

const EMPHASIZED_PREVIEW_WIDTH = 'w-full lg:mx-0 lg:w-[70.55%]'
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
    displayWidthClass: 'w-full lg:mx-0 lg:w-[60%]',
    offsetClass: 'lg:translate-x-[50px]',
  },
  'ai-organizes': {
    src: featuresAiOrganizes,
    alt: 'AI intake and workflow progress: work order stages from classification through vendor assignment on the property dashboard',
    width: 879,
    height: 961,
  },
  'ulo-coordinates': {
    src: featuresWorkspace,
    alt: 'Ulo workspace board with New Intake, Assigned, and In Progress work orders',
    width: 901,
    height: 689,
    displayWidthClass: 'w-full lg:mx-0 lg:w-[70%]',
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
  const iconSizeClass = feature.iconSizeClass ?? 'size-8 lg:size-[35px] landing-4096-2304:!size-[42px] landing-5120-2880:!size-[42px] landing-7680-4320:!size-[87.5px]'

  if (feature.iconWrap) {
    return (
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-2xl transition-[opacity,filter] duration-[var(--sa-duration)] ease-[var(--sa-ease)] motion-reduce:transition-none lg:size-11 ${iconClass}`}
      >
        <img src={feature.icon} alt="" className="size-7 object-contain lg:size-8" />
      </div>
    )
  }

  return (
    <img
      src={feature.icon}
      alt=""
      className={`${iconSizeClass} shrink-0 object-contain transition-[opacity,filter] duration-[var(--sa-duration)] ease-[var(--sa-ease)] motion-reduce:transition-none ${iconClass}`}
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
  const titleSizeClass = feature.titleSizeClass ?? 'text-[17px] lg:text-[21px] landing-4096-2304:!text-[27.3px] landing-5120-2880:!text-[27.3px] landing-7680-4320:!text-[52.5px]'
  const descriptionSizeClass = feature.descriptionSizeClass ?? 'text-[14px] leading-relaxed lg:text-[18px] lg:leading-[1.625] landing-4096-2304:!text-[23.4px] landing-5120-2880:!text-[23.4px] landing-7680-4320:!text-[45px]'
  const showDescription = Boolean(feature.description) && isHighlighted && !compact

  return (
    <button
      type="button"
      aria-pressed={isHighlighted}
      onMouseEnter={onHighlight}
      onFocus={onHighlight}
      onClick={onHighlight}
      className={`landing-how-it-works-feature-item sa-press relative z-0 flex cursor-pointer items-start gap-5 rounded-2xl px-[34px] py-1 text-left transition-[opacity,transform,color] duration-[var(--sa-duration)] ease-[var(--sa-ease)] motion-reduce:transition-none lg:gap-4 lg:pl-0 lg:pr-0 landing-4096-2304:py-[0.3rem] landing-5120-2880:py-[0.3rem] landing-compact:!px-0 landing-phone-tall:!px-0 ${LANDING_640_480}:!px-0 ${LANDING_640_480}:gap-2 landing-884:gap-3 landing-884:px-0 landing-884:pl-0 landing-720-1280:!px-0 landing-720-1280:gap-2 ${
        compact ? 'w-fit items-center justify-center' : 'w-full lg:w-auto landing-720-1280:w-full'
      } ${isHighlighted ? 'z-10' : 'opacity-50 hover:opacity-65'}`}
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
        <div className="relative flex min-w-0 flex-1 items-start gap-5 lg:gap-4 landing-720-1280:gap-2">
          <FeatureIcon feature={feature} dimmed={!isHighlighted} />
          <div className="relative min-w-0 flex-1">
            <h3
              className={`font-[family-name:var(--font-landing-heading)] ${titleSizeClass} ${titleWeightClass} landing-720-1280:break-words landing-720-1280:text-[15px] landing-720-1280:leading-snug ${
                isHighlighted ? 'text-[#111827]' : feature.inactiveTitleClass ?? 'text-[#858c99]'
              }`}
            >
              {feature.title}
            </h3>
            {feature.description ? (
              <div
                className={`pointer-events-none grid transition-[grid-template-rows,opacity] duration-[var(--sa-duration)] ease-[var(--sa-ease)] motion-reduce:transition-none ${
                  showDescription ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
                aria-hidden={!showDescription}
              >
                <div className="overflow-hidden">
                  <p
                    className={`pt-2 font-normal text-[#6b7280] ${descriptionSizeClass} landing-720-1280:break-words landing-720-1280:text-[12px] landing-720-1280:leading-snug`}
                  >
                    {feature.description}
                  </p>
                </div>
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
    <div
      className={`landing-how-it-works-preview landing-1440-900-feature-preview landing-1680-1050-feature-preview landing-1728-1117-feature-preview landing-1920-1080-feature-preview relative flex min-w-0 w-full items-center justify-start overflow-hidden max-[410px]:w-[calc(100vw-3rem)] max-[410px]:max-w-none landing-compact:w-[calc(100vw-3rem)] landing-compact:max-w-none landing-phone-tall:w-[calc(100vw-3rem)] landing-phone-tall:max-w-none landing-tablet-portrait:overflow-hidden landing-768-360-preview:h-[21.12rem] landing-991-568-preview:h-[21.12rem] landing-768-1024:h-[21.12rem] landing-768-1366:h-[21.12rem] landing-800-1280:h-[21.12rem] landing-820-1180:!h-[21.12rem] landing-820-1180:!overflow-hidden landing-834-1194:!h-[21.12rem] landing-834-1194:!overflow-hidden landing-720-1280:!h-[21.12rem] landing-720-1280:!overflow-hidden landing-884-1104:h-[21.12rem] landing-912-1368:h-[21.12rem] landing-991-1280:h-[21.12rem] landing-1024-1440-preview:!h-[21.12rem] landing-1024-1366:!h-[21.12rem] landing-1024-600:!h-[21.12rem] landing-1024-600:!overflow-hidden ${LANDING_640_480}:min-w-0 ${LANDING_640_480}:w-full landing-884:min-w-0 landing-884:w-full landing-1024-1440:overflow-hidden landing-2560-1440:overflow-hidden landing-desktop:min-w-0 landing-desktop:w-full landing-desktop:overflow-hidden landing-desktop:!h-[min(36rem,62vh)] landing-1920-1080:!h-[min(36rem,62vh)] landing-3440-1440:min-w-0 landing-3440-1440:w-full landing-3440-1440:overflow-hidden landing-3840-2160:min-w-0 landing-3840-2160:w-full landing-3840-2160:overflow-hidden landing-4096-2304:min-w-0 landing-4096-2304:w-full landing-4096-2304:overflow-hidden landing-5120-2880:min-w-0 landing-5120-2880:w-full landing-5120-2880:overflow-hidden landing-7680-4320:min-w-0 landing-7680-4320:w-full landing-7680-4320:overflow-hidden landing-7680-4320:!h-[min(90rem,62vh)] lg:h-[min(36rem,62vh)] lg:w-full lg:min-w-0`}
      aria-live="polite"
    >
      <div className="landing-how-it-works-preview-frame landing-768-360-preview-frame landing-991-568-preview-frame landing-768-1024-preview-frame landing-768-1366-preview-frame landing-800-1280-preview-frame landing-820-1180-preview-frame landing-834-1194-preview-frame landing-720-1280-preview-frame landing-884-1104-preview-frame landing-912-1368-preview-frame landing-991-1280-preview-frame landing-1024-1366-preview-frame landing-1024-600-preview-frame landing-1024-1440-preview-frame landing-desktop-preview-frame landing-3440-1440-preview-frame landing-3840-2160-preview-frame landing-5120-2880-preview-frame landing-7680-4320-preview-frame relative h-full w-full overflow-hidden">
        <div className="landing-how-it-works-preview-inner absolute inset-0 flex h-full w-full items-center justify-center">
          <img
            key={activeId}
            src={preview.src}
            alt={preview.alt}
            className={`landing-how-it-works-preview-img landing-768-360-preview-img landing-991-568-preview-img landing-768-1024-preview-img landing-768-1366-preview-img landing-800-1280-preview-img landing-820-1180-preview-img landing-834-1194-preview-img landing-720-1280-preview-img landing-884-1104-preview-img landing-912-1368-preview-img landing-991-1280-preview-img landing-1024-1366-preview-img landing-1024-600-preview-img landing-1024-1440-preview-img landing-desktop-preview-img landing-3440-1440-preview-img landing-3840-2160-preview-img landing-5120-2880-preview-img landing-7680-4320-preview-img block h-full max-h-full animate-[feature-preview-fade_var(--sa-duration)_var(--sa-ease)] object-contain object-center ${LANDING_640_480}:max-h-full ${widthClass} ${preview.offsetClass ?? ''} ${cropClass}`}
            width={preview.width}
            height={preview.height}
          />
        </div>
      </div>
    </div>
  )
}

export function FeaturesShowcase() {
  const [activeId, setActiveId] = useState<FeatureId>('tenant-text')

  return (
    <div className="mx-auto mb-4 flex w-full flex-col items-center overflow-visible pb-8 lg:mb-6 lg:pb-10">
      <header className="mb-5 flex flex-col items-center text-center lg:mb-6 landing-1280-800:!mb-10 landing-1512-982:!mb-10 landing-1728-1117:!mb-10 landing-3840-2160:!mb-10">
        <p className="sa-pill inline-flex items-center gap-2 rounded-full bg-transparent px-4 py-2 font-mono text-xs font-normal uppercase tracking-wide text-[#611879] landing-4096-2304:text-[0.975rem] landing-5120-2880:text-[0.975rem] landing-4096-2304:gap-[0.65rem] landing-5120-2880:gap-[0.65rem] landing-4096-2304:px-5 landing-5120-2880:px-5 landing-4096-2304:py-2.5 landing-5120-2880:py-2.5 landing-7680-4320:text-[1.875rem] landing-7680-4320:gap-5 landing-7680-4320:px-10 landing-7680-4320:py-5">
          <IconRoadmap className="size-4 shrink-0 text-[#81228A] landing-4096-2304:size-[1.3rem] landing-5120-2880:size-[1.3rem] landing-7680-4320:size-10" />
          How It Works
        </p>
        <div className="mt-4 flex flex-col items-center gap-4 text-center landing-4096-2304:mt-[1.3rem] landing-5120-2880:mt-[1.3rem] landing-4096-2304:gap-5 landing-5120-2880:gap-5 landing-7680-4320:mt-10 landing-7680-4320:gap-10">
          <h2 className="font-[family-name:var(--font-landing-heading)] text-[48px] font-medium leading-[1.1] tracking-[-0.02em] text-slate-900 max-[349px]:flex max-[349px]:flex-col max-[349px]:text-[1.75rem] landing-compact:flex landing-compact:flex-col landing-compact:text-[1.75rem] landing-phone-tall:flex landing-phone-tall:flex-col landing-phone-tall:text-[1.75rem] landing-320-568:!flex landing-320-568:!flex-col landing-320-568:w-full landing-320-568:text-[1.75rem] landing-4096-2304:text-[62.4px] landing-5120-2880:text-[62.4px] landing-7680-4320:text-[120px]">
            <span className="landing-320-568:block">SMS-first maintenance</span>
            <span className="landing-320-568:block">
              <span className="max-[349px]:hidden landing-compact:hidden landing-phone-tall:hidden landing-320-568:hidden"> </span>
              management
            </span>
          </h2>
          <p className="max-w-2xl text-lg font-normal leading-relaxed text-slate-700 landing-4096-2304:max-w-[calc(42rem*1.3)] landing-5120-2880:max-w-[calc(42rem*1.3)] landing-4096-2304:text-[1.4625rem] landing-5120-2880:text-[1.4625rem] landing-7680-4320:max-w-[calc(42rem*2.5)] landing-7680-4320:text-[2.8125rem]">
            Less maintenance chaos. More control.
          </p>
        </div>
      </header>

      <div className="landing-how-it-works-stage mx-auto w-[80%] max-w-[80%] overflow-visible rounded-3xl border border-[#e5e7eb] px-5 py-6 sm:px-8 sm:py-8 landing-7680-4320:px-10 landing-7680-4320:py-12 lg:px-10 lg:py-10">
        <div
          className={`landing-how-it-works-panel flex w-full max-w-full flex-col items-center justify-center gap-8 overflow-hidden rounded-2xl bg-white p-5 shadow-[0_12px_40px_rgba(15,23,42,0.12)] sm:p-6 ${LANDING_640_480}:grid ${LANDING_640_480}:grid-cols-[2fr_3fr] ${LANDING_640_480}:items-center ${LANDING_640_480}:gap-3 landing-884:grid landing-884:grid-cols-[2fr_3fr] landing-884:items-center landing-884:gap-4 landing-720-576:!flex landing-720-576:!flex-col landing-720-576:!items-center landing-720-576:!gap-10 landing-720-1280:!grid landing-720-1280:!grid-cols-[2fr_3fr] landing-720-1280:!items-center landing-720-1280:!gap-2 landing-desktop:grid landing-desktop:grid-cols-[2fr_3fr] landing-desktop:items-center landing-desktop:gap-4 landing-1920-1080:!grid landing-1920-1200:!grid landing-3440-1440:grid landing-3440-1440:grid-cols-[2fr_3fr] landing-3440-1440:items-center landing-3440-1440:gap-4 landing-3840-2160:grid landing-3840-2160:grid-cols-[2fr_3fr] landing-3840-2160:items-center landing-3840-2160:gap-[100px] landing-4096-2304:grid landing-5120-2880:grid landing-4096-2304:grid-cols-[2fr_3fr] landing-5120-2880:grid-cols-[2fr_3fr] landing-4096-2304:items-center landing-5120-2880:items-center landing-4096-2304:gap-4 landing-5120-2880:gap-4 lg:grid lg:grid-cols-[2fr_3fr] lg:items-center lg:gap-8 lg:p-8`}
        >
          <nav
            className={`landing-how-it-works-feature-nav flex w-full min-w-0 max-w-full flex-col items-start justify-center self-center justify-self-start text-left gap-6 transition-[gap] duration-[var(--sa-duration)] ease-[var(--sa-ease)] motion-reduce:transition-none ${LANDING_640_480}:w-full ${LANDING_640_480}:max-w-none landing-884:w-full landing-884:max-w-none landing-720-576:!w-full landing-720-576:!max-w-none landing-720-1280:!w-full landing-720-1280:!max-w-none landing-desktop:min-w-0 landing-3440-1440:min-w-0 landing-3840-2160:min-w-0 landing-4096-2304:min-w-0 landing-5120-2880:min-w-0 landing-7680-4320:min-w-0 lg:w-full lg:max-w-none`}
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
    </div>
  )
}
