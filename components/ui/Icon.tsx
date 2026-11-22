/**
 * 统一的线性图标：24 网格、1.8 描边、圆头圆角。替代界面里的 ‹ › + → ✓ 等文字符号，
 * 让小标记和大号数字、苹方的笔画粗细对齐。
 */
const PATHS = {
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  'chevron-down': 'm6 9 6 6 6-6',
  'arrow-right': 'M4 12h15m-6-6 6 6-6 6',
  'arrow-up': 'M12 20V5m-6 6 6-6 6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  bookmark: 'M7 4h10v16l-5-4-5 4Z',
  rotate: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5',
  body: 'M12 7.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM7 10h10M12 10v5m0 0-3 6m3-6 3 6',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12v4l2.5 2.5M9.5 2.5h5',
  calendar: 'M4 6h16v14H4zM8 3v5m8-5v5M4 10h16',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0m-7 7v3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h10',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c1-4 4-6 7-6s6 2 7 6',
  chart: 'M4 20h16M7 16v-5m5 5V6m5 10V9',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm10-14 4 4',
  trash: 'M5 7h14M10 11v6m4-6v6M8 7l1-3h6l1 3m-9 0 1 13h8l1-13',
  book: 'M12 6a8 8 0 0 0-9-2v14a8 8 0 0 1 9 2 8 8 0 0 1 9-2V4a8 8 0 0 0-9 2Zm0 0v14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3h.01',
  dumbbell: 'M6.5 8v8M3.5 10v4M17.5 8v8M20.5 10v4M6.5 12h11',
  bowl: 'M3.5 12h17a8.5 8.5 0 0 1-17 0ZM8 21h8M9.5 8.5c-1.4-1.4 1.4-1.6 0-4m5 4c-1.4-1.4 1.4-1.6 0-4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  note: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  ban: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM6 6l12 12',
  search: 'M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5',
  export: 'M12 15V3.5m-4.5 4.5L12 3.5 16.5 8M5 12.5V20h14v-7.5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 4v11.5m-4.5-4.5 4.5 4.5 4.5-4.5M5 20h14',
} as const;

const FILLED = {
  spark: 'M12 2.5c.55 4.9 2.6 6.95 7.5 7.5-4.9.55-6.95 2.6-7.5 7.5-.55-4.9-2.6-6.95-7.5-7.5 4.9-.55 6.95-2.6 7.5-7.5Z',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M7 5h3.2v14H7zM13.8 5H17v14h-3.2z',
  stop: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  dot: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  'bookmark-fill': 'M6.2 3.2h11.6v17.6L12 16.3l-5.8 4.5Z',
} as const;

export type IconName = keyof typeof PATHS | keyof typeof FILLED;

export default function Icon({ name, size = 20, stroke = 1.8, className, label }: {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  label?: string;
}) {
  const filled = name in FILLED;
  const d = filled ? FILLED[name as keyof typeof FILLED] : PATHS[name as keyof typeof PATHS];
  return <svg className={className ? `icon ${className}` : 'icon'} width={size} height={size} viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={stroke}
    strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <path d={d} />
  </svg>;
}
