import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainException, ErrorCode } from '../errors';

interface HttpExceptionBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

// Catalogue code for a Nest HttpException that is not a DomainException (D-026 consequence,
// 07-clarification-answers.md §7 questions 1 and 7). Any other 4xx keeps its status with
// CLIENT_ERROR; INTERNAL_ERROR is reserved for 5xx.
const STATUS_ERROR_CODES: Readonly<Partial<Record<number, ErrorCode>>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

export const errorCodeFor = (exception: HttpException): ErrorCode => {
  if (exception instanceof DomainException) return exception.errorCode;
  const status = exception.getStatus();
  return (
    STATUS_ERROR_CODES[status] ??
    (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.CLIENT_ERROR)
  );
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorCode = ErrorCode.INTERNAL_ERROR;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      errorCode = errorCodeFor(exception);
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as HttpExceptionBody;
        if (Array.isArray(resObj.message)) {
          message = resObj.message.join(', ');
        } else if (typeof resObj.message === 'string') {
          message = resObj.message;
        } else if (typeof resObj.error === 'string') {
          message = resObj.error;
        }
      }
    } else {
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.stack : JSON.stringify(exception)}`,
      );
    }

    response.status(status).json({
      result: { errorCode },
      isSuccess: false,
      statusCode: status,
      message,
    });
  }
}
