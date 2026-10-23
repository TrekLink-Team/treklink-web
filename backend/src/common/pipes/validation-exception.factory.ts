import { HttpStatus, ValidationError } from '@nestjs/common';
import { DomainException, ErrorCode } from '../errors';

// class-validator messages start with the property name ("name should not be empty"). For a nested
// property the leading name is replaced by the full path ("contacts.0.name should not be empty").
// A top-level message is kept as class-validator wrote it ("property extra should not exist").
const withPath = (message: string, property: string, path: string): string => {
  if (path === property) return message;
  return message.startsWith(`${property} `)
    ? `${path}${message.slice(property.length)}`
    : `${path}: ${message}`;
};

const flatten = (errors: ValidationError[], parentPath = ''): string[] =>
  errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) =>
      withPath(message, error.property, path),
    );
    return [...own, ...flatten(error.children ?? [], path)];
  });

// ValidationPipe `exceptionFactory` (specs/platform/design.md §4.1, REQ-ERR-01, AC-03): one 400
// VALIDATION_FAILED whose message names every offending property, joined by "; ".
export const validationExceptionFactory = (errors: ValidationError[]): DomainException => {
  const problems = flatten(errors);
  return new DomainException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_FAILED,
    problems.length > 0 ? problems.join('; ') : 'Validation failed.',
  );
};
