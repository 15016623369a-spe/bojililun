/** 复刻稿用的细线图标（1.6px 描边），全部继承 currentColor */

type P = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function LeafIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M20 4c0 7.5-4.5 12-11 12H5c0-6.5 4.5-11 11-11 1.6 0 3 .3 4 1Z" fill="currentColor" stroke="none" />
      <path d="M5 21c1.2-4.6 4-8.2 8.5-10.5" stroke="#fbf6f3" strokeWidth="1.5" />
    </svg>
  );
}

export function MealIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M3.4 11.4h17.2a8.6 8.6 0 0 1-8.6 8.6 8.6 8.6 0 0 1-8.6-8.6Z" />
      <path d="M14.6 8.2 19 3.6M11.9 8.6l4.4-4.6" />
    </svg>
  );
}

export function DumbbellIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden strokeWidth={1.8}>
      <path d="M6.8 8.6v6.8M4 10.3v3.4M17.2 8.6v6.8M20 10.3v3.4M6.8 12h10.4" />
    </svg>
  );
}

export function MicIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden strokeWidth={1.7}>
      <rect x="9" y="2.6" width="6" height="11" rx="3" />
      <path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0M12 18v3.2" />
    </svg>
  );
}

export function CheckIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function PencilIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M4.2 19.8l.8-3.3a2 2 0 0 1 .5-.9L15.3 5.8a2 2 0 0 1 2.8 0l.1.1a2 2 0 0 1 0 2.8L8.4 18.5a2 2 0 0 1-.9.5l-3.3.8Z" />
      <path d="M14.2 6.9 17.1 9.8" />
    </svg>
  );
}

export function BarsIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M5 20v-6M12 20V5M19 20v-9" />
    </svg>
  );
}

export function BodyIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden strokeWidth={1.5}>
      <circle cx="12" cy="4.6" r="2.1" />
      <path d="M12 6.9v6.4M12 8.4 8.2 11M12 8.4 15.8 11M9.4 21l2.6-4 2.6 4M12 13.3l-2 3.9M12 13.3l2 3.9" />
    </svg>
  );
}

export function ArrowIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
