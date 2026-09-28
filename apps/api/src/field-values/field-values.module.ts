import { Module } from '@nestjs/common';

import { FieldValuesService } from './field-values.service';

@Module({
  providers: [FieldValuesService],
  exports: [FieldValuesService],
})
export class FieldValuesModule {}
