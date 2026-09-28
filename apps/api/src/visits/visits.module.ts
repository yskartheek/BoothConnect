import { Module } from '@nestjs/common';

import { FieldValuesModule } from '../field-values/field-values.module';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  imports: [FieldValuesModule],
  controllers: [VisitsController],
  providers: [VisitsService],
})
export class VisitsModule {}
