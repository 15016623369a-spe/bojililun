'use client';

import { useEffect, useRef } from 'react';

const MAX_CANVAS_CACHE = 36;
const MAX_IMG_CACHE = 64;
const canvasCache = new Map<string, HTMLCanvasElement>();
const imgCache = new Map<string, HTMLImageElement>();

function touchCache<V>(map: Map<string, V>, key: string, value: V, max: number) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/** 空闲时预解码动作示意图，切卡时零延迟出图 */
export function preloadImage(src: string | undefined) {
  if (!src || typeof window === 'undefined' || imgCache.has(src)) return;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => touchCache(imgCache, src, img, MAX_IMG_CACHE);
  img.src = src;
}

/**
 * 印刷网点插画：把动作示意图按格采样亮度，在深色底上画银灰圆点。
 * 受光越多点越大，白底和描边不画点，炭黑背景从点与点之间透出来。
 * 图片需同源（/exercises/...），读不到像素时退回普通灰度图。
 */
export default function HalftoneImage({ src, cell = 4, color = '#cfd3d6', variant = 'classic', className, label }: {
  src: string;
  /** 网点格子边长（CSS 像素） */
  cell?: number;
  color?: string;
  /** classic：常规等距网点；sculpture：交错雕刻点阵，自动随深浅主题呈现明暗雕塑光影 */
  variant?: 'classic' | 'sculpture';
  className?: string;
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !src) return;
    let cancelled = false;
    let loadedImg: HTMLImageElement | null = imgCache.get(src) ?? null;

    const render = () => {
      const img = loadedImg;
      if (cancelled || !img) return;
      const box = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      el.width = w; el.height = h;
      const ctx = el.getContext('2d');
      if (!ctx) return;

      const isDark = document.documentElement.dataset.theme === 'dark';
      const cacheKey = `${src}|${cell}|${color}|${variant}|${isDark ? 1 : 0}|${w}x${h}`;
      const cached = canvasCache.get(cacheKey);
      if (cached) {
        touchCache(canvasCache, cacheKey, cached, MAX_CANVAS_CACHE);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(cached, 0, 0);
        el.dataset.ready = '';
        return;
      }

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
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const rctx = out.getContext('2d');
      if (!rctx) return;

      if (variant === 'sculpture') {
        const rgb = isDark ? '210,216,224' : '26,28,25';
        // 自动采样图片四角亮度，兼容纯白与浅灰底素材，彻底杜绝方形底框
        const ox = Math.max(0, Math.floor((w - dw) / 2) + 2);
        const oy = Math.max(0, Math.floor((h - dh) / 2) + 2);
        const rx = Math.min(w - 1, Math.floor((w + dw) / 2) - 3);
        const by = Math.min(h - 1, Math.floor((h + dh) / 2) - 3);
        const sampleLum = (px: number, py: number) => {
          const idx = (py * w + px) * 4;
          return (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
        };
        const cornerLums = [sampleLum(ox, oy), sampleLum(rx, oy), sampleLum(ox, by), sampleLum(rx, by)];
        const bgLum = Math.min(...cornerLums);
        const bgCut = bgLum > 0.72 ? Math.max(0.7, bgLum - 0.06) : 0.955;

        const rowStep = step * 0.86;
        let row = 0;
        for (let y = rowStep / 2; y < h; y += rowStep, row += 1) {
          const xOff = (row % 2) * (step * 0.5);
          for (let x = step / 2 + xOff; x < w; x += step) {
            const i = (Math.floor(y) * w + Math.floor(x)) * 4;
            const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
            if (lum >= bgCut) continue;
            // 四周与底部柔和羽化溶底，文字区上方更细腻不抢读数
            const nx = (x / w - 0.5) * 2;
            const ny = (y / h - 0.42) * 2;
            const edge = Math.max(0, 1 - Math.pow(Math.hypot(nx * 0.95, ny * 0.92), 2.2));
            if (edge < 0.06) continue;
            const relLum = Math.min(1, lum / Math.max(0.2, bgCut));
            // 高对比雕塑光影：夜间亮部细银点、暗部融进纯黑；白天墨点细腻随形
            const tone = isDark
              ? Math.pow(Math.max(0.06, 1 - Math.abs(relLum - 0.58) * 1.45), 1.05)
              : Math.pow(Math.max(0.06, 1 - relLum), 1.05);
            const r = step * 0.42 * (0.2 + 0.8 * tone);
            if (r < 0.28 * dpr) continue;
            const maxAlpha = isDark ? 0.64 : 0.54;
            const alpha = Math.min(maxAlpha, (0.16 + maxAlpha * tone) * edge);
            rctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
            rctx.beginPath();
            rctx.arc(x, y, r, 0, Math.PI * 2);
            rctx.fill();
          }
        }
      } else {
        rctx.fillStyle = color;
        for (let y = step / 2; y < h; y += step) {
          for (let x = step / 2; x < w; x += step) {
            const i = (Math.floor(y) * w + Math.floor(x)) * 4;
            const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
            if (lum > 0.975) continue;
            const r = step * 0.5 * (0.25 + 0.75 * Math.pow(Math.min(1, lum / 0.92), 1.4));
            if (r < 0.35 * dpr) continue;
            rctx.beginPath();
            rctx.arc(x, y, r, 0, Math.PI * 2);
            rctx.fill();
          }
        }
      }

      touchCache(canvasCache, cacheKey, out, MAX_CANVAS_CACHE);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(out, 0, 0);
      el.dataset.ready = '';
    };

    if (loadedImg) {
      render();
    } else {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        touchCache(imgCache, src, img, MAX_IMG_CACHE);
        loadedImg = img;
        render();
      };
      img.onerror = () => { el.dataset.failed = ''; };
      img.src = src;
    }

    const mo = variant === 'sculpture'
      ? new MutationObserver(() => { if (loadedImg) render(); })
      : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => { cancelled = true; mo?.disconnect(); };
  }, [src, cell, color, variant]);

  return <span className={className ? `halftone-img ${className}` : 'halftone-img'} role={label ? 'img' : undefined} aria-label={label}>
    <canvas ref={canvas} aria-hidden="true" />
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={fallback} src={src} alt="" aria-hidden="true" />
  </span>;
}
