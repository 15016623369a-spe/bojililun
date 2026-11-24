import Link from 'next/link';
import Icon from './ui/Icon';

/**
 * 计划首屏右上角的「今日计划」入口。用点阵读出进度：每个动作一个点，练完的点亮成柠檬黄；
 * 全部完成时同样是墨色胶囊，点全部点亮、读数为 n/n；训练进行中显示珊瑚色呼吸点。
 */
export default function PlanPill({ total, done, live }: { total: number; done: number; live: boolean }) {
  const finished = total > 0 && done >= total;
  const state = live ? 'live' : total ? 'todo' : 'empty';
  const label = live ? '训练进行中，继续'
    : finished ? `今日计划已完成，共 ${total} 个动作`
      : total ? `今日计划，已练 ${done} / ${total} 个动作` : '今日还没有计划';
  const shown = Math.min(total, 8);
  return <Link className="plan-pill" data-state={state} data-finished={finished || undefined} href="/train" prefetch={true} aria-label={label}>
    {state === 'live' && <><i className="plan-pill-live" aria-hidden="true" /><span>训练中</span></>}
    {state === 'empty' && <><Icon name="plus" size={15} stroke={2.2} /><span>今日计划</span></>}
    {state === 'todo' && <>
      <span className="plan-pill-dots" aria-hidden="true">
        {Array.from({ length: shown }, (_, i) => <i key={i} data-on={i < Math.min(done, shown) || undefined} />)}
      </span>
      <span className="plan-pill-count"><b>{done}</b>/{total}</span>
    </>}
  </Link>;
}
