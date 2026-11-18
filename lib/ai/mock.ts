/**
 * 演示模式 provider：
 * - 不调用任何外部 API，靠内置食物库做文字匹配；
 * - 图片则按图片内容哈希分配一份“典型餐盘”，用来演示完整交互闭环；
 * - 返回的 note 会明确标注这是演示数据，绝不伪装成真实识别。
 */
import { FOODS, matchFoodsInText } from '../foods';
import { currentMealType } from '../date';
import type { RawItem, Recognition, RecognizeInput, VisionProvider } from './types';

const PLATES: RawItem[][] = [
  [{ name: '米饭', grams: 200 }, { name: '鸡胸肉', grams: 150 }, { name: '西兰花', grams: 100 }],
  [{ name: '全麦面包', grams: 60 }, { name: '鸡蛋', grams: 110 }, { name: '无糖酸奶', grams: 150 }],
  [{ name: '面条', grams: 250 }, { name: '牛肉', grams: 100 }, { name: '青菜', grams: 100 }],
  [{ name: '米饭', grams: 150 }, { name: '三文鱼', grams: 120 }, { name: '牛油果', grams: 80 }],
  [{ name: '燕麦', grams: 40 }, { name: '牛奶', grams: 250 }, { name: '香蕉', grams: 120 }],
  [{ name: '汉堡', grams: 200 }, { name: '薯条', grams: 100 }, { name: '可乐', grams: 330 }],
  [{ name: '红薯', grams: 150 }, { name: '鸡蛋', grams: 110 }, { name: '蛋白粉', grams: 30 }],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 97) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 在命中的食物名后面找 “200g / 200克” 这类份量 */
function gramsAfter(text: string, index: number, fallback: number): number {
  const window = text.slice(index, index + 16);
  const m = /^\D{0,2}?(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)/i.exec(window);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 2000) return n;
  }
  const m2 = /(\d+(?:\.\d+)?)\s*(两|个|份|碗|杯|勺)/.exec(window);
  if (m2) {
    const unit = m2[2];
    const n = Number(m2[1]);
    const factor = unit === '两' ? 50 : unit === '勺' ? 15 : 1;
    // 个/份/碗 直接当作默认份量的倍数
    return unit === '个' || unit === '份' || unit === '碗' ? fallback * n : n * factor;
  }
  return fallback;
}

export const mockProvider: VisionProvider = {
  name: 'mock',

  async recognize({ text, imageDataUrl }: RecognizeInput): Promise<Recognition> {
    if (text && text.trim()) {
      const hits = matchFoodsInText(text);
      if (hits.length) {
        const items: RawItem[] = hits.map((h) => ({
          name: h.food.name,
          grams: Math.round(gramsAfter(text, h.index, h.food.default_grams)),
          confidence: 0.75,
        }));
        return {
          kind: 'food',
          items,
          mealType: currentMealType(),
          note: '演示模式：按内置食物库解析文字，未调用真实模型。',
        };
      }
      return {
        kind: 'other',
        text:
          '这句我还接不住。我能做两件事：记饮食（「午饭吃了米饭 200g、鸡胸肉 150g」或拍张照）、按部位排训练（「今天练胸」）。\n\n' +
          '（当前是演示模式，接上真实的多模态模型后能听懂更多。）',
      };
    }

    if (imageDataUrl) {
      const plate = PLATES[hash(imageDataUrl) % PLATES.length];
      return {
        kind: 'food',
        items: plate.map((p) => ({ ...p, confidence: 0.6 })),
        mealType: currentMealType(),
        note: '演示模式：这是随机分配的一份示例餐盘，不是真的识别结果。换成真实模型后才会看照片。',
      };
    }

    return { kind: 'other', text: '发一张食物的照片，或者说一句你吃了什么。' };
  },
};

/** 供其它模块复用：列出内置食物名 */
export const MOCK_FOOD_NAMES = FOODS.map((f) => f.name);
