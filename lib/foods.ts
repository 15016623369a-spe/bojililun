/**
 * 内置食物库（每 100g）。
 * 数据是常见家常食物的近似值，用于演示与快速录入；正式产品建议接入
 * 《中国食物成分表》或商业营养数据库。
 */

export interface FoodSeed {
  name: string;
  aliases: string;
  kcal_100g: number;
  protein_100g: number;
  carb_100g: number;
  fat_100g: number;
  default_grams: number;
}

export const FOODS: FoodSeed[] = [
  { name: '米饭', aliases: '白米饭,白饭', kcal_100g: 116, protein_100g: 2.6, carb_100g: 25.9, fat_100g: 0.3, default_grams: 200 },
  { name: '炒饭', aliases: '蛋炒饭,扬州炒饭', kcal_100g: 180, protein_100g: 5.0, carb_100g: 28, fat_100g: 6, default_grams: 250 },
  { name: '馒头', aliases: '白馒头', kcal_100g: 223, protein_100g: 7.0, carb_100g: 47, fat_100g: 1.1, default_grams: 100 },
  { name: '面条', aliases: '煮面,挂面,拉面', kcal_100g: 110, protein_100g: 4.5, carb_100g: 22, fat_100g: 0.4, default_grams: 250 },
  { name: '全麦面包', aliases: '面包,吐司', kcal_100g: 246, protein_100g: 9.0, carb_100g: 41, fat_100g: 3.5, default_grams: 60 },
  { name: '燕麦', aliases: '燕麦片,麦片', kcal_100g: 338, protein_100g: 10.9, carb_100g: 66, fat_100g: 6.1, default_grams: 40 },
  { name: '鸡蛋', aliases: '水煮蛋,煎蛋,鸡蛋羹', kcal_100g: 144, protein_100g: 13.3, carb_100g: 2.8, fat_100g: 8.8, default_grams: 55 },
  { name: '鸡胸肉', aliases: '鸡胸,鸡肉,鸡胸脯', kcal_100g: 133, protein_100g: 24, carb_100g: 0.6, fat_100g: 5, default_grams: 150 },
  { name: '鸡腿', aliases: '鸡腿肉,炸鸡腿', kcal_100g: 181, protein_100g: 16, carb_100g: 1.3, fat_100g: 12, default_grams: 120 },
  { name: '牛肉', aliases: '瘦牛肉,牛排,牛腱', kcal_100g: 250, protein_100g: 26, carb_100g: 0, fat_100g: 15, default_grams: 120 },
  { name: '猪里脊', aliases: '猪瘦肉,里脊,猪肉', kcal_100g: 155, protein_100g: 20, carb_100g: 1, fat_100g: 8, default_grams: 120 },
  { name: '三文鱼', aliases: '鲑鱼', kcal_100g: 208, protein_100g: 20, carb_100g: 0, fat_100g: 13, default_grams: 120 },
  { name: '虾', aliases: '基围虾,虾仁', kcal_100g: 93, protein_100g: 18.6, carb_100g: 2.8, fat_100g: 0.8, default_grams: 100 },
  { name: '牛奶', aliases: '纯牛奶', kcal_100g: 54, protein_100g: 3, carb_100g: 3.4, fat_100g: 3.2, default_grams: 250 },
  { name: '无糖酸奶', aliases: '酸奶,希腊酸奶', kcal_100g: 72, protein_100g: 3.5, carb_100g: 6, fat_100g: 3, default_grams: 150 },
  { name: '豆腐', aliases: '嫩豆腐,老豆腐', kcal_100g: 82, protein_100g: 8.1, carb_100g: 4.2, fat_100g: 3.7, default_grams: 120 },
  { name: '西兰花', aliases: '绿花菜', kcal_100g: 34, protein_100g: 2.8, carb_100g: 6.6, fat_100g: 0.4, default_grams: 100 },
  { name: '青菜', aliases: '生菜,小白菜,蔬菜,菠菜', kcal_100g: 20, protein_100g: 1.5, carb_100g: 3, fat_100g: 0.3, default_grams: 150 },
  { name: '土豆', aliases: '马铃薯,土豆丝', kcal_100g: 77, protein_100g: 2, carb_100g: 17, fat_100g: 0.1, default_grams: 150 },
  { name: '红薯', aliases: '地瓜,烤红薯', kcal_100g: 86, protein_100g: 1.6, carb_100g: 20, fat_100g: 0.1, default_grams: 150 },
  { name: '香蕉', aliases: '', kcal_100g: 93, protein_100g: 1.4, carb_100g: 22, fat_100g: 0.2, default_grams: 120 },
  { name: '苹果', aliases: '红富士', kcal_100g: 53, protein_100g: 0.2, carb_100g: 13.5, fat_100g: 0.2, default_grams: 180 },
  { name: '牛油果', aliases: '鳄梨', kcal_100g: 160, protein_100g: 2, carb_100g: 8.5, fat_100g: 14.7, default_grams: 100 },
  { name: '坚果', aliases: '每日坚果,杏仁,核桃,腰果', kcal_100g: 600, protein_100g: 20, carb_100g: 20, fat_100g: 50, default_grams: 25 },
  { name: '拿铁', aliases: '咖啡,拿铁咖啡,美式', kcal_100g: 60, protein_100g: 3, carb_100g: 5, fat_100g: 3, default_grams: 300 },
  { name: '可乐', aliases: '汽水,雪碧', kcal_100g: 42, protein_100g: 0, carb_100g: 10.6, fat_100g: 0, default_grams: 330 },
  { name: '薯条', aliases: '薯片', kcal_100g: 312, protein_100g: 3.4, carb_100g: 41, fat_100g: 15, default_grams: 100 },
  { name: '汉堡', aliases: '牛肉堡,汉堡包', kcal_100g: 295, protein_100g: 15, carb_100g: 25, fat_100g: 15, default_grams: 200 },
  { name: '披萨', aliases: '比萨,pizza', kcal_100g: 266, protein_100g: 11, carb_100g: 33, fat_100g: 10, default_grams: 150 },
  { name: '蛋白粉', aliases: '乳清蛋白,增肌粉,蛋白', kcal_100g: 380, protein_100g: 75, carb_100g: 8, fat_100g: 5, default_grams: 30 },
  { name: '火锅', aliases: '麻辣烫', kcal_100g: 150, protein_100g: 10, carb_100g: 8, fat_100g: 9, default_grams: 300 },
  { name: '包子', aliases: '肉包,菜包', kcal_100g: 227, protein_100g: 7, carb_100g: 36, fat_100g: 6, default_grams: 100 },
  { name: '粥', aliases: '白粥,小米粥,稀饭', kcal_100g: 46, protein_100g: 1.1, carb_100g: 9.9, fat_100g: 0.3, default_grams: 300 },
];

