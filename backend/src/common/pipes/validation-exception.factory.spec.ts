import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Min, ValidateNested } from 'class-validator';
import { DomainException, ErrorCode } from '../errors';
import { validationExceptionFactory } from './validation-exception.factory';

class ContactDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

class SampleDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  reason!: string;

  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[] = [];
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

const validate = async (body: unknown): Promise<DomainException> => {
  try {
    await pipe.transform(body, { type: 'body', metatype: SampleDto });
  } catch (error) {
    return error as DomainException;
  }
  throw new Error('expected validation to fail');
};

describe('validationExceptionFactory', () => {
  it('names one bad property', async () => {
    const error = await validate({ expectedVersion: 3 });

    expect(error).toBeInstanceOf(DomainException);
    expect(error.httpStatus).toBe(HttpStatus.BAD_REQUEST);
    expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.message).toBe('reason must be a string');
  });

  it('names every bad property, joined by "; "', async () => {
    const error = await validate({ expectedVersion: 0 });

    expect(error.message).toBe('expectedVersion must not be less than 1; reason must be a string');
  });

  it('names a nested DTO property by its full path', async () => {
    const error = await validate({ expectedVersion: 1, reason: 'drill', contacts: [{ name: '' }] });

    expect(error.message).toBe('contacts.0.name should not be empty');
  });

  it('names a property that is not whitelisted', async () => {
    const error = await validate({ expectedVersion: 1, reason: 'drill', extra: true });

    expect(error.message).toBe('property extra should not exist');
  });
});
