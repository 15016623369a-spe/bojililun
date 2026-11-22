import type { SculptureVariant } from '@/lib/sculpture-groups';

type ModelChoice = SculptureVariant | null;
const choices = [
  { value: null, label: '默认' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
] as const;

export default function PlanModelSwitch({ choice, onChange }: {
  choice: ModelChoice;
  onChange: (model: ModelChoice) => void;
}) {
  return <span className="plan-model-switch" role="group" aria-label="人体模型">
    {choices.map(({ value, label }) => <button key={label} type="button" aria-pressed={choice === value}
      aria-label={value === null ? '跟随个人档案' : value === 'male' ? '男性模型' : '女性模型'}
      onClick={() => onChange(value)}>{label}</button>)}
  </span>;
}
