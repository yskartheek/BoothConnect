import { Module } from '@nestjs/common';

import { FieldValuesModule } from '../field-values/field-values.module';
import { HouseholdWritesService } from './household-writes.service';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';

@Module({
  imports: [FieldValuesModule],
  controllers: [HouseholdsController],
  providers: [HouseholdsService, HouseholdWritesService],
  exports: [HouseholdsService, HouseholdWritesService],
})
export class HouseholdsModule {}
