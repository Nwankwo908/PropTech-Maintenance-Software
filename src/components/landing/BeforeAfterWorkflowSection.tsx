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
  widthPercent,
  lgWidthClass,
}: {
  src: string
  alt: string
  width: number
  height: number
  widthPercent: number
  lgWidthClass: string
}) {
  const diagramWidthPx = Math.round(width * (widthPercent / 100))

  return (
    <div className="relative flex min-w-0 flex-1 overflow-x-hidden overflow-y-visible lg:overflow-visible">
      <div
        className="flex w-full items-center overflow-x-auto overflow-y-visible overscroll-x-contain touch-pan-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible"
        aria-label={`${alt}. Swipe horizontally to view the full diagram.`}
        tabIndex={0}
      >
        <div className="flex min-w-max items-center justify-start py-1 lg:min-w-0 lg:w-full lg:justify-start lg:py-0">
          <img
            src={src}
            alt={alt}
            width={width}
            height={height}
            draggable={false}
            style={{ width: diagramWidthPx }}
            className={`block h-auto max-w-none shrink-0 ${lgWidthClass} lg:max-w-full lg:object-left`}
          />
        </div>
      </div>
    </div>
  )
}

/** Before / after maintenance workflow comparison (Figma 481:2814). */
export function BeforeAfterWorkflowSection() {
  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <div className={WORKFLOW_CARD}>
        <WorkflowLabel title="Before" subtitle="Messy. Slow. Frustration" />
        <WorkflowDiagram
          src={beforeWorkflow}
          alt="Before Ulo: tenant, landlord, and vendor stuck in repeated back-and-forth coordination"
          width={1043}
          height={212}
          widthPercent={91}
          lgWidthClass="lg:!w-[949px]"
        />
      </div>

      <div className={WORKFLOW_CARD}>
        <WorkflowLabel title="After" subtitle="Smart. Streamlined. Solved." />
        <WorkflowDiagram
          src={afterWorkflowDiagram}
          alt="After Ulo: tenant texts Ulo, landlord and vendor coordinate once, tenant issue resolved"
          width={702}
          height={225}
          widthPercent={70}
          lgWidthClass="lg:!w-full"
        />
      </div>
    </div>
  )
}