/** 把别名拆开，供匹配使用 */
export function foodAliases(f: FoodSeed): string[] {
  const out = new Set<string>();
  out.add(f.name);
  for (const a of f.aliases.split(',')) {
    const t = a.trim();
    if (t) out.add(t);
  }
  return [...out];
}

function hasNumberNear(text: string, from: number): boolean {
  return /^\D{0,2}?\d/.test(text.slice(from, from + 8));
}

/**
 * 在文本里找出本库命中过的食物。
 * - 单字别名（饭 / 蛋 / 奶 / 蕉）一律忽略，否则「午饭」会被当成「饭」；
 * - 同一种食物只保留一次，并优先选后面紧跟数字（份量）的那处出现。
 */
export function matchFoodsInText(text: string): { food: FoodSeed; index: number }[] {
  const best = new Map<string, { food: FoodSeed; index: number; scored: number }>();

  for (const f of FOODS) {
    for (const alias of foodAliases(f)) {
      if (alias.length < 2) continue;
      let i = text.indexOf(alias);
      while (i >= 0) {
        const scored = hasNumberNear(text, i + alias.length) ? 1 : 0;
        const prev = best.get(f.name);
        if (!prev || scored > prev.scored || (scored === prev.scored && i < prev.index)) {
          best.set(f.name, { food: f, index: i, scored });
        }
        i = text.indexOf(alias, i + 1);
      }
    }
  }

  return [...best.values()]
    .map(({ food, index }) => ({ food, index }))
    .sort((a, b) => a.index - b.index);
}
