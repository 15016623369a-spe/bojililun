import type { SculptureVariant } from './sculpture-groups';

export const BODY_MODEL_COOKIE = 'fitcheck_body_model';

export function parseBodyModel(value: unknown): SculptureVariant | null {
  return value === 'male' || value === 'female' ? value : null;
}
