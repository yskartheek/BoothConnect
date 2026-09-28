import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Public } from '../src/auth/decorators';
import { type ApiErrorBody, AppException } from '../src/common/errors/app.exception';
import { ErrorCode } from '../src/common/errors/error-codes';
import { Prisma } from '../src/generated/prisma/client';

class AddressDto {
  @IsString()
  @Length(6, 6)
  pinCode!: string;
}

class MemberDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsInt()
  @Min(18)
  @Max(120)
  age!: number;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

// Routes that raise each kind of error, only for these tests.
@Public()
@Controller('test-errors')
class ErrorsTestController {
  @Post('members')
  create(@Body() body: MemberDto): MemberDto {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('connection string postgres://secret@db leaked in a stack trace');
  }

  @Get('app')
  app(): never {
    throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, 'Nope', {
      reason: 'test',
    });
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException();
  }

  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableException('Redis at 10.0.0.5 is down');
  }

  @Get('unique')
  unique(): never {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { modelName: 'AppUser', target: ['phone'] },
    });
  }

  @Get('missing')
  missing(): never {
    throw new Prisma.PrismaClientKnownRequestError('No record found', {
      code: 'P2025',
      clientVersion: 'test',
    });
  }
}

const REQUEST_ID = /^[0-9a-f-]{36}$/;

describe('error responses', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());
  const body = (res: { body: unknown }) => res.body as ApiErrorBody;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ErrorsTestController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const valid = { name: 'Test Person', age: 30, address: { pinCode: '500001' } };

  it('passes a valid body through, converted to the DTO', async () => {
    const res = await http().post('/v1/test-errors/members').send(valid).expect(201);
    expect(res.body).toEqual(valid);
  });

  it('rejects an invalid body with 400 and details for each field, nested ones included', async () => {
    const res = await http()
      .post('/v1/test-errors/members')
      .send({ name: '', age: 12, address: { pinCode: '12' } })
      .expect(400);

    expect(res.body).toEqual({
      requestId: expect.stringMatching(REQUEST_ID),
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: expect.arrayContaining([
        { field: 'name', errors: [expect.stringContaining('name')] },
        { field: 'age', errors: [expect.stringContaining('18')] },
        { field: 'address.pinCode', errors: [expect.stringContaining('pinCode')] },
      ]),
    });
    expect(body(res).requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects unknown properties instead of dropping them', async () => {
    const res = await http()
      .post('/v1/test-errors/members')
      .send({ ...valid, isAdmin: true })
      .expect(400);
    expect(body(res).details).toEqual([
      { field: 'isAdmin', errors: ['property isAdmin should not exist'] },
    ]);
  });

  it('never echoes submitted values back', async () => {
    const res = await http()
      .post('/v1/test-errors/members')
      .send({ ...valid, name: 'x'.repeat(101) + 'SECRET-VALUE' })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-VALUE');
  });

  it('answers malformed JSON with 400 MALFORMED_JSON, without quoting the body', async () => {
    const res = await http()
      .post('/v1/test-errors/members')
      .set('Content-Type', 'application/json')
      .send('{"name": SECRET-VALUE')
      .expect(400);
    expect(res.body).toEqual({
      requestId: expect.stringMatching(REQUEST_ID),
      code: 'MALFORMED_JSON',
      message: 'The request body is not valid JSON',
    });
  });

  it('answers an unknown error with 500 and no internals', async () => {
    const res = await http().get('/v1/test-errors/boom').expect(500);
    expect(res.body).toEqual({
      requestId: res.headers['x-request-id'],
      code: 'INTERNAL_ERROR',
      message: expect.stringContaining('request ID'),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|postgres|stack|at /i);
  });

  it('hides the message of a 5xx HttpException', async () => {
    const res = await http().get('/v1/test-errors/unavailable').expect(503);
    expect(body(res).code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });

  it('keeps the code, message and details of an AppException', async () => {
    const res = await http().get('/v1/test-errors/app').expect(422);
    expect(res.body).toEqual({
      requestId: expect.stringMatching(REQUEST_ID),
      code: 'UNPROCESSABLE',
      message: 'Nope',
      details: { reason: 'test' },
    });
  });

  it('gives Nest HTTP exceptions a stable code', async () => {
    const res = await http().get('/v1/test-errors/forbidden').expect(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: 'Forbidden' });
  });

  it('maps a unique violation to 409 UNIQUE_VIOLATION with the fields', async () => {
    const res = await http().get('/v1/test-errors/unique').expect(409);
    expect(res.body).toMatchObject({ code: 'UNIQUE_VIOLATION', details: { fields: ['phone'] } });
  });

  it('maps a missing record to 404 NOT_FOUND', async () => {
    const res = await http().get('/v1/test-errors/missing').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: 'Record not found' });
  });

  it('answers an unknown route with 404 NOT_FOUND in the same shape', async () => {
    const res = await http().get('/v1/no-such-route').expect(404);
    expect(res.body).toEqual({
      requestId: expect.stringMatching(REQUEST_ID),
      code: 'NOT_FOUND',
      message: expect.any(String),
    });
  });

  it('echoes a caller-supplied request ID in the header and the body', async () => {
    const res = await http()
      .get('/v1/test-errors/boom')
      .set('X-Request-Id', 'client-42')
      .expect(500);
    expect(res.headers['x-request-id']).toBe('client-42');
    expect(body(res).requestId).toBe('client-42');
  });
});
