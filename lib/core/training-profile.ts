import { createHash } from 'node:crypto';
import { DEFAULT_TZ, todayKey } from '../date';
import { getDb } from '../db';
import { upsertMemory } from '../memory';
import { validDate } from '../period';
import { TRAINING_GOALS, type TrainingGoal } from '../training-goals';

export type TrainingSex = 'male' | 'female';

type TrainingRow = {
  name: string | null;
  sex: TrainingSex | 'unspecified' | null;
  goal: TrainingGoal | null;
};

type LegacyProfile = {
  name: string;
  sex: string;
  goal: string;
  weight_kg: number;
  updated_at: string;
};

type WeightEntry = { date: string; weight: number };

type TrainingProfileInput = {
  setup?: boolean;
  name?: string;
  sex?: TrainingSex | null;
  goal?: TrainingGoal;
  weight?: number;
  date?: string;
  restriction?: string;
};

function trainingRow() {
  return getDb().prepare('SELECT name, sex, goal FROM training_profile WHERE id = 1').get() as TrainingRow | undefined;
}

function legacyProfile() {
  return getDb().prepare('SELECT name, sex, goal, weight_kg, updated_at FROM profile WHERE id = 1')
    .get() as LegacyProfile | undefined;
}

function asSex(value?: string | null): TrainingSex | null {
  return value === 'male' || value === 'female' ? value : null;
}

function legacyGoal(value?: string): TrainingGoal | null {
  if (value === 'bulk') return 'muscle';
  if (value === 'cut') return 'weight';
  if (value === 'maintain') return 'habit';
  return null;
}

function legacyWeight(profile?: LegacyProfile): WeightEntry | null {
  if (!profile || profile.weight_kg <= 0) return null;
  const when = new Date(profile.updated_at);
  if (!Number.isFinite(when.getTime())) return null;
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TZ || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(when);
  return validDate(date) ? { date, weight: profile.weight_kg } : null;
}

export function needsTrainingSetup(): boolean {
  const row = getDb().prepare(`
    SELECT EXISTS(SELECT 1 FROM training_profile)
      OR EXISTS(SELECT 1 FROM profile)
      OR EXISTS(SELECT 1 FROM session)
      OR EXISTS(SELECT 1 FROM meal_log)
      OR EXISTS(SELECT 1 FROM journal_entry)
      OR EXISTS(SELECT 1 FROM plan_item)
      OR EXISTS(SELECT 1 FROM memory)
      OR EXISTS(SELECT 1 FROM workout_log) AS initialized
  `).get() as { initialized: number };
  return row.initialized === 0;
}

export function getTrainingModelSex(): TrainingSex | null {
  const row = trainingRow();
  return asSex(row?.sex ?? legacyProfile()?.sex);
}

export function getTrainingProfile() {
  const row = trainingRow();
  const legacy = legacyProfile();
  const weights = getDb().prepare('SELECT date, weight FROM weight_entry ORDER BY date DESC')
    .all() as WeightEntry[];
  const oldWeight = weights.length === 0 ? legacyWeight(legacy) : null;
  return {
    name: row?.name ?? legacy?.name ?? '我',
    sex: asSex(row?.sex ?? legacy?.sex),
    goal: row?.goal ?? legacyGoal(legacy?.goal),
    needsSetup: needsTrainingSetup(),
    weights: oldWeight ? [oldWeight] : weights.map(({ date, weight }) => ({ date, weight })),
  };
}

export function saveTrainingProfile(input: TrainingProfileInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请检查提交的训练档案');
  const { setup, name, sex, goal, weight, date, restriction } = input;
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 20)) {
    throw new Error('请输入 1–20 个字的昵称');
  }
  if (sex !== undefined && sex !== null && !asSex(sex)) throw new Error('请选择有效的性别选项');
  if ((setup === true || goal !== undefined) && (typeof goal !== 'string' || !Object.hasOwn(TRAINING_GOALS, goal))) {
    throw new Error('请选择主要训练目标');
  }
  if (restriction !== undefined && (typeof restriction !== 'string' || !restriction.trim() || restriction.trim().length > 200)) {
    throw new Error('请输入 1–200 个字的训练限制');
  }
  const today = todayKey(process.env.APP_TZ || DEFAULT_TZ);
  const weightDate = date ?? today;
  if (weight !== undefined && (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0)) {
    throw new Error('请输入大于 0 的体重');
  }
  if (weight !== undefined && (typeof weightDate !== 'string' || !validDate(weightDate) || weightDate > today)) {
    throw new Error('请选择今天或更早的有效日期');
  }
  if (name === undefined && sex === undefined && goal === undefined && weight === undefined && restriction === undefined) {
    throw new Error('请填写需要保存的资料');
  }

  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (setup !== true && needsTrainingSetup()) throw new Error('请先建立训练档案');
    if (name !== undefined || sex !== undefined || goal !== undefined) {
      db.prepare(`
        INSERT INTO training_profile (id, name, sex, goal) VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, name),
          sex = COALESCE(excluded.sex, sex), goal = COALESCE(excluded.goal, goal)
      `).run(name?.trim() ?? null, sex === null ? 'unspecified' : sex ?? null, goal ?? null);
    }
    if (weight !== undefined) {
      const first = !db.prepare('SELECT 1 FROM weight_entry LIMIT 1').get();
      const oldWeight = first ? legacyWeight(legacyProfile()) : null;
      if (oldWeight) db.prepare('INSERT INTO weight_entry (date, weight) VALUES (?, ?)').run(oldWeight.date, oldWeight.weight);
      // Keep the legacy bridge trigger's conflict handling when the date already exists.
      const updated = db.prepare('UPDATE weight_entry SET weight = ? WHERE date = ?').run(weight, weightDate);
      if (!updated.changes) db.prepare('INSERT INTO weight_entry (date, weight) VALUES (?, ?)').run(weightDate, weight);
    }
    if (restriction) {
      const content = restriction.trim();
      const key = 'training-profile:' + createHash('sha256').update(content).digest('hex').slice(0, 48);
      upsertMemory({ kind: 'constraint', key, content, importance: 5, source: 'profile', confidence: 1 });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getTrainingProfile();
}
