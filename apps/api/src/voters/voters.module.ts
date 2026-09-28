import { Module } from '@nestjs/common';

import { FieldValuesModule } from '../field-values/field-values.module';
import { VoterWritesService } from './voter-writes.service';
import { VotersController } from './voters.controller';
import { VotersService } from './voters.service';

@Module({
  imports: [FieldValuesModule],
  controllers: [VotersController],
  providers: [VotersService, VoterWritesService],
  exports: [VotersService, VoterWritesService],
})
export class VotersModule {}
