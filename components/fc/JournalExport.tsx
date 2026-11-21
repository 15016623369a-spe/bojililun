'use client';
import { useState } from 'react';
export default function JournalExport({ today }: { today: string }) {
  const since = (n: number) => new Date(Date.parse(today) - (n - 1) * 86400000).toISOString().slice(0, 10);
  const [start, setStart] = useState(since(7)),
    [end, setEnd] = useState(today),
    [message, setMessage] = useState('');
  const url = '/api/ledger?' + new URLSearchParams({ start, end });
  return (
    <details>
      <summary>导出手账</summary>
      <div className="fc-examples">
        {[7, 30].map((n) => (
          <button
            key={n}
            onClick={() => {
              setStart(since(n));
              setEnd(today);
            }}
          >
            最近 {n} 天
          </button>
        ))}
      </div>
      <label>
        从 <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        {' '}
        至 <input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      {start && end && end >= start && (
        <p>
          <a download href={url + '&download&format=json'}>
            下载 JSON
          </a>{' '}
          ·{' '}
          <a download href={url + '&download&format=md'}>
            下载 Markdown
          </a>{' '}
          ·{' '}
          <button
            onClick={async () => {
              try {
                const r = await fetch(url + '&format=md');
                if (!r.ok) throw Error();
                await navigator.clipboard.writeText(await r.text());
                setMessage('已复制');
              } catch {
                setMessage('复制失败，可下载文件');
              }
            }}
          >
            复制 Markdown
          </button>
        </p>
      )}
      <small role="status">{message}</small>
    </details>
  );
}
