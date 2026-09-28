import { Module } from '@nestjs/common';

import { FieldValuesModule } from '../field-values/field-values.module';
import { ConflictsController } from './conflicts.controller';
import { ConflictsService } from './conflicts.service';

@Module({
  imports: [FieldValuesModule],
  controllers: [ConflictsController],
  providers: [ConflictsService],
  exports: [ConflictsService],
})
export class ConflictsModule {}
