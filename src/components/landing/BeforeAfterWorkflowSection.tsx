import beforeWorkflow from '@/assets/landing/before-workflow.png'
import afterWorkflowDiagram from '@/assets/landing/after-workflow-diagram.png'

const WORKFLOW_CARD =
  'flex h-[320px] flex-col gap-8 rounded-3xl border border-[#e5e7eb] bg-white px-6 py-8 sm:px-10 lg:h-[340px] lg:flex-row lg:items-center lg:gap-16 lg:px-[38px] lg:py-10'

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
  imageClassName = 'w-[70%]',
}: {
  src: string
  alt: string
  width: number
  height: number
  imageClassName?: string
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <img
        src={src}
        alt={alt}
        className={`h-auto max-w-full ${imageClassName}`}
        width={width}
        height={height}
      />
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
          imageClassName="w-[91%]"
        />
      </div>

      <div className={WORKFLOW_CARD}>
        <WorkflowLabel title="After" subtitle="Smart. Streamlined. Solved." />
        <WorkflowDiagram
          src={afterWorkflowDiagram}
          alt="After Ulo: tenant texts Ulo, landlord and vendor coordinate once, tenant issue resolved"
          width={702}
          height={225}
        />
      </div>
    </div>
  )
}
