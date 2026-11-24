/** 教练能回答的话题。数字都由服务端按回顾、训练统计同一套口径算好（lib/coach-data.ts），模型只负责解读。 */
export const COACH_TOPICS = {
  meal: '下一餐怎么选',
  strength: '复盘近 30 天',
  plan: '安排下次训练',
  metabolism: '基础代谢',
  macros: '三大营养目标',
  training: '训练怎么调整',
  energy: '热量缺口',
  general: '其他问题',
} as const;

export type CoachTopic = keyof typeof COACH_TOPICS;

/** 首屏卡片和底部快捷提问：点一下就用这句话提问，并带上话题 */
export const COACH_STARTERS: { topic: CoachTopic; question: string; label: string; hint: string }[] = [
  { topic: 'metabolism', question: '我最近的基础代谢是多少', label: '我的基础代谢', hint: '按晨重和「我的」资料算' },
  { topic: 'macros', question: '我每天碳水、脂肪、蛋白质该吃多少', label: '三大营养吃多少', hint: '按目标热量算出克数' },
  { topic: 'training', question: '按我的目标，训练该怎么调整', label: '训练怎么调整', hint: '结合近 30 天的训练分布和纪录' },
  { topic: 'meal', question: '下一餐怎么选', label: '下一餐怎么选', hint: '结合今天已记录的餐食给建议' },
  { topic: 'strength', question: '复盘近 30 天', label: '复盘近 30 天', hint: '看看近期力量与训练趋势' },
  { topic: 'plan', question: '安排下次训练', label: '安排下次训练', hint: '基于最近一次实练生成草案' },
];

export type CoachEvidence = { date: string; cardId: number; label: string };
export type CoachPlan = {
  date: string;
  exercises: { id: string; name: string; sets: number; reps: number; weight: number }[];
};

/** 图表颜色：和回顾、统计页同一套（柠檬黄容量、雾蓝代谢、珊瑚红缺口、淡紫曲线） */
export type CoachTone = 'lemon' | 'mist' | 'coral' | 'lilac';
export type CoachSeries = {
  key: string;
  name: string;
  unit: string;
  /** 读数保留几位小数 */
  dec: number;
  values: (number | null)[];
};
type ChartBase = { id: string; title: string; tone: CoachTone; note?: string };
/** 按天（1 年按月）或按类别的一组数；多组时可切换，各自单独定刻度 */
export type CoachSeriesChart = ChartBase & {
  kind: 'line' | 'bars';
  labels: string[];
  /** 每一格的完整说明，按住图读数时显示 */
  picks: string[];
  series: CoachSeries[];
  /** 默认显示哪一组、高亮哪一格 */
  focus?: string;
  index?: number;
  /** 建议区，画在柱状图背后 */
  band?: { from: number; to: number; label: string };
};
/** 实际 / 目标，例如三大营养 */
export type CoachProgressChart = ChartBase & {
  kind: 'progress';
  rows: { key: string; name: string; value: number | null; target: number; unit: string }[];
  /** 实际值的说明，例如「近 7 天日均」 */
  valueLabel: string;
};
export type CoachChart = CoachSeriesChart | CoachProgressChart;

export type CoachTurn = {
  id: string;
  question: string;
  topic: CoachTopic;
  reply: string;
  evidence: CoachEvidence[];
  plan: CoachPlan | null;
  charts: CoachChart[];
  confirmed: boolean;
};
export type CoachState = {
  turns: CoachTurn[];
  overview: {
    days: number;
    trainingDays: number;
    mealDays: number;
    latestWorkout: CoachEvidence | null;
    insight: { title: string; detail: string; evidence: CoachEvidence[] } | null;
  };
};
