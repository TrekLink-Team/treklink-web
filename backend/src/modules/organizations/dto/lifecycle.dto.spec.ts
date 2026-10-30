import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExpectedVersionDto, OrganizationReasonDto } from './lifecycle.dto';

const check = async <T extends object>(type: new () => T, plain: Record<string, unknown>) => {
  const dto = plainToInstance(type, plain);
  return { dto, errors: await validate(dto) };
};

describe('Lifecycle DTOs (organizations api-design 08 to 10)', () => {
  it('takes a reason, trimmed, with the version the caller saw', async () => {
    const { dto, errors } = await check(OrganizationReasonDto, {
      reason: '  Unpaid balance ',
      expectedVersion: 3,
    });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ reason: 'Unpaid balance', expectedVersion: 3 });
  });

  it('refuses a blank reason as "reason is required.", one over 500 characters, and a bad version', async () => {
    const blank = await check(OrganizationReasonDto, { reason: '   ', expectedVersion: 0 });
    expect(Object.values(blank.errors[0].constraints ?? {})).toContain('reason is required.');
    expect((await check(OrganizationReasonDto, { expectedVersion: 0 })).errors).toHaveLength(1);
    expect(
      (await check(OrganizationReasonDto, { reason: 'x'.repeat(501), expectedVersion: 0 })).errors,
    ).toHaveLength(1);
    expect(
      (await check(OrganizationReasonDto, { reason: 'x'.repeat(500), expectedVersion: 0 })).errors,
    ).toEqual([]);
    for (const expectedVersion of [-1, 1.5, '3', undefined]) {
      const { errors } = await check(OrganizationReasonDto, { reason: 'x', expectedVersion });
      expect(errors).toHaveLength(1);
    }
  });

  it('takes the version alone for a reactivation', async () => {
    expect((await check(ExpectedVersionDto, { expectedVersion: 4 })).errors).toEqual([]);
    expect((await check(ExpectedVersionDto, {})).errors).toHaveLength(1);
    expect((await check(ExpectedVersionDto, { expectedVersion: -2 })).errors).toHaveLength(1);
  });
});
