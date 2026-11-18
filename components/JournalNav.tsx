import Link from 'next/link';
import JournalIcon from './JournalIcon';

const tabs = [
  { href: '/body', name: 'plan', label: '计划' },
  { href: '/', name: 'record', label: '记录' },
  { href: '/history', name: 'review', label: '回顾' },
] as const;

export default function JournalNav({ active }: { active?: typeof tabs[number]['name'] }) {
  return <nav className="journal-nav" aria-label="主导航">
    {tabs.map((tab) => <Link href={tab.href} key={tab.name} aria-current={active === tab.name ? 'page' : undefined}>
      <JournalIcon name={tab.name} /><span>{tab.label}</span>
    </Link>)}
  </nav>;
}
