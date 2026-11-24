import Link from 'next/link';
import { notFound } from 'next/navigation';
import AddToPlanButton from '@/components/AddToPlanButton';
import JournalShell from '@/components/JournalShell';
import ExerciseMetricsCard from '@/components/exercise/ExerciseMetricsCard';
import ExerciseStage from '@/components/exercise/ExerciseStage';
import { getPlan } from '@/lib/core/workout';
import { getExercise, relatedExercises } from '@/lib/exercise';
import { hasSculptureAnim, sculptureMediaUrls } from '@/lib/exercise-anim';
import { BODY_LABEL, EQUIPMENT_LABEL, imageUrl, zhAlias } from '@/lib/exercise-label';
import { formatExerciseMetrics } from '@/lib/exercise-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ExerciseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; item?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const fromToday = query.from === 'today';
  const planned = fromToday
    ? getPlan().find((item) => item.id === Number(query.item) && item.exercise_id === id)
    : undefined;
  const ex = getExercise(id);
  if (!ex) notFound();

  let steps: string[] = [];
  try {
    steps = JSON.parse(ex.zh_steps || '[]') as string[];
  } catch {
    steps = [];
  }

  const displayZh = ex.zh_name || zhAlias(ex.name);
  const back = fromToday ? { href: '/log', label: '今天' } : { href: '/exercises', label: '动作库' };

  const norm = (t: string) => t.replace(/[\s。，,、；;：:！!？?\-—–]/g, '');
  const stepsText = steps.join('');
  const showZh =
    Boolean(ex.zh) &&
    (!steps.length ||
      (norm(ex.zh) !== norm(stepsText) && !norm(ex.zh).startsWith(norm(stepsText).slice(0, 24))));

  const related = relatedExercises(ex, 4);
  const media = sculptureMediaUrls(ex.id);
  const metrics = formatExerciseMetrics(ex);

  return (
    <JournalShell
      active={fromToday ? 'record' : 'plan'}
      title={displayZh || ex.name}
      subtitle={displayZh !== ex.name ? ex.name : undefined}
      back={back}
      hideNav
      className="ex-detail-shell"
      footer={
        <div className="ex-detail-dock">
          <AddToPlanButton exerciseId={ex.id} variant="full" />
        </div>
      }
    >
      <div className="detail">
        <div className="ex-head-pills">
          <span className="ex-meta-pill">器械 · {EQUIPMENT_LABEL[ex.equipment] ?? ex.equipment}</span>
          <span className="ex-meta-pill">部位 · {BODY_LABEL[ex.body_part] ?? ex.body_part}</span>
        </div>

        <ExerciseStage
          id={ex.id}
          name={displayZh || ex.name}
          image={ex.image ? imageUrl(ex.image) : undefined}
          hasAnimation={Boolean(ex.gif_url)}
          hasSculpture={media.hasSculpture}
          mp4Url={media.mp4Url}
          kfSheetUrl={media.kfSheetUrl}
          kfLabels={metrics.kfLabels}
        />

        {planned && (
          <p className="ex-planned-banner">
            今日计划 · {planned.sets} 组 × {planned.reps} 次 · 组间休息 {planned.rest_sec} 秒
          </p>
        )}

        <ExerciseMetricsCard exercise={ex} />

        {steps.length > 0 && (
          <section className="ex-card">
            <div className="ex-card-hd">
              <h2>动作步骤</h2>
              <span>{steps.length} 步要点</span>
            </div>
            <ol className="ex-steps-list">
              {steps.map((s, i) => (
                <li key={i}>
                  <span className="ex-step-num">{String(i + 1).padStart(2, '0')}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {showZh && (
          <section className="ex-card">
            <div className="ex-card-hd">
              <h2>动作说明</h2>
            </div>
            <p className="ex-detail-text">{ex.zh}</p>
          </section>
        )}

        {related.length > 0 && (
          <section className="ex-card">
            <div className="ex-card-hd">
              <h2>练同一部位的其他动作</h2>
            </div>
            <div className="rel-grid">
              {related.map((r) => (
                <Link key={r.id} className="rel-card" href={`/exercises/${r.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className={hasSculptureAnim(r.id) ? 'is-sculpture' : undefined}
                    src={imageUrl(r.image)}
                    alt={r.name}
                    loading="lazy"
                  />
                  <span>{r.zh_name || zhAlias(r.name) || r.name}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="attr">
          动作数据来自{' '}
          <a href="https://github.com/hasaneyldrm/exercises-dataset" target="_blank" rel="noreferrer">
            hasaneyldrm/exercises-dataset
          </a>
          （MIT）；未升级条目原始动图与图片 ©{' '}
          <a href="https://gymvisual.com/" target="_blank" rel="noreferrer">
            Gym visual
          </a>
          ，仅限按其条款使用。
        </p>
      </div>
    </JournalShell>
  );
}
