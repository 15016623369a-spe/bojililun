import Link from 'next/link';

const tabs = [
  { href: '/body', name: 'plan', label: '计划' },
  { href: '/', name: 'record', label: '记录' },
  { href: '/history', name: 'review', label: '回顾' },
] as const;

/** 悬浮炭黑胶囊：选中项是浅色小胶囊。 */
export default function JournalNav({ active }: { active?: typeof tabs[number]['name'] }) {
  return <nav className="journal-nav" aria-label="主导航">
    {tabs.map((tab) => <Link href={tab.href} prefetch={true} key={tab.name} aria-current={active === tab.name ? 'page' : undefined}>
      <span>{tab.label}</span>
    </Link>)}
  </nav>;
}
