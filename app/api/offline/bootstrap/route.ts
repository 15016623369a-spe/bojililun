import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { imageUrl } from '@/lib/exercise-label';
import { sculptureMediaUrls } from '@/lib/exercise-anim';
import { getExercisePreferences } from '@/lib/core/exercise-preferences';
import { activeTraining, getPlan, getSessionSets, todayStr } from '@/lib/core/workout';
import type { SetRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RawEx {
  id: string;
  name: string;
  zh_name: string;
  body_part: string;
  target: string;
  equipment: string;
  secondary_muscles: string;
  image: string;
  gif_url: string;
  instructions: string;
  zh_instructions: string;
  mechanic: string;
  movement_pattern: string;
  metabolic_demand: string;
  met_range: string;
  fatigue_level: string;
  recommended_rep_range: string;
}

/** 一次下发手机离线运行所需的完整动作词典、当前训练单与近 90 天实练记录 */
export async function GET() {
  const db = getDb();
  const today = todayStr();
  const active = activeTraining();
  const planDate = active?.date ?? today;
  const plan = getPlan(planDate);
  const currentSets = active ? getSessionSets(active.id) : [];

  const recentSets = db.prepare(
    `SELECT ws.id, ws.session_id, ws.plan_item_id, ws.exercise_id, ws.exercise_name,
            ws.body_part, ws.target, ws.set_index, ws.weight, ws.reps,
            ws.duration_sec, ws.rest_sec, ws.actual_rest_sec, ws.created_at
     FROM workout_sets ws
     JOIN workout_sessions s ON s.id = ws.session_id
     WHERE s.date >= date('now', '-90 days')
     ORDER BY ws.id ASC`,
  ).all() as unknown as SetRow[];

  const prefs = getExercisePreferences();
  const rows = db.prepare(
    `SELECT id, name, zh_name, body_part, target, equipment, secondary_muscles,
            image, gif_url, instructions, zh_instructions,
            mechanic, movement_pattern, metabolic_demand, met_range, fatigue_level, recommended_rep_range
     FROM exercises`,
  ).all() as unknown as RawEx[];

  const exercises = rows.map((r) => ({
    id: r.id,
    name: r.name,
    zh_name: r.zh_name || r.name,
    body_part: r.body_part,
    target: r.target,
    equipment: r.equipment,
    secondary_muscles: r.secondary_muscles,
    image: r.image ? imageUrl(r.image) : '',
    hasAnimation: Boolean(r.gif_url),
    mechanic: r.mechanic,
    movement_pattern: r.movement_pattern,
    metabolic_demand: r.metabolic_demand,
    met_range: r.met_range,
    fatigue_level: r.fatigue_level,
    recommended_rep_range: r.recommended_rep_range,
    steps: (r.zh_instructions || r.instructions || '').split('\n').map((s) => s.trim()).filter(Boolean),
    preference: prefs.get(r.id) ?? null,
    ...sculptureMediaUrls(r.id),
  }));

  const demoMap: Record<string, { image?: string; hasAnimation?: boolean; hasSculpture?: boolean; mp4Url?: string; kfSheetUrl?: string }> = {};
  const byId = new Map(exercises.map((e) => [e.id, e]));
  for (const p of plan) {
    const ex = byId.get(p.exercise_id);
    if (ex) {
      demoMap[p.exercise_id] = {
        image: ex.image || undefined,
        hasAnimation: ex.hasAnimation,
        hasSculpture: ex.hasSculpture,
        mp4Url: ex.mp4Url,
        kfSheetUrl: ex.kfSheetUrl,
      };
    }
  }

  return NextResponse.json({
    syncedAt: new Date().toISOString(),
    today,
    planDate,
    activeSession: active ? { id: active.id, startedAt: active.started_at, date: active.date } : null,
    plan,
    currentSets,
    recentSets,
    exercises,
    demoMap,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
