import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from './validation-exception.factory';

// The global ValidationPipe of `configureApp`, shared with the tests that check a DTO the way a request
// reaches it (W26): unknown properties are refused and every failure is one 400 VALIDATION_FAILED.
export const appValidationPipe = (): ValidationPipe =>
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    exceptionFactory: validationExceptionFactory,
  });

// The query DTO as the pipe builds it from a query string, or the DomainException it throws.
export const validateQuery = <T>(
  metatype: new () => T,
  query: Record<string, unknown>,
): Promise<T> => appValidationPipe().transform(query, { type: 'query', metatype }) as Promise<T>;
