import { useState } from 'react'
import skyscraperIcon from '@/assets/landing/skyscraper.png'
import mechanicIcon from '@/assets/landing/mechanic.png'
import peopleIcon from '@/assets/landing/people.png'
import alignIcon from '@/assets/align.png'
import featuresDashboard from '@/assets/landing/features-dashboard.png'
import featuresProactiveCare from '@/assets/landing/features-proactive-care.png'
import featuresInstantAutomation from '@/assets/landing/features-instant-automation.png'
import featuresPropertyHub from '@/assets/landing/features-property-hub.png'

type FeatureId = 'property-hub' | 'proactive-care' | 'instant-automation' | 'smart-insights'

type FeatureItem = {
  id: FeatureId
  title: string
  description?: string
  icon: string
  iconWrap?: boolean
  inactiveTitleClass?: string
}

const FEATURES: FeatureItem[] = [
  {
    id: 'smart-insights',
    title: 'Smart Insights',
    description:
      "See spend, response times, and property health scores. Know what's working and what isn't.",
    icon: alignIcon,
  },
  {
    id: 'proactive-care',
    title: 'Proactive care',
    description:
      'Ulo schedules preventive checks before things break, keeping tenants happy and costs low.',
    icon: mechanicIcon,
    inactiveTitleClass: 'text-[#6a7282]',
  },
  {
    id: 'instant-automation',
    title: 'Instant Automation',
    description:
      'Maintenance requests auto routed to vetted vendors. From intake to completion in one tap.',
    icon: peopleIcon,
    iconWrap: true,
  },
  {
    id: 'property-hub',
    title: 'Property Hub',
    description:
      'All your properties in one place. Track units, tenants, and history without switching tools.',
    icon: skyscraperIcon,
  },
]

const FEATURE_PREVIEWS: Record<
  FeatureId,
  { src: string; alt: string; width: number; height: number }
> = {
  'property-hub': {
    src: featuresPropertyHub,
    alt: 'Property hub dashboard with portfolio overview, units, tenants, and maintenance history',
    width: 1013,
    height: 557,
  },
  'proactive-care': {
    src: featuresProactiveCare,
    alt: 'Proactive care dashboard with upcoming preventive checks, completion rate, and impact metrics',
    width: 845,
    height: 637,
  },
  'instant-automation': {
    src: featuresInstantAutomation,
    alt: 'Instant automation dashboard showing work order routing, vendor assignment, and completion flow',
    width: 914,
    height: 784,
  },
  'smart-insights': {
    src: featuresDashboard,
    alt: 'Smart insights dashboard with spend, response time, and property health scores',
    width: 689,
    height: 593,
  },
}

function FeatureIcon({ feature, dimmed }: { feature: FeatureItem; dimmed?: boolean }) {
  const iconClass = dimmed ? 'opacity-50 grayscale' : ''

  if (feature.iconWrap) {
    return (
      <div
        className={`flex size-[53px] shrink-0 items-center justify-center rounded-2xl bg-[rgba(15,22,35,0.1)] lg:size-11 ${iconClass}`}
      >
        <img src={feature.icon} alt="" className="size-[38px] object-contain lg:size-8" />
      </div>
    )
  }

  return (
    <img
      src={feature.icon}
      alt=""
      className={`size-[50px] shrink-0 object-contain lg:size-[42px] ${iconClass}`}
    />
  )
}

/** Features section interactive showcase (Figma 464:361). */
function FeaturePreviewPanel({ activeId }: { activeId: FeatureId }) {
  const preview = FEATURE_PREVIEWS[activeId]

  return (
    <div
      className="relative min-w-0 w-full overflow-hidden px-3 pb-5 pt-0 sm:px-[14px] sm:pb-5 sm:pt-0 lg:ml-auto lg:w-auto lg:flex-1"
      aria-live="polite"
    >
      <img
        key={activeId}
        src={preview.src}
        alt={preview.alt}
        className="h-auto w-[96%] max-w-full animate-[feature-preview-fade_0.35s_ease-out] lg:w-[80%]"
        width={preview.width}
        height={preview.height}
      />
    </div>
  )
}

export function FeaturesShowcase() {
  const [activeId, setActiveId] = useState<FeatureId>('smart-insights')

  return (
    <div className="mx-auto mt-10 flex w-full flex-col items-start gap-[29px] lg:mt-12 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
      <nav
        className="flex w-full shrink-0 flex-col gap-[38px] lg:w-auto lg:max-w-[463px] lg:gap-10"
        aria-label="Product features"
      >
        {FEATURES.map((feature) => {
          const isActive = feature.id === activeId

          return (
            <button
              key={feature.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveId(feature.id)}
              className={
                isActive
                  ? 'w-full rounded-2xl border border-[#e5e7eb] bg-white p-[34px] text-left shadow-[0_4px_8px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_6px_12px_rgba(0,0,0,0.06)] lg:w-auto lg:p-[29px] lg:shadow-none'
                  : 'flex w-full cursor-pointer items-center gap-5 rounded-2xl px-[34px] py-1 text-left opacity-50 transition-opacity hover:opacity-65 lg:w-auto lg:gap-4 lg:px-7'
              }
            >
              {isActive ? (
                <div className="flex gap-5 lg:gap-4">
                  <FeatureIcon feature={feature} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-[family-name:var(--font-landing-heading)] text-[19px] font-bold text-[#111827] lg:text-base">
                      {feature.title}
                    </h3>
                    {feature.description ? (
                      <p className="mt-2 text-[17px] leading-[1.625] text-[#6b7280] lg:text-sm">
                        {feature.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <FeatureIcon feature={feature} dimmed />
                  <h3
                    className={`font-[family-name:var(--font-landing-heading)] text-[19px] font-bold lg:text-base ${feature.inactiveTitleClass ?? 'text-[#858c99]'}`}
                  >
                    {feature.title}
                  </h3>
                </>
              )}
            </button>
          )
        })}
      </nav>

      <FeaturePreviewPanel activeId={activeId} />
    </div>
  )
}
