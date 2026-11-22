import { cookies } from 'next/headers';
import { BODY_MODEL_COOKIE, parseBodyModel } from '../body-model-preference';
import { sculptureVariant } from '../sculpture-groups';
import { getTrainingModelSex } from './training-profile';

/** 个人档案对应的默认模型 */
export function getTrainingBodyModel() {
  return sculptureVariant(getTrainingModelSex());
}

/** 计划页「默认 / 男 / 女」切换存在 cookie 里；回顾、统计、加练沿用同一个选择 */
export async function getBodyModelSettings() {
  const preference = parseBodyModel((await cookies()).get(BODY_MODEL_COOKIE)?.value);
  const profileModel = getTrainingBodyModel();
  return { preference, profileModel, model: preference ?? profileModel };
}
