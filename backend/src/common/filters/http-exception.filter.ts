import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

// Prisma errors that escape a service (REQ-ERR-03, REQ-ERR-04). A service that can name the
// conflicting value throws its own DomainException; this is the fallback. Any other Prisma code
// stays unmapped and becomes a logged 500, so no query detail reaches the client (REQ-ERR-02).
export const mapPrismaError = (exception: unknown): DomainException | undefined => {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = exception.meta ?? {};

  if (exception.code === 'P2002') {
    const target = meta.target;
    const fields = Array.isArray(target)
      ? target.join(', ')
      : typeof target === 'string'
        ? target
        : 'value';
    return new DomainException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT_UNIQUE,
      `${fields} is already registered.`,
    );
  }

  if (exception.code === 'P2025') {
    const model = typeof meta.modelName === 'string' ? meta.modelName : 'Record';
    return new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${model} not found.`);
  }

  return undefined;
};

// Errors raised by the Express body parser before any handler runs (REQ-ERR-07). They follow the
// http-errors convention: `type` names the failure and `expose` marks the message as safe to show.
// Malformed JSON needs no case here: Nest already raises it as a BadRequestException.
interface BodyParserError {
  type?: unknown;
  status?: unknown;
  expose?: unknown;
  limit?: unknown;
}

export const mapBodyParserError = (exception: unknown): DomainException | undefined => {
  if (!(exception instanceof Error)) return undefined;
  const { type, status, expose, limit } = exception as BodyParserError;

  if (type === 'entity.too.large') {
    const detail = typeof limit === 'number' ? ` the ${limit}-byte limit` : ' the size limit';
    return new DomainException(
      HttpStatus.PAYLOAD_TOO_LARGE,
      ErrorCode.PAYLOAD_TOO_LARGE,
      `Request body exceeds${detail}.`,
    );
  }
  if (typeof status === 'number' && status >= 400 && status < 500 && expose === true) {
    return new DomainException(status, ErrorCode.CLIENT_ERROR, exception.message);
  }
  return undefined;
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(thrown: unknown, host: ArgumentsHost) {
    const exception = mapPrismaError(thrown) ?? mapBodyParserError(thrown) ?? thrown;
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
