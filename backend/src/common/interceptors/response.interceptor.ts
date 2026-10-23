import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

export const DEFAULT_SUCCESS_MESSAGE = 'Success';

export interface StandardApiResponse<T> {
  result: T | null;
  isSuccess: boolean;
  statusCode: number;
  message: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, StandardApiResponse<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<StandardApiResponse<T> | T> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(RAW_RESPONSE_KEY, targets)) {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response>();
    const message =
      this.reflector.getAllAndOverride<string | undefined>(RESPONSE_MESSAGE_KEY, targets) ??
      DEFAULT_SUCCESS_MESSAGE;

    return next.handle().pipe(
      map((data: T) => ({
        result: data !== undefined ? data : null,
        isSuccess: true,
        statusCode: response.statusCode || 200,
        message,
      })),
    );
  }
}
