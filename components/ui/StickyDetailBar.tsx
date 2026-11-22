'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

export default function StickyDetailBar({ title, back }: { title: string; back: { href: string; label: string } }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = marker.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return <>
    <span className="sticky-detail-marker" ref={marker} aria-hidden="true" />
    <div className="sticky-detail-anchor">
      <div className="sticky-detail-bar" data-visible={visible || undefined} inert={!visible}>
        <Link href={back.href} aria-label={`返回${back.label}`}><Icon name="chevron-left" size={20} /></Link>
        <span aria-hidden="true" title={title}>{title}</span>
      </div>
    </div>
  </>;
}
