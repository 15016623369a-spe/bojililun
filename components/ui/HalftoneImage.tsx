'use client';

import { useEffect, useRef } from 'react';

/**
 * 印刷网点插画：把动作示意图按格采样亮度，在深色底上画银灰圆点。
 * 受光越多点越大，白底和描边不画点，炭黑背景从点与点之间透出来。
 * 图片需同源（/exercises/...），读不到像素时退回普通灰度图。
 */
export default function HalftoneImage({ src, cell = 4, color = '#cfd3d6', className, label }: {
  src: string;
  /** 网点格子边长（CSS 像素） */
  cell?: number;
  color?: string;
  className?: string;
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !src) return;
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      const box = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      el.width = w; el.height = h;
      const ctx = el.getContext('2d');
      if (!ctx) return;
      // 先把图按 contain 画进离屏画布，再逐格读亮度
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) return;
      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      octx.fillStyle = '#fff';
      octx.fillRect(0, 0, w, h);
      octx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      let data: Uint8ClampedArray;
      try { data = octx.getImageData(0, 0, w, h).data; } catch { el.dataset.failed = ''; return; }
      const step = cell * dpr;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          const i = (Math.floor(y) * w + Math.floor(x)) * 4;
          const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
          if (lum > 0.975) continue; // 白底
          // 亮部点大、暗部点小；最暗的描边几乎不留点
          const r = step * 0.5 * (0.25 + 0.75 * Math.pow(Math.min(1, lum / 0.92), 1.4));
          if (r < 0.35 * dpr) continue;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      el.dataset.ready = '';
    };
    img.onerror = () => { el.dataset.failed = ''; };
    img.src = src;
    return () => { cancelled = true; };
  }, [src, cell, color]);

  return <span className={className ? `halftone-img ${className}` : 'halftone-img'} role={label ? 'img' : undefined} aria-label={label}>
    <canvas ref={canvas} aria-hidden="true" />
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={fallback} src={src} alt="" aria-hidden="true" />
  </span>;
}
