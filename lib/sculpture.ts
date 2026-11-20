import type { MuscleId } from './muscles';

/** Stable byte-index order for sculpture label files and offline tooling.
 * Do not reorder: sculpture-muscle-ortho-v1.bin stores these indices.
 * Runtime classification/highlighting uses the baked labels, never position rules.
 */
export const SCULPTURE_ORDER: MuscleId[] = [
  'neck', 'traps', 'chest_upper', 'chest_mid', 'chest_lower', 'delt_front', 'delt_side', 'delt_rear',
  'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'serratus', 'upperback', 'lats', 'lowerback',
  'glutes', 'quads', 'hamstrings', 'adductors', 'calves',
];
