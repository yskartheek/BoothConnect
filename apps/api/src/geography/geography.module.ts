import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { CoverageService } from './coverage.service';
import { GeographyController } from './geography.controller';
import { GeographyService } from './geography.service';
import { MasterDataService } from './master-data.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [GeographyController],
  providers: [GeographyService, MasterDataService, CoverageService],
  exports: [GeographyService],
})
export class GeographyModule {}
