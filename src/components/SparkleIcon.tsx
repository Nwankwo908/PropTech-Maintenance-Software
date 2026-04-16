/** Small sparkle used for AI / issue-insights affordances. */
export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M10 2.5L11.18 6.82L15.5 8L11.18 9.18L10 13.5L8.82 9.18L4.5 8L8.82 6.82L10 2.5Z"
        fill="currentColor"
      />
      <path
        d="M16.25 12.5L16.84 14.34L18.68 14.93L16.84 15.52L16.25 17.36L15.66 15.52L13.82 14.93L15.66 14.34L16.25 12.5Z"
        fill="currentColor"
      />
    </svg>
  )
}
