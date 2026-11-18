import type { MuscleId } from './muscles';

export interface JournalEntry {
  id: string;
  quickId?: number;
  kind: 'meal' | 'training';
  date: string;
  title: string;
  detail: string;
  meta?: string;
  source?: string;
  time?: string;
  muscles?: MuscleId[];
  href?: string;
}

export function mentionedMuscles(text: string): MuscleId[] {
  const cues: [RegExp, MuscleId][] = [
    [/上胸|上斜.*推/, 'chest_upper'], [/练胸|卧推|夹胸|俯卧撑/, 'chest_mid'],
    [/高位下拉|练背|引体/, 'lats'], [/划船|上背/, 'upperback'],
    [/侧平举|练肩/, 'delt_side'], [/深蹲|腿举|练腿/, 'quads'],
    [/臀桥|臀推|练臀/, 'glutes'], [/卷腹|练腹/, 'abs'],
    [/二头|弯举/, 'biceps'], [/三头|下压/, 'triceps'],
  ];
  return cues.filter(([pattern]) => pattern.test(text)).map(([, muscle]) => muscle);
}
