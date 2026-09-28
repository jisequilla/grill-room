interface GrateMarkProps {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

export function GrateMark({
  className,
  "aria-hidden": ariaHidden,
}: GrateMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      className={className}
      aria-hidden={ariaHidden}
      data-testid="grate-mark"
    >
      <rect
        x="1"
        y="1"
        width="18"
        height="18"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect x="1" y="5.5" width="18" height="2" fill="hsl(var(--primary))" />
      <rect x="1" y="9" width="18" height="2" fill="currentColor" />
      <rect x="1" y="12.5" width="18" height="2" fill="currentColor" />
    </svg>
  );
}
