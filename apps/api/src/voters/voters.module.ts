import { Module } from '@nestjs/common';

import { ConsentsModule } from '../consents/consents.module';
import { FieldValuesModule } from '../field-values/field-values.module';
import { VoterWritesService } from './voter-writes.service';
import { VotersController } from './voters.controller';
import { VotersService } from './voters.service';

@Module({
  imports: [FieldValuesModule, ConsentsModule],
  controllers: [VotersController],
  providers: [VotersService, VoterWritesService],
  exports: [VotersService, VoterWritesService],
})
export class VotersModule {}
