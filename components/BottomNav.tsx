import JournalNav from './JournalNav';

export default function BottomNav({ active }: { active: 'train' | 'stats' | 'body' | 'history' | 'me' }) {
  return <div className="journal-footer legacy-footer">
    <JournalNav active={active === 'train' || active === 'body' ? 'plan' : 'review'} />
  </div>;
}
