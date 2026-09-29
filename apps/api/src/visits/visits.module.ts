import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { FieldValuesModule } from '../field-values/field-values.module';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  imports: [FieldValuesModule, AnalyticsModule],
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
