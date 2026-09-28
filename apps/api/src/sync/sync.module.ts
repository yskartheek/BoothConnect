import { Module } from '@nestjs/common';

import { ConflictsModule } from '../conflicts/conflicts.module';
import { FieldValuesModule } from '../field-values/field-values.module';
import { HouseholdsModule } from '../households/households.module';
import { VisitsModule } from '../visits/visits.module';
import { SyncPushService } from './push.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [FieldValuesModule, VisitsModule, HouseholdsModule, ConflictsModule],
  controllers: [SyncController],
  providers: [SyncService, SyncPushService],
  exports: [SyncService],
})
export class SyncModule {}
