const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 「11.21」大字：月份墨黑，日期中灰；右侧放星期和一行说明。 */
export default function BigDate({ date, aside, note, children }: {
  date: string;
  aside?: string;
  note?: string;
  children?: React.ReactNode;
}) {
  const [, m, d] = date.split('-');
  return <div className="big-date-hero">
    <div className="big-num big-date" aria-label={`${Number(m)} 月 ${Number(d)} 日`}>
      {m}<span className="dim">.{d}</span>
    </div>
    <div className="big-date-side">
      <b>{aside ?? weekdayOf(date)}</b>
      {note && <small>{note}</small>}
      {children}
    </div>
  </div>;
}
