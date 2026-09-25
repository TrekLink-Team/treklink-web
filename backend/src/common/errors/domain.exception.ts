import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-code.enum';

export interface DomainExceptionBody {
  errorCode: ErrorCode;
  message: string;
}

// Base class for every business failure (specs/platform/design.md §4.1). The global exception
// filter turns it into the D-002 envelope with `result = { errorCode }` (D-026).
export class DomainException extends HttpException {
  constructor(
    readonly httpStatus: HttpStatus,
    readonly errorCode: ErrorCode,
    message: string,
  ) {
    super({ errorCode, message } satisfies DomainExceptionBody, httpStatus);
  }
}
