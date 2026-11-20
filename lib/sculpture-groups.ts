import metadata from '../public/models/sculpture/sculpture-muscle-ortho-v1.json';
import { muscleById, muscleMatchesExercise, type MuscleId } from './muscles';

/** One source of truth shared by the API, recorded-muscle filters, and the viewer. */
export const SCULPTURE_METADATA = metadata;
const names: Record<string, string> = {
  chest_mid: '胸部', delt_side: '肩部', abs: '腹直肌', obliques: '腹斜肌',
  biceps: '肱二头肌', triceps: '肱三头肌', forearms: '前臂', lats: '背阔肌',
  upperback: '斜方肌与上背', lowerback: '下背', glutes: '臀部', quads: '股四头肌',
  hamstrings: '腘绳肌', calves: '小腿',
};

export const SCULPTURE_GROUPS = metadata.palette.map((entry) => ({
  id: entry.canonicalId as MuscleId,
  label: names[entry.canonicalId],
  byteValue: entry.byteValue,
  members: entry.linkedIds as MuscleId[],
  side: muscleById(entry.canonicalId)!.side,
}));

export function sculptureGroup(id: string | null | undefined) {
  const alias = id === 'chest' ? 'chest_mid' : id === 'shoulders' ? 'delt_side' : id;
  return SCULPTURE_GROUPS.find((group) => group.members.some((member) => member === alias));
}

export function canonicalMuscle(id: string | null | undefined): MuscleId | null {
  return sculptureGroup(id)?.id ?? null;
}

export function sculptureGroupMatches(id: string, exercise: { name: string; target: string; body_part: string }) {
  return sculptureGroup(id)?.members.some((member) => {
    const def = muscleById(member);
    return def ? muscleMatchesExercise(def, exercise) : false;
  }) ?? false;
}

export function recordedInGroup(recorded: readonly string[], selected: string): boolean {
  const group = sculptureGroup(selected);
  return group ? recorded.some((id) => group.members.includes(id as MuscleId)) : recorded.includes(selected);
}

/** Categorical interpolation: sum barycentric evidence for repeated corner IDs.
 * The fragment shader uses this same rule; numeric ID interpolation is forbidden.
 */
export function labelAtBarycentric(ids: readonly number[], barycentric: readonly number[]): number {
  const scores = ids.map((id) => ids.reduce((sum, other, j) => sum + (id === other ? barycentric[j] : 0), 0));
  let winner = 0;
  for (let i = 1; i < 3; i++) if (scores[i] > scores[winner]) winner = i;
  return ids[winner];
}
