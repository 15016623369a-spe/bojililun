const paths = {
  brand: 'M3 18c3-6 8-8 14-8-3 5-6 7-11 7M7 12c2-5 6-7 13-8-2 4-5 6-9 7',
  plan: 'M8 5H5v16h14V5h-3M8 3h8v4H8zM8 12h8m-8 4h6',
  record: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6',
  review: 'M4 19h16M6 15v-4m6 4V5m6 10V8',
  queue: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  meal: 'M3 12h18a9 9 0 0 1-18 0Zm5 9h8M9 8c-2-2 2-2 0-5m5 5c-2-2 2-2 0-5',
  training: 'M6 8h3v8H6zM15 8h3v8h-3zM9 12h6M3 10v4m18-4v4',
  keyboard: 'M3 6h18v12H3zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  photo: 'M3 7h4l2-3h6l2 3h4v13H3zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  calendar: 'M4 6h16v14H4zM8 3v5m8-5v5M4 10h16m-9 4h2m-2 3h2',
  play: 'M9 5v14l11-7z',
  pause: 'M9 5H6v14h3zM18 5h-3v14h3z',
  check: 'm5 12 4 4L19 6',
} as const;

export default function JournalIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
