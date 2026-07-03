import beforeWorkflow from '@/assets/landing/before-workflow.png'
import afterWorkflowDiagram from '@/assets/landing/after-workflow-diagram.png'

const WORKFLOW_CARD =
  'flex min-h-[192px] flex-col gap-8 overflow-x-clip rounded-3xl border border-[#e5e7eb] bg-white px-6 py-5 sm:px-10 lg:flex-row lg:items-center lg:gap-12 lg:overflow-visible lg:px-[38px] lg:py-8'

function WorkflowLabel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="w-full max-w-[280px] shrink-0 lg:max-w-[320px]">
      <h3 className="font-[family-name:var(--font-landing-heading)] text-[60px] font-medium leading-[1.1] tracking-[-0.02em] text-[#18181b]">
        {title}
      </h3>
      <p className="mt-2 text-lg font-normal leading-relaxed text-[#71717a]">{subtitle}</p>
    </div>
  )
}

function WorkflowDiagram({
  src,
  alt,
  width,
  height,
  mobileWidthClass,
  lgWidthClass,
  imgClassName = '',
  knockOutWhite = false,
  knockoutBackdropClassName = '',
  knockoutBackdropStyle,
}: {
  src: string
  alt: string
  width: number
  height: number
  mobileWidthClass: string
  lgWidthClass: string
  imgClassName?: string
  knockOutWhite?: boolean
  knockoutBackdropClassName?: string
  knockoutBackdropStyle?: React.CSSProperties
}) {
  const image = (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      draggable={false}
      className={[
        'block h-auto shrink-0',
        mobileWidthClass,
        lgWidthClass,
        knockOutWhite ? 'relative mix-blend-multiply' : '',
        imgClassName,
      ]
        .filter(Boolean)
        .join(' ')}
      style={knockOutWhite ? { mixBlendMode: 'multiply' } : undefined}
    />
  )

  return (
    <div className="relative min-w-0 flex-1 overflow-x-hidden lg:overflow-visible">
      <div
        className="overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible"
        aria-label={`${alt}. Swipe horizontally to view the full diagram.`}
        tabIndex={0}
      >
        {knockOutWhite ? (
          <div className="relative inline-block shrink-0">
            <div
              aria-hidden
              className={['pointer-events-none absolute inset-0', knockoutBackdropClassName]
                .filter(Boolean)
                .join(' ')}
              style={knockoutBackdropStyle}
            />
            {image}
          </div>
        ) : (
          image
        )}
      </div>
    </div>
  )
}

/** Before / after maintenance workflow comparison (Figma 481:2814). */
export function BeforeAfterWorkflowSection() {
  return (
    <div className="flex flex-col gap-4">
      <div
        className={`${WORKFLOW_CARD.replace('bg-white', 'bg-[#E6F4E9]')} isolation-isolate [@media(min-width:2560px)_and_(min-height:1300px)_and_(max-height:1600px)]:min-h-[330px] [@media(min-width:2560px)_and_(min-height:1300px)_and_(max-height:1600px)]:lg:gap-[4.5rem] [@media(min-width:2560px)_and_(min-height:1300px)_and_(max-height:1600px)]:lg:py-12`}
      >
        <WorkflowLabel title="Before" subtitle="Messy. Slow. Frustration" />
        <WorkflowDiagram
          src={beforeWorkflow}
          alt="Before Ulo: tenant, landlord, and vendor stuck in repeated back-and-forth coordination"
          width={1043}
          height={212}
          mobileWidthClass="max-lg:w-[949px] max-lg:max-w-none"
          lgWidthClass="w-full max-w-full lg:max-w-[949px]"
          knockOutWhite
          knockoutBackdropClassName="bg-[#E6F4E9]"
          imgClassName="[@media(min-width:2560px)_and_(min-height:1300px)_and_(max-height:1600px)]:lg:!w-[1424px] [@media(min-width:2560px)_and_(min-height:1300px)_and_(max-height:1600px)]:lg:!max-w-[1424px] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:lg:!w-[1329px] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:lg:!max-w-[1329px]"
        />
      </div>

      <div
        className={`${WORKFLOW_CARD.replace(' bg-white', '')} isolation-isolate`}
        style={{ backgroundImage: 'linear-gradient(45deg, #E6E9F2 0%, #D2F4FF 100%)' }}
      >
        <WorkflowLabel title="After" subtitle="Smart. Streamlined. Solved." />
        <WorkflowDiagram
          src={afterWorkflowDiagram}
          alt="After Ulo: tenant texts Ulo, landlord and vendor coordinate once, tenant issue resolved"
          width={702}
          height={225}
          mobileWidthClass="max-lg:w-[491px] max-lg:max-w-none"
          lgWidthClass="lg:w-full"
          knockOutWhite
          knockoutBackdropStyle={{
            backgroundImage: 'linear-gradient(45deg, #E6E9F2 0%, #D2F4FF 100%)',
          }}
          imgClassName="[@media(min-width:300px)_and_(max-width:349px)_and_(min-height:1400px)_and_(max-height:1500px)]:!w-[638px] [@media(min-width:300px)_and_(max-width:349px)_and_(min-height:1400px)_and_(max-height:1500px)]:max-w-none [@media(min-width:350px)_and_(max-width:399px)_and_(min-height:1400px)_and_(max-height:1500px)]:!w-[638px] [@media(min-width:350px)_and_(max-width:399px)_and_(min-height:1400px)_and_(max-height:1500px)]:max-w-none [@media(min-width:400px)_and_(max-width:450px)_and_(min-height:1400px)_and_(max-height:1500px)]:!w-[614px] [@media(min-width:400px)_and_(max-width:450px)_and_(min-height:1400px)_and_(max-height:1500px)]:max-w-none [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:1400px)_and_(max-height:1500px)]:!w-[638px] [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:1400px)_and_(max-height:1500px)]:max-w-none [@media(min-width:300px)_and_(max-width:349px)_and_(min-height:850px)_and_(max-height:920px)]:!w-[638px] [@media(min-width:300px)_and_(max-width:349px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-none [@media(min-width:350px)_and_(max-width:399px)_and_(min-height:850px)_and_(max-height:920px)]:!w-[638px] [@media(min-width:350px)_and_(max-width:399px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-none [@media(min-width:400px)_and_(max-width:500px)_and_(min-height:850px)_and_(max-height:920px)]:!w-[687px] [@media(min-width:400px)_and_(max-width:500px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-none [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:850px)_and_(max-height:920px)]:!w-[687px] [@media(min-width:768px)_and_(max-width:850px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-none [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:!w-[913px] [@media(min-width:1024px)_and_(max-width:1100px)_and_(min-height:850px)_and_(max-height:920px)]:max-w-none"
        />
      </div>
    </div>
  )
}
