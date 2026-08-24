import { Global, Module } from '@nestjs/common';
import { FeaturesGuard } from './guards/features.guard';

@Global()
@Module({
  providers: [FeaturesGuard],
  exports: [FeaturesGuard],
})
export class CommonModule {}
