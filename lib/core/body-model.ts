import { sculptureVariant } from '../sculpture-groups';
import { getTrainingModelSex } from './training-profile';

export function getTrainingBodyModel() {
  return sculptureVariant(getTrainingModelSex());
}
