import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audited';

// Global: any module can inject AuditService, and @Audited() works on any route.
@Global()
@Module({
  controllers: [AuditEventsController],
  providers: [
    AuditService,
    AuditEventsService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
