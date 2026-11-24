'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { GLASS_COOKIE } from '@/lib/backdrop-preference';

const haptic = (ms = 6) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/** 相册里的图先在本机缩到长边 1600、转 JPEG，再上传，背景图一般只有两三百 KB */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(src);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('这张图打不开，换一张试试')); };
    img.src = src;
  });
}

/**
 * 「我的」里的背景设置：换一张自己的图铺在回顾和记录页后面，内容浮在毛玻璃上。
 * 回顾页的透明度可调（存 cookie fc-glass），记录页固定用和抽屉一样的玻璃。
 */
export default function BackdropSettings({ initialUrl, initialGlass }: { initialUrl: string | null; initialGlass: number }) {
  const [url, setUrl] = useState(initialUrl);
  const [glass, setGlass] = useState(initialGlass);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const image = await shrink(file);
      const res = await fetch('/api/backdrop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '上传没成功，再试一次');
      haptic(10);
      setUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传没成功，再试一次');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    const res = await fetch('/api/backdrop', { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) { setError('没能移除，再试一次'); return; }
    haptic(8);
    setUrl(null);
  }

  function slide(value: number) {
    setGlass(value);
    document.cookie = `${GLASS_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
  }

  return <section className="backdrop-set" aria-label="回顾与记录的背景">
    <div className="theme-switch-head">
      <span>回顾与记录的背景</span>
      <small>换一张自己的图片，回顾和记录页的内容会浮在毛玻璃上</small>
    </div>
    <div className="backdrop-set-row">
      <div className="backdrop-preview" data-empty={url ? undefined : ''} aria-hidden="true"
        style={{ '--glass': glass / 100, ...(url ? { backgroundImage: `url("${url}")` } : {}) } as CSSProperties}>
        <i className="veil" />
        <span className="bp-tile review"><b>回顾</b><small>{glass}%</small></span>
        <span className="bp-tile record"><b>记录</b><small>固定</small></span>
      </div>
      <div className="backdrop-actions">
        <button type="button" className="backdrop-btn primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? '正在处理…' : url ? '更换背景' : '选择背景图片'}</button>
        {url && <button type="button" className="backdrop-btn" disabled={busy} onClick={remove}>恢复默认背景</button>}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
        {error ? <p className="backdrop-error" role="alert">{error}</p> : <p className="backdrop-note">竖图效果最好。</p>}
      </div>
    </div>
    <label className="backdrop-slider" data-disabled={url ? undefined : ''}>
      <span className="backdrop-slider-head"><span>回顾页透明度</span><b>{glass}%</b></span>
      <input type="range" min={0} max={100} step={5} value={glass} disabled={!url} onChange={(e) => slide(Number(e.target.value))}
        style={{ '--p': `${glass}%` } as CSSProperties} aria-valuetext={`${glass}%`} />
      <span className="backdrop-slider-ends"><small>更实</small><small>{url ? '更透' : '设置背景后可调'}</small></span>
    </label>
  </section>;
}
