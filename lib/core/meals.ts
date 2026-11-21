import { getDb } from '../db';
import { mealNutrition } from '../journal';
import { macrosFor, sumMacros, EMPTY_MACROS, type Macros } from '../nutrition';
import { MEAL_LABEL, todayKey, type MealType } from '../date';
import { readQuickPayload } from '../quick-parse';
import { cleanupDrafts } from './chat';
import { listMemories } from '../memory';
import type { AssistantReply, FoodItem, MealRecord, TodayPayload } from '../types';

const TZ = process.env.APP_TZ || 'Asia/Shanghai';

interface ProfileRow {
  name: string;
  sex: string;
  age: number;
  height_cm: number;
  weight_kg: number;
  activity: string;
  goal: string;
  target_kcal: number;
  target_protein: number;
}

function clampGrams(g: unknown): number {
  const n = Number(g);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(2000, Math.round(n));
}

export function getProfileRow(): ProfileRow | null {
  const row = getDb().prepare('SELECT * FROM profile WHERE id = 1').get() as ProfileRow | undefined;
  return row ?? null;
}

function readDraft(draftId: string):
  | { items: FoodItem[]; mealType: MealType; photoUrl?: string; note?: string }
  | null {
  const row = getDb().prepare('SELECT payload_json FROM draft WHERE id = ?').get(draftId) as
    | { payload_json: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.payload_json);
}

export function mealsOn(date: string): MealRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM meal_log WHERE date = ? ORDER BY id ASC')
    .all(date) as unknown as Array<{
    id: number;
    date: string;
    meal_type: string;
    photo_path: string | null;
    items_json: string;
    kcal: number;
    protein: number;
    carb: number;
    fat: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    meal_type: r.meal_type as MealType,
    photo_path: r.photo_path,
    items: JSON.parse(r.items_json) as FoodItem[],
    kcal: r.kcal,
    protein: r.protein,
    carb: r.carb,
    fat: r.fat,
    created_at: r.created_at,
  }));
}

function consumedOn(date: string, meals: MealRecord[]) {
  const rows = getDb().prepare(`
    SELECT payload_json, source_text, kind, detail, title FROM journal_entry
    WHERE date = ? AND kind = 'meal' AND merged_session_id IS NULL
  `).all(date) as unknown as Parameters<typeof readQuickPayload>[0][];
  const quickMeals = rows.map(readQuickPayload).filter((payload) => !payload.planned);
  const quickNutrition = mealNutrition(quickMeals);
  return {
    consumed: sumMacros([...meals, quickNutrition.totals]),
    quickMealCount: quickMeals.length,
    pendingQuickMealItems: quickNutrition.pending,
  };
}

export interface ConfirmResult {
  reply: AssistantReply;
  consumed: Macros;
  remainingKcal: number;
  remainingProtein: number;
  mealType: MealType;
}

