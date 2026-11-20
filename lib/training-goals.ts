export const TRAINING_GOALS = {
  muscle: '增肌',
  strength: '提升力量',
  weight: '控制体重',
  habit: '保持训练',
  record: '只想记录',
} as const;

export type TrainingGoal = keyof typeof TRAINING_GOALS;
