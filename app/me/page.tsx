import Link from 'next/link';
import BottomNav from '@/components/BottomNav';
import ProfileEditor from '@/components/ProfileEditor';
import MemoryManager from '@/components/MemoryManager';
import { ACTIVITY, GOAL } from '@/lib/nutrition';
import { getProfileRow } from '@/lib/core/meals';
import { listMemories } from '@/lib/memory';
import { exerciseCount } from '@/lib/exercise';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function MePage() {
  const profile = getProfileRow();
  const memories = listMemories();
  const db = getDb();

  const meals = (db.prepare('SELECT COUNT(*) AS c FROM meal_log').get() as { c: number }).c;
  const sessions = (db.prepare('SELECT COUNT(*) AS c FROM session WHERE ended_at IS NOT NULL').get() as { c: number }).c;
  const totalSets = (db.prepare('SELECT COUNT(*) AS c FROM session_set').get() as { c: number }).c;

  return (
    <div className="page">
      <header className="page-hdr">
        <div>
          <h1>我的</h1>
          <p>资料、目标与记忆</p>
        </div>
      </header>

      <div className="page-body">
        <ProfileEditor
          profile={
            profile
              ? {
                  name: profile.name,
                  sex: profile.sex,
                  age: profile.age,
                  height_cm: profile.height_cm,
                  weight_kg: profile.weight_kg,
                  activity: profile.activity,
                  goal: profile.goal,
                  target_kcal: profile.target_kcal,
                  target_protein: profile.target_protein,
                }
              : null
          }
        />

        {profile && (
          <section className="block">
            <h2 className="block-title">当前推算</h2>
            <div className="metric-grid">
              <div className="metric-card">
                <span>每日热量目标</span>
                <b>
                  {profile.target_kcal} <em>kcal</em>
                </b>
                <small>{GOAL[profile.goal as keyof typeof GOAL]?.label ?? profile.goal}</small>
              </div>
              <div className="metric-card">
                <span>蛋白质目标</span>
                <b>
                  {profile.target_protein} <em>g</em>
                </b>
                <small>{ACTIVITY[profile.activity as keyof typeof ACTIVITY]?.label ?? profile.activity}</small>
              </div>
            </div>
          </section>
        )}

        <section className="block">
          <h2 className="block-title">
            记忆
            <span>{memories.length} 条</span>
          </h2>
          <MemoryManager initial={memories} />
        </section>

        <section className="block">
          <h2 className="block-title">数据</h2>
          <div className="data-rows">
            <div>
              <span>动作库</span>
              <b>{exerciseCount()} 个</b>
            </div>
            <div>
              <span>饮食记录</span>
              <b>{meals} 条</b>
            </div>
            <div>
              <span>完成的训练</span>
              <b>{sessions} 次</b>
            </div>
            <div>
              <span>累计组数</span>
              <b>{totalSets} 组</b>
            </div>
          </div>
        </section>

        <section className="block">
          <h2 className="block-title">模型</h2>
          <div className="hint-box">
            <p>
              当前 AI 提供方：<b>{process.env.AI_PROVIDER || 'mock'}</b>
            </p>
            <p>
              {process.env.AI_PROVIDER === 'openai'
                ? '已接入真实多模态模型，拍照可识别食物与器械。'
                : '演示模式：食物识别使用内置食物库，训练与统计全部真实可用。把 .env.local 里的 AI_PROVIDER 改成 openai 并填 Key 即可切到真实模型。'}
            </p>
          </div>
        </section>

        <section className="block">
          <div className="row-btns">
            <Link className="btn" href="/chat">
              跟教练对话
            </Link>
            <Link className="btn" href="/exercises">
              去动作库
            </Link>
          </div>
        </section>
      </div>

      <BottomNav active="me" />
    </div>
  );
}
