import { Module } from '@nestjs/common';

import { ConsentsModule } from '../consents/consents.module';
import { FieldValuesModule } from '../field-values/field-values.module';
import { VoterSelfController } from './voter-self.controller';
import { VoterSelfService } from './voter-self.service';

/** Voter self-service (#224): the signed-in voter's own record. */
@Module({
  imports: [FieldValuesModule, ConsentsModule],
  controllers: [VoterSelfController],
  providers: [VoterSelfService],
})
export class VoterSelfModule {}
