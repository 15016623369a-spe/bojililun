'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './ui/Icon';

const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;
const daysBefore = (date: string, n: number) => new Date(Date.parse(date) - n * 86400000).toISOString().slice(0, 10);
const haptic = (ms = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/**
 * 回顾页右上角的导出：圆钮打开毛玻璃抽屉，选范围后复制或下载。
 * 接口沿用手账的 /api/ledger（format=md / json，带 download 时下载）。
 */
export default function ReviewExport({ today, start: periodStart }: { today: string; start: string }) {
  const presets = [
    { key: 'period', label: '当前区间', start: periodStart },
    { key: '7', label: '最近 7 天', start: daysBefore(today, 6) },
    { key: '30', label: '最近 30 天', start: daysBefore(today, 29) },
  ];
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState('period');
  const [start, setStart] = useState(periodStart);
  const [end, setEnd] = useState(today);
  const [message, setMessage] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const valid = Boolean(start && end && end >= start);
  const url = '/api/ledger?' + new URLSearchParams({ start, end });
  const days = valid ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 : 0;

  async function copy() {
    haptic(8);
    try {
      const response = await fetch(url + '&format=md');
      if (!response.ok) throw Error();
      await navigator.clipboard.writeText(await response.text());
      setMessage('已复制到剪贴板');
    } catch {
      setMessage('复制失败，可以改为下载文件');
    }
  }

  const sheet = open && <div className="export-mask" onClick={() => setOpen(false)}>
    <section className="export-sheet" role="dialog" aria-modal="true" aria-label="导出手账" onClick={(e) => e.stopPropagation()}>
      <span className="export-grab" aria-hidden="true" />
      <header className="export-head">
        <h2>导出手账</h2>
        <button type="button" className="export-close" onClick={() => setOpen(false)} aria-label="关闭"><Icon name="close" size={18} /></button>
      </header>
      <div className="export-range">
        <b className="big-num">{valid ? short(start) : '--.--'}</b>
        <i aria-hidden="true">{Array.from({ length: 9 }, (_, n) => <span key={n} />)}</i>
        <b className="big-num">{valid ? short(end) : '--.--'}</b>
        <small>{valid ? `${days} 天` : '日期不对'}</small>
      </div>
      <div className="vseg export-presets" role="radiogroup" aria-label="导出范围">
        {presets.map((p) => <button key={p.key} type="button" role="radio" aria-checked={preset === p.key}
          className={preset === p.key ? 'on' : undefined}
          onClick={() => { haptic(); setPreset(p.key); setStart(p.start); setEnd(today); setMessage(''); }}>{p.label}</button>)}
      </div>
      <div className="export-dates">
        <label>从<input type="date" value={start} max={end} onChange={(e) => { setPreset(''); setStart(e.target.value); }} /></label>
        <label>至<input type="date" value={end} min={start} max={today} onChange={(e) => { setPreset(''); setEnd(e.target.value); }} /></label>
      </div>
      <div className="export-actions">
        <button type="button" className="export-primary" disabled={!valid} onClick={copy}><Icon name="copy" size={18} />复制为 Markdown</button>
        <a className="export-secondary" aria-disabled={!valid} href={valid ? url + '&download&format=md' : undefined} download><Icon name="download" size={18} />Markdown</a>
        <a className="export-secondary" aria-disabled={!valid} href={valid ? url + '&download&format=json' : undefined} download><Icon name="download" size={18} />JSON</a>
      </div>
      <p className="export-status" role="status">{message || '训练、饮食和体重会按天整理，可以直接贴给教练或 AI。'}</p>
    </section>
  </div>;

  return <>
    <button type="button" className="head-icon" aria-label="导出手账" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { haptic(); setMessage(''); setOpen(true); }}>
      <Icon name="export" size={18} />
    </button>
    {mounted && sheet ? createPortal(sheet, document.body) : null}
  </>;
}
