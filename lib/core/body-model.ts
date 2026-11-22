import { cookies } from 'next/headers';
import { BODY_MODEL_COOKIE, parseBodyModel } from '../body-model-preference';
import { sculptureVariant } from '../sculpture-groups';
import { getTrainingModelSex } from './training-profile';

export async function getBodyModelSettings() {
  const preference = parseBodyModel((await cookies()).get(BODY_MODEL_COOKIE)?.value);
  const profileModel = sculptureVariant(getTrainingModelSex());
  return { preference, profileModel, model: preference ?? profileModel };
}
