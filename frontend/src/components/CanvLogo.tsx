interface CanvLogoProps {
  className?: string;
  dotColor?: string;
}

export function CanvLogo({ className = 'w-6 h-6', dotColor = '#2F66E8' }: CanvLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 360 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="CanvHQ Logo"
    >
      <g
        stroke="#0F172A"
        strokeWidth="22"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="#F7F8FC"
      >
        <polygon points="181,24 320,102 181,180 42,102" />
        <polygon points="42,102 181,180 181,338 42,262" />
        <polygon points="181,180 320,102 320,262 181,338" />
      </g>
      <circle cx="261" cy="223" r="14" fill={dotColor} />
    </svg>
  );
}
