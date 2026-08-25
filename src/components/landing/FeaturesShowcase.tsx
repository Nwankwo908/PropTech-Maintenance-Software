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
const AI_ORGANIZES_PREVIEW_WIDTH = 'w-full lg:mx-0 lg:w-[83.2%]'

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
    width: 1452,
    height: 1095,
    displayWidthClass: AI_ORGANIZES_PREVIEW_WIDTH,
    cropClass: 'w-full max-w-full lg:-mt-[30px] lg:-ml-[25%] lg:w-[125%] lg:max-w-none',
    offsetClass: 'lg:-mt-[40px]',
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
        className={`flex size-10 shrink-0 items-center justify-center rounded-2xl transition-[opacity,filter] duration-500 ease-in-out motion-reduce:transition-none lg:size-11 ${iconClass}`}
      >
        <img src={feature.icon} alt="" className="size-7 object-contain lg:size-8" />
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
      className={`sa-press relative z-0 flex cursor-pointer items-start gap-5 rounded-2xl px-[34px] py-1 text-left transition-[opacity] duration-500 ease-in-out motion-reduce:transition-none lg:gap-4 lg:pl-7 lg:pr-0 landing-4096-2304:py-[0.3rem] landing-5120-2880:py-[0.3rem] landing-compact:!px-0 landing-phone-tall:!px-0 ${LANDING_640_480}:!px-0 ${LANDING_640_480}:gap-2 landing-884:gap-3 landing-884:px-0 landing-884:pl-0 landing-720-1280:!px-0 landing-720-1280:gap-2 ${
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
                className={`pointer-events-none overflow-hidden transition-[max-height] duration-500 ease-in-out motion-reduce:transition-none lg:absolute lg:left-0 lg:right-0 lg:top-full landing-720-1280:relative landing-720-1280:left-auto landing-720-1280:right-auto landing-720-1280:top-auto ${
                  showDescription
                    ? 'max-h-40 landing-compact:!max-h-[22rem] landing-phone-tall:!max-h-[22rem] landing-720-1280:!max-h-[12rem] landing-4096-2304:!max-h-[12rem] landing-5120-2880:!max-h-[12rem] landing-7680-4320:!max-h-[25rem]'
                    : 'max-h-0'
                }`}
                aria-hidden={!showDescription}
              >
                <p
                  className={`pl-0 pt-1 font-normal text-[#6b7280] transition-transform duration-500 ease-out motion-reduce:transition-none ${descriptionSizeClass} landing-720-1280:break-words landing-720-1280:text-[12px] landing-720-1280:leading-snug ${
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
    <div
      className={`landing-1440-900-feature-preview landing-1680-1050-feature-preview landing-1728-1117-feature-preview landing-1920-1080-feature-preview relative flex min-w-0 w-full shrink-0 items-center justify-start overflow-hidden max-[410px]:w-[calc(100vw-3rem)] max-[410px]:max-w-none landing-compact:w-[calc(100vw-3rem)] landing-compact:max-w-none landing-phone-tall:w-[calc(100vw-3rem)] landing-phone-tall:max-w-none landing-tablet-portrait:overflow-visible landing-768-360-preview:w-auto landing-768-360-preview:h-[21.12rem] landing-768-360-preview:max-w-none landing-768-360-preview:flex-none landing-991-568-preview:w-auto landing-991-568-preview:h-[21.12rem] landing-991-568-preview:max-w-none landing-991-568-preview:flex-none landing-768-1024:w-auto landing-768-1024:h-[21.12rem] landing-768-1024:max-w-none landing-768-1024:flex-none landing-768-1366:w-auto landing-768-1366:h-[21.12rem] landing-768-1366:max-w-none landing-768-1366:flex-none landing-800-1280:w-auto landing-800-1280:h-[21.12rem] landing-800-1280:max-w-none landing-800-1280:flex-none landing-820-1180:!min-w-0 landing-820-1180:!w-auto landing-820-1180:!max-w-[26.88rem] landing-820-1180:!flex-none landing-820-1180:!h-auto landing-820-1180:!overflow-visible landing-834-1194:!min-w-0 landing-834-1194:!w-auto landing-834-1194:!max-w-[26.88rem] landing-834-1194:!flex-none landing-834-1194:!h-auto landing-834-1194:!overflow-visible landing-720-1280:!min-w-0 landing-720-1280:!w-auto landing-720-1280:!max-w-[min(26.88rem,calc(100%-11rem))] landing-720-1280:!flex-1 landing-720-1280:!h-auto landing-720-1280:!overflow-visible landing-884-1104:w-auto landing-884-1104:h-[21.12rem] landing-884-1104:max-w-none landing-884-1104:flex-none landing-912-1368:w-auto landing-912-1368:h-[21.12rem] landing-912-1368:max-w-none landing-912-1368:flex-none landing-991-1280:w-auto landing-991-1280:h-[21.12rem] landing-991-1280:max-w-none landing-991-1280:flex-none landing-1024-1440-preview:!h-[21.12rem] landing-1024-1440-preview:!w-[26.88rem] landing-1024-1440-preview:!max-w-[26.88rem] landing-1024-1440-preview:!flex-none landing-1024-1366:!h-[21.12rem] landing-1024-1366:!w-[26.88rem] landing-1024-1366:!max-w-[26.88rem] landing-1024-1366:!flex-none landing-1024-600:!min-w-0 landing-1024-600:!w-auto landing-1024-600:!max-w-[26.88rem] landing-1280-800:!max-w-[33.6rem] landing-1512-982:!max-w-[33.6rem] landing-1728-1117:!w-[40.32rem] landing-1728-1117:!max-w-[40.32rem] landing-1366-768:!max-w-[33.6rem] landing-1440-900:!w-[47.04rem] landing-1440-900:!max-w-[47.04rem] landing-1680-1050:!w-[47.04rem] landing-1680-1050:!max-w-[47.04rem] landing-1024-600:!flex-none landing-1024-600:!h-auto landing-1024-600:!overflow-visible ${LANDING_640_480}:min-w-0 ${LANDING_640_480}:w-auto ${LANDING_640_480}:max-w-none ${LANDING_640_480}:flex-1 landing-884:min-w-0 landing-884:w-auto landing-884:flex-none landing-1024-1440:overflow-visible landing-2560-1440:overflow-visible landing-desktop:w-auto landing-desktop:flex-none landing-desktop:overflow-visible landing-desktop:!h-[72rem] landing-desktop:!w-[96rem] landing-desktop:!max-w-[96rem] landing-1920-1080:!h-[57.6rem] landing-1920-1080:!w-[76.8rem] landing-1920-1080:!max-w-[76.8rem] landing-1920-1080:!min-w-[76.8rem] landing-3440-1440:w-auto landing-3440-1440:flex-none landing-3440-1440:overflow-visible landing-3840-2160:w-auto landing-3840-2160:flex-none landing-3840-2160:overflow-visible landing-4096-2304:w-auto landing-5120-2880:w-auto landing-4096-2304:flex-none landing-5120-2880:flex-none landing-4096-2304:overflow-visible landing-5120-2880:overflow-visible landing-5120-2880:w-auto landing-5120-2880:flex-none landing-5120-2880:overflow-visible landing-7680-4320:w-auto landing-7680-4320:flex-none landing-7680-4320:overflow-visible landing-7680-4320:!h-[180rem] landing-7680-4320:!w-[240rem] landing-7680-4320:!max-w-[240rem] landing-7680-4320:!min-w-[240rem] lg:h-[72rem] lg:w-[96rem] lg:flex-none`}
      aria-live="polite"
    >
      <div className="landing-768-360-preview-frame landing-991-568-preview-frame landing-768-1024-preview-frame landing-768-1366-preview-frame landing-800-1280-preview-frame landing-820-1180-preview-frame landing-834-1194-preview-frame landing-720-1280-preview-frame landing-884-1104-preview-frame landing-912-1368-preview-frame landing-991-1280-preview-frame landing-1024-1366-preview-frame landing-1024-600-preview-frame landing-1024-1440-preview-frame landing-desktop-preview-frame landing-3440-1440-preview-frame landing-3840-2160-preview-frame landing-5120-2880-preview-frame landing-7680-4320-preview-frame relative h-full w-full overflow-hidden max-[410px]:overflow-visible landing-compact:overflow-visible landing-phone-tall:overflow-visible landing-tablet-portrait:overflow-visible landing-720-1280:!h-auto landing-720-1280:!overflow-visible landing-820-1180:!h-auto landing-820-1180:!overflow-visible landing-834-1194:!h-auto landing-834-1194:!overflow-visible landing-1024-600:!h-auto landing-1024-600:!overflow-visible">
        <div
          className={`absolute inset-0 flex items-center justify-start max-[410px]:relative max-[410px]:inset-auto landing-compact:relative landing-compact:inset-auto landing-phone-tall:relative landing-phone-tall:inset-auto landing-tablet-portrait:relative landing-tablet-portrait:inset-auto landing-720-1280:!relative landing-720-1280:!inset-auto landing-720-1280:!w-full landing-720-1280:!max-w-full landing-720-1280:!translate-x-0 landing-720-1280:!translate-y-0 landing-720-1280:!mt-0 landing-720-1280:!ml-0 landing-820-1180:!relative landing-820-1180:!inset-auto landing-820-1180:!w-full landing-820-1180:!max-w-full landing-820-1180:!translate-x-0 landing-820-1180:!translate-y-0 landing-820-1180:!mt-0 landing-820-1180:!ml-0 landing-834-1194:!relative landing-834-1194:!inset-auto landing-834-1194:!w-full landing-834-1194:!max-w-full landing-834-1194:!translate-x-0 landing-834-1194:!translate-y-0 landing-834-1194:!mt-0 landing-834-1194:!ml-0 landing-1024-1440-preview:!relative landing-1024-1440-preview:!inset-auto landing-1024-1440-preview:!w-full landing-1024-1440-preview:!max-w-full landing-1024-1440-preview:!translate-x-0 landing-1024-1440-preview:!mt-0 landing-1024-1440-preview:!ml-0 landing-1024-600:!relative landing-1024-600:!inset-auto landing-1024-600:!w-full landing-1024-600:!max-w-full landing-1024-600:!translate-x-0 landing-1024-600:!translate-y-0 landing-1024-600:!mt-0 landing-1024-600:!ml-0 landing-1024-1366:!relative landing-1024-1366:!inset-auto landing-1024-1366:!w-full landing-1024-1366:!max-w-full landing-1024-1366:!translate-x-0 landing-1024-1366:!mt-0 landing-1024-1366:!ml-0 ${widthClass} ${preview.offsetClass ?? ''}`}
        >
          <img
            key={activeId}
            src={preview.src}
            alt={preview.alt}
            className={`landing-768-360-preview-img landing-991-568-preview-img landing-768-1024-preview-img landing-768-1366-preview-img landing-800-1280-preview-img landing-820-1180-preview-img landing-834-1194-preview-img landing-720-1280-preview-img landing-884-1104-preview-img landing-912-1368-preview-img landing-991-1280-preview-img landing-1024-1366-preview-img landing-1024-600-preview-img landing-1024-1440-preview-img landing-desktop-preview-img landing-3440-1440-preview-img landing-3840-2160-preview-img landing-5120-2880-preview-img landing-7680-4320-preview-img block h-auto max-h-full w-full max-w-full animate-[feature-preview-fade_0.6s_ease-in-out] object-contain object-left saturate-[90%] contrast-[90%] max-[410px]:!w-full max-[410px]:!min-w-full max-[410px]:!max-w-none landing-compact:!w-full landing-compact:!min-w-full landing-compact:!max-w-none landing-phone-tall:!w-full landing-phone-tall:!min-w-full landing-phone-tall:!max-w-none landing-tablet-portrait:!w-full landing-tablet-portrait:!min-w-full landing-tablet-portrait:!max-w-none landing-720-1280:!mt-0 landing-720-1280:!ml-0 landing-720-1280:!w-full landing-720-1280:!max-w-full landing-820-1180:!mt-0 landing-820-1180:!ml-0 landing-820-1180:!w-full landing-820-1180:!max-w-full landing-834-1194:!mt-0 landing-834-1194:!ml-0 landing-834-1194:!w-full landing-834-1194:!max-w-full landing-1024-1366:!mt-0 landing-1024-1366:!ml-0 landing-1024-1366:!w-full landing-1024-1366:!max-w-full landing-1024-600:!mt-0 landing-1024-600:!ml-0 landing-1024-600:!w-full landing-1024-600:!max-w-full landing-1024-1440-preview:!mt-0 landing-1024-1440-preview:!ml-0 landing-1024-1440-preview:!w-full landing-1024-1440-preview:!max-w-full ${LANDING_640_480}:max-h-[min(220px,42dvh)] ${cropClass}`}
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
    <div className="mx-auto mb-4 w-full overflow-visible pb-8 lg:mb-6 lg:pb-10">
      <header className="mb-5 lg:mb-6 landing-1280-800:!mb-10 landing-1512-982:!mb-10 landing-1728-1117:!mb-10 landing-3840-2160:!mb-10">
        <h2 className="sa-pill inline-flex items-center gap-2 rounded-full bg-transparent px-4 py-2 font-mono text-xs font-normal uppercase tracking-wide text-slate-900 landing-4096-2304:text-[0.975rem] landing-5120-2880:text-[0.975rem] landing-4096-2304:gap-[0.65rem] landing-5120-2880:gap-[0.65rem] landing-4096-2304:px-5 landing-5120-2880:px-5 landing-4096-2304:py-2.5 landing-5120-2880:py-2.5 landing-7680-4320:text-[1.875rem] landing-7680-4320:gap-5 landing-7680-4320:px-10 landing-7680-4320:py-5">
          <IconRoadmap className="size-4 shrink-0 text-[#81228A] landing-4096-2304:size-[1.3rem] landing-5120-2880:size-[1.3rem] landing-7680-4320:size-10" />
          How It Works
        </h2>
        <div className="mt-4 flex flex-col items-start gap-4 landing-4096-2304:mt-[1.3rem] landing-5120-2880:mt-[1.3rem] landing-4096-2304:gap-5 landing-5120-2880:gap-5 landing-7680-4320:mt-10 landing-7680-4320:gap-10">
          <h3 className="font-[family-name:var(--font-landing-heading)] text-[48px] font-medium leading-[1.1] tracking-[-0.02em] text-slate-900 max-[349px]:flex max-[349px]:flex-col max-[349px]:text-[1.75rem] landing-compact:flex landing-compact:flex-col landing-compact:text-[1.75rem] landing-phone-tall:flex landing-phone-tall:flex-col landing-phone-tall:text-[1.75rem] landing-320-568:!flex landing-320-568:!flex-col landing-320-568:w-full landing-320-568:text-[1.75rem] landing-4096-2304:text-[62.4px] landing-5120-2880:text-[62.4px] landing-7680-4320:text-[120px]">
            <span className="landing-320-568:block">SMS-first maintenance</span>
            <span className="landing-320-568:block">
              <span className="max-[349px]:hidden landing-compact:hidden landing-phone-tall:hidden landing-320-568:hidden"> </span>
              management
            </span>
          </h3>
          <p className="max-w-2xl text-lg font-normal leading-relaxed text-slate-700 landing-4096-2304:max-w-[calc(42rem*1.3)] landing-5120-2880:max-w-[calc(42rem*1.3)] landing-4096-2304:text-[1.4625rem] landing-5120-2880:text-[1.4625rem] landing-7680-4320:max-w-[calc(42rem*2.5)] landing-7680-4320:text-[2.8125rem]">
            Less maintenance chaos. More control.
          </p>
        </div>
      </header>

      <div className={`flex w-full flex-col items-start gap-8 overflow-visible max-[410px]:items-stretch max-[410px]:gap-10 landing-compact:items-stretch landing-compact:gap-10 landing-phone-tall:items-stretch landing-phone-tall:gap-10 ${LANDING_640_480}:flex-row ${LANDING_640_480}:items-center ${LANDING_640_480}:gap-3 landing-884:flex-row landing-884:items-center landing-884:gap-4 landing-720-576:!flex-col landing-720-576:!items-stretch landing-720-576:!gap-10 landing-720-1280:!w-full landing-720-1280:!max-w-full landing-720-1280:!flex-row landing-720-1280:!items-start landing-720-1280:!gap-2 landing-720-1280:!overflow-x-hidden landing-720-1280:!overflow-y-visible landing-desktop:justify-center landing-1920-1080:!justify-start landing-1920-1200:!justify-start landing-3440-1440:justify-center landing-3840-2160:justify-center landing-4096-2304:justify-center landing-5120-2880:justify-center lg:flex-row lg:items-center lg:gap-4`}>
        <div className="contents landing-desktop:flex landing-desktop:!w-auto landing-desktop:flex-row landing-desktop:items-center landing-desktop:gap-4 landing-3440-1440:flex landing-3440-1440:!w-auto landing-3440-1440:flex-row landing-3440-1440:items-center landing-3440-1440:gap-4 landing-3840-2160:flex landing-3840-2160:!w-auto landing-3840-2160:flex-row landing-3840-2160:items-center landing-3840-2160:gap-[100px] landing-4096-2304:flex landing-5120-2880:flex landing-4096-2304:!w-auto landing-5120-2880:!w-auto landing-4096-2304:flex-row landing-5120-2880:flex-row landing-4096-2304:items-center landing-5120-2880:items-center landing-4096-2304:gap-4 landing-5120-2880:gap-4">
          <nav
            className={`flex w-full shrink-0 flex-col gap-[61px] transition-[gap] duration-500 ease-in-out motion-reduce:transition-none ${LANDING_640_480}:w-auto ${LANDING_640_480}:max-w-[13rem] ${LANDING_640_480}:gap-4 landing-884:w-auto landing-884:max-w-[min(100%,22rem)] landing-884:gap-10 landing-720-576:!w-full landing-720-576:!max-w-none landing-720-576:!gap-[61px] landing-720-1280:!w-[10.5rem] landing-720-1280:!max-w-[10.5rem] landing-720-1280:!shrink-0 landing-720-1280:!gap-6 landing-1024-1440:max-w-[calc(463px*0.8)] landing-1440-900:!max-w-[calc(463px*1.4)] landing-1680-1050:!max-w-[calc(463px*1.4)] landing-desktop:shrink-0 landing-3440-1440:shrink-0 landing-3840-2160:shrink-0 landing-4096-2304:shrink-0 landing-5120-2880:shrink-0 landing-4096-2304:!gap-[4.8rem] landing-5120-2880:!gap-[4.8rem] landing-5120-2880:shrink-0 landing-7680-4320:shrink-0 landing-7680-4320:!max-w-[calc(463px*2.5)] landing-7680-4320:!gap-[9.53125rem] lg:w-auto lg:max-w-[463px] lg:gap-16`}
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
