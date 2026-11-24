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

/** 实心话筒（照 SF Symbols 的 mic.fill）：实心胶囊 + 托架弧线 + 竖杆，用在录音按钮的珊瑚圆心上 */
export function MicFillIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect x="8.2" y="2" width="7.6" height="12.6" rx="3.8" fill="currentColor" />
      <path d="M5.2 11.2a6.8 6.8 0 0 0 13.6 0M12 18.1v3.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** 实心星芒（照 SF Symbols 的 sparkles）：一大两小三颗四角星，用在「我的教练」图标上 */
export function SparklesIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M10 4.2c.55 4.6 3.1 7.15 7.7 7.7-4.6.55-7.15 3.1-7.7 7.7-.55-4.6-3.1-7.15-7.7-7.7 4.6-.55 7.15-3.1 7.7-7.7Z" />
      <path d="M18.3 1.8c.24 2 1.34 3.1 3.34 3.34-2 .24-3.1 1.34-3.34 3.34-.24-2-1.34-3.1-3.34-3.34 2-.24 3.1-1.34 3.34-3.34Z" />
      <path d="M18.6 15.6c.2 1.6 1.08 2.48 2.68 2.68-1.6.2-2.48 1.08-2.68 2.68-.2-1.6-1.08-2.48-2.68-2.68 1.6-.2 2.48-1.08 2.68-2.68Z" />
    </svg>
  );
}

export function KeyboardIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M6.5 9.5h.01m3.66 0h.01m3.66 0h.01m3.66 0h.01M6.5 13h.01m3.66 0h.01m3.66 0h.01m3.66 0h.01M8.5 15.5h7" />
    </svg>
  );
}

export function CameraIcon({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M5 6.5h3l1.5-2h5l1.5 2h3a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 17V9A2.5 2.5 0 0 1 5 6.5Z" />
      <circle cx="12" cy="13" r="3.5" />
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
