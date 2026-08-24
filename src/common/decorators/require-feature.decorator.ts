import { SetMetadata } from '@nestjs/common';
import type { AppFeature } from '../features';

export const FEATURE_KEY = 'required_feature';
export const RequireFeature = (feature: AppFeature) =>
  SetMetadata(FEATURE_KEY, feature);
