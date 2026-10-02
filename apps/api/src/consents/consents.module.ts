import { Module } from '@nestjs/common';

import { ConsentsService } from './consents.service';

/** A voter's consents: listing and withdrawal, for the voter and for staff (#213). */
@Module({
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
