/**
 * 伤病 / 禁忌 → 要避开的动作。说话排计划（lib/core/chat.ts）和教练的训练建议（lib/coach-data.ts）共用。
 * 确定性安全规则：伤病/禁忌类记忆 → 高风险动作关键词。
 * 匹配动作英文名 + 中文名；宁可保守排除，也不给伤病用户排危险动作。
 * 例如「左肩有伤 / 不能做过顶推举」会排除推举、抓举、挺举、颈后、直立划船等过顶/肩部高压动作。
 */
export type ConstraintRule = { trigger: RegExp; exclude: RegExp; label: string };

export const CONSTRAINT_RULES: ConstraintRule[] = [
  {
    trigger: /肩|过顶|过头|overhead/i,
    exclude:
      /overhead|shoulder press|military|snatch|jerk|push press|thruster|upright row|behind.*neck|arnold|\bclean\b|above.*head|过顶|过头|上方头|颈后|推举|抓举|挺举|借力推|高翻|翻站|直立划船|阿诺德/i,
    label: '过顶/肩部高压类动作',
  },
  {
    trigger: /膝/,
    exclude: /jump|plyo|sprint|跳|爆发|冲刺/i,
    label: '跳跃冲击类动作',
  },
  {
    trigger: /腰|下背|腰椎/,
    exclude: /deadlift|good morning|sit-?up|硬拉|早安式|仰卧起坐/i,
    label: '下背高压类动作',
  },
  {
    trigger: /肘/,
    exclude: /skull|tricep.*extension|臂屈伸/i,
    label: '肘部高压类动作',
  },
  {
    trigger: /腕/,
    exclude: /wrist|curl|腕|弯举/i,
    label: '腕部高压类动作',
  },
];

type MemoryLike = Array<{ kind: string; content: string }>;

export function constraintRulesFor(mems: MemoryLike) {
  return CONSTRAINT_RULES.filter((r) =>
    mems.some((m) => m.kind === 'constraint' && r.trigger.test(m.content)),
  );
}
