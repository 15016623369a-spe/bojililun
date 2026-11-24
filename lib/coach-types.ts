export const COACH_TOPICS = {
  meal: '下一餐怎么选',
  strength: '复盘近 30 天',
  plan: '安排下次训练',
} as const;

export type CoachTopic = keyof typeof COACH_TOPICS;
export type CoachEvidence = { date: string; cardId: number; label: string };
export type CoachPlan = {
  date: string;
  exercises: { id: string; name: string; sets: number; reps: number; weight: number }[];
};
export type CoachTurn = {
  id: string;
  question: string;
  topic: CoachTopic;
  reply: string;
  evidence: CoachEvidence[];
  plan: CoachPlan | null;
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
