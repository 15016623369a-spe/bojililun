import { estimateEnergy, type ExerciseLoad } from './energy';
import { trainingDetail } from './log';
import type { Card } from './export';

/**
 * 一天的运动消耗（粗估，界面上必须写「约」）。
 * - 训练页练的每一节：沿用 trainingDetail 的口径（部位 MET × 体重 × 时长 × 强度 × 器械）。
 *   时长取实际开始到结束；如果比组数还短（例如测试时连点完成），按每组至少 1 分钟计。
 * - 只在手账里说的训练（语音、打字）：没有时长，按每组 1 分钟、MET 取默认值估。
 *   旧训练表同步进手账的那一份按开始时间对上，不重复计算。
 */
export function dayExerciseBurn(
  sessions: { id: number; started_at: string }[],
  cards: Card[],
  bodyWeightKg: number,
) {
  let kcal = 0;
  let minutes = 0;
  const starts = new Set(sessions.map((s) => Date.parse(s.started_at)));
  for (const session of sessions) {
    const detail = trainingDetail(session.id);
    if (!detail?.exercises.length) continue;
    const sets = detail.exercises.reduce((sum, e) => sum + Math.max(1, e.sets), 0);
    const span = Math.max(detail.minutes, sets);
    kcal += estimateEnergy(detail.exercises, span, detail.bodyWeightKg).kcal;
    minutes += span;
  }
  for (const card of cards) {
    if (card.entry_type !== 'workout' || starts.has(Date.parse(card.logged_at))) continue;
    const loads: ExerciseLoad[] = card.exercises
      .filter((m) => m.sets.length)
      .map((m) => ({
        name: m.exercise_name,
        bodyPart: '',
        target: '',
        secondary: [],
        equipment: '',
        sets: m.sets.length,
        reps: Math.round(m.sets.reduce((sum, s) => sum + (s.reps ?? 0), 0) / m.sets.length),
        weight: Math.max(0, ...m.sets.map((s) => s.weight_kg ?? 0)),
      }));
    const sets = loads.reduce((sum, l) => sum + l.sets, 0);
    if (!sets) continue;
    kcal += estimateEnergy(loads, sets, bodyWeightKg).kcal;
    minutes += sets;
  }
  return { kcal: Math.round(kcal), minutes };
}
