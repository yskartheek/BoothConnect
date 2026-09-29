import { Module } from '@nestjs/common';

import { GeographyController } from './geography.controller';
import { GeographyService } from './geography.service';
import { MasterDataService } from './master-data.service';

@Module({
  controllers: [GeographyController],
  providers: [GeographyService, MasterDataService],
  exports: [GeographyService],
})
export class GeographyModule {}
