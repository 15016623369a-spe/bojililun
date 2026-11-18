import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import { notFound } from 'next/navigation';
import AddToPlanButton from '@/components/AddToPlanButton';
import ExerciseMedia from '@/components/ExerciseMedia';
import {
  BODY_LABEL,
  EQUIPMENT_LABEL,
  TARGET_LABEL,
  imageUrl,
  zhAlias,
} from '@/lib/exercise-label';
import { getExercise, relatedExercises } from '@/lib/exercise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ExerciseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ex = getExercise(id);
  if (!ex) notFound();

  let steps: string[] = [];
  try {
    steps = JSON.parse(ex.zh_steps || '[]') as string[];
  } catch {
    steps = [];
  }
  const displayZh = ex.zh_name || zhAlias(ex.name);

  // 数据集的“整段说明”和“分步要点”内容基本重复，只保留分步
  const norm = (t: string) => t.replace(/[\s。，,、；;：:！!？?\-—–]/g, '');
  const stepsText = steps.join('');
  const showZh = Boolean(ex.zh) && (!steps.length || (norm(ex.zh) !== norm(stepsText) && !norm(ex.zh).startsWith(norm(stepsText).slice(0, 24))));
  const related = relatedExercises(ex, 4);
  const secondary: string[] = (() => {
    try {
      return JSON.parse(ex.secondary_muscles || '[]') as string[];
    } catch {
      return [];
    }
  })();

  return (
    <JournalShell active="plan" title={displayZh || ex.name} subtitle={displayZh !== ex.name ? ex.name : undefined} back={{ href: '/exercises', label: '动作库' }}>
      <div className="detail">
        <ExerciseMedia id={ex.id} image={ex.image ? imageUrl(ex.image) : undefined} name={displayZh || ex.name} hasAnimation={Boolean(ex.gif_url)} />

        <div className="detail-cta">
          <AddToPlanButton exerciseId={ex.id} variant="full" />
        </div>

        <div className="detail-tags">
          <span className="d-tag">目标 · {TARGET_LABEL[ex.target] ?? ex.target}</span>
          <span className="d-tag">器械 · {EQUIPMENT_LABEL[ex.equipment] ?? ex.equipment}</span>
          <span className="d-tag">部位 · {BODY_LABEL[ex.body_part] ?? ex.body_part}</span>
          {secondary.slice(0, 3).map((m) => (
            <span className="d-tag dim" key={m}>
              {TARGET_LABEL[m] ?? m}
            </span>
          ))}
        </div>

        {steps.length > 0 && (
          <section className="detail-block">
            <h2>动作步骤</h2>
            <ol className="steps">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>
        )}

        {showZh && (
          <section className="detail-block">
            <h2>动作说明</h2>
            <p className="detail-text">{ex.zh}</p>
          </section>
        )}


        {related.length > 0 && (
          <section className="detail-block">
            <h2>练同一部位的其他动作</h2>
            <div className="rel-grid">
              {related.map((r) => (
                <Link key={r.id} className="rel-card" href={`/exercises/${r.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(r.image)} alt={r.name} loading="lazy" />
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
          （MIT）；动画与图片 ©{' '}
          <a href="https://gymvisual.com/" target="_blank" rel="noreferrer">
            Gym visual
          </a>
          ，仅限按其条款使用。
        </p>

      </div>
    </JournalShell>
  );
}
