import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { AllExceptionsFilter } from './errors/all-exceptions.filter';
import { createValidationPipe } from './errors/validation';

// Cross-cutting request handling for every route: the error format (#28) and
// input validation. Registered as providers so tests that build AppModule get
// exactly the same behaviour as main.ts.
@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class CommonModule {}
