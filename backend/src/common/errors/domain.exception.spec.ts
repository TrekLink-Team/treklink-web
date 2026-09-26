import { HttpException, HttpStatus } from '@nestjs/common';
import { DomainException, ErrorCode } from '.';

describe('DomainException', () => {
  it('carries the HTTP status, the error code and the message', () => {
    const error = new DomainException(
      HttpStatus.CONFLICT,
      ErrorCode.STALE_VERSION,
      'Parameter was changed by someone else.',
    );

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.errorCode).toBe('STALE_VERSION');
    expect(error.getResponse()).toEqual({
      errorCode: 'STALE_VERSION',
      message: 'Parameter was changed by someone else.',
    });
  });
});

describe('ErrorCode', () => {
  it('uses each code as its own UPPER_SNAKE value', () => {
    for (const [name, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(name);
      expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('contains every cross-cutting code of platform design §4.2', () => {
    expect(Object.values(ErrorCode)).toEqual(
      expect.arrayContaining([
        'VALIDATION_FAILED',
        'UNAUTHENTICATED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT_UNIQUE',
        'INVALID_STATE_TRANSITION',
        'STALE_VERSION',
        'PAYLOAD_TOO_LARGE',
        'PARAMETER_OUT_OF_RANGE',
        'INTERNAL_ERROR',
      ]),
    );
  });
});
