import { HttpStatus, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import { AppException } from './app.exception';
import { ErrorCode } from './error-codes';

export interface FieldError {
  /** Dotted path to the field, e.g. `address.pinCode` or `members.0.age`. */
  field: string;
  errors: string[];
}

/** Flattens class-validator's nested errors into one entry per field. */
export function fieldErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, errors: Object.values(error.constraints) }] : [];
    return [...own, ...fieldErrors(error.children ?? [], field)];
  });
}

/**
 * The global validation pipe. Unknown properties are rejected (not silently
 * dropped), so a typo in a field name is a 400 instead of a lost value. The
 * submitted values are never echoed back, because they may be personal data.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Request validation failed',
        fieldErrors(errors),
      ),
  });
}
