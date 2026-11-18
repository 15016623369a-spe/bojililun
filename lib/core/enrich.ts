import { getDb } from '../db';
import type { RawItem } from '../ai/types';
import type { FoodItem } from '../types';

interface FoodRow {
  name: string;
  aliases: string;
  kcal_100g: number;
  protein_100g: number;
  carb_100g: number;
  fat_100g: number;
  default_grams: number;
}

function clampGrams(g: number): number {
  if (!Number.isFinite(g) || g <= 0) return 100;
  return Math.min(2000, Math.round(g));
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s()（）]/g, '');
}

function findFood(table: FoodRow[], name: string): FoodRow | undefined {
  const n = norm(name);
  if (!n) return undefined;

  for (const f of table) {
    if (norm(f.name) === n) return f;
  }
  for (const f of table) {
    const aliases = f.aliases.split(',').map(norm).filter(Boolean);
    if (aliases.some((a) => a === n)) return f;
  }
  // 宽松匹配：双向包含，短的一方至少 2 个字
  for (const f of table) {
    const candidates = [f.name, ...f.aliases.split(',')].map(norm).filter(Boolean);
    for (const c of candidates) {
      if (c.length >= 2 && (c.includes(n) || n.includes(c))) return f;
    }
  }
  return undefined;
}

/**
 * 把模型给的“名字 + 克数”落成可计算的营养条目。
 * 命中内置库时用库里的值；没命中时退回模型给的值，并标记 matched=false 让 UI 提示。
 */
export function enrichItems(raw: RawItem[]): FoodItem[] {
  const table = getDb().prepare('SELECT * FROM food_cache').all() as unknown as FoodRow[];

  return raw.map((r) => {
    const grams = clampGrams(r.grams);
    const hit = findFood(table, r.name);

    if (hit) {
      return {
        name: hit.name,
        grams,
        kcal_100g: hit.kcal_100g,
        protein_100g: hit.protein_100g,
        carb_100g: hit.carb_100g,
        fat_100g: hit.fat_100g,
        matched: true,
        confidence: r.confidence,
      };
    }

    return {
      name: r.name.trim() || '未知食物',
      grams,
      kcal_100g: r.kcal_100g ?? 150,
      protein_100g: r.protein_100g ?? 8,
      carb_100g: r.carb_100g ?? 15,
      fat_100g: r.fat_100g ?? 5,
      matched: false,
      confidence: r.confidence,
    };
  });
}
