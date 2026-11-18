import Link from 'next/link';
import type { JournalEntry } from '@/lib/journal';
import JournalIcon from './JournalIcon';

export default function JournalTimeline({ entries, freshId, onEdit, onUndo, compact }: {
  entries: JournalEntry[];
  freshId?: string;
  compact?: boolean;
  onEdit?: (entry: JournalEntry) => void;
  onUndo?: (entry: JournalEntry) => void;
}) {
  return <ul className={compact ? 'journal-timeline compact' : 'journal-timeline'}>
    {entries.map((entry) => <li key={entry.id} className={`timeline-entry ${entry.kind} ${entry.id === freshId ? 'fresh' : ''}`}>
      <div className="entry-label"><JournalIcon name={entry.kind} />{entry.time && <span>{entry.time} ·</span>}{entry.title}</div>
      {entry.href ? <Link href={entry.href} className="entry-detail">{entry.detail}</Link> : <strong className="entry-detail">{entry.detail}</strong>}
      {entry.meta && <div className="entry-meta">{entry.meta}</div>}
      {entry.id === freshId && entry.source && entry.source !== entry.detail && <p className="entry-meta">原话 · {entry.source}</p>}
      {entry.quickId && onEdit && <div className="entry-actions">
        <button onClick={() => onEdit(entry)}>编辑</button>
        {entry.id === freshId && onUndo && <button onClick={() => onUndo(entry)}>撤销</button>}
      </div>}
    </li>)}
  </ul>;
}