export function confirmDraft(draftId: string, incoming: FoodItem[]): ConfirmResult {
  const db = getDb();
  cleanupDrafts();

  const payload = readDraft(draftId);
  if (!payload) throw new Error('这张卡片已经处理过了，或者草稿过期了');

  const profile = getProfileRow();
  if (!profile) throw new Error('先完成个人资料，才能计算热量');

  const source = Array.isArray(incoming) && incoming.length ? incoming : payload.items;
  const items: FoodItem[] = source.map((it) => {
    const grams = clampGrams(it.grams);
    return {
      name: String(it.name || '未知食物'),
      grams,
      kcal_100g: Number(it.kcal_100g) || 0,
      protein_100g: Number(it.protein_100g) || 0,
      carb_100g: Number(it.carb_100g) || 0,
      fat_100g: Number(it.fat_100g) || 0,
      matched: Boolean(it.matched),
    };
  });

  const perItem = items.map((it) =>
    macrosFor(it.grams, {
      kcal: it.kcal_100g,
      protein: it.protein_100g,
      carb: it.carb_100g,
      fat: it.fat_100g,
    }),
  );
  const total = perItem.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      protein: Math.round((acc.protein + m.protein) * 10) / 10,
      carb: Math.round((acc.carb + m.carb) * 10) / 10,
      fat: Math.round((acc.fat + m.fat) * 10) / 10,
    }),
    { ...EMPTY_MACROS },
  );

  const date = todayKey(TZ);
  db.prepare(
    `INSERT INTO meal_log (date, meal_type, photo_path, items_json, kcal, protein, carb, fat, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    date,
    payload.mealType,
    payload.photoUrl ?? null,
    JSON.stringify(items),
    total.kcal,
    total.protein,
    total.carb,
    total.fat,
    new Date().toISOString(),
  );

  db.prepare('DELETE FROM draft WHERE id = ?').run(draftId);

  const { consumed, pendingQuickMealItems } = consumedOn(date, mealsOn(date));
  const remainingKcal = Math.round(profile.target_kcal - consumed.kcal);
  const remainingProtein = Math.round(profile.target_protein - consumed.protein);

  const label = MEAL_LABEL[payload.mealType] ?? '这一餐';
  const text = [
    `已记入${label}：${total.kcal} kcal，蛋白质 ${total.protein}g。`,
    `今天 ${consumed.kcal} / ${profile.target_kcal} kcal，${
      remainingKcal >= 0 ? `还可摄入 ${remainingKcal} kcal` : `已超出 ${Math.abs(remainingKcal)} kcal`
    }；蛋白质 ${Math.round(consumed.protein)} / ${profile.target_protein}g（还差 ${Math.max(0, remainingProtein)}g）。`
      + (pendingQuickMealItems ? `还有 ${pendingQuickMealItems} 项热量待补。` : ''),
  ].join('\n');

  return {
    reply: { kind: 'summary', text, consumed, remainingKcal },
    consumed,
    remainingKcal,
    remainingProtein,
    mealType: payload.mealType,
  };
}

export function deleteMeal(id: number): void {
  getDb().prepare('DELETE FROM meal_log WHERE id = ?').run(id);
}

/** 修改某一餐某行食物的克数：回写 items_json 并按每 100g 营养值重算整餐热量 */
export function updateMealGrams(id: number, index: number, grams: number): { grams: number; kcal: number; protein: number } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM meal_log WHERE id = ?').get(id) as
    | { items_json: string } | undefined;
  if (!row) throw new Error('记录不存在');
  const items = JSON.parse(row.items_json) as FoodItem[];
  const item = items[index];
  if (!item) throw new Error('记录不存在');
  const value = Number(grams);
  if (!Number.isFinite(value) || value < 1 || value > 2000) throw new Error('分量需在 1–2000 g 之间');
  item.grams = Math.round(value);
  const perItem = items.map((it) => macrosFor(it.grams, {
    kcal: it.kcal_100g, protein: it.protein_100g, carb: it.carb_100g, fat: it.fat_100g,
  }));
  const total = perItem.reduce((acc, m) => ({
    kcal: acc.kcal + m.kcal,
    protein: Math.round((acc.protein + m.protein) * 10) / 10,
    carb: Math.round((acc.carb + m.carb) * 10) / 10,
    fat: Math.round((acc.fat + m.fat) * 10) / 10,
  }), { ...EMPTY_MACROS });
  db.prepare('UPDATE meal_log SET items_json = ?, kcal = ?, protein = ?, carb = ?, fat = ? WHERE id = ?')
    .run(JSON.stringify(items), total.kcal, total.protein, total.carb, total.fat, id);
  return { grams: item.grams, kcal: total.kcal, protein: total.protein };
}

export function todaySnapshot(): TodayPayload {
  cleanupDrafts();
  const db = getDb();
  const date = todayKey(TZ);
  const profile = getProfileRow();
  const meals = mealsOn(date);
  const nutrition = consumedOn(date, meals);
  const { consumed } = nutrition;

  const draftRow = db
    .prepare("SELECT id, payload_json FROM draft WHERE kind = 'food' ORDER BY created_at DESC LIMIT 1")
    .get() as { id: string; payload_json: string } | undefined;

  let pendingDraft: TodayPayload['pendingDraft'] = null;
  if (draftRow) {
    const p = JSON.parse(draftRow.payload_json) as {
      items: FoodItem[];
      mealType: MealType;
      photoUrl?: string;
      note?: string;
    };
    pendingDraft = { draftId: draftRow.id, mealType: p.mealType, items: p.items, photoUrl: p.photoUrl, note: p.note };
  }

  return {
    date,
    profile: profile ?? null,
    ...nutrition,
    remainingKcal: profile ? Math.round(profile.target_kcal - consumed.kcal) : 0,
    remainingProtein: profile ? Math.round(profile.target_protein - consumed.protein) : 0,
    meals,
    pendingDraft,
    memories: listMemories(),
  };
}
