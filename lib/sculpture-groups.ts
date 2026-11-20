import metadata from '../public/models/sculpture/sculpture-muscle-male-fine-v2.json';
import femaleMetadata from '../public/models/sculpture/female/sculpture-muscle-female-slim-fine-v2.json';
import { muscleById, muscleMatchesExercise, type MuscleId } from './muscles';

/** One source of truth shared by the API, recorded-muscle filters, and the viewer. */
export const SCULPTURE_METADATA = metadata;

export type SculptureVariant = 'male' | 'female';

/** 每个体型的模型与标签；两者共用同一套 byte→肌群映射。 */
export const SCULPTURE_VARIANTS = {
  male: {
    model: '/models/sculpture/fitcheck-sculpture-tripo-v1.glb',
    labels: '/models/sculpture/sculpture-muscle-male-fine-v2',
    metadata,
  },
  female: {
    model: '/models/sculpture/female/fitcheck-sculpture-female-slim-v1.glb',
    labels: '/models/sculpture/female/sculpture-muscle-female-slim-fine-v2',
    metadata: femaleMetadata,
  },
} as const;

export function sculptureVariant(sex: string | null | undefined): SculptureVariant {
  return sex === 'female' ? 'female' : 'male';
}

type Counts = Record<string, number>;

/** fine-v2 的 byteValue 就是 sculptureOrder 的下标；counts 为 0 的肌群（如 neck）不进分组。 */
export const SCULPTURE_GROUPS = metadata.sculptureOrder
  .map((id, byteValue) => ({ id: id as MuscleId, byteValue }))
  .filter(({ id }) => ((metadata.counts as Counts)[id] ?? 0) > 0)
  .map(({ id, byteValue }) => ({
    id,
    label: muscleById(id)?.label ?? id,
    byteValue,
    members: [id] as MuscleId[],
    side: muscleById(id)!.side,
  }));

/** 旧版粗分区别名：解析单个分组时落在中束上；筛动作时按整块肌群取并集。 */
const aliasIds: Record<string, string> = { chest: 'chest_mid', shoulders: 'delt_side' };
const aliasFamilies: Record<string, MuscleId[]> = {
  chest: ['chest_upper', 'chest_mid', 'chest_lower'],
  shoulders: ['delt_front', 'delt_side', 'delt_rear'],
};

export function sculptureGroup(id: string | null | undefined) {
  const alias = id ? aliasIds[id] ?? id : id;
  return SCULPTURE_GROUPS.find((group) => group.members.some((member) => member === alias));
}

export function canonicalMuscle(id: string | null | undefined): MuscleId | null {
  return sculptureGroup(id)?.id ?? null;
}

export function sculptureGroupMatches(id: string, exercise: { name: string; target: string; body_part: string }) {
  const family = aliasFamilies[id];
  if (family) {
    return family.some((member) => {
      const def = muscleById(member);
      return def ? muscleMatchesExercise(def, exercise) : false;
    });
  }
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
