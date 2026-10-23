import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../errors';
import { GlobalExceptionFilter } from './http-exception.filter';

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

const handle = (exception: unknown) => {
  const response: MockResponse = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  new GlobalExceptionFilter().catch(exception, host);

  expect(response.status).toHaveBeenCalledTimes(1);
  expect(response.json).toHaveBeenCalledTimes(1);
  const [status] = response.status.mock.calls[0] as [number];
  const [body] = response.json.mock.calls[0] as [unknown];
  return { status, body };
};

describe('GlobalExceptionFilter', () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => errorLog.mockRestore());

  it('carries the DomainException code in result (D-026, AC-02)', () => {
    const { status, body } = handle(
      new DomainException(HttpStatus.CONFLICT, ErrorCode.STALE_VERSION, 'Changed by someone else.'),
    );

    expect(status).toBe(409);
    expect(body).toEqual({
      result: { errorCode: 'STALE_VERSION' },
      isSuccess: false,
      statusCode: 409,
      message: 'Changed by someone else.',
    });
  });

  it.each([
    [new BadRequestException('email must be an email'), 400, 'VALIDATION_FAILED'],
    [new UnauthorizedException(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new NotFoundException('Cannot GET /api/nowhere'), 404, 'NOT_FOUND'],
    [new PayloadTooLargeException(), 413, 'PAYLOAD_TOO_LARGE'],
    [new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS), 429, 'RATE_LIMITED'],
    [new ServiceUnavailableException(), 503, 'SERVICE_UNAVAILABLE'],
  ])('maps a Nest %p to its catalogue code', (exception, expectedStatus, expectedCode) => {
    const { status, body } = handle(exception);

    expect(status).toBe(expectedStatus);
    expect(body).toMatchObject({
      result: { errorCode: expectedCode },
      isSuccess: false,
      statusCode: expectedStatus,
    });
  });

  it.each([
    [new ConflictException('duplicate'), 409],
    [new HttpException('I am a teapot', HttpStatus.I_AM_A_TEAPOT), 418],
  ])('keeps the status of an uncatalogued 4xx and uses CLIENT_ERROR', (exception, expected) => {
    const { status, body } = handle(exception);

    expect(status).toBe(expected);
    expect(body).toMatchObject({ result: { errorCode: 'CLIENT_ERROR' }, statusCode: expected });
  });

  it('uses INTERNAL_ERROR for a 5xx HttpException without a catalogue code', () => {
    const { status, body } = handle(new InternalServerErrorException('boom'));

    expect(status).toBe(500);
    expect(body).toMatchObject({ result: { errorCode: 'INTERNAL_ERROR' }, statusCode: 500 });
  });

  it('answers an unhandled error with a generic 500 INTERNAL_ERROR and logs the stack (REQ-ERR-02)', () => {
    const { status, body } = handle(new Error('SELECT secret FROM somewhere failed'));

    expect(status).toBe(500);
    expect(body).toEqual({
      result: { errorCode: 'INTERNAL_ERROR' },
      isSuccess: false,
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('SELECT secret FROM somewhere'));
  });

  it('joins a validation message array into one message', () => {
    const { body } = handle(
      new BadRequestException(['name must be a string', 'age must be a number']),
    );

    expect(body).toMatchObject({ message: 'name must be a string, age must be a number' });
  });

  describe('Prisma errors (REQ-ERR-03, REQ-ERR-04)', () => {
    const prismaError = (code: string, meta?: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError(
        `Invalid prisma.user.create() invocation: SELECT "password_hash" FROM "users" failed (${code})`,
        { code, clientVersion: '6.19.3', meta },
      );

    it('maps P2002 to 409 CONFLICT_UNIQUE naming the target field', () => {
      const { status, body } = handle(
        prismaError('P2002', { modelName: 'User', target: ['email'] }),
      );

      expect(status).toBe(409);
      expect(body).toEqual({
        result: { errorCode: 'CONFLICT_UNIQUE' },
        isSuccess: false,
        statusCode: 409,
        message: 'email is already registered.',
      });
    });

    it('names every field of a composite P2002 target', () => {
      const { body } = handle(prismaError('P2002', { target: ['organizationId', 'serial'] }));

      expect(body).toMatchObject({ message: 'organizationId, serial is already registered.' });
    });

    it('maps P2025 to 404 NOT_FOUND', () => {
      const { status, body } = handle(
        prismaError('P2025', { modelName: 'Device', cause: 'No record' }),
      );

      expect(status).toBe(404);
      expect(body).toEqual({
        result: { errorCode: 'NOT_FOUND' },
        isSuccess: false,
        statusCode: 404,
        message: 'Device not found.',
      });
    });

    it('answers an unknown Prisma code with a generic 500 and logs it', () => {
      const { status, body } = handle(prismaError('P2034'));

      expect(status).toBe(500);
      expect(body).toEqual({
        result: { errorCode: 'INTERNAL_ERROR' },
        isSuccess: false,
        statusCode: 500,
        message: 'Internal server error',
      });
      expect(JSON.stringify(body)).not.toMatch(/SELECT|password_hash|prisma/);
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('P2034'));
    });

    it('never puts the stack or the SQL of a plain Error in the body', () => {
      const { body } = handle(new Error('SELECT "password_hash" FROM "users"'));

      expect(JSON.stringify(body)).not.toMatch(/SELECT|password_hash|at /);
    });
  });

  describe('body parser errors (REQ-ERR-07)', () => {
    const parserError = (fields: Record<string, unknown>) =>
      Object.assign(new Error('parser said no'), fields);

    it('maps entity.too.large to 413 PAYLOAD_TOO_LARGE', () => {
      const { status, body } = handle(
        parserError({ type: 'entity.too.large', status: 413, expose: true, limit: 1048576 }),
      );

      expect(status).toBe(413);
      expect(body).toMatchObject({
        result: { errorCode: 'PAYLOAD_TOO_LARGE' },
        message: 'Request body exceeds the 1048576-byte limit.',
      });
    });

    it('keeps another exposed 4xx parser error as CLIENT_ERROR', () => {
      const { status, body } = handle(
        parserError({ type: 'charset.unsupported', status: 415, expose: true }),
      );

      expect(status).toBe(415);
      expect(body).toMatchObject({
        result: { errorCode: 'CLIENT_ERROR' },
        message: 'parser said no',
      });
    });

    it('treats an unexposed error with a status as a 500', () => {
      const { status } = handle(parserError({ status: 400, expose: false }));

      expect(status).toBe(500);
    });
  });
});
